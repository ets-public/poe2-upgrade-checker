'use strict';
// Small decisions of the trade price check, kept out of the (electron-only) feature files so they can be tested.

// The search steps that worked, each { r, q, level, total }. The first with at least `enough` listings
// wins; else the one with the most (a looser level can find fewer than a closer one, and a rate-limit
// stop must not make us use the smaller result); a tie goes to the closer (lower) level. null when no
// step found anything.
function pickStep(steps, enough) {
  const ok = (Array.isArray(steps) ? steps : []).filter((s) => s && s.total != null && s.total > 0);
  if (!ok.length) return null;
  const sorted = ok.slice().sort((a, b) => (a.level || 0) - (b.level || 0));
  const good = sorted.find((s) => s.total >= enough);
  if (good) return good;
  return sorted.reduce((best, s) => (s.total > best.total ? s : best), sorted[0]);
}

// Can the trade site be asked about this query without it meaning "every listing on the site"?
// Needs stats, a name or base type, a category, or equipment / map filters. (A category + rarity with
// no stats, e.g. a rare ring of filler mods, is fine; a rarity alone is not.)
function searchable(body) {
  const q = body && body.query;
  if (!q || typeof q !== 'object') return false;
  if (Array.isArray(q.stats) && q.stats.some((g) => g && Array.isArray(g.filters) && g.filters.length)) return true;
  if (q.name || q.type) return true;
  const f = q.filters || {};
  if (f.type_filters && f.type_filters.filters && f.type_filters.filters.category) return true;
  for (const k of ['equipment_filters', 'map_filters']) if (f[k] && f[k].filters && Object.keys(f[k].filters).length) return true;
  return false;
}

const goodList = (x) => !!x && Array.isArray(x.result) && x.result.length > 0;
// A refresh of the trade data: the new filters / leagues replace the old only when they really came
// (a failed fetch is null; an empty list would leave a new player on 'Standard'). `now` stamps fetchedAt.
// Returns { data, keptFilters, keptLeagues } so the caller can log what was kept.
function mergeTradeData(old, fresh, now) {
  const o = old || {};
  const keptFilters = !goodList(fresh.filters) && !!o.filters;
  const keptLeagues = !goodList(fresh.leagues) && !!o.leagues;
  const data = { stats: fresh.stats, filters: keptFilters ? o.filters : fresh.filters, leagues: keptLeagues ? o.leagues : fresh.leagues, fetchedAt: now };
  if (keptLeagues && o.leaguesAt) data.leaguesAt = o.leaguesAt;
  return { data, keptFilters, keptLeagues };
}

const PICK_ID = /^[a-z]+\.[a-z0-9_]{1,80}$/;
// Picks from the page: at most `max` objects with a string key (300 chars at most); an id is kept only
// if it looks like a trade stat id.
function cleanPicks(picks, max = 40) {
  if (!Array.isArray(picks)) return [];
  const out = [];
  for (const p of picks) {
    if (out.length >= max) break;
    if (!p || typeof p !== 'object' || typeof p.key !== 'string' || p.key.length > 300) continue;
    const c = { ...p };
    if (!(typeof p.id === 'string' && PICK_ID.test(p.id))) { delete c.id; delete c.idType; }
    out.push(c);
  }
  return out;
}

module.exports = { pickStep, searchable, mergeTradeData, cleanPicks, PICK_ID };
