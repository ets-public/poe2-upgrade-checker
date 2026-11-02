'use strict';

// For sale: the items you copied a price note for, and what a later check of the trade site says about
// each: your listing still up (and how its price compares with the cheapest like it), or gone (sold,
// or taken down). listings: listing.js summarise() output; mine: the item you listed (parser output).
const { sameItem } = require('./listing');

function status(mine, listings) {
  const all = (listings || []).filter((x) => x && x.item);
  const own = all.filter((x) => sameItem(mine, x.item));
  const others = all.filter((x) => !own.includes(x) && typeof x.priceEx === 'number' && x.priceEx > 0).sort((a, b) => a.priceEx - b.priceEx);
  const o = own[0] || null;
  const cheaper = o && typeof o.priceEx === 'number' ? others.filter((x) => x.priceEx < o.priceEx - 1e-9).length : null;
  return {
    found: !!o,
    price: o ? o.priceText : null, priceEx: o ? o.priceEx : null, account: o ? o.account || null : null,
    cheapest: others[0] ? { text: others[0].priceText, ex: others[0].priceEx } : null,
    cheaper, seen: all.length,
  };
}

// one line for the list: "Still listed at 3 div; 4 like it are cheaper (from 2 div)." / "Not listed any more: sold, or taken down."
function text(st, wasFound) {
  if (!st) return '';
  if (!st.found) return wasFound ? 'Not listed any more: sold, or taken down.' : 'Not found on the trade site: not listed yet, already sold, or listed in another league.';
  const tail = st.cheaper ? ` ${st.cheaper} like it ${st.cheaper === 1 ? 'is' : 'are'} cheaper${st.cheapest ? ` (from ${st.cheapest.text})` : ''}: lower the price to sell sooner.`
    : st.cheapest ? ` Cheapest like it: yours (next ${st.cheapest.text}).` : '';
  return `Still listed at ${st.price}.${tail}`;
}

module.exports = { status, text };
