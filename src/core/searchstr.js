'use strict';

// Search strings to paste into the game's search box (stash, vendor, map device).
// The game matches text case-insensitively; inside quotes "a|b" means a OR b and a leading ! means NOT.
// The box takes 250 characters in both games (PoE2's took about 50 before 0.2), and each mod still
// becomes the shortest distinctive word we can find, so there's room for your own words too.

const LIMIT = 250;

// words that are on too many mods to tell one apart from another
const COMMON = new Set(('monsters monster players player have has area damage of the a an and or to in by with are is be '
  + 'increased reduced more less additional chance maximum minimum you your their its per for as on from take taken '
  + 'skills skill deal dealt rare unique magic map maps cannot can not all life mana energy shield elemental physical fire cold lightning chaos').split(' '));

// the most distinctive word of a mod (its key from mapcheck.keyOf, or the mod text): the longest word that
// isn't on lots of other mods, cut to 7 letters (any part of a word still matches)
function fragment(text) {
  const words = String(text || '').toLowerCase().replace(/[#\d%+\-.,'()]+/g, ' ').split(/\s+/).filter(Boolean);
  const good = words.filter((w) => w.length >= 4 && !COMMON.has(w));
  const pick = (good.length ? good : words.filter((w) => w.length >= 4)).sort((a, b) => b.length - a.length)[0];
  return pick ? pick.slice(0, 7) : null;
}

// join fragments into one quoted search, as many as fit; returns { text, used, left }
function build(parts, not) {
  const uniq = [...new Set(parts.filter(Boolean))];
  const used = []; const left = [];
  const wrap = (list) => `"${not ? '!' : ''}${list.join('|')}"`;
  for (const p of uniq) {
    if (wrap([...used, p]).length <= LIMIT) used.push(p); else left.push(p);
  }
  return { text: used.length ? wrap(used) : '', used, left, length: used.length ? wrap(used).length : 0 };
}

// maps / waystones without any of these mods (your DANGER marks, plus mods passed in)
function mapAvoid(keys) {
  return build((keys || []).map(fragment), true);
}

// vendor / stash: things worth picking up. opts: { move, life, res: ['fire', 'cold', ...], gems, links (PoE1) }
const RES_WORD = { fire: 'fire res', cold: 'cold res', lightning: 'lightning res', chaos: 'chaos res' };
function vendor(opts) {
  const o = opts || {};
  const parts = [];
  if (o.links && o.game === 'poe1') parts.push('-\\w-.-'); // three linked sockets (good while levelling)
  if (o.move) parts.push('movement sp');
  for (const r of o.res || []) if (RES_WORD[r]) parts.push(RES_WORD[r]);
  if (o.life) parts.push('maximum life');
  if (o.gems) parts.push('level of all');
  return build(parts, false);
}

module.exports = { LIMIT, fragment, mapAvoid, vendor, build };
