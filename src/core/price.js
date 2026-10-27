'use strict';

// "What's it worth?": a fair price from trade listings, cheapest first.
// The trade site's cheapest listings are often not real prices: price-fixing baits at 1 ex,
// one seller listing many copies, listings nobody has touched in weeks. So:
//   1. one listing per seller (their cheapest)
//   2. leave out listings older than STALE_DAYS when at least 3 fresh ones remain
//   3. drop baits: one or two sellers far under the next listings, or a group a hundred times
//      under them; at most a third of the listings (see below)
//   4. cheapest = what's left at the bottom; worth = the median of the cheapest 5 sellers
//      (what it sells for is near the bottom of the market: dearer listings are what's still unsold).
//      opts.alike (the listings are known to be like yours): only those within 3x of the cheapest
//      count (at least 2), so 1 div and 15 div asks don't make a tablet listed at 1-2 chaos 8 div
//   5. range = cheapest to 5th cheapest

const DAY = 24 * 3600 * 1000;
const STALE_DAYS = 14;

const medianOf = (a) => {
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

// listings: [{ priceEx, price, account, indexed, id }]
function priceStats(listings, opts = {}) {
  const now = opts.now || Date.now();
  const all = (listings || []).filter(Boolean);
  const unconvertible = all.filter((x) => x.price && x.priceEx == null).length; // priced in a currency we have no rate for
  const noPrice = all.filter((x) => !x.price).length;
  const bySeller = new Map();
  for (const x of all) {
    if (!(x.priceEx > 0)) continue;
    const k = x.account || x.id || bySeller.size;
    const cur = bySeller.get(k);
    if (!cur || x.priceEx < cur.priceEx) bySeller.set(k, x);
  }
  let list = [...bySeller.values()];
  const age = (x) => { const t = Date.parse(x.indexed || ''); return Number.isFinite(t) ? now - t : 0; };
  const fresh = list.filter((x) => age(x) <= STALE_DAYS * DAY);
  let stale = 0; let staleKept = 0;
  let stalePrices = [];
  if (fresh.length >= 3 && fresh.length < list.length) { stale = list.length - fresh.length; stalePrices = list.filter((x) => !fresh.includes(x)).map((x) => x.priceEx); list = fresh; }
  else staleKept = list.length - fresh.length; // too few fresh ones to leave the old ones out
  const p = list.map((x) => x.priceEx).sort((a, b) => a - b);
  if (!p.length) return unconvertible ? { count: 0, unconvertible, noPrice, total: all.length, unreliable: 'rate' } : null;
  const maxDrop = Math.floor(p.length / 3);
  let baits = 0; const baitPrices = [];
  // baits are far out of line (1 ex for a 20 div item), not just cheaper. Each cheap listing is
  // judged against the ones just above it, never against the middle of the whole market: on the
  // trade site most listings are overpriced ones that haven't sold, so a ring that sells for 60 ex
  // can have a market "middle" of 3 div, and every real offer under 600 ex would look like a bait.
  //   - one or two sellers well under the next listings (under 0.35x): baits. When the listings are
  //     known to be like yours (opts.alike), only under a market (3+ sellers within 3x of each
  //     other): under one or two scattered asks they are the market (6 tablets like yours at 1 chaos,
  //     2 chaos, 1 div, 1 div, 15 div, 200 chaos: nothing to bait)
  //   - three or more sellers within 3x of each other: that's the market, kept, unless they're a
  //     hundred times under the next listings (three accounts at 1 ex for a 300 ex item)
  while (p.length >= 4 && baits < maxDrop) {
    let g = 1;
    while (g < p.length && p[g] <= 3 * p[0]) g++;
    const next = p[g];
    if (next == null) break;
    let above = g + 1;
    while (above < p.length && p[above] <= 3 * next) above++;
    const bait = g >= 3 ? p[0] < 0.01 * next : p[0] < 0.35 * next && (!opts.alike || above - g >= 3);
    if (!bait) break;
    const drop = Math.min(g, maxDrop - baits);
    baitPrices.push(...p.splice(0, drop)); baits += drop;
  }
  const n = p.length;
  let w = Math.min(5, n);
  if (opts.alike) { w = 1; while (w < Math.min(5, n) && p[w] <= 3 * p[0]) w++; }
  const typicalEx = medianOf(p.slice(0, Math.max(w, Math.min(2, n))));
  const lowEx = p[0];
  const highEx = p[Math.min(4, n - 1)];
  const priced = all.filter((x) => x.price).length;
  return {
    cheapestEx: p[0], typicalEx, lowEx, highEx,
    count: n, sellers: bySeller.size, baits, baitPrices, stalePrices, stale, staleKept, unconvertible, noPrice, total: all.length,
    few: n < 3, // not enough listings to judge
    spread: n >= 2 && highEx / p[0] > 3, // prices vary a lot
    // too many listings in a currency without a rate: the number would be a guess
    unreliable: priced && unconvertible / priced > 0.3 ? 'rate' : null,
  };
}

// how far to trust a price: 'solid', 'rough' or 'guess', with the reason in words.
// s: priceStats() output; level: how far the search had to be loosened (0 = the first, closest search)
function confidence(s, level = 0) {
  if (!s || !s.count) return null;
  const ratio = s.lowEx > 0 ? s.highEx / s.lowEx : 1;
  const why = [];
  if (s.count < 4) why.push(`only ${s.count} seller${s.count === 1 ? '' : 's'}`);
  else if (s.count < 8) why.push(`${s.count} sellers`);
  if (ratio > 4) why.push('prices far apart'); else if (ratio > 2) why.push('prices spread out');
  if (level >= 2) why.push('compared with looser matches'); else if (level === 1) why.push('somewhat looser matches');
  const grade = s.count >= 8 && ratio <= 2 && level === 0 ? 'solid'
    : s.count >= 4 && ratio <= 4 && level <= 1 ? 'rough' : 'guess';
  return { grade, why: why.join(', ') };
}

// listings that aren't like yours this far apart (cheapest to 5th cheapest seller, past 4x: the
// "prices far apart" of confidence()) give a range, not a price: any one number would be made up
const WIDE = 4;
const tooWide = (s) => !!(s && s.count >= 2 && s.lowEx > 0 && s.highEx / s.lowEx > WIDE);

module.exports = { priceStats, confidence, tooWide, WIDE, STALE_DAYS };
