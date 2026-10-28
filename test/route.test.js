'use strict';

const test = require('node:test');
const assert = require('node:assert');
const R = require('../src/core/route');

test('route: reads the area and level lines of Client.txt, nothing else', () => {
  assert.deepStrictEqual(R.parseLine('2026/11/13 20:01:02 123456 abc [DEBUG Client 1234] Generating level 4 area "1_1_3" with seed 2933'), { kind: 'area', areaLevel: 4, area: '1_1_3' });
  assert.deepStrictEqual(R.parseLine('2026/12/11 20:01:02 99 abc [DEBUG Client 77] Generating level 14 area "G2_1" with seed 1'), { kind: 'area', areaLevel: 14, area: 'G2_1' });
  assert.deepStrictEqual(R.parseLine('2026/11/13 20:05:00 1 abc [INFO Client 1234] : Adamwitch (Witch) is now level 5'), { kind: 'level', character: 'Adamwitch', className: 'Witch', level: 5 });
  // chat and whispers are ignored, even when they quote those lines
  assert.strictEqual(R.parseLine('2026/11/13 20:05:00 1 abc [INFO Client 1234] @From Someone: Generating level 4 area "1_1_9" lol'), null);
  assert.strictEqual(R.parseLine('2026/11/13 20:05:00 1 abc [INFO Client 1234] #Someone: : Fake (Witch) is now level 90'), null);
  assert.strictEqual(R.parseLine('[INFO Client 1] #Someone: hello'), null);
});

test('route: both games load, with the passive points the campaign gives', () => {
  for (const [g, want] of [['poe1', 23], ['poe2', 24]]) {
    const route = R.load(g);
    const steps = R.flatten(route);
    assert.ok(steps.length > 100, `${g}: ${steps.length} steps`);
    assert.ok(steps.every((s) => typeof s.t === 'string' && s.t.length > 2), `${g}: every step has text`);
    assert.strictEqual(R.totals(steps, steps.length).passives, want, g); // PoE1: +1 more for killing all three bandits
    assert.ok(route.for && route.checked && route.sources.length && route.sources.every((x) => x.licence === 'MIT'));
    assert.ok(route.endgame.length >= 2);
  }
  const p1 = R.flatten(R.load('poe1'));
  assert.strictEqual(p1.filter((s) => (s.k || []).includes('trial')).length, 12); // the six normal, three cruel, three merciless trials
  assert.strictEqual(p1.filter((s) => (s.k || []).includes('lab')).length, 3);
  assert.strictEqual(p1.filter((s) => (s.k || []).includes('res') && /−30%/.test(s.r)).length, 2); // the two Kitava fights
  assert.ok(p1.some((s) => (s.k || []).includes('choice') && /bandits/i.test(s.t)));
});

test('route: entering the area a step goes to moves on (PoE1 "➞ The Coast")', () => {
  const route = R.load('poe1');
  const steps = R.flatten(route);
  const coast = steps.findIndex((s) => s.to === '1_1_2');
  const at = R.advance(route, steps, 0, '1_1_2');
  assert.strictEqual(at, coast + 1); // the step after arriving
  assert.strictEqual(R.advance(route, steps, at, '1_1_2'), at); // entering it again (after dying) changes nothing
  // (even though "Waypoint to The Coast" comes up a few steps later)
  assert.ok(steps.slice(at + 1, at + 10).some((s) => s.to === '1_1_2'));
  // the next zone a few steps ahead: the skipped steps count as done
  const mud = steps.findIndex((s) => s.to === '1_1_3');
  assert.strictEqual(R.advance(route, steps, at, '1_1_3'), mud + 1);
});

test('route: entering the area a step happens in makes it current (PoE2), any letter case', () => {
  const route = R.load('poe2');
  const steps = R.flatten(route);
  const grelwood = steps.findIndex((s) => s.in === 'g1_4');
  assert.strictEqual(R.advance(route, steps, 2, 'G1_4'), grelwood);
  // never backwards: Clearfell again after the Grelwood stays on the Grelwood step
  assert.strictEqual(R.advance(route, steps, grelwood, 'G1_2'), grelwood);
});

test('route: a trip to town to sell doesn\'t skip the steps out in the zone', () => {
  const route = R.load('poe2');
  const steps = R.flatten(route);
  const rust = steps.findIndex((s) => /Rust King/.test(s.t)); // in The Red Vale; a town step follows it
  const farTown = steps.findIndex((s, i) => i > rust + 3 && s.in === 'g1_town');
  assert.ok(farTown > rust + 3);
  // the next town step is right after it: entering town moves on to it (you portal back after the boss)
  assert.strictEqual(R.advance(route, steps, rust, 'g1_town'), rust + 1);
  // but from a step with no town step close ahead, entering town changes nothing
  const nextArea = (i) => steps.slice(i).find((x) => x.in || x.to);
  const away = steps.findIndex((s, i) => i > 0 && !R.isTown(route, s.zone) && nextArea(i) && !R.isTown(route, nextArea(i).in || nextArea(i).to));
  assert.ok(away > 0);
  assert.strictEqual(R.advance(route, steps, away, 'g1_town'), away);
  assert.ok(R.isTown(route, 'G1_town') && R.isTown(R.load('poe1'), '1_1_town') && R.isTown(route, 'HideoutFelled') && !R.isTown(route, 'g1_4'));
});

test('route: Client.txt is looked for where each game installs', () => {
  const p1 = R.defaultLogPaths('poe1'); const p2 = R.defaultLogPaths('poe2');
  assert.ok(p1.some((p) => /Steam.*common.*Path of Exile[\\/]logs[\\/]Client\.txt$/.test(p)));
  assert.ok(p2.every((p) => /Path of Exile 2[\\/]logs[\\/]Client\.txt$/.test(p)));
});

test('route: a whole campaign played in order follows every step to the end', () => {
  for (const g of ['poe1', 'poe2']) {
    const route = R.load(g);
    const steps = R.flatten(route);
    let cur = 0; let prev = null;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      // a log-out in the route: you're in town before the next area
      if (s.zone === R.TOWN && (!steps[i - 1] || steps[i - 1].zone !== R.TOWN)) prev = g === 'poe1' ? '1_1_town' : 'g1_town';
      if (s.in || s.to) { cur = R.advance(route, steps, cur, s.in || s.to, prev); prev = s.in || s.to; }
      // you never end up behind the zone you're in (steps without an area are ticked by the next zone)
      const want = s.to ? i + 1 : s.in ? i : null;
      if (want != null) assert.ok(cur >= want, `${g}: at step ${i} (${s.t}) the route is on ${cur}`);
    }
  }
});

test('route: says why it moved or stayed (for the trace)', () => {
  const route = R.load('poe2');
  const steps = R.flatten(route);
  assert.strictEqual(R.decide(route, steps, 2, 'g1_4').why, 'in');
  assert.strictEqual(R.decide(route, steps, 2, 'g1_2').why, 'same-zone');
  const nextArea = (i) => steps.slice(i).find((x) => x.in || x.to);
  const away = steps.findIndex((s, i) => i > 0 && !R.isTown(route, s.zone) && nextArea(i) && !R.isTown(route, nextArea(i).in || nextArea(i).to));
  assert.strictEqual(R.decide(route, steps, away, 'g1_town').why, 'town-trip');
  assert.strictEqual(R.decide(route, steps, 2, 'g4_10').why, 'known-elsewhere'); // Act 4, far ahead
  assert.strictEqual(R.decide(route, steps, 2, 'MapSomething').why, 'not-ahead');
  const p1 = R.load('poe1'); const s1 = R.flatten(p1);
  assert.strictEqual(R.decide(p1, s1, 0, '1_1_2').why, 'to');
});

test('route: every optional quest is on the route, marked optional, and doing one is followed', () => {
  const p2 = R.flatten(R.load('poe2'));
  assert.ok(p2.filter((s) => s.o).length >= 60, 'PoE2: Splitstone\'s optional zones, bosses and side objectives');
  assert.ok(p2.some((s) => s.o && /Mysterious Campsite/.test(s.t)) && p2.some((s) => s.o && /Mud Burrow/.test(s.t)));
  const r1 = R.load('poe1'); const p1 = R.flatten(r1);
  for (const q of ['A Dirty Job', 'A Swig of Hope', 'A Fixture of Fate', 'The King\'s Feast', 'Bestel\'s Epic', 'In Memory of Greust', 'The Wings of Vastiri', 'Fastis Fortuna', 'No Love for Old Ghosts', 'Map to Tsoatha']) {
    const steps = p1.filter((s) => s.t.includes(q));
    assert.ok(steps.length >= 2 && steps.every((s) => s.o), `PoE1 ${q}: found and handed in, optional`);
  }
  // optional quests don't change the passive points the campaign gives
  assert.strictEqual(R.totals(p1, p1.length).passives, 23);
  // into the Fetid Pool from the Mud Flats: the optional step; then on to the Submerged Passage
  const mud = p1.findIndex((s) => s.to === '1_1_3');
  let cur = R.advance(r1, p1, mud, '1_1_3');
  cur = R.advance(r1, p1, cur, '1_1_3a');
  assert.ok(/A Dirty Job/.test(p1[cur].t));
  cur = R.advance(r1, p1, cur, '1_1_3');
  assert.ok(/A Dirty Job/.test(p1[cur].t), 'back in the Mud Flats: stays');
  cur = R.advance(r1, p1, cur, '1_1_4_1');
  assert.strictEqual(p1[cur - 1].to, '1_1_4_1');
  // skipping it: the Mud Flats straight to the Submerged Passage passes it
  assert.strictEqual(p1[R.advance(r1, p1, mud + 1, '1_1_4_1') - 1].to, '1_1_4_1');
});

test('route: the endgame rush hides every optional step except the ones with a permanent reward', () => {
  const rush = { rush: true };
  const p2 = R.flatten(R.load('poe2'));
  const kept = p2.filter((s) => s.o && R.shown(s, rush));
  assert.strictEqual(kept.length, 17);
  // every passive point is still on the rush: the totals don't change
  assert.strictEqual(p2.filter((s) => R.shown(s, rush)).reduce((n, s) => n + (s.p || 0), 0), 24);
  assert.ok(!p2.some((s) => R.shown(s, rush) && /Mysterious Campsite|Mud Burrow|Mektul|Runeseeker|Finn/.test(s.t)));
  assert.ok(kept.some((s) => /2nd Ascendancy/.test(s.t)) && kept.some((s) => /King in the Mists/.test(s.t)));
  const r1 = R.load('poe1'); const p1 = R.flatten(r1);
  assert.ok(!p1.some((s) => s.o && R.shown(s, rush)), 'PoE1: no side quest on the rush');
  assert.strictEqual(p1.filter((s) => R.shown(s, rush)).reduce((n, s) => n + (s.p || 0), 0), 23);
  // Step done passes hidden steps; so does a zone change landing on one
  const mud = p1.findIndex((s) => s.to === '1_1_3');
  const glyph = mud + 1; // "Find 3× Glyph", then the hidden A Dirty Job
  assert.ok(/A Dirty Job/.test(p1[glyph + 1].t));
  assert.strictEqual(R.stepBy(p1, glyph, 1, rush), glyph + 2);
  assert.strictEqual(R.stepBy(p1, glyph + 2, -1, rush), glyph);
  assert.strictEqual(R.stepBy(p1, glyph, 1, {}), glyph + 1); // not in the rush: it's shown
  // going into the Fetid Pool anyway: you're doing it, so it's the current step
  assert.strictEqual(R.settle(p1, glyph + 1, rush, '1_1_3a'), glyph + 1);
  assert.strictEqual(R.settle(p1, glyph + 1, rush, '1_1_3'), glyph + 2);
  // Show optional steps off works the same way
  assert.strictEqual(R.stepBy(p1, glyph, 1, { optional: false }), glyph + 2);
});

test('route: the log lines that say who is playing', () => {
  const L = (s) => R.parseLine(`2026/10/28 13:22:14 1 abc [INFO Client 16048] ${s}`);
  assert.deepStrictEqual(L('Async connecting to mel.login.pathofexile2.com:21265'), { kind: 'login', why: 'login' });
  assert.deepStrictEqual(L('Connected to mel.login.pathofexile2.com in 15ms.'), { kind: 'login', why: 'login' });
  assert.deepStrictEqual(R.parseLine('2026/10/21 06:56:13 ***** LOG FILE OPENING *****'), { kind: 'login', why: 'game started' });
  assert.deepStrictEqual(L('Abnormal disconnect: An unexpected disconnection occurred.'), { kind: 'login', why: 'disconnected' });
  assert.deepStrictEqual(L(': MercyPop has received +10% to [Resistances|Cold Resistance].'), { kind: 'named', character: 'MercyPop', how: 'reward' });
  assert.deepStrictEqual(L(': MercyPop has been slain.'), { kind: 'named', character: 'MercyPop', how: 'slain' });
  assert.deepStrictEqual(L(': Lorauktas (Disciple of Varashta) is now level 94'), { kind: 'level', character: 'Lorauktas', className: 'Disciple of Varashta', level: 94 });
  // chat never counts
  assert.strictEqual(L('@From Bob: Connected to mel.login.pathofexile2.com in 1ms.'), null);
  assert.strictEqual(L('#Bob: : MercyPop has been slain.'), null);
  assert.strictEqual(R.pidOf('2026/10/28 13:22:14 1 abc [DEBUG Client 16048] Generating level 1 area "G1_1" with seed 1'), '16048');
});

test('route: which character an area says is playing', () => {
  const route = R.load('poe2'); const steps = R.flatten(route);
  const beira = steps.findIndex((s) => /Beira/.test(s.t));
  const me = { level: 3 };
  assert.strictEqual(R.judgeArea(route, steps, beira, 'G1_2', 2, me), 'owner'); // the zone it's in
  assert.strictEqual(R.judgeArea(route, steps, beira, 'G1_4', 3, me), 'owner'); // the next one
  assert.strictEqual(R.judgeArea(route, steps, beira, 'G1_town', 15, me), null); // a town: anyone
  assert.strictEqual(R.judgeArea(route, steps, beira, 'HideoutCanal', 65, me), null); // a hideout: anyone (always level 65)
  assert.strictEqual(R.judgeArea(route, steps, beira, 'MapHive', 80, me), 'other'); // a map during the campaign
  assert.strictEqual(R.judgeArea(route, steps, beira, 'G3_1', 33, me), 'other'); // far above level 3
  assert.strictEqual(R.judgeArea(route, steps, beira, 'G3_1', 33, null), 'other'); // and far ahead of the route
  // rushing a little under the area's level is still you
  const later = steps.findIndex((s) => s.in === 'g1_7');
  assert.strictEqual(R.judgeArea(route, steps, later - 1, 'G1_7', 12, { level: 5 }), 'owner');
  // campaign done: maps are yours too
  assert.strictEqual(R.judgeArea(route, steps, steps.length - 1, 'MapHive', 80, { level: 70 }), null);
});
