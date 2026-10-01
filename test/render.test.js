'use strict';

/*
 * Unit tests for lib/render.js: markup, escaping, translation step, contrast and fallbacks.
 * The translator is a stand-in that behaves like NodeBB's in the way that matters here: it
 * expands every [[namespace:key, args]] token it finds, and it decodes numeric entities such as
 * &#91; in token arguments before looking for nested tokens.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const ranks = require('../lib/ranks');
const render = require('../lib/render');

const STRINGS = {
	'rank-badges:aria.rank': 'Rank %1 of %2: %3',
	'rank-badges:aria.special': '%1',
	'rank-badges:rank-3': 'Tinkerer',
	'rank-badges:rank-n': 'Rank %1',
	'rank-badges:group-administrators': 'Administrator',
	'rank-badges:group-generic': 'Team',
	'global:home': 'Home',
};

/**
 * Decodes the entities NodeBB's translator decodes in arguments (numeric ones, &#44; …).
 *
 * @param {string} s
 * @returns {string}
 */
const decode = s => s.replace(/&#(\d+);/g, (m, n) => String.fromCharCode(n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)));

/**
 * @param {string} token "[[ns:key, a, b]]"
 * @returns {Promise<string>}
 */
async function translateToken(token) {
	const inner = token.slice(2, -2);
	const [key, ...args] = inner.split(',').map(s => s.trim());
	if (!STRINGS[key]) return token;
	const values = await Promise.all(args.map(async (a) => {
		const d = decode(a);
		return /^\[\[.*\]\]$/.test(d) ? translateToken(d) : d;
	}));
	return STRINGS[key].replace(/%(\d+)/g, (m, n) => values[n - 1] || '');
}

/**
 * Pessimistic translator: expands tokens anywhere in the text, innermost first.
 *
 * @param {string} text
 * @returns {Promise<string>}
 */
async function translate(text) {
	let out = String(text);
	const re = /\[\[[a-z0-9/-]+:[a-z0-9.-]+(?:,[^[\]]*)?\]\]/i;
	for (let guard = 0; guard < 50; guard += 1) {
		const m = re.exec(out);
		if (!m) break;
		const done = await translateToken(m[0]);
		if (done === m[0]) break;
		out = out.slice(0, m.index) + done + out.slice(m.index + m[0].length);
	}
	return out;
}

const cfg = extra => ranks.normalize(Object.assign({}, extra));

/**
 * @param {object} c normalised config
 * @param {object|null} info
 * @param {object} [opts]
 * @returns {Promise<object>} localised badge
 */
async function badge(c, info, opts) {
	opts = Object.assign({ lang: 'en-GB' }, opts);
	return render.localize(render.build(c, info, opts), opts.lang, translate);
}

test('render: escapes admin text, marks level, bar and image', async () => {
	const c = cfg({ ranks: JSON.stringify([{ names: { en: 'A & <B>', pl: 'x' } }, { names: { en: 'Two' }, minPosts: 1, image: '/img/r2.png', color: '#123456' }]) });
	const one = await badge(c, ranks.describe(c, { postcount: 0 }));
	assert.match(one.html, /A &amp; &lt;B&gt;/);
	assert.doesNotMatch(one.html, /<B>/);
	assert.match(one.html, /data-rb="r0" data-rb-lang="en-GB" data-level="1" data-total="2"/);
	assert.match(one.html, /<i class="on"><\/i><i><\/i>/);
	assert.match(one.html, /aria-label="Rank 1 of 2: A &amp; &lt;B&gt;"/);
	assert.equal(one.name, 'A &amp; &lt;B&gt;');
	assert.equal(one.nameSource, undefined);

	const two = await badge(c, ranks.describe(c, { postcount: 5 }), { relativePath: '/forum' });
	assert.match(two.html, /src="\/forum\/img\/r2.png"/);
	assert.match(two.html, /--rank-badge-accent: #123456;/);
	assert.doesNotMatch(two.html, /--rank-badge-accent-fg/, 'rank badges keep the tier text colour');
	assert.match(two.html, /rank-badge--image/);
	assert.match(two.html, /referrerpolicy="no-referrer"/);
	assert.match(two.html, /loading="lazy"/);
});

test('render: translation tokens in names are never expanded (item 9)', async () => {
	const names = ['[[global:home]]', 'a [[global:home]] b', '&#91;&#91;global:home&#93;&#93;', '[[rank-badges:aria.rank, 1, 2, [[global:home]]]]', 'x, y %1'];
	for (const name of names) {
		const c = cfg({ ranks: JSON.stringify([{ names: { en: name } }]) });
		const b = await badge(c, ranks.describe(c, {}));
		assert.doesNotMatch(b.html, /Home/, `${name}: token expanded`);
		assert.doesNotMatch(b.html, /\[\[/, `${name}: literal brackets left for a later translation`);
		const again = await translate(b.html);
		assert.equal(again, b.html, `${name}: translating the result again changes it`);
	}
	const c = cfg({ ranks: JSON.stringify([{ names: { en: '[x], y' } }]) });
	const b = await badge(c, ranks.describe(c, {}));
	assert.match(b.html, /aria-label="Rank 1 of 1: &lsqb;x&rsqb;, y"/);
	assert.match(b.html, /<span class="rank-badge__name">&lsqb;x&rsqb;, y<\/span>/);
	assert.equal(render.escape('[['), '&lsqb;&lsqb;');
});

test('render: default names are tokens translated in localize(); bar can be hidden', async () => {
	const c = cfg({ showBar: 'off' });
	const b = await badge(c, ranks.describe(c, { postcount: 30, reputation: 6 }), { lang: 'pl' });
	assert.match(b.html, /<span class="rank-badge__name">Tinkerer<\/span>/);
	assert.match(b.html, /aria-label="Rank 3 of 6: Tinkerer"/);
	assert.doesNotMatch(b.html, /rank-badge__bar/);
	const s = await badge(c, ranks.describe(c, {}, new Set(['administrators'])));
	assert.match(s.html, /rank-badge--special/);
	assert.match(s.html, /data-rb="s0"/);
	assert.match(s.html, /data-group="administrators"/);
	assert.match(s.html, /fa-shield-halved/);
	assert.match(s.html, /aria-label="Administrator"/);
	assert.equal(s.group, 'administrators');
});

test('render: rank without any name falls back to "Rank N" (item 13)', async () => {
	const c = cfg({ ranks: JSON.stringify([{ names: {} }, { names: {}, minPosts: 2 }]) });
	const b = await badge(c, ranks.describe(c, { postcount: 3 }));
	assert.match(b.html, /<span class="rank-badge__name">Rank 2<\/span>/);
	assert.match(b.html, /aria-label="Rank 2 of 2: Rank 2"/);
});

test('render: hidden groups keep their name out of the markup and data (item 10)', async () => {
	const c = cfg({ special: JSON.stringify([{ group: 'Secret testers', showHidden: true }]) });
	const info = Object.assign(ranks.describe(c, {}, new Set(['Secret testers'])), { hidden: true });
	const b = await badge(c, info);
	assert.doesNotMatch(b.html, /Secret/);
	assert.doesNotMatch(b.html, /data-group/);
	assert.equal(b.group, '');
	assert.match(b.html, /<span class="rank-badge__name">Team<\/span>/, 'generic name instead of the group name');

	const named = cfg({ special: JSON.stringify([{ group: 'Secret testers', names: { en: 'VIP' } }]) });
	const v = await badge(named, Object.assign(ranks.describe(named, {}, new Set(['Secret testers'])), { hidden: true }));
	assert.match(v.html, />VIP</);
	assert.doesNotMatch(v.html, /Secret/);
});

test('render: group badge text colour follows the background luminance (item 18)', async () => {
	assert.equal(render.textColorFor('#ffcc00'), '#000');
	assert.equal(render.textColorFor('#fff'), '#000');
	assert.equal(render.textColorFor('#1e4fd8'), '#fff');
	assert.equal(render.textColorFor('#000000'), '#fff');
	assert.equal(render.textColorFor('#777777'), '#000');
	assert.equal(render.textColorFor('var(--bs-primary)'), '');
	assert.equal(render.textColorFor(''), '');

	const c = cfg({ special: JSON.stringify([{ group: 'Gold', color: '#ffcc00' }, { group: 'Navy', color: '#123456' }, { group: 'Var', color: 'var(--x)' }]) });
	const pick = async g => (await badge(c, ranks.describe(c, {}, new Set([g])))).html;
	assert.match(await pick('Gold'), /--rank-badge-accent: #ffcc00; --rank-badge-accent-fg: #000;/);
	assert.match(await pick('Navy'), /--rank-badge-accent-fg: #fff;/);
	assert.doesNotMatch(await pick('Var'), /accent-fg/);
});

test('render: long ladders show "level/total" instead of segments (item 17)', async () => {
	const list = Array.from({ length: 12 }, (x, i) => ({ names: { en: `R${i + 1}` }, minPosts: i }));
	const c = cfg({ ranks: JSON.stringify(list) });
	const b = await badge(c, ranks.describe(c, { postcount: 4 }));
	assert.match(b.html, /<span class="rank-badge__bar rank-badge__bar--count" aria-hidden="true">5\/12<\/span>/);
	assert.doesNotMatch(b.html, /<i class="on">/);
	const short = cfg({ ranks: JSON.stringify(list.slice(0, render.MAX_BAR_SEGMENTS)) });
	assert.match((await badge(short, ranks.describe(short, { postcount: 1 }))).html, /<i class="on"><\/i>/);
});

test('render: an image always has a fallback, also without the bar (item 19)', async () => {
	const withBar = cfg({ ranks: JSON.stringify([{ names: { en: 'A' }, image: '/a.png' }]) });
	const a = await badge(withBar, ranks.describe(withBar, {}));
	assert.match(a.html, /rank-badge__bar/);
	assert.doesNotMatch(a.html, /rank-badge__fallback/);

	const noBar = cfg({ showBar: 'off', ranks: JSON.stringify([{ names: { en: 'A' }, image: '/a.png' }]) });
	assert.match((await badge(noBar, ranks.describe(noBar, {}))).html, /rank-badge__fallback fa-solid fa-award/);

	const group = cfg({ special: JSON.stringify([{ group: 'T', image: '/t.png' }, { group: 'U', image: '/u.png', icon: 'fa-star' }]) });
	assert.match((await badge(group, ranks.describe(group, {}, new Set(['T'])))).html, /rank-badge__fallback/);
	assert.doesNotMatch((await badge(group, ranks.describe(group, {}, new Set(['U'])))).html, /rank-badge__fallback/);

	const noImage = cfg({ showBar: 'off' });
	assert.doesNotMatch((await badge(noImage, ranks.describe(noImage, {}))).html, /rank-badge__fallback/);
});

test('render: relative_path is added only when missing', async () => {
	const c = cfg({ ranks: JSON.stringify([{ names: { en: 'A' }, image: '/forum-logo.png' }, { names: { en: 'B' }, image: '/forum/x.png', minPosts: 1 }]) });
	assert.match((await badge(c, ranks.describe(c, {}), { relativePath: '/forum' })).html, /src="\/forum\/forum-logo.png"/);
	assert.match((await badge(c, ranks.describe(c, { postcount: 1 }), { relativePath: '/forum' })).html, /src="\/forum\/x.png"/);
});

test('render: view describes the same badge as data, with plain-text name and label', async () => {
	const c = cfg({ ranks: JSON.stringify([{ names: { en: 'A & <B> [[global:home]]' } }, { names: { en: 'Two' }, minPosts: 1, image: '/img/r2.png', color: '#123456' }]) });
	const one = await badge(c, ranks.describe(c, { postcount: 0 }));
	assert.deepEqual(one.view, {
		classes: ['rank-badge', 'rank-badge--tier-2'],
		data: { 'data-rb': 'r0', 'data-rb-lang': 'en-GB', 'data-level': '1', 'data-total': '2' },
		accent: '',
		accentFg: '',
		image: '',
		fallbackIcon: false,
		icon: '',
		bar: { segments: [true, false] },
		label: 'Rank 1 of 2: A & <B> [[global:home]]',
		name: 'A & <B> [[global:home]]',
	});
	const two = await badge(c, ranks.describe(c, { postcount: 5 }), { relativePath: '/forum' });
	assert.equal(two.view.image, '/forum/img/r2.png');
	assert.equal(two.view.accent, '#123456');
	assert.ok(two.view.classes.includes('rank-badge--image'));

	const d = cfg({ showBar: 'off' });
	const token = await badge(d, ranks.describe(d, { postcount: 30, reputation: 6 }));
	assert.equal(token.view.name, 'Tinkerer');
	assert.equal(token.view.bar, null);
	const s = await badge(d, ranks.describe(d, {}, new Set(['administrators'])));
	assert.equal(s.view.icon, 'fa-shield-halved');
	assert.equal(s.view.data['data-group'], 'administrators');
	assert.equal(s.view.label, 'Administrator');
	assert.equal(s.view.labelToken, undefined);
});

test('render: decodeEntities turns translated text into plain text', () => {
	assert.equal(render.decodeEntities('A &amp; &lt;B&gt; &quot;x&quot; &#39;y&#39; &lsqb;z&rsqb; &#x41;'), 'A & <B> "x" \'y\' [z] A');
	assert.equal(render.decodeEntities('&unknown; &#0; &amp;lt;'), '&unknown; &#0; &lt;');
	assert.equal(render.decodeEntities(null), '');
});
