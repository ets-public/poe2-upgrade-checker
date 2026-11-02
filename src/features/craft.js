'use strict';

// Best mods to add: for an item in the popup with open prefixes or suffixes (seen with advanced copy),
// Path of Building lists every mod that can roll there (one per mod group, the best tier the item level
// allows, a middle roll), and each version of the item is judged on your build like any item. The
// popup lists the best, so "should I craft on this?" has a number for your build, not a guess.
const { ipcMain } = require('electron');

module.exports = function (C) {
  const cache = new Map(); // item id|build gen -> answer
  async function bestCrafts(result) {
    const item = result && result.item;
    if (!item || !item.raw) return { ok: false, error: 'Copy the item again (F2), then try this.' };
    if (!C.pobOn()) return { ok: false, error: 'Load your Path of Building build first (My gear): the mods are tried in it.' };
    if (/unique/i.test(item.rarity || '') || item.corrupted || item.mirrored) return { ok: false, error: 'Its mods can\'t be changed.' };
    const a = item.affixes;
    if (!a || !a.known) return { ok: false, error: 'Turn on advanced copy (Settings → Hotkeys) so the app can see which prefixes and suffixes are free, then copy the item again.' };
    if (!a.openPrefix && !a.openSuffix) return { ok: false, error: 'All its prefixes and suffixes are taken.' };
    const key = `${item.id}|${C.pobSheetGen()}|${result.targetSlot}`;
    if (cache.has(key)) return cache.get(key);
    const t0 = Date.now();
    const r = await C.pobEngine().craftOptions({ text: item.raw, prefix: a.openPrefix, suffix: a.openSuffix, ilvl: item.itemLevel || undefined });
    const opts = r.options || [];
    if (!opts.length) return { ok: false, error: 'Path of Building knows no mods that can roll in the free slots of this base.' };
    const judged = await C.pobJudge(opts.map((o) => ({ item: { ...item, raw: o.text, listingText: null }, slot: result.targetSlot })));
    const now = result.pob ? result.pob.score : null;
    const list = opts.map((o, i) => {
      const j = judged[i];
      if (!j) return null;
      return { type: o.type, affix: o.affix, tier: o.tier, tiers: o.tiers, level: o.level, lines: o.lines, score: j.score, verdict: j.verdict,
        gain: now == null ? null : Math.round((j.score - now) * 10) / 10, dps: j.dps && j.dps.pct, ehp: j.ehp && j.ehp.pct, capped: j.resCapped || [] };
    }).filter(Boolean).sort((x, y) => y.score - x.score);
    C.log(`craft: ${opts.length} mods tried for ${item.name} (${a.openPrefix}p/${a.openSuffix}s open) in ${Date.now() - t0} ms`);
    const out = { ok: true, open: { prefix: a.openPrefix, suffix: a.openSuffix }, ilvl: r.ilvl, now, list: list.slice(0, 8), tried: list.length,
      useless: list.filter((x) => x.gain != null && x.gain < 0.3).length };
    cache.set(key, out);
    if (cache.size > 30) cache.delete(cache.keys().next().value);
    return out;
  }
  ipcMain.handle('craft:best', async () => {
    try { return await bestCrafts(C.popupResult); } catch (err) { C.log('craft: ' + (err.stack || err)); return { ok: false, error: err.message || String(err) }; }
  });
  return { bestCrafts };
};
