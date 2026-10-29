'use strict';

// Reading items: which game you're in, the hotkey's single Ctrl+C, the clipboard, and what F2 does
// with the item text.
const path = require('path');
const { clipboard, screen, ipcMain } = require('electron');
const gamesLib = require('../core/games');
const gearLib = require('../core/gearscore');
const { parseItem } = require('../core/parser');
const mapLib = require('../core/mapcheck');

module.exports = function (C) {
  // ---------- reading items ----------

  const TAG = '\r\n';
  let hotkeyBusy = false;
  let keys = null;
  let hotkeyStatus = { ok: false, accelerator: null, error: null };

  // Shared by the hotkey and the clipboard watcher.
  // Which game a copy came from (the game window, else the item text, else the game you played
  // last), and switch to your character for that game. Returns the game, or null if unknown.
  // When the item text can't tell (a plain ring copied with Ctrl+C), it's the game of the character
  // you have open: picking a character by hand is never undone by an ambiguous copy.
  function followGame(text, sent) {
    const game = gamesLib.detectGame({ sent, text, last: C.store.activeGame() });
    if (!game) return null;
    if (game !== C.store.data.lastGame) { C.store.data.lastGame = game; C.store.save(); C.log(`playing ${gamesLib.gameOf(game).short}`); }
    useGame(game);
    return game;
  }
  // make `game` the one you're on: its character, or (first time) your untouched one or a new one
  function useGame(game) {
    if (gamesLib.gameOf(game).supported && game !== C.store.activeGame()) {
      const id = C.store.profileForGame(game);
      const cur = C.store.data.activeProfile;
      if (id) {
        C.store.switchProfile(id);
        C.log(`switched to your ${gamesLib.gameOf(game).short} character "${C.store.data.profiles[id].name}"`);
      } else if (C.store.isUntouched(cur) && !C.pobXml()) {
        // the character you have open was never set up (a fresh install): make it this game's
        C.store.setProfileGame(cur, game);
        C.store.renameProfile(cur, `My ${gamesLib.gameOf(game).short} character`);
        C.store.setSetting('build', game === 'poe1' ? 'off' : (C.store.settings.build === 'off' ? gearLib.DEFAULT_BUILD : C.store.settings.build));
        C.log(`first ${gamesLib.gameOf(game).short} item: your empty character is now a ${gamesLib.gameOf(game).short} one`);
      } else {
        // first time in this game: a character of its own, so this game's items aren't judged
        // against the other game's gear (add its Path of Building build on My gear)
        C.store.createProfile(`My ${gamesLib.gameOf(game).short} character`, false, game);
        C.log(`first ${gamesLib.gameOf(game).short} item: made a new character for it`);
      }
      C.popupItem = null; // the item on show is the other game's: don't re-judge it with this one
      gameChanged();
    }
  }
  // the first-run guide: you pick the game (later, copying an item from the other game switches by itself)
  ipcMain.handle('game:choose', (_e, game) => {
    if (!['poe1', 'poe2'].includes(game)) return { ok: false };
    C.store.data.lastGame = game; C.store.save();
    useGame(game);
    return { ok: true, game: C.store.activeGame() };
  });

  // Everything that has to follow when the game you're on changes (a copy from the other game,
  // picking or importing a character of the other game): one place, so nothing is left behind.
  let shownGame = null;
  function gameChanged() {
    const game = C.tg();
    // the League start tab and overlay: the character's build (its PoE1 quest gems), its linked name
    try { if (C.routePush) setTimeout(() => C.routePush(), 0); } catch (_) { /* not started yet */ }
    C.watchBuildFile();
    if (game === shownGame) { C.pobSync(); C.refreshAll(); C.buildTrayMenu(); return; }
    const from = shownGame; shownGame = game;
    C.store.data.lastGame = game;
    C.stopOtherEngines(game);
    C.pobSync();
    // results from the other game stay as they were (frozen) and get out of the way
    if (C.resultsState && C.resultsState.r.game && C.resultsState.r.game !== game && C.resultsWin && !C.resultsWin.isDestroyed()) C.resultsWin.hide();
    C.notifySettings('game:changed', { game, from });
    C.refreshAll(); C.buildTrayMenu();
    // this game's divine rate, so prices are right on the first search
    if (C.store.settings.autoRate !== false) C.refreshDivineRate(false).catch(() => {});
    C.log(`now on ${C.G(game).short}${from ? ` (was ${C.G(from).short})` : ''}`);
  }

  // The clipboard is asynchronous from Electron 44 on (readText/writeText return Promises); these also
  // work with the older, synchronous one. Never throw: a busy clipboard reads as empty.
  async function clipRead() { try { return String((await clipboard.readText()) || ''); } catch (_) { return ''; } }
  let clipWrites = 0; // writes still landing: the poller mustn't mistake the old text for a new copy
  async function clipWrite(text) { clipWrites++; try { await clipboard.writeText(String(text)); return true; } catch (_) { return false; } finally { clipWrites--; } }

  function handleItemText(text, source, sent, mode) {
    const item = parseItem(text);
    if (!item) {
      C.log(`${source}: clipboard is not item text (${String(text).length} characters)`); // never log what you copied: it may be private
      return false;
    }
    const game = followGame(text, sent);
    if (game && !gamesLib.gameOf(game).supported) {
      // a PoE1 item: say so instead of judging it against your PoE2 gear
      C.lastClip = text;
      C.log(`${source}: ${gamesLib.gameOf(game).short} item "${item.name}" (${item.itemClass}) – not supported yet`);
      if (source === 'clipboard' && !item.slot) return true;
      C.showResult({ ok: false, reason: `That's a ${gamesLib.gameOf(game).name} item. Support for ${gamesLib.gameOf(game).short} is being built: for now the app only judges Path of Exile 2 items. Your PoE2 characters and gear are kept separate.` });
      return true;
    }
    C.usage.used(game || C.store.activeGame());
    // PoE1 flasks and tinctures are judged by Path of Building in your flask slots
    if ((game || C.store.activeGame()) === 'poe1' && C.isFlaskClass(item)) item.slot = 'Flask';
    // Tag the clipboard so copying the same item again still counts as a change.
    // (Just a trailing line break; pasting into the trade site / PoB is unaffected.)
    { const tagged = text.endsWith(TAG) ? text : text + TAG; C.lastClip = tagged; clipWrite(tagged).then((ok) => { if (!ok && C.lastClip === tagged) C.lastClip = text; }); }
    if (!item.slot && source === 'clipboard') {
      // you copied currency, a gem, a map... with plain Ctrl+C: no popup
      C.log(`clipboard: ${item.itemClass} "${item.name}" – not gear, no popup`);
      return true; // (lastClip already holds the tagged text: the next poll mustn't see it as a new copy)
    }
    C.remember(item);
    C.store.noteStats(item);
    C.log(`${source}: ${item.itemClass} "${item.name}" (${item.rarity}) -> slot ${item.slot}, ${Object.keys(item.stats).length} stats`);
    C.notifySettings('item:copied', { id: item.id, name: item.name });
    if (mode === 'price') { C.showQuickPrice(item).catch((err) => C.log('quick price: ' + (err.stack || err))); return true; }
    // a map or waystone: what its mods mean for your build
    if (mapLib.isMap(item)) { try { C.showMapCard(item); } catch (err) { C.log('popup failed: ' + err.stack); } return true; }
    // not gear (currency, a gem, a divination card...): its price
    if (!item.slot) { try { C.showPriceCard(item); } catch (err) { C.log('popup failed: ' + err.stack); } return true; }
    try { C.showResult(C.evaluate(item)); } catch (err) { C.log('popup failed: ' + err.stack); }
    return true;
  }

  // Passive mode: notice when you press Ctrl+C in game yourself.
  let polling = false; let clipReady = false;
  async function pollClipboard() {
    if (!C.store || !clipReady || polling || clipWrites || hotkeyBusy || C.store.settings.paused || C.store.settings.watchClipboard === false) return;
    polling = true;
    let text;
    try { text = await clipRead(); } finally { polling = false; }
    if (hotkeyBusy || clipWrites || !text || text === C.lastClip) return; // the hotkey started while we were reading: it handles it
    C.lastClip = text;
    if (/^Item Class:/i.test(text.trim())) handleItemText(text, 'clipboard');
  }

  // Why a hotkey press found no item, in words you can act on. sent: the key sender's answer
  // ("fg=<process that got the keystroke>;over=<process under the mouse>[;refocused|;refocus-failed]")
  function noItemReason(sent, text) {
    if (!sent) return (keys && keys.unavailable) || 'Couldn\'t send Ctrl+C to the game (the key sender didn\'t start). Press Ctrl+C on the item yourself, or see Tray → Open log.';
    const s = String(sent);
    const fg = (s.match(/fg=([^;]*)/) || [])[1] || ''; const over = (s.match(/over=([^;]*)/) || [])[1] || '';
    const isGame = (n) => /^PathOfExile/i.test(n);
    const me = path.basename(process.execPath, '.exe').toLowerCase();
    const isMe = (n) => n && (n === 'self' || n.toLowerCase() === me || /^electron$/i.test(n));
    const hk = C.store.settings.hotkey || C.DEFAULT_HOTKEY;
    if (/game-admin/.test(s)) return `${C.G(C.store.data.lastGame || C.tg()).name} is running as administrator, so Windows blocks the Ctrl+C this app sends it. Start the game normally (not "Run as administrator"), or start this app as administrator too.`;
    if (/hotkey-held/.test(s) && !text) return `${hk} was still held down when the copy was sent, so the game didn't see it. Tap ${hk} (press and let go quickly) while hovering the item.`;
    if (isMe(over)) return `Your mouse was over this app's window, not the game. Hover the item in game, then press ${hk}.`;
    if (/refocus-failed/.test(s) || (fg && !isGame(fg) && fg !== '?')) {
      return `${C.G(C.store.data.lastGame || C.tg()).name} wasn't the active window${fg && fg !== '?' ? ` (${isMe(fg) ? 'this app' : fg} was)` : ''}, so nothing was copied (the app only presses Ctrl+C in the game). Click once in the game, then press ${hk} again.`;
    }
    if (over && !isGame(over) && over !== '?') return `Your mouse wasn't over the game (it was over ${over}). Hover the item in game, then press ${hk}.`;
    if (text) return 'That wasn\'t an item (the game copied something else). Hover an item so its tooltip shows, then press the hotkey.';
    return `No item under the mouse. Hover an item until its tooltip shows, then press ${hk}.`;
  }

  // Hotkey mode: press the hotkey over an item; we send Ctrl+C to the game for
  // you (one keystroke per press) and always show the popup, even for the same item.
  // mode 'price': the price hotkey (F3), a popup with just the price
  async function onHotkey(mode) {
    if (hotkeyBusy || C.store.settings.paused) return;
    hotkeyBusy = true;
    const pressedAt = Date.now(); // for the F2 timing line in the log (popup.js)
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let before = '';
    before = await clipRead();
    try {
      await clipWrite('');
      const waitForText = async (ms) => {
        for (let t = 0; t < ms; t += 25) {
          await sleep(25);
          const v = await clipRead();
          if (v) return v;
        }
        return '';
      };
      // The last popup is often still up, right where you moved the mouse for the next item: the game
      // then sees the popup, not the item, and copies nothing. Hide it first (the key sender then
      // nudges the mouse so the game hovers the item again).
      let nudge = false;
      if (C.popup && !C.popup.isDestroyed() && C.popup.isVisible()) {
        const c = screen.getCursorScreenPoint(); const b = C.popup.getBounds();
        if (c.x >= b.x - 4 && c.x <= b.x + b.width + 4 && c.y >= b.y - 4 && c.y <= b.y + b.height + 4) { C.popup.hide(); C.popupHovered = false; nudge = true; } // hidden from under the mouse: no mouse-leave comes
      }
      // send the copy before anything appears on screen: a window popping up first can make
      // the game drop its tooltip (then nothing gets copied). One Ctrl+C per press, never more.
      const sent = await keys.copy(!!C.store.settings.advancedCopy, { nudge });
      const sentAt = Date.now();
      if (!sent) C.log('hotkey: could not send Ctrl+C to the game');
      else if (sent !== true && !/^fg=PathOfExile[^;]*;over=PathOfExile/i.test(sent)) C.log('hotkey: sent to ' + sent);
      let text = await waitForText(250);
      if (!text && sent) {
        C.showResult({ ok: false, loading: true, reason: 'Reading item…' });
        text = await waitForText(1250); // the game can be slow to fill the clipboard when it's busy
      }
      if (text && mode !== 'price') C.hotkeyTiming = { pressed: pressedAt, sent: sentAt, text: Date.now() };
      if (text && handleItemText(text, 'hotkey', sent, mode)) return;
      C.hotkeyTiming = null;
      // Nothing copied: put the old clipboard back and say why.
      await clipWrite(before || '');
      C.lastClip = before || '';
      C.log(`hotkey: no item text (${sent ? `sent: ${sent}` : 'not sent'}, got ${text ? 'non-item text' : 'nothing'})`);
      C.showResult({ ok: false, reason: noItemReason(sent, text) });
    } finally {
      hotkeyBusy = false;
    }
  }

  return {
    get hotkeyBusy() { return hotkeyBusy; },
    get keys() { return keys; }, set keys(v) { keys = v; },
    get hotkeyStatus() { return hotkeyStatus; }, set hotkeyStatus(v) { hotkeyStatus = v; },
    get shownGame() { return shownGame; }, set shownGame(v) { shownGame = v; },
    gameChanged,
    clipRead,
    clipWrite,
    get clipReady() { return clipReady; }, set clipReady(v) { clipReady = v; },
    pollClipboard,
    onHotkey,
  };
};
