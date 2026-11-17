'use strict';

// Path of Exile 1, patch 3.30 (Covens of Umbra): what's new on map items.
//  - Rare-only mods: a few suffixes only roll on rare maps and show in their own colour
//    ("Area contains a Mirage"). The advanced copy heads them "{ Rare-only ... }". They are what a
//    rare map sells on, so price checks search them and the map check shows what each one adds.
//  - Delirium Orbs no longer enchant a map: they reforge a rare map with an explicit
//    "Players in Area are 40% Delirious" mod, with "Delirium Reward Type: Currency" under it. Every
//    20% Delirious is one more reward of that type, up to 100% (5 rewards).
//  - Corrupting a map now adds 2 mods instead of rerolling it into an 8-mod rare, so a map can have 9.
//  - Twice Corrupted (Altar of Corruption, Lapidary Lens, Djinn-Touched Vaal Orbs) replaces the
//    "Corrupted" line.

// the rare-only mods by their text, so a plain Ctrl+C (no "{ Rare-only }" header) knows them too,
// with what each one brings into the map
const RARE_ONLY = [
  [/^Area contains a buried (Pandemonium|Apex|Stalker) Sentinel$/i, (m) => `a buried ${m[1]} Sentinel to dig up`],
  [/^Area contains a Mirage$/i, () => 'a Mirage (Astral monsters, Maraketh uniques)'],
  [/^Area contains the Viridian Wildwood$/i, () => 'the Viridian Wildwood (Wildwood wisps)'],
  [/^Area contains an Evocator of (Beidat|K'Tash|Ghorr)$/i, (m) => `an Evocator of ${m[1]}`],
  [/^Area contains a Mirror of Delirium$/i, () => 'a Mirror of Delirium'],
];
const MAX_MODS = 9; // 3.30: a corrupted map gets 2 more mods, up to 9

const clean = (t) => String(t || '').replace(/\s*\((?:implicit|enchant|crafted|fractured|augmented)\)\s*$/i, '').trim();

// "what it brings" for a rare-only mod's text, or null when it isn't one
function rareOnlyNote(text) {
  const t = clean(text);
  for (const [re, f] of RARE_ONLY) { const m = t.match(re); if (m) return f(m); }
  return null;
}
const isRareOnly = (line) => !!line && (line.rareOnly === true || rareOnlyNote(typeof line === 'string' ? line : line.text) != null);

// the rare-only mods of a map item: [{ text, note }]
function rareOnlyMods(item) {
  const out = [];
  for (const l of (item && item.lines) || []) {
    const text = clean(l.text);
    if (!text || out.some((x) => x.text === text)) continue;
    if (l.rareOnly || rareOnlyNote(text)) out.push({ text, note: rareOnlyNote(text) });
  }
  return out;
}

// a delirious map: { pct, type, extra } where extra is the additional rewards of that type
// (one per 20%), or null when the map isn't delirious
function delirium(item) {
  const raw = String((item && (item.raw || item.listingText)) || '');
  const m = raw.match(/(?:^|\n)\s*Players in Area are (\d+)% Delirious/i);
  if (!m) return null;
  const pct = Math.min(100, Number(m[1]));
  const t = raw.match(/(?:^|\n)\s*Delirium Reward Type:\s*([^\r\n(]+)/i);
  return { pct, type: t ? t[1].trim() : null, extra: Math.floor(pct / 20) };
}

module.exports = { RARE_ONLY, MAX_MODS, rareOnlyNote, isRareOnly, rareOnlyMods, delirium };
