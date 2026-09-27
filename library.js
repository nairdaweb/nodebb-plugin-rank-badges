'use strict';

/*
 * nodebb-plugin-rank-badges: server entry point (declared as "library" in plugin.json).
 *
 * Wires the pure rank logic (lib/ranks.js) and the badge renderer (lib/render.js) into
 * NodeBB 4.x hooks:
 * - rank from post count and/or reputation (thresholds configured in the ACP);
 * - group badges (e.g. Administrator, Moderator) take precedence over the rank;
 * - one batch per page of posts: settings are cached in memory, group membership is
 *   checked once per group for all authors on the page (core caches it too).
 *
 * Every exported method below is referenced by name from plugin.json.
 */

const fs = require('fs');
const path = require('path');

const nconf = require.main.require('nconf');
const winston = require.main.require('winston');
const meta = require.main.require('./src/meta');
const groups = require.main.require('./src/groups');
const user = require.main.require('./src/user');
const pubsub = require.main.require('./src/pubsub');
const translator = require.main.require('./src/translator');
const routeHelpers = require.main.require('./src/routes/helpers');
const controllerHelpers = require.main.require('./src/controllers/helpers');

const ranks = require('./lib/ranks');
const render = require('./lib/render');

/** Hash under which meta.settings stores the plugin configuration (also used by public/admin.js). */
const SETTINGS_KEY = 'rank-badges';
/** Sub-folder of NodeBB's upload_path for badge images uploaded from the ACP. */
const UPLOAD_FOLDER = 'rank-badges';
/** How long "is this user a category moderator" answers are reused, in ms. */
const MOD_CACHE_TTL = 60 * 1000;

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
// Bumped by invalidate(); a load that started before an invalidation must not repopulate
// the cache with the settings it read, because they may already be stale.
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

/**
 * Drops the cached config and everything derived from it (rendered badges, moderator flags).
 * Called from the settings hook and from the pubsub message, see the note above.
 *
 * @returns {void}
 */
function invalidate() {
	generation += 1;
	cached = null;
	modCache.clear();
	htmlCache.clear();
}

/*
 * Category moderators: user.getModeratedCids() walks all categories, so the answer is cached
 * per uid for MOD_CACHE_TTL. A moderator added or removed in the ACP is picked up after at most
 * that long (or at once when the plugin settings are saved). The size cap keeps memory bounded
 * on large forums; clearing everything is cheap compared with an LRU and good enough here.
 */
const modCache = new Map();

/**
 * Whether the user moderates at least one category.
 *
 * @param {number|string} uid local user id
 * @returns {Promise<boolean>}
 */
async function isCategoryModerator(uid) {
	const hit = modCache.get(uid);
	if (hit && hit.expires > Date.now()) return hit.value;
	const cids = await user.getModeratedCids(uid);
	const value = Array.isArray(cids) && cids.length > 0;
	if (modCache.size > 5000) modCache.clear();
	modCache.set(uid, { value, expires: Date.now() + MOD_CACHE_TTL });
	return value;
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
 * Which configured special groups each uid belongs to.
 *
 * Batching: one groups.isMembers() call per configured group, for all uids of the page at once,
 * instead of one call per post author. With the default two groups that is two calls per page.
 *
 * Category moderators are only looked up for users that matched no group, because a group badge
 * already wins and the lookup is the expensive part.
 *
 * @param {object} config normalised config
 * @param {Array<number|string>} uids unique local uids
 * @returns {Promise<Map<string, Set<string>>>} uid (as string) → set of group names
 */
async function getMemberships(config, uids) {
	const result = new Map(uids.map(uid => [String(uid), new Set()]));
	if (!uids.length || !config.special.length) return result;

	const groupNames = config.special.map(s => s.group);
	const matrix = await Promise.all(groupNames.map(name => groups.isMembers(uids, name)));
	matrix.forEach((flags, g) => {
		flags.forEach((isMember, u) => {
			if (isMember) result.get(String(uids[u])).add(groupNames[g]);
		});
	});

	// Category moderators are treated as members of "Global Moderators", but only when that
	// entry exists in the list (it provides the badge name, image and colour).
	const modEntry = config.special.find(s => s.group === 'Global Moderators');
	if (config.categoryModerators && modEntry) {
		const pending = uids.filter(uid => !result.get(String(uid)).size);
		const flags = await Promise.all(pending.map(isCategoryModerator));
		flags.forEach((isMod, i) => {
			if (isMod) result.get(String(pending[i])).add(modEntry.group);
		});
	}
	return result;
}

/**
 * Language for badge names: the user's own setting, otherwise the forum default.
 * Guests whose language comes from the browser or ?lang= are handled later in plugin.onRender.
 *
 * @param {number|string} uid viewer uid (0 for guests)
 * @returns {Promise<string>} language code such as "en-GB"
 */
async function getLang(uid) {
	if (isLocalUid(uid)) {
		const settings = await user.getSettings(uid);
		if (settings && settings.userLang) return settings.userLang;
	}
	return meta.config.defaultLang || 'en-GB';
}

/*
 * Rendered and translated badge for one (language, size, rank) combination. There are only
 * a handful of these per forum (ranks × sizes × languages in use), so they are cached until the
 * settings change: posts cost nothing beyond the group-membership batch. The size cap only
 * guards against unbounded growth from many distinct ?lang= values on the public ladder route.
 */
const htmlCache = new Map();

/**
 * Builds (or takes from cache) the badge for one rank description.
 *
 * The key needs level and total in addition to the index, because they are part of the markup
 * (level bar, aria-label). The returned object is a shallow copy, so callers can attach it to
 * template data without sharing state between requests.
 *
 * @param {object} config normalised config
 * @param {object|null} info result of ranks.describe()
 * @param {string} lang language code
 * @param {'sm'|'lg'} [size] "lg" on profile headers
 * @returns {Promise<object|null>} badge from render.build(), with translated html and name
 */
async function buildBadge(config, info, lang, size) {
	if (!info) return null;
	const key = `${lang}|${size || 'sm'}|${info.special ? 's' : 'r'}${info.index}|${info.level}|${info.total}`;
	let cachedBadge = htmlCache.get(key);
	if (!cachedBadge) {
		const badge = render.build(config, info, { lang, relativePath: nconf.get('relative_path') || '', size });
		if (!badge) return null;
		// Default names and aria labels are [[rank-badges:…]] tokens; NodeBB 4 translates only
		// template strings, so we translate here, once per language. Admin-typed names reach
		// this point already HTML-escaped with "[" and "]" encoded (lib/render.js), so the
		// translator cannot be tricked into expanding a token hidden in a name.
		badge.html = await translator.translate(badge.html, lang);
		badge.name = await translator.translate(badge.name, lang);
		if (htmlCache.size > 500) htmlCache.clear();
		htmlCache.set(key, badge);
		cachedBadge = badge;
	}
	const copy = Object.assign({}, cachedBadge);
	// Non-enumerable, so it never ends up in the JSON sent to the browser; plugin.onRender uses
	// it to re-render the same badge in another language.
	Object.defineProperty(copy, '_info', { value: info, enumerable: false });
	Object.defineProperty(copy, '_size', { value: size, enumerable: false });
	return copy;
}

/**
 * Badge data for a list of user objects. Group memberships are resolved in one batch for the
 * whole list (see getMemberships).
 *
 * @param {Array<{uid: number|string, postcount?: number|string, reputation?: number|string}|null>} users
 * @param {string} lang language code
 * @param {'sm'|'lg'} [size]
 * @returns {Promise<Array<object|null>>} array aligned with `users`, null where no badge applies
 */
async function badgesFor(users, lang, size) {
	const config = await getConfig();
	const uids = [...new Set(users.filter(u => u && isLocalUid(u.uid)).map(u => u.uid))];
	const memberships = await getMemberships(config, uids);
	return Promise.all(users.map((u) => {
		if (!u || !isLocalUid(u.uid)) return null;
		return buildBadge(config, ranks.describe(config, u, memberships.get(String(u.uid))), lang, size);
	}));
}

/**
 * Same badge in another language (guests with auto-detected language, ?lang=).
 *
 * @param {object} config normalised config
 * @param {object} badge badge returned by buildBadge()
 * @param {string} lang target language code
 * @returns {Promise<object>} the re-rendered badge, or the original one if it cannot be rebuilt
 */
async function relocalize(config, badge, lang) {
	if (!badge || !badge._info) return badge;
	return (await buildBadge(config, badge._info, lang, badge._size)) || badge;
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
	return badgesFor(users, opts.lang || meta.config.defaultLang || 'en-GB', opts.size);
};

/**
 * Names from the plugin's own language files, shown as placeholders in the ACP so the admin can
 * see what an empty name field falls back to. Read on each ACP page view; the files are small.
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

// ---------------------------------------------------------------- hooks

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
	routeHelpers.setupAdminPageRoute(router, '/admin/plugins/rank-badges', [], (req, res) => {
		res.render('admin/plugins/rank-badges', {
			title: 'Rank badges',
			defaults: ranks.defaults(),
			defaultNames: readDefaultNames(),
			// The preset directory is optional (it is not shipped in the npm package); the
			// "Load preset" button is shown only when it exists. The id is a fixed server-side
			// string, never taken from the request.
			presets: [{ id: 'wirelab', available: fs.existsSync(path.join(__dirname, 'presets/wirelab/preset.json')) }],
		});
	});

	// The ACP uploader stores files in <upload_path>/<folder>; NodeBB refuses folders that do
	// not exist, so make sure ours does.
	try {
		await fs.promises.mkdir(path.join(nconf.get('upload_path'), UPLOAD_FOLDER), { recursive: true });
	} catch (err) {
		winston.warn(`[rank-badges] Cannot create upload folder: ${err.message}`);
	}

	pubsub.on(`action:settings.set.${SETTINGS_KEY}`, invalidate);
};

/**
 * Public, read-only endpoint with the configured ladder, at
 * GET /api/v3/plugins/rank-badges/ladder[?lang=xx] (for a "ranks" page or a user-card plugin).
 * No middleware on purpose: the thresholds and names are shown on every post anyway.
 *
 * Hook: static:api.routes
 *
 * @param {{router: import('express').Router}} params
 * @returns {Promise<void>}
 */
plugin.addApiRoutes = async function ({ router }) {
	routeHelpers.setupApiRoute(router, 'get', '/rank-badges/ladder', [], async (req, res) => {
		const config = await getConfig();
		// ?lang is restricted to language-code characters (no dots or slashes), so it cannot
		// point the translator at another file; anything else falls back to the viewer's language.
		const lang = typeof req.query.lang === 'string' && /^[a-zA-Z_-]{2,10}$/.test(req.query.lang) ? req.query.lang : await getLang(req.uid);
		const total = config.ranks.length;
		const ladder = await Promise.all(config.ranks.map(async (rank, i) => {
			const info = { special: false, index: i, level: i + 1, total, tier: ranks.tierFor(i + 1, total) };
			const badge = await buildBadge(config, info, lang, 'sm');
			// `name` is HTML (admin-typed names are escaped), like `html`.
			return { level: i + 1, minPosts: rank.minPosts, minReputation: rank.minReputation, name: badge.name, html: badge.html };
		}));
		controllerHelpers.formatApiResponse(200, res, { mode: config.mode, ladder });
	});
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
	header.plugins.push({ route: '/plugins/rank-badges', icon: 'fa-ranking-star', name: 'Rank badges' });
	return header;
};

/**
 * Attaches `rankBadge` to post authors (topics, replies, search results): one batch per page.
 * With autoInject on, the badge HTML is also appended to `custom_profile_info`, which Harmony and
 * Persona print next to the author name; the `rankBadge: true` marker lets themes and
 * plugin.onRender recognise the entry.
 *
 * Hook: filter:posts.getUserInfoForPosts
 *
 * @param {{users: Array<object>, uid: number}} hookData users of the posts on the page and the viewer uid
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
	const [badge] = await badgesFor([userData], lang, 'lg');
	userData.rankBadge = badge;
	return hookData;
};

/**
 * Last pass before render/JSON: names in the page language. Covers guests whose language
 * comes from the browser or ?lang= rather than from user settings, which the earlier hooks
 * cannot see. Only the posts list and the account page carry badges, so only those are fixed.
 * The custom_profile_info entry is matched by its previous HTML so that only our own entry is
 * replaced.
 *
 * Hook: filter:middleware.render (priority 20)
 *
 * @param {{templateData: object, res: import('express').Response}} hookData
 * @returns {Promise<object>} the same hookData
 */
plugin.onRender = async function (hookData) {
	const { templateData, res } = hookData;
	const lang = res && res.locals && res.locals.config && res.locals.config.userLang;
	if (!lang || !templateData) return hookData;
	const config = await getConfig();
	const fix = async (u) => {
		if (!u || !u.rankBadge) return;
		const old = u.rankBadge.html;
		u.rankBadge = await relocalize(config, u.rankBadge, lang);
		if (Array.isArray(u.custom_profile_info)) {
			u.custom_profile_info.forEach((c) => {
				if (c && c.rankBadge && c.content === old) c.content = u.rankBadge.html;
			});
		}
	};
	if (Array.isArray(templateData.posts)) await Promise.all(templateData.posts.map(p => p && fix(p.user)));
	if (templateData.rankBadge) await fix(templateData);
	return hookData;
};

/** Internal functions exposed for tests only; not a public API. */
plugin._test = { getConfig, invalidate };
