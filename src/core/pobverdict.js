'use strict';

// Turns Path of Building's before/after numbers for an item swap into a verdict.
//
// What "better" means here (Adam's priorities): more minion damage and more survivability,
// and never break the build: not enough Spirit for your minions, a resistance dropping off
// the cap, or an item you can't wear makes it "UPGRADE, BUT…" at best.
//
// before/after: the `pick()` output of pob/server.lua (FullDPS, MinionDPS, TotalEHP, …)

const ELS = ['Fire', 'Cold', 'Lightning', 'Chaos'];
const SLOT_TO_POB = {
  Weapon: 'Weapon 1', Offhand: 'Weapon 2', Helmet: 'Helmet', 'Body Armour': 'Body Armour', Gloves: 'Gloves',
  Boots: 'Boots', Amulet: 'Amulet', 'Ring 1': 'Ring 1', 'Ring 2': 'Ring 2', Belt: 'Belt',
};

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const pct = (a, b) => (a > 0 && b != null ? ((b - a) / a) * 100 : null);

// which damage number this build cares about: its full DPS if PoB adds skills up, else the
// minions', else the main skill's
function dpsOf(o, prefer) {
  if (!o) return null;
  if (prefer) return n(o[prefer]) || 0; // the same number on both sides, never a different one
  if (n(o.FullDPS) > 0) return n(o.FullDPS);
  if (n(o.MinionDPS) > 0) return n(o.MinionDPS);
  return n(o.CombinedDPS) || n(o.TotalDPS) || 0;
}
function dpsKey(o) {
  if (!o) return null;
  if (n(o.FullDPS) > 0) return 'FullDPS';
  if (n(o.MinionDPS) > 0) return 'MinionDPS';
  return n(o.CombinedDPS) > 0 ? 'CombinedDPS' : 'TotalDPS';
}

// Your priorities (My gear → Priorities). Defaults: capping resistances comes first, and losing
// Spirit or attribute requirements breaks the build.
const DEFAULT_PRIORITIES = { resFirst: true, chaos: false, keepDmg: true, spirit: true, attrs: true, speed: true };
// with "keep my movement speed": losing this many points of movement speed (30% -> 27%) breaks an
// upgrade, and each point gained or lost moves the score by MS_POINT
const MS_LOSS = 3;
const MS_POINT = 0.3;
// with "never lose damage", an item that costs more than this much of your damage is LOSES DAMAGE,
// however much resistance or EHP it adds (your build's main damage mods matter as much as resistances)
const DMG_LOSS = 5;
// with "cap resistances first", each resistance point you're still missing that an item fills
// is worth this many % on the score (and each point it loses below the cap costs the same)
const RES_POINT = 0.5;

// opts: { damageWeight (0..1, default 0.6), priorities, ignoreChaos (Chaos Inoculation), thresholds }
function judge(before, after, opts = {}) {
  if (!before || !after) return null;
  const pr = { ...DEFAULT_PRIORITIES, ...(opts.priorities || {}) };
  const wDmg = opts.damageWeight == null ? 0.6 : opts.damageWeight;
  // the number this build is judged on: from your gear now, or from the new item when you do no damage
  // now (e.g. your weapon can't use the skill), so both sides are always the same number
  const kb = dpsKey(before);
  const key = dpsOf(before, kb) > 0 ? kb : dpsKey(after);
  const dpsA = dpsOf(before, key); const dpsB = dpsOf(after, key);
  // from no damage to some (e.g. your weapon couldn't use the skill): count it as a big gain
  let dpsPct = pct(dpsA, dpsB);
  if (!(dpsA > 0) && dpsB > 0) dpsPct = 25;
  const ehpPct = pct(n(before.TotalEHP), n(after.TotalEHP));
  let score = (dpsPct || 0) * wDmg + (ehpPct || 0) * (1 - wDmg);
  let resGain = 0; // resistance points toward the cap (negative: lost below it)

  const breaks = [];
  const res = [];
  const resLoss = []; // resistances this item drops off / further under the cap
  const resCapped = []; // resistances it brings up to the cap
  for (const el of ELS) {
    const a = n(before[`${el}Resist`]); const b = n(after[`${el}Resist`]);
    const totA = n(before[`${el}ResistTotal`]); const totB = n(after[`${el}ResistTotal`]);
    if (a == null || b == null) continue;
    if (el === 'Chaos' && opts.ignoreChaos) continue; // Chaos Inoculation: immune, chaos res means nothing
    // the cap: PoB tells us when you're over it; otherwise assume the usual 75% (or what the other side showed)
    const maxA = n(before[`${el}ResistMax`]) || n(after[`${el}ResistMax`]) || 75; const maxB = n(after[`${el}ResistMax`]) || maxA;
    const isCapped = (v, tot, max) => v >= max - 0.5 || (tot != null && tot > v + 0.5);
    const row = { el, from: a, to: b, max: maxB, totalFrom: totA, totalTo: totB, capped: isCapped(b, totB, maxB), wasCapped: isCapped(a, totA, maxA) };
    if (a !== b || totA !== totB) res.push(row);
    const counts = el !== 'Chaos' || pr.chaos; // chaos res only matters if you said so (or had it capped)
    if (counts) resGain += Math.min(b, maxB) - Math.min(a, maxA);
    if (row.wasCapped && !row.capped) { breaks.push(`${el} res drops off the cap (${Math.round(a)}% → ${Math.round(b)}%)`); resLoss.push(row); }
    else if (!row.wasCapped && b < a - 0.5 && counts) { breaks.push(`${el} res goes further under the cap (${Math.round(a)}% → ${Math.round(b)}%)`); resLoss.push(row); }
    if (!row.wasCapped && row.capped && counts) resCapped.push(el);
  }
  if (pr.resFirst && resGain) score += resGain * RES_POINT;
  const dmgLoss = pr.keepDmg && dpsA > 0 && dpsPct != null && dpsPct <= -DMG_LOSS
    ? { from: dpsA, to: dpsB, pct: Math.round(dpsPct * 10) / 10, minion: key === 'MinionDPS' } : null;
  if (dmgLoss) breaks.push(`${dmgLoss.minion ? 'Minion damage' : 'Damage'} drops ${Math.abs(dmgLoss.pct)}%`);
  const spA = n(before.SpiritUnreserved); const spB = n(after.SpiritUnreserved);
  if (pr.spirit && spA != null && spB != null && spB < 0 && spB < spA) breaks.push(`Not enough Spirit for your minions and auras (${Math.round(-spB)} short)`);
  // PoE1 has no Spirit: auras reserve mana or life, and an item can leave too little for them
  if (pr.spirit && spA == null && spB == null) for (const k of ['Mana', 'Life']) {
    const ra = n(before[`${k}Unreserved`]); const rb = n(after[`${k}Unreserved`]);
    if (ra != null && rb != null && rb < 0 && ra >= 0) breaks.push(`Not enough ${k.toLowerCase()} to reserve your auras (${Math.round(-rb)} short)`);
  }
  if (pr.attrs) for (const at of ['Str', 'Dex', 'Int']) {
    const have = n(after[at]); const need = n(after[`Req${at}`]);
    const hadOk = n(before[at]) == null || n(before[`Req${at}`]) == null || n(before[at]) >= n(before[`Req${at}`]);
    if (have != null && need != null && have < need && hadOk) breaks.push(`Not enough ${({ Str: 'Strength', Dex: 'Dexterity', Int: 'Intelligence' })[at]} to use your gear (${Math.round(have)} of ${Math.round(need)})`);
  }

  // movement speed (PoB's multiplier, 1.3 = 30% faster than base): you feel every point of it
  const msA = n(before.MovementSpeedMod); const msB = n(after.MovementSpeedMod);
  const msDelta = msA != null && msB != null ? Math.round((msB - msA) * 1000) / 10 : null;
  let speed = null;
  if (msDelta) {
    speed = { from: Math.round((msA - 1) * 1000) / 10, to: Math.round((msB - 1) * 1000) / 10, delta: msDelta };
    if (pr.speed) {
      score += msDelta * MS_POINT;
      if (msDelta <= -MS_LOSS) breaks.push(`Movement speed drops ${Math.abs(msDelta)}% (${speed.from}% → ${speed.to}%)`);
    }
  }

  const t = opts.thresholds || { upgrade: 3, small: 1, down: -1 };
  let verdict = score >= t.upgrade ? 'upgrade' : score >= t.small ? 'small' : score <= t.down ? 'downgrade' : 'same';
  if (breaks.length) verdict = score > 0 ? 'risky' : 'downgrade';
  if (dmgLoss) verdict = 'dmgloss'; // losing your main damage is never an upgrade
  if (resLoss.length) verdict = 'resloss'; // resistances matter most: always shown as its own verdict

  const delta = (k) => { const a = n(before[k]); const b = n(after[k]); return a != null && b != null && Math.round(b - a) !== 0 ? { from: a, to: b, delta: b - a } : null; };
  return {
    score: Math.round(score * 10) / 10,
    verdict, breaks,
    resGain: Math.round(resGain), resFirst: !!pr.resFirst, resLoss, resCapped, dmgLoss,
    // for sorting: 2 caps a resistance you're short of, 1 adds toward the cap, 0 no change, -1 loses resistance or damage
    resRank: resLoss.length || dmgLoss ? -1 : resCapped.length ? 2 : resGain > 0 ? 1 : 0,
    noDamage: !(dpsA > 0) && !(dpsB > 0), // PoB's main skill deals no damage: damage changes can't be judged
    dpsKey: key, dps: { from: dpsA, to: dpsB, pct: dpsPct == null ? null : Math.round(dpsPct * 10) / 10 },
    ehp: { from: n(before.TotalEHP), to: n(after.TotalEHP), pct: ehpPct == null ? null : Math.round(ehpPct * 10) / 10 },
    es: delta('EnergyShield'), life: delta('Life'), mana: delta('Mana'), spirit: delta('Spirit'), spiritFree: delta('SpiritUnreserved'),
    minionLife: delta('MinionLife'), ward: delta('Ward'), speed,
    // the main skill's average damage per hit (yours, or your minions' when they do the damage)
    hit: key === 'MinionDPS' ? delta('MinionAverageHit') : delta('AverageHit'),
    res,
  };
}

// best of several (e.g. a ring tried in both ring slots): highest score, fewest breaks
function best(list) {
  const ok = list.filter(Boolean);
  if (!ok.length) return null;
  return ok.sort((a, b) => (a.breaks.length - b.breaks.length) || (b.score - a.score))[0];
}

// Chaos Inoculation sets maximum life to 1 (and makes you immune to chaos damage)
const hasCI = (stats) => !!stats && Number(stats.Life) > 0 && Number(stats.Life) <= 1;

// The Character page's main skill list: one entry per skill name and weapon slot. A build can
// have the same skill twice (Disciple of Varashta's djinns: the socketed gem and a copy the
// ascendancy grants), and picking a skill goes by name and slot, which always takes the first
// copy, so the later copies are dropped and their DPS isn't shown.
function uniqueSkills(list) {
  const seen = new Map(); const out = [];
  for (const c of list || []) {
    const k = `${c.name}|${c.slot || ''}`;
    if (seen.has(k)) { if (c.main) seen.get(k).main = true; continue; }
    const e = { ...c }; seen.set(k, e); out.push(e);
  }
  return out;
}

module.exports = { hasCI, judge, best, dpsOf, dpsKey, uniqueSkills, SLOT_TO_POB, DEFAULT_PRIORITIES, RES_POINT, DMG_LOSS, MS_LOSS, MS_POINT };
