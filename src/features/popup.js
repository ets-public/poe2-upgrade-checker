'use strict';

// The in-game popup: where it goes, when it hides, and what it shows.
const path = require('path');
const { BrowserWindow, screen, ipcMain } = require('electron');
const trade = require('../core/trade');
const { SLOTS, SLOT_GROUPS, visibleJewels } = require('../core/slots');
const ninjaLib = require('../core/ninja');
const ROOT = path.join(__dirname, '..'); // src

module.exports = function (C) {
  // ---------- popup ----------
  //
  // Bugs fixed here (popup only appeared once):
  // 1. After popup.hide() Chromium throttles the hidden page, so the renderer's
  //    requestAnimationFrame never fired and it never told us its height -> we
  //    never showed it again. Now: backgroundThrottling off, the renderer
  //    measures synchronously, and we show anyway after a short fallback delay.
  // 2. Copying the SAME item twice gives identical clipboard text, which looked
  //    like "no change". We now tag the clipboard after reading (adds a trailing
  //    newline) so the game's next Ctrl+C is always seen as new.
  // 3. The hover flag could stay stuck "on" after Esc, which disabled auto-hide.

  let pendingShow = false;
  let showFallback = null;

  function createPopup() {
    C.popup = new BrowserWindow({
      width: 400, height: 300, show: false, frame: false, resizable: false,
      transparent: true, backgroundColor: '#00000000',
      alwaysOnTop: true, skipTaskbar: true, focusable: false, hasShadow: false, roundedCorners: false,
      webPreferences: {
        preload: C.preload, contextIsolation: true, nodeIntegration: false, sandbox: true,
        backgroundThrottling: false,
      },
    });
    C.popup.setAlwaysOnTop(true, 'screen-saver');
    C.popup.loadFile(path.join(ROOT, 'ui', 'popup.html'));
    C.popup.on('blur', () => { if (!C.popupHovered) scheduleHide(1500); });
    // you dragged it (by its name): it stays there from now on (Settings → Popup → Position: where I dragged it)
    let moveTimer = null;
    C.popup.on('move', () => {
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => {
        if (!C.popup || !C.popup.isVisible() || !placedAt) return;
        const b = C.popup.getBounds();
        if (Math.abs(b.x - placedAt.x) <= 2 && Math.abs(b.y - placedAt.y) <= 2) return; // our own placing
        placedAt = { x: b.x, y: b.y };
        C.store.setSetting('popupDragged', { x: b.x, y: b.y });
        if (C.store.settings.popupPosition !== 'dragged') { C.store.setSetting('popupPosition', 'dragged'); C.notifySettings('settings:changed'); }
        C.log(`popup dragged to ${b.x},${b.y}`);
      }, 250);
    });
    C.popup.on('closed', () => { C.popup = null; });
    C.popup.webContents.on('render-process-gone', () => { try { C.popup.destroy(); } catch (_) {} C.popup = null; C.popupHovered = false; });
  }

  function uiScale() { const v = Number(C.store && C.store.settings.uiScale); return v >= 0.8 && v <= 1.6 ? v : 1; }
  function popupWidth() { return Math.round(400 * uiScale()); }

  // Where the popup goes (Options → Popup position): next to the mouse, or
  // pinned to a side / the top of the screen so it never covers the game's tooltip.
  let placedAt = null; // where the app last put the popup: a different place means you dragged it
  function placePopupNearCursor(height) {
    const cursor = screen.getCursorScreenPoint();
    const area = screen.getDisplayNearestPoint(cursor).workArea;
    const w = popupWidth();
    const h = Math.max(120, Math.min((height || 300) * uiScale(), area.height - 20));
    let pos = C.store.settings.popupPosition || 'cursor';
    const dragged = C.store.settings.popupDragged;
    if (pos === 'dragged' && !(dragged && Number.isFinite(dragged.x) && Number.isFinite(dragged.y))) pos = 'cursor';
    let x; let y;
    let area2 = area;
    if (pos === 'dragged') { area2 = screen.getDisplayNearestPoint({ x: dragged.x, y: dragged.y }).workArea; x = dragged.x; y = dragged.y; }
    else if (pos === 'left') { x = area.x + 16; y = area.y + Math.round(area.height * 0.12); }
    else if (pos === 'right') { x = area.x + area.width - w - 16; y = area.y + Math.round(area.height * 0.12); }
    else if (pos === 'top') { x = area.x + Math.round((area.width - w) / 2); y = area.y + 16; }
    else {
      // Prefer the right of the cursor; flip left if it would go off screen.
      x = cursor.x + 24;
      if (x + w > area.x + area.width) x = cursor.x - w - 24;
      y = cursor.y - Math.round(h / 3);
    }
    x = Math.max(area2.x + 4, Math.min(x, area2.x + area2.width - w - 4));
    y = Math.max(area2.y + 4, Math.min(y, area2.y + area2.height - h - 4));
    placedAt = { x: Math.round(x), y: Math.round(y) };
    C.popup.setBounds({ x: Math.round(x), y: Math.round(y), width: w, height: Math.round(h) });
    try { C.popup.webContents.setZoomFactor(uiScale()); } catch (_) { /* ignore */ }
  }

  function scheduleHide(ms) {
    clearTimeout(C.hideTimer);
    // the name line is a drag area, and Windows reports the mouse there as outside the page
    C.hideTimer = setTimeout(() => {
      const c = screen.getCursorScreenPoint(); const b = C.popup ? C.popup.getBounds() : null;
      if (b && C.popup.isVisible() && c.x >= b.x && c.x < b.x + b.width && c.y >= b.y && c.y < b.y + b.height) return scheduleHide(1000);
      hidePopup();
    }, ms);
  }

  function hidePopup() {
    clearTimeout(C.hideTimer);
    clearTimeout(showFallback);
    pendingShow = false;
    C.popupHovered = false;
    awaySince = 0;
    if (C.popup && C.popup.isVisible()) C.popup.hide();
  }

  // Close the popup once the mouse has moved well away from it for a moment
  // (like other overlays do). No global Esc key: that stopped Esc working in game.
  let awaySince = 0;
  function watchCursor() {
    if (!C.popup || !C.popup.isVisible() || C.popupHovered || C.hotkeyBusy) { awaySince = 0; return; }
    // a pinned popup (left/right/top) isn't near the mouse by design: closes on timer, ×, or next item
    if ((C.store.settings.popupPosition || 'cursor') !== 'cursor') { awaySince = 0; return; }
    const c = screen.getCursorScreenPoint();
    const b = C.popup.getBounds();
    const pad = 260;
    const far = c.x < b.x - pad || c.x > b.x + b.width + pad || c.y < b.y - pad || c.y > b.y + b.height + pad;
    if (!far) { awaySince = 0; return; }
    if (!awaySince) awaySince = Date.now();
    if (Date.now() - awaySince > 1200) hidePopup();
  }

  // How long F2 took, in the log: from the key press to Ctrl+C sent, the item text read, the popup
  // shown and (when Path of Building judges it) its verdict. One line per F2, written once all are in.
  let timing = null; // { pressed, sent, text, seq, slot, pob, shown, verdict }
  function logTiming() {
    const t = timing;
    if (!t || !t.shown || (t.pob && !t.verdict)) return;
    timing = null;
    const ms = (x) => `${Math.max(0, x - t.pressed)} ms`;
    C.log(`F2 timing: Ctrl+C sent ${ms(t.sent)}, item text ${ms(t.text)}, popup shown ${ms(t.shown)}${t.pob ? `, PoB verdict ${ms(t.verdict)}` : ''}${t.slot ? ` (${t.slot})` : ''}`);
  }

  function revealPopup(height) {
    clearTimeout(showFallback);
    if (!C.popup) return;
    if (pendingShow || !C.popup.isVisible()) {
      pendingShow = false;
      if (timing && !timing.shown) { timing.shown = Date.now(); logTiming(); }
      placePopupNearCursor(height);
      C.popup.showInactive(); // don't steal focus from the game
      C.popup.setAlwaysOnTop(true, 'screen-saver');
      awaySince = 0;
    } else if (height) {
      // the renderer reports CSS pixels; the window is zoomed by uiScale. Keep it on screen.
      const b = C.popup.getBounds();
      const area = screen.getDisplayMatching(b).workArea;
      const h = Math.round(Math.min(Math.max(height * uiScale(), 120), area.height - 8));
      const y = Math.max(area.y + 4, Math.min(b.y, area.y + area.height - h - 4));
      placedAt = { x: b.x, y };
      C.popup.setBounds({ ...b, y, height: h });
    }
    if (!C.popupHovered) scheduleHide((C.store.settings.autoHideSeconds || 12) * 1000);
  }

  let popupItem = null;
  let popupSeq = 0; // bumped by every new render; a late PoB answer for an older one is dropped
  let popupResult = null; // the comparison on show (a refresh replaces it; its price carries over)
  function showResult(result) {
    const seq = ++popupSeq;
    popupItem = result && result.item ? C.recentItems.get(result.item.id) || result.item : null;
    popupResult = result;
    if (!C.popup) createPopup();
    pendingShow = true; // every new copy re-positions the popup at the cursor
    const withPob = result && result.ok && result.kind !== 'price' && result.kind !== 'map' && result.kind !== 'quickprice' && !result.isEquipped && result.item && C.pobOn() && C.pobCanJudge(result.item, result.targetSlot);
    if (withPob) result.pobPending = true;
    // an F2 press that led here (not a refresh of the popup): time it
    const t = C.hotkeyTiming; C.hotkeyTiming = null;
    timing = t && Date.now() - t.pressed < 10000 ? { ...t, seq, slot: result && (result.targetSlot || (result.item && result.item.slot)), pob: !!withPob } : null;
    const send = () => C.popup && C.popup.webContents.send('popup:result', serialise(result));
    if (C.popup.webContents.isLoading()) C.popup.webContents.once('did-finish-load', send);
    else send();
    let judged = Promise.resolve();
    if (withPob) {
      const item = popupItem;
      judged = C.pobJudge([{ item: result.item.raw ? result.item : (item || result.item), slot: result.targetSlot }]).then((res) => {
        const j = res[0];
        result.pobPending = false;
        if (!j) result.pobError = C.pobErrorOf(res, 0);
        else C.applyPob(result, j);
      }).catch((err) => { result.pobPending = false; result.pobError = err.message; C.log('pob: ' + err.message); })
        .then(() => {
          if (timing && timing.seq === seq) { timing.verdict = Date.now(); logTiming(); }
          if (seq === popupSeq && popupItem === item && C.popup && !C.popup.isDestroyed() && C.popup.isVisible()) C.popup.webContents.send('popup:result', serialise(result));
        });
    }
    // uniques: poe.ninja's price next to the verdict
    if (result && result.ok && result.kind !== 'price' && result.kind !== 'quickprice' && result.item && /unique/i.test(result.item.rarity || '')) {
      const item = popupItem;
      C.ninjaPrice(result.item).then((p) => {
        if (!p) return;
        result.ninja = p; result.sellNote = ninjaLib.sellNote(p);
        // a refresh (setting changed, gear set...) may have replaced the comparison meanwhile: price that one
        const shown = popupItem === item ? popupResult : null;
        if (shown && shown !== result) { shown.ninja = p; shown.sellNote = result.sellNote; }
        if (shown && C.popup && !C.popup.isDestroyed() && C.popup.isVisible()) C.popup.webContents.send('popup:result', serialise(shown === result ? result : { ...shown, keepState: true }));
      }).catch((err) => C.log('poe.ninja: ' + err.message));
    }
    // Renderer replies with its height via popup:resize; show anyway if it doesn't.
    clearTimeout(showFallback);
    showFallback = setTimeout(() => { if (pendingShow) revealPopup(null); }, 400);
    return judged; // settles once Path of Building's verdict is in (or straight away without one)
  }

  // the league searches and prices are for, as far as the app knows without waiting: the one you
  // picked for this game, else the one the trade site lists first (shown in the popup, so a Standard
  // player sees at once that it's set)
  function shownLeague() {
    try { const d = C.tradeDataBy[C.tg()]; return d ? C.pickLeague(d) : (C.store.settings.league || null); } catch (_) { return C.store.settings.league || null; }
  }
  function serialise(result) {
    return JSON.parse(JSON.stringify({
      ...result, links: (result && result.links) || (result && result.item ? ninjaLib.infoLinks(result.item, C.tg()) : []), pobNudge: !!(result && result.ok && !result.pob && !result.pobPending && !result.pobError && C.pobEngine().available() && !C.pobXml()), slots: SLOTS, slotGroups: { ...SLOT_GROUPS, Jewel: visibleJewels(C.store.equipped) }, budgetLabel: trade.budgetLabel(C.budgetNow(), C.tg()),
      ui: { detail: C.store.settings.popupDetail || 'compact', colorblind: !!C.store.settings.colorblind, divineRate: C.store.settings.divineRate || null },
      worthEx: result && result.item && result.item.id && C.lastWorth.has(result.item.id) ? C.lastWorth.get(result.item.id) : null,
      game: C.tg(), league: shownLeague(), unit: C.G().baseShort, gameBeta: !!C.G().beta, gameShort: C.G().short,
    }));
  }

  ipcMain.on('popup:resize', (_e, height) => revealPopup(Number(height) || null));

  ipcMain.on('popup:hover', (_e, hovered) => {
    C.popupHovered = !!hovered;
    // the popup only becomes focusable while the mouse is on it (so its inputs work),
    // otherwise the game keeps the keyboard: no more clicking the game after every copy
    try {
      if (C.popup && !C.popup.isDestroyed()) {
        C.popup.setFocusable(C.popupHovered);
        if (!C.popupHovered && C.popup.isFocused()) C.popup.blur();
      }
    } catch (_) { /* ignore */ }
    if (C.popupHovered) clearTimeout(C.hideTimer);
    else if (C.popup && C.popup.isVisible()) scheduleHide(2500);
  });

  ipcMain.on('popup:close', hidePopup);

  return {
    createPopup,
    uiScale,
    watchCursor,
    get popupItem() { return popupItem; }, set popupItem(v) { popupItem = v; },
    get popupSeq() { return popupSeq; }, set popupSeq(v) { popupSeq = v; },
    get popupResult() { return popupResult; }, set popupResult(v) { popupResult = v; },
    showResult,
    shownLeague,
    serialise,
  };
};
