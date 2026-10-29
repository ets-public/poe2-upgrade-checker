'use strict';

// What sold: a trade price check is searched again a few hours later, and the listings that are gone
// say what the item really sells for (core/sold.js). Only instant buyout listings count: they stay up
// while their seller is offline, so a gone one was bought or taken down, not just its seller logging
// off. The search again is the same search the price check made (instant buyout only), sent when
// you haven't searched for a while, one at a time, inside the trade site's rate limit. Nothing about
// sellers is kept: the listing ids and their prices.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const soldLib = require('../core/sold');

const HOUR = 3600 * 1000;
const AFTER = 3 * HOUR; // searched again after this long
const TOO_OLD = 48 * HOUR; // not after this (and dropped)
const KEEP = 7 * 24 * HOUR; // a done one is shown on the same search for this long
const MAX = 150;
const MIN_LISTINGS = 3; // fewer instant buyout listings than this: nothing to learn from
const IDLE = 60 * 1000; // after you've stopped searching for this long

module.exports = function (C) {
  const file = () => path.join(app.getPath('userData'), 'price-followups.json');
  let list = null;
  function load() {
    if (list) return list;
    try { const j = JSON.parse(fs.readFileSync(file(), 'utf8')); list = Array.isArray(j) ? j.filter((f) => f && typeof f === 'object' && f.id) : []; } catch (_) { list = []; }
    return list;
  }
  function save() {
    try { const tmp = file() + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(list)); fs.renameSync(tmp, file()); } catch (err) { C.log('sold: could not save: ' + err.message); }
  }
  const on = () => C.store.settings.soldCheck !== false;

  // a short price for the sentence: "2.5 div" or "180 ex"
  function shortEx(ex, game) {
    if (ex == null) return '?';
    const g = C.G(game);
    const div = game === C.store.activeGame() ? Number(C.store.settings.divineRate) : 0;
    if (div > 0 && ex >= div * 0.95) return `${Math.round((ex / div) * 10) / 10} div`;
    return `${ex < 10 ? Math.round(ex * 10) / 10 : Math.round(ex).toLocaleString('en')} ${g.baseShort}`;
  }

  // after a trade price check: what to search again later. listings: the ones read (summarised),
  // used: the ids the price came from (the listings like yours), when known
  function record({ caseId, game, league, item, body, total, listings, used }) {
    if (!on() || !body || !body.query || !Array.isArray(listings)) return null;
    const keep = used && used.length ? new Set(used) : null;
    const mine = listings.filter((l) => l && l.id && l.instant && !l.own && typeof l.priceEx === 'number' && l.priceEx > 0 && (!keep || keep.has(l.id)))
      .slice(0, 60).map((l) => ({ id: l.id, priceEx: Math.round(l.priceEx * 100) / 100 }));
    if (mine.length < MIN_LISTINGS) { C.log(`sold: not following up "${item && item.name}" (${mine.length} instant buyout listings like it)`); return null; }
    const key = C.searchKey(body);
    load();
    // the same search already waiting: the newer one replaces it
    list = list.filter((f) => !(f.key === key && f.state === 'waiting'));
    const f = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, caseId: caseId || null, at: Date.now(), game, league, key,
      item: { name: (item && item.name) || '', baseType: (item && item.baseType) || '', itemClass: (item && item.itemClass) || '', rarity: (item && item.rarity) || '' },
      body: JSON.parse(JSON.stringify(body)), total: total == null ? null : total, listings: mine, state: 'waiting', fails: 0,
    };
    list.unshift(f);
    if (list.length > MAX) list = list.slice(0, MAX);
    save();
    C.log(`sold: will search "${f.item.name}" again in ${AFTER / HOUR} h (${mine.length} instant buyout listings)`);
    return f.id;
  }

  // the latest answer for the same search (an earlier check of this item): { text, at, hours, gone, considered }
  function forKey(key) {
    if (!key) return null;
    const f = load().find((x) => x.key === key && x.state === 'done' && x.result && Date.now() - x.doneAt < KEEP);
    return f ? { text: f.text, at: f.at, doneAt: f.doneAt, gone: f.result.gone, considered: f.result.considered } : null;
  }

  let busy = false;
  async function tick() {
    if (busy || !on() || !C.store) return;
    load();
    const now = Date.now();
    // the ones too old to tell anything: dropped
    const before = list.length;
    list = list.filter((f) => !(f.state === 'waiting' && now - f.at > TOO_OLD) && !(f.state !== 'waiting' && now - (f.doneAt || f.at) > KEEP * 2));
    if (list.length !== before) save();
    const due = list.filter((f) => f.state === 'waiting' && now - f.at >= AFTER).sort((a, b) => a.at - b.at)[0];
    if (!due) return;
    // not while you search, check items, or the trade site's limit is close
    if (C.hotkeyBusy || (C.searchIdleMs && C.searchIdleMs() < IDLE) || (C.searchWait && C.searchWait() > 0)) return;
    busy = true;
    try {
      const body = JSON.parse(JSON.stringify(due.body));
      body.query.status = { option: 'securable' }; // instant buyout only
      body.sort = { price: 'asc' };
      const r = await C.runSearch(due.league, body, 'sold check', { game: due.game, anyGame: true, maxWait: 3000, background: true });
      if (!r || !r.ok || !Array.isArray(r.ids) || (r.body && r.body.query && r.body.query.status && r.body.query.status.option !== 'securable')) {
        if (r && r.rateLimited) return; // later
        due.fails = (due.fails || 0) + 1;
        if (due.fails >= 3) { due.state = 'failed'; due.doneAt = Date.now(); }
        C.log(`sold: search again for "${due.item.name}" failed (${(r && r.error) || 'no answer'})${due.state === 'failed' ? ': giving up' : ''}`);
        save();
        return;
      }
      const res = soldLib.compare(due, r.ids, r.total, Date.now());
      due.result = res; due.state = 'done'; due.doneAt = Date.now(); due.newTotal = r.total;
      due.text = soldLib.text(res, (ex) => shortEx(ex, due.game));
      due.body = undefined; // not needed any more
      save();
      C.log(`sold: "${due.item.name}": ${due.text}`);
      C.notifySettings('sold:update', null);
    } catch (err) {
      C.log('sold: ' + err.message);
    } finally { busy = false; }
  }

  // the recent ones, for the Check an item page
  function recent() {
    return load().slice(0, 20).map((f) => ({ id: f.id, at: f.at, doneAt: f.doneAt || null, state: f.state, game: f.game, league: f.league, item: f.item, text: f.text || null, count: (f.listings || []).length, dueAt: f.at + AFTER }));
  }
  const { ipcMain } = require('electron');
  ipcMain.handle('sold:list', () => ({ on: on(), list: recent(), after: AFTER / HOUR }));

  function start() { setInterval(() => { tick().catch((err) => C.log('sold: ' + err.message)); }, 60 * 1000); }

  return { record, forKey, tick, start, recent, AFTER, TOO_OLD };
};
