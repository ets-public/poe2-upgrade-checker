'use strict';

// What sold: a price check's listings, searched again a few hours later. A listing that's gone was
// most likely bought (or its seller took it down, so it's an estimate, said as such): the prices of
// the gone ones are closer to what the item sells for than the asking prices still up.
//
// A follow-up: { id, caseId, at, game, league, key, item, body, total, listings: [{ id, priceEx, price }] }
// The search answers with the first 100 ids, cheapest first. When more than 100 are listed, a listing
// of ours can drop out of those 100 without being sold (cheaper ones came up), so then only our
// cheapest SAFE are counted.
const SAFE = 40;

// -> { considered, gone, goneEx: [sorted], stayedEx: [sorted], newTotal, hours }
function compare(f, ids, newTotal, now) {
  const present = new Set(ids || []);
  const truncated = newTotal != null && (ids || []).length < newTotal;
  const list = (f.listings || []).filter((l) => l && l.id);
  const considered = truncated ? list.slice(0, SAFE) : list;
  const gone = considered.filter((l) => !present.has(l.id));
  const stayed = considered.filter((l) => present.has(l.id));
  const ex = (a) => a.map((l) => l.priceEx).filter((v) => typeof v === 'number' && v > 0).sort((x, y) => x - y);
  return { considered: considered.length, gone: gone.length, goneEx: ex(gone), stayedEx: ex(stayed), newTotal: newTotal == null ? null : newTotal, hours: Math.round(((now - f.at) / 3600000) * 10) / 10 };
}

const median = (a) => (a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : null);

// in words, with fmt(ex) -> "2 div": "6 h later, 5 of 27 listings were gone (sold or taken down), asking 2 div – 3 div."
function text(res, fmt) {
  if (!res) return '';
  const h = res.hours >= 1 ? `${Math.round(res.hours)} h` : `${Math.max(1, Math.round(res.hours * 60))} min`;
  if (!res.gone) return `${h} later, all ${res.considered} listings were still up: nothing sold at those prices.`;
  const lo = res.goneEx[0]; const hi = res.goneEx[res.goneEx.length - 1];
  const asking = lo == null ? '' : lo === hi || fmt(lo) === fmt(hi) ? `, asking ${fmt(lo)}` : `, asking ${fmt(lo)} – ${fmt(hi)}${res.goneEx.length >= 3 ? ` (middle ${fmt(median(res.goneEx))})` : ''}`;
  return `${h} later, ${res.gone} of ${res.considered} listings ${res.gone === 1 ? 'was' : 'were'} gone (sold or taken down)${asking}.`;
}

module.exports = { compare, text, median, SAFE };
