'use strict';

// Prices from poe.ninja for things that aren't judged as gear: currency, fragments, essences,
// runes, divination cards, gems, maps, uniques... (https://poe.ninja/docs/api)
//
// poe.ninja asks desktop apps to go through their own server instead of every player's PC
// calling it, so requests go to the app's small caching proxy on poe2upgrade.com first
// (worker/site-worker.js) and only straight to poe.ninja if that's down.

const games = require('./games');

const PROXY = 'https://poe2upgrade.com/ninja';
const DIRECT = 'https://poe.ninja';

// /{game}/api/economy/exchange/current/overview?type=… (bulk-traded things)
const EXCHANGE_TYPES = {
  poe2: ['Currency', 'Fragments', 'Abyss', 'UncutGems', 'LineageSupportGems', 'Essences', 'SoulCores', 'Idols', 'Runes', 'Ritual', 'Expedition', 'Delirium', 'Breach', 'Verisium'],
  poe1: ['Currency', 'Fragment', 'Runegraft', 'AllflameEmber', 'Tattoo', 'Omen', 'DjinnCoin', 'Ducat', 'EnshroudingCrystal', 'DivinationCard', 'Artifact', 'Oil', 'DeliriumOrb', 'Scarab', 'Thread', 'SoulCore', 'Astrolabe', 'Fossil', 'Resonator', 'Essence'],
};
// /{game}/api/economy/stash/current/item/overview?type=… (one-off items)
const UNIQUE_TYPES = {
  poe2: { weapon: 'UniqueWeapons', armour: 'UniqueArmours', accessory: 'UniqueAccessories', flask: 'UniqueFlasks', charm: 'UniqueCharms', jewel: 'UniqueJewels', relic: 'UniqueSanctumRelics', tablet: 'UniqueTablets' },
  poe1: { weapon: 'UniqueWeapon', armour: 'UniqueArmour', accessory: 'UniqueAccessory', flask: 'UniqueFlask', jewel: 'UniqueJewel', tincture: 'UniqueTincture', relic: 'UniqueRelic', map: 'UniqueMap' },
};

function path(game, what, query) {
  const g = games.gameOf(game).id;
  const q = Object.entries(query || {}).filter(([, v]) => v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return `${g}/${what}${q ? '?' + q : ''}`;
}
// the proxy first, then poe.ninja itself
function urls(game, what, query) {
  const p = path(game, what, query);
  const g = games.gameOf(game).id;
  return [`${PROXY}/${p}`, `${DIRECT}/${g}/api/economy/${p.slice(g.length + 1)}`];
}
// the app's proxy gathers every exchange list of a game into one answer: { types: { Currency: {...}, ... } }
const allExchangeUrl = (league, game) => `${PROXY}/${games.gameOf(game).id}/exchange/all?league=${encodeURIComponent(league)}`;
const exchangeUrls = (league, type, game) => urls(game, 'exchange/current/overview', { league, type });
const itemUrls = (league, type, game) => urls(game, 'stash/current/item/overview', { league, type });

const WEAPON = /^(claws|daggers|rune daggers|wands|one hand swords|thrusting one hand swords|one hand axes|one hand maces|sceptres|spears|flails|bows|staves|warstaves|quarterstaves|two hand swords|two hand axes|two hand maces|crossbows|fishing rods|talismans|traps)$/i;
const ARMOUR = /^(helmets|body armours|gloves|boots|shields|quivers|foci|bucklers)$/i;
const ACCESSORY = /^(rings|amulets|belts|trinkets)$/i;

// what to look up for an item: { exchange: true } and/or item overview types
function typesFor(item, game) {
  const g = games.gameOf(game).id;
  const cls = String((item && item.itemClass) || '').trim();
  const unique = /unique/i.test((item && item.rarity) || '');
  const out = { exchange: false, items: [] };
  if (unique) {
    const u = UNIQUE_TYPES[g];
    const kind = WEAPON.test(cls) ? 'weapon' : ARMOUR.test(cls) ? 'armour' : ACCESSORY.test(cls) ? 'accessory'
      : /flasks?$/i.test(cls) ? 'flask' : /charms?$/i.test(cls) ? 'charm' : /jewels?$/i.test(cls) ? 'jewel'
        : /tinctures?$/i.test(cls) ? 'tincture' : /relics?$/i.test(cls) ? 'relic' : /tablets?$/i.test(cls) ? 'tablet' : /^maps$/i.test(cls) ? 'map' : null;
    if (kind && u[kind]) out.items.push(u[kind]);
    if (g === 'poe1' && kind === 'jewel') out.items.push('ForbiddenJewel');
    if (g === 'poe2' && kind === 'tablet') out.items.push('PrecursorTablets');
    return out;
  }
  if (item && item.slot) return out; // magic/rare gear is priced from trade listings, not poe.ninja
  if (g === 'poe1') {
    if (/gems?$/i.test(cls)) { out.items.push('SkillGem', 'ImbuedGem'); return out; }
    if (/^maps$/i.test(cls)) { out.items.push(/^blight-ravaged /i.test(item.baseType || '') ? 'BlightRavagedMap' : /^blighted /i.test(item.baseType || '') ? 'BlightedMap' : 'Map'); return out; }
    const extra = { incubators: 'Incubator', 'memory lines': 'Memory', 'vials': 'Vial', invitations: 'Invitation', 'scrying orbs': 'ScryingOrb' }[cls.toLowerCase()];
    if (extra) out.items.push(extra);
  }
  out.exchange = true; // currency, fragments, essences, divination cards, runes, omens...
  return out;
}

// numbers the parser doesn't keep: stack size, gem level and quality, map tier
function extras(item) {
  const t = String((item && item.raw) || '');
  const num = (re) => { const m = t.match(re); return m ? Number(m[1]) : null; };
  return {
    stack: num(/^Stack Size:\s*([\d,.]+)/m) != null ? Number(String(t.match(/^Stack Size:\s*([\d,.]+)/m)[1]).replace(/[,.]/g, '')) : 1,
    level: num(/^Level:\s*(\d+)/m),
    quality: num(/^Quality:\s*\+?(\d+)%/m) || 0,
    tier: num(/^(?:Map|Waystone) Tier:\s*(\d+)/m),
  };
}

// the value of one primary-currency amount in `cur` (an exchange answer's core: primary + rates)
function convert(v, core, cur) {
  if (!(v > 0)) return null;
  const primary = core && core.primary;
  if (!primary || primary === cur) return v;
  const r = core.rates && Number(core.rates[cur]);
  return r > 0 ? v * r : null;
}
const change = (s) => { const c = s && Number(s.totalChange); return Number.isFinite(c) ? Math.round(c * 10) / 10 : null; };
// poe.ninja's 7-day sparkline: each day's % change from the first day. As prices relative to today
// (1 = today's price), oldest first; null for a day without data. [] when there's nothing to draw.
function history(s) {
  const d = s && Array.isArray(s.data) ? s.data.map((v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v))) : [];
  const last = [...d].reverse().find((v) => v != null);
  if (last == null || d.filter((v) => v != null).length < 2) return [];
  return d.map((v) => (v == null ? null : Math.round(((1 + v / 100) / (1 + last / 100)) * 1000) / 1000));
}

// from one exchange answer: { name(lowercase) -> { name, value(primary), change, volume, category } }
// Memoised per answer object: answers are cached and never changed, and a price lookup goes through up
// to 18 of them, so building each index once is enough.
const exchangeIndexCache = new WeakMap();
function exchangeIndex(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.lines)) return new Map();
  const cached = exchangeIndexCache.get(data);
  if (cached) return cached;
  const out = new Map();
  const items = new Map([...((data.core && data.core.items) || []), ...(data.items || [])].map((i) => [i.id, i]));
  for (const l of data.lines) {
    const it = items.get(l.id);
    if (!it || !it.name || !(Number(l.primaryValue) > 0)) continue;
    out.set(it.name.toLowerCase(), { name: it.name, value: Number(l.primaryValue), change: change(l.sparkline || l.sparkLine), history: history(l.sparkline || l.sparkLine), volume: Number(l.volumePrimaryValue) || null, category: it.category || null, core: data.core || null });
  }
  exchangeIndexCache.set(data, out);
  return out;
}

// the best line of an item overview for this item (gem level and quality, map tier, links, variant)
function pickLine(lines, item, game) {
  const name = String(item.name || '').toLowerCase();
  const base = String(item.baseType || '').toLowerCase();
  const ex = extras(item);
  const unique = /unique/i.test(item.rarity || '');
  let c = (lines || []).filter((l) => {
    const n = String(l.name || '').toLowerCase();
    if (unique) return n === name;
    if (/gems?$/i.test(item.itemClass || '')) return n === name;
    // a magic map has no base line, only its name with the affixes ("Fecund Strand Map of Toughness")
    if (/^maps$/i.test(item.itemClass || '')) return base ? n === base || n === name || String(l.baseType || '').toLowerCase() === base : n === name || (/ map$/.test(n) && ` ${name} `.includes(` ${n} `));
    return n === name || n === base;
  });
  if (!c.length) return null;
  if (/gems?$/i.test(item.itemClass || '')) {
    c = c.filter((l) => !!l.corrupted === !!item.corrupted);
    if (!c.length) return null;
    const lv = ex.level || 1;
    // the closest level at or below yours, then the closest quality
    const below = c.filter((l) => (l.gemLevel || 1) <= lv);
    const pool = below.length ? below : c;
    const best = Math.max(...pool.map((l) => l.gemLevel || 1));
    c = pool.filter((l) => (l.gemLevel || 1) === best).sort((a, b) => Math.abs((a.gemQuality || 0) - ex.quality) - Math.abs((b.gemQuality || 0) - ex.quality));
    return c[0];
  }
  if (ex.tier != null && c.some((l) => l.mapTier != null)) {
    const t = c.filter((l) => l.mapTier === ex.tier);
    if (t.length) c = t;
  }
  if (unique) {
    // PoE1 5- and 6-link uniques are priced on their own; everything else is the unlinked one
    const links = item.links >= 5 ? item.links : null;
    const byLinks = c.filter((l) => (l.links || null) === links);
    if (byLinks.length) c = byLinks;
    const plain = c.filter((l) => !l.corrupted === !item.corrupted);
    if (plain.length) c = plain;
    // a unique with several versions ("Lightning", "Physical"...): the one whose name is in the item's mods
    const variants = [...new Set(c.map((l) => l.variant).filter(Boolean))];
    if (variants.length > 1) {
      const text = String(item.raw || item.listingText || '').toLowerCase();
      const score = (v) => String(v).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !/^(and|the|of|with|jewel|jewels|passive|passives)$/.test(w))
        .filter((w) => new RegExp(`\\b${w}`).test(text)).length;
      const best = Math.max(...c.map((l) => score(l.variant || '')));
      const top = best > 0 ? c.filter((l) => score(l.variant || '') === best) : [];
      if (top.length && new Set(top.map((l) => l.variant)).size === 1) c = top;
      else {
        // can't tell which version it is: say so rather than quote another version's price
        const pick = c.sort((a, b) => (b.listingCount || b.count || 0) - (a.listingCount || a.count || 0))[0];
        return { ...pick, unsure: true };
      }
    }
  }
  return c.sort((a, b) => (b.listingCount || b.count || 0) - (a.listingCount || a.count || 0))[0];
}

// one item overview line's value in `cur`: PoE1 lines carry chaosValue/divineValue, PoE2 primaryValue
function lineValue(l, core, cur) {
  if (!l) return null;
  if (l.primaryValue != null) return convert(Number(l.primaryValue), core, cur);
  if (cur === 'chaos' && l.chaosValue > 0) return Number(l.chaosValue);
  if (cur === 'divine' && l.divineValue > 0) return Number(l.divineValue);
  if (cur === 'exalted' && l.exaltedValue > 0) return Number(l.exaltedValue);
  return null;
}

// The price of an item from poe.ninja answers. found: { exchange: [answers], items: [answers] }
// -> { each, eachDiv, total, totalDiv, unit, change, listings, few, name, stack } or null
function priceOf(item, found, game) {
  const g = games.gameOf(game);
  const base = g.base;
  const ex = extras(item);
  const stack = Math.max(1, ex.stack || 1);
  let hit = null;
  for (const ans of (found && found.items) || []) {
    const l = pickLine(ans && ans.lines, item, game);
    if (!l) continue;
    const each = lineValue(l, ans.core, base); const div = lineValue(l, ans.core, 'divine');
    if (each == null && div == null) continue;
    const listings = l.listingCount || l.count || null;
    hit = { each, eachDiv: div, change: change(l.sparkLine || l.sparkline), history: history(l.sparkLine || l.sparkline), listings, name: l.name, variant: l.variant || null, unsure: !!l.unsure,
      gemLevel: l.gemLevel || null, gemQuality: l.gemQuality || null, links: l.links || null, mapTier: l.mapTier || null };
    break;
  }
  if (!hit) {
    const key = String(item.name || '').toLowerCase(); const key2 = String(item.baseType || '').toLowerCase();
    for (const ans of (found && found.exchange) || []) {
      const idx = exchangeIndex(ans);
      const e = idx.get(key) || idx.get(key2);
      if (!e) continue;
      hit = { each: convert(e.value, e.core, base), eachDiv: convert(e.value, e.core, 'divine'), change: e.change, history: e.history, volume: e.volume, name: e.name, category: e.category };
      break;
    }
  }
  if (!hit) return null;
  const round = (v) => (v == null ? null : v >= 100 ? Math.round(v) : v >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100);
  return {
    ...hit, each: round(hit.each), eachDiv: round(hit.eachDiv), stack,
    total: hit.each == null ? null : round(hit.each * stack), totalDiv: hit.eachDiv == null ? null : round(hit.eachDiv * stack),
    unit: g.baseShort, few: hit.listings != null && hit.listings < 5, source: 'poe.ninja',
  };
}

// links to read about an item (wiki and poedb), by its name or base
function infoLinks(item, game) {
  if (!item) return [];
  const g = games.gameOf(game).id;
  const unique = /unique/i.test(item.rarity || '');
  const page = (unique || !item.slot ? item.name : item.baseType) || item.name;
  if (!page) return [];
  const w = encodeURIComponent(String(page).replace(/ /g, '_'));
  return g === 'poe1'
    ? [{ label: 'Wiki', url: `https://www.poewiki.net/wiki/${w}` }, { label: 'poedb', url: `https://poedb.tw/us/${w}` }]
    : [{ label: 'Wiki', url: `https://www.poe2wiki.net/wiki/${w}` }, { label: 'poe2db', url: `https://poe2db.tw/us/${w}` }];
}
const INFO_HOSTS = /^https:\/\/(www\.poewiki\.net|www\.poe2wiki\.net|poedb\.tw|poe2db\.tw)\//;
const isInfoPage = (url) => typeof url === 'string' && INFO_HOSTS.test(url);

// a price note to list the item at (pasted by the player into the item's note in a premium stash tab):
// a little under poe.ninja so it sells, in divines when it's worth one or more, else the game's base currency.
// The note's price is for the whole stack.
const FULL = { ex: 'exalted', chaos: 'chaos' };
function sellNote(p, opts) {
  if (!p || p.unsure) return null; // not sure which version of the unique it is: no price to list at
  const cut = 1 - ((opts && opts.undercut) != null ? opts.undercut : 0.05);
  const div = p.totalDiv != null ? p.totalDiv * cut : null;
  const base = p.total != null ? p.total * cut : null;
  let amt; let cur; let short;
  if (div != null && div >= 1) { amt = div >= 10 ? Math.round(div) : Math.round(div * 2) / 2; cur = 'divine'; short = 'div'; }
  else if (base != null && base >= 1) { amt = base >= 20 ? Math.round(base) : Math.max(1, Math.floor(base)); cur = FULL[p.unit] || p.unit; short = p.unit; }
  else return null; // worth less than one base currency: vendor it
  return { amount: amt, currency: cur, note: `~price ${amt} ${cur}`, text: `${amt} ${short}${p.stack > 1 ? ` for the stack of ${p.stack}` : ''}` };
}

module.exports = { sellNote, history, PROXY, EXCHANGE_TYPES, UNIQUE_TYPES, urls, allExchangeUrl, exchangeUrls, itemUrls, typesFor, extras, exchangeIndex, pickLine, priceOf, convert, infoLinks, isInfoPage };
