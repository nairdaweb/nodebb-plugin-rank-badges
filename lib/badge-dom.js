'use strict';

/*
 * Builds a badge as DOM elements from the data description made by lib/render.js (`view`), for
 * badges that arrive from the ladder route: the ACP preview (public/admin.js) and badges of posts
 * re-rendered in the viewer's language (public/client.js). Exposed to the browser as
 * "rank-badges/badge-dom" through plugin.json; no Node-only APIs, unit-tested with a stand-in
 * document (test/badge-dom.test.js).
 *
 * Nothing is parsed as HTML. Text (name, label, group) is set with textContent / setAttribute,
 * and every value that ends up in a class, a style property or a URL is checked again here with
 * the same rules as when the settings are saved (lib/ranks.js), so the result does not depend on
 * the response being well-formed.
 */

const ranks = require('./ranks');

/** Badge classes the stylesheet knows. */
const CLASS_RE = /^rank-badge(?:--(?:special|image|lg|tier-[0-9]{1,2}))?$/;
/** Attributes copied from view.data, with the pattern their value must match. */
const DATA_ATTRS = {
	'data-rb': /^[rs][0-9]{1,4}$/,
	'data-rb-lang': /^[a-zA-Z0-9_-]{0,20}$/,
	'data-level': /^[0-9]{1,4}$/,
	'data-total': /^[0-9]{1,4}$/,
	'data-group': null, // any text (a group name), set as attribute text
};
/** Longest text taken for the name, the label and attribute values. */
const MAX_TEXT = 300;

/**
 * @param {*} value
 * @returns {string}
 */
function text(value) {
	return String(value == null ? '' : value).slice(0, MAX_TEXT);
}

/**
 * Image URL usable in the badge: a path on this forum or an https URL (ranks.cleanImage).
 *
 * @param {*} url
 * @returns {string} the URL, or ''
 */
function safeImageUrl(url) {
	return ranks.cleanImage(url);
}

/**
 * @param {Document} doc
 * @param {string} tag
 * @param {string} className
 * @returns {HTMLElement}
 */
function el(doc, tag, className) {
	const node = doc.createElement(tag);
	if (className) node.className = className;
	return node;
}

/**
 * @param {Document} doc
 * @param {object} view badge description from the ladder route (`view` of a ladder entry)
 * @returns {HTMLElement|null} the badge (span.rank-badge), or null without a usable view
 */
function build(doc, view) {
	if (!view || typeof view !== 'object') return null;
	const classes = (Array.isArray(view.classes) ? view.classes : []).map(String).filter(c => CLASS_RE.test(c));
	if (!classes.includes('rank-badge')) classes.unshift('rank-badge');

	const badge = el(doc, 'span', classes.join(' '));
	const data = view.data && typeof view.data === 'object' ? view.data : {};
	Object.keys(DATA_ATTRS).forEach((name) => {
		if (data[name] === undefined || data[name] === null) return;
		const value = text(data[name]);
		const re = DATA_ATTRS[name];
		if (!re || re.test(value)) badge.setAttribute(name, value);
	});
	const accent = ranks.cleanColor(view.accent);
	if (accent) {
		badge.style.setProperty('--rank-badge-accent', accent);
		if (view.accentFg === '#000' || view.accentFg === '#fff') badge.style.setProperty('--rank-badge-accent-fg', view.accentFg);
	}
	const label = text(view.label);
	badge.setAttribute('role', 'img');
	badge.setAttribute('aria-label', label);
	badge.setAttribute('title', label);

	const image = safeImageUrl(view.image);
	if (image) {
		const img = el(doc, 'img', 'rank-badge__img');
		img.setAttribute('src', image);
		img.setAttribute('alt', '');
		img.setAttribute('width', '20');
		img.setAttribute('height', '20');
		img.setAttribute('loading', 'lazy');
		img.setAttribute('decoding', 'async');
		img.setAttribute('referrerpolicy', 'no-referrer');
		badge.appendChild(img);
		if (view.fallbackIcon) badge.appendChild(decorative(el(doc, 'i', 'rank-badge__fallback fa-solid fa-award')));
	}
	const icon = ranks.cleanIcon(view.icon);
	if (icon) badge.appendChild(decorative(el(doc, 'i', `rank-badge__icon fa-solid ${icon}`)));
	if (view.bar && typeof view.bar === 'object') {
		if (typeof view.bar.count === 'string' && /^[0-9]{1,4}\/[0-9]{1,4}$/.test(view.bar.count)) {
			const bar = decorative(el(doc, 'span', 'rank-badge__bar rank-badge__bar--count'));
			bar.textContent = view.bar.count;
			badge.appendChild(bar);
		} else if (Array.isArray(view.bar.segments)) {
			const bar = decorative(el(doc, 'span', 'rank-badge__bar'));
			view.bar.segments.slice(0, 50).forEach((on) => {
				bar.appendChild(el(doc, 'i', on === true ? 'on' : ''));
			});
			badge.appendChild(bar);
		}
	}
	const name = el(doc, 'span', 'rank-badge__name');
	name.textContent = text(view.name);
	badge.appendChild(name);
	return badge;
}

/**
 * @param {HTMLElement} node
 * @returns {HTMLElement} the same node, hidden from screen readers
 */
function decorative(node) {
	node.setAttribute('aria-hidden', 'true');
	return node;
}

module.exports = { build, safeImageUrl };
