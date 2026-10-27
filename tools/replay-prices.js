#!/usr/bin/env node
'use strict';
// Re-prices saved price checks (price-checks.jsonl, written next to the app's log) with the current
// code, without the trade site: each saved listing is parsed again, compared with the item
// (comparables.js) and priced (price.js). Shows what was said then and what would be said now, and,
// for the checks you gave a verdict on (Too low / About right / Too high, and what it's worth), how
// close the price was then and is now: every tuning change can be measured on real checks.
//   node tools/replay-prices.js [path/to/price-checks.jsonl] [--item "Barren Compass"] [--rated]
const fs = require('fs');
const path = require('path');
const { parseItem } = require('../src/core/parser');
const pq = require('../src/core/pricequery');
const comparables = require('../src/core/comparables');
const { priceStats } = require('../src/core/price');
const { sameItem } = require('../src/core/listing');

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--item') || path.join(process.env.APPDATA || '', 'PoE2 Upgrade Checker', 'price-checks.jsonl');
const only = args.includes('--item') ? String(args[args.indexOf('--item') + 1] || '').toLowerCase() : '';
// the trade site's stat list, as the app keeps it next to the file (gear mods are matched with it)
const trade = require('../src/core/trade');
const indexes = {};
function statIndex(game) {
  if (indexes[game] !== undefined) return indexes[game];
  try { indexes[game] = trade.buildStatIndex(JSON.parse(fs.readFileSync(path.join(path.dirname(file), game === 'poe1' ? 'trade-cache-poe1.json' : 'trade-cache.json'), 'utf8')).stats); } catch (_) { indexes[game] = null; }
  return indexes[game];
}
const fmt = (x) => (x == null ? '-' : x >= 100 ? Math.round(x) : Math.round(x * 10) / 10);

const lines = [];
for (const f of [file.replace(/\.jsonl$/, '.1.jsonl'), file]) { try { lines.push(...fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)); } catch (_) { /* none */ } }
const cases = []; const feedback = new Map();
for (const line of lines) {
  let c; try { c = JSON.parse(line); } catch (_) { continue; }
  if (c.feedback) feedback.set(c.feedback, c); else cases.push(c); // the last verdict on a check counts
}
const ratedOnly = args.includes('--rated');
const score = { then: [], now: [], dirThen: 0, dirNow: 0, dirN: 0 };
const err = (p, a) => Math.abs(Math.log(p / a)); // how far off, as a ratio (0.29 = 33% off either way)
for (const c of cases) {
  const fb = c.id ? feedback.get(c.id) : null;
  if (ratedOnly && !fb) continue;
  const item = c.item && parseItem(c.item);
  if (!item || (only && !String(item.name || '').toLowerCase().includes(only))) continue;
  const read = (c.listings || []).map((x, i) => ({ id: 'l' + i, account: 'l' + i, price: x.price, priceEx: x.priceEx, indexed: x.indexed, item: x.text ? Object.assign(parseItem(x.text) || {}, { listingText: x.text }, x.affixes != null ? { affixCount: x.affixes } : {}) : null }));
  const listings = read.filter((x) => !(x.item && sameItem(item, x.item))); // your own listing of this item: as the app does
  const map = pq.usesMapPriceQuery(item) && !pq.isTablet(item) && !/unique/i.test(item.rarity || '');
  const tablet = pq.isTablet(item);
  const market = !map && !tablet && pq.usesPriceQuery(item); // as the app does: tablets aren't compared listing by listing
  let group = { group: 'all', listings };
  const preferLocal = ['Weapon', 'Offhand', 'Helmet', 'Body Armour', 'Gloves', 'Boots'].includes(item.slot);
  if (map || market) group = comparables.pick(item, listings, map ? { kind: 'map', game: c.game } : { game: c.game, preferLocal, statIndex: statIndex(c.game) }, pq.MIN);
  const s = priceStats(group.listings, { now: Date.parse(c.at) || Date.now(), alike: group.group === 'alike' || (tablet && (c.steps || []).length > 0 && c.steps[c.steps.length - 1].level === 0) }); // listing ages as they were at the check
  const was = c.verdict || {};
  const now = group.group === 'weaker' ? `more than ${fmt(s && s.typicalEx)} (every listing weaker)` : s ? `${fmt(s.typicalEx)} (${fmt(s.lowEx)}–${fmt(s.highEx)})` : 'none';
  const nowEx = group.group === 'weaker' ? null : s && s.typicalEx;
  let mark = '';
  if (fb) {
    mark = ` | you: ${fb.rating || '-'}${fb.actualEx ? `, worth ${fmt(fb.actualEx)} (${fb.actual})` : ''}`;
    if (fb.actualEx > 0) {
      if (was.typicalEx > 0) score.then.push(err(was.typicalEx, fb.actualEx));
      if (nowEx > 0) score.now.push(err(nowEx, fb.actualEx));
    } else if (fb.rating && fb.rating !== 'right' && was.typicalEx > 0 && nowEx > 0) {
      // only "too high" / "too low": did the price move the right way?
      score.dirN++;
      if ((fb.rating === 'high') === (nowEx < was.typicalEx) && nowEx !== was.typicalEx) score.dirNow++;
    }
  }
  console.log(`${c.at} ${item.itemClass} "${item.name}": then ${fmt(was.typicalEx)}${was.group ? ` [${was.group}]` : ''} → now ${now} [${group.group}, ${group.listings.length} of ${listings.length} listings]${mark}`);
}
// the score: how far the price is from what you said it's worth (median, and the share within a third)
const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; };
const within = (a) => (a.length ? Math.round((100 * a.filter((x) => x <= Math.log(1.33)).length) / a.length) : null);
const pct = (x) => (x == null ? '-' : `${Math.round((Math.exp(x) - 1) * 100)}%`);
if (score.then.length || score.now.length || score.dirN) {
  console.log(`\nYour verdicts with a value: ${score.now.length}. Typical miss then ${pct(med(score.then))}, now ${pct(med(score.now))}; within a third of it then ${within(score.then)}%, now ${within(score.now)}%.`);
  if (score.dirN) console.log(`"Too high" / "too low" only: the price now moves the way you said in ${score.dirNow} of ${score.dirN}.`);
}
