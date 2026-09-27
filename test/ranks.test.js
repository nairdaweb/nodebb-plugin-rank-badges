'use strict';

/*
 * Unit tests for the pure modules lib/ranks.js and lib/render.js (no NodeBB needed).
 * Run with `npm test` (node:test).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const ranks = require('../lib/ranks');
const render = require('../lib/render');

/**
 * Normalised config with the given raw settings on top of the defaults.
 *
 * @param {object} [extra] raw settings as stored by the ACP
 * @returns {object}
 */
const cfg = (extra) => ranks.normalize(Object.assign({}, extra));

test('defaults: six ranks and two group badges', () => {
	const c = ranks.defaults();
	assert.equal(c.ranks.length, 6);
	assert.deepEqual(c.ranks.map(r => [r.minPosts, r.minReputation]), [[0, 0], [5, 0], [25, 5], [75, 20], [200, 50], [500, 150]]);
	assert.deepEqual(c.special.map(s => s.group), ['administrators', 'Global Moderators']);
	assert.equal(c.mode, 'all');
	assert.equal(c.showBar, true);
});

test('mode "all": both thresholds are required', () => {
	const c = cfg();
	assert.equal(ranks.computeLevel(c, { postcount: 0, reputation: 0 }), 1);
	assert.equal(ranks.computeLevel(c, { postcount: 4, reputation: 100 }), 1);
	assert.equal(ranks.computeLevel(c, { postcount: 5, reputation: 0 }), 2);
	assert.equal(ranks.computeLevel(c, { postcount: 24, reputation: 5 }), 2);
	assert.equal(ranks.computeLevel(c, { postcount: 25, reputation: 5 }), 3);
	assert.equal(ranks.computeLevel(c, { postcount: 1000, reputation: 4 }), 2, 'many posts, little reputation');
	assert.equal(ranks.computeLevel(c, { postcount: 499, reputation: 1000 }), 5);
	assert.equal(ranks.computeLevel(c, { postcount: 500, reputation: 150 }), 6);
});

test('mode "posts" ignores reputation, "reputation" ignores posts', () => {
	assert.equal(ranks.computeLevel(cfg({ mode: 'posts' }), { postcount: 500, reputation: -3 }), 6);
	assert.equal(ranks.computeLevel(cfg({ mode: 'reputation' }), { postcount: 0, reputation: 50 }), 5);
});

test('mode "any": either non-zero threshold is enough', () => {
	const c = cfg({ mode: 'any' });
	assert.equal(ranks.computeLevel(c, { postcount: 0, reputation: 0 }), 1);
	assert.equal(ranks.computeLevel(c, { postcount: 4, reputation: 0 }), 1);
	assert.equal(ranks.computeLevel(c, { postcount: 0, reputation: 20 }), 4);
	assert.equal(ranks.computeLevel(c, { postcount: 200, reputation: 0 }), 5);
});

test('strings, missing and negative stats are handled', () => {
	const c = cfg();
	assert.equal(ranks.computeLevel(c, { postcount: '75', reputation: '20' }), 4);
	assert.equal(ranks.computeLevel(c, {}), 1);
	assert.equal(ranks.computeLevel(c, { postcount: -5, reputation: -10 }), 1);
	assert.equal(ranks.computeLevel(c, null), 1);
});

test('first rank with a threshold: users below it get no rank', () => {
	const c = cfg({ ranks: JSON.stringify([{ minPosts: 10 }, { minPosts: 50 }]) });
	assert.equal(ranks.computeLevel(c, { postcount: 3 }), 0);
	assert.equal(ranks.describe(c, { postcount: 3 }), null);
	assert.equal(ranks.computeLevel(c, { postcount: 60 }), 2);
});

test('group badge wins over rank; first matching group in list order', () => {
	const c = cfg();
	const both = ranks.describe(c, { postcount: 600, reputation: 600 }, new Set(['Global Moderators', 'administrators']));
	assert.equal(both.special, true);
	assert.equal(c.special[both.index].group, 'administrators');
	const none = ranks.describe(c, { postcount: 600, reputation: 600 }, new Set(['registered-users']));
	assert.equal(none.special, false);
	assert.equal(none.level, 6);
	assert.equal(none.tier, 3);
});

test('tiers split levels into low / mid / high', () => {
	assert.deepEqual([1, 2, 3, 4, 5, 6].map(l => ranks.tierFor(l, 6)), [1, 1, 2, 2, 3, 3]);
	assert.equal(ranks.tierFor(1, 1), 3);
	assert.equal(ranks.tierFor(0, 6), 1);
});

test('cleanImage accepts only local paths and https URLs', () => {
	assert.equal(ranks.cleanImage('/assets/uploads/rank-badges/a.png'), '/assets/uploads/rank-badges/a.png');
	assert.equal(ranks.cleanImage('https://cdn.example/a.png'), 'https://cdn.example/a.png');
	assert.equal(ranks.cleanImage('http://cdn.example/a.png'), '', 'plain http is rejected');
	assert.equal(ranks.cleanImage('//evil.example/x.png'), '', 'protocol-relative is rejected');
	assert.equal(ranks.cleanImage('/\\evil.example/x.png'), '', 'backslash trick is rejected');
	assert.equal(ranks.cleanImage('/a\\b.png'), '', 'backslashes are rejected anywhere');
	assert.equal(ranks.cleanImage('https://cdn.example/a\\b.png'), '');
});

test('normalize rejects unsafe values', () => {
	const c = cfg({
		mode: 'evil',
		ranks: JSON.stringify([
			{ names: { pl: '<b>x</b>', 'bad lang': 'y' }, minPosts: 'abc', image: 'javascript:alert(1)', color: 'red;background:url(x)' },
			{ image: '//evil.example/x.png', color: '#ABCDEF' },
			{ image: '/assets/uploads/rank-badges/a.png' },
			{ image: 'https://cdn.example/a.png" onerror="x' },
		]),
		special: JSON.stringify([{ group: '', names: {} }, { group: 'Team', icon: 'fa-x" onclick="y' }]),
	});
	assert.equal(c.mode, 'all');
	assert.equal(c.ranks[0].image, '');
	assert.equal(c.ranks[0].color, '');
	assert.equal(c.ranks[0].minPosts, 0);
	assert.deepEqual(Object.keys(c.ranks[0].names), ['pl']);
	assert.equal(c.ranks[1].image, '');
	assert.equal(c.ranks[1].color, '#abcdef');
	assert.equal(c.ranks[2].image, '/assets/uploads/rank-badges/a.png');
	assert.equal(c.ranks[3].image, '');
	assert.equal(c.special.length, 1, 'entry without a group is dropped');
	assert.equal(c.special[0].icon, '');
});

test('invalid JSON falls back to defaults', () => {
	const c = cfg({ ranks: '{not json', special: 'null' });
	assert.equal(c.ranks.length, 6);
	assert.equal(c.special.length, 2);
});

test('names: exact language, then same base language, then translation key', () => {
	const entry = { key: 'rank-3', names: { pl: 'Majsterkowicz', 'en-US': 'Tinkerer' } };
	assert.deepEqual(ranks.resolveName(entry, 'pl'), { text: 'Majsterkowicz' });
	assert.deepEqual(ranks.resolveName(entry, 'en-GB'), { text: 'Tinkerer' });
	assert.deepEqual(ranks.resolveName(entry, 'de'), { token: '[[rank-badges:rank-3]]' });
	assert.deepEqual(ranks.resolveName({ names: { pl: 'X' } }, 'de'), { text: 'X' });
	assert.deepEqual(ranks.resolveName({ names: {} }, 'de', 'Team'), { text: 'Team' });
});

test('render: escapes admin text, marks level, bar and image', () => {
	const c = cfg({ ranks: JSON.stringify([{ names: { en: 'A & <B>', pl: 'x' } }, { names: { en: '[[admin:x]], y' }, minPosts: 1, image: '/img/r2.png', color: '#123456' }]) });
	const one = render.build(c, ranks.describe(c, { postcount: 0 }), { lang: 'en-GB' });
	assert.match(one.html, /A &amp; &lt;B&gt;/);
	assert.doesNotMatch(one.html, /<B>/);
	assert.match(one.html, /data-level="1" data-total="2"/);
	assert.match(one.html, /<i class="on"><\/i><i><\/i>/);

	const two = render.build(c, ranks.describe(c, { postcount: 5 }), { lang: 'en-GB', relativePath: '/forum' });
	assert.doesNotMatch(two.html, /\[\[admin/, 'brackets in names are escaped');
	assert.match(two.html, /src="\/forum\/img\/r2.png"/);
	assert.match(two.html, /--rank-badge-accent: #123456/);
	assert.match(two.html, /rank-badge--image/);
	assert.match(two.html, /aria-label="\[\[rank-badges:aria.rank, 2, 2, &#91;&#91;admin:x&#93;&#93;&#44; y\]\]"/);
});

test('render: default names are translation tokens; bar can be hidden', () => {
	const c = cfg({ showBar: 'off' });
	const b = render.build(c, ranks.describe(c, { postcount: 30, reputation: 6 }), { lang: 'pl' });
	assert.match(b.html, /\[\[rank-badges:rank-3\]\]/);
	assert.doesNotMatch(b.html, /rank-badge__bar/);
	const s = render.build(c, ranks.describe(c, {}, new Set(['administrators'])), { lang: 'pl' });
	assert.match(s.html, /rank-badge--special/);
	assert.match(s.html, /fa-shield-halved/);
	assert.match(s.html, /\[\[rank-badges:group-administrators\]\]/);
});
