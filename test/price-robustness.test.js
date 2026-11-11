'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { pickStep, searchable, mergeTradeData, cleanPicks } = require('../src/core/pricesteps');

const st = (level, total) => ({ level, total, r: { total }, q: { level } });

test('pickStep: enough at level 0 wins', () => {
  assert.strictEqual(pickStep([st(0, 12), st(1, 40)], 10).level, 0);
});
test('pickStep: first level with enough, even if a later has more', () => {
  assert.strictEqual(pickStep([st(0, 3), st(1, 15), st(2, 90)], 10).level, 1);
});
test('pickStep: nothing enough, most listings wins (drivers level smaller than level 0)', () => {
  assert.strictEqual(pickStep([st(0, 6), st(1, 2)], 10).level, 0);
  assert.strictEqual(pickStep([st(0, 2), st(1, 7)], 10).level, 1);
});
test('pickStep: tie goes to the closer level', () => {
  assert.strictEqual(pickStep([st(2, 5), st(1, 5)], 10).level, 1);
});
test('pickStep: all zero or none -> null; failed steps ignored', () => {
  assert.strictEqual(pickStep([st(0, 0), st(1, 0)], 10), null);
  assert.strictEqual(pickStep([], 10), null);
  assert.strictEqual(pickStep(null, 10), null);
  assert.strictEqual(pickStep([st(0, null), st(1, 4)], 10).level, 1);
});

test('searchable', () => {
  assert.strictEqual(searchable({ query: { stats: [{ type: 'and', filters: [] }], filters: { type_filters: { filters: { rarity: { option: 'rare' } } } } } }), false);
  assert.strictEqual(searchable({ query: { stats: [{ type: 'and', filters: [{ id: 'explicit.x' }] }] } }), true);
  assert.strictEqual(searchable({ query: { name: 'Headhunter', stats: [{ type: 'and', filters: [] }] } }), true);
  assert.strictEqual(searchable({ query: { type: 'Vaal Regalia' } }), true);
  assert.strictEqual(searchable({ query: { stats: [], filters: { type_filters: { filters: { category: { option: 'accessory.ring' }, rarity: { option: 'rare' } } } } } }), true);
  assert.strictEqual(searchable({ query: { filters: { map_filters: { filters: { map_tier: { min: 15 } } } } } }), true);
  assert.strictEqual(searchable({ query: { filters: { equipment_filters: { filters: {} } } } }), false);
  assert.strictEqual(searchable(null), false);
  assert.strictEqual(searchable({}), false);
});

test('mergeTradeData keeps old leagues and filters when the new ones failed or are empty', () => {
  const old = { stats: { a: 1 }, filters: { result: [1] }, leagues: { result: [{ id: 'Fate' }] }, leaguesAt: 5, fetchedAt: 1 };
  const m = mergeTradeData(old, { stats: { b: 2 }, filters: null, leagues: { result: [] } }, 99);
  assert.deepStrictEqual(m.data.stats, { b: 2 });
  assert.strictEqual(m.data.filters, old.filters);
  assert.strictEqual(m.data.leagues, old.leagues);
  assert.strictEqual(m.data.leaguesAt, 5);
  assert.strictEqual(m.data.fetchedAt, 99);
  assert.ok(m.keptFilters && m.keptLeagues);
});
test('mergeTradeData takes good new data, and works with nothing old', () => {
  const fresh = { stats: {}, filters: { result: [2] }, leagues: { result: [{ id: 'X' }] } };
  const m = mergeTradeData({ filters: { result: [1] }, leagues: { result: [] }, leaguesAt: 5 }, fresh, 7);
  assert.strictEqual(m.data.leagues, fresh.leagues);
  assert.strictEqual(m.data.leaguesAt, undefined);
  assert.ok(!m.keptFilters && !m.keptLeagues);
  const n = mergeTradeData(null, { stats: {}, filters: null, leagues: null }, 7);
  assert.strictEqual(n.data.leagues, null);
});

test('cleanPicks', () => {
  assert.deepStrictEqual(cleanPicks(undefined), []);
  assert.deepStrictEqual(cleanPicks('x'), []);
  const out = cleanPicks([null, 3, { key: 5 }, { key: 'a'.repeat(301) }, { key: 'ok', id: 'explicit.stat_1', idType: 'explicit' }, { key: 'bad', id: 'Explicit.X!', idType: 'explicit', min: 1 }]);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].id, 'explicit.stat_1');
  assert.strictEqual(out[1].id, undefined);
  assert.strictEqual(out[1].idType, undefined);
  assert.strictEqual(out[1].min, 1);
  assert.strictEqual(cleanPicks(Array.from({ length: 100 }, () => ({ key: 'k' }))).length, 40);
  assert.strictEqual(cleanPicks(Array.from({ length: 100 }, () => ({ key: 'k' })), 20).length, 20);
});
