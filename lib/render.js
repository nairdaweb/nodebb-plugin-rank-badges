'use strict';

/*
 * Badge HTML builder, used by library.js (posts, profiles, the public ladder route) and by the
 * unit tests. Pure function of the normalised config: no NodeBB imports, no I/O.
 *
 * Where each value comes from and why it is safe in the markup:
 * - names and group names: typed by an admin in the ACP; plain text, escaped here;
 * - default names: translation tokens ([[rank-badges:rank-3]]) built from a key that
 *   ranks.cleanKey() restricts to [a-z0-9-]; translated by library.js;
 * - image: ranks.cleanImage() allows only site-relative paths and http(s) URLs; escaped here;
 * - color: ranks.cleanColor() whitelist (#hex or var(--name)); written into a style attribute;
 * - icon: ranks.cleanIcon() pattern fa-[a-z0-9-]; written into a class attribute;
 * - level, total, tier: integers computed by lib/ranks.js.
 * The result is cached by library.js and injected as raw HTML by themes and public/client.js,
 * so nothing unvalidated may be added here.
 */

const ranks = require('./ranks');

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;', '`': '&#96;', '=': '&#61;' };

/**
 * HTML-escapes text for element content and quoted attributes.
 *
 * @param {*} str
 * @returns {string}
 */
function escape(str) {
	// Brackets too, so an admin-typed name cannot smuggle in a translation token.
	return String(str).replace(/[&<>"'`=]/g, c => ESC[c]).replace(/\[/g, '&#91;').replace(/\]/g, '&#93;');
}

/**
 * Translator arguments are comma-separated; commas inside a name would split it.
 * The entity is decoded by the browser when the attribute is read.
 *
 * @param {string} str already escaped name or token
 * @returns {string}
 */
function argSafe(str) {
	return String(str).replace(/,/g, '&#44;');
}

/**
 * @param {{text: string}|{token: string}} resolved result of ranks.resolveName()
 * @returns {string} escaped text, or the translation token unchanged (it is built from a
 *   validated key, see ranks.cleanKey)
 */
function nameHtml(resolved) {
	return resolved.token ? resolved.token : escape(resolved.text);
}

/**
 * Builds the badge markup and its data for one rank description.
 *
 * The HTML still contains [[rank-badges:…]] tokens (default names, aria-label); the caller
 * translates it. The aria-label and title carry "Rank 3 of 6: Name" for screen readers; the
 * visible parts (bar, image, icon) are marked decorative.
 *
 * @param {object} config normalised config
 * @param {object} info   result of ranks.describe()
 * @param {object} opts   { lang, relativePath, size: 'sm' | 'lg' }
 * @returns {object|null} { level, total, tier, special, key, group, image, color, name, html };
 *   `name` and `html` are HTML, `group` is the raw group name (escape it when printing);
 *   null when the index does not exist in the config
 */
function build(config, info, opts) {
	if (!info) return null;
	opts = opts || {};
	const entry = info.special ? config.special[info.index] : config.ranks[info.index];
	if (!entry) return null;

	const resolved = ranks.resolveName(entry, opts.lang, info.special ? entry.group : '');
	const name = nameHtml(resolved);
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
		`[[rank-badges:aria.special, ${argSafe(name)}]]` :
		`[[rank-badges:aria.rank, ${info.level}, ${info.total}, ${argSafe(name)}]]`;

	// Only the custom property is set; the SCSS decides how the accent is used.
	const style = entry.color ? ` style="--rank-badge-accent: ${entry.color};"` : '';
	const data = info.special ?
		` data-group="${escape(entry.group)}"` :
		` data-level="${info.level}" data-total="${info.total}"`;

	let inner = '';
	if (image) {
		// Decorative: the visible name carries the meaning. If the file is missing, client.js
		// swaps the image for the level bar (rank-badge--image-failed).
		inner += `<img class="rank-badge__img" src="${escape(image)}" alt="" width="20" height="20" loading="lazy" decoding="async">`;
	}
	if (info.special) {
		// entry.icon is unescaped on purpose: cleanIcon() allows only fa-[a-z0-9-].
		if (entry.icon) inner += `<i class="rank-badge__icon fa-solid ${entry.icon}" aria-hidden="true"></i>`;
	} else if (config.showBar) {
		let bar = '';
		for (let i = 1; i <= info.total; i += 1) {
			bar += i <= info.level ? '<i class="on"></i>' : '<i></i>';
		}
		inner += `<span class="rank-badge__bar" aria-hidden="true">${bar}</span>`;
	}
	inner += `<span class="rank-badge__name">${name}</span>`;

	const html = `<span class="${classes.join(' ')}"${data}${style} role="img" aria-label="${label}" title="${label}">${inner}</span>`;

	return {
		level: info.level,
		total: info.total,
		tier: info.tier,
		special: info.special,
		key: entry.key || '',
		group: info.special ? entry.group : '',
		image,
		color: entry.color,
		name,
		html,
	};
}

module.exports = { build, escape };
