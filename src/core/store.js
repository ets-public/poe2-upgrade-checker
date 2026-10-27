'use strict';

const DEFAULT_BUILD = 'life-res'; // same as gearscore.DEFAULT_BUILD

// Tiny JSON-file store for equipped gear, stat weights and seen stats.

const fs = require('fs');
const path = require('path');
const games = require('./games');

const DEFAULT_WEIGHTS = {
  '# to maximum Life': 1,
  '# to maximum Mana': 0.3,
  '#% to Fire Resistance': 1.5,
  '#% to Cold Resistance': 1.5,
  '#% to Lightning Resistance': 1.5,
  '#% to Chaos Resistance': 1,
  '# to Strength': 0.4,
  '# to Dexterity': 0.4,
  '# to Intelligence': 0.4,
  '#% increased Movement Speed': 3,
  '[Base] Armour': 0.05,
  '[Base] Evasion Rating': 0.05,
  '[Base] Energy Shield': 0.5,
  '[Base] Spirit': 1,
  '[Weapon] Total DPS': 1,
};

// Settings that mean something different in each game (league names, prices in chaos vs exalts,
// each trade site's data). The active game's values live in settings as usual; the other game's
// are kept in data.gameSettings and swapped in when you change game.
// priorities too: chaos resistance matters in PoE1 by default, not in PoE2
const GAME_KEYS = ['league', 'budget', 'leveling', 'noCorrupted', 'usePob', 'divineRate', 'divineRateAt', 'divineRateLeague', 'currencyRates', 'autoRate', 'priorities', 'pobSearchSize', 'gearSearchSize'];
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'poe2-upgrade-checker.json');
    this.data = { weights: { ...DEFAULT_WEIGHTS }, equipped: {}, seenStats: {}, settings: { autoHideSeconds: 12, paused: false, hotkey: 'F2', watchClipboard: true, advancedCopy: true, autoRate: true, status: 'available' } };
    // never start from defaults over a file that's only temporarily unreadable (antivirus at login):
    // retry, then keep the broken file aside instead of overwriting everyone's gear and settings
    if (fs.existsSync(this.file)) {
      let loaded = null; let lastErr = null;
      for (let i = 0; i < 5 && !loaded; i++) {
        try { loaded = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (err) {
          lastErr = err;
          const until = Date.now() + 200; while (Date.now() < until) { /* short wait before retrying */ }
        }
      }
      if (!loaded && fs.existsSync(this.file + '.tmp')) { try { loaded = JSON.parse(fs.readFileSync(this.file + '.tmp', 'utf8')); } catch (_) { /* no */ } }
      if (loaded) {
        if (!isObj(loaded)) loaded = {};
        this.data = { ...this.data, ...loaded, settings: { ...this.data.settings, ...(isObj(loaded.settings) ? loaded.settings : {}) } };
        // a damaged or hand-edited file must never stop the app from starting
        for (const k of ['weights', 'equipped', 'seenStats', 'profiles', 'activeByGame', 'gameSettings']) if (k in this.data && !isObj(this.data[k])) delete this.data[k];
        if (!isObj(this.data.weights)) this.data.weights = { ...DEFAULT_WEIGHTS };
        if (!isObj(this.data.equipped)) this.data.equipped = {};
        if (!isObj(this.data.seenStats)) this.data.seenStats = {};
        if (isObj(this.data.gameSettings)) for (const g of Object.keys(this.data.gameSettings)) if (!isObj(this.data.gameSettings[g])) delete this.data.gameSettings[g];
        if (isObj(this.data.profiles)) for (const id of Object.keys(this.data.profiles)) if (!isObj(this.profileOf(id))) delete this.data.profiles[id];
      } else {
        try { fs.copyFileSync(this.file, `${this.file}.unreadable-${Date.now()}`); } catch (_) { /* ignore */ }
        this.loadError = lastErr ? lastErr.message : 'unreadable';
      }
    }
    // Older versions kept advanced-copy notes in stat names; tidy saved items.
    const fixKey = (k) => (typeof k === 'string' ? k.replace(/\s+[—–-]+\s*Unscalable Value\s*$/i, '') : k);
    for (const it of Object.values(this.data.equipped || {})) {
      if (!it) continue;
      if (it.stats) it.stats = Object.fromEntries(Object.entries(it.stats).map(([k, v]) => [fixKey(k), v]));
      (it.lines || []).forEach((l) => { l.key = fixKey(l.key); });
    }
    this.initProfiles();
    if (!this.data.seenByClass) {
      this.data.seenByClass = {};
      for (const it of Object.values(this.data.equipped || {})) { try { this.noteStats(it); } catch (_) { /* ignore */ } }
    }
  }

  // ---------- characters (profiles) ----------
  // Each character has its own gear, weights, build, build tweaks, ignored
  // stats and resistances. The active one lives in the usual places; the
  // others are kept in data.profiles.
  initProfiles() {
    if (!this.data.profiles || !Object.keys(this.data.profiles).length) {
      this.data.profiles = { main: { name: 'My character' } };
      this.data.activeProfile = 'main';
    }
    if (!this.data.profiles[this.data.activeProfile]) this.data.activeProfile = Object.keys(this.data.profiles)[0];
    // every character belongs to one game; characters from before PoE1 support are PoE2 ones
    for (const p of Object.values(this.data.profiles)) {
      if (!games.isGame(p.game)) p.game = games.DEFAULT_GAME;
      if (typeof p.name !== 'string' || !p.name.trim()) p.name = p.game === 'poe1' ? 'My PoE1 character' : 'My character';
    }
    // the character you last used in each game, so the app can switch when you change game
    const by = this.data.activeByGame = this.data.activeByGame || {};
    for (const g of Object.keys(by)) if (!this.data.profiles[by[g]] || this.data.profiles[by[g]].game !== g) delete by[g];
    by[this.activeGame()] = this.data.activeProfile;
    // the settings in use are for the game they were saved with (before: always PoE2)
    const sg = games.isGame(this.data.settingsGame) ? this.data.settingsGame : games.DEFAULT_GAME;
    // priorities and auto-rate used to be shared by both games: the game put aside keeps a copy
    // of them, so neither loses what you set
    if ((this.data.gameKeysVersion || 1) < 2) {
      const gs = this.data.gameSettings;
      if (isObj(gs)) for (const g of Object.keys(gs)) {
        if (g === sg) continue;
        for (const k of ['priorities', 'autoRate']) if (gs[g][k] === undefined && this.data.settings[k] !== undefined) gs[g][k] = JSON.parse(JSON.stringify(this.data.settings[k]));
      }
      this.data.gameKeysVersion = 2;
    }
    if (sg !== this.activeGame()) this.swapGameSettings(sg, this.activeGame());
    this.data.settingsGame = this.activeGame();
  }

  activeGame() {
    const p = this.data.profiles && this.data.profiles[this.data.activeProfile];
    return (p && games.isGame(p.game)) ? p.game : games.DEFAULT_GAME;
  }

  // The character to use for a game: the one you last used there, or the first one for it.
  profileForGame(game) {
    const by = this.data.activeByGame || {};
    if (by[game] && this.data.profiles[by[game]] && this.data.profiles[by[game]].game === game) return by[game];
    return Object.keys(this.data.profiles).find((id) => this.profileOf(id).game === game) || null;
  }

  // keep this game's settings aside and bring in the other game's
  swapGameSettings(from, to) {
    if (from === to) return;
    const gs = this.data.gameSettings = this.data.gameSettings || {};
    const s = this.data.settings;
    gs[from] = {};
    for (const k of GAME_KEYS) if (s[k] !== undefined) gs[from][k] = s[k];
    for (const k of GAME_KEYS) delete s[k];
    Object.assign(s, gs[to] || {});
    if (s.autoRate === undefined) s.autoRate = true;
    this.data.settingsGame = to;
  }

  setProfileGame(id, game) {
    const p = this.profileOf(id);
    if (!p || !games.isGame(game) || p.game === game) return false;
    if (id === this.data.activeProfile) this.swapGameSettings(p.game || games.DEFAULT_GAME, game);
    p.game = game;
    const by = this.data.activeByGame = this.data.activeByGame || {};
    for (const g of Object.keys(by)) if (by[g] === id) delete by[g];
    if (id === this.data.activeProfile) by[game] = id;
    this.save();
    return true;
  }

  snapshot() {
    const s = this.data.settings;
    return {
      equipped: this.data.equipped, weights: this.data.weights,
      ignoreStats: s.ignoreStats || [], build: s.build || DEFAULT_BUILD, buildTweaks: s.buildTweaks || {}, resists: s.resists || null,
    };
  }

  listProfiles() {
    return Object.entries(this.data.profiles).map(([id, p]) => ({ id, name: p.name, game: p.game || games.DEFAULT_GAME, active: id === this.data.activeProfile }));
  }

  // a character by id: only the store's own entries (never e.g. "__proto__")
  profileOf(id) { return typeof id === 'string' && Object.prototype.hasOwnProperty.call(this.data.profiles || {}, id) ? this.data.profiles[id] : undefined; }

  // where this character's build was imported from (a pobb.in link or a build file), so it can be read again
  buildSource() { const p = this.profileOf(this.data.activeProfile); return (p && p.buildSource) || null; }
  setBuildSource(src) {
    const p = this.profileOf(this.data.activeProfile);
    if (!p) return;
    if (src) p.buildSource = src; else delete p.buildSource;
    this.save();
  }

  // the loot filter the app last wrote for this character: { file, source, at, sig } (to say when it's out of date)
  lootFilter() { const p = this.profileOf(this.data.activeProfile); return (p && p.lootFilter) || null; }
  setLootFilter(v) {
    const p = this.profileOf(this.data.activeProfile);
    if (!p) return;
    if (v) p.lootFilter = v; else delete p.lootFilter;
    this.save();
  }

  switchProfile(id) {
    if (!this.profileOf(id) || id === this.data.activeProfile) return false;
    const cur = this.data.profiles[this.data.activeProfile];
    Object.assign(cur, this.snapshot());
    const next = this.profileOf(id);
    this.swapGameSettings(cur.game || games.DEFAULT_GAME, next.game || games.DEFAULT_GAME);
    this.data.activeProfile = id;
    (this.data.activeByGame = this.data.activeByGame || {})[next.game || games.DEFAULT_GAME] = id;
    this.data.equipped = next.equipped || {};
    this.data.weights = next.weights || { ...DEFAULT_WEIGHTS };
    Object.assign(this.data.settings, {
      ignoreStats: next.ignoreStats || [], build: next.build || DEFAULT_BUILD, buildTweaks: next.buildTweaks || {}, resists: next.resists || null,
    });
    this.save();
    return true;
  }

  // A new character. Empty (the default): nothing of the one you're on: no gear, no build, the
  // default gear score profile and weights, no build tweaks, ignored stats or resistances, no linked
  // build. Copy: all of those (the caller copies its Path of Building files).
  createProfile(name, copyCurrent, game) {
    // unique even when two are made in the same millisecond (a new game's character, then another)
    let id = 'p' + Date.now().toString(36);
    for (let k = 1; this.profileOf(id); k++) id = 'p' + Date.now().toString(36) + k;
    const g = games.isGame(game) ? game : this.activeGame();
    // the gear score is for PoE2 builds; a new PoE2 character never inherits a PoE1 character's 'off'
    const build = g === 'poe1' ? 'off' : DEFAULT_BUILD;
    const base = copyCurrent ? JSON.parse(JSON.stringify(this.snapshot())) : { equipped: {}, weights: { ...DEFAULT_WEIGHTS }, ignoreStats: [], build, buildTweaks: {}, resists: null };
    if (copyCurrent && g !== this.activeGame()) base.build = build;
    const from = this.profileOf(this.data.activeProfile);
    if (copyCurrent && from && from.buildSource) base.buildSource = JSON.parse(JSON.stringify(from.buildSource));
    this.data.profiles[id] = { name: name || 'New character', game: g, ...base };
    if (copyCurrent) {
      const ci = this.data.settings.pobCI;
      if (isObj(ci) && this.data.activeProfile in ci) this.data.settings.pobCI = { ...ci, [id]: ci[this.data.activeProfile] };
    }
    this.switchProfile(id);
    return id;
  }

  // Start a character again from nothing, keeping its name, game and place in the list. It gets a new
  // id, so nothing kept for the old one (its Path of Building build, results, caches) carries over.
  // Returns { id, old } (the caller removes the old id's build files), or null.
  resetProfile(id) {
    const p = this.profileOf(id);
    if (!p) return null;
    const before = this.data.activeProfile;
    const fresh = this.createProfile(p.name, false, p.game);
    // the new one where the old one was in the list
    const order = {};
    for (const [k, v] of Object.entries(this.data.profiles)) {
      if (k === fresh) continue;
      order[k === id ? fresh : k] = k === id ? this.data.profiles[fresh] : v;
    }
    this.data.profiles = order;
    for (const g of Object.keys(this.data.activeByGame || {})) if (this.data.activeByGame[g] === id) this.data.activeByGame[g] = fresh;
    this.forgetProfileKeys(id);
    if (before !== id) this.switchProfile(before); // you stay on the character you were on
    this.save();
    return { id: fresh, old: id };
  }

  // settings kept per character id
  forgetProfileKeys(id) {
    const ci = this.data.settings.pobCI;
    if (isObj(ci) && id in ci) { const c = { ...ci }; delete c[id]; this.data.settings.pobCI = c; }
  }

  // a character nobody has set up yet: no gear, default name (the PoB file is checked by the caller)
  isUntouched(id) {
    const p = this.profileOf(id);
    if (!p) return false;
    const eq = id === this.data.activeProfile ? this.data.equipped : p.equipped;
    return !Object.keys(eq || {}).length && /^(My character|My PoE[12] character|New character)$/.test(p.name || '');
  }

  renameProfile(id, name) {
    if (this.profileOf(id) && name) { this.profileOf(id).name = String(name).slice(0, 60); this.save(); }
  }

  deleteProfile(id) {
    const ids = Object.keys(this.data.profiles);
    if (!this.profileOf(id) || ids.length < 2) return false;
    if (id === this.data.activeProfile) {
      const g = this.profileOf(id).game;
      this.switchProfile(ids.find((x) => x !== id && this.data.profiles[x].game === g) || ids.find((x) => x !== id));
    }
    delete this.data.profiles[id];
    this.forgetProfileKeys(id);
    const by = this.data.activeByGame || {};
    for (const g of Object.keys(by)) if (by[g] === id) delete by[g];
    this.save();
    return true;
  }

  // soon: for bookkeeping nobody waits for (the stats you've seen), so a new item's F2 doesn't write
  // the whole settings file before its popup shows. Any save() in the meantime writes it anyway.
  saveSoon() {
    if (this.soonTimer) return;
    this.soonTimer = setTimeout(() => { this.soonTimer = null; this.save(); }, 1500);
    if (this.soonTimer.unref) this.soonTimer.unref();
  }

  save() {
    if (this.soonTimer) { clearTimeout(this.soonTimer); this.soonTimer = null; }
    // keep the active character's stored copy in step (cheap: same objects)
    if (this.data.profiles && this.data.profiles[this.data.activeProfile]) {
      Object.assign(this.data.profiles[this.data.activeProfile], this.snapshot());
    }
    const tmp = this.file + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      // Windows: the indexer or antivirus can hold the file for a moment
      for (let i = 0; ; i++) {
        try { fs.renameSync(tmp, this.file); break; } catch (err) {
          if (i >= 4) throw err;
          const until = Date.now() + 50 * (i + 1); while (Date.now() < until) { /* wait */ }
        }
      }
    } catch (err) { if (this.onError) this.onError(err); }
  }

  get weights() { return this.data.weights; }
  get equipped() { return this.data.equipped; }
  get settings() { return this.data.settings; }

  setWeight(key, value) {
    const n = Number(value);
    if (!key) return;
    if (!Number.isFinite(n) || n === 0) delete this.data.weights[key];
    else this.data.weights[key] = n;
    this.save();
  }

  replaceWeights(obj) {
    const clean = {};
    for (const [k, v] of Object.entries(obj || {})) {
      const n = Number(v);
      if (k && Number.isFinite(n) && n !== 0) clean[k] = n;
    }
    this.data.weights = clean;
    this.save();
  }

  resetWeights() { this.data.weights = { ...DEFAULT_WEIGHTS }; this.save(); }

  setEquipped(slot, item) {
    if (item) this.data.equipped[slot] = item; else delete this.data.equipped[slot];
    this.save();
  }

  // Remembers which stats you've seen, overall and per item class
  // ("seen on Gloves"), for the stat picker. Each item text counts once.
  noteStats(item) {
    let changed = false;
    for (const k of Object.keys(item.stats || {})) {
      if (!this.data.seenStats[k]) { this.data.seenStats[k] = 1; changed = true; }
    }
    const cls = item.itemClass;
    if (cls) {
      const sig = `${cls}|${item.name}|${(item.lines || []).map((l) => l.text).join('|')}`;
      this.data.seenItems = this.data.seenItems || {};
      if (!this.data.seenItems[sig]) {
        this.data.seenItems[sig] = 1;
        const keys = Object.keys(this.data.seenItems);
        if (keys.length > 2000) delete this.data.seenItems[keys[0]];
        this.data.seenByClass = this.data.seenByClass || {};
        const byClass = this.data.seenByClass[cls] = this.data.seenByClass[cls] || {};
        for (const k of Object.keys(item.stats || {})) byClass[k] = (byClass[k] || 0) + 1;
        changed = true;
      }
    }
    if (changed) this.saveSoon();
  }

  setSetting(key, value) {
    // keys come from the app's pages: never one that would change how objects themselves work
    if (typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key)) return;
    this.data.settings[key] = value; this.save();
  }
}

module.exports = { Store, DEFAULT_WEIGHTS, GAME_KEYS };
