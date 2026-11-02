'use strict';

// Loot filter files (.filter, PoE1 and PoE2): reading them into blocks, finding which block shows an
// item, and the editor's own section at the top of the file.
//
// The editor never rewrites the blocks of the filter you started from (NeverSink, FilterBlade, your
// own): every change is an override block in one section at the very top, between two marker lines,
// and the game uses the first block that matches an item. So the original rules stay as they were,
// an edit can be undone by taking it out, and making the file again from a newer version of the
// filter keeps your edits. The section also carries the edits as one JSON comment line, so the app
// reads them back exactly.

const START = '#============================== PoE Upgrade Checker: your edits ==============================';
const END = '#============================== end of your edits ==============================================';
const DATA = '# poe-upgrade-checker-edits: ';

const ACTIONS = /^(Show|Hide|Minimal)\b/;
// "BaseType == "Divine Orb" "Chaos Orb"" -> { key, op, values }
function parseLine(line) {
  const t = line.replace(/#.*$/, '').trim();
  if (!t) return null;
  const m = t.match(/^(\w+)\s*(==|!=|<=|>=|=|<|>|!)?\s*(.*)$/);
  if (!m) return null;
  const values = [];
  const re = /"([^"]*)"|(\S+)/g;
  let x;
  while ((x = re.exec(m[3] || ''))) values.push(x[1] != null ? x[1] : x[2]);
  return { key: m[1], op: m[2] || null, values };
}

const STYLE_KEYS = new Set(['SetFontSize', 'SetTextColor', 'SetBorderColor', 'SetBackgroundColor', 'PlayAlertSound', 'PlayAlertSoundPositional', 'CustomAlertSound', 'CustomAlertSoundOptional',
  'PlayEffect', 'MinimapIcon', 'DisableDropSound', 'EnableDropSound', 'DisableDropSoundIfAlertSound', 'EnableDropSoundIfAlertSound']);

// text -> { blocks: [{ line, end, action, conds, styles, cont, label }], lines }
// A block runs from its Show / Hide / Minimal line to the next one; the comment lines just above it
// (and one on the same line) name it.
function parse(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const blocks = [];
  let cur = null;
  let comment = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    const a = t.match(ACTIONS);
    if (a) {
      const inline = t.slice(a[1].length).match(/#\s*(.*)$/);
      cur = { line: i, end: i, action: a[1], conds: [], styles: [], cont: false, label: labelOf(inline ? inline[1] : '', comment) };
      blocks.push(cur);
      comment = [];
      continue;
    }
    if (!t) continue;
    if (t.startsWith('#')) { if (t.startsWith(DATA.trim()) || t === START || t === END) continue; const c = t.replace(/^#+\s*/, ''); if (c) comment.push(c); if (comment.length > 4) comment.shift(); continue; }
    if (!cur) continue;
    const p = parseLine(t);
    if (!p) continue;
    if (p.key === 'Continue') cur.cont = true;
    else if (STYLE_KEYS.has(p.key)) cur.styles.push(p);
    else cur.conds.push(p);
    cur.end = i;
    comment = [];
  }
  return { lines, blocks };
}

// a short name for a block: FilterBlade/NeverSink's "$type->currency $tier->t1", or the comment above it
function labelOf(inline, comment) {
  const s = `${inline || ''} ${(comment || []).slice(-1)[0] || ''}`;
  const tier = s.match(/\$tier->(\S+)/); const type = s.match(/\$type->(\S+)/);
  if (tier || type) return `${type ? type[1].replace(/->/g, ' ') : ''}${tier ? ` · ${tier[1]}` : ''}`.trim();
  const c = (inline || '').trim() || (comment || []).slice(-1)[0] || '';
  return c.replace(/[=\-#*[\]]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}

// does one condition hold for the item? undefined: the editor can't tell (a condition it doesn't know)
const cmpNum = (op, a, b) => ({ '<': a < b, '<=': a <= b, '>': a > b, '>=': a >= b, '!=': a !== b, '!': a !== b }[op] ?? a === b);
const RARITY = ['Normal', 'Magic', 'Rare', 'Unique'];
function condHolds(c, item) {
  const op = c.op || '=';
  switch (c.key) {
    case 'BaseType': case 'Class': {
      const v = c.key === 'BaseType' ? item.baseType : item.itemClass;
      if (v == null) return undefined;
      const lv = String(v).toLowerCase();
      const hit = c.values.some((x) => (op === '==' ? lv === x.toLowerCase() : lv.includes(x.toLowerCase())));
      return op === '!=' || op === '!' ? !hit : hit;
    }
    case 'Rarity': {
      if (!item.rarity) return undefined;
      const have = RARITY.indexOf(item.rarity);
      if (/[<>]/.test(op)) return c.values.some((x) => cmpNum(op, have, RARITY.indexOf(x)));
      const hit = c.values.includes(item.rarity);
      return op === '!=' || op === '!' ? !hit : hit;
    }
    case 'ItemLevel': case 'AreaLevel': case 'StackSize': case 'DropLevel': case 'Quality': {
      const v = { ItemLevel: item.itemLevel, AreaLevel: item.areaLevel, StackSize: item.stack || 1, DropLevel: item.dropLevel, Quality: item.quality || 0 }[c.key];
      if (v == null) return undefined;
      return c.values.some((x) => cmpNum(op, Number(v), Number(x)));
    }
    default: return undefined;
  }
}

// the block that decides how an item looks: the first match (Continue blocks add their styles and go
// on). -> { block, index, unsure: [condition keys it couldn't check], styles (with Continue blocks') }
function findBlock(parsed, item) {
  const extra = [];
  for (let i = 0; i < parsed.blocks.length; i++) {
    const b = parsed.blocks[i];
    const unsure = [];
    let ok = true;
    for (const c of b.conds) {
      const h = condHolds(c, item);
      if (h === false) { ok = false; break; }
      if (h === undefined) unsure.push(c.key);
    }
    if (!ok) continue;
    if (b.cont) { extra.push(b); continue; }
    const styles = mergeStyles([...extra, b]);
    return { block: b, index: i, unsure, styles };
  }
  return null;
}
function mergeStyles(blocks) {
  const out = {};
  for (const b of blocks) for (const s of b.styles) out[s.key] = s.values;
  return out;
}

// every BaseType name the filter mentions (exact names), for the editor's item list
function baseTypes(parsed) {
  const set = new Set();
  for (const b of parsed.blocks) for (const c of b.conds) if (c.key === 'BaseType') for (const v of c.values) if (v && v.length > 2) set.add(v);
  return [...set].sort((a, b) => a.localeCompare(b));
}

// the tiers the filter has, as ready-made styles to pick from: blocks that show items with a style,
// named by their label; the same label once
function tiers(parsed) {
  const out = []; const seen = new Set();
  for (const b of parsed.blocks) {
    if (b.action === 'Hide' || !b.styles.length || !b.label) continue;
    const key = b.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: b.label, styles: mergeStyles([b]) });
    if (out.length >= 80) break;
  }
  return out;
}

// what's in each tier: every labelled block of the filter you started from with the base types it names
// (hidden ones as "Hidden: label"), with your edits moved to the tier you gave them. An edit's tier is its
// `tier` (picked from a tier button), "Tier S" etc. for tiers by price, "Hidden by you", or "Your own look".
// -> [{ label, hidden, ours, items: [{ baseType, edited, auto }] }], the filter's own order, ours first
function tierMembers(text, edits) {
  const base = parse(withoutEdits(text));
  const groups = new Map();
  const group = (label, extra) => { const k = label.toLowerCase(); if (!groups.has(k)) groups.set(k, { label, items: [], seen: new Set(), ...extra }); return groups.get(k); };
  for (const t of PRICE_TIERS) group(`Tier ${t.id}`, { ours: true, hidden: false });
  group('Tier D', { ours: true, hidden: false });
  const moved = new Map((edits || []).map((e) => [e.baseType.toLowerCase(), e]));
  for (const b of base.blocks) {
    if (!b.label) continue;
    const names = [];
    for (const c of b.conds) if (c.key === 'BaseType') for (const v of c.values) if (v && v.length > 2) names.push(v);
    if (!names.length) continue;
    const g = group(b.action === 'Hide' ? `Hidden: ${b.label}` : b.label, { ours: false, hidden: b.action === 'Hide' });
    for (const n of names) {
      if (moved.has(n.toLowerCase()) || g.seen.has(n.toLowerCase())) continue;
      g.seen.add(n.toLowerCase()); g.items.push({ baseType: n });
    }
  }
  for (const e of edits || []) {
    const label = e.show === false ? 'Hidden by you' : e.auto ? `Tier ${e.auto}` : e.tier || 'Your own look';
    const g = group(label, { ours: !!e.auto || /^Tier [SABCD]$/.test(label) || label === 'Hidden by you' || label === 'Your own look', hidden: e.show === false });
    if (g.seen.has(e.baseType.toLowerCase())) continue;
    g.seen.add(e.baseType.toLowerCase());
    g.items.push({ baseType: e.baseType, edited: true, auto: e.auto || null });
  }
  return [...groups.values()].filter((g) => g.items.length).map(({ seen, ...g }) => ({ ...g, items: g.items.sort((a, b) => a.baseType.localeCompare(b.baseType)) }));
}

// ---------- the editor's section ----------
// edits: [{ baseType, show: true|false, style: { SetFontSize: ["45"], SetTextColor: [...], ... } | null, note }]
function readEdits(text) {
  const s = String(text || '');
  const i = s.indexOf(START);
  if (i < 0) return [];
  const j = s.indexOf(DATA, i);
  const k = s.indexOf(END, i);
  if (j < 0 || (k >= 0 && j > k)) return [];
  const line = s.slice(j + DATA.length, s.indexOf('\n', j) < 0 ? undefined : s.indexOf('\n', j)).trim();
  try { const a = JSON.parse(line); return Array.isArray(a) ? a.filter((e) => e && typeof e.baseType === 'string') : []; } catch (_) { return []; }
}
// the filter without the editor's section (the part you started from)
function withoutEdits(text) {
  const s = String(text || '');
  const i = s.indexOf(START);
  if (i < 0) return s;
  const k = s.indexOf(END, i);
  if (k < 0) return s;
  const after = s.indexOf('\n', k);
  return (s.slice(0, i) + (after < 0 ? '' : s.slice(after + 1))).replace(/^\n+/, '');
}
const qv = (v) => (/^-?\d+$/.test(v) || /^[A-Z][a-z]+$/.test(v) && !/\s/.test(v) ? v : `"${String(v).replace(/"/g, '')}"`);
function styleLines(style) {
  const out = [];
  for (const [k, vals] of Object.entries(style || {})) {
    if (!STYLE_KEYS.has(k) || !Array.isArray(vals)) continue;
    const v = vals.map((x) => String(x).replace(/[\r\n"]/g, '')).filter((x) => x !== '');
    if (k === 'CustomAlertSound' || k === 'CustomAlertSoundOptional') out.push(`\t${k} "${v[0] || ''}"${v[1] ? ` ${v[1]}` : ''}`);
    else out.push(`\t${k}${v.length ? ' ' + v.join(' ') : ''}`);
  }
  return out;
}
function section(edits) {
  const list = (edits || []).filter((e) => e && e.baseType);
  if (!list.length) return '';
  const lines = [START, '# Made with PoE Upgrade Checker (poe2upgrade.com). Each block below overrides your filter for one item;', '# the rest of the file is your filter as it was.', DATA + JSON.stringify(list)];
  for (const e of list) {
    lines.push('');
    lines.push(`${e.show === false ? 'Hide' : 'Show'} # ${String(e.note || 'your edit').replace(/[\r\n]/g, ' ').slice(0, 60)}`);
    lines.push(`\tBaseType == ${qv(e.baseType)}`);
    if (e.rarity) lines.push(`\tRarity ${e.rarity}`);
    if (e.show !== false) lines.push(...styleLines(e.style));
  }
  lines.push(END, '');
  return lines.join('\n');
}
// the whole file with these edits on top of the filter you started from
function apply(text, edits) {
  const base = withoutEdits(text);
  const sec = section(edits);
  return sec ? `${sec}\n${base}` : base;
}
// one edit in the list: added, replaced (same base type) or taken out (edit null)
function setEdit(edits, baseType, edit) {
  const rest = (edits || []).filter((e) => e.baseType.toLowerCase() !== String(baseType).toLowerCase());
  return edit ? [{ ...edit, baseType }, ...rest] : rest;
}

// ---------- automatic tiers from today's prices ----------
// prices: [{ name, div }] (poe.ninja, in divines). Each item goes in the first tier its price reaches.
const PRICE_TIERS = [
  { id: 'S', min: 1, note: 'worth 1 divine or more', style: { SetFontSize: ['45'], SetTextColor: ['255', '0', '0', '255'], SetBorderColor: ['255', '0', '0', '255'], SetBackgroundColor: ['255', '255', '255', '255'], PlayAlertSound: ['6', '300'], PlayEffect: ['Red'], MinimapIcon: ['0', 'Red', 'Star'] } },
  { id: 'A', min: 0.2, note: 'worth 0.2 divine or more', style: { SetFontSize: ['45'], SetTextColor: ['255', '255', '255', '255'], SetBorderColor: ['255', '255', '255', '255'], SetBackgroundColor: ['240', '90', '80', '255'], PlayAlertSound: ['1', '300'], PlayEffect: ['Orange'], MinimapIcon: ['0', 'Orange', 'Circle'] } },
  { id: 'B', min: 0.05, note: 'worth 0.05 divine or more', style: { SetFontSize: ['42'], SetTextColor: ['0', '0', '0', '255'], SetBorderColor: ['0', '0', '0', '255'], SetBackgroundColor: ['250', '170', '90', '255'], PlayAlertSound: ['2', '250'], PlayEffect: ['Yellow'], MinimapIcon: ['1', 'Yellow', 'Circle'] } },
  { id: 'C', min: 0.01, note: 'worth 0.01 divine or more', style: { SetFontSize: ['38'], SetTextColor: ['255', '210', '160', '255'], SetBorderColor: ['200', '150', '100', '255'], SetBackgroundColor: ['40', '25', '15', '230'] } },
];
// -> edits for every priced item (an item you edited by hand keeps your edit)
function priceEdits(prices, own = []) {
  const mine = new Set((own || []).filter((e) => !e.auto).map((e) => e.baseType.toLowerCase()));
  const out = [];
  for (const p of prices || []) {
    if (!p || !p.name || !(p.div > 0) || mine.has(p.name.toLowerCase())) continue;
    const t = PRICE_TIERS.find((x) => p.div >= x.min);
    if (!t) continue;
    out.push({ baseType: p.name, show: true, style: t.style, auto: t.id, note: `Tier ${t.id} by today's price (${t.note})` });
  }
  // the dearest first, so the section reads top to bottom
  const order = (e) => PRICE_TIERS.findIndex((t) => t.id === e.auto);
  return out.sort((a, b) => order(a) - order(b));
}

module.exports = { START, END, tierMembers, parse, parseLine, findBlock, baseTypes, tiers, readEdits, withoutEdits, section, apply, setEdit, styleLines, priceEdits, PRICE_TIERS, condHolds };
