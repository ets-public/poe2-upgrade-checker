'use strict';

// For sale (Check an item page): every item you copied a price note for ("~price 3 divine") is kept on a
// list. *Check* searches the trade site again with that item's own price search and says whether your
// listing is still up and whether it's still the cheapest like it, or gone (sold or taken down). Checks
// only run when you ask, inside the trade site's limits; nothing is searched in the background.
const fs = require('fs');
const path = require('path');
const { app, ipcMain } = require('electron');
const listingLib = require('../core/listing');
const forsale = require('../core/forsale');

const MAX = 40;

module.exports = function (C) {
  const file = () => path.join(app.getPath('userData'), 'for-sale.json');
  let list = null;
  function load() {
    if (list) return list;
    try { const j = JSON.parse(fs.readFileSync(file(), 'utf8')); list = Array.isArray(j) ? j.filter((x) => x && x.id) : []; } catch (_) { list = []; }
    return list;
  }
  function save() { try { const tmp = file() + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(list)); fs.renameSync(tmp, file()); } catch (err) { C.log('for sale: could not save: ' + err.message); } }

  // the price search a price check used for an item (worth.js keeps the last one per item)
  const bodies = new Map(); // item id -> { body, league, game }
  function rememberSearch(itemId, body, league, game) {
    if (!itemId || !body) return;
    bodies.set(itemId, { body: JSON.parse(JSON.stringify(body)), league, game });
    if (bodies.size > 100) bodies.delete(bodies.keys().next().value);
  }

  function add(note, priceText) {
    const item = C.popupItem;
    if (!item || !note) return null;
    load();
    const s = bodies.get(item.id) || null;
    const entry = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, at: Date.now(), game: C.tg(), league: (s && s.league) || C.store.settings.league || null,
      item: { name: item.name || '', baseType: item.baseType || '', rarity: item.rarity || '', itemClass: item.itemClass || '', lines: (item.lines || []).map((l) => ({ key: l.key, value: l.value, tag: l.tag })) },
      note: String(note).slice(0, 80), priceText: String(priceText || '').slice(0, 60), body: s ? s.body : null, check: null,
    };
    // the same item listed again (a new price): replaces the old entry
    list = list.filter((x) => !(x.game === entry.game && x.item.name === entry.item.name && x.item.baseType === entry.item.baseType && (listingLib.sameItem(x.item, entry.item) || !/rare|magic/i.test(entry.item.rarity))));
    list.unshift(entry);
    if (list.length > MAX) list = list.slice(0, MAX);
    save();
    C.log(`for sale: "${entry.item.name}" at ${entry.note}${entry.body ? '' : ' (no price search to check it with: by name)'}`);
    C.notifySettings('forsale:update', null);
    return entry.id;
  }

  // a search for the item when no price check was made (a unique priced by poe.ninja): by name and base
  function nameBody(e) {
    if (!/unique/i.test(e.item.rarity)) return null;
    return { query: { status: { option: 'any' }, name: e.item.name, ...(e.item.baseType ? { type: e.item.baseType } : {}), stats: [{ type: 'and', filters: [] }], filters: { type_filters: { filters: { rarity: { option: 'unique' } } } } }, sort: { price: 'asc' } };
  }

  async function check(id) {
    const e = load().find((x) => x.id === id);
    if (!e) return { ok: false, error: 'Not on the list any more.' };
    const body0 = e.body || nameBody(e);
    if (!body0) return { ok: false, error: 'No price check was made for it, so there is no search to check it with. Price check it (F3) and copy the note again.' };
    const body = JSON.parse(JSON.stringify(body0));
    body.query.status = { option: 'any' }; // offline sellers too: yours counts while you're offline
    body.sort = { price: 'asc' };
    let league = e.league;
    if (!league) { const d = await C.loadTradeData(false); league = C.pickLeague(d); }
    const r = await C.runSearch(league, body, 'for sale check', { game: e.game, anyGame: true });
    if (!r || !r.ok) return { ok: false, error: (r && r.error) || 'The trade site search failed.' };
    const rates = { ...(C.store.settings.currencyRates || {}), ...(C.store.settings.divineRate ? { divine: C.store.settings.divineRate } : {}) };
    const raw = r.ids && r.ids.length ? await C.fetchListings(league, r.searchId, r.ids.slice(0, 40), e.game) : [];
    const listings = raw.map((x) => listingLib.summarise(x, e.item.itemClass, rates, C.G(e.game).base));
    const st = forsale.status(e.item, listings);
    const wasFound = !!(e.check && e.check.found) || !!e.everFound;
    if (st.found) e.everFound = true;
    e.check = { ...st, at: Date.now(), total: r.total, text: forsale.text(st, wasFound), gone: !st.found && wasFound };
    save();
    C.log(`for sale: "${e.item.name}": ${e.check.text}`);
    return { ok: true, check: e.check };
  }

  ipcMain.handle('forsale:add', (_e, note, text) => add(note, text));
  ipcMain.handle('forsale:list', () => load().map((x) => ({ id: x.id, at: x.at, game: x.game, league: x.league, item: { name: x.item.name, baseType: x.item.baseType, rarity: x.item.rarity }, note: x.note, priceText: x.priceText, check: x.check, canCheck: !!(x.body || /unique/i.test(x.item.rarity)) })));
  ipcMain.handle('forsale:remove', (_e, id) => { load(); list = list.filter((x) => x.id !== id); save(); return true; });
  ipcMain.handle('forsale:check', async (_e, id) => { try { return await check(String(id || '')); } catch (err) { C.log('for sale: ' + (err.stack || err)); return { ok: false, error: err.message }; } });

  return { rememberSearch, add };
};
