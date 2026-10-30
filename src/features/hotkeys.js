'use strict';

// The hotkeys: F2 (check), F3 (price only, with its popup) and the test item.
const { ipcMain, globalShortcut, shell } = require('electron');
const priceQuery = require('../core/pricequery');
const { parseItem } = require('../core/parser');

module.exports = function (C) {
  // ---------- the price hotkey (F3): a popup with just the price ----------
  // poe.ninja for what it prices (currency, gems, uniques...), the trade site for the rest (rare and
  // magic gear, waystones and maps, tablets). Nothing else on the popup.
  const DEFAULT_PRICE_HOTKEY = 'F3';
  let priceHotkey = null;
  // trade-site prices from the last hour, by item text: pressing F3 on the same item again answers at
  // once (and saves the trade site a search). "refresh" on the popup asks again.
  const QUICK_TTL = 60 * 60 * 1000;
  const quickCache = new Map();
  let quickLast = null;
  const quickKey = (item) => `${C.tg()}|${String(item.raw || '').replace(/\s+$/, '')}`;
  async function showQuickPrice(item, force) {
    quickLast = item;
    const r = { ok: true, kind: 'quickprice', item: { name: item.name, baseType: item.baseType, itemClass: item.itemClass, rarity: item.rarity, id: item.id }, pending: true };
    const key = quickKey(item);
    const hit = quickCache.get(key);
    if (!force && hit && Date.now() - hit.at < QUICK_TTL) {
      Object.assign(r, hit.r, { pending: false, checkedAt: hit.at }); C.showResult(r);
      C.log(`quick price: "${item.name}" from the last check ${Math.round((Date.now() - hit.at) / 60000)} min ago: ${r.trade ? `≈ ${r.trade.typical}` : r.ninja ? 'poe.ninja' : '?'}`);
      return;
    }
    C.showResult(r);
    const seq = C.popupSeq;
    const send = () => { if (seq === C.popupSeq && C.popup && !C.popup.isDestroyed()) C.popup.webContents.send('popup:result', C.serialise(r)); };
    const unique = /unique/i.test(item.rarity || '');
    const tradeFirst = !unique && (priceQuery.usesPriceQuery(item) || priceQuery.usesMapPriceQuery(item));
    try {
      if (!tradeFirst) {
        const p = await C.prices.ninjaPrice(item).catch((err) => { C.log('quick price, poe.ninja: ' + err.message); return null; });
        if (p) { r.ninja = p; r.source = 'poe.ninja'; }
        C.log(`quick price: "${item.name}" poe.ninja ${p ? `${p.name || ''}${p.variant ? ` (${p.variant})` : ''}: ${JSON.stringify({ each: p.each, div: p.eachDiv, stack: p.stack, listed: p.listings, volume: p.volume, unsure: p.unsure || undefined, league: p.league })}` : 'has no price for it'}`);
      }
      if (!r.ninja && (item.slot || tradeFirst || unique)) {
        const t = await C.gameCtx.run({ game: C.store.activeGame() }, () => C.tradePrice(item, null, { window: false }));
        if (!t.ok) r.error = t.error || 'The price search failed.';
        else if (t.fallback || t.total == null) r.error = "The trade site didn't answer. Try again in a moment.";
        else if (!t.total) r.error = 'Nothing like it is listed right now.';
        else if (t.summary && t.summary.typical) {
          r.trade = { typical: t.summary.typical, range: t.summary.range, sellers: t.summary.sellers, total: t.total, confidence: t.summary.confidence, baits: t.summary.baits || 0, caseId: t.summary.caseId || null, sold: t.summary.sold || null };
          r.source = `trade site, ${t.league}`;
          quickCache.set(key, { at: Date.now(), r: { trade: r.trade, source: r.source } });
          if (quickCache.size > 300) quickCache.delete(quickCache.keys().next().value);
        }
        else { r.error = (t.summary && t.summary.verdict) || 'Not enough listings to judge.'; r.caseId = (t.summary && t.summary.caseId) || null; r.sold = (t.summary && t.summary.sold) || null; }
      } else if (!r.ninja) r.error = "poe.ninja doesn't list a price for this.";
    } catch (err) { r.error = err.message || String(err); C.log('quick price: ' + (err.stack || err)); }
    if (r.error) C.log(`quick price: "${item.name}" shown: ${r.error}`);
    r.pending = false;
    send();
  }
  ipcMain.on('quickprice:refresh', () => { if (quickLast) showQuickPrice(quickLast, true).catch((err) => C.log('quick price: ' + (err.stack || err))); });
  function registerPriceHotkey() {
    if (priceHotkey) { try { globalShortcut.unregister(priceHotkey); } catch (_) { /* ignore */ } priceHotkey = null; }
    const want = C.store.settings.priceHotkey === undefined ? DEFAULT_PRICE_HOTKEY : C.store.settings.priceHotkey;
    if (!want) return { ok: true, accelerator: null };
    if (sameKey(want, C.hotkeyStatus.accelerator || C.store.settings.hotkey || DEFAULT_HOTKEY) || sameKey(want, C.store.settings.resultsHotkey || 'Ctrl+Shift+D') || (C.store.settings.equipHotkey && sameKey(want, C.store.settings.equipHotkey))) { C.log(`price hotkey ${want}: already used by another of the app's keys`); return { ok: false, error: `${want} is already one of the app's other keys.` }; }
    let ok = false;
    try { ok = globalShortcut.register(want, () => { C.onHotkey('price').catch((e) => C.log('price hotkey error: ' + e.stack)); }); } catch (_) { ok = false; }
    if (ok) priceHotkey = want;
    C.log(`price hotkey ${want}: ${ok ? 'registered' : 'FAILED'}`);
    return ok ? { ok, accelerator: want } : { ok, error: `${want} is already used by another program. Pick a different key.` };
  }
  // "Save as equipped": hover an item you wear (your character screen, C) and press it: it's saved in
  // its slot, no popup click. Off until you pick a key (no key is free in every keybinding).
  let equipHotkey = null;
  function registerEquipHotkey() {
    if (equipHotkey) { try { globalShortcut.unregister(equipHotkey); } catch (_) { /* ignore */ } equipHotkey = null; }
    const want = C.store.settings.equipHotkey || '';
    if (!want) return { ok: true, accelerator: null };
    const others = [C.hotkeyStatus.accelerator || C.store.settings.hotkey || DEFAULT_HOTKEY, C.store.settings.resultsHotkey || 'Ctrl+Shift+D', priceHotkey];
    if (others.some((k) => k && sameKey(want, k))) { C.log(`equip hotkey ${want}: already used by another of the app's keys`); return { ok: false, error: `${want} is already one of the app's other keys.` }; }
    let ok = false;
    try { ok = globalShortcut.register(want, () => { C.onHotkey('equip').catch((e) => C.log('equip hotkey error: ' + e.stack)); }); } catch (_) { ok = false; }
    if (ok) equipHotkey = want;
    C.log(`equip hotkey ${want}: ${ok ? 'registered' : 'FAILED'}`);
    return ok ? { ok, accelerator: want } : { ok, error: `${want} is already used by another program. Pick a different key.` };
  }
  ipcMain.handle('hotkey:setEquip', (_e, accel) => {
    const prev = C.store.settings.equipHotkey || '';
    const want = typeof accel === 'string' ? accel.trim().slice(0, 40) : '';
    C.store.setSetting('equipHotkey', want);
    const st = registerEquipHotkey();
    if (!st.ok) { C.store.setSetting('equipHotkey', prev); registerEquipHotkey(); }
    return { ...st, accelerator: st.ok ? want : prev, warning: st.ok && want ? gameKeyWarning(want) : null };
  });
  ipcMain.handle('hotkey:setPrice', (_e, accel) => {
    const prev = C.store.settings.priceHotkey === undefined ? DEFAULT_PRICE_HOTKEY : C.store.settings.priceHotkey;
    const want = typeof accel === 'string' ? accel.trim().slice(0, 40) : '';
    C.store.setSetting('priceHotkey', want);
    const st = registerPriceHotkey();
    if (!st.ok) { C.store.setSetting('priceHotkey', prev); registerPriceHotkey(); }
    return { ...st, accelerator: st.ok ? want : prev };
  });

  // F2: letters are game keys (with WASD movement, Ctrl+D also walked your character right).
  const DEFAULT_HOTKEY = 'F2';
  // keys that move your character or are common skill keys in PoE2
  function gameKeyWarning(accel) {
    const parts = String(accel || '').split('+');
    const k = parts.pop();
    if (parts.some((m) => /^(ctrl|control|alt|cmdorctrl|commandorcontrol)$/i.test(m))) return null; // Ctrl/Alt + key doesn't move you

    if (/^[WASD]$/i.test(k)) return `${k.toUpperCase()} is a movement key (WASD) in Path of Exile, so the game will also act on it. An F-key (e.g. F2) works best.`;
    if (/^[QERTF]$/i.test(k)) return `${k.toUpperCase()} is often a skill key in Path of Exile, so the game may also act on it. An F-key (e.g. F2) works best.`;
    return null;
  }

  function registerHotkey(accel) {
    const want = accel || C.store.settings.hotkey || DEFAULT_HOTKEY;
    if (C.hotkeyStatus.accelerator) {
      try { globalShortcut.unregister(C.hotkeyStatus.accelerator); } catch (_) { /* ignore */ }
    }
    let ok = false; let error = null;
    try { ok = globalShortcut.register(want, () => { C.onHotkey().catch((e) => C.log('hotkey error: ' + e.stack)); }); } catch (err) { error = err.message; }
    if (!ok && !error) error = `${want} is already used by another program. Pick a different hotkey.`;
    C.hotkeyStatus = { ok, accelerator: ok ? want : null, error };
    C.log(`hotkey ${want}: ${ok ? 'registered' : 'FAILED ' + error}`);
    return C.hotkeyStatus;
  }

  const sameKey = (a, b) => String(a || '').toLowerCase().replace(/control/g, 'ctrl') === String(b || '').toLowerCase().replace(/control/g, 'ctrl');
  ipcMain.handle('hotkey:set', (_e, accel) => {
    const prev = C.store.settings.hotkey || DEFAULT_HOTKEY;
    if (sameKey(accel, C.store.settings.resultsHotkey || 'Ctrl+Shift+D')) return { ok: false, accelerator: prev, error: `${accel} already opens the results window. Pick a different key.` };
    if (priceHotkey && sameKey(accel, priceHotkey)) return { ok: false, accelerator: prev, error: `${accel} is your price-only hotkey. Pick a different key.` };
    if (equipHotkey && sameKey(accel, equipHotkey)) return { ok: false, accelerator: prev, error: `${accel} is your save-as-equipped hotkey. Pick a different key.` };
    const st = registerHotkey(accel);
    if (st.ok) C.store.setSetting('hotkey', accel);
    else registerHotkey(prev); // put the old one back
    C.buildTrayMenu();
    return { ...st, accelerator: accel, warning: gameKeyWarning(accel) };
  });

  ipcMain.on('open:log', () => { if (C.logFile) shell.openPath(C.logFile); });

  const SAMPLE_ITEM = 'Item Class: Helmets\nRarity: Rare\nTest Visage\nExpert Visored Helm\n--------\nArmour: 312\n--------\nItem Level: 79\n--------\n+89 to maximum Life\n+32% to Fire Resistance';
  ipcMain.on('popup:test', () => {
    C.log('test popup requested');
    C.showResult(C.evaluate(parseItem(SAMPLE_ITEM)));
  });

  return {
    showQuickPrice,
    registerPriceHotkey,
    registerEquipHotkey,
    DEFAULT_HOTKEY,
    registerHotkey,
    sameKey,
  };
};
