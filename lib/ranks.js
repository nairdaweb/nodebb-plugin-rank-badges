'use strict';

/*
 * Pure rank logic: settings validation, threshold evaluation, group precedence and name
 * resolution. Used by library.js (server), lib/render.js and, through "modules" in plugin.json,
 * by the ACP script (public/admin.js) for the same validation and warnings. No NodeBB imports
 * and no Node-only APIs, so it runs in the browser and in node:test (test/*.test.js).
 *
 * Settings arrive from the ACP form as strings (meta.settings stores flat string values, the
 * rank and group tables as JSON). normalize() turns them into the config used everywhere
 * downstream, including the HTML renderer; validateSettings() is the stricter check run when
 * the settings are saved.
 *
 * Config shape (normalised):
 * {
 *   mode: 'all' | 'posts' | 'reputation' | 'any',
 *   showBar, showImages, autoInject, showOnProfile, hideGroupBadges, categoryModerators: boolean,
 *   ranks:   [{ key, names: { [lang]: string }, minPosts, minReputation, image, color }],
 *   special: [{ group, key, names, image, color, icon, showHidden }],
 * }
 */

/*
 * Threshold modes ("How ranks are earned" in the ACP):
 * - all:        every non-zero counted threshold must be met (default);
 * - posts:      only minPosts counts;
 * - reputation: only minReputation counts;
 * - any:        one met non-zero threshold is enough.
 * See qualifies() for the meaning of zero thresholds.
 */
const MODES = ['all', 'posts', 'reputation', 'any'];
const NAMESPACE = 'rank-badges';
/** Namespace of the ACP strings (languages/<lang>/admin/plugins/rank-badges.json). */
const ACP_NAMESPACE = 'admin/plugins/rank-badges';
// Upper bounds keep the stored config, the level bar and the per-page work small.
const MAX_RANKS = 30;
const MAX_SPECIAL = 20;
/** Thresholds are written with digits only, at most this many (up to 999 999 999). */
const MAX_THRESHOLD_DIGITS = 9;
/** Group names with a fixed place in the precedence order, see specialOrder(). */
const ADMIN_GROUP = 'administrators';
const MOD_GROUP = 'Global Moderators';

/** Default ladder; names come from the language files through the `key`. */
const DEFAULT_RANKS = [
	{ key: 'rank-1', minPosts: 0, minReputation: 0 },
	{ key: 'rank-2', minPosts: 5, minReputation: 0 },
	{ key: 'rank-3', minPosts: 25, minReputation: 5 },
	{ key: 'rank-4', minPosts: 75, minReputation: 20 },
	{ key: 'rank-5', minPosts: 200, minReputation: 50 },
	{ key: 'rank-6', minPosts: 500, minReputation: 150 },
];

/** Default group badges. */
const DEFAULT_SPECIAL = [
	{ group: ADMIN_GROUP, key: 'group-administrators', icon: 'fa-shield-halved' },
	{ group: MOD_GROUP, key: 'group-moderators', icon: 'fa-shield-halved' },
];

/**
 * Complete default configuration, as used on first run (nothing saved yet) and by
 * "Restore defaults" in the ACP.
 *
 * @returns {object} normalised config
 */
function defaults() {
	return normalize({});
}

/**
 * Threshold from a form value: a non-negative integer written with digits only. Anything else
 * ("1e3", "2.5", "-1", "0x10", " ", "") is rejected, so that a typo cannot silently become
 * another number (parseInt("1e3") is 1).
 *
 * @param {*} value string from the form or number from stored JSON; undefined/null mean 0
 * @returns {number|null} the integer, or null when the value is invalid
 */
function parseThreshold(value) {
	if (value === undefined || value === null) return 0;
	if (typeof value === 'number') {
		return Number.isInteger(value) && value >= 0 && String(value).length <= MAX_THRESHOLD_DIGITS ? value : null;
	}
	if (typeof value !== 'string') return null;
	const v = value.trim();
	return new RegExp(`^\\d{1,${MAX_THRESHOLD_DIGITS}}$`).test(v) ? parseInt(v, 10) : null;
}

/**
 * Non-negative integer for stored values; invalid values (only possible in settings written
 * before 1.1.0 or directly to the database) count as 0.
 *
 * @param {*} value
 * @returns {number}
 */
function toThreshold(value) {
	const n = parseThreshold(value);
	return n === null ? 0 : n;
}

/**
 * Boolean from a form value. NodeBB's settings module stores checkboxes as "on"/"off" strings;
 * an unset value (never saved) keeps the default.
 *
 * @param {*} value
 * @param {boolean} fallback used when the value is missing
 * @returns {boolean}
 */
function toBool(value, fallback) {
	if (value === undefined || value === null || value === '') return fallback;
	if (typeof value === 'boolean') return value;
	return value === 'on' || value === 'true' || value === 1 || value === '1';
}

/**
 * Single-line plain text: control characters replaced by spaces; zero-width and bidirectional
 * control characters (U+200B–U+200F, U+202A–U+202E, U+2066–U+2069, U+FEFF) removed, so a name
 * cannot reverse or hide the text next to it; trimmed and length-capped.
 * Not HTML-safe by itself; lib/render.js escapes it on output.
 *
 * @param {*} value
 * @param {number} [max=80] maximum length
 * @returns {string}
 */
function cleanText(value, max) {
	return String(value == null ? '' : value)
		.replace(/[\u0000-\u001f\u007f]/g, ' ')
		.replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
		.trim()
		.slice(0, max || 80);
}

/**
 * Only #rgb/#rrggbb colours or CSS custom properties, never arbitrary CSS. The value is put
 * into a style attribute by lib/render.js, so this whitelist is what prevents CSS injection
 * (e.g. "red;background:url(…)").
 *
 * @param {*} value
 * @returns {string} safe colour, or '' when rejected
 */
function cleanColor(value) {
	const v = String(value || '').trim();
	if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) return v.toLowerCase();
	if (/^var\(--[a-z0-9-]{1,40}\)$/i.test(v)) return v;
	return '';
}

/**
 * Relative paths on this forum or https URLs; nothing else (no javascript:, data:, plain
 * http, protocol-relative). Backslashes are rejected too, because browsers read "/\\host"
 * as "//host". Quotes, angle brackets, backticks and whitespace are rejected as well, and
 * lib/render.js still escapes the value when it writes the src attribute.
 *
 * @param {*} value
 * @returns {string} safe URL, or '' when rejected
 */
function cleanImage(value) {
	const v = String(value || '').trim();
	if (!v) return '';
	if (/^\/(?![/\\])[^\s"'<>`\\]*$/.test(v)) return v;
	if (/^https:\/\/[^\s"'<>`\\]+$/i.test(v)) return v;
	return '';
}

/**
 * Font Awesome class name such as "fa-shield-halved". Written unescaped into a class attribute
 * by lib/render.js, which is safe only because of this pattern.
 *
 * @param {*} value
 * @returns {string} icon class, or ''
 */
function cleanIcon(value) {
	const v = String(value || '').trim();
	return /^fa-[a-z0-9-]{1,40}$/.test(v) ? v : '';
}

/**
 * Translation key suffix (e.g. "rank-3" → [[rank-badges:rank-3]]). The pattern keeps it from
 * breaking out of the token or naming another namespace.
 *
 * @param {*} value
 * @returns {string} key, or ''
 */
function cleanKey(value) {
	const v = String(value || '').trim();
	return /^[a-z0-9-]{1,40}$/.test(v) ? v : '';
}

/** Name columns shown in the ACP when "Languages for rank names" is empty. */
const DEFAULT_NAME_LANGS = ['en-GB', 'pl'];

/** Language code as typed in the ACP: "pl", "en-GB", "zh_CN". */
const LANG_RE = /^[a-zA-Z]{2,3}([-_][a-zA-Z0-9]{2,8})?$/;

/**
 * Per-language names typed in the ACP. Language codes must look like "pl", "en-GB" or "zh_CN";
 * names are plain text (escaped on output) of at most 60 characters.
 *
 * @param {*} names object { [lang]: string }
 * @param {string[]} [allowed] when given, names in other languages are dropped
 * @returns {Object<string, string>}
 */
function cleanNames(names, allowed) {
	const out = {};
	if (!names || typeof names !== 'object') return out;
	Object.keys(names).slice(0, 40).forEach((lang) => {
		if (!LANG_RE.test(lang)) return;
		if (allowed && !allowed.includes(lang)) return;
		const text = cleanText(names[lang], 60);
		if (text) out[lang] = text;
	});
	return out;
}

/**
 * "Languages for rank names" field of the ACP: comma-separated codes.
 *
 * @param {*} value e.g. "en-GB, pl"
 * @returns {string[]} valid codes in the given order, without duplicates (may be empty)
 */
function parseLangList(value) {
	const out = [];
	String(value || '').split(',').map(s => s.trim()).forEach((code) => {
		if (LANG_RE.test(code) && !out.includes(code)) out.push(code);
	});
	return out;
}

/**
 * The rank and group tables are stored as JSON strings in hidden form fields.
 *
 * @param {*} value JSON string or array
 * @returns {Array|null} the list (possibly empty), or null when missing or not a JSON array
 */
function parseList(value) {
	if (Array.isArray(value)) return value;
	if (typeof value === 'string' && value.trim()) {
		try {
			const parsed = JSON.parse(value);
			return Array.isArray(parsed) ? parsed : null;
		} catch {
			return null;
		}
	}
	return null;
}

/**
 * @param {object} rank raw rank entry
 * @returns {{key: string, names: object, minPosts: number, minReputation: number, image: string, color: string}}
 */
function normalizeRank(rank) {
	return {
		key: cleanKey(rank.key),
		names: cleanNames(rank.names),
		minPosts: toThreshold(rank.minPosts),
		minReputation: toThreshold(rank.minReputation),
		image: cleanImage(rank.image),
		color: cleanColor(rank.color),
	};
}

/**
 * @param {object} entry raw group badge entry
 * @returns {{group: string, key: string, names: object, image: string, color: string, icon: string, showHidden: boolean}}
 *   `group` is plain text (a NodeBB group name may contain almost anything) and is escaped on output
 */
function normalizeSpecial(entry) {
	return {
		group: cleanText(entry.group, 120),
		key: cleanKey(entry.key),
		names: cleanNames(entry.names),
		image: cleanImage(entry.image),
		color: cleanColor(entry.color),
		icon: cleanIcon(entry.icon),
		showHidden: toBool(entry.showHidden, false),
	};
}

/**
 * Accepts raw settings (strings from meta.settings or objects) and returns a safe, complete config.
 *
 * The default tables are used only when a table was never saved (first run) or is not valid
 * JSON. A saved empty list is kept: no ranks, or no group badges. Group entries without a
 * group name are dropped.
 *
 * @param {object|null|undefined} raw
 * @returns {object} normalised config (shape at the top of this file)
 */
function normalize(raw) {
	raw = raw || {};
	const ranksIn = parseList(raw.ranks);
	const specialIn = parseList(raw.special);
	const ranks = (ranksIn || DEFAULT_RANKS).slice(0, MAX_RANKS).filter(r => r && typeof r === 'object').map(normalizeRank);
	const special = (specialIn || DEFAULT_SPECIAL).slice(0, MAX_SPECIAL)
		.filter(s => s && typeof s === 'object')
		.map(normalizeSpecial)
		.filter(s => s.group);

	return {
		mode: MODES.includes(raw.mode) ? raw.mode : 'all',
		showBar: toBool(raw.showBar, true),
		showImages: toBool(raw.showImages, true),
		autoInject: toBool(raw.autoInject, true),
		showOnProfile: toBool(raw.showOnProfile, true),
		hideGroupBadges: toBool(raw.hideGroupBadges, false),
		categoryModerators: toBool(raw.categoryModerators, true),
		// Ranks are kept in the admin's order; the level is the position in the list.
		ranks,
		special,
	};
}

/**
 * Mode actually used for evaluation: with reputation disabled in the ACP
 * (meta.config['reputation:disabled']) every mode counts posts only, so that posts and
 * profiles agree (NodeBB removes the reputation field from profile data in that case).
 *
 * @param {string} mode configured mode
 * @param {boolean} reputationDisabled
 * @returns {string} one of MODES
 */
function effectiveMode(mode, reputationDisabled) {
	if (reputationDisabled) return 'posts';
	return MODES.includes(mode) ? mode : 'all';
}

/**
 * Criteria counted in a mode.
 *
 * @param {string} mode
 * @returns {Array<'minPosts'|'minReputation'>}
 */
function countedFields(mode) {
	if (mode === 'posts') return ['minPosts'];
	if (mode === 'reputation') return ['minReputation'];
	return ['minPosts', 'minReputation'];
}

/**
 * Whether a user meets one rank's thresholds in the given mode.
 *
 * Zero thresholds:
 * - a zero threshold never grants a rank by itself; it only means "no requirement" for that
 *   criterion. The rank is reached through its non-zero counted thresholds: all of them in
 *   "all", "posts" and "reputation" modes, one of them in "any" mode;
 * - the first rank (level 1) is the starting rank: when all its counted thresholds are zero,
 *   every user has it, whatever their post count or reputation (also negative);
 * - any other rank whose counted thresholds are all zero cannot be reached (the ACP warns).
 * Without this rule a rank like { minPosts: 5, minReputation: 0 } would be free in
 * "reputation" mode and every new user would start at level 2.
 *
 * @param {{minPosts: number, minReputation: number}} rank normalised rank
 * @param {{postcount?: *, reputation?: *}} stats user fields as returned by NodeBB (may be strings)
 * @param {string} mode one of MODES; unknown values behave like "all"
 * @param {boolean} [isFirst] true for the first rank of the list
 * @returns {boolean}
 */
function qualifies(rank, stats, mode, isFirst) {
	stats = stats || {};
	const value = {
		minPosts: Math.max(0, parseInt(stats.postcount, 10) || 0),
		// Reputation can be negative.
		minReputation: parseInt(stats.reputation, 10) || 0,
	};
	const active = countedFields(MODES.includes(mode) ? mode : 'all').filter(f => rank[f] > 0);
	if (!active.length) return !!isFirst;
	const met = active.map(f => value[f] >= rank[f]);
	return mode === 'any' ? met.some(Boolean) : met.every(Boolean);
}

/**
 * Highest rank (1-based level) the user meets. Ranks are evaluated in list order, so an
 * admin can order them freely; the result is the last one that qualifies. 0 = no rank.
 *
 * @param {object} config normalised config
 * @param {object|null} stats { postcount, reputation }
 * @param {string} [mode] overrides config.mode (see effectiveMode)
 * @returns {number} level, 0 when no rank applies
 */
function computeLevel(config, stats, mode) {
	const m = mode || config.mode;
	let level = 0;
	config.ranks.forEach((rank, i) => {
		if (qualifies(rank, stats || {}, m, i === 0)) level = i + 1;
	});
	return level;
}

/**
 * 1..3 colour tier derived from the relative level (low / mid / high), so the colours scale
 * with ladders of any length.
 *
 * @param {number} level 1-based level
 * @param {number} total number of ranks
 * @returns {1|2|3}
 */
function tierFor(level, total) {
	if (!level || !total) return 1;
	return Math.min(3, Math.max(1, Math.ceil((level / total) * 3)));
}

/**
 * @param {string} lang e.g. "en-GB"
 * @returns {string} base language, e.g. "en"
 */
function baseLang(lang) {
	return String(lang || '').split(/[-_]/)[0].toLowerCase();
}

/**
 * Display name for a rank/special entry in the given language:
 * exact language → same base language (en-US ↔ en-GB) → translation key → first custom name
 * → fallback.
 * The returned value is either plain text (to be escaped) or a [[rank-badges:…]] token.
 *
 * @param {{key?: string, names?: object}} entry normalised rank or group entry
 * @param {string} lang requested language
 * @param {{text: string}|{token: string}} [fallback] used when the entry has no name at all
 * @returns {{text: string}|{token: string}}
 */
function resolveName(entry, lang, fallback) {
	const names = entry.names || {};
	if (names[lang]) return { text: names[lang] };
	const base = baseLang(lang);
	const sameBase = Object.keys(names).find(l => baseLang(l) === base);
	if (sameBase) return { text: names[sameBase] };
	if (entry.key) return { token: `[[${NAMESPACE}:${entry.key}]]` };
	const first = Object.keys(names)[0];
	if (first) return { text: names[first] };
	return fallback || { text: '' };
}

/**
 * Precedence of the group badges, independent of the order of the user's memberships:
 * 1. "administrators";
 * 2. "Global Moderators" (category moderators count as members when the option is on);
 * 3. every other group, in the order of the ACP list.
 *
 * @param {Array<{group: string}>} special normalised group entries
 * @returns {number[]} indices into `special`, highest precedence first
 */
function specialOrder(special) {
	const weight = s => (s.group === ADMIN_GROUP ? 0 : s.group === MOD_GROUP ? 1 : 2);
	return special.map((s, i) => i).sort((a, b) => weight(special[a]) - weight(special[b]) || a - b);
}

/**
 * Plain description of the badge for a user: group badge first (see specialOrder), then the
 * post/reputation rank.
 *
 * @param {object} config normalised config
 * @param {object|null} stats { postcount, reputation }
 * @param {Set<string>} [memberOf] configured group names the user belongs to and that may be shown
 * @param {{mode?: string}} [opts] mode override (see effectiveMode)
 * @returns {{special: boolean, index: number, level: number, total: number, tier: number}|null}
 *   index points into config.special or config.ranks; null when the user has no badge
 */
function describe(config, stats, memberOf, opts) {
	memberOf = memberOf || new Set();
	const total = config.ranks.length;
	const specialIndex = specialOrder(config.special).find(i => memberOf.has(config.special[i].group));
	if (specialIndex !== undefined) {
		return { special: true, index: specialIndex, level: 0, total, tier: 0 };
	}
	const level = computeLevel(config, stats, opts && opts.mode);
	if (!level) return null;
	return { special: false, index: level - 1, level, total, tier: tierFor(level, total) };
}

/**
 * Translation token in the ACP namespace.
 *
 * @param {string} key
 * @param {...(string|number)} args numbers only (no escaping needed)
 * @returns {string}
 */
function acpToken(key, ...args) {
	return `[[${ACP_NAMESPACE}:${[key].concat(args).join(', ')}]]`;
}

/**
 * Checks raw settings before they are saved (server: filter:settings.set; ACP: Save button)
 * and drops names in languages that are no longer listed in "Languages for rank names".
 *
 * Errors, as ACP translation tokens:
 * - a threshold that is not an integer written with digits;
 * - a rank without any name and without a translation key (it would show an empty badge);
 * - a group badge without a group name;
 * - a table that is not a JSON array, or too many entries.
 *
 * @param {object} raw settings as sent by the ACP form (strings)
 * @returns {{errors: string[], settings: object}} `settings` is a copy of `raw` with the
 *   cleaned tables (JSON strings) when there are no errors
 */
function validateSettings(raw) {
	raw = Object.assign({}, raw);
	const errors = [];
	// The ACP shows DEFAULT_NAME_LANGS when the field is empty; without the field at all (not
	// saved from the ACP form) nothing is dropped.
	const langs = parseLangList(raw.nameLangs);
	const allowed = raw.nameLangs === undefined ? null : (langs.length ? langs : DEFAULT_NAME_LANGS);

	const ranksIn = raw.ranks === undefined ? null : parseList(raw.ranks);
	const specialIn = raw.special === undefined ? null : parseList(raw.special);
	if (raw.ranks !== undefined && !ranksIn) errors.push(acpToken('error.invalid-list'));
	if (raw.special !== undefined && !specialIn) errors.push(acpToken('error.invalid-list'));
	if (ranksIn && ranksIn.length > MAX_RANKS) errors.push(acpToken('error.too-many-ranks', MAX_RANKS));
	if (specialIn && specialIn.length > MAX_SPECIAL) errors.push(acpToken('error.too-many-groups', MAX_SPECIAL));

	const trimNames = entry => Object.assign({}, entry, { names: cleanNames(entry.names, allowed) });

	if (ranksIn) {
		const cleaned = ranksIn.map((rank, i) => {
			const r = rank && typeof rank === 'object' ? trimNames(rank) : { names: {} };
			['minPosts', 'minReputation'].forEach((f) => {
				if (parseThreshold(r[f]) === null) errors.push(acpToken('error.threshold', i + 1));
			});
			if (!cleanKey(r.key) && !Object.keys(r.names).length) errors.push(acpToken('error.rank-name', i + 1));
			return r;
		});
		raw.ranks = JSON.stringify(cleaned);
	}
	if (specialIn) {
		const cleaned = specialIn.map((entry, i) => {
			const s = entry && typeof entry === 'object' ? trimNames(entry) : { names: {} };
			if (!cleanText(s.group, 120)) errors.push(acpToken('error.group-name', i + 1));
			return s;
		});
		raw.special = JSON.stringify(cleaned);
	}
	return { errors: Array.from(new Set(errors)), settings: raw };
}

/**
 * Non-blocking remarks about the ladder, shown in the ACP:
 * - "unreachable": a rank after the first whose counted thresholds are all zero (see qualifies);
 * - "order": a counted threshold lower than the one of the previous rank (evaluation goes by
 *   list position, so a more active user could get a lower-looking rank);
 * - "equal": same counted thresholds as the previous rank (the previous one is never shown).
 *
 * @param {Array<{minPosts: *, minReputation: *}>} list ranks (raw or normalised)
 * @param {string} mode mode used for evaluation
 * @returns {Array<{code: 'unreachable'|'order'|'equal', level: number}>} level is 1-based
 */
function ladderWarnings(list, mode) {
	const fields = countedFields(mode);
	const t = (rank, f) => toThreshold(rank && rank[f]);
	const out = [];
	(list || []).forEach((rank, i) => {
		if (i === 0) return;
		const prev = list[i - 1];
		if (fields.every(f => t(rank, f) === 0)) {
			out.push({ code: 'unreachable', level: i + 1 });
			return;
		}
		if (fields.some(f => t(rank, f) < t(prev, f))) out.push({ code: 'order', level: i + 1 });
		else if (fields.every(f => t(rank, f) === t(prev, f))) out.push({ code: 'equal', level: i + 1 });
	});
	return out;
}

module.exports = {
	NAMESPACE,
	ACP_NAMESPACE,
	MODES,
	MAX_RANKS,
	MAX_SPECIAL,
	ADMIN_GROUP,
	MOD_GROUP,
	DEFAULT_RANKS,
	DEFAULT_SPECIAL,
	DEFAULT_NAME_LANGS,
	defaults,
	normalize,
	parseThreshold,
	parseLangList,
	cleanText,
	cleanImage,
	cleanColor,
	effectiveMode,
	qualifies,
	computeLevel,
	tierFor,
	resolveName,
	specialOrder,
	describe,
	validateSettings,
	ladderWarnings,
};
