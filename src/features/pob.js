'use strict';

// Path of Building: the engines (one per game), judging items on your build (pobJudge), the checks on
// top (flasks, links, broken builds), Path of Building's trade search and your resistances.
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const trade = require('../core/trade');
const gamesLib = require('../core/games');
const { SLOT_GROUPS } = require('../core/slots');
const resLib = require('../core/resists');
const ROOT = path.join(__dirname, '..'); // src

module.exports = function (C) {
  // ---------- Path of Building engine ----------
  // Your PoB export is the reference build; every item is judged by what it really changes on it
  // (minion DPS, effective HP, resistances against the cap, Spirit, attributes). Items you've
  // copied in game replace PoB's, so it calculates with what you're actually wearing.
  const { createEngine } = require('../pobengine');
  const pobVerdict = require('../core/pobverdict');
  // the game you're playing (your active character's): decides the trade site, prices and Path of Building
  // The game a piece of work is for. A trade search or price check keeps the game it started in
  // (AsyncLocalStorage follows it through every await), so pressing F2 in the other game halfway
  // through can't mix the two games' leagues, stat ids, budgets and characters.
  const { AsyncLocalStorage } = require('async_hooks');
  const gameCtx = new AsyncLocalStorage();
  const tg = () => { const c = gameCtx.getStore(); return (c && c.game) || C.store.activeGame(); };
  const inGame = (fn) => (...args) => gameCtx.run({ game: C.store.activeGame() }, () => fn(...args));
  // still on the game this work started in?
  const sameGame = () => tg() === C.store.activeGame();
  const SWITCHED = () => ({ ok: false, switched: true, error: `You changed game while this was running, so it was stopped. Try again in ${G(C.store.activeGame()).short}.` });
  // game settings (league, budget, search sizes, rates) are only written for the game you're on
  const setGameSetting = (k, v) => { if (sameGame()) C.store.setSetting(k, v); };
  const G = (g) => gamesLib.gameOf(g || tg());
  // one Path of Building per game, started when needed; only the game you're playing keeps one
  // running (each holds ~250 MB once a build is loaded).
  const pobEngs = {};
  function pobEngine() {
    return pobEngineFor(tg());
  }
  function pobEngineFor(game) {
    if (!pobEngs[game]) pobEngs[game] = createEngine({ log: C.log, appPath: path.join(ROOT, '..'), resourcesPath: process.resourcesPath, packaged: app.isPackaged, game, onFail: () => { if (C.usage) C.usage.problem('pob'); } });
    return pobEngs[game];
  }
  // you changed game: give the other game's engine's memory back now, not after its idle time
  function stopOtherEngines(game) {
    for (const [g, e] of Object.entries(pobEngs)) if (g !== game) { try { e.stop(); } catch (_) { /* ignore */ } }
  }
  function pobFile(id) { return path.join(app.getPath('userData'), 'pob', `${id || C.store.data.activeProfile || 'main'}.xml`); }
  function guideFile(id) { return pobFile(id).replace(/\.xml$/, '.build'); }
  // the build text, read again only when the file changed: it's asked for many times per item
  // judged (every pobOn()), and builds can be a few MB
  let xmlCache = { file: null, mtime: 0, size: -1, text: null };
  function pobXml() {
    const f = pobFile();
    try {
      const st = fs.statSync(f);
      if (xmlCache.file === f && xmlCache.mtime === st.mtimeMs && xmlCache.size === st.size) return xmlCache.text;
      const text = fs.readFileSync(f, 'utf8');
      xmlCache = { file: f, mtime: st.mtimeMs, size: st.size, text };
      return text;
    } catch (_) { return null; }
  }
  // an item's text as copied in game; items saved by older versions kept only their parsed lines, so
  // their text is put back together from those (sections in the game's order)
  function itemText(it) {
    if (!it) return null;
    if (it.raw) return it.raw;
    if (!Array.isArray(it.lines) || !it.lines.length || !it.name) return null;
    const tagged = (tags) => it.lines.filter((l) => tags.includes(l.tag)).map((l) => (l.tag === 'implicit' && !/\(implicit\)$/.test(l.text) ? `${l.text} (implicit)` : l.tag === 'rune' && !/\((rune|augmented)\)$/.test(l.text) ? `${l.text} (rune)` : l.text));
    const parts = [[`Item Class: ${it.itemClass || ''}`, `Rarity: ${it.rarity || 'Rare'}`, it.name, ...(it.baseType && it.baseType !== it.name ? [it.baseType] : [])].join('\n')];
    const props = tagged(['base', 'info']);
    if (props.length) parts.push(props.join('\n'));
    if (it.itemLevel) parts.push(`Item Level: ${it.itemLevel}`);
    for (const sect of [['rune'], ['implicit'], ['explicit', 'crafted', 'fractured', 'desecrated', undefined, null]]) { const l = tagged(sect); if (l.length) parts.push(l.join('\n')); }
    if (it.corrupted) parts.push('Corrupted');
    return parts.join('\n--------\n');
  }
  function pobOverrides() {
    const out = [];
    for (const [slot, pobSlot] of Object.entries(pobVerdict.SLOT_TO_POB)) {
      const it = C.store.equipped[slot];
      const text = it && !it.fromPob ? itemText(it) : null;
      if (text) out.push({ slot: pobSlot, text });
    }
    return out;
  }
  function pobOn() { return C.store.settings.usePob !== false && pobEngine().available() && !!pobXml(); }
  let pobSheetGen = 0; // bumped whenever build or gear changes, so the Character page recalculates
  function pobSync() { pobQueries.clear(); pobSheetGen++; if (pobOn()) pobEngine().setBuild(pobXml(), pobOverrides()); else if (pobEngine().available()) pobEngine().setBuild(null); } // no build: never keep the last character's
  // each game has its own priorities (store GAME_KEYS); in PoE1 chaos resistance counts by default
  const pobPriorities = () => ({ ...pobVerdict.DEFAULT_PRIORITIES, ...(tg() === 'poe1' ? { chaos: true } : {}), ...(C.store.settings.priorities || {}) });
  // Chaos Inoculation (seen in your PoB build) makes chaos resistance irrelevant
  // (remembered per character from the last time PoB loaded the build, so it doesn't flip when the engine idles)
  const pobCI = () => {
    const i = pobEngs[tg()] && pobEngs[tg()].info();
    if (i && i.stats && pobOn()) { const ci = pobVerdict.hasCI(i.stats); const m = C.store.settings.pobCI || {}; if (m[C.store.data.activeProfile] !== ci) C.store.setSetting('pobCI', { ...m, [C.store.data.activeProfile]: ci }); return ci; }
    return pobOn() && !!(C.store.settings.pobCI || {})[C.store.data.activeProfile];
  };
  const pobWeights = () => ({ damageWeight: C.store.settings.pobDamageWeight == null ? 0.6 : Number(C.store.settings.pobDamageWeight), priorities: pobPriorities(), ignoreChaos: pobCI() });
  // list: [{ item, slot }] -> a PoB verdict for each (or null)
  async function pobJudge(list) {
    if (!pobOn() || !list.length) return list.map(() => null);
    const req = []; const idx = [];
    list.forEach((x, i) => {
      const text = x.item && (x.item.raw || x.item.listingText);
      if (!text) return;
      // jewels: PoB tries it in every jewel socket you've allocated on the tree
      if (x.item.slot === 'Jewel' || /^Jewel \d+$/.test(x.slot || '')) { req.push({ slot: 'Jewel', text }); idx.push([i, 'Jewel']); return; }
      if (x.item.slot === 'Flask') { req.push({ slot: 'Flask', text }); idx.push([i, 'Flask']); return; }
      // PoE1: a third ring slot (The Unseen Hand) when your build has a ring there
      if (tg() === 'poe1' && x.item.slot === 'Ring' && (((pobEngine().info() || {}).gear) || {})['Ring 3']) { req.push({ slot: 'Ring 3', text }); idx.push([i, 'Ring 3']); }
      // dual wielding: a one-hand weapon is also tried in place of the weapon in your other hand
      if (x.item.slot === 'Weapon' && !x.item.twoHanded && !x.slot) {
        const off = C.store.equipped.Offhand;
        if (off && !off.twoHanded && require('../core/slots').slotForClass(off.itemClass) === 'Weapon') { req.push({ slot: 'Weapon 2', text }); idx.push([i, 'Offhand']); }
      }
      const group = x.item.slot && SLOT_GROUPS[x.item.slot];
      const slots = group && group.every((g) => pobVerdict.SLOT_TO_POB[g]) ? group : [x.slot || x.item.slot];
      for (const sl of slots) { const ps = pobVerdict.SLOT_TO_POB[sl]; if (ps) { req.push({ slot: ps, text }); idx.push([i, sl]); } }
    });
    const per = list.map(() => []);
    const errs = list.map(() => null);
    if (req.length) {
      const res = await pobEngine().evalItems(req);
      res.forEach((r, k) => {
        if (!r || !r.ok) { if (r && r.error && !errs[idx[k][0]]) errs[idx[k][0]] = String(r.error); return; }
        if (r.multi && idx[k][1] === 'Flask') {
          for (const m of flaskSlots(r)) {
            const j = pobVerdict.judge(m.before || r.before, m.after, pobWeights());
            if (!j) continue;
            j.slot = 'Flask'; j.socket = { kind: 'flask', slot: m.slot, label: m.label, replacing: m.replacing || null, active: m.active };
            const note = flaskNote(r, m);
            if (note) j.flaskNote = note;
            // a life / mana flask in place of the same kind: its recovery isn't in Path of Building's
            // damage and effective HP, so clearly more (or less) recovery decides when PoB sees no change
            const rec = flaskRecovery(r, m);
            if (rec && ['same', 'small'].includes(j.verdict)) {
              if (rec.ratio >= 1.15) { j.byRecovery = true; j.verdict = rec.ratio >= 1.4 ? 'upgrade' : 'small'; j.flaskNote = `Judged on recovery (Path of Building's damage and effective HP don't count it): ${Math.round((rec.ratio - 1) * 100)}% more ${rec.what} than yours. ${j.flaskNote || ''}`.trim(); }
              else if (rec.ratio <= 0.87) { j.byRecovery = true; j.verdict = 'downgrade'; j.flaskNote = `Judged on recovery (Path of Building's damage and effective HP don't count it): ${Math.round((1 - rec.ratio) * 100)}% less ${rec.what} than yours. ${j.flaskNote || ''}`.trim(); }
            }
            if (!m.active && m.replacing) j.breaks.push(`Your ${m.label} is switched off in your Path of Building build, so it was switched on for this check`);
            per[idx[k][0]].push(j);
          }
          if (!per[idx[k][0]].length) errs[idx[k][0]] = errs[idx[k][0]] || 'Path of Building has no flask slot this fits.';
          return;
        }
        if (r.multi) {
          // a jewel that's already in one of your sockets is only compared with itself there
          const nm = list[idx[k][0]].item && list[idx[k][0]].item.name;
          const own = r.multi.filter((m) => nm && m.replacing === nm);
          // PoE1: taking out a cluster jewel would remove its passives, which PoB's quick calculation
          // keeps: a result in a cluster jewel's socket would overstate, so those sockets aren't tried
          const usable = own.length ? own : r.multi.filter((m) => !m.replacingCluster);
          // "Limited to: 1" (Watcher's Eye...): PoB ignores a second copy, so one you have is only swapped for itself
          const lim = list[idx[k][0]].item && list[idx[k][0]].item.limitedTo;
          if (!usable.length) { errs[idx[k][0]] = errs[idx[k][0]] || 'Your only jewel sockets this fits hold cluster jewels, which the app can\'t judge a swap for yet.'; return; }
          for (const m of usable) {
            const j = pobVerdict.judge(r.before, m.after, pobWeights());
            if (j) { j.slot = idx[k][1]; j.socket = { slot: m.slot, label: m.label, replacing: m.replacing || null }; if (lim && own.length) j.limitNote = `Limited to ${lim}: compared in place of the one in your tree`; per[idx[k][0]].push(j); }
          }
          return;
        }
        const j = pobVerdict.judge(r.before, r.after, pobWeights());
        if (j) { j.slot = idx[k][1]; gearBreaks(j, list[idx[k][0]].item, req[k].slot); per[idx[k][0]].push(j); }
      });
    }
    const out = per.map((arr) => pobVerdict.best(arr));
    out.errors = errs; // why PoB couldn't judge an item, when it said
    return out;
  }
  // which flask slots a flask is compared in: the one with the same flask (base) first, else the
  // same kind (life with life, mana with mana), else your utility flasks / tinctures and empty slots
  function flaskSlots(r) {
    const m = r.multi || [];
    const same = m.filter((x) => x.replacingBase && x.replacingBase === r.base);
    if (same.length) return same;
    const life = (x) => /^(Life|Mana|Hybrid)$/.test(x || '');
    if (life(r.sub)) { const k = m.filter((x) => x.replacingSub === r.sub); if (k.length) return k; }
    const other = m.filter((x) => !x.replacing || (!life(x.replacingSub) && (x.replacingType === r.type || !r.type)));
    return other.length ? other : m;
  }
  // how a life / mana flask's recovery compares with the one it replaces (same kind only)
  function flaskRecovery(r, m) {
    const a = r.flask; const b = m.replacingFlask;
    if (!a || !b || !m.replacing || m.replacingSub !== r.sub) return null;
    for (const [k, what] of [['life', 'life'], ['mana', 'mana']]) if (a[k] > 0 && b[k] > 0) return { ratio: a[k] / b[k], what };
    return null;
  }
  // life / mana flasks: their recovery isn't in the damage / effective HP numbers, so it's said
  function flaskNote(r, m) {
    const a = r.flask; const b = m.replacingFlask;
    if (!a) return null;
    const n = (v) => Math.round(v).toLocaleString('en');
    const part = (k, word) => (a[k] > 0 ? `${n(a[k])} ${word}${b && b[k] > 0 ? ` (yours: ${n(b[k])})` : ''}` : null);
    const rec = [part('life', 'life'), part('mana', 'mana')].filter(Boolean);
    if (!rec.length) return null;
    return `Recovers ${rec.join(' and ')}${a.duration ? ` over ${a.duration}s` : ''}`;
  }
  // PoE1 checks Path of Building's quick calculation can't make: it keeps your gems linked whatever
  // the new item's sockets are, and judges a quiver as if any weapon could use it
  function gearBreaks(j, item, pobSlot) {
    if (!item) return;
    // amulets: the anoint (PoE1) or instill (PoE2) is part of the item, so Path of Building counts yours as
    // lost on one without it (and adds the new one's); say so, since it can be put on again
    if (pobSlot === 'Amulet') {
      const anoint = (it) => { const m = String((it && (it.raw || it.listingText)) || '').match(/^Allocates (.+?)(?: \(enchant\))?\s*$/m); return m ? m[1].trim() : null; };
      const mine = anoint(C.store.equipped.Amulet); const theirs = anoint(item);
      const p1 = tg() === 'poe1';
      if (mine && mine !== theirs) j.breaks.push(`Your amulet's ${p1 ? 'anoint' : 'instilled passive'} (${mine}) isn't on this one${theirs ? ` (it has ${theirs})` : ''}: the verdict counts that. ${p1 ? 'Anointing it again costs oils' : 'Instilling it again costs Distilled Emotions'}`);
    }
    if (tg() !== 'poe1') return;
    const add = (msg, bad) => {
      j.breaks.push(msg);
      if (bad || !(j.score > 0)) { if (!['resloss', 'dmgloss'].includes(j.verdict)) j.verdict = 'downgrade'; } else if (['upgrade', 'small', 'same'].includes(j.verdict)) j.verdict = 'risky';
    };
    const g = ((pobEngine().info() || {}).slotGems || {})[pobSlot];
    if (g && g.gems >= 2 && /^(Weapon [12]|Helmet|Body Armour|Gloves|Boots)$/.test(pobSlot)) {
      const links = item.links || (item.socketCount ? 1 : 0);
      if (links < g.gems) {
        const what = links ? `It has a ${links}-link` : 'It has no sockets';
        add(`${what}: your ${g.label || 'gems'} in this slot use${g.gems === 1 ? 's' : ''} ${g.gems} linked gems${item.corrupted || links === 0 ? '' : ' (link it first)'}`, !!item.corrupted || links === 0);
      }
    }
    const wep = C.store.equipped.Weapon;
    if (/^Quivers?$/i.test(item.itemClass || '') && wep && !/^Bows?$/i.test(wep.itemClass || '')) add('Quivers only work with a bow, and your weapon isn\'t one', true);
  }
  // PoE1 flasks and tinctures: Path of Building tries them in each of your five flask slots
  const isFlaskClass = (item) => !!item && /flask|tincture/i.test(item.itemClass || '');
  // cluster and timeless jewels change the passive tree itself, which the quick calculation doesn't redo
  const isClusterJewel = (item) => !!item && (!!item.cluster || / Cluster Jewel$/i.test(item.baseType || ''));
  const isTimelessJewel = (item) => !!item && (/^Timeless Jewel$/i.test(item.baseType || '') || /^Timeless Jewel$/i.test(item.name || ''));
  // PoE1 items Path of Building isn't asked about, and why (shown instead of a verdict)
  function poe1Unjudged(item, slot) {
    if (!item) return null;
    if (isClusterJewel(item)) return "Cluster jewels aren't judged yet: they add passives, which the app's Path of Building check doesn't redo.";
    if (isTimelessJewel(item)) return "Timeless jewels aren't judged yet: their passive changes need data that doesn't come with the app.";

    if (!pobCanJudge(item, slot)) return null;
    if (!pobOn()) return pobEngine().available() ? 'Not judged: PoE1 items are judged by Path of Building only. Paste your Path of Building Community build on My gear.' : "Not judged: Path of Building for PoE1 isn't installed with this copy of the app.";
    return null;
  }
  // can Path of Building judge this item? (charms and flasks use the gear score)
  function pobCanJudge(item, slot) {
    if (!item) return false;
    if (item.unidentified) return false; // its mods are hidden: any verdict would only be about the base
    if (tg() === 'poe1' && (isClusterJewel(item) || isTimelessJewel(item))) return false;
    if (item.slot === 'Flask') return tg() === 'poe1';
    if (item.slot === 'Jewel' || /^Jewel \d+$/.test(slot || '')) return true;
    const group = item.slot && SLOT_GROUPS[item.slot];
    return !!(pobVerdict.SLOT_TO_POB[slot] || (group && group.every((g) => pobVerdict.SLOT_TO_POB[g])) || pobVerdict.SLOT_TO_POB[item.slot]);
  }
  const pobErrorOf = (res, i) => (res && res.errors && res.errors[i]) || 'Path of Building could not read this item.';
  // Path of Building's own weighted trade search for a slot ("Trader"), trimmed to what the trade
  // site accepts; every listing it finds is then checked exactly with your build.
  const pobQueries = new Map(); // slot|weights -> { at, r }
  // which of your tree's jewel sockets a jewel search is for: the one holding this jewel if it's in
  // your tree, otherwise your first socketed one (the weights are the same for every normal socket)
  function pobJewelSocket(item) {
    const socks = ((pobEngine().info() || {}).sockets) || [];
    return (item && socks.find((s) => s.jewel && s.jewel === item.name)) || socks.find((s) => s.jewel) || socks[0] || null;
  }
  const isRadiusJewel = (item) => !!item && (/^Time-Lost /i.test(item.baseType || '') || (item.lines || []).some((l) => /^Radius:/i.test(l.text || '')));

  async function pobQueryFor(slot, item) {
    const eng = pobEngine();
    const info = await eng.ensureLoaded();
    const key = pobVerdict.dpsKey(info && info.stats);
    const w = pobWeights().damageWeight;
    // the damage number PoB's search should raise: the same one the verdicts use for this build
    const dmgStat = { MinionDPS: 'MinionCombinedDPS', FullDPS: 'FullDPS', CombinedDPS: 'CombinedDPS', TotalDPS: 'TotalDPS' }[key] || 'FullDPS';
    const weights = [{ stat: dmgStat, weightMult: w }, { stat: 'TotalEHP', weightMult: Math.max(0.05, 1 - w) }];
    let pobSlotName = pobVerdict.SLOT_TO_POB[slot]; let jewelType;
    if (slot === 'Jewel') {
      const sock = pobJewelSocket(item);
      if (!sock) throw new Error('Your Path of Building build has no allocated jewel socket.');
      // PoB2 knows Base and Radius jewels; PoB1 Base and Abyss
      if (tg() === 'poe1') {
        const abyss = !!item && (!!item.abyss || /Abyss Jewels?/i.test(item.itemClass || '') || /^(Murderous|Searching|Hypnotic|Ghastly) Eye Jewel$/i.test(item.baseType || ''));
        const s2 = abyss ? (((pobEngine().info() || {}).sockets) || []).find((x) => x.abyssal) : null;
        if (abyss && !s2) throw new Error('Your Path of Building build has no abyssal socket for this jewel.');
        pobSlotName = (s2 || sock).slot; jewelType = abyss ? 'Abyss' : 'Base';
      } else { pobSlotName = sock.slot; jewelType = isRadiusJewel(item) ? 'Radius' : 'Base'; }
    }
    const ck = `${C.store.data.activeProfile}|${slot}|${jewelType || ''}|${w}`; // resistance priority is applied after, per search
    const hit = pobQueries.get(ck);
    if (hit && Date.now() - hit.at < 15 * 60000) return hit.r;
    const t0 = Date.now();
    const r = await eng.makeQuery({ slot: pobSlotName, weights, jewelType });
    r.query = typeof r.query === 'string' ? JSON.parse(r.query) : r.query;
    C.log(`pob: built a ${slot} search in ${Date.now() - t0} ms (${((r.query.query.stats || []).find((g) => g.type === 'weight') || { filters: [] }).filters.length} weighted stats)`);
    pobQueries.set(ck, { at: Date.now(), r });
    return r;
  }
  const ck = (slot, item) => `${C.store.data.activeProfile}|${slot}|${slot === 'Jewel' && item && isRadiusJewel(item) ? 'r' : ''}`;
  // the minimum score a slot's search ended on (it starts there next time: fewer searches)
  const learnedMin = new Map(); // ck -> { min, base, at }
  const scoreOf = (raw) => {
    const pm = raw && raw.item && raw.item.pseudoMods;
    const line = Array.isArray(pm) && pm.length ? String(pm[0].description || pm[0]) : '';
    const m = line.match(/Sum:\s*([\d.]+)/);
    return m ? Number(m[1]) : null;
  };
  async function narrowWeighted(league, body0, r0, slot, key) {
    const CAP = 10000; const WANT = 20; const MAX = 4;
    let body = body0; let r = r0; let rounds = 0; let widened = false;
    const wOf = (b) => b.query.stats.find((x) => x.type === 'weight');
    const base = wOf(body0).value.min || 0;
    // start from where this slot's last search ended (same build, same budget, last 30 minutes)
    const learned = learnedMin.get(key);
    if (r.ok && r.total >= CAP && learned && learned.base === base && learned.budget === JSON.stringify(body0.query.filters && body0.query.filters.trade_filters) && Date.now() - learned.at < 30 * 60000 && learned.min > base) {
      const b2 = JSON.parse(JSON.stringify(body)); wOf(b2).value.min = learned.min;
      const r2 = await C.runSearch(league, b2, `pob ${slot} min ${Math.round(learned.min)}`, { maxWait: 15000 });
      if (r2 && r2.ok && r2.total >= WANT) { body = b2; r = r2; rounds++; }
    }
    while (r && r.ok && r.total >= CAP && rounds < MAX && r.ids && r.ids.length) {
      let top = null;
      try { const raw = await C.fetchListings(league, r.searchId, r.ids.slice(0, 1), r.game || C.tg()); top = scoreOf(raw[0]); } catch (err) { C.log(`pob search: could not read the best listing's score: ${err.message}`); }
      const min = wOf(body).value.min || 0;
      if (!(top > min)) break;
      const b2 = JSON.parse(JSON.stringify(body)); wOf(b2).value.min = (top + min) / 2;
      const r2 = await C.runSearch(league, b2, `pob ${slot} min ${Math.round(wOf(b2).value.min)}`, { maxWait: 15000 });
      if (!r2 || !r2.ok) break;
      C.log(`pob search: ${slot} over the 10,000 cap, minimum score ${Math.round(min)} -> ${Math.round(wOf(b2).value.min)} (best ${Math.round(top)}): ${r2.total} listed`);
      if (r2.total < WANT) {
        // too far: halfway back
        const b3 = JSON.parse(JSON.stringify(body)); wOf(b3).value.min = (min + wOf(b2).value.min) / 2;
        const r3 = await C.runSearch(league, b3, `pob ${slot} min ${Math.round(wOf(b3).value.min)}`, { maxWait: 15000 });
        if (r3 && r3.ok && r3.total >= WANT) { body = b3; r = r3; rounds++; } else if (r2.total > 0) { body = b2; r = r2; rounds++; }
        break;
      }
      body = b2; r = r2; rounds++;
    }
    // too few listings at your item's half: lower the bar (twice at most), as Path of Building does
    let w = 0;
    while (r && r.ok && !rounds && r.total < WANT && w < 2 && (wOf(body).value.min || 0) > 0) {
      const b2 = JSON.parse(JSON.stringify(body)); wOf(b2).value.min = (wOf(body).value.min || 0) / 2;
      const r2 = await C.runSearch(league, b2, `pob ${slot} min ${Math.round(wOf(b2).value.min)}`, { maxWait: 15000 });
      if (!r2 || !r2.ok) break;
      C.log(`pob search: ${slot} only ${r.total} listed, minimum score ${Math.round(wOf(body).value.min)} -> ${Math.round(wOf(b2).value.min)}: ${r2.total} listed`);
      body = b2; r = r2; w++; widened = true;
    }
    if (rounds) learnedMin.set(key, { min: wOf(body).value.min, base, budget: JSON.stringify(body0.query.filters && body0.query.filters.trade_filters), at: Date.now() });
    return { r, body, rounds, widened };
  }
  async function pobSearch(item, slot, league, budget, opts) {
    const pq = await pobQueryFor(slot, item);
    const all = JSON.parse(JSON.stringify(pq.query));
    const wg = (all.query.stats || []).find((g) => g.type === 'weight');
    if (!wg || !wg.filters.length) return null;
    // "cap resistances first": push the resistances you're still missing to the top of the search
    const pr = pobPriorities();
    const boosted = [];
    if (pr.resFirst && opts.statIndex) {
      const info = pobEngine().info();
      const st = (info && (info.stats || {})) || {};
      const short = ['Fire', 'Cold', 'Lightning', ...(pr.chaos && !pobCI() ? ['Chaos'] : [])].filter((El) => {
        const v = Number(st[`${El}Resist`]); const tot = Number(st[`${El}ResistTotal`]);
        const max = Number(st[`${El}ResistMax`]) || 75; // your real cap (e.g. raised by passives)
        return Number.isFinite(v) && v < max - 0.5 && !(tot > v + 0.5);
      });
      if (short.length) {
        const re = new RegExp(`^\\+?#% to (all Elemental Resistances|(${short.join('|')})( and (Fire|Cold|Lightning|Chaos))? Resistances?|(Fire|Cold|Lightning|Chaos) and (${short.join('|')}) Resistances)$`, 'i');
        const ids = (opts.statIndex.all || []).filter((e) => (e.type === 'explicit' || e.type === 'implicit') && re.test(e.text)).map((e) => e.id);
        // Each resistance point counts half as much as a point of your best % stat (e.g. minion damage).
        // So an item with your damage mods *and* the resistance comes first, and one with only a big
        // resistance roll doesn't push them out. (Matching the top stat filled the search with res-only rings.)
        const text = new Map((opts.statIndex.all || []).map((e) => [e.id, e.text]));
        const isRes = (id) => /Resistances?$/i.test(text.get(id) || '');
        const pctW = wg.filters.filter((f) => !isRes(f.id) && /#%/.test(text.get(f.id) || '')).map((f) => Math.abs(f.value.weight));
        const ref = pctW.length ? Math.max(...pctW) : Math.max(...wg.filters.map((f) => Math.abs(f.value.weight)), 1);
        for (const id of ids) {
          const f = wg.filters.find((x) => x.id === id);
          if (f) f.value.weight = Math.max(f.value.weight, ref * 0.5);
          else wg.filters.push({ id, value: { weight: ref * 0.5 } });
          boosted.push(id);
        }
        C.log(`pob search: resistances first – boosting ${short.join(', ')} res (${ids.length} stats)`);
      }
    }
    wg.filters.sort((a, b) => Math.abs(b.value.weight) - Math.abs(a.value.weight));
    // "never lose damage" and "keep my movement speed" aren't filters on the search any more: they
    // hid listings Path of Building ranks high (a ring with one huge stat, boots a little slower but
    // far better). Every listing is judged with your build instead, and one that loses damage or
    // movement speed is marked and goes to the bottom, as Path of Building's own trader ranks them.
    // the site's complexity limit is lower when you're not signed in: start at the size it took last time
    const SIZES = [30, 15, 10, 7, 5, 3];
    const sizeKey = (await C.signedIn()) ? 'signed' : 'anon';
    // what size the site took last time, for a day (it was kept for good, so one refused search left
    // every later one at 3 stats)
    const kept = (C.store.settings.pobSearchSize || {})[sizeKey];
    const fresh = kept && typeof kept === 'object' && Date.now() - (kept.at || 0) < 24 * 3600 * 1000;
    let size = Math.min(fresh ? kept.size || 0 : 0, SIZES.length - 1);
    let r = null; let body = null;
    for (;;) {
      body = JSON.parse(JSON.stringify(all));
      const g = body.query.stats.find((x) => x.type === 'weight');
      g.filters = g.filters.slice(0, SIZES[size]);
      body.query.status = { option: trade.statusOpt(opts.status) };
      delete body.engine;
      trade.applyBudget(body, budget, tg());
      r = await C.runSearch(league, body, `pob ${slot}${size ? ` size${size}` : ''}`);
      if (!(r && r.tooComplex) || size >= SIZES.length - 1) break;
      size++;
      setGameSetting('pobSearchSize', { ...(C.store.settings.pobSearchSize || {}), [sizeKey]: { size, at: Date.now() } });
    }
    if (r && r.tooComplex) return { ok: false, error: `The trade site says this search has too many filters.${(await C.signedIn()) ? '' : ' Signing in to pathofexile.com (Settings → Trade site account) raises the limit.'}` };
    if (!r || !r.ok) return r;
    // Path of Building's own way past the trade site's 10,000 cap: the site stops counting there and
    // its "best first" order only covers what it counted, so the best listings can be missing.
    // Raise the minimum score halfway to the best listing's and search again, until it's under the
    // cap; with too few listings, halve it (TradeQueryRequests.lua, SearchWithQueryWeightAdjusted).
    const tuned = await narrowWeighted(league, body, r, slot, ck(slot, item));
    r = tuned.r; body = tuned.body;
    const used = body.query.stats.find((x) => x.type === 'weight').filters.length;
    const narrowed = tuned.rounds ? `; the trade site counted over 10,000, so the minimum score was raised ${tuned.rounds === 1 ? 'once' : `${tuned.rounds} times`} to rank the best of all of them` : tuned.widened ? '; few listings scored high enough, so the minimum score was lowered' : '';
    const ctx = {
      item, mode: 'pob', body, searchKey: C.searchKey(body),
      title: `Best for your build: ${item.slot === 'Ring' ? 'rings' : slot === 'Jewel' ? (tg() !== 'poe1' && isRadiusJewel(item) ? 'radius jewels' : item.abyss ? 'abyss jewels' : 'jewels') : slot}`,
      note: `Path of Building weighted this search by what each stat does to your build (${used} stats${used < wg.filters.length ? `, the trade site allowed ${used} of ${wg.filters.length}` : ''})${boosted.length ? ', with extra weight on the resistances you still need' : ''}${narrowed}. Every listing below is then checked with your build: items that lose resistance, damage or movement speed are marked and go to the bottom.`,
    };
    if (opts.noOpen) return { ok: true, r, body, ctx, filters: used }; // "where to spend" looks at the listings itself
    const res = await C.openIfAny(r, ctx);
    return { ...res, mode: 'pob', filters: used };
  }

  // put a PoB verdict onto a comparison (popup result or listing compare)
  function applyPob(r, j) {
    if (!r || !j) return r;
    r.pob = j;
    // which skill the damage was judged on (Full DPS adds several up: then it's said as such)
    j.game = tg();
    if (!j.skill) { const info = pobEngine().info() || {}; j.skill = j.dpsKey === 'FullDPS' ? 'Full DPS' : info.mainSkill || null; }
    r.verdict = j.verdict;
    r.scoreMode = 'pob';
    r.delta = j.byRecovery ? null : j.score; // a flask judged by its recovery: no "0% for your build"
    r.pct = null;
    if (j.socket) { r.replacing = [j.socket.replacing ? `${j.socket.replacing} (${j.socket.label})` : `an empty ${j.socket.kind === 'flask' ? 'flask slot' : 'jewel socket'} (${j.socket.label})`]; if (j.socket.kind === 'flask') r.targetSlot = j.socket.label; }
    else if (j.slot === 'Ring 3') { const g3 = (((pobEngine().info() || {}).gear) || {})['Ring 3']; r.targetSlot = 'Ring 3'; r.replacing = [g3 ? `${g3} (Ring 3)` : 'Ring 3']; }
    else if (j.slot && j.slot !== r.targetSlot && C.store.equipped[j.slot]) { r.targetSlot = j.slot; r.replacing = [C.store.equipped[j.slot].name]; }
    if (j.flaskNote) r.flaskNote = j.flaskNote;
    if (j.limitNote) r.limitNote = j.limitNote;
    r.risks = j.breaks.length ? j.breaks : null;
    r.resRank = j.resRank;
    return r;
  }
  function liveResists() { return resLib.live(C.store.settings.resists, C.store.equipped); }
  function resNeedFor(slot) {
    const rs = liveResists();
    if (!rs || !slot) return null;
    // resistance keeps counting until you're over the cap by the safety buffer
    const cur = C.store.equipped[slot];
    const out = {};
    let any = false;
    for (const [El, el] of Object.entries(C.RES_EL)) {
      const total = Number(rs[el]);
      if (rs[el] === '' || rs[el] == null || !Number.isFinite(total)) continue;
      const fromSlot = cur && cur.stats ? (cur.stats[`#% to ${El} Resistance`] || 0) : 0;
      const cap = ((rs.caps && rs.caps[el]) || rs.cap) + (rs.buffer || 0);
      out[El] = Math.max(0, cap - (total - fromSlot));
      any = true;
    }
    return any ? out : null;
  }

  // ---------- the best uniques for your build, slot by slot ----------
  // Path of Building tries every unique of its item database that fits the slot in your build (in each
  // slot it fits, the best kept); each is judged as any item is, best first, with poe.ninja's price.
  // Uniques are what the weighted trade search leaves out.
  const UNIQUE_CLASS = { Weapon: 'Bows', Offhand: 'Shields', Helmet: 'Helmets', 'Body Armour': 'Body Armours', Gloves: 'Gloves', Boots: 'Boots', Belt: 'Belts', Amulet: 'Amulets', Ring: 'Rings' };
  const uniqueCache = new Map(); // profile|slot|level -> { at, list }
  const loses = (u) => (u.verdict === 'resloss' || u.verdict === 'dmgloss' ? 1 : 0);
  async function bestUniques(slot) {
    if (!UNIQUE_CLASS[slot]) return { ok: false, error: 'Pick a gear slot (uniques for jewels and flasks aren\'t listed yet).' };
    if (!pobOn()) return { ok: false, error: 'Load your Path of Building build first (My gear): the uniques are tried in it.' };
    const slots = (slot === 'Ring' ? ['Ring 1', 'Ring 2'] : [slot]).map((s) => pobVerdict.SLOT_TO_POB[s]).filter(Boolean);
    const budget = (C.budgetNow && C.budgetNow()) || {};
    const maxLevel = Number(budget.maxLevel) > 0 ? Math.round(budget.maxLevel) : 0;
    const key = `${C.store.data.activeProfile}|${slot}|${maxLevel}|${pobSheetGen}`;
    const hit = uniqueCache.get(key);
    if (hit && Date.now() - hit.at < 15 * 60000) return { ok: true, slot, maxLevel, list: hit.list, tried: hit.tried, cached: true };
    const t0 = Date.now();
    const r = await pobEngine().bestUniques({ slots, maxLevel });
    const w = pobWeights();
    const judged = (r.list || []).map((u) => {
      const j = pobVerdict.judge(r.before, u.after, w);
      return j && { name: u.name, base: u.base, level: u.level, slot: Object.keys(pobVerdict.SLOT_TO_POB).find((k) => pobVerdict.SLOT_TO_POB[k] === u.slot) || u.slot,
        score: j.score, verdict: j.verdict, dps: j.dps && j.dps.pct, ehp: j.ehp && j.ehp.pct, resGain: j.resGain, breaks: (j.breaks || []).slice(0, 2) };
    }).filter(Boolean).sort((a, b) => (loses(a) - loses(b)) || b.score - a.score); // one that costs a resistance or your damage goes after the rest
    C.log(`pob: tried ${(r.list || []).length} uniques for ${slot} in ${Date.now() - t0} ms`);
    const list = judged.slice(0, 20);
    // poe.ninja's price for the ones shown (a unique not on poe.ninja shows none)
    await Promise.all(list.map(async (u) => {
      try { const p = await C.ninjaPrice({ name: u.name, baseType: u.base, rarity: 'Unique', itemClass: UNIQUE_CLASS[slot] }); if (p) { u.price = p.each; u.priceDiv = p.eachDiv; } } catch (_) { /* no price */ }
    }));
    uniqueCache.set(key, { at: Date.now(), list, tried: (r.list || []).length });
    return { ok: true, slot, maxLevel, list, tried: (r.list || []).length };
  }
  const { ipcMain } = require('electron');
  // a unique from that list on the trade site: every listing of it, cheapest first, judged with your build
  ipcMain.handle('trade:unique', async (_e, name, base) => {
    const nm = String(name || '').slice(0, 80); const bt = String(base || '').slice(0, 80);
    if (!nm) return { ok: false, error: 'No unique.' };
    let d; try { d = await C.loadTradeData(false); } catch (err) { return { ok: false, error: 'Could not load trade site data: ' + (err.message || err) }; }
    const league = C.pickLeague(d);
    const body = { query: { status: { option: trade.statusOpt(C.store.settings.status) }, name: nm, ...(bt ? { type: bt } : {}), stats: [{ type: 'and', filters: [] }],
      filters: { type_filters: { filters: { rarity: { option: 'unique' } } } } }, sort: { price: 'asc' } };
    trade.applyBudget(body, C.budgetNow(), tg());
    const item = { name: nm, baseType: bt, rarity: 'Unique', itemClass: null };
    return C.openIfAny(await C.runSearch(league, body, 'unique ' + nm), { item, mode: 'similar', body, searchKey: C.searchKey(body),
      title: `${nm}${bt ? ` (${bt})` : ''}`, note: 'Every listing of this unique in your price range, cheapest first. Each one is judged with your build.' });
  });
  ipcMain.handle('pob:uniques', async (_e, sel) => {
    // the Find upgrades item: a saved slot ("Ring 1", "Weapon 2") or an item you copied ("item:<id>")
    let slot = String(sel || '');
    if (/^item:/.test(slot)) { const it = C.itemById(slot.slice(5)); slot = (it && it.slot) || ''; }
    slot = /^Ring [12]$/.test(slot) ? 'Ring' : slot.replace(/ 2$/, '');
    try { return await bestUniques(slot); } catch (err) { C.log('pob uniques: ' + err.message); return { ok: false, error: err.message }; } });

  return {
    gameCtx,
    tg,
    inGame,
    sameGame,
    SWITCHED,
    setGameSetting,
    G,
    pobEngs,
    pobEngine,
    stopOtherEngines,
    pobFile,
    guideFile,
    pobXml,
    pobOn,
    get pobSheetGen() { return pobSheetGen; },
    pobSync,
    pobPriorities,
    pobCI,
    pobWeights,
    pobJudge,
    isFlaskClass,
    poe1Unjudged,
    pobCanJudge,
    pobErrorOf,
    pobQueries,
    pobQueryFor,
    pobSearch,
    applyPob,
    liveResists,
    resNeedFor,
  };
};
