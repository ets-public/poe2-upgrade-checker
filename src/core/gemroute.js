'use strict';

// PoE1 league start: which gem to take as each quest's reward, and which to buy from the vendor after
// it, for your Path of Building build. The rewards and vendor gems by class come from exile-leveling
// (MIT, src/data/routes/poe1-gems.json, see LICENSES.md); the gems are your build's.
const fs = require('fs');
const path = require('path');

let data = null;
function load() {
  if (!data) data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'routes', 'poe1-gems.json'), 'utf8'));
  return data;
}
const norm = (n) => String(n || '').toLowerCase().replace(/\s+support$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`)); return m ? m[1].replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"') : null; };

// the gems of a Path of Building (PoE1) build, the main skill's group first, and its class
// -> { className, gems: [names] } or null
function buildGems(xml) {
  const s = String(xml || '');
  const b = s.match(/<Build\s[^>]*>/);
  if (!b) return null;
  const className = attr(b[0], 'className');
  const main = Number(attr(b[0], 'mainSocketGroup')) || 1;
  // the active skill set only (PoB can hold several)
  const sets = s.match(/<SkillSet\b[\s\S]*?<\/SkillSet>/g);
  let skillsXml = s.match(/<Skills\b[\s\S]*?<\/Skills>/);
  skillsXml = skillsXml ? skillsXml[0] : '';
  if (sets && sets.length > 1) {
    const active = attr((skillsXml.match(/<Skills\b[^>]*>/) || [''])[0], 'activeSkillSet');
    skillsXml = sets.find((x) => attr((x.match(/<SkillSet\b[^>]*>/) || [''])[0], 'id') === active) || sets[0];
  }
  const groups = (skillsXml.match(/<Skill\b[\s\S]*?<\/Skill>/g) || []).filter((g) => attr((g.match(/<Skill\b[^>]*>/) || [''])[0], 'enabled') !== 'false');
  const order = groups.map((g, i) => ({ g, i })).sort((a, b2) => (a.i + 1 === main ? -1 : b2.i + 1 === main ? 1 : a.i - b2.i));
  const gems = [];
  for (const { g } of order) {
    for (const t of g.match(/<Gem\b[^>]*>/g) || []) {
      if (attr(t, 'enabled') === 'false') continue;
      const n = attr(t, 'nameSpec');
      if (n && !gems.some((x) => norm(x) === norm(n))) gems.push(n);
    }
  }
  return className && gems.length ? { className, gems } : null;
}

// the quest a step hands in ("Hand in Mercy Mission", "Waypoint to The Library, hand in A Fixture of Fate to Siosa")
function questOf(text) {
  const m = String(text || '').match(/hand in (.+?)(?: to [A-Z][\w' ]+$|,|$)/i);
  return m ? m[1].trim() : null;
}

// For each step (in order, the ones you'll do), what to take and buy for your build:
// -> Map(step index -> { take: { gem, npc } | null, buy: [{ gem, npc }] })
// A gem is suggested once: the first quest that gives it (as a reward first, else from a vendor).
function plan(steps, build, shown) {
  const out = new Map();
  if (!build) return out;
  const d = load();
  const ci = d.classes.indexOf(build.className);
  if (ci < 0) return out;
  const bit = 1 << ci;
  const want = build.gems.map((g) => ({ name: g, key: norm(g) }));
  const have = new Set();
  const byKey = new Map(d.gems.map((g, i) => [norm(g), i]));
  const wantIdx = want.map((w) => byKey.get(w.key)).filter((i) => i != null);
  steps.forEach((s, i) => {
    if (shown && !shown(s)) return;
    const q = questOf(s.t);
    const offers = q && d.quests[q];
    if (!offers) return;
    let take = null; const buy = [];
    for (const o of offers) {
      const npc = d.npcs[o.npc];
      if (npc === 'Tutorial NPC') continue;
      if (!take) {
        const rewards = new Set(o.q.filter(([, m]) => m & bit).map(([g]) => g));
        const g = wantIdx.find((x) => rewards.has(x) && !have.has(x));
        if (g != null) { take = { gem: d.gems[g], npc }; have.add(g); }
      }
      const sells = new Map(o.v.filter(([, m]) => m & bit).map(([g, , n]) => [g, d.npcs[n]]));
      for (const g of wantIdx) if (sells.has(g) && !have.has(g)) { buy.push({ gem: d.gems[g], npc: sells.get(g) }); have.add(g); }
    }
    if (take || buy.length) out.set(i, { take, buy });
  });
  return out;
}

// one line for a step: "Take Arcane Surge. Buy from Nessa: Frostblink, Flame Dash"
function line(p) {
  if (!p) return '';
  const parts = [];
  if (p.take) parts.push(`Take ${p.take.gem}`);
  const by = new Map();
  for (const b of p.buy) { if (!by.has(b.npc)) by.set(b.npc, []); by.get(b.npc).push(b.gem); }
  for (const [npc, gems] of by) parts.push(`Buy from ${npc}: ${gems.length > 6 ? `${gems.slice(0, 6).join(', ')} and ${gems.length - 6} more` : gems.join(', ')}`);
  return parts.join('. ');
}

module.exports = { load, buildGems, questOf, plan, line, norm };
