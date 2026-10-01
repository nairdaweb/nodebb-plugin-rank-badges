'use strict';

/*
 * Unit tests for lib/badge-dom.js with a stand-in document: the badge is built from its data
 * with DOM methods, text stays text, and classes, colours, icons and image URLs are checked.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const BadgeDom = require('../lib/badge-dom');

/** Minimal stand-in for document: elements record what is set on them; nothing is parsed. */
const doc = {
	createElement(tag) {
		const props = {};
		return {
			tagName: tag.toUpperCase(),
			className: '',
			textContent: '',
			attrs: {},
			children: [],
			style: { props, setProperty(name, value) { props[name] = value; } },
			setAttribute(name, value) { this.attrs[name] = String(value); },
			appendChild(child) { this.children.push(child); return child; },
		};
	},
};

const VIEW = {
	classes: ['rank-badge', 'rank-badge--tier-2', 'rank-badge--image'],
	data: { 'data-rb': 'r1', 'data-rb-lang': 'en-GB', 'data-level': '2', 'data-total': '3' },
	accent: '#123456',
	accentFg: '',
	image: '/forum/img/r2.png',
	fallbackIcon: false,
	icon: '',
	bar: { segments: [true, true, false] },
	label: 'Rank 2 of 3: <img src=x onerror=alert(1)>',
	name: '<img src=x onerror=alert(1)>',
};

test('build: same structure as the server markup, text set as text', () => {
	const b = BadgeDom.build(doc, VIEW);
	assert.equal(b.tagName, 'SPAN');
	assert.equal(b.className, 'rank-badge rank-badge--tier-2 rank-badge--image');
	assert.equal(b.attrs['data-rb'], 'r1');
	assert.equal(b.attrs['data-level'], '2');
	assert.equal(b.attrs.role, 'img');
	assert.equal(b.attrs['aria-label'], VIEW.label);
	assert.equal(b.attrs.title, VIEW.label);
	assert.equal(b.style.props['--rank-badge-accent'], '#123456');
	const [img, bar, name] = b.children;
	assert.equal(img.tagName, 'IMG');
	assert.equal(img.attrs.src, '/forum/img/r2.png');
	assert.equal(img.attrs.referrerpolicy, 'no-referrer');
	assert.equal(bar.className, 'rank-badge__bar');
	assert.deepEqual(bar.children.map(i => i.className), ['on', 'on', '']);
	assert.equal(name.className, 'rank-badge__name');
	assert.equal(name.textContent, VIEW.name);
});

test('build: group badge with icon, fallback icon and count bar', () => {
	const g = BadgeDom.build(doc, { classes: ['rank-badge', 'rank-badge--special'], data: { 'data-rb': 's0', 'data-group': 'a "b" <c>' }, accent: '#fff', accentFg: '#000', icon: 'fa-shield-halved', label: 'Admin', name: 'Admin' });
	assert.equal(g.attrs['data-group'], 'a "b" <c>');
	assert.equal(g.style.props['--rank-badge-accent-fg'], '#000');
	assert.equal(g.children[0].className, 'rank-badge__icon fa-solid fa-shield-halved');
	assert.equal(g.children[0].attrs['aria-hidden'], 'true');

	const f = BadgeDom.build(doc, { image: 'https://cdn.example.com/a.png', fallbackIcon: true, bar: { count: '12/40' }, name: 'x' });
	assert.equal(f.className, 'rank-badge');
	assert.deepEqual(f.children.map(c => c.className), ['rank-badge__img', 'rank-badge__fallback fa-solid fa-award', 'rank-badge__bar rank-badge__bar--count', 'rank-badge__name']);
	assert.equal(f.children[2].textContent, '12/40');
});

test('build: refuses unsafe classes, attributes, colours, icons and image URLs', () => {
	const b = BadgeDom.build(doc, {
		classes: ['rank-badge', 'x" onmouseover="y', 'btn', 'rank-badge--tier-1 evil'],
		data: { 'data-rb': 'r1"><x', 'data-level': 'NaN', 'data-total': '3', onclick: 'alert(1)' },
		accent: 'red;background:url(//evil)',
		accentFg: 'red',
		icon: 'fa-x" onclick="y',
		image: 'javascript:alert(1)',
		bar: { count: '<b>1</b>' },
		label: 7,
	});
	assert.equal(b.className, 'rank-badge');
	assert.deepEqual(Object.keys(b.attrs).sort(), ['aria-label', 'data-total', 'role', 'title']);
	assert.deepEqual(b.style.props, {});
	assert.equal(b.attrs['aria-label'], '7');
	assert.deepEqual(b.children.map(c => c.className), ['rank-badge__name']);
	['//evil.example/a.png', '/\\evil.example/a.png', 'data:image/png;base64,AA', 'http://x.example/a.png', '/a.png" onerror="x']
		.forEach(url => assert.equal(BadgeDom.safeImageUrl(url), '', url));
	assert.equal(BadgeDom.safeImageUrl('/assets/uploads/rank-badges/a.png'), '/assets/uploads/rank-badges/a.png');
	assert.equal(BadgeDom.build(doc, null), null);
	assert.equal(BadgeDom.build(doc, 'html'), null);
});
