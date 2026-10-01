'use strict';

/*
 * Badge HTML builder, used by library.js (posts, profiles, the public ladder route) and by the
 * unit tests. No NodeBB imports and no I/O: the translator is passed in by the caller.
 *
 * Two steps:
 * 1. build(): markup for one rank or group badge. Labels are translation tokens and the name
 *    is a placeholder (NAME_PLACEHOLDER), so no admin-typed text is ever part of a token.
 * 2. localize(): translates the markup, then puts the HTML-escaped name in place of the
 *    placeholder. NodeBB's translator decodes entities such as &#91; inside token arguments and
 *    would expand a "[[namespace:key]]" hidden in a name; with the name inserted after
 *    translation that cannot happen.
 *
 * Where each value comes from and why it is safe in the markup:
 * - names and group names: typed by an admin in the ACP; plain text, escaped here, with "[" and
 *   "]" as &lsqb; / &rsqb;, which NodeBB's translator leaves alone even if the HTML is
 *   translated again later;
 * - default names: translation tokens ([[rank-badges:rank-3]]) built from a key that
 *   ranks.cleanKey() restricts to [a-z0-9-]; translated in localize();
 * - image: ranks.cleanImage() allows only site-relative paths and https URLs; escaped here;
 * - color: ranks.cleanColor() whitelist (#hex or var(--name)); written into a style attribute;
 * - icon: ranks.cleanIcon() pattern fa-[a-z0-9-]; written into a class attribute;
 * - lang: a language code validated by library.js (lib/lang.js); escaped here anyway;
 * - level, total, tier, index: integers computed by lib/ranks.js.
 * The result is cached by library.js and injected as raw HTML by themes, so nothing
 * unvalidated may be added here.
 *
 * Besides the HTML, build() returns `view`: the same badge as data (classes, data attributes,
 * colour, image, icon, bar, plain-text name and label). The ladder route sends it to the browser,
 * where lib/badge-dom.js builds the badge with DOM methods instead of parsing HTML.
 */

const ranks = require('./ranks');

/** Stands for the escaped name until localize() replaces it; survives the translator as is. */
const NAME_PLACEHOLDER = '@@rb-name@@';
/** Above this many ranks the level bar shows "level/total" instead of one segment per rank. */
const MAX_BAR_SEGMENTS = 10;

const ESC = {
	'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;', '`': '&#96;', '=': '&#61;',
	'[': '&lsqb;', ']': '&rsqb;',
};

/**
 * HTML-escapes text for element content and quoted attributes. Square brackets are encoded as
 * &lsqb; / &rsqb; (not &#91;, which the translator decodes in token arguments), so escaped text
 * can never form a translation token.
 *
 * @param {*} str
 * @returns {string}
 */
function escape(str) {
	return String(str).replace(/[&<>"'`=[\]]/g, c => ESC[c]);
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: '\u00a0', lsqb: '[', rsqb: ']', lbrack: '[', rbrack: ']' };

/**
 * Turns translated HTML text (entities, no tags) into plain text for `view`. A string
 * operation: nothing is parsed as HTML.
 *
 * @param {*} str
 * @returns {string}
 */
function decodeEntities(str) {
	return String(str == null ? '' : str).replace(/&(#[0-9]{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi, (m, e) => {
		if (e[0] === '#') {
			const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
		}
		const named = NAMED_ENTITIES[e.toLowerCase()];
		return named === undefined ? m : named;
	});
}

/**
 * Text colour with the better contrast on a given background: black or white, from the WCAG
 * relative luminance. Only #rgb / #rrggbb can be evaluated; for var(--…) colours the caller
 * keeps the stylesheet default.
 *
 * @param {string} color normalised colour (ranks.cleanColor)
 * @returns {'#000'|'#fff'|''} '' when the colour cannot be evaluated
 */
function textColorFor(color) {
	let hex = String(color || '');
	if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) return '';
	hex = hex.slice(1);
	if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
	const channel = (i) => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	const lum = (0.2126 * channel(0)) + (0.7152 * channel(2)) + (0.0722 * channel(4));
	const onBlack = (lum + 0.05) / 0.05;
	const onWhite = 1.05 / (lum + 0.05);
	return onBlack >= onWhite ? '#000' : '#fff';
}

/**
 * Builds the badge markup and its data for one rank description.
 *
 * The HTML still contains [[rank-badges:…]] tokens (aria-label, title) and NAME_PLACEHOLDER;
 * localize() finishes it. The aria-label and title carry "Rank 3 of 6: Name" for screen
 * readers; the visible parts (bar, image, icon) are marked decorative.
 *
 * @param {object} config normalised config
 * @param {object} info   result of ranks.describe(); for group badges `hidden: true` when the
 *   NodeBB group is hidden (its name is then kept out of the markup and the data)
 * @param {object} opts   { lang, relativePath, size: 'sm' | 'lg' }
 * @returns {object|null} { level, total, tier, special, key, group, image, color, nameSource, html };
 *   `group` is the raw group name ('' for hidden groups; escape it when printing);
 *   null when the index does not exist in the config
 */
function build(config, info, opts) {
	if (!info) return null;
	opts = opts || {};
	const entry = info.special ? config.special[info.index] : config.ranks[info.index];
	if (!entry) return null;
	const hidden = !!(info.special && info.hidden);

	let fallback;
	if (!info.special) fallback = { token: `[[${ranks.NAMESPACE}:rank-n, ${info.level}]]` };
	else if (hidden) fallback = { token: `[[${ranks.NAMESPACE}:group-generic]]` };
	else fallback = { text: entry.group };
	const nameSource = ranks.resolveName(entry, opts.lang, fallback);

	let image = config.showImages ? entry.image : '';
	// Forums installed in a sub-folder (relative_path "/forum"): stored paths are relative to
	// the forum root, so they get the prefix here unless the admin already typed it.
	if (image && image.startsWith('/') && opts.relativePath && !image.startsWith(`${opts.relativePath}/`)) {
		image = opts.relativePath + image;
	}

	const classes = ['rank-badge'];
	classes.push(info.special ? 'rank-badge--special' : `rank-badge--tier-${info.tier}`);
	if (image) classes.push('rank-badge--image');
	if (opts.size === 'lg') classes.push('rank-badge--lg');

	const label = info.special ?
		`[[${ranks.NAMESPACE}:aria.special, ${NAME_PLACEHOLDER}]]` :
		`[[${ranks.NAMESPACE}:aria.rank, ${info.level}, ${info.total}, ${NAME_PLACEHOLDER}]]`;

	// Only custom properties are set; the SCSS decides how the accent is used. Group badges use
	// the accent as background, so they also get a readable text colour.
	let style = '';
	let fg = '';
	if (entry.color) {
		style = `--rank-badge-accent: ${entry.color};`;
		fg = info.special ? textColorFor(entry.color) : '';
		if (fg) style += ` --rank-badge-accent-fg: ${fg};`;
		style = ` style="${style}"`;
	}
	let data = ` data-rb="${info.special ? 's' : 'r'}${info.index}" data-rb-lang="${escape(opts.lang || '')}"`;
	const dataView = { 'data-rb': `${info.special ? 's' : 'r'}${info.index}`, 'data-rb-lang': String(opts.lang || '') };
	if (!info.special) {
		data += ` data-level="${info.level}" data-total="${info.total}"`;
		dataView['data-level'] = String(info.level);
		dataView['data-total'] = String(info.total);
	} else if (!hidden) {
		data += ` data-group="${escape(entry.group)}"`;
		dataView['data-group'] = entry.group;
	}

	let inner = '';
	let hasFallbackVisual = false;
	let barView = null;
	if (info.special) {
		// entry.icon is unescaped on purpose: cleanIcon() allows only fa-[a-z0-9-].
		if (entry.icon) {
			inner += `<i class="rank-badge__icon fa-solid ${entry.icon}" aria-hidden="true"></i>`;
			hasFallbackVisual = true;
		}
	} else if (config.showBar) {
		let bar;
		if (info.total > MAX_BAR_SEGMENTS) {
			bar = `<span class="rank-badge__bar rank-badge__bar--count" aria-hidden="true">${info.level}/${info.total}</span>`;
			barView = { count: `${info.level}/${info.total}` };
		} else {
			bar = '';
			barView = { segments: [] };
			for (let i = 1; i <= info.total; i += 1) {
				bar += i <= info.level ? '<i class="on"></i>' : '<i></i>';
				barView.segments.push(i <= info.level);
			}
			bar = `<span class="rank-badge__bar" aria-hidden="true">${bar}</span>`;
		}
		inner += bar;
		hasFallbackVisual = true;
	}
	if (image) {
		// Decorative: the visible name carries the meaning. If the file cannot be loaded,
		// public/client.js adds rank-badge--image-failed and the CSS shows the level bar, the
		// group icon or, when there is neither, a generic icon (rank-badge__fallback).
		// no-referrer: an external image host does not learn which topic is being read.
		const fallbackIcon = hasFallbackVisual ? '' : '<i class="rank-badge__fallback fa-solid fa-award" aria-hidden="true"></i>';
		inner = `<img class="rank-badge__img" src="${escape(image)}" alt="" width="20" height="20" loading="lazy" decoding="async" referrerpolicy="no-referrer">${fallbackIcon}${inner}`;
	}
	inner += `<span class="rank-badge__name">${NAME_PLACEHOLDER}</span>`;

	const html = `<span class="${classes.join(' ')}"${data}${style} role="img" aria-label="${label}" title="${label}">${inner}</span>`;

	return {
		level: info.level,
		total: info.total,
		tier: info.tier,
		special: info.special,
		key: entry.key || '',
		group: info.special && !hidden ? entry.group : '',
		image,
		color: entry.color,
		nameSource,
		html,
		// Plain data for lib/badge-dom.js; `label` and `name` are filled in by localize().
		view: {
			classes: classes.slice(),
			data: dataView,
			accent: entry.color || '',
			accentFg: fg,
			image: image || '',
			fallbackIcon: !!image && !hasFallbackVisual,
			icon: info.special ? entry.icon || '' : '',
			bar: barView,
			labelToken: label,
			label: '',
			name: '',
		},
	};
}

/**
 * Translates a built badge into one language and inserts the name.
 *
 * @param {object} built result of build()
 * @param {string} lang language code
 * @param {function(string, string): Promise<string>} translate NodeBB's translator.translate
 * @returns {Promise<object>} the badge data without `nameSource`, with the final `name` (HTML),
 *   `html` and `view` (plain-text `name` and `label`)
 */
async function localize(built, lang, translate) {
	const source = built.nameSource;
	const name = source.token ? await translate(source.token, lang) : escape(source.text);
	const translated = await translate(built.html, lang);
	const badge = Object.assign({}, built);
	delete badge.nameSource;
	badge.name = name;
	badge.html = translated.split(NAME_PLACEHOLDER).join(name);
	if (built.view) {
		const view = Object.assign({}, built.view);
		const plainName = source.token ? decodeEntities(name) : String(source.text);
		view.name = plainName;
		view.label = decodeEntities(await translate(view.labelToken, lang)).split(NAME_PLACEHOLDER).join(plainName);
		delete view.labelToken;
		badge.view = view;
	}
	return badge;
}

module.exports = { build, localize, escape, decodeEntities, textColorFor, NAME_PLACEHOLDER, MAX_BAR_SEGMENTS };
