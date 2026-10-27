'use strict';

// Searches built from the stats you pick: Find upgrades, better for my build, and the gear search.

const ignoreLib = require('../ignore');
const { statusOpt, EQUIPMENT_FILTERS, COND, matchStat, localFor, addExcludeGroup, categoryFor } = require('./stats');
const { statSources, baseWithoutSockets } = require('./similar');

// picks: [{ key, min, max }] - our stat keys with the values you want
// opts: { itemClass, baseType, matchBase, onlineOnly, statIndex, filtersData, preferLocal }
function buildQuery(picks, opts) {
  const statFilters = [];
  const equipment = {};
  const unmatched = [];
  for (const p of picks) {
    const preferLocal = localFor(p.key, opts.itemClass, opts.preferLocal);
    let m = p.id ? { kind: 'stat', id: p.id, type: p.idType } : matchStat(p.key, opts.statIndex, { preferLocal });
    if (!p.id && m && m.kind === 'stat' && m.type !== 'pseudo' && p.source) {
      const type = p.source === 'implicit' ? 'implicit' : p.source === 'socket' ? 'augment' : 'explicit';
      // PoE1 has no runes: its enchants and bench crafts are their own types
      const alt = (t) => p.source === 'socket' && matchStat(p.key, opts.statIndex, { preferLocal, type: t });
      m = matchStat(p.key, opts.statIndex, { preferLocal, type }) || alt(p.tag === 'crafted' ? 'crafted' : 'enchant') || alt('crafted') || m;
    }
    if (!m) { unmatched.push(p.key); continue; }
    const value = {};
    if (p.min !== '' && p.min != null && Number.isFinite(Number(p.min))) value.min = Number(p.min);
    if (p.max !== '' && p.max != null && Number.isFinite(Number(p.max))) value.max = Number(p.max);
    // a "reduced" stat on the trade site: our -40 is its 40, so the range turns round
    if (m.invert) { const { min, max } = value; delete value.min; delete value.max; if (max != null) value.min = -max; if (min != null) value.max = -min; }
    if (m.kind === 'equipment') {
      if (value.min != null && !(value.min > 0)) delete value.min; // "at least 0 DPS" means nothing
      if (Object.keys(value).length) equipment[m.id] = value;
    }
    else statFilters.push({ id: m.id, value, disabled: false });
  }

  const filters = {};
  // "same base type" needs a base name; magic items have none, so keep the item class then
  const byBase = !!(opts.matchBase && opts.baseType);
  if (!byBase) {
    const cat = categoryFor(opts.itemClass, opts.filtersData);
    if (cat) filters.type_filters = { filters: { category: { option: cat } } };
  }
  if (Object.keys(equipment).length) filters.equipment_filters = { filters: equipment };

  const query = {
    status: { option: statusOpt(opts.status) },
    stats: [{ type: 'and', filters: statFilters }],
    filters,
  };
  if (byBase) query.type = opts.baseType;
  if (!statFilters.length) query.stats = [];
  const excluded = addExcludeGroup(query, opts.ignoreRules, opts.statIndex);

  return { body: { query, sort: { price: 'asc' } }, unmatched, excluded };
}

// One-click "find upgrades": uses the trade site's weighted-sum stat group so it
// finds items whose weighted stats beat your current item, using YOUR weights.
// [Weapon] DPS stats become a min DPS filter; [Base] defences are left out
// (they depend on the base type), so you check those in the results.
function buildUpgradeQuery(item, weights, opts) {
  // Leave rune/enchant bonuses out of "your score": a listing usually comes without them.
  const natural = {};
  for (const x of statSources(item)) if (x.source !== 'socket') natural[x.key] = (natural[x.key] || 0) + x.value;
  const weightFilters = [];
  let current = 0;
  const equipment = {};
  const unmatched = [];
  for (const [key, w] of Object.entries(weights)) {
    if (!w || ignoreLib.isIgnored(opts.ignoreRules, key)) continue;
    if (EQUIPMENT_FILTERS[key]) {
      if (key.startsWith('[Weapon]') && item.stats[key] && w > 0) {
        equipment[EQUIPMENT_FILTERS[key]] = { min: Math.floor(item.stats[key]) };
      }
      continue;
    }
    const m = matchStat(key, opts.statIndex, { preferLocal: localFor(key, opts.itemClass || item.itemClass, opts.preferLocal) });
    if (!m) { if (item.stats[key]) unmatched.push(key); continue; }
    // a "reduced" stat on the trade site counts the other way round
    weightFilters.push({ id: m.id, value: { weight: m.invert ? -w : w }, disabled: false });
    current += (natural[key] || 0) * w;
  }
  const filters = {};
  const cat = categoryFor(opts.itemClass || item.itemClass, opts.filtersData);
  if (cat) filters.type_filters = { filters: { category: { option: cat } } };
  if (Object.keys(equipment).length) filters.equipment_filters = { filters: equipment };
  const groupMin = Math.floor(current * (1 + (opts.minGainPct || 0) / 100)) + 1;
  const query = {
    status: { option: statusOpt(opts.status) },
    stats: weightFilters.length ? [{ type: 'weight', value: { min: groupMin }, filters: weightFilters }] : [],
    filters,
  };
  const excluded = addExcludeGroup(query, opts.ignoreRules, opts.statIndex);
  return { body: { query, sort: { 'statgroup.0': 'desc' } }, unmatched, currentScore: current, groupMin, excluded };
}

// "Better for my build": the trade site's weighted-sum group, with your build's gear-score
// weights, so it finds items that score higher for YOUR build even with a different mix of
// stats. ("Same stats or better" needs every stat at your value, which on good gear is
// almost nothing.) Implicit and explicit versions of a stat both count. Base ES/Armour/
// Spirit can't be weighted, so they become a minimum (opts.baseShare of yours).
// opts: { weights (gearscore.searchWeights), statIndex, filtersData, status, ignoreRules,
//         share (1 = beat your item, 0.9 = within 10%), baseShare }
const GEAR_TYPES = ['explicit', 'implicit'];
// the sizes a gear search shrinks through when the trade site says "too complex" (logged out it
// allows only a handful of filters); Find upgrades and Where to spend both step through these
const GEAR_SEARCH_SIZES = [{ maxFilters: 40 }, { maxFilters: 20, explicitOnly: true }, { maxFilters: 10, explicitOnly: true, coreShare: 0 }, { maxFilters: 6, explicitOnly: true, coreShare: 0 }, { countOnly: true, maxFilters: 6, explicitOnly: true, coreShare: 0 }];
function keyForm(text) { return String(text).replace(/^\+/, '').replace(/\s*\(local\)\s*$/i, '').trim(); }
function buildGearQuery(item, opts) {
  const weights = opts.weights || [];
  const sources = statSources(item);
  const all = (opts.statIndex && opts.statIndex.all) || [];
  const filters = []; const used = new Set(); let current = 0; const equipment = {}; const parts = []; const core = [];
  const scale = 100; // trade weights are easier as whole numbers
  for (const w of weights) {
    const isBase = /^\^\\\[/.test(w.test.source); // [Base] / [Weapon] stats aren't trade mods
    const baseKey = Object.keys(EQUIPMENT_FILTERS).find((k) => w.test.test(k));
    if (baseKey) {
      const own = sources.filter((x) => x.key === baseKey).reduce((a, x) => a + x.value, 0);
      if (own > 0 && EQUIPMENT_FILTERS[baseKey]) {
        const v = baseWithoutSockets(baseKey, own, sources);
        equipment[EQUIPMENT_FILTERS[baseKey]] = { min: Math.floor(v * (opts.baseShare || 0.8)) };
        parts.push(`${w.label} ≥ ${Math.floor(v * (opts.baseShare || 0.8))}`);
      }
      continue;
    }
    if (isBase) continue;
    // a "total to" stat (res, attributes) also counts all-res / all-attribute mods, so it replaces the single mods
    const totals = all.filter((e) => / total to /.test(e.text) && w.test.test(keyForm(e.text.replace(' total to ', ' to '))));
    // every trade stat this weight covers (e.g. Minion crit = several texts)
    // (a "(Local)" stat only where it can roll: local attack speed is a weapon mod, local armour an
    // armour mod; on a ring either would only take a filter slot from a stat that's there)
    const cls = opts.itemClass || item.itemClass;
    const fits = (e) => !e.local || !cls || localFor(keyForm(e.text), cls, true);
    const ids = totals.length ? totals : all.filter((e) => (opts.explicitOnly ? e.type === 'explicit' : GEAR_TYPES.includes(e.type)) && w.test.test(keyForm(e.text)) && fits(e));
    if (!ids.length) continue;
    const ww = Math.round(w.w * scale * 100) / 100;
    for (const e of ids) {
      if (used.has(e.id)) continue;
      used.add(e.id);
      // conditional mods count less in the gear score, so here too
      const cond = COND.test(e.text);
      filters.push({ id: e.id, value: { weight: Math.round(ww * (cond ? 0.6 : 1) * 100) / 100 }, disabled: false });
    }
    if (w.imp >= 4 && w.key !== null) core.push({ w, ids: ids.filter((e) => !/\b(if you've|while|when|recently)\b/i.test(e.text)) });
    // what your item scores on it (runes left out: a listing usually comes without yours)
    // (conditional mods count less on your item too, as they do in the search)
    let own = sources.filter((x) => x.source !== 'socket' && w.test.test(x.key)).reduce((a, x) => a + x.value * (COND.test(x.key) ? 0.6 : 1), 0);
    if (w.res && w.need != null) own = Math.min(own, Math.max(0, w.need));
    current += own * ww;
    if (own > 0) parts.push(w.label);
  }
  // the trade site limits how many filters a group can have: keep the heaviest
  filters.sort((a, b) => b.value.weight - a.value.weight);
  const kept = filters.slice(0, opts.maxFilters || 40);
  const f = {};
  const cat = categoryFor(opts.itemClass || item.itemClass, opts.filtersData);
  if (cat) f.type_filters = { filters: { category: { option: cat } } };
  if (Object.keys(equipment).length) f.equipment_filters = { filters: equipment };
  const share = opts.share == null ? 1 : opts.share;
  const groupMin = Math.max(1, Math.floor(current * share) + (share >= 1 ? 1 : 0));
  const query = {
    status: { option: statusOpt(opts.status) },
    stats: kept.length ? [{ type: 'weight', value: { min: groupMin }, filters: kept }] : [],
    filters: f,
  };
  // the build's key stats for this slot: listings must have at least 2 of them at a decent roll
  // (as many as your item has, up to 2), so one huge roll of a minor stat can't carry a junk item
  const keyStats = core.sort((a, b) => b.w.imp - a.w.imp).slice(0, 5).filter((c) => c.ids.length);
  const ownCore = keyStats.filter((c) => sources.some((x) => x.source !== 'socket' && c.w.test.test(x.key) && x.value > 0)).length;
  const needCore = Math.min(2, ownCore);
  if (kept.length && needCore > 0 && opts.coreShare !== 0) {
    const share = opts.coreShare || 0.4;
    const cf = [];
    for (const c of keyStats) for (const e of c.ids) cf.push({ id: e.id, value: { min: Math.max(1, Math.floor(c.w.cap * share)) }, disabled: false });
    query.stats.push({ type: 'count', value: { min: needCore }, filters: cf });
  }
  // smallest form, for when the trade site says the query is too complex (logged out it allows
  // very few filters): just "has N of your key stats at a decent roll"; listings are still scored
  // by your gear score in the results window
  if (opts.countOnly && keyStats.length) {
    const cf = [];
    for (const c of keyStats) { const e = c.ids.find((x) => x.type === 'explicit') || c.ids[0]; cf.push({ id: e.id, value: { min: Math.max(1, Math.floor(c.w.cap * 0.5)) }, disabled: false }); }
    query.stats = [{ type: 'count', value: { min: Math.max(1, Math.min(3, ownCore || 2, cf.length)) }, filters: cf }];
  }
  const excluded = opts.countOnly ? 0 : addExcludeGroup(query, opts.ignoreRules, opts.statIndex);
  // best for your build first (within your price range); the results window can re-sort by price
  return { body: { query, sort: opts.countOnly ? { price: 'asc' } : { 'statgroup.0': 'desc' } }, countOnly: !!(opts.countOnly && keyStats.length), current, groupMin, filters: kept.length, dropped: filters.length - kept.length, parts, excluded, keyStats: keyStats.map((c) => c.w.label), needCore };
}

// Budget: { max, currency: 'divine'|'exalted'|'chaos', divineRate? }
// - If currency is divine and you give a divine->exalted rate, the max is turned
//   into "exalted orb equivalent", so listings priced in exalts are included too.
// - Otherwise only listings priced in that currency are matched.

module.exports = { buildQuery, buildUpgradeQuery, buildGearQuery, GEAR_SEARCH_SIZES };
