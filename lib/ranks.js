'use strict';

/*
 * Pure rank logic: settings validation, threshold evaluation and name resolution.
 * Used by library.js (server) and lib/render.js; no NodeBB imports, so it can be unit-tested
 * with node:test (test/ranks.test.js).
 *
 * Settings arrive from the ACP form as strings (meta.settings stores flat string values, the
 * rank and group tables as JSON). normalize() is the single place where they are validated:
 * everything downstream, including the HTML renderer, relies on its output shape.
 *
 * Config shape (normalised):
 * {
 *   mode: 'all' | 'posts' | 'reputation' | 'any',
 *   showBar, showImages, autoInject, showOnProfile, hideGroupBadges, categoryModerators: boolean,
 *   ranks:   [{ key, names: { [lang]: string }, minPosts, minReputation, image, color }],
 *   special: [{ group, key, names, image, color, icon }],
 * }
 */

/*
 * Threshold modes ("How ranks are earned" in the ACP):
 * - all:        both thresholds must be met (default);
 * - posts:      only minPosts counts;
 * - reputation: only minReputation counts;
 * - any:        either non-zero threshold is enough (see qualifies() for zero thresholds).
 */
const MODES = ['all', 'posts', 'reputation', 'any'];
const NAMESPACE = 'rank-badges';
// Upper bounds keep the stored config, the level bar and the per-page work small.
const MAX_RANKS = 30;
const MAX_SPECIAL = 20;

/** Default ladder; names come from the language files through the `key`. */
const DEFAULT_RANKS = [
	{ key: 'rank-1', minPosts: 0, minReputation: 0 },
	{ key: 'rank-2', minPosts: 5, minReputation: 0 },
	{ key: 'rank-3', minPosts: 25, minReputation: 5 },
	{ key: 'rank-4', minPosts: 75, minReputation: 20 },
	{ key: 'rank-5', minPosts: 200, minReputation: 50 },
	{ key: 'rank-6', minPosts: 500, minReputation: 150 },
];

/** Default group badges, in precedence order (administrators win over moderators). */
const DEFAULT_SPECIAL = [
	{ group: 'administrators', key: 'group-administrators', icon: 'fa-shield-halved' },
	{ group: 'Global Moderators', key: 'group-moderators', icon: 'fa-shield-halved' },
];

/**
 * Complete default configuration, as shown by "Restore defaults" in the ACP.
 *
 * @returns {object} normalised config
 */
function defaults() {
	return normalize({});
}

/**
 * Non-negative integer from a form value.
 *
 * @param {*} value
 * @param {number} fallback returned for anything that is not an integer >= 0
 * @returns {number}
 */
function toInt(value, fallback) {
	const n = parseInt(value, 10);
	return Number.isFinite(n) && n >= 0 ? n : fallback;
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
 * Single-line plain text: control characters replaced, trimmed, length-capped.
 * Not HTML-safe by itself; lib/render.js escapes it on output.
 *
 * @param {*} value
 * @param {number} [max=80] maximum length
 * @returns {string}
 */
function cleanText(value, max) {
	return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max || 80);
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

/**
 * Per-language names typed in the ACP. Language codes must look like "pl", "en-GB" or "zh_CN";
 * names are plain text (escaped on output) of at most 60 characters.
 *
 * @param {*} names object { [lang]: string }
 * @returns {Object<string, string>}
 */
function cleanNames(names) {
	const out = {};
	if (!names || typeof names !== 'object') return out;
	Object.keys(names).slice(0, 40).forEach((lang) => {
		if (!/^[a-zA-Z]{2,3}([-_][a-zA-Z0-9]{2,8})?$/.test(lang)) return;
		const text = cleanText(names[lang], 60);
		if (text) out[lang] = text;
	});
	return out;
}

/**
 * The rank and group tables are stored as JSON strings in hidden form fields.
 *
 * @param {*} value JSON string or array
 * @returns {Array|null} the list, or null when missing or invalid (caller uses the defaults)
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
		minPosts: toInt(rank.minPosts, 0),
		minReputation: toInt(rank.minReputation, 0),
		image: cleanImage(rank.image),
		color: cleanColor(rank.color),
	};
}

/**
 * @param {object} entry raw group badge entry
 * @returns {{group: string, key: string, names: object, image: string, color: string, icon: string}}
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
	};
}

/**
 * Accepts raw settings (strings from meta.settings or objects) and returns a safe, complete config.
 * Missing or unparsable tables fall back to the defaults; group entries without a group name
 * are dropped. An empty group list is kept (the admin may not want any group badges).
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
		ranks: ranks.length ? ranks : DEFAULT_RANKS.map(normalizeRank),
		special,
	};
}

/**
 * Whether a user meets one rank's thresholds in the given mode.
 *
 * A zero threshold means "no requirement". In "any" mode that matters: a rank with one zero and
 * one non-zero threshold is reached only through the non-zero one (otherwise every rank with
 * minReputation 0 would be free), and a rank with both at zero is always reached.
 *
 * @param {{minPosts: number, minReputation: number}} rank normalised rank
 * @param {{postcount?: *, reputation?: *}} stats user fields as returned by NodeBB (may be strings)
 * @param {string} mode one of MODES; unknown values behave like "all"
 * @returns {boolean}
 */
function qualifies(rank, stats, mode) {
	const posts = toInt(stats.postcount, 0);
	// Reputation can be negative; a zero threshold is always met (the starting rank).
	const rep = parseInt(stats.reputation, 10) || 0;
	const byPosts = rank.minPosts === 0 || posts >= rank.minPosts;
	const byRep = rank.minReputation === 0 || rep >= rank.minReputation;
	switch (mode) {
		case 'posts': return byPosts;
		case 'reputation': return byRep;
		case 'any': return (rank.minPosts === 0 && rank.minReputation === 0) ||
			(rank.minPosts > 0 && byPosts) || (rank.minReputation > 0 && byRep);
		default: return byPosts && byRep;
	}
}

/**
 * Highest rank (1-based level) the user meets. Ranks are evaluated in list order, so an
 * admin can order them freely; the result is the last one that qualifies. 0 = no rank.
 *
 * @param {object} config normalised config
 * @param {object|null} stats { postcount, reputation }
 * @returns {number} level, 0 when no rank applies
 */
function computeLevel(config, stats) {
	let level = 0;
	config.ranks.forEach((rank, i) => {
		if (qualifies(rank, stats || {}, config.mode)) level = i + 1;
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
 * exact language → same base language (en-US ↔ en-GB) → translation key → first custom name.
 * The returned string is either plain text (to be escaped) or a [[rank-badges:key]] token.
 *
 * @param {{key?: string, names?: object}} entry normalised rank or group entry
 * @param {string} lang requested language
 * @param {string} [fallbackText] last resort (the group name for group badges)
 * @returns {{text: string}|{token: string}}
 */
function resolveName(entry, lang, fallbackText) {
	const names = entry.names || {};
	if (names[lang]) return { text: names[lang] };
	const base = baseLang(lang);
	const sameBase = Object.keys(names).find(l => baseLang(l) === base);
	if (sameBase) return { text: names[sameBase] };
	if (entry.key) return { token: `[[${NAMESPACE}:${entry.key}]]` };
	const first = Object.keys(names)[0];
	if (first) return { text: names[first] };
	return { text: fallbackText || '' };
}

/**
 * Plain description of the badge for a user: special (group) badge first, then the
 * post/reputation rank.
 *
 * Precedence among groups follows the order of the ACP list, not the order of the user's
 * memberships: the first configured group the user belongs to wins. That is why
 * "administrators" is listed before "Global Moderators" by default.
 *
 * @param {object} config normalised config
 * @param {object|null} stats { postcount, reputation }
 * @param {Set<string>} [memberOf] configured group names the user belongs to
 * @returns {{special: boolean, index: number, level: number, total: number, tier: number}|null}
 *   index points into config.special or config.ranks; null when the user has no badge
 */
function describe(config, stats, memberOf) {
	memberOf = memberOf || new Set();
	const total = config.ranks.length;
	const specialIndex = config.special.findIndex(s => memberOf.has(s.group));
	if (specialIndex !== -1) {
		return { special: true, index: specialIndex, level: 0, total, tier: 0 };
	}
	const level = computeLevel(config, stats);
	if (!level) return null;
	return { special: false, index: level - 1, level, total, tier: tierFor(level, total) };
}

module.exports = {
	NAMESPACE,
	MODES,
	DEFAULT_RANKS,
	DEFAULT_SPECIAL,
	defaults,
	normalize,
	qualifies,
	computeLevel,
	tierFor,
	resolveName,
	describe,
	cleanImage,
	cleanColor,
};
