'use strict';

// League start: the campaign route for each game (src/data/routes/*.json) and how it follows you.
//
// A route is a list of acts, each a list of steps. A step can name an area:
//   to: entering that area finishes the step ("➞ The Coast": you're there, the next step is current)
//   in: the step happens in that area (entering it makes that step the current one)
// The game writes every area it loads to its log (Client.txt), as
//   Generating level 12 area "1_1_7_1" with seed 123
// with the area's id, the same in every language. That line is all the route reads to move on:
// the next step (looking ahead a little) that names the area you entered becomes current, and the
// steps before it count as done. Towns are visited all the time (to sell, after dying), so entering
// a town only moves on when it's the next area on the route, and going back into the zone you're
// working in keeps you on your step.

const fs = require('fs');
const path = require('path');

const ROUTES = path.join(__dirname, '..', 'data', 'routes');
const cache = {};
function load(game) {
  const g = game === 'poe1' ? 'poe1' : 'poe2';
  if (!cache[g]) cache[g] = JSON.parse(fs.readFileSync(path.join(ROUTES, `${g}.json`), 'utf8'));
  return cache[g];
}

// every step in order, with its act and the area you're in while doing it (zone):
// [{ act, actName, i (in act), zone, ...step }]
function flatten(route) {
  const out = [];
  let zone = null;
  (route.acts || []).forEach((a, ai) => (a.steps || []).forEach((s, i) => {
    if (s.in) zone = s.in;
    out.push({ ...s, act: ai, actName: a.name, i, zone });
    if (s.to) zone = s.to; // you're there for the steps after it
    else if (TO_TOWN.test(s.t || '')) zone = TOWN; // "Log out (back to town)": the steps after it are in town
  }));
  return out;
}

const norm = (id) => String(id || '').trim().toLowerCase();
const TOWN = 'town'; // the zone of the steps after a log-out (which town isn't named)
const TO_TOWN = /^Log out|portal to town|^Take the portal$/i;
function isTown(route, id) {
  const x = norm(id);
  if (!x) return false;
  if ((route.towns || []).some((t) => norm(t) === x)) return true;
  return /(^|_)town$|_endgame_town$|hideout/.test(x);
}

// the lines the route reads from the game's log
// (right after the line's [DEBUG Client …] / [INFO Client …] tag: chat lines start "] @From", "] #"…,
// so a message that says "Generating level" or "is now level" can't move the route)
const GENERATING = /\] Generating level (\d+) area "([^"]+)"/;
const LEVEL_UP = /\] : (\S+) \(([^)]+)\) is now level (\d+)/;
// Who is playing. The log never names the character you log in with: it says when the game starts,
// when it connects to the login server (logging in, or back from the character list) and when it's
// disconnected; it names your character only when it levels up, gets a quest reward or dies.
const LOG_OPEN = /\*{5} LOG FILE OPENING \*{5}/;
const LOGIN = /\] (?:Async connecting to \S*login\S*|Connected to \S*login\S* in )/i;
const DISCONNECT = /\] Abnormal disconnect/;
const RECEIVED = /\] : (\S+) has received /;
const SLAIN = /\] : (\S+) has been slain\./;
const PID = /\[[A-Z]+ Client (\d+)\]/;
function parseLine(line) {
  const s = String(line || '');
  let m = s.match(GENERATING);
  if (m) return { kind: 'area', areaLevel: Number(m[1]), area: m[2] };
  m = s.match(LEVEL_UP);
  if (m) return { kind: 'level', character: m[1], className: m[2], level: Number(m[3]) };
  m = s.match(RECEIVED);
  if (m) return { kind: 'named', character: m[1], how: 'reward' };
  m = s.match(SLAIN);
  if (m) return { kind: 'named', character: m[1], how: 'slain' }; // (a party member's death reads the same)
  if (LOG_OPEN.test(s)) return { kind: 'login', why: 'game started' };
  if (LOGIN.test(s)) return { kind: 'login', why: 'login' };
  if (DISCONNECT.test(s)) return { kind: 'login', why: 'disconnected' };
  return null;
}
// the game's process number on a line (a new one: the game was restarted)
function pidOf(line) { const m = String(line || '').match(PID); return m ? m[1] : null; }

// What an area you entered says about who is playing, for the character the route follows (owner:
// { level }): 'owner', 'other' or null (can't tell).
//   null: a town or a hideout (every character goes there; their level is fixed: a hideout is always 65)
//   other: an area the route doesn't have (maps, the endgame) while the campaign isn't done; an area of
//     the route far from the step it's on; an area far above the character's level
//   owner: an area of the route near the step it's on, at a level the character can be in
const LEVEL_GAP = 15; // rushing, you can be this far under an area's level
const BEHIND = 40; // going back this many steps (a waypoint to an earlier zone) still counts
function judgeArea(route, steps, current, area, areaLevel, owner) {
  const x = norm(area);
  if (!x) return null;
  if (isTown(route, x)) return null;
  const done = (current || 0) >= steps.length - 1;
  const at = [];
  steps.forEach((s, i) => { if (norm(s.in) === x || norm(s.to) === x) at.push(i); });
  if (!at.length) return done ? null : 'other';
  if (owner && owner.level && areaLevel && areaLevel > owner.level + LEVEL_GAP) return 'other';
  const from = Math.max(0, (current || 0) - BEHIND); const to = (current || 0) + AHEAD;
  return at.some((i) => i >= from && i <= to) ? 'owner' : 'other';
}

// you entered `area`: the new current step index (or the same one if the route doesn't name it soon)
// A town counts only when it's the next area on the route: you go to town all the time (to sell,
// after dying), and that mustn't skip the steps still to do out in the zone.
const AHEAD = 60; // how far ahead a new area may be (a few skipped steps, an optional zone)
// prevArea: the area you were in before (a town: you're coming back from town)
function advance(route, steps, current, area, prevArea) { return decide(route, steps, current, area, prevArea).index; }
// the same, with why (for the route's trace): { index, why, at (the step that named the area) }
//   same-zone: back in the zone of the step you're on; logout-return: back after the route's own
//   log-out; in / to: a step ahead names the area; town-trip: a town that isn't next on the route;
//   not-ahead: no step in the next AHEAD names it; known-elsewhere: the route names it, but not ahead
function decide(route, steps, current, area, prevArea) {
  const r = decideRaw(route, steps, current, area, prevArea);
  if (r.why === 'not-ahead') {
    const x = norm(area);
    const i = steps.findIndex((s) => norm(s.in) === x || norm(s.to) === x);
    if (i >= 0) return { ...r, why: 'known-elsewhere', at: i };
  }
  return r;
}
function decideRaw(route, steps, current, area, prevArea) {
  const x = norm(area);
  const from = Math.max(0, current || 0);
  if (!x) return { index: from, why: 'no-area' };
  if (steps[from] && norm(steps[from].zone) === x) {
    // back in the area you're doing this step in: after dying or a trip to sell, stay on it. But when
    // the route itself logs you out here and brings you back ("Log out", then "Waypoint to" this
    // area), coming back from town means the steps before the log-out are done.
    if (prevArea && isTown(route, prevArea)) {
      let j = from;
      while (j < steps.length && steps[j].zone !== TOWN && !(j > from && (steps[j].in || steps[j].to))) j++;
      if (j < steps.length && steps[j].zone === TOWN) {
        for (let k = j; k < Math.min(steps.length, j + AHEAD); k++) {
          const s = steps[k];
          if (!(s.in || s.to)) continue;
          if (s.to && norm(s.to) === x) return { index: Math.min(k + 1, steps.length), why: 'logout-return', at: k };
          if (s.in && norm(s.in) === x) return { index: k, why: 'logout-return', at: k };
          if (!isTown(route, s.in || s.to)) break;
        }
      }
    }
    return { index: from, why: 'same-zone' };
  }
  const town = isTown(route, x);
  const until = Math.min(steps.length, from + AHEAD);
  // (the step you're on, when it's the one that brought you to its area, isn't the next area)
  for (let i = steps[from] && steps[from].in ? from + 1 : from; i < until; i++) {
    const s = steps[i];
    const named = s.in || s.to;
    if (!named) continue;
    if (s.in && norm(s.in) === x) return { index: i, why: 'in', at: i };
    if (s.to && norm(s.to) === x) return { index: Math.min(i + 1, steps.length), why: 'to', at: i };
    if (town) return { index: from, why: 'town-trip', next: named }; // another area comes first: this is just a trip to town
  }
  return { index: from, why: 'not-ahead' };
}

// Which steps show. mode: { optional (show optional steps), rush (the endgame rush) }. The rush is
// the fastest way to the endgame: the campaign without anything optional, except the optional steps
// that still give something permanent or lead to it (f: passive points, ascendancy, Spirit, life,
// resistances; PoE2's speed route keeps them too). PoE1's route has no such step: the rush hides
// every side quest.
function shown(s, mode) {
  if (!s || !s.o) return true;
  if (mode && mode.rush) return !!s.f;
  return !mode || mode.optional !== false;
}
// the step to land on from i: hidden steps are passed, unless you're in that step's own area
// (then you're doing it anyway)
function settle(steps, i, mode, area) {
  let j = i;
  while (j < steps.length && !shown(steps[j], mode) && !(area && steps[j].in && norm(steps[j].in) === norm(area))) j++;
  return j;
}
// one step on (dir 1) or back (-1), passing hidden steps
function stepBy(steps, i, dir, mode) {
  let j = i + (dir > 0 ? 1 : -1);
  while (j > 0 && j < steps.length && !shown(steps[j], mode)) j += dir > 0 ? 1 : -1;
  return Math.max(0, Math.min(steps.length, j));
}

// what the steps you've done have given you: passive points, ascendancy (trials and labs), the
// resistance changes, Spirit (PoE2)
function totals(steps, upTo) {
  const t = { passives: 0, trials: 0, labs: 0, res: [], spirit: 0, rewards: [] };
  for (let i = 0; i < Math.min(upTo, steps.length); i++) {
    const s = steps[i];
    if (s.p) t.passives += s.p;
    const k = s.k || [];
    if (k.includes('trial')) t.trials++;
    if (k.includes('lab')) t.labs++;
    if (s.r) {
      t.rewards.push(s.r);
      const sp = String(s.r).match(/\+(\d+) Spirit/);
      if (sp) t.spirit += Number(sp[1]);
      if (k.includes('res')) t.res.push(s.r);
    }
  }
  return t;
}

// the Client.txt files the game writes, where they usually are (Windows; the Steam library and the
// standalone install). You can pick another one in the League start tab.
function defaultLogPaths(game) {
  const dir = game === 'poe1' ? 'Path of Exile' : 'Path of Exile 2';
  const pf = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const pf64 = process.env.ProgramFiles || 'C:\\Program Files';
  return [
    path.join(pf, 'Steam', 'steamapps', 'common', dir, 'logs', 'Client.txt'),
    path.join(pf, 'Grinding Gear Games', dir, 'logs', 'Client.txt'),
    path.join(pf64, 'Grinding Gear Games', dir, 'logs', 'Client.txt'),
    path.join('C:\\', 'Games', dir, 'logs', 'Client.txt'),
  ];
}

module.exports = { load, flatten, isTown, parseLine, pidOf, judgeArea, advance, decide, shown, settle, stepBy, totals, defaultLogPaths, AHEAD, TOWN, LEVEL_GAP };
