#!/usr/bin/env node
'use strict';
// Summarises a League start run from route-run.jsonl (next to the app's log, written while
// "Follow my zones" is on): how long each act took, every place the route needed a hand, and the
// zones it didn't know.
//   node tools/route-report.js [path/to/route-run.jsonl] [--all] [--since 2026-11-13]
//   --all: every zone line, not just the ones that matter
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--since') || path.join(process.env.APPDATA || '', 'PoE2 Upgrade Checker', 'route-run.jsonl');
const since = args.includes('--since') ? args[args.indexOf('--since') + 1] : null;
const all = args.includes('--all');
const lines = [];
for (const f of [file.replace(/\.jsonl$/, '.1.jsonl'), file]) { try { lines.push(...fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)); } catch (_) { /* none */ } }
let ev = lines.map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
if (since) ev = ev.filter((e) => e.at >= since);
// from the last "start over" on: one character's run
const lastReset = ev.map((e) => e.ev).lastIndexOf('reset');
if (lastReset >= 0 && !since) ev = ev.slice(lastReset);
if (!ev.length) { console.log(`Nothing in ${file}${since ? ` since ${since}` : ''}.`); process.exit(0); }

const t = (e) => e.at.slice(11, 19);
const mins = (ms) => (ms == null ? '-' : ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60000)}m`);
const step = (s) => (s ? `${s.act || ''} #${s.n || ''} "${s.t}"` : '?');

console.log(`Route run: ${ev[0].at} → ${ev[ev.length - 1].at} (${ev.length} events, ${ev[0].game})`);
const areas = ev.filter((e) => e.ev === 'area');
const byWhy = {};
for (const a of areas) { const k = a.ignored ? 'other character' : a.why; byWhy[k] = (byWhy[k] || 0) + 1; }
console.log(`Zones entered: ${areas.length}  (${Object.entries(byWhy).map(([k, v]) => `${k} ${v}`).join(', ')})`);
const lastChar = (ev.filter((e) => e.ev === 'level').pop() || {}).character;
const levels = ev.filter((e) => e.ev === 'level' && e.character === lastChar);
if (levels.length) console.log(`Character: ${levels[levels.length - 1].character} (${levels[levels.length - 1].className}), level ${levels[0].level} → ${levels[levels.length - 1].level}`);

// time per act: from the first zone in it to the first zone of the next
const actTimes = []; let cur = null;
for (const a of areas) {
  const act = (a.to || a.from || {}).act;
  if (act && (!cur || cur.act !== act)) { if (cur) cur.end = a.at; cur = { act, start: a.at, lvlIn: a.charLevel }; actTimes.push(cur); }
}
if (cur) cur.end = ev[ev.length - 1].at;
if (actTimes.length) {
  console.log('\nTime per act (from its first zone):');
  for (const x of actTimes) console.log(`  ${x.act.padEnd(14)} ${mins(Date.parse(x.end) - Date.parse(x.start)).padStart(5)}  (char level at start ${x.lvlIn || '?'})`);
}

// the places it went wrong
console.log('\nWhere the route needed a hand:');
let issues = 0;
for (let i = 0; i < ev.length; i++) {
  const e = ev[i];
  if (e.ev !== 'manual') continue;
  issues++;
  // what the route last did on its own
  const prev = [...ev.slice(0, i)].reverse().find((x) => x.ev === 'area');
  const autoMoved = prev && prev.moved && prev.moved > 0;
  const kind = e.how === 'back' ? (autoMoved ? 'MOVED TOO FAR? (Back right after it moved by itself)' : 'back')
    : e.how === 'next' ? 'didn\'t move by itself (Step done)' : `jumped ${e.moved > 0 ? 'ahead' : 'back'} ${Math.abs(e.moved)} steps`;
  console.log(`  ${t(e)} ${e.source || e.how}: ${kind}`);
  console.log(`      from ${step(e.from)}`);
  console.log(`      to   ${step(e.to)}  [in area ${e.area || '?'}, ${mins(e.sinceArea)} after entering it]`);
  if (prev) console.log(`      last zone line: ${prev.area} (${prev.why}${prev.moved ? `, moved ${prev.moved}` : ''})`);
}
if (!issues) console.log('  none: every step moved by itself');

// zones the route didn't know, or knew only elsewhere
const odd = areas.filter((a) => !a.ignored && ['not-ahead', 'known-elsewhere'].includes(a.why) && !a.town);
if (odd.length) {
  console.log('\nZones not on the route ahead (the route stayed where it was):');
  const seen = new Map();
  for (const a of odd) { const k = a.area; seen.set(k, { n: (seen.get(k) || { n: 0 }).n + 1, a }); }
  for (const [k, { n, a }] of seen) console.log(`  ${k.padEnd(16)} ×${n}  ${a.why === 'known-elsewhere' ? `on the route at ${step(a.matched)}` : 'not on the route at all'}  (while on ${step(a.from)})`);
}
const big = areas.filter((a) => a.moved > 8);
if (big.length) {
  console.log('\nBig jumps forward (more than 8 steps at once):');
  for (const a of big) console.log(`  ${t(a)} ${a.area} (${a.why}) moved ${a.moved}: ${step(a.from)} → ${step(a.to)}`);
}
// who was playing: every switch between the route's character and another one, and the areas left alone
const sess = ev.filter((e) => e.ev === 'session' || e.ev === 'character');
if (sess.length) {
  console.log('\nWho was playing (the route moves only for its own character):');
  for (const e of sess) {
    if (e.ev === 'character') console.log(`  ${t(e)} route character: ${e.character}${e.className ? ` (${e.className}${e.level ? `, level ${e.level}` : ''})` : ''} (${e.how})`);
    else console.log(`  ${t(e)} ${e.who === 'owner' ? `playing ${e.character || 'the route character'}` : e.who === 'other' ? `another character${e.name ? `: ${e.name}` : ''}${e.area ? ` in ${e.area}${e.areaLevel ? ` (level ${e.areaLevel})` : ''}` : ''}` : 'not sure who'}  [${e.by}${e.why ? `: ${e.why}` : ''}]`);
  }
  const ign = areas.filter((a) => a.ignored);
  if (ign.length) console.log(`  ${ign.length} areas entered by another character (or before it was sure) were left alone`);
}
const other = ev.filter((e) => ['log-missing', 'log-restarted', 'hotkey-failed', 'game', 'follow', 'log-picked'].includes(e.ev));
if (other.length) {
  console.log('\nOther events:');
  for (const e of other) console.log(`  ${t(e)} ${e.ev} ${JSON.stringify({ ...e, at: undefined, ev: undefined, game: undefined })}`);
}
if (all) {
  console.log('\nEvery zone line:');
  for (const a of areas) console.log(`  ${t(a)} ${a.area.padEnd(14)} lvl ${String(a.areaLevel).padEnd(3)} ${(a.ignored ? 'other char' : a.why || '').padEnd(15)} ${a.moved ? `+${a.moved}` : '  '} ${step(a.to || a.from)}  (${mins(a.msInPrev)} in the previous zone)`);
}
