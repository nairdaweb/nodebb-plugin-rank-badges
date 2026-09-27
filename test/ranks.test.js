'use strict';

/*
 * Unit tests for lib/ranks.js: config normalisation, thresholds, group precedence and
 * settings validation (no NodeBB needed). Run with `npm test` (node:test).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const ranks = require('../lib/ranks');

/**
 * Normalised config with the given raw settings on top of the defaults.
 *
 * @param {object} [extra] raw settings as stored by the ACP
 * @returns {object}
 */
const cfg = extra => ranks.normalize(Object.assign({}, extra));

/**
 * @param {Array<object>} list rank entries
 * @param {object} [extra] other raw settings
 * @returns {object} normalised config with that ladder
 */
const ladder = (list, extra) => cfg(Object.assign({ ranks: JSON.stringify(list) }, extra));

test('defaults: six ranks and two group badges', () => {
	const c = ranks.defaults();
	assert.equal(c.ranks.length, 6);
	assert.deepEqual(c.ranks.map(r => [r.minPosts, r.minReputation]), [[0, 0], [5, 0], [25, 5], [75, 20], [200, 50], [500, 150]]);
	assert.deepEqual(c.special.map(s => s.group), ['administrators', 'Global Moderators']);
	assert.equal(c.special[0].showHidden, false);
	assert.equal(c.mode, 'all');
	assert.equal(c.showBar, true);
});

test('mode "all": every non-zero threshold is required', () => {
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

test('zero thresholds: only the first rank is free (item 2)', () => {
	// Default ladder in "reputation" mode: rank 2 has minReputation 0 and must not be free.
	const rep = cfg({ mode: 'reputation' });
	assert.equal(ranks.computeLevel(rep, { postcount: 0, reputation: 0 }), 1, 'new user starts at level 1');
	assert.equal(ranks.computeLevel(rep, { postcount: 100, reputation: -50 }), 1, 'negative reputation keeps level 1');
	assert.equal(ranks.computeLevel(rep, { reputation: 4 }), 1);
	assert.equal(ranks.computeLevel(rep, { reputation: 5 }), 3, 'rank 2 is skipped: it has no reputation threshold');

	// "posts" mode: a rank that only has a reputation threshold is not free either.
	const posts = ladder([{ minPosts: 0 }, { minPosts: 0, minReputation: 10 }, { minPosts: 3 }], { mode: 'posts' });
	assert.equal(ranks.computeLevel(posts, { postcount: 0, reputation: 99 }), 1);
	assert.equal(ranks.computeLevel(posts, { postcount: 3 }), 3);

	// "all" mode: a later rank with both thresholds at 0 is unreachable.
	const all = ladder([{ minPosts: 0 }, { minPosts: 0, minReputation: 0 }]);
	assert.equal(ranks.computeLevel(all, { postcount: 1000, reputation: 1000 }), 1);

	// The first rank with a threshold still requires it.
	assert.equal(ranks.qualifies({ minPosts: 0, minReputation: 0 }, {}, 'reputation', true), true);
	assert.equal(ranks.qualifies({ minPosts: 0, minReputation: 0 }, {}, 'reputation', false), false);
	assert.equal(ranks.qualifies({ minPosts: 3, minReputation: 0 }, { postcount: 2 }, 'all', true), false);
});

test('mode "any": one non-zero threshold is enough', () => {
	const c = cfg({ mode: 'any' });
	assert.equal(ranks.computeLevel(c, { postcount: 0, reputation: 0 }), 1);
	assert.equal(ranks.computeLevel(c, { postcount: 4, reputation: 0 }), 1);
	assert.equal(ranks.computeLevel(c, { postcount: 0, reputation: 20 }), 4);
	assert.equal(ranks.computeLevel(c, { postcount: 200, reputation: 0 }), 5);
});

test('reputation disabled: every mode counts posts only (item 7)', () => {
	assert.equal(ranks.effectiveMode('all', true), 'posts');
	assert.equal(ranks.effectiveMode('reputation', true), 'posts');
	assert.equal(ranks.effectiveMode('any', false), 'any');
	assert.equal(ranks.effectiveMode('bogus', false), 'all');
	const c = cfg();
	// Posts data still carries the old reputation, profile data has none: same result.
	const inPosts = ranks.describe(c, { postcount: 600, reputation: 200 }, new Set(), { mode: ranks.effectiveMode(c.mode, true) });
	const inProfile = ranks.describe(c, { postcount: 600 }, new Set(), { mode: ranks.effectiveMode(c.mode, true) });
	assert.equal(inPosts.level, 6);
	assert.equal(inProfile.level, 6);
});

test('strings, missing and negative stats are handled', () => {
	const c = cfg();
	assert.equal(ranks.computeLevel(c, { postcount: '75', reputation: '20' }), 4);
	assert.equal(ranks.computeLevel(c, {}), 1);
	assert.equal(ranks.computeLevel(c, { postcount: -5, reputation: -10 }), 1);
	assert.equal(ranks.computeLevel(c, null), 1);
});

test('first rank with a threshold: users below it get no rank', () => {
	const c = ladder([{ minPosts: 10 }, { minPosts: 50 }]);
	assert.equal(ranks.computeLevel(c, { postcount: 3 }), 0);
	assert.equal(ranks.describe(c, { postcount: 3 }), null);
	assert.equal(ranks.computeLevel(c, { postcount: 60 }), 2);
});

test('empty lists mean "none"; only missing or broken tables use the defaults (item 4)', () => {
	const empty = cfg({ ranks: '[]', special: '[]' });
	assert.equal(empty.ranks.length, 0);
	assert.equal(empty.special.length, 0);
	assert.equal(ranks.describe(empty, { postcount: 1000, reputation: 1000 }), null);

	const missing = cfg({});
	assert.equal(missing.ranks.length, 6);
	assert.equal(missing.special.length, 2);

	const broken = cfg({ ranks: '{not json', special: 'null' });
	assert.equal(broken.ranks.length, 6);
	assert.equal(broken.special.length, 2);
});

test('group precedence: administrators > Global Moderators > list order (item 6)', () => {
	const c = cfg({
		special: JSON.stringify([
			{ group: 'VIP' },
			{ group: 'Global Moderators' },
			{ group: 'Helpers' },
			{ group: 'administrators' },
		]),
	});
	assert.deepEqual(ranks.specialOrder(c.special).map(i => c.special[i].group), ['administrators', 'Global Moderators', 'VIP', 'Helpers']);
	const pick = groupsOfUser => c.special[ranks.describe(c, {}, new Set(groupsOfUser)).index].group;
	assert.equal(pick(['VIP', 'administrators']), 'administrators');
	// A category moderator in VIP: library.js adds "Global Moderators" to the set.
	assert.equal(pick(['VIP', 'Global Moderators']), 'Global Moderators');
	assert.equal(pick(['Helpers', 'VIP']), 'VIP');
	assert.equal(pick(['Helpers']), 'Helpers');

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

test('thresholds: only integers written with digits (item 20)', () => {
	assert.equal(ranks.parseThreshold('0'), 0);
	assert.equal(ranks.parseThreshold(' 25 '), 25);
	assert.equal(ranks.parseThreshold(1000), 1000);
	assert.equal(ranks.parseThreshold(undefined), 0);
	['1e3', '2.5', '-1', '0x10', '', ' ', 'abc', '1 000', '+5', '1234567890'].forEach((v) => {
		assert.equal(ranks.parseThreshold(v), null, JSON.stringify(v));
	});
	[2.5, -1, NaN, Infinity].forEach(v => assert.equal(ranks.parseThreshold(v), null, String(v)));
	// Stored values from older versions: invalid counts as 0, never as a prefix of the text.
	assert.equal(ladder([{ minPosts: 0 }, { minPosts: '1e3' }]).ranks[1].minPosts, 0);
});

test('cleanText removes control, zero-width and bidi characters (item 25)', () => {
	assert.equal(ranks.cleanText('a\u202Eb\u200Bc\u2066d\uFEFFe\u200Ff\u202Ag\u2069'), 'abcdefg');
	assert.equal(ranks.cleanText('  x\ny  '), 'x y');
	const c = ladder([{ names: { pl: '\u202Eadmin\u202C' } }]);
	assert.equal(c.ranks[0].names.pl, 'admin');
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
		special: JSON.stringify([{ group: '', names: {} }, { group: 'Team', icon: 'fa-x" onclick="y', showHidden: 'on' }]),
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
	assert.equal(c.special[0].showHidden, true);
});

test('names: exact language, then same base language, then key, then fallback', () => {
	const entry = { key: 'rank-3', names: { pl: 'Majsterkowicz', 'en-US': 'Tinkerer' } };
	assert.deepEqual(ranks.resolveName(entry, 'pl'), { text: 'Majsterkowicz' });
	assert.deepEqual(ranks.resolveName(entry, 'en-GB'), { text: 'Tinkerer' });
	assert.deepEqual(ranks.resolveName(entry, 'de'), { token: '[[rank-badges:rank-3]]' });
	assert.deepEqual(ranks.resolveName({ names: { pl: 'X' } }, 'de'), { text: 'X' });
	assert.deepEqual(ranks.resolveName({ names: {} }, 'de', { text: 'Team' }), { text: 'Team' });
	assert.deepEqual(ranks.resolveName({ names: {} }, 'de'), { text: '' });
});

test('validateSettings: errors for bad thresholds, nameless ranks and groups (items 5, 13, 20)', () => {
	const ok = ranks.validateSettings({ nameLangs: 'en-GB, pl', ranks: JSON.stringify([{ key: 'rank-1', minPosts: '0' }, { names: { pl: 'B' }, minPosts: 5 }]), special: '[]' });
	assert.deepEqual(ok.errors, []);

	const bad = ranks.validateSettings({
		ranks: JSON.stringify([{ key: 'rank-1', minPosts: '1e3' }, { names: {}, minPosts: 5, minReputation: '-1' }]),
		special: JSON.stringify([{ group: ' ' }]),
	});
	assert.deepEqual(bad.errors, [
		'[[admin/plugins/rank-badges:error.threshold, 1]]',
		'[[admin/plugins/rank-badges:error.threshold, 2]]',
		'[[admin/plugins/rank-badges:error.rank-name, 2]]',
		'[[admin/plugins/rank-badges:error.group-name, 1]]',
	]);

	assert.deepEqual(ranks.validateSettings({ ranks: '{x' }).errors, ['[[admin/plugins/rank-badges:error.invalid-list]]']);
	const many = ranks.validateSettings({ ranks: JSON.stringify(Array.from({ length: ranks.MAX_RANKS + 1 }, () => ({ key: 'rank-1' }))) });
	assert.ok(many.errors.includes(`[[admin/plugins/rank-badges:error.too-many-ranks, ${ranks.MAX_RANKS}]]`));
});

test('validateSettings drops names in languages removed from the list (item 21)', () => {
	const res = ranks.validateSettings({
		nameLangs: 'pl',
		ranks: JSON.stringify([{ names: { pl: 'A', de: 'B' } }, { key: 'rank-2', names: { de: 'C' } }]),
		special: JSON.stringify([{ group: 'Team', names: { de: 'D', pl: 'E' } }]),
	});
	assert.deepEqual(res.errors, []);
	assert.deepEqual(JSON.parse(res.settings.ranks).map(r => r.names), [{ pl: 'A' }, {}]);
	assert.deepEqual(JSON.parse(res.settings.special)[0].names, { pl: 'E' });

	// A rank whose only name was in a removed language has no name left.
	const lost = ranks.validateSettings({ nameLangs: 'pl', ranks: JSON.stringify([{ names: { de: 'B' } }]) });
	assert.deepEqual(lost.errors, ['[[admin/plugins/rank-badges:error.rank-name, 1]]']);

	// Empty field: the ACP shows the default columns (en-GB, pl), so those are kept.
	const def = ranks.validateSettings({ nameLangs: '', ranks: JSON.stringify([{ names: { pl: 'A', de: 'B' } }]) });
	assert.deepEqual(JSON.parse(def.settings.ranks)[0].names, { pl: 'A' });
	// No field at all: nothing is dropped.
	const none = ranks.validateSettings({ ranks: JSON.stringify([{ names: { pl: 'A', de: 'B' } }]) });
	assert.deepEqual(JSON.parse(none.settings.ranks)[0].names, { pl: 'A', de: 'B' });
});

test('ladderWarnings: unreachable, out of order and equal ranks (item 14)', () => {
	assert.deepEqual(ranks.ladderWarnings(ranks.DEFAULT_RANKS, 'all'), []);
	assert.deepEqual(ranks.ladderWarnings(ranks.DEFAULT_RANKS, 'reputation'), [{ code: 'unreachable', level: 2 }]);
	assert.deepEqual(ranks.ladderWarnings([{ minPosts: 0 }, { minPosts: 100 }, { minPosts: 10 }], 'posts'), [{ code: 'order', level: 3 }]);
	assert.deepEqual(ranks.ladderWarnings([{ minPosts: 0 }, { minPosts: 10 }, { minPosts: '10' }], 'posts'), [{ code: 'equal', level: 3 }]);
	assert.deepEqual(ranks.ladderWarnings([], 'all'), []);
});

test('parseLangList keeps valid, unique codes in order', () => {
	assert.deepEqual(ranks.parseLangList('en-GB, pl, x y, pl, zh_CN'), ['en-GB', 'pl', 'zh_CN']);
	assert.deepEqual(ranks.parseLangList(''), []);
});
