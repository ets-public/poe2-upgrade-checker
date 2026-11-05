'use strict';
const test = require('node:test');
const assert = require('node:assert');
const V = require('../src/core/pobverdict');

const base = {
  FullDPS: 0, MinionDPS: 100000, TotalEHP: 50000, EnergyShield: 13000, SpiritUnreserved: 50,
  FireResist: 75, FireResistTotal: 78, FireResistOverCap: 3, FireResistMax: 75,
  ColdResist: 75, ColdResistTotal: 96, ColdResistOverCap: 21, ColdResistMax: 75,
  LightningResist: 75, LightningResistTotal: 83, LightningResistOverCap: 8, LightningResistMax: 75,
  ChaosResist: 0, ChaosResistTotal: 0, Int: 300, ReqInt: 160, Str: 77, ReqStr: 75,
};

test('minion builds are judged on minion DPS and effective HP', () => {
  const j = V.judge(base, { ...base, MinionDPS: 105000, TotalEHP: 51000 });
  assert.strictEqual(j.dpsKey, 'MinionDPS');
  assert.strictEqual(j.dps.pct, 5);
  assert.strictEqual(j.ehp.pct, 2);
  assert.strictEqual(j.score, 3.8); // 0.6 * 5 + 0.4 * 2
  assert.strictEqual(j.verdict, 'upgrade');
});

test('a resistance falling off the cap is never a clean upgrade', () => {
  const after = { ...base, MinionDPS: 110000, LightningResist: 38, LightningResistTotal: 38, LightningResistOverCap: 0, LightningResistMax: undefined };
  const j = V.judge(base, after);
  // its own verdict, whatever the damage, and last when sorting
  assert.strictEqual(j.verdict, 'resloss');
  assert.strictEqual(j.resRank, -1);
  assert.ok(j.score < 0, 'losing 37 res outweighs +10% damage with resistances first');
  assert.ok(j.breaks.some((b) => /Lightning res drops off the cap/.test(b)));
  assert.strictEqual(V.judge(base, after, { priorities: { resFirst: false } }).verdict, 'resloss');
  // capping one ranks first
  const short = { ...base, LightningResist: 38, LightningResistTotal: 38, LightningResistOverCap: 0, LightningResistMax: undefined };
  const capj = V.judge(short, base);
  assert.strictEqual(capj.resRank, 2);
  assert.deepStrictEqual(capj.resCapped, ['Lightning']);
});

test('Spirit and attribute shortfalls break the build', () => {
  assert.ok(V.judge(base, { ...base, MinionDPS: 120000, SpiritUnreserved: -10 }).breaks.some((b) => /Spirit/.test(b)));
  const j = V.judge(base, { ...base, MinionDPS: 120000, Str: 60 });
  assert.ok(j.breaks.some((b) => /Strength/.test(b)) && j.verdict === 'risky');
  assert.strictEqual(V.judge(base, { ...base, MinionDPS: 90000 }).verdict, 'dmgloss');
  assert.strictEqual(V.judge(base, { ...base, MinionDPS: 96000 }).verdict, 'downgrade');
});

test('small changes are sidegrades; best() prefers no breaks', () => {
  assert.strictEqual(V.judge(base, { ...base, MinionDPS: 100500 }).verdict, 'same');
  const a = V.judge(base, { ...base, MinionDPS: 130000, SpiritUnreserved: -5 });
  const b = V.judge(base, { ...base, MinionDPS: 104000 });
  assert.strictEqual(V.best([a, b]), b);
});

test('any build: Full DPS when PoB adds skills up, else the main skill', () => {
  assert.strictEqual(V.dpsKey({ FullDPS: 5000, MinionDPS: 0, CombinedDPS: 4000 }), 'FullDPS');
  assert.strictEqual(V.dpsKey({ FullDPS: 0, MinionDPS: 0, CombinedDPS: 4000 }), 'CombinedDPS');
  const j = V.judge({ FullDPS: 0, CombinedDPS: 4000, TotalEHP: 9000 }, { FullDPS: 0, CombinedDPS: 4400, TotalEHP: 9000 });
  assert.strictEqual(j.dpsKey, 'CombinedDPS');
  assert.strictEqual(j.dps.pct, 10);
  assert.strictEqual(j.verdict, 'upgrade');
});

test('priorities: capping resistances first, and switching checks off', () => {
  const short = { ...base, LightningResist: 38, LightningResistTotal: 38, LightningResistOverCap: 0, LightningResistMax: undefined };
  // +37 lightning to the cap, a little less minion DPS
  const fill = { ...short, LightningResist: 75, LightningResistTotal: 77, LightningResistOverCap: 2, LightningResistMax: 75, MinionDPS: 98000 };
  const dps = { ...short, MinionDPS: 110000 };
  const a = V.judge(short, fill); const b = V.judge(short, dps);
  assert.strictEqual(a.resGain, 37);
  assert.ok(a.score > b.score, `${a.score} vs ${b.score}`);
  const off = { priorities: { resFirst: false } };
  assert.ok(V.judge(short, fill, off).score < V.judge(short, dps, off).score);
  // Spirit check off: not a break any more
  assert.strictEqual(V.judge(base, { ...base, MinionDPS: 120000, SpiritUnreserved: -10 }, { priorities: { spirit: false } }).breaks.length, 0);
  // chaos only counts when asked
  const ch = { ...base, ChaosResist: 20, ChaosResistTotal: 20 };
  assert.strictEqual(V.judge(base, ch).resGain, 0);
  assert.strictEqual(V.judge(base, ch, { priorities: { chaos: true } }).resGain, 20);
});

test('Chaos Inoculation: chaos resistance is ignored completely', () => {
  const ci = { ...base, Life: 1, ChaosResist: 75, ChaosResistTotal: 80 };
  assert.ok(V.hasCI(ci) && !V.hasCI(base));
  const after = { ...ci, ChaosResist: 0, ChaosResistTotal: 0, MinionDPS: 110000 };
  const j = V.judge(ci, after, { ignoreChaos: true, priorities: { chaos: true } });
  assert.strictEqual(j.verdict, 'upgrade');
  assert.strictEqual(j.res.length, 0);
  assert.strictEqual(V.judge(ci, after).verdict, 'resloss'); // without CI it would count (it was capped)
});

test('an item that costs a big part of your minion damage is LOSES DAMAGE, even if it caps a resistance', () => {
  const base = { MinionDPS: 96800, TotalEHP: 53000, FireResist: 78, ColdResist: 75, LightningResist: 38, ChaosResist: 0, Life: 1 };
  const after = { ...base, MinionDPS: 77340, TotalEHP: 67700, LightningResist: 75 };
  const j = V.judge(base, after, { ignoreChaos: true });
  assert.strictEqual(j.verdict, 'dmgloss');
  assert.strictEqual(j.resRank, -1);
  assert.ok(j.dmgLoss && j.dmgLoss.minion && j.dmgLoss.pct < -19);
  // a small damage dip is still judged on the score
  assert.notStrictEqual(V.judge(base, { ...after, MinionDPS: 95000 }, { ignoreChaos: true }).verdict, 'dmgloss');
  // switched off: back to the old score-based verdict
  assert.notStrictEqual(V.judge(base, after, { ignoreChaos: true, priorities: { keepDmg: false } }).verdict, 'dmgloss');
});

test('pob verdict: no damage now, the new item adds minion damage: counts it, same number both sides', () => {
  const V = require('../src/core/pobverdict');
  const j = V.judge({ FullDPS: 0, MinionDPS: 0, TotalDPS: 0, TotalEHP: 1000 }, { FullDPS: 0, MinionDPS: 5000, TotalDPS: 0, TotalEHP: 1000 });
  assert.strictEqual(j.dpsKey, 'MinionDPS');
  assert.ok(j.score > 0);
  assert.strictEqual(j.noDamage, false);
});

test('pob verdict: a main skill with no damage on both sides is flagged', () => {
  const V = require('../src/core/pobverdict');
  const j = V.judge({ TotalDPS: 0, TotalEHP: 1000 }, { TotalDPS: 0, TotalEHP: 1100 });
  assert.strictEqual(j.noDamage, true);
});

test('damage per hit: the main skill\'s average hit, or the minions\' for a minion build', () => {
  const V = require('../src/core/pobverdict');
  const a = V.judge({ CombinedDPS: 1000, AverageHit: 500, TotalEHP: 5000 }, { CombinedDPS: 1100, AverageHit: 560, TotalEHP: 5000 }, {});
  assert.deepEqual([a.hit.from, a.hit.to], [500, 560]);
  const m = V.judge({ MinionDPS: 1000, MinionAverageHit: 300, AverageHit: 5, TotalEHP: 5000 }, { MinionDPS: 1200, MinionAverageHit: 360, AverageHit: 5, TotalEHP: 5000 }, {});
  assert.deepEqual([m.hit.from, m.hit.to], [300, 360]);
});

test('movement speed: a big loss breaks an upgrade, a gain adds to the score, and it can be switched off', () => {
  const V = require('../src/core/pobverdict');
  const base = { FullDPS: 1000, TotalEHP: 10000, MovementSpeedMod: 1.3 };
  const slower = V.judge(base, { ...base, FullDPS: 1100, MovementSpeedMod: 1.2 });
  assert.deepStrictEqual(slower.speed, { from: 30, to: 20, delta: -10 });
  assert.ok(slower.breaks.some((b) => /Movement speed drops 10%/.test(b)));
  assert.notStrictEqual(slower.verdict, 'upgrade');
  const faster = V.judge(base, { ...base, MovementSpeedMod: 1.35 });
  assert.ok(faster.score > 1 && !faster.breaks.length, String(faster.score));
  const off = V.judge(base, { ...base, FullDPS: 1100, MovementSpeedMod: 1.2 }, { priorities: { speed: false } });
  assert.ok(!off.breaks.length && off.verdict === 'upgrade' && off.speed.delta === -10);
  const tiny = V.judge(base, { ...base, MovementSpeedMod: 1.28 });
  assert.ok(!tiny.breaks.length);
});

test('main skill list: a skill the build has twice is listed once, as its first copy', () => {
  const list = [
    { name: 'Kelari, the Tainted Sands', slot: null, dps: 104239, minion: true },
    { name: 'Navira, the Last Mirage', slot: null, dps: 5000, minion: true },
    { name: 'Crossbow Shot', slot: 'Weapon 1', default: true, dps: 300 },
    { name: 'Crossbow Shot', slot: 'Weapon 2', default: true, dps: 200 },
    { name: 'Kelari, the Tainted Sands', slot: null, dps: 950, minion: true },
    { name: 'Navira, the Last Mirage', slot: null, dps: 40, minion: true, main: true },
  ];
  const u = V.uniqueSkills(list);
  assert.deepStrictEqual(u.map((c) => [c.name, c.slot, c.dps]), [
    ['Kelari, the Tainted Sands', null, 104239],
    ['Navira, the Last Mirage', null, 5000],
    ['Crossbow Shot', 'Weapon 1', 300],
    ['Crossbow Shot', 'Weapon 2', 200], // same name, other weapon: kept
  ]);
  assert.strictEqual(u[1].main, true); // PoB's main skill was the second copy: still marked
  assert.strictEqual(list[1].main, undefined); // the input isn't changed
  assert.deepStrictEqual(V.uniqueSkills(null), []);
});
