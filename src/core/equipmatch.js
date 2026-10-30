'use strict';

// Is a copied item one of the items you have saved as equipped, maybe changed since (you crafted on
// it)? Then the app saves it as it is now, without you clicking "Set as …" again.
//
// What crafting keeps: the base type and the item level always. A rare keeps its name (exalts,
// chaos orbs, annuls, essences on a rare... none rename it). A normal or magic item gets a new name
// as its mods change (transmute, augment, regal), but keeps the mods it had, apart from one an
// annul or a chaos orb took off. Two different items in your stash can share a base and an item
// level, so for those the old item's mods must still be there too.

const norm = (s) => String(s || '').trim().toLowerCase();
const RANK = { normal: 0, magic: 1, rare: 2, unique: 3 };
const rank = (r) => (norm(r) in RANK ? RANK[norm(r)] : -1);
// the mods that crafting adds or removes (not the base's own properties or the implicit)
const modKeys = (it) => new Set((it.lines || []).filter((l) => l.key && (l.tag === 'explicit' || l.tag === 'fractured' || l.tag === 'crafted' || l.tag === 'desecrated' || l.tag === 'rune')).map((l) => l.key));
const sameLines = (a, b) => JSON.stringify((a.lines || []).map((l) => l.text)) === JSON.stringify((b.lines || []).map((l) => l.text));

// -> true when b is (most likely) the item a, as it is now
function sameItem(a, b) {
  if (!a || !b) return false;
  if (a.itemClass && b.itemClass && norm(a.itemClass) !== norm(b.itemClass)) return false;
  // a magic item's copy doesn't say its base apart from its name ("Hale Lazuli Ring of the Whale"):
  // the other one's base must be in that name; with neither base known, the class has to do
  const ba = norm(a.baseType); const bb = norm(b.baseType);
  const bothMagicish = !ba && !bb;
  if (ba && bb ? ba !== bb : ba ? !norm(b.name).includes(ba) : bb ? !norm(a.name).includes(bb) : !(a.itemClass && b.itemClass)) return false;
  const la = Number(a.itemLevel) || 0; const lb = Number(b.itemLevel) || 0;
  if (la && lb && la !== lb) return false;
  const ra = rank(a.rarity); const rb = rank(b.rarity);
  if (ra < 0 || rb < 0 || rb < ra) return false; // crafting never lowers the rarity
  // uniques: the same unique on the same base, at the same item level
  if (ra === 3 || rb === 3) return ra === rb && norm(a.name) === norm(b.name) && !!la && la === lb;
  // a rare keeps its name
  if (ra === 2) return norm(a.name) === norm(b.name);
  // normal or magic before: the item level and the old mods (all but one at most) must still be there
  if (!la || !lb) return false;
  const was = modKeys(a); const now = modKeys(b);
  let missing = 0;
  for (const k of was) if (!now.has(k)) missing++;
  // two magic items of a class and item level: only when every old mod is still there
  if (bothMagicish) return was.size > 0 && missing === 0;
  return missing <= 1;
}

// the saved slot that holds this item as it was, and whether it changed: { slot, changed } or null
function findSaved(equipped, item) {
  for (const [slot, it] of Object.entries(equipped || {})) {
    if (it && sameItem(it, item)) return { slot, changed: !sameLines(it, item) };
  }
  return null;
}

// "Save as equipped" with one key: which slot an item goes in, without asking. The slot that holds
// this very item (crafted on since), else the item's only slot; rings and charms go in an empty one
// of theirs; a weapon or offhand in the main set (not the swap). null: it can't tell (both rings
// full with other rings, a jewel's socket): the popup asks.
function slotToSave(equipped, item, groups) {
  if (!item || !item.slot) return null;
  const saved = findSaved(equipped, item);
  if (saved) return saved.slot;
  const group = (groups && groups[item.slot]) || [item.slot];
  if (item.slot === 'Weapon' || item.slot === 'Offhand') return group[0];
  if (group.length === 1) return group[0];
  if (item.slot === 'Jewel') return null;
  return group.find((s) => !(equipped || {})[s]) || null;
}

module.exports = { sameItem, findSaved, slotToSave };
