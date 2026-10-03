'use strict';

/*
 * nodebb-plugin-rank-badges: server entry point (declared as "library" in plugin.json).
 *
 * Wires the pure modules in lib/ (rank logic, badge renderer, language choice, LRU cache) into
 * NodeBB 4.x hooks:
 * - rank from post count and/or reputation (thresholds configured in the ACP);
 * - group badges (e.g. Administrator, Moderator) take precedence over the rank;
 * - one batch per page of posts: settings are cached in memory, group membership is
 *   checked once per group for all authors on the page (core caches it too);
 * - badges are rendered in the viewer's language (see "Language" below).
 *
 * Every exported method below is referenced by name from plugin.json.
 */

const fs = require('fs');
const path = require('path');
const { rateLimit } = require('express-rate-limit');

const nconf = require.main.require('nconf');
const winston = require.main.require('winston');
const meta = require.main.require('./src/meta');
const groups = require.main.require('./src/groups');
const user = require.main.require('./src/user');
const categories = require.main.require('./src/categories');
const privileges = require.main.require('./src/privileges');
const pubsub = require.main.require('./src/pubsub');
const plugins = require.main.require('./src/plugins');
const translator = require.main.require('./src/translator');
const routeHelpers = require.main.require('./src/routes/helpers');
const controllerHelpers = require.main.require('./src/controllers/helpers');

const ranks = require('./lib/ranks');
const render = require('./lib/render');
const LRU = require('./lib/lru');
const { pickLang, isLangCode } = require('./lib/lang');
const { BASE_OPTIONS: RATE_LIMIT, onPageLimit } = require('./lib/rate-limit');
const updateCheck = require('./lib/update-check');

/** Hash under which meta.settings stores the plugin configuration (also used by public/admin.js). */
const SETTINGS_KEY = 'rank-badges';

// Update notices on the ACP page (lib/update-check.js); public plugin, with a link to the release notes.
const updates = updateCheck.forNodeBB({
	id: 'nodebb-plugin-rank-badges',
	version: require('./package.json').version,
	isPrivate: false,
	settingsHash: `${SETTINGS_KEY}-update-check`,
});
/** Sub-folder of NodeBB's upload_path for badge images uploaded from the ACP. */
const UPLOAD_FOLDER = 'rank-badges';
/** How long "is this user a category moderator" answers are reused, in ms. */
const MOD_CACHE_TTL = 60 * 1000;
/** How long the existence and "hidden" flag of the configured groups are reused, in ms. */
const GROUP_META_TTL = 60 * 1000;
/** Folder of the optional presets; each preset is a sub-folder with preset.json. */
const PRESETS_DIR = path.join(__dirname, 'presets');

const plugin = module.exports;

// ---------------------------------------------------------------- settings cache

/*
 * Normalised configuration, kept in memory for the life of the process. Every page of posts
 * needs it, and meta.settings.get() would otherwise hit the database on each request.
 *
 * Invalidation has two paths because NodeBB may run several processes (cluster or several
 * hosts behind a load balancer):
 * - the local process gets the "action:settings.set" hook (plugin.onSettingsSet);
 * - the other processes get the "action:settings.set.<hash>" pubsub message that
 *   meta.settings.set() publishes (subscribed in plugin.init).
 * Both call invalidate(), which also drops the caches derived from the config.
 */
let cached = null;
/*
 * Bumped by invalidate(). Every cache below is written only when the generation is still the
 * one seen before the first await: a request that started with the old settings must not store
 * a result built from them after the settings were saved. Rendered badges also carry the
 * generation in their key.
 */
let generation = 0;

/**
 * Returns the normalised plugin configuration, loading it from the database on first use.
 *
 * @returns {Promise<object>} config in the shape documented in lib/ranks.js
 */
async function getConfig() {
	if (cached) return cached;
	const started = generation;
	const config = ranks.normalize(await meta.settings.get(SETTINGS_KEY));
	if (started === generation) cached = config;
	return config;
}

/*
 * Rendered and translated badges, one per (language, size, rank or group) combination. There
 * are only a handful of these per forum, so posts cost nothing beyond the group-membership
 * batch. LRU with a size cap: many distinct ?lang= values on the public ladder route evict only
 * the least recently used entries, not the badges in use.
 */
const htmlCache = new LRU(1000);

/*
 * Category moderators: user.getModeratedCids() walks all categories, so the answer is cached
 * per uid for MOD_CACHE_TTL. A moderator added or removed in the ACP is picked up after at most
 * that long (or at once when the plugin settings are saved).
 */
const modCache = new LRU(5000);

/*
 * Existence and "hidden" flag of the configured groups (Map name → {exists, hidden}), refreshed
 * every GROUP_META_TTL and on each settings change.
 */
let groupMeta = null;

/**
 * Drops the cached config and everything derived from it (rendered badges, moderator flags,
 * group flags). Called from the settings hook and from the pubsub message, see the note above.
 *
 * @returns {void}
 */
function invalidate() {
	generation += 1;
	cached = null;
	groupMeta = null;
	modCache.clear();
	htmlCache.clear();
}

/**
 * Whether the user moderates at least one category.
 *
 * @param {number|string} uid local user id
 * @returns {Promise<boolean>}
 */
async function isCategoryModerator(uid) {
	const hit = modCache.get(String(uid));
	if (hit && hit.expires > Date.now()) return hit.value;
	const started = generation;
	const cids = await user.getModeratedCids(uid);
	const value = Array.isArray(cids) && cids.length > 0;
	if (started === generation) modCache.set(String(uid), { value, expires: Date.now() + MOD_CACHE_TTL });
	return value;
}

/**
 * Existence and visibility of the groups named in the config.
 *
 * @param {object} config normalised config
 * @returns {Promise<Map<string, {exists: boolean, hidden: boolean}>>}
 */
async function getGroupMeta(config) {
	if (groupMeta && groupMeta.generation === generation && groupMeta.expires > Date.now()) return groupMeta.map;
	const started = generation;
	const names = [...new Set(config.special.map(s => s.group))];
	const [exists, fields] = names.length ?
		await Promise.all([groups.exists(names), groups.getGroupsFields(names, ['hidden'])]) :
		[[], []];
	const map = new Map(names.map((name, i) => [name, {
		exists: !!exists[i],
		hidden: !!(fields[i] && parseInt(fields[i].hidden, 10) === 1),
	}]));
	if (started === generation) groupMeta = { generation: started, expires: Date.now() + GROUP_META_TTL, map };
	return map;
}

/**
 * Whether a group badge may be shown at all: the group must exist (a badge for a deleted or
 * misspelt group is skipped rather than handed to whoever creates a group of that name later),
 * and hidden groups are skipped unless the entry has "show even if hidden" on.
 *
 * @param {object} entry normalised group entry
 * @param {Map<string, {exists: boolean, hidden: boolean}>} metaMap result of getGroupMeta()
 * @returns {boolean}
 */
function isDisplayable(entry, metaMap) {
	const m = metaMap.get(entry.group);
	return !!m && m.exists && (!m.hidden || entry.showHidden);
}

// ---------------------------------------------------------------- core logic

/**
 * True for a positive integer uid. Excludes guests (0), the system user (negative ids) and
 * remote ActivityPub users, whose ids are not numeric and who have no local post count.
 *
 * @param {*} uid
 * @returns {boolean}
 */
function isLocalUid(uid) {
	return /^\d+$/.test(String(uid)) && parseInt(uid, 10) > 0;
}

/**
 * Which displayable configured groups each uid belongs to.
 *
 * Batching: one groups.isMembers() call per group, for all uids of the page at once, instead
 * of one call per post author. With the default two groups that is two calls per page.
 *
 * Category moderators count as members of "Global Moderators" (when the option is on and that
 * entry exists, since it provides the badge). They are looked up only for users who are not
 * already in "administrators" or "Global Moderators", the two groups that rank above it; a
 * member of any other group is still checked, because the moderator badge wins over it
 * (see ranks.specialOrder).
 *
 * @param {object} config normalised config
 * @param {Array<number|string>} uids unique local uids
 * @param {Map} metaMap result of getGroupMeta()
 * @returns {Promise<Map<string, Set<string>>>} uid (as string) → set of group names
 */
async function getMemberships(config, uids, metaMap) {
	const result = new Map(uids.map(uid => [String(uid), new Set()]));
	const entries = config.special.filter(s => isDisplayable(s, metaMap));
	if (!uids.length || !entries.length) return result;

	const groupNames = [...new Set(entries.map(s => s.group))];
	const matrix = await Promise.all(groupNames.map(name => groups.isMembers(uids, name)));
	matrix.forEach((flags, g) => {
		flags.forEach((isMember, u) => {
			if (isMember) result.get(String(uids[u])).add(groupNames[g]);
		});
	});

	const modEntry = entries.find(s => s.group === ranks.MOD_GROUP);
	if (config.categoryModerators && modEntry) {
		const pending = uids.filter((uid) => {
			const set = result.get(String(uid));
			return !set.has(ranks.ADMIN_GROUP) && !set.has(ranks.MOD_GROUP);
		});
		const flags = await Promise.all(pending.map(isCategoryModerator));
		flags.forEach((isMod, i) => {
			if (isMod) result.get(String(pending[i])).add(modEntry.group);
		});
	}
	return result;
}

/**
 * Language of a user: their own setting, otherwise the forum default. Used where only a uid is
 * known (post hooks, profile hook); see viewerLang() for requests.
 *
 * @param {number|string} uid viewer uid (0 for guests)
 * @returns {Promise<string>} language code such as "en-GB"
 */
async function getLang(uid) {
	let userLang;
	if (isLocalUid(uid)) {
		const settings = await user.getSettings(uid);
		userLang = settings && settings.userLang;
	}
	return pickLang({ userLang, defaultLang: meta.config.defaultLang });
}

/**
 * Language of the viewer of a request: ?lang= (also set for guests from the browser language by
 * the core autoLocale middleware, on page, ajaxify and API routes) → the user's setting (taken
 * from res.locals.config on full page loads, from the database otherwise) → the forum default.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} [res]
 * @returns {Promise<string>}
 */
async function viewerLang(req, res) {
	const query = req && req.query && req.query.lang;
	if (isLangCode(query)) return query;
	const localConfig = res && res.locals && res.locals.config;
	if (localConfig && isLangCode(localConfig.userLang)) return localConfig.userLang;
	return getLang(req && req.uid);
}

/**
 * Builds (or takes from cache) the badge for one rank description, translated into `lang`.
 *
 * The key needs level, total and the hidden flag in addition to the index, because they are
 * part of the markup (level bar, aria-label, data-group). The returned object is a shallow copy,
 * so callers can attach it to template data without sharing state between requests.
 *
 * @param {object} config normalised config
 * @param {object|null} info result of ranks.describe(), plus `hidden` for group badges
 * @param {string} lang language code
 * @param {'sm'|'lg'} [size] "lg" on profile headers
 * @returns {Promise<object|null>} badge from render.localize()
 */
async function buildBadge(config, info, lang, size) {
	if (!info) return null;
	const started = generation;
	const key = `${started}|${lang}|${size || 'sm'}|${info.special ? 's' : 'r'}${info.index}|${info.level}|${info.total}|${info.hidden ? 1 : 0}`;
	let badge = htmlCache.get(key);
	if (!badge) {
		const built = render.build(config, info, { lang, relativePath: nconf.get('relative_path') || '', size });
		if (!built) return null;
		badge = await render.localize(built, lang, (str, l) => translator.translate(str, l));
		if (started === generation) htmlCache.set(key, badge);
	}
	const copy = Object.assign({}, badge);
	// `view` (badge as data, lib/render.js) is sent only by the ladder route, so it stays out of
	// post and profile data.
	delete copy.view;
	Object.defineProperty(copy, 'view', { value: badge.view, enumerable: false });
	// Non-enumerable, so they never end up in the JSON sent to the browser; relocalize() uses
	// them to re-render the same badge in another language.
	Object.defineProperty(copy, '_info', { value: info, enumerable: false });
	Object.defineProperty(copy, '_size', { value: size, enumerable: false });
	Object.defineProperty(copy, '_lang', { value: lang, enumerable: false });
	return copy;
}

/**
 * Lets other plugins supply a rank level for users (e.g. a combined score from another system).
 * Hook: filter:rank-badges.level, called with `{ uids, users, levels }`; a listener sets
 * `levels[uid]` to an integer (1 = lowest rank, clamped to the ladder). A throwing listener
 * leaves the post/reputation ranks untouched.
 *
 * @param {Array<object|null>} users
 * @param {Array<number|string>} uids local uids of `users`
 * @returns {Promise<Object<string, number>>} uid → level
 */
async function levelOverrides(users, uids) {
	if (!uids.length) return {};
	try {
		const out = await plugins.hooks.fire('filter:rank-badges.level', { uids, users, levels: {} });
		const levels = (out && out.levels) || {};
		return Object.fromEntries(Object.entries(levels).filter(([, v]) => Number.isInteger(v) && v >= 1));
	} catch (err) {
		winston.warn(`[rank-badges] filter:rank-badges.level failed: ${err.message}`);
		return {};
	}
}

/**
 * Badge data for a list of user objects. Group memberships are resolved in one batch for the
 * whole list (see getMemberships).
 *
 * With reputation disabled in the ACP every mode counts posts only (ranks.effectiveMode), so
 * posts and profiles show the same rank.
 *
 * @param {Array<{uid: number|string, postcount?: number|string, reputation?: number|string}|null>} users
 * @param {string} lang language code
 * @param {'sm'|'lg'} [size]
 * @returns {Promise<Array<object|null>>} array aligned with `users`, null where no badge applies
 */
async function badgesFor(users, lang, size) {
	const config = await getConfig();
	const metaMap = await getGroupMeta(config);
	const uids = [...new Set(users.filter(u => u && isLocalUid(u.uid)).map(u => u.uid))];
	const memberships = await getMemberships(config, uids, metaMap);
	const mode = ranks.effectiveMode(config.mode, !!meta.config['reputation:disabled']);
	const levels = await levelOverrides(users, uids);
	return Promise.all(users.map((u) => {
		if (!u || !isLocalUid(u.uid)) return null;
		const info = ranks.describe(config, u, memberships.get(String(u.uid)), { mode, level: levels[String(u.uid)] });
		if (info && info.special) info.hidden = metaMap.get(config.special[info.index].group).hidden;
		return buildBadge(config, info, lang, size);
	}));
}

/**
 * Same badge in another language.
 *
 * @param {object} config normalised config
 * @param {object} badge badge returned by buildBadge()
 * @param {string} lang target language code
 * @returns {Promise<object>} the re-rendered badge, or the original one if it cannot be rebuilt
 */
async function relocalize(config, badge, lang) {
	if (!badge || !badge._info || badge._lang === lang) return badge;
	return (await buildBadge(config, badge._info, lang, badge._size)) || badge;
}

/**
 * Puts a user's badge (and the matching custom_profile_info entry) into `lang`. The entry is
 * matched by the rankBadge marker and its previous HTML, so that only our own entry is replaced.
 * The same user object is shared by all posts of one author, hence the language check first.
 *
 * @param {object} config normalised config
 * @param {object} u user object with rankBadge
 * @param {string} lang
 * @returns {Promise<void>}
 */
async function relocalizeUser(config, u, lang) {
	if (!u || !u.rankBadge || u.rankBadge._lang === lang) return;
	const old = u.rankBadge.html;
	u.rankBadge = await relocalize(config, u.rankBadge, lang);
	if (Array.isArray(u.custom_profile_info)) {
		u.custom_profile_info.forEach((c) => {
			if (c && c.rankBadge && c.content === old) c.content = u.rankBadge.html;
		});
	}
}

/**
 * @param {object} config normalised config
 * @param {Array<object>} posts posts with a `user` object
 * @param {string} lang
 * @returns {Promise<void>}
 */
async function relocalizePosts(config, posts, lang) {
	const usersOnPage = new Set(posts.map(p => p && p.user).filter(Boolean));
	await Promise.all([...usersOnPage].map(u => relocalizeUser(config, u, lang)));
}

/**
 * Public helper for other plugins and themes, e.g. a user-card or "ranks" page plugin:
 * `require.main.require('nodebb-plugin-rank-badges').getBadges(users, { lang: 'pl' })`.
 * Not bound to a hook.
 *
 * @param {Array<object>} users user objects with uid, postcount and reputation
 * @param {{lang?: string, size?: 'sm'|'lg'}} [opts]
 * @returns {Promise<Array<object|null>>} badges aligned with `users`
 */
plugin.getBadges = async function (users, opts) {
	opts = opts || {};
	return badgesFor(users, pickLang({ query: opts.lang, defaultLang: meta.config.defaultLang }), opts.size);
};

/**
 * Translations from the plugin's own language files, shown as placeholders in the ACP so the
 * admin can see what an empty name field falls back to. Read on each ACP page view; the files
 * are small.
 *
 * @returns {Object<string, Object<string, string>>} translation key → { language → text }
 */
function readDefaultNames() {
	const out = {};
	const dir = path.join(__dirname, 'languages');
	try {
		fs.readdirSync(dir).forEach((lang) => {
			const file = path.join(dir, lang, 'rank-badges.json');
			if (!fs.existsSync(file)) return;
			const data = JSON.parse(fs.readFileSync(file, 'utf8'));
			Object.keys(data).forEach((key) => {
				out[key] = out[key] || {};
				out[key][lang] = data[key];
			});
		});
	} catch (err) {
		winston.warn(`[rank-badges] Cannot read language files: ${err.message}`);
	}
	return out;
}

/**
 * Presets available on this installation: every sub-folder of presets/ whose name matches
 * [a-z0-9-] and that contains a preset.json. The folder is optional (the npm package ships only
 * presets/README.md).
 *
 * @returns {Array<{id: string}>}
 */
function listPresets() {
	try {
		return fs.readdirSync(PRESETS_DIR, { withFileTypes: true })
			.filter(d => d.isDirectory() && /^[a-z0-9-]{1,40}$/.test(d.name) && fs.existsSync(path.join(PRESETS_DIR, d.name, 'preset.json')))
			.map(d => ({ id: d.name }))
			.sort((a, b) => a.id.localeCompare(b.id));
	} catch {
		return [];
	}
}

/**
 * Groups that exist on the forum, for the ACP warnings (missing group, hidden group).
 *
 * @returns {Promise<Array<{name: string, hidden: boolean}>>}
 */
async function listGroups() {
	try {
		const data = await groups.getNonPrivilegeGroups('groups:createtime', 0, -1, { ephemeral: false });
		return data.map(g => ({ name: g.name, hidden: parseInt(g.hidden, 10) === 1 }));
	} catch (err) {
		winston.warn(`[rank-badges] Cannot list groups: ${err.message}`);
		return [];
	}
}

// ---------------------------------------------------------------- hooks

/*
 * Request limits per user (guests: per IP address) per minute, with express-rate-limit
 * (lib/rate-limit.js). Generous for normal use; they only stop scripted floods.
 */
const limits = {
	adminPage: rateLimit({ ...RATE_LIMIT, limit: 60, handler: onPageLimit }),
	api: rateLimit({
		...RATE_LIMIT,
		limit: 300,
		handler: (req, res) => controllerHelpers.formatApiResponse(429, res),
	}),
};

/**
 * Registers the ACP page, creates the upload folder and subscribes to settings changes made
 * in other NodeBB processes.
 *
 * Hook: static:app.load
 *
 * @param {{router: import('express').Router}} params
 * @returns {Promise<void>}
 */
plugin.init = async function ({ router }) {
	// setupAdminPageRoute adds NodeBB's admin middleware, so only administrators reach this page.
	routeHelpers.setupAdminPageRoute(router, '/admin/plugins/rank-badges', [limits.adminPage], async (req, res) => {
		res.render('admin/plugins/rank-badges', {
			title: '[[admin/plugins/rank-badges:title]]',
			defaults: ranks.defaults(),
			defaultNames: readDefaultNames(),
			defaultNameLangs: ranks.DEFAULT_NAME_LANGS,
			presets: listPresets(),
			groupList: await listGroups(),
			reputationDisabled: !!meta.config['reputation:disabled'],
			...(await updates.templateData()),
		});
	});

	// Badge images uploaded from the ACP go to <upload_path>/<folder>; NodeBB refuses folders
	// that do not exist, so make sure ours does.
	try {
		await fs.promises.mkdir(path.join(nconf.get('upload_path'), UPLOAD_FOLDER), { recursive: true });
	} catch (err) {
		winston.warn(`[rank-badges] Cannot create upload folder: ${err.message}`);
	}

	pubsub.on(`action:settings.set.${SETTINGS_KEY}`, invalidate);
	updates.start();
};

/**
 * Read-only endpoint with the configured badges, at
 * GET /api/v3/plugins/rank-badges/ladder[?lang=xx], used by public/client.js (badges of posts
 * that arrive over the websocket), by the ACP preview, and available to a "ranks" page or a
 * user-card plugin.
 *
 * Returns 403 when the viewer cannot read any category (e.g. a forum closed to guests), so the
 * ladder is not more public than the posts that show it. Group badges are listed without the
 * group name, and only those that can appear on posts (existing, not hidden unless allowed).
 *
 * Hook: static:api.routes
 *
 * @param {{router: import('express').Router}} params
 * @returns {Promise<void>}
 */
plugin.addApiRoutes = async function ({ router }) {
	routeHelpers.setupApiRoute(router, 'get', '/rank-badges/ladder', [limits.api], async (req, res) => {
		const cids = await categories.getAllCidsFromSet('categories:cid');
		const readable = await privileges.categories.filterCids('topics:read', cids.filter(cid => parseInt(cid, 10) > 0), req.uid);
		if (!readable.length) return controllerHelpers.formatApiResponse(403, res);

		const config = await getConfig();
		const metaMap = await getGroupMeta(config);
		// autoLocale has already replaced an unknown ?lang= with the forum default.
		const lang = await viewerLang(req);
		const total = config.ranks.length;
		const ladder = await Promise.all(config.ranks.map(async (rank, i) => {
			const info = { special: false, index: i, level: i + 1, total, tier: ranks.tierFor(i + 1, total) };
			const badge = await buildBadge(config, info, lang, 'sm');
			// `name` is HTML (admin-typed names are escaped when rendered), like `html`.
			return { id: `r${i}`, level: i + 1, minPosts: rank.minPosts, minReputation: rank.minReputation, name: badge.name, html: badge.html, view: badge.view };
		}));
		const groupBadges = [];
		for (const i of ranks.specialOrder(config.special)) {
			const entry = config.special[i];
			if (!isDisplayable(entry, metaMap)) continue;
			const info = { special: true, index: i, level: 0, total, tier: 0, hidden: metaMap.get(entry.group).hidden };
			const badge = await buildBadge(config, info, lang, 'sm');
			groupBadges.push({ id: `s${i}`, name: badge.name, html: badge.html, view: badge.view });
		}
		const mode = ranks.effectiveMode(config.mode, !!meta.config['reputation:disabled']);
		controllerHelpers.formatApiResponse(200, res, { mode, lang, ladder, groups: groupBadges });
	});
};

/**
 * Validates the plugin settings before they are stored, so that a bad table is refused with an
 * error shown in the ACP instead of being saved: non-integer thresholds ("1e3", "2.5", "-1"),
 * ranks without a name, group badges without a group. Names in languages removed from
 * "Languages for rank names" are dropped. The ACP runs the same checks before sending.
 *
 * Hook: filter:settings.set
 *
 * @param {{plugin: string, settings: object, quiet: boolean}} data
 * @returns {Promise<object>} the same data, with cleaned settings
 */
plugin.onSettingsSave = async function (data) {
	if (!data || data.plugin !== SETTINGS_KEY) return data;
	const { errors, settings } = ranks.validateSettings(data.settings);
	if (errors.length) throw new Error(errors[0]);
	data.settings = settings;
	return data;
};

/**
 * Drops the caches when this plugin's settings are saved in this process
 * (other processes are notified through pubsub, see plugin.init).
 *
 * Hook: action:settings.set
 *
 * @param {{plugin: string}} data settings hash that was saved
 * @returns {Promise<void>}
 */
plugin.onSettingsSet = async function ({ plugin: hash }) {
	if (hash === SETTINGS_KEY) invalidate();
};

/**
 * Adds "Rank badges" to the ACP Plugins menu.
 *
 * Hook: filter:admin.header.build
 *
 * @param {{plugins: Array<object>}} header
 * @returns {Promise<object>} the same header object
 */
plugin.addAdminNavigation = async function (header) {
	header.plugins.push({ route: '/plugins/rank-badges', icon: 'fa-ranking-star', name: '[[admin/plugins/rank-badges:title]]' });
	return header;
};

/**
 * Attaches `rankBadge` to post authors: topic pages, infinite scroll, replies and new posts
 * (not search results or profile post lists, which use post summaries without this hook).
 * One batch per call. With autoInject on, the badge HTML is also appended to
 * `custom_profile_info`, which Harmony and Persona print next to the author name; the
 * `rankBadge: true` marker lets themes and relocalizeUser() recognise the entry.
 *
 * NodeBB 4 fires this hook with `{ users }` only, without the viewer, so the badges are built in
 * the forum default language here and put into the viewer's language by onAddPostData and
 * onRender; posts pushed over the websocket are fixed by public/client.js.
 *
 * Hook: filter:posts.getUserInfoForPosts
 *
 * @param {{users: Array<object>}} hookData users of the posts
 * @returns {Promise<object>} the same hookData, with users[i].rankBadge set
 */
plugin.onGetUserInfoForPosts = async function (hookData) {
	const users = hookData.users || [];
	if (!users.length) return hookData;
	const config = await getConfig();
	const lang = await getLang(hookData.uid);
	const badges = await badgesFor(users, lang, 'sm');
	users.forEach((u, i) => {
		if (!u) return;
		u.rankBadge = badges[i];
		if (!badges[i]) return;
		// Avoid showing the group twice (core group title badge + our group badge).
		if (config.hideGroupBadges && badges[i].special) u.selectedGroups = [];
		if (config.autoInject) {
			u.custom_profile_info = Array.isArray(u.custom_profile_info) ? u.custom_profile_info : [];
			u.custom_profile_info.push({ content: badges[i].html, rankBadge: true });
		}
	});
	return hookData;
};

/**
 * Puts post authors' badges into the viewer's language. This hook knows the viewer uid, and it
 * covers every path that adds post data: topic pages and their /api twins (ajaxify), infinite
 * scroll (socket topics.loadMore) and API v3 routes. Guests get their language from the request
 * in onRender, or from public/client.js where there is no request (websocket).
 *
 * Hook: filter:topics.addPostData
 *
 * @param {{posts: Array<object>, uid: number}} hookData
 * @returns {Promise<object>} the same hookData
 */
plugin.onAddPostData = async function (hookData) {
	if (!hookData || !Array.isArray(hookData.posts) || !hookData.posts.length) return hookData;
	if (!hookData.posts.some(p => p && p.user && p.user.rankBadge)) return hookData;
	const config = await getConfig();
	await relocalizePosts(config, hookData.posts, await getLang(hookData.uid));
	return hookData;
};

/**
 * Attaches a large badge to the profile owner's data on account pages (profile header).
 * public/client.js moves it into [component="user/badges"].
 *
 * Hook: filter:helpers.getUserDataByUserSlug
 *
 * @param {{userData: object, callerUID: number}} hookData
 * @returns {Promise<object>} the same hookData, with userData.rankBadge set
 */
plugin.onAccountData = async function (hookData) {
	const config = await getConfig();
	const { userData } = hookData;
	if (!config.showOnProfile || !userData || !isLocalUid(userData.uid)) return hookData;
	const lang = await getLang(hookData.callerUID);
	// NodeBB removes `reputation` from profile data when reputation is disabled; badgesFor()
	// then counts posts only, as it does for posts.
	const [badge] = await badgesFor([userData], lang, 'lg');
	userData.rankBadge = badge;
	return hookData;
};

/**
 * Last pass before render or JSON, on full page loads and on the /api routes used by ajaxify:
 * badges in the language of the request (?lang=, browser language of guests, user setting;
 * see viewerLang). Only the posts list and the account page carry badges, so only those are
 * fixed.
 *
 * Hook: filter:middleware.render (priority 20)
 *
 * @param {{req: import('express').Request, res: import('express').Response, templateData: object}} hookData
 * @returns {Promise<object>} the same hookData
 */
plugin.onRender = async function (hookData) {
	const { req, res, templateData } = hookData;
	if (!templateData) return hookData;
	const hasPosts = Array.isArray(templateData.posts) && templateData.posts.some(p => p && p.user && p.user.rankBadge);
	if (!hasPosts && !templateData.rankBadge) return hookData;
	const lang = await viewerLang(req, res);
	const config = await getConfig();
	if (hasPosts) await relocalizePosts(config, templateData.posts, lang);
	if (templateData.rankBadge) await relocalizeUser(config, templateData, lang);
	return hookData;
};

/** Internal functions exposed for tests only; not a public API. */
plugin._test = { getConfig, invalidate, viewerLang };
