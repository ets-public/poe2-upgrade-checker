'use strict';

// Search string builder: turns "pack size at least 30, no reflect, any item with 25% movement speed"
// into the text you paste into the game's search box (stash, vendor, map device), and tests a string
// against an item's text the way the game reads it.
//
// How the game reads the search box (PoE1 and PoE2 alike):
//  - case doesn't matter; it searches the item's whole text: name, properties ("Item Rarity: +40%",
//    "Waystone Tier: 15", "Item Level: 84") and every mod line
//  - each "quoted group" (or bare word) must match: groups are ANDed
//  - inside a group it's a regex: | is OR, . [3-9] ( ) + \d ^ $ work; \+ is a plain +
//  - a group starting with ! must NOT match (the whole group: "!a|b" is neither a nor b)
//  - the box takes 250 characters (PoE2 took about 50 until 0.2)
// Numbers are only text to it, so "at least 42" is spelled digit by digit: 4[2-9]|[5-9]\d|\d\d\d.

const LIMIT = 250;

const RX_SPECIAL = /[.*+?^${}()|[\]\\]/g;
const escapeRx = (s) => String(s).replace(RX_SPECIAL, '\\$&');

// one digit class: [5-9], [89], 9
function digitClass(lo, hi) {
  if (lo > hi) return null;
  if (lo === hi) return String(lo);
  if (lo === 0 && hi === 9) return '\\d';
  if (hi - lo === 1) return `[${lo}${hi}]`;
  return `[${lo}-${hi}]`;
}

// a regex for any whole number >= n. Matching part of a bigger number is fine: any run of digits
// inside a number is never more than the number itself, so a hit always means the value is >= n.
function atLeast(n) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n) || n <= 0) return '\\d';
  const s = String(n); const k = s.length;
  const D = (c) => '\\d'.repeat(c);
  // j: the last digit that isn't followed only by zeros (42 -> 1, 40 -> 0): from there on "this digit
  // or more, then anything" covers n and everything above it with the same length
  let j = k - 1;
  while (j > 0 && /^0*$/.test(s.slice(j))) j--;
  const alts = [s.slice(0, j) + digitClass(Number(s[j]), 9) + D(k - 1 - j)];
  for (let i = j - 1; i >= 0; i--) {
    const cls = digitClass(Number(s[i]) + 1, 9);
    if (cls) alts.push(s.slice(0, i) + cls + D(k - 1 - i));
  }
  // one digit more is always enough (needed even for 10 or 100: "#%" templates match the number's end)
  alts.push(D(k + 1));
  return alts.length === 1 ? alts[0] : `(${alts.join('|')})`;
}

// a regex for whole numbers <= n. Only used right after a property's label (which pins where the
// number starts), with `end` pinning where it stops (% or the end of the line), since 120 must not
// count as 12. For "tier at most 15".
function atMost(n, end) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n) || n < 0) return null;
  const s = String(n); const k = s.length;
  const alts = [];
  for (let L = 1; L < k; L++) alts.push(L === 1 ? '\\d' : '[1-9]' + '\\d'.repeat(L - 1));
  for (let i = 0; i < k; i++) {
    const d = Number(s[i]);
    const lo = i === 0 && k > 1 ? 1 : 0;
    const hi = i === k - 1 ? d : d - 1;
    const cls = digitClass(lo, hi);
    if (cls) alts.push(s.slice(0, i) + cls + '\\d'.repeat(k - 1 - i));
  }
  const body = alts.length === 1 ? alts[0] : `(${alts.join('|')})`;
  return body + (end == null ? '$' : end);
}

// a template with # for the number ("#% increased movement speed", "item level: #") and the least
// it may be -> regex. Without a # it's plain text.
function numberRule(template, min) {
  const t = String(template || '').trim();
  if (!t) return null;
  const parts = t.toLowerCase().split('#').map(escapeRx);
  if (parts.length < 2) return parts[0];
  return parts[0] + atLeast(min) + parts.slice(1).join('\\d+');
}

// ---------- properties of maps and waystones (what the item shows above its mods) ----------
// fragment: the end of the property's label, enough to tell it apart from the item's other lines
// (case doesn't matter; "\\+" is the plain plus before the number)
const PROPS = {
  poe2: [
    { id: 'tier', label: 'Waystone tier', frag: 'tier: ', unit: '' },
    { id: 'rarity', label: 'Item rarity', frag: 'm rarity: \\+', unit: '%' },
    { id: 'pack', label: 'Monster pack size', frag: 'ck size: \\+', unit: '%' },
    { id: 'magic', label: 'Magic monsters', frag: 'gic monsters: \\+', unit: '%' },
    { id: 'rare', label: 'Rare monsters', frag: 'are monsters: \\+', unit: '%' },
    { id: 'drop', label: 'Waystone drop chance', frag: 'drop chance: \\+', unit: '%' },
    { id: 'quant', label: 'Item quantity', frag: 'tity: \\+', unit: '%' },
  ],
  // 3.30: Item Quantity on maps became Atlas Drops, and Scarabs became Threads; either wording matches
  poe1: [
    { id: 'tier', label: 'Map tier', frag: 'tier: ', unit: '' },
    { id: 'quant', label: 'Atlas drops (item quantity)', frag: '(tity|drops): \\+', unit: '%' },
    { id: 'rarity', label: 'Item rarity', frag: 'm rarity: \\+', unit: '%' },
    { id: 'pack', label: 'Monster pack size', frag: 'ck size: \\+', unit: '%' },
    { id: 'currency', label: 'More currency', frag: 'currency: \\+', unit: '%' },
    { id: 'maps', label: 'More maps', frag: 'maps: \\+', unit: '%' },
    { id: 'scarabs', label: 'More threads (scarabs)', frag: '(scarab|thread)s: \\+', unit: '%' },
    { id: 'divcards', label: 'More divination cards', frag: 'cards: \\+', unit: '%' },
    { id: 'quality', label: 'Quality', frag: 'quality: \\+', unit: '%' },
  ],
};

// flags: yes / no / either. text is matched as it is in the item
const FLAGS = {
  poe2: [
    { id: 'corrupted', label: 'Corrupted', rx: 'corrupted' },
    { id: 'delirious', label: 'Delirious', rx: 'delirious' },
    { id: 'norevive', label: 'No revives', rx: 'revives available: 0' },
    { id: 'unid', label: 'Unidentified', rx: 'unidentified' },
  ],
  poe1: [
    { id: 'corrupted', label: 'Corrupted', rx: 'corrupted' },
    { id: 'delirious', label: 'Delirious', rx: 'delirious' },
    { id: 'unid', label: 'Unidentified', rx: 'unidentified' },
    { id: 'originator', label: 'Originator (8 mods)', rx: 'originator' },
  ],
};

// ---------- mod text to the shortest fragment that picks it out ----------
const norm = (t) => String(t || '').toLowerCase().replace(/[+-]?\d+(\.\d+)?/g, '#').replace(/\s+/g, ' ').trim();
// the pieces of a mod's text a fragment may come from: letters, spaces, apostrophes and commas
// (numbers change from item to item, so no fragment goes across one)
const pieces = (t) => norm(t).split(/[^a-z ',]+/).map((x) => x.trim()).filter((x) => x.length >= 3);

// shortest piece of `text` that is in none of `others`. The game's mod pool is bigger than any list
// we keep, so a fragment starts at the beginning of a word and is at least 5 letters ("reflect" style,
// not "d cr") when it can be; only when no such piece exists is any position allowed.
// Returns null when every piece is in another mod too.
function shortestUnique(text, others, minLen = 5) {
  const os = (others || []).map(norm);
  const ps = pieces(text);
  const maxLen = Math.max(0, ...ps.map((p) => p.length));
  for (const wordStart of [true, false]) {
    for (let L = Math.min(minLen, maxLen); L <= maxLen; L++) {
      for (const p of ps) {
        for (let i = 0; i + L <= p.length; i++) {
          if (wordStart && i > 0 && p[i - 1] !== ' ') continue;
          const sub = p.slice(i, i + L);
          if (sub[0] === ' ' || sub[L - 1] === ' ') continue; // a space at either end is easy to lose
          if (!os.some((o) => o.includes(sub))) return sub;
        }
      }
    }
  }
  return null;
}

// fragments for several mods that should be ORed: each picked mod gets the shortest fragment that
// matches no mod left unpicked; a fragment that happens to cover another picked mod covers it too.
// all: every mod we know (picked or not). Returns { parts: [{ frag, mods }], clash: [mod] }
function fragmentsFor(picked, all) {
  const pickedN = [...new Set((picked || []).map(norm))].filter(Boolean);
  const others = [...new Set((all || []).map(norm))].filter((m) => m && !pickedN.includes(m));
  const parts = []; const clash = [];
  const covered = new Set();
  // longer texts first: they have the most room to find something short
  for (const m of [...pickedN].sort((a, b) => a.length - b.length)) {
    if (covered.has(m)) continue;
    const frag = shortestUnique(m, others);
    if (!frag) {
      // nothing in it that no other mod has: use its longest piece and say what else it catches
      const p = pieces(m).sort((a, b) => b.length - a.length)[0] || m;
      clash.push(m);
      parts.push({ frag: p, mods: [m] });
      covered.add(m);
      continue;
    }
    const mods = pickedN.filter((x) => x.includes(frag));
    for (const x of mods) covered.add(x);
    parts.push({ frag, mods });
  }
  return { parts, clash };
}

// ---------- putting a search together ----------
// a group: { any: [regex, ...], not: bool } -> "!a|b"
function groupText(g) {
  const alts = [...new Set((g.any || []).filter(Boolean))];
  if (!alts.length) return '';
  return `"${g.not ? '!' : ''}${alts.join('|')}"`;
}
const joinGroups = (groups) => groups.map(groupText).filter(Boolean).join(' ');

// maps and waystones. spec: {
//   game, mins: { pack: 30, rarity: 50, ... }, maxs: { tier: 15 }, anyProp: bool (one of the minimums is enough),
//   avoid: [mod text], want: [mod text], wantAll: bool, flags: { corrupted: 'yes'|'no' }, extra: 'raw text'
// }, knownMods: every mod we know for that game (picked or not), for the fragments
function buildMap(spec, knownMods) {
  const s = spec || {};
  const game = s.game === 'poe1' ? 'poe1' : 'poe2';
  const props = PROPS[game];
  const groups = []; const notes = [];
  const propAlts = [];
  for (const p of props) {
    const min = s.mins && s.mins[p.id];
    const max = s.maxs && s.maxs[p.id];
    const hasMin = min !== undefined && min !== null && min !== '' && Number(min) > 0;
    const hasMax = max !== undefined && max !== null && max !== '';
    if (hasMin) propAlts.push(p.frag + atLeast(min));
    if (hasMax) groups.push({ any: [p.frag + atMost(max, p.unit || '$')] });
  }
  if (propAlts.length) {
    if (s.anyProp) groups.push({ any: propAlts });
    else for (const a of propAlts) groups.push({ any: [a] });
  }
  for (const f of FLAGS[game]) {
    const v = s.flags && s.flags[f.id];
    if (v === 'yes') groups.push({ any: [f.rx] });
    else if (v === 'no') groups.push({ any: [f.rx], not: true });
  }
  // a fragment must miss the item's other lines too: its properties and the game's help text
  const boiler = [...props.map((p) => `${p.label}: +#%`), 'Item Class: Waystones', 'Item Class: Maps', 'Rarity: Rare', 'Rarity: Magic',
    'Travel to this Map by using it in a personal Map Device. Maps can only be used once.', 'Can be used in a Map Device, allowing you to enter a Map. Waystones can only be used once.',
    'Revives Available: #', 'Item Level: #', 'Monster Level: #', 'Delirious', 'Corrupted', 'Unidentified'];
  const all = [...(knownMods || []), ...boiler, ...(s.avoid || []), ...(s.want || [])];
  if (s.avoid && s.avoid.length) {
    const r = fragmentsFor(s.avoid, all);
    groups.push({ any: r.parts.map((x) => escapeRx(x.frag)), not: true });
    if (r.clash.length) notes.push(`Also hides other mods sharing their words: ${r.clash.join('; ')}`);
  }
  if (s.want && s.want.length) {
    const r = fragmentsFor(s.want, all);
    if (s.wantAll) for (const x of r.parts) groups.push({ any: [escapeRx(x.frag)] });
    else groups.push({ any: r.parts.map((x) => escapeRx(x.frag)) });
    if (r.clash.length) notes.push(`Also lights up other mods sharing their words: ${r.clash.join('; ')}`);
  }
  if (s.extra && String(s.extra).trim()) groups.push({ raw: String(s.extra).trim() });
  return finish(groups, notes);
}

// any item: rows of { kind: 'num', template: '#% increased movement speed', min, not } |
// { kind: 'text', text: 'crossbow', not: bool } | { kind: 'raw', text: '...' }; mode: 'all' (every row) or 'any'
function buildItem(spec) {
  const s = spec || {};
  const notes = [];
  const pos = []; const neg = [];
  for (const r of s.rows || []) {
    if (!r) continue;
    let rx = null;
    if (r.kind === 'num') rx = numberRule(r.template, r.min);
    else if (r.kind === 'text') rx = String(r.text || '').trim() ? escapeRx(String(r.text).trim().toLowerCase()) : null;
    else if (r.kind === 'raw') rx = String(r.text || '').trim() || null;
    if (!rx) continue;
    (r.not ? neg : pos).push(rx);
  }
  const groups = [];
  if (pos.length) {
    if (s.mode === 'any') groups.push({ any: pos });
    else for (const p of pos) groups.push({ any: [p] });
  }
  if (neg.length) groups.push({ any: neg, not: true });
  return finish(groups, notes);
}

function finish(groups, notes) {
  const texts = groups.map((g) => (g.raw != null ? g.raw : groupText(g))).filter(Boolean);
  const text = texts.join(' ');
  const out = { text, length: text.length, limit: LIMIT, over: text.length > LIMIT, groups: texts.length, notes };
  if (out.over) out.notes = [...notes, `${text.length - LIMIT} characters over the game's ${LIMIT}: untick something, or split it into two searches.`];
  return out;
}

// ---------- reading a search the way the game does ----------
// '"a|b" "!c" word' -> [{ rx: 'a|b', not: false }, { rx: 'c', not: true }, { rx: 'word', not: false }]
function parse(query) {
  const q = String(query || '');
  const out = [];
  const re = /"([^"]*)"?|(\S+)/g;
  let m;
  while ((m = re.exec(q))) {
    let t = m[1] != null ? m[1] : m[2];
    if (!t) continue;
    let not = false;
    if (t.startsWith('!')) { not = true; t = t.slice(1); }
    if (t) out.push({ rx: t, not });
  }
  return out;
}

// does an item (its text, as Ctrl+C copies it) light up for this search?
// -> { ok: bool, groups: [{ rx, not, hit, line, error }] }
function test(query, itemText) {
  const text = String(itemText || '').replace(/\r\n?/g, '\n');
  const gs = parse(query).map((g) => {
    let re;
    try { re = new RegExp(g.rx, 'im'); } catch (err) { return { ...g, hit: false, error: 'not a valid search: ' + err.message }; }
    const hitLine = text.split('\n').find((l) => re.test(l));
    const hit = hitLine != null || re.test(text);
    return { ...g, hit, line: hitLine || null };
  });
  const ok = gs.length > 0 && gs.every((g) => !g.error && (g.not ? !g.hit : g.hit));
  return { ok, groups: gs };
}

module.exports = { LIMIT, PROPS, FLAGS, escapeRx, atLeast, atMost, numberRule, norm, shortestUnique, fragmentsFor, buildMap, buildItem, parse, test };
