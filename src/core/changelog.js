'use strict';

// "What's new": the release notes of a version, read from CHANGELOG.md (bundled with the app).
// A section starts "## 0.5.3 - 2026-10-30" (or "## Unreleased", which a beta's notes are); each entry
// is a "- **Title:** text" line. Markdown is reduced to plain text with the title kept apart.

function sections(md) {
  const out = [];
  let cur = null;
  for (const line of String(md || '').split(/\r?\n/)) {
    const h = line.match(/^##\s+(Unreleased|\d+\.\d+\.\d+(?:-[\w.]+)?)(?:\s+-\s+(\S+))?\s*$/i);
    if (h) { cur = { version: /^unreleased$/i.test(h[1]) ? 'unreleased' : h[1], date: h[2] || null, entries: [] }; out.push(cur); continue; }
    if (/^#\s/.test(line)) { cur = null; continue; }
    if (!cur) continue;
    const e = line.match(/^-\s+(.*)$/);
    if (e) cur.entries.push(entry(e[1]));
  }
  return out;
}

const plain = (s) => String(s || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/`([^`]+)`/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();

function entry(text) {
  const m = String(text).match(/^\*\*(.+?)\*\*\s*(.*)$/);
  if (!m) return { title: null, text: plain(text) };
  return { title: plain(m[1]).replace(/:$/, ''), text: plain(m[2]) };
}

// a version's notes: its own section, or Unreleased for a beta of the next version (0.5.4-beta.1)
function notesFor(md, version) {
  const all = sections(md);
  const v = String(version || '');
  const exact = all.find((s) => s.version === v);
  if (exact) return exact;
  if (/-/.test(v)) { const u = all.find((s) => s.version === 'unreleased'); if (u) return { ...u, version: v }; }
  return null;
}

// compare two versions ("0.5.10" > "0.5.9"; a beta of a version is older than the version)
function cmp(a, b) {
  const p = (v) => { const [main, pre] = String(v || '0').split('-'); return { n: main.split('.').map((x) => Number(x) || 0), pre: pre || null }; };
  const x = p(a); const y = p(b);
  for (let i = 0; i < 3; i++) if ((x.n[i] || 0) !== (y.n[i] || 0)) return (x.n[i] || 0) - (y.n[i] || 0);
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

// the notes to show after an update: every version newer than the one you last saw, up to this one
function since(md, seen, current) {
  const all = sections(md).filter((s) => s.version !== 'unreleased' && cmp(s.version, seen) > 0 && cmp(s.version, current) <= 0);
  const own = notesFor(md, current);
  if (own && !all.some((s) => s.version === own.version)) all.unshift(own);
  return all;
}

module.exports = { sections, notesFor, since, cmp };
