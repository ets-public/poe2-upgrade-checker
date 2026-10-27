'use strict';

// "What's it worth?": prices from the trade site in exalts, divines and chaos.
const { ipcMain, shell, app } = require('electron');
const fs = require('fs');
const path = require('path');
const trade = require('../core/trade');
const listingLib = require('../core/listing');
const priceLib = require('../core/price');
const priceQuery = require('../core/pricequery');
const ninjaLib = require('../core/ninja');
const comparables = require('../core/comparables');

module.exports = function (C) {
  // ---------- price check ("What's it worth?") ----------

  // Both units, so prices are easy to compare: "2 div (1,393 ex)" / "180 ex (0.26 div)"
  // PoE2 prices also in chaos orbs: exalts per chaos from poe.ninja (null in PoE1, where chaos is the base)
  function chaosRate() { const c = C.tg() === 'poe2' && C.store.settings.currencyRates && Number(C.store.settings.currencyRates.chaos); return c > 0 ? c : null; }
  const chaosText = (ex) => { const c = chaosRate(); if (!c || !(ex > 0)) return null; const v = ex / c; return `${v < 10 ? Math.round(v * 10) / 10 : Math.round(v).toLocaleString('en')} chaos`; };
  function fmtEx(ex) {
    if (ex == null) return '?';
    const div = C.store.settings.divineRate;
    const u = C.G().baseShort; // ex (PoE2) or chaos (PoE1)
    const exText = ex < 10 ? `${Math.round(ex * 10) / 10} ${u}` : `${Math.round(ex).toLocaleString('en')} ${u}`;
    const ch = chaosText(ex);
    if (!div) return ch ? `${exText} (${ch})` : exText;
    if (ex >= div * 0.95) return `${Math.round((ex / div) * 10) / 10} div (${[`${Math.round(ex).toLocaleString('en')} ${C.G().baseShort}`, ch].filter(Boolean).join(' · ')})`;
    if (ex / div < 0.05) return ch ? `${exText} (${ch})` : exText; // "0.01 div" says nothing
    return `${exText} (${[`${Math.round((ex / div) * 100) / 100} div`, ch].filter(Boolean).join(' · ')})`;
  }

  // the price verdict, with everything that makes it less certain said out loud
  // cmp: { item, opts } for a market search (rare and magic gear): the price comes from the listings
  // like that item (comparables.js), not from better items that also matched the search
  // how a price search's listings are compared with your item (comparables.js): gear on its priced
  // stats, waystones and maps on their numbers and mod count; a tablet's first search already asks
  // for every mod at close values, so what it finds is like yours (exact)
  // (self: your item, to leave your own listing out, whatever the search)
  function compareWith(item, opts, market, mapish, level) {
    if (market) return { item, opts, self: item };
    if (!mapish || /unique/i.test(item.rarity || '')) return { self: item };
    if (priceQuery.isTablet(item)) return { exact: level === 0, self: item };
    return { item, opts: { ...opts, kind: 'map' }, self: item };
  }
  function priceSummary(listings, league, level = 0, cmp = null) {
    const pl = (k, one, many) => `${k} ${k === 1 ? one : many}`;
    const notes = [];
    let group = null;
    // your own listing (the item you checked, up for sale): your asking price, not the market's
    let own = 0;
    if (cmp && cmp.self) {
      for (const x of listings || []) if (x) { x.own = !!x.item && listingLib.sameItem(cmp.self, x.item); if (x.own) own++; }
      if (own) { listings = listings.filter((x) => x && !x.own); notes.push(own === 1 ? 'your own listing of this item left out' : `${own} listings of this very item left out (yours)`); }
    }
    if (cmp && cmp.item) {
      group = comparables.pick(cmp.item, listings, cmp.opts || {}, priceQuery.MIN);
      const better = (listings || []).filter((x) => x && x.diff && x.diff.extra.length).length;
      const weaker = (listings || []).filter((x) => x && x.diff && !x.diff.extra.length && x.diff.missing.length).length;
      const what = cmp.opts && cmp.opts.kind === 'map' ? ['better numbers or more mods', 'weaker numbers or fewer mods'] : ['more or bigger mods', 'less'];
      if (group.group === 'alike' && group.alike < (listings || []).length) notes.push(`priced on the ${group.alike} listings like yours; left out: ${[better ? `${better} with ${what[0]}` : '', weaker ? `${weaker} with ${what[1]}` : ''].filter(Boolean).join(', ')}`);
      else if (group.group === 'close') notes.push(`few listings are just like yours: priced on the ${group.close} that differ by one stat`);
      else if (group.group === 'better') notes.push(`few listings are just like yours: priced on the ones at least as good, so this may be high`);
      else if (group.group === 'all' && better) notes.push(`most listings have more or bigger mods than yours, so this may be high`);
      listings = group.listings;
    }
    // listings known to be like yours (the 'alike' group, or a tablet found on all its mods at close
    // values): their cheap ones are the market, not baits, and dearer asks don't lift the price
    const alike = (group && group.group === 'alike') || !!(cmp && cmp.exact);
    const s = priceLib.priceStats(listings, { alike });
    if (!s) return own ? { count: 0, sellers: 0, total: own, notes, baits: 0, group: null, typicalEx: null, typical: null, range: null, few: true, own, verdict: 'The only listing found is your own (the same item), so there is nothing to price it against.' } : null;
    // every listing found is weaker than yours: their price is a floor, not your item's price
    if (group && group.group === 'weaker') {
      const floor = s.count ? fmtEx(s.typicalEx) : null;
      return { count: s.count, sellers: s.sellers, total: s.total, notes, baits: s.baits || 0, group: 'weaker', typicalEx: null, typical: null, range: null, few: true,
        cheapestEx: s.cheapestEx == null ? null : s.cheapestEx, cheapest: s.cheapestEx == null ? null : fmtEx(s.cheapestEx), floorEx: s.typicalEx,
        verdict: `Every listing found is weaker than yours (lower numbers or fewer mods)${floor ? `, so it's worth more than about ${floor}` : ''}. Not enough like it to price.` };
    }
    const rate = C.store.settings.divineRate;
    if (s.unconvertible) notes.push(`${pl(s.unconvertible, 'listing is', 'listings are')} priced in ${rate ? 'a currency' : 'divines or a currency'} without a known ${C.G().base} rate${rate ? '' : " (poe.ninja couldn't be reached)"}, so ${s.unconvertible === 1 ? "it's" : "they're"} left out`);
    if (rate && C.store.settings.divineRateAt && Date.now() - C.store.settings.divineRateAt > 6 * C.HOUR) notes.push(`the divine rate (${rate} ${C.G().baseShort}) is ${Math.round((Date.now() - C.store.settings.divineRateAt) / C.HOUR)} hours old`);
    if (rate && league && C.store.settings.divineRateLeague && C.store.settings.divineRateLeague !== league) notes.push(`the divine rate is from ${C.store.settings.divineRateLeague}, not ${league}`);
    if (s.baits) notes.push(`${pl(s.baits, 'listing', 'listings')} far under the rest left out (likely price-fixing bait)`);
    if (s.stale) notes.push(`${pl(s.stale, 'listing', 'listings')} older than ${priceLib.STALE_DAYS} days left out`);
    if (s.staleKept) notes.push(`${pl(s.staleKept, 'listing is', 'listings are')} over ${priceLib.STALE_DAYS} days old and may not be a real offer`);
    if (s.noPrice) notes.push(`${s.noPrice} unpriced`);
    if (s.spread && !s.few) notes.push('prices vary a lot');
    const out = {
      count: s.count, sellers: s.sellers, total: s.total, notes, baits: s.baits || 0, group: group ? group.group : null, alike, own,
      cheapestEx: s.cheapestEx == null ? null : s.cheapestEx, typicalEx: null, few: !!s.few, unreliable: s.unreliable,
      cheapest: s.cheapestEx == null ? null : fmtEx(s.cheapestEx), typical: null, range: null,
    };
    if (s.unreliable) {
      out.verdict = `Can't price this reliably: ${s.unconvertible} of the listings are priced in currencies without a known rate.`;
    } else if (s.few) {
      out.verdict = s.count ? `Only ${s.count} listed – not enough to judge${s.count ? ` (from ${fmtEx(s.cheapestEx)})` : ''}.` : 'No priced listings.';
    } else if (group && group.group !== 'alike' && priceLib.tooWide(s)) {
      // priced from listings that aren't like yours, and they're far apart (a ring found only on
      // some of its stats, listed at 1 div to 200 div): any one number would be made up, so the range
      // is the answer
      const n = Math.min(5, s.count);
      out.wide = true; out.lowEx = s.lowEx; out.highEx = s.highEx;
      out.range = `${fmtEx(s.lowEx)} – ${fmtEx(s.highEx)}`;
      out.verdict = `No one price: nothing listed is close enough to yours, and the cheapest ${n} similar listings ask ${out.range}.`;
    } else {
      out.typicalEx = s.typicalEx; out.typical = fmtEx(s.typicalEx);
      out.range = s.lowEx !== s.highEx ? `${fmtEx(s.lowEx)} – ${fmtEx(s.highEx)}` : null;
      out.verdict = `Worth about ${out.typical}${out.range ? ` (most ${out.range})` : ''}.`;
      // listings just like yours from a looser search are still close matches: only the age of the
      // listings (a week, two) makes it less sure
      out.confidence = priceLib.confidence(s, group && group.group === 'alike' ? Math.min(level, 1) : level);
      // priced from listings that aren't quite like yours: never "solid"
      if (out.confidence && group && group.group !== 'alike') {
        const why = group.group === 'close' ? 'listings differ a little from yours' : group.group === 'better' ? 'listings are better than yours' : 'listings have more than yours';
        out.confidence = { grade: out.confidence.grade === 'solid' ? 'rough' : out.confidence.grade === 'rough' && group.group === 'all' ? 'guess' : out.confidence.grade, why: [out.confidence.why, why].filter(Boolean).join(', ') };
      }
      // selling it: a little under the cheapest comparable listing (not when the price is a guess)
      if (out.confidence && out.confidence.grade !== 'guess') {
        const rate = C.store.settings.divineRate;
        out.sell = ninjaLib.sellNote({ total: s.cheapestEx, totalDiv: rate ? s.cheapestEx / rate : null, unit: C.G().baseShort, stack: 1 });
      }
    }
    return out;
  }

  // ---------- the price check's trace in the log ----------
  // Enough to work out afterwards why a price came out as it did: what was searched and what was
  // left out (and why), how far the search was loosened, every listing price read (with the ones
  // dropped as baits or as stale marked), and the verdict with its confidence. No sellers' names.
  const short = (x) => (x == null ? '?' : x >= 100 ? String(Math.round(x)) : String(Math.round(x * 10) / 10));
  function logQuery(q, level, total, want) {
    const parts = [`price L${level}: ${total == null ? 'search failed' : `${total} listed`} (want ${want})`, `searched on ${q.need} of ${q.total}: ${(q.labels || []).join('; ') || '-'}`];
    if (level === 0 && q.skipped && q.skipped.length) parts.push(`left out: ${q.skipped.join('; ')}`);
    if (level === 0 && q.unmatched && q.unmatched.length) parts.push(`not on the trade site: ${q.unmatched.join('; ')}`);
    C.log(parts.join(' | '));
  }
  function logPrices(listings, summary) {
    const base = C.G().baseShort;
    const all = (listings || []).filter(Boolean);
    const g = summary && summary.group;
    const inGroup = (x) => !x.own && (!g || g === 'all' || (x.diff && (g === 'alike' ? !x.diff.extra.length && !x.diff.missing.length : x.diff.extra.length + x.diff.missing.length <= 1)));
    const s = priceLib.priceStats(all.filter(inGroup), { alike: !!(summary && summary.alike) });
    const baits = (s && s.baitPrices) || []; const stale = (s && s.stalePrices) || [];
    const marks = (ex) => { let i = baits.indexOf(ex); if (i >= 0) { baits.splice(i, 1); return ' [bait]'; } i = stale.indexOf(ex); if (i >= 0) { stale.splice(i, 1); return ' [stale]'; } return ''; };
    const diffText = (x) => (!x.diff ? '' : [...x.diff.extra.map((e) => `+${e}`), ...x.diff.missing.map((m) => `-${m}`)].join(', '));
    const rows = all.slice().sort((a, b) => (a.priceEx == null) - (b.priceEx == null) || (a.priceEx || 0) - (b.priceEx || 0)).slice(0, 25).map((x) => {
      const p = !x.price ? 'unpriced' : x.priceEx == null ? `${x.price.amount} ${x.price.currency} (no rate)` : `${x.price.currency === C.G().base ? '' : `${x.price.amount} ${x.price.currency}=`}${short(x.priceEx)}${x.own ? ' [your own listing]' : inGroup(x) ? marks(x.priceEx) : ' [not like yours]'}`;
      const d = diffText(x);
      return d ? `${p} {${d}}` : p;
    });
    if (rows.length) C.log(`price listings (${base}, cheapest first, ${all.length} read${g ? `, priced on: ${g}` : ''}): ${rows.join(' | ')}`);
    if (!summary) { C.log('price verdict: none (no priced listings)'); return; }
    const conf = summary.confidence ? `${summary.confidence.grade}${summary.confidence.why ? ` (${summary.confidence.why})` : ''}` : '-';
    C.log(`price verdict: ${summary.typical ? `≈ ${summary.typical}` : summary.verdict} | most ${summary.range || '-'} | ${summary.count} priced sellers of ${summary.sellers} | confidence ${conf}${summary.notes.length ? ` | ${summary.notes.join('; ')}` : ''}`);
  }

  // Each price check as one line of price-checks.jsonl next to the log: the item, the searches, and
  // every listing read (its text and price), so a price that looked wrong can be replayed and the
  // pricing tuned on real checks. Only public trade data: no seller names. Kept under ~5 MB (the
  // older half goes to price-checks.1.jsonl).
  const caseFile = () => path.join(app.getPath('userData'), 'price-checks.jsonl');
  function appendCase(obj) {
    const file = caseFile();
    let size = 0; try { size = fs.statSync(file).size; } catch (_) { /* new */ }
    if (size > 5 * 1024 * 1024) { try { fs.renameSync(file, file.replace(/\.jsonl$/, '.1.jsonl')); } catch (_) { /* keep going */ } }
    fs.appendFileSync(file, JSON.stringify(obj) + '\n');
  }
  // -> the check's id (for your verdict on it), or null
  function saveCase(item, league, steps, listings, summary) {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      appendCase({
        id, at: new Date().toISOString(), game: C.tg(), league, item: item.raw || null, steps,
        listings: (listings || []).filter(Boolean).map((x) => ({ price: x.price, priceEx: x.priceEx, indexed: x.indexed, text: x.item && x.item.listingText ? x.item.listingText : null, affixes: x.item && x.item.affixCount != null ? x.item.affixCount : undefined })),
        verdict: summary ? { typicalEx: summary.typicalEx, floorEx: summary.floorEx, range: summary.range, group: summary.group, confidence: summary.confidence, notes: summary.notes } : null,
      });
      return id;
    } catch (err) { C.log('price check: could not save the case: ' + err.message); return null; }
  }

  // ---------- your verdict on a price ("too low / about right / too high", and what it's worth) ----------
  // Saved with the check it's about, so the pricing can be measured against what you know
  // (tools/replay-prices.js). actual: what you typed ("3 div", "250 ex", "40 chaos", "3.5d").
  function parseActual(text) {
    const m = String(text || '').trim().toLowerCase().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*([a-z]*)/);
    if (!m) return null;
    const v = Number(m[1]); const u = m[2];
    const rates = C.store.settings.currencyRates || {};
    const div = C.store.settings.divineRate;
    const poe1 = C.tg() === 'poe1'; // prices are counted in exalts (PoE2) or chaos (PoE1)
    if (!u) return v; // no currency: the game's own unit
    if (/^(d|div|divs|divine|divines)$/.test(u)) return div ? v * div : null;
    if (/^(e|ex|exa|exalt|exalts|exalted)$/.test(u)) return poe1 ? (rates.exalted ? v * rates.exalted : null) : v;
    if (/^(c|ch|chaos)$/.test(u)) return poe1 ? v : rates.chaos ? v * rates.chaos : null;
    return null;
  }
  ipcMain.handle('price:feedback', (_e, caseId, rating, actual) => {
    if (typeof caseId !== 'string' || !/^[a-z0-9-]{4,40}$/.test(caseId)) return { ok: false };
    const r = ['low', 'right', 'high'].includes(rating) ? rating : null;
    const text = typeof actual === 'string' ? actual.slice(0, 40) : '';
    const actualEx = text ? parseActual(text) : null;
    if (text && actualEx == null) return { ok: false, error: 'Write it like "3 div", "250 ex" or "40 chaos".' };
    try { appendCase({ feedback: caseId, at: new Date().toISOString(), rating: r, actual: text || null, actualEx }); } catch (err) { return { ok: false, error: err.message }; }
    C.log(`price check ${caseId}: you said ${r || '-'}${text ? `, worth ${text}` : ''}`);
    return { ok: true };
  });

  // ---------- where to spend your divines ----------
  ipcMain.handle('trade:price', C.inGame(async (_e, target, picks) => {
    const item = C.resolveItem(target);
    if (!item) return { ok: false, error: 'No item to price.' };
    return tradePrice(item, picks, { window: true });
  }));
  // the trade site's price for an item. opts.window: show the listings in the results window;
  // without it (Alt+E's quick price) the listings are only read for the price
  async function tradePrice(item, picks, opts0 = {}) {
    let d;
    try { d = await C.loadTradeData(false); } catch (err) { return { ok: false, error: 'Could not load trade site data: ' + (err.message || err) }; }
    await C.refreshDivineRate(false);
    const league = C.pickLeague(d);
    const armourOrWeapon = ['Weapon', 'Offhand', 'Helmet', 'Body Armour', 'Gloves', 'Boots'].includes(item.slot);
    // Price check looks for close matches to THIS item, without your price range
    // or ignored stats (those are about what you want, not what it's worth).
    // always "available" listings (instant buyout + in person): offline sellers' prices aren't what it sells for
    const opts = { statIndex: d.index, filtersData: d.filters, preferLocal: armourOrWeapon, forPrice: true, game: C.tg() };
    let r = null; let q = null;
    // you chose the stats in the popup: exactly those, at your minimums (with the same rarity,
    // corruption, links and influences as the item), one search
    const chosen = Array.isArray(picks) ? picks.filter((p) => p && typeof p.key === 'string').slice(0, 20) : null;
    // rare and magic gear: the market search (pricequery.js); uniques and the rest: the like-for-like one
    // maps, waystones and tablets: their tier / kind and numbers (pricequery.js)
    const mapish = !chosen && priceQuery.usesMapPriceQuery(item);
    const market = !chosen && !mapish && priceQuery.usesPriceQuery(item);
    const levels = chosen ? 1 : mapish ? (priceQuery.isTablet(item) ? priceQuery.TABLET_LEVELS : priceQuery.MAP_LEVELS).length : market ? priceQuery.LEVELS.length : 3;
    // the closest search with enough listings to judge wins. A market search goes on loosening until
    // there are ENOUGH (three asking prices from three days is too few to price on: the Eagle
    // Splinter jewel came out at 5 div from 2, 5 and 13 div); the looser matches that aren't like
    // your item are then left out again by comparables.js, so a looser search adds evidence
    // without pricing yours on different items
    const enough = market || mapish ? priceQuery.ENOUGH : 3;
    C.log(`price check: ${item.itemClass || '?'} "${item.name || '?'}"${item.baseType && item.baseType !== item.name ? ` (${item.baseType})` : ''}, ${item.rarity || '?'}${item.corrupted ? ', corrupted' : ''} – ${chosen ? 'the stats you chose' : mapish ? 'map/waystone/tablet search' : market ? 'market search' : 'like-for-like search'}, league ${league}`);
    // the item itself, so the same check can be run again from the log
    if (item.raw) C.log(`price item: ${String(item.raw).replace(/\r?\n/g, ' / ').slice(0, 1500)}`);
    const steps = [];
    for (let level = 0; level < levels; level++) {
      q = mapish ? priceQuery.buildMapPriceQuery(item, { ...opts, level }) : market ? priceQuery.buildPriceQuery(item, { ...opts, level }) : trade.buildSimilarQuery(item, { ...opts, level });
      if (chosen) {
        const c = trade.buildQuery(chosen.map((p) => ({ key: p.key, min: p.min, max: p.max, source: p.source, ...(typeof p.id === 'string' && /^[a-z]+\.[a-z0-9_]{1,80}$/.test(p.id) ? { id: p.id, idType: ['pseudo', 'explicit', 'implicit', 'enchant', 'rune', 'fractured', 'crafted'].includes(p.idType) ? p.idType : undefined } : {}) })), { itemClass: item.itemClass, statIndex: d.index, filtersData: d.filters, preferLocal: armourOrWeapon, status: 'available' });
        q.body.query.stats = c.body.query.stats;
        const eq = c.body.query.filters && c.body.query.filters.equipment_filters;
        if (eq) q.body.query.filters.equipment_filters = eq; else delete q.body.query.filters.equipment_filters;
        q.levelLabel = 'the stats you chose'; q.need = chosen.length - c.unmatched.length; q.total = chosen.length;
        if (c.unmatched.length) q.unmatched = c.unmatched;
      }
      q.body.sort = { price: 'asc' };
      r = await C.runSearch(league, q.body, chosen ? 'price chosen' : `price L${level}`);
      logQuery(q, level, r && r.ok ? r.total : null, enough);
      steps.push({ level, total: r && r.ok ? r.total : null, labels: q.labels, query: q.body.query });
      if (!r.ok || r.total == null || r.total >= enough) break;
      if (r.near) break;
      await new Promise((res) => setTimeout(res, 700));
    }
    if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'Search failed.' };
    // the search itself failed (only a pre-filled link came back): open that rather than saying "nothing listed"
    if (r.total == null) return { ok: true, mode: 'price', total: null, league, item: item.name, url: r.url, fallback: true, levelLabel: q.levelLabel }; // a button, never a browser by itself
    if (!r.total) return { ok: true, mode: 'price', total: 0, league, item: item.name, url: r.url, levelLabel: q.levelLabel };
    const ctx = { item, mode: 'price', title: `Price check: ${item.name}`, body: q.body, searchKey: C.searchKey(q.body),
      note: `Listings like this one (${q.levelLabel}, ${q.need} of ${q.total} stats), cheapest first.` };
    if (!C.sameGame()) return C.SWITCHED();
    if (!opts0.window) {
      // just the price: the first 40 listings read, nothing shown, nothing judged
      const rates = { ...(C.store.settings.currencyRates || {}), ...(C.store.settings.divineRate ? { divine: C.store.settings.divineRate } : {}) };
      const raw = r.ids && r.ids.length ? await C.fetchListings(league, r.searchId, r.ids.slice(0, 40), C.tg()) : [];
      let listings = raw.map((x) => listingLib.summarise(x, item.itemClass, rates, C.G().base));
      const cmp = compareWith(item, opts, market, mapish, q.level || 0);
      let summary = priceSummary(listings, league, q.level || 0, cmp);
      // few of the cheapest 40 are like yours: the ones like it are often a little dearer, so 40 more
      // are read (one more round of the trade site's fetches) before judging
      if (cmp && summary && summary.group && summary.group !== 'alike' && r.ids.length > 40 && C.sameGame()) {
        const more = await C.fetchListings(league, r.searchId, r.ids.slice(40, 80), C.tg()).catch((err) => { C.log('price check: could not read more listings: ' + err.message); return []; });
        if (more.length) {
          C.log(`price check: only ${summary.group === 'weaker' ? 'weaker' : 'a few'} listings like yours in the first 40: read ${more.length} more`);
          listings = listings.concat(more.map((x) => listingLib.summarise(x, item.itemClass, rates, C.G().base)));
          summary = priceSummary(listings, league, q.level || 0, cmp);
        }
      }
      logPrices(listings, summary);
      const caseId = saveCase(item, league, steps, listings, summary);
      if (summary) summary.caseId = caseId;
      if (summary && summary.typicalEx != null && item.id) C.lastWorth.set(item.id, summary.typicalEx);
      return { ok: true, mode: 'price', total: r.total, league, item: item.name, url: r.url, summary, levelLabel: q.levelLabel, level: q.level };
    }
    const shown = r.ids && r.ids.length ? await C.showResults(r, ctx) : false;
    let summary = null;
    if (shown === 'superseded') {
      // you searched again or changed game while this loaded: nothing to show, no browser either
    } else if (shown) {
      const cmp = compareWith(item, opts, market, mapish, q.level || 0);
      Object.defineProperty(C.resultsState.ctx, 'priceCompare', { value: cmp, enumerable: false, writable: true, configurable: true });
      summary = priceSummary(C.resultsState.listings, league, q.level || 0, cmp);
      logPrices(C.resultsState.listings, summary);
      const caseId = saveCase(item, league, steps, C.resultsState.listings, summary);
      if (summary) summary.caseId = caseId;
      C.resultsState.ctx.priceSummary = summary;
      C.resultsState.ctx.priceLeague = league;
      C.resultsState.ctx.priceLevel = q.level || 0;
      if (summary && summary.typicalEx != null && item.id) C.lastWorth.set(item.id, summary.typicalEx);
      if (C.resultsWin && !C.resultsWin.isDestroyed()) C.resultsWin.webContents.send('results:data', C.resultsPayload());
    } else {
      await shell.openExternal(r.url);
    }
    return { ok: true, mode: 'price', total: r.total, league, item: item.name, url: r.url, inApp: shown === true, opened: shown !== 'superseded',
      summary, levelLabel: q.levelLabel, level: q.level, need: q.need, of: q.total };
  }

  return {
    chaosRate,
    priceSummary,
    tradePrice,
  };
};
