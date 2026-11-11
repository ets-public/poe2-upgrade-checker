'use strict';

// Map / waystone check: what each mod means for YOUR build.
//  - mods that act on the player ("Players have -12% to all maximum Resistances") are calculated
//    by Path of Building (pob/server.lua mapCheck): the change to effective HP, resistances...
//  - a few monster mods are checked against what your build does (reflect vs your damage types,
//    no leech vs your leech, no regeneration vs your regeneration)
//  - and you can mark any mod as dangerous / careful / fine yourself; the mark wins.

const monster = require('./monstermods');
const isMap = (item) => !!item && /^(maps|waystones|tablets?|precursor tablets?)$/i.test(String(item.itemClass || '').trim());
const isTablet = (item) => !!item && /tablet/i.test(String(item.itemClass || ''));

// the mod lines (not "Map Tier: 16", "Item Quantity: +80%" or the help text)
const PROP = /^[A-Z][A-Za-z' ]+:\s/;
const HELP = /^(Travel to this Map|Can be used in|Place into|Right click|Modifiable only|Unidentified|Corrupted|Mirrored)/i;
const USES = /^(\d+) uses? remaining/i;
function modsOf(item) {
  return ((item && item.lines) || []).map((l) => String(l.text || '').trim())
    .filter((t) => t && !PROP.test(t) && !HELP.test(t) && !USES.test(t.replace(/\s*\(implicit\)$/i, '')))
    .map((t) => t.replace(/\s*\((implicit|enchant|crafted|fractured|desecrated|augmented)\)\s*$/i, ''));
}
// the same mod whatever its numbers, for your marks
const keyOf = (text) => String(text || '').replace(/[+-]?\d+(\.\d+)?/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();

// what a mod is about, so a waystone's or tablet's mods can be read in groups
const CATS = [
  ['you', /^Players?\b|\bon (?:you|Players)\b|Players' |to Players\b/i],
  ['tough', /Monsters have \d+% increased Effectiveness|less effect of Curses on Monsters|Monsters are Hexproof/i],
  ['boss', /Map Boss|Powerful Map Bosses|Unique Boss|Unique Monsters have/i],
  ['loot', /Quantity|Rarity of Items|drop|Logbooks?|Currency|Waystones? found|Divination|Gold|Experience|Splinters?|Fragments?|Reward|Exalted|Chaos Orbs?|Precursor|Tablets? found|Delirium Orbs?|Simulacrum|Rare Chest|Crystal|Artifacts|Wombgifts|Hiveblood|Verisium|Omens?\b|Tribute/i],
  ['monsters', /Pack Size|number of (?:Magic|Rare)? ?Monsters|(?:Magic|Rare) Monsters|Monster Packs|additional packs? of|extra packs? of Monsters|additional (?:Rare|Magic)? ?Monsters|Monster Rarity|additional random Modifier|additional Rare Modifier|Duplicated|Monsters? (?:in|are) /i],
  ['content', /^Adds |Breach|Expedition|Ritual|Delirium|Abyss|Essence|Shrine|Strongbox|Azmeri|Wisps?|Rogue Exiles?|Runic Monster|Tormented|Mist|Remnants?|Excavat|Explosives?|Monoliths?|Vaal Beacon|Summoning Circle|Irradiat|Tower|counts as an? \w+ Map/i],
];
function category(text) {
  const p = monster.parse(text);
  if (p) return p.kind === 'tough' ? 'tough' : 'danger';
  for (const [k, re] of CATS) if (re.test(text)) return k;
  return 'other';
}
const CAT_ORDER = ['you', 'danger', 'tough', 'monsters', 'boss', 'loot', 'content', 'other'];
const CAT_LABEL = { you: 'Acting on you', danger: 'Monsters hit harder', tough: 'Tougher monsters', monsters: 'More monsters', boss: 'Map boss', loot: 'More loot', content: 'League content', other: 'Other' };

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const pct = (a, b) => (a > 0 && b != null ? ((b - a) / a) * 100 : null);
const round = (v) => Math.round(v * 10) / 10;

// what Path of Building says a mod changes, in words, and how bad it is
function pobEffect(before, after) {
  if (!before || !after) return null;
  const parts = []; let level = 'ok';
  const ehp = pct(n(before.TotalEHP), n(after.TotalEHP));
  if (ehp != null && Math.abs(ehp) >= 1) {
    parts.push(`effective HP ${ehp > 0 ? '+' : ''}${round(ehp)}%`);
    if (ehp <= -25) level = 'danger'; else if (ehp <= -8) level = 'warn';
  }
  for (const el of ['Fire', 'Cold', 'Lightning', 'Chaos']) {
    const a = n(before[`${el}Resist`]); const b = n(after[`${el}Resist`]);
    if (a != null && b != null && b < a - 0.5) { parts.push(`${el.toLowerCase()} res ${Math.round(a)}% → ${Math.round(b)}%`); if (el !== 'Chaos' && level === 'ok') level = 'warn'; }
  }
  // the biggest hit you survive (your weakest kind of damage) and how long you last
  const worstHit = (o) => { const v = ['Physical', 'Fire', 'Cold', 'Lightning'].map((t) => n(o[`${t}MaximumHitTaken`])).filter((x) => x > 0); return v.length ? Math.min(...v) : null; };
  const hitA = worstHit(before); const hitB = worstHit(after);
  const hit = pct(hitA, hitB);
  if (hit != null && hit <= -1) { parts.push(`biggest hit you survive ${round(hit)}%`); if (hit <= -30) level = 'danger'; else if (hit <= -12 && level === 'ok') level = 'warn'; }
  const surv = pct(n(before.EHPSurvivalTime), n(after.EHPSurvivalTime));
  if (surv != null && surv <= -1) { parts.push(`you last ${round(-surv)}% less long`); if (surv <= -35) level = 'danger'; else if (surv <= -15 && level === 'ok') level = 'warn'; }
  const life = pct(n(before.Life), n(after.Life));
  if (life != null && life <= -1) parts.push(`life ${round(life)}%`);
  const regen = n(before.LifeRegenRecovery); const regen2 = n(after.LifeRegenRecovery);
  if (regen > 0 && regen2 != null && regen2 < regen * 0.9) parts.push(`life regeneration ${Math.round(regen)} → ${Math.round(regen2)}/s`);
  const blk = n(before.BlockChance); const blk2 = n(after.BlockChance);
  if (blk > 0 && blk2 != null && blk2 < blk - 0.5) parts.push(`block ${Math.round(blk)}% → ${Math.round(blk2)}%`);
  const dps = (o) => n(o.FullDPS) || n(o.CombinedDPS) || n(o.TotalDPS) || 0;
  const d = pct(dps(before), dps(after));
  if (d != null && d <= -1) { parts.push(`damage ${round(d)}%`); if (d <= -40) level = 'danger'; else if (d <= -10 && level === 'ok') level = 'warn'; }
  return parts.length ? { text: parts.join(', '), level } : { text: 'no change to your character', level: 'ok' };
}

// monster mods checked against your build
function ruleFor(text, b) {
  const t = String(text || '');
  if (!b) return null;
  const dmg = b.damage || {};
  const total = Object.values(dmg).reduce((s, v) => s + (Number(v) || 0), 0);
  const share = (types) => (total > 0 ? types.reduce((s, k) => s + (Number(dmg[k]) || 0), 0) / total : null);
  if (/reflect \d+% of Elemental Damage/i.test(t)) {
    if (b.minion) return { level: 'ok', text: "your minions' damage isn't reflected to you" };
    const s = share(['Fire', 'Cold', 'Lightning']);
    if (s == null) return { level: 'warn', text: 'reflects elemental damage: check your main skill' };
    return s > 0.1 ? { level: 'danger', text: `your main skill is ${Math.round(s * 100)}% elemental damage: it comes back at you` } : { level: 'ok', text: 'your main skill deals almost no elemental damage' };
  }
  if (/reflect \d+% of Physical Damage/i.test(t)) {
    if (b.minion) return { level: 'ok', text: "your minions' damage isn't reflected to you" };
    const s = share(['Physical']);
    if (s == null) return { level: 'warn', text: 'reflects physical damage: check your main skill' };
    return s > 0.1 ? { level: 'danger', text: `your main skill is ${Math.round(s * 100)}% physical damage: it comes back at you` } : { level: 'ok', text: 'your main skill deals almost no physical damage' };
  }
  // 3.29: reflect became Thorns on rare monsters, a flat hit back (800 physical / 1500 elemental in
  // red maps) when you hit them with that damage, reduced by your armour, block and resistances
  if (/Physical Thorns/i.test(t)) {
    if (b.minion) return { level: 'ok', text: "your minions' hits don't trigger it on you" };
    const s = share(['Physical']);
    if (s == null) return { level: 'warn', text: 'rare monsters hit back when hit by physical damage: check your main skill' };
    return s > 0.1 ? { level: 'warn', text: `your main skill is ${Math.round(s * 100)}% physical: rare monsters hit back (up to 800 physical in red maps, reduced by your armour and block)` } : { level: 'ok', text: 'your main skill deals almost no physical damage' };
  }
  if (/Elemental Thorns/i.test(t)) {
    if (b.minion) return { level: 'ok', text: "your minions' hits don't trigger it on you" };
    const s = share(['Fire', 'Cold', 'Lightning']);
    if (s == null) return { level: 'warn', text: 'rare monsters hit back when hit by elemental damage: check your main skill' };
    return s > 0.1 ? { level: 'warn', text: `your main skill is ${Math.round(s * 100)}% elemental: rare monsters hit back (up to 1500 elemental in red maps, reduced by your resistances)` } : { level: 'ok', text: 'your main skill deals almost no elemental damage' };
  }
  if (/cannot Regenerate/i.test(t)) {
    const r = Number(b.regen) || 0; const life = Number(b.life) || 0;
    return r > 0 && life > 0 && r / life > 0.02 ? { level: 'warn', text: `you regenerate ${Math.round(r)} life a second, which stops here` } : { level: 'ok', text: "you don't rely on regeneration" };
  }
  if (/cannot be Leeched|cannot Leech|no Leech/i.test(t)) {
    return Number(b.leech) > 0 ? { level: 'warn', text: 'your build leeches life, which stops here' } : { level: 'ok', text: "you don't leech" };
  }
  if (/Hexproof|cannot be Cursed/i.test(t)) return { level: 'warn', text: "your curses won't work on monsters (if you use any)" };
  if (/(less|reduced) (Recovery|Life Recovery)/i.test(t) && !/^Players/i.test(t)) {
    const r = Number(b.regen) || 0; const l = Number(b.leech) || 0;
    return r > 0 || l > 0 ? { level: 'warn', text: 'less recovery: your regeneration and leech heal less' } : null;
  }
  return null;
}

const RANK = { ok: 0, info: 0, warn: 1, danger: 2 };
const MARK_LEVEL = { d: 'danger', w: 'warn', g: 'ok' };

// the whole check. pob: server mapCheck answer (or null without a build); marks: { key: 'd'|'w'|'g' }
function check(item, pob, marks = {}) {
  const mods = modsOf(item);
  const byText = new Map(((pob && pob.results) || []).map((x) => [x.text, x]));
  const rows = mods.map((text) => {
    const key = keyOf(text);
    const res = byText.get(text);
    const eff = res && res.after ? pobEffect(pob.before, res.after) : null;
    const rule = ruleFor(text, pob);
    const mark = marks[key] || null;
    let level = (eff && eff.level) || (rule && rule.level) || 'info';
    if (eff && rule && RANK[rule.level] > RANK[eff.level]) level = rule.level;
    if (mark) level = MARK_LEVEL[mark];
    const cat = category(text);
    let note = eff ? eff.text : rule ? rule.text : null;
    const mp = monster.parse(text);
    if (mp && mp.life && !note) note = `monsters take about ${Math.round(mp.life)}% longer to kill`;
    return { text, key, mark, level, cat, calculated: !!(res && res.after), note, error: res && res.error ? res.error : null };
  });
  // in groups, in a fixed order (the mods' own order inside each)
  const groups = CAT_ORDER.map((k) => ({ cat: k, label: CAT_LABEL[k], rows: rows.filter((r) => r.cat === k) })).filter((g) => g.rows.length);
  const usesLine = ((item && item.lines) || []).map((l) => String(l.text || '')).find((t) => USES.test(t));
  const life = monster.extraLife(mods);
  // what the map gives (its header lines): rarity, pack size, more rare monsters…
  const REWARD = /^(Item Rarity|Item Quantity|Atlas Drops|Monster Pack Size|Pack Size|Rare Monsters|Magic Monsters|Waystone Drop Chance|Revives Available|Monster Effectiveness):\s*(.+?)(?:\s*\(augmented\))?$/i;
  const reward = ((item && item.lines) || []).map((l) => String(l.text || '').match(REWARD)).filter(Boolean).map((m) => `${m[1]} ${m[2]}`);
  // a tablet: what it adds ("Adds a Kalguuran Expedition to a Map") and, in a few words, what its mods are for
  let summary = null;
  if (isTablet(item)) {
    const adds = ((item && item.lines) || []).map((l) => String(l.text || '').replace(/\s*\(implicit\)$/i, '').match(/^(?:Adds (?:an? |the )?(.+?) to a Map|Empowers the (Map Boss) of a Map)/i)).find(Boolean);
    const count = (k) => groups.filter((g) => g.cat === k).reduce((n, g) => n + g.rows.length, 0);
    const bits = [[count('loot'), 'more loot'], [count('content'), 'more of its content'], [count('monsters') + count('tough') + count('danger'), 'more or harder monsters'], [count('boss'), 'the map boss'], [count('you'), 'act on you']].filter(([n]) => n > 0).map(([n, w]) => `${n} ${w === 'act on you' ? 'that act on you' : `for ${w}`}`);
    summary = { adds: adds ? (adds[1] || adds[2]) : null, text: bits.length ? `${bits.join(', ')}` : null };
  }
  const allEff = pob && pob.all ? pobEffect(pob.before, pob.all) : null;
  const worst = rows.reduce((w, r) => (RANK[r.level] > RANK[w] ? r.level : w), allEff && allEff.level === 'danger' ? 'danger' : 'ok');
  return {
    rows, groups, all: allEff, verdict: worst === 'danger' ? 'danger' : worst === 'warn' ? 'warn' : 'ok',
    calculated: rows.filter((r) => r.calculated).length,
    reward, summary, tablet: isTablet(item), uses: usesLine ? Number(usesLine.match(USES)[1]) : null, extraLife: life || 0,
  };
}

// clicking a mod cycles your mark: none -> dangerous -> careful -> fine -> none
const nextMark = (m) => ({ '': 'd', d: 'w', w: 'g', g: '' })[m || ''];

module.exports = { isMap, isTablet, category, modsOf, keyOf, pobEffect, ruleFor, check, nextMark };
