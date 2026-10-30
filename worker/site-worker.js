// poe2upgrade.com: the website (files in site/), plus a small caching proxy for poe.ninja's price
// data, which poe.ninja asks desktop apps to use instead of calling it from every player's PC
// (https://poe.ninja/docs/api). Only the economy endpoints the app reads are passed on.
//
//   /ninja/poe1/exchange/current/overview?league=…&type=…   ->  https://poe.ninja/poe1/api/economy/…
//   /ninja/poe2/stash/current/item/overview?league=…&type=…
//   /ninja/poe2/leagues

const ALLOWED = /^\/ninja\/(poe1|poe2)\/(leagues|exchange\/current\/overview|stash\/current\/item\/overview|stash\/current\/currency\/overview)$/;
// /ninja/<game>/exchange/all?league=… : every exchange list of the game in one answer
const ALL = /^\/ninja\/(poe1|poe2)\/exchange\/all$/;
const EXCHANGE_TYPES = {
  poe2: ['Currency', 'Fragments', 'Abyss', 'UncutGems', 'LineageSupportGems', 'Essences', 'SoulCores', 'Idols', 'Runes', 'Ritual', 'Expedition', 'Delirium', 'Breach', 'Verisium'],
  poe1: ['Currency', 'Fragment', 'Runegraft', 'AllflameEmber', 'Tattoo', 'Omen', 'DjinnCoin', 'Ducat', 'EnshroudingCrystal', 'DivinationCard', 'Artifact', 'Oil', 'DeliriumOrb', 'Scarab', 'Astrolabe', 'Fossil', 'Resonator', 'Essence'],
};
const QUERY = ['league', 'type'];
// the lists the app reads (src/core/ninja.js): any other "type" would be one more poe.ninja call
// and one more cache entry for nothing. A list the app doesn't ask for here is answered 400; the
// app then asks poe.ninja itself.
const ITEM_TYPES = {
  poe2: ['UniqueWeapons', 'UniqueArmours', 'UniqueAccessories', 'UniqueFlasks', 'UniqueCharms', 'UniqueJewels', 'UniqueSanctumRelics', 'UniqueTablets', 'PrecursorTablets'],
  poe1: ['UniqueWeapon', 'UniqueArmour', 'UniqueAccessory', 'UniqueFlask', 'UniqueJewel', 'UniqueTincture', 'UniqueRelic', 'UniqueMap', 'ForbiddenJewel',
    'SkillGem', 'ImbuedGem', 'Map', 'BlightedMap', 'BlightRavagedMap', 'Incubator', 'Memory', 'Vial', 'Invitation', 'ScryingOrb'],
};
function typeAllowed(game, what, type) {
  if (what === 'leagues') return true;
  if (what === 'exchange/current/overview') return EXCHANGE_TYPES[game].includes(type);
  if (what === 'stash/current/item/overview') return ITEM_TYPES[game].includes(type);
  if (what === 'stash/current/currency/overview') return ['Currency', 'Fragment'].includes(type);
  return false;
}
const UA = 'PoE Upgrade Checker price proxy (https://poe2upgrade.com; support@poe2upgrade.com)';
// poe.ninja refreshes PoE1 about every 15 minutes and PoE2 about hourly
const TTL = { poe1: 15 * 60, poe2: 30 * 60 };

// one poe.ninja list, through the shared cache
async function cachedJson(game, what, q, ctx) {
  const key = new Request(`https://poe2upgrade.com/ninja-cache/${game}/${what}?${q}`);
  const hit = await caches.default.match(key);
  if (hit) return hit.json();
  const res = await fetch(`https://poe.ninja/${game}/api/economy/${what}?${q}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, cf: { cacheTtl: TTL[game], cacheEverything: true } });
  if (!res.ok) return null;
  const body = await res.text();
  ctx.waitUntil(caches.default.put(key, new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${TTL[game]}` } })));
  try { return JSON.parse(body); } catch (_) { return null; }
}
async function exchangeAll(game, league, ctx) {
  if (!league) return new Response(JSON.stringify({ error: 'league missing' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  const key = new Request(`https://poe2upgrade.com/ninja-cache/${game}/exchange/all?league=${encodeURIComponent(league)}`);
  const hit = await caches.default.match(key);
  if (hit) return hit;
  const types = {};
  const one = async (t) => {
    try { const d = await cachedJson(game, 'exchange/current/overview', `league=${encodeURIComponent(league)}&type=${encodeURIComponent(t)}`, ctx); if (d && Array.isArray(d.lines)) types[t] = d; } catch (_) { /* that list is missing this time */ }
  };
  const list = EXCHANGE_TYPES[game];
  // the first list first: a league poe.ninja doesn't know (anyone can type one) costs it one call,
  // not one per list, and the "no such league" answer is remembered for a while
  await one(list[0]);
  if (!types[list[0]] || !types[list[0]].lines.length) {
    const none = new Response(JSON.stringify({ league, types: {}, error: 'poe.ninja has no prices for that league' }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600', 'Access-Control-Allow-Origin': '*' } });
    ctx.waitUntil(caches.default.put(key, none.clone()));
    return none;
  }
  // the rest a few at a time, so poe.ninja never sees a burst from us
  const rest = list.slice(1);
  for (let i = 0; i < rest.length; i += 4) await Promise.all(rest.slice(i, i + 4).map(one));
  // every list: kept as long as poe.ninja's own refresh; some missing (poe.ninja busy): a minute,
  // so the missing prices come back soon
  const ttl = Object.keys(types).length === list.length ? TTL[game] : 60;
  const out = new Response(JSON.stringify({ league, types }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}`, 'Access-Control-Allow-Origin': '*' } });
  ctx.waitUntil(caches.default.put(key, out.clone()));
  return out;
}

// ---------- anonymous usage statistics (the app's "Send anonymous usage statistics") ----------
// POST /api/ping { id, v, p, beta, poe1, poe2, n, s, e }: one row per install per day. The install id
// is a random number the app made; it's hashed again here, and nothing else is kept: no IP address, no
// account, no character, no items. n (counts of checks, price checks, searches, League start steps),
// s (yes/no: guide done, build loaded, gear saved, ever checked an item) and e (counts of problems)
// go to the usage table (app 0.5.3+). GET /api/stats?key=… shows the totals (the key is in D1's config).
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
async function sha(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
async function ping(request, env) {
  if (!env.STATS) return json({ ok: false }, 503);
  let b;
  try { b = JSON.parse((await request.text()).slice(0, 2000)); } catch (_) { return json({ ok: false }, 400); }
  if (!b || !/^[0-9a-f]{32}$/.test(String(b.id || ''))) return json({ ok: false }, 400);
  const install = await sha('poe-upgrade-checker:' + b.id);
  const day = new Date().toISOString().slice(0, 10);
  const v = String(b.v || '').replace(/[^0-9A-Za-z.\-]/g, '').slice(0, 24) || null;
  const p = ['win32', 'linux', 'darwin'].includes(b.p) ? b.p : 'other';
  await env.STATS.prepare(`INSERT INTO pings (day, install, version, platform, poe1, poe2, beta, first_seen)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, COALESCE((SELECT MIN(first_seen) FROM pings WHERE install = ?2), ?1))
      ON CONFLICT (day, install) DO UPDATE SET version = excluded.version, platform = excluded.platform,
        poe1 = MAX(poe1, excluded.poe1), poe2 = MAX(poe2, excluded.poe2), beta = excluded.beta`)
    .bind(day, install, v, p, b.poe1 ? 1 : 0, b.poe2 ? 1 : 0, b.beta ? 1 : 0).run();
  // app 0.5.3+: today's counts (what's used, problems) and how far it's set up, numbers and yes/no only
  if (b.n && typeof b.n === 'object') {
    const num = (o, k) => Math.max(0, Math.min(9999, Math.floor(Number(o && o[k]) || 0)));
    const yes = (k) => (b.s && b.s[k] ? 1 : 0);
    try {
      await env.STATS.prepare(`INSERT INTO usage (day, install, checks, prices, searches, route, s_guide, s_build, s_gear, s_checked, e_hotkey, e_pob, e_trade)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
          ON CONFLICT (day, install) DO UPDATE SET checks = MAX(checks, excluded.checks), prices = MAX(prices, excluded.prices),
            searches = MAX(searches, excluded.searches), route = MAX(route, excluded.route), s_guide = excluded.s_guide, s_build = excluded.s_build,
            s_gear = excluded.s_gear, s_checked = excluded.s_checked, e_hotkey = MAX(e_hotkey, excluded.e_hotkey), e_pob = MAX(e_pob, excluded.e_pob),
            e_trade = MAX(e_trade, excluded.e_trade)`)
        .bind(day, install, num(b.n, 'checks'), num(b.n, 'prices'), num(b.n, 'searches'), num(b.n, 'route'), yes('guide'), yes('build'), yes('gear'), yes('checked'),
          num(b.e, 'hotkey'), num(b.e, 'pob'), num(b.e, 'trade')).run();
    } catch (_) { /* the usage table isn't there yet: the ping itself is kept */ }
  }
  return json({ ok: true });
}
const esc = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// the releases on GitHub (dates for the chart, download counts), cached for an hour
async function releases(ctx) {
  const key = new Request('https://poe2upgrade.com/releases-cache');
  const hit = await caches.default.match(key);
  if (hit) { try { return await hit.json(); } catch (_) { /* fetch again */ } }
  try {
    const res = await fetch('https://api.github.com/repos/ets-public/poe2-upgrade-checker/releases?per_page=30', { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' } });
    const list = res.ok ? await res.json() : [];
    // installers only: the updater's own small files (latest.yml, .blockmap) aren't downloads of the app
    const out = (Array.isArray(list) ? list : []).filter((r) => r && !r.draft).map((r) => ({
      tag: String(r.tag_name || '').replace(/^v/, ''), day: String(r.published_at || r.created_at || '').slice(0, 10), pre: !!r.prerelease,
      downloads: (r.assets || []).filter((a) => /\.(exe|AppImage)$/i.test(a.name || '')).reduce((n, a) => n + (Number(a.download_count) || 0), 0),
    }));
    if (ctx) ctx.waitUntil(caches.default.put(key, new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } })));
    return out;
  } catch (_) { return []; }
}

// a small bar chart as SVG (no script): stacked bars per day, an optional line, and markers
function chart(days, stacks, line, marks) {
  const W = 860; const H = 190; const L = 34; const B = 22; const T = 8;
  const n = days.length;
  if (!n) return '';
  const max = Math.max(1, ...days.map((_, i) => stacks.reduce((a, s) => a + (s.values[i] || 0), 0)), ...(line ? line.values : [0]));
  const step = (W - L - 6) / n; const bw = Math.max(2, Math.min(28, step * 0.7));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily chart" class="chart">`;
  for (const f of [0, 0.5, 1]) { const v = Math.round(max * f); out += `<line x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${v}</text>`; }
  days.forEach((d, i) => {
    const x = L + step * i + (step - bw) / 2;
    let base = 0;
    for (const s of stacks) {
      const v = s.values[i] || 0;
      if (v) out += `<rect x="${x.toFixed(1)}" y="${y(base + v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(base) - y(base + v)).toFixed(1)}" fill="${s.color}"><title>${esc(d)}: ${v} ${esc(s.label)}</title></rect>`;
      base += v;
    }
    if (n <= 16 || i % Math.ceil(n / 12) === 0) out += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" class="ax" text-anchor="middle">${esc(d.slice(5))}</text>`;
  });
  if (line) {
    const pts = line.values.map((v, i) => `${(L + step * i + step / 2).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    out += `<polyline points="${pts}" fill="none" stroke="${line.color}" stroke-width="2"/>`;
  }
  for (const m of marks || []) {
    const i = days.indexOf(m.day);
    if (i < 0) continue;
    const x = (L + step * i + step / 2).toFixed(1);
    out += `<line x1="${x}" x2="${x}" y1="${T}" y2="${H - B}" class="mark"/><text x="${x}" y="${T + 10}" class="mk" text-anchor="middle">${esc(m.label)}</text>`;
  }
  return out + '</svg>';
}
const legend = (items) => `<div class="lg">${items.map((x) => `<span><i style="background:${x.color}"></i>${esc(x.label)}</span>`).join('')}</div>`;

async function stats(url, env, ctx) {
  if (!env.STATS) return new Response('Statistics are not set up.', { status: 503 });
  const row = await env.STATS.prepare("SELECT v FROM config WHERE k = 'stats_key'").first();
  const key = url.searchParams.get('key') || '';
  if (!row || !key || key !== row.v) return new Response('Not found', { status: 404 });
  const DB = env.STATS;
  const all = async (sql, ...b) => ((await DB.prepare(sql).bind(...b).all()).results || []);
  const one = async (sql, ...b) => (await DB.prepare(sql).bind(...b).first()) || {};
  const since = (days) => new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const ago = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const today = since(1); const yesterday = ago(1);
  const active = (days) => one(`SELECT COUNT(DISTINCT install) AS all_, COUNT(DISTINCT CASE WHEN poe1 = 1 THEN install END) AS poe1,
      COUNT(DISTINCT CASE WHEN poe2 = 1 THEN install END) AS poe2, COUNT(DISTINCT CASE WHEN poe1 = 1 AND poe2 = 1 THEN install END) AS both_,
      COUNT(DISTINCT CASE WHEN poe1 = 1 OR poe2 = 1 THEN install END) AS played
      FROM pings WHERE day >= ?1`, since(days));
  const [d1, d7, d30] = await Promise.all([active(1), active(7), active(30)]);
  // each day: active, played (a game marked) or the app only open, new or returning
  const daily = await all(`SELECT day, COUNT(*) AS n, SUM(poe1) AS poe1, SUM(poe2) AS poe2, SUM(CASE WHEN poe1 = 1 OR poe2 = 1 THEN 1 ELSE 0 END) AS played,
      SUM(CASE WHEN first_seen = day THEN 1 ELSE 0 END) AS fresh FROM pings WHERE day >= ?1 GROUP BY day ORDER BY day DESC`, since(30));
  const versions = await all(`WITH l AS (SELECT install, MAX(day) AS d FROM pings WHERE day >= ?1 GROUP BY install)
      SELECT p.version, COUNT(*) AS n FROM pings p JOIN l ON l.install = p.install AND l.d = p.day GROUP BY p.version ORDER BY n DESC LIMIT 20`, since(7));
  const cohorts = await all(`WITH f AS (SELECT install, MIN(day) AS d FROM pings GROUP BY install)
      SELECT f.d AS day, COUNT(*) AS n, SUM(EXISTS(SELECT 1 FROM pings p WHERE p.install = f.install AND p.day = date(f.d, '+1 day'))) AS next_day,
      SUM(EXISTS(SELECT 1 FROM pings p WHERE p.install = f.install AND p.day > f.d)) AS later
      FROM f WHERE f.d >= ?1 GROUP BY f.d ORDER BY f.d DESC`, since(30));
  // still using it a week / a month later: of the installs first counted at least that long ago,
  // the share seen again that many days or more after their first day
  const stay = (days) => one(`WITH f AS (SELECT install, MIN(day) AS d FROM pings GROUP BY install HAVING MIN(day) <= ?1)
      SELECT COUNT(*) AS n, SUM(EXISTS(SELECT 1 FROM pings p WHERE p.install = f.install AND p.day >= date(f.d, '+' || ?2 || ' days'))) AS kept FROM f`, ago(days), String(days));
  const [w1, m1] = await Promise.all([stay(7), stay(30)]);
  // gone quiet: last seen 7 or more days ago
  const quiet = await one(`WITH l AS (SELECT install, MAX(day) AS d FROM pings GROUP BY install)
      SELECT COUNT(*) AS n, SUM(d <= ?1) AS quiet FROM l`, ago(7));
  const platforms = await all('SELECT platform, COUNT(DISTINCT install) AS n FROM pings WHERE day >= ?1 GROUP BY platform ORDER BY n DESC', since(7));
  const total = await one('SELECT COUNT(DISTINCT install) AS n FROM pings');
  const started = await one('SELECT MIN(day) AS d FROM pings');
  // update speed: each day, the share of active installs on each version
  const byVersion = await all('SELECT day, version, COUNT(*) AS n FROM pings WHERE day >= ?1 GROUP BY day, version', since(30));
  // the website: page views and Download clicks per day (counted by this worker, a number per day)
  let visits = [];
  try { visits = await all('SELECT day, page, n FROM visits WHERE day >= ?1', since(30)); } catch (_) { /* table not made yet */ }
  // what's used, how far people set it up, and problems (app 0.5.3 and later)
  let use = null; let setup = null; let newSetup = null; let problems = [];
  try {
    use = await one(`SELECT COUNT(DISTINCT install) AS n, COUNT(DISTINCT CASE WHEN checks > 0 THEN install END) AS checks_i, SUM(checks) AS checks,
        COUNT(DISTINCT CASE WHEN prices > 0 THEN install END) AS prices_i, SUM(prices) AS prices, COUNT(DISTINCT CASE WHEN searches > 0 THEN install END) AS searches_i,
        SUM(searches) AS searches, COUNT(DISTINCT CASE WHEN route > 0 THEN install END) AS route_i, SUM(route) AS route FROM usage WHERE day >= ?1`, since(7));
    const setupOf = (sql, b) => one(`WITH l AS (SELECT install, MAX(day) AS d FROM usage WHERE day >= ?1 GROUP BY install)
        SELECT COUNT(*) AS n, SUM(u.s_guide) AS guide, SUM(u.s_build) AS build, SUM(u.s_gear) AS gear, SUM(u.s_checked) AS checked
        FROM usage u JOIN l ON l.install = u.install AND l.d = u.day ${sql}`, b);
    setup = await setupOf('', since(7));
    newSetup = await one(`WITH f AS (SELECT install, MIN(day) AS d FROM pings GROUP BY install HAVING MIN(day) >= ?1),
        l AS (SELECT u.install, MAX(u.day) AS d FROM usage u JOIN f ON f.install = u.install GROUP BY u.install)
        SELECT COUNT(*) AS n, SUM(u.s_guide) AS guide, SUM(u.s_build) AS build, SUM(u.s_gear) AS gear, SUM(u.s_checked) AS checked
        FROM usage u JOIN l ON l.install = u.install AND l.d = u.day`, since(7));
    problems = await all(`SELECT p.version, COUNT(DISTINCT u.install) AS n, COUNT(DISTINCT CASE WHEN u.e_hotkey > 0 THEN u.install END) AS hotkey,
        COUNT(DISTINCT CASE WHEN u.e_pob > 0 THEN u.install END) AS pob, COUNT(DISTINCT CASE WHEN u.e_trade > 0 THEN u.install END) AS trade
        FROM usage u JOIN pings p ON p.install = u.install AND p.day = u.day WHERE u.day >= ?1 GROUP BY p.version ORDER BY n DESC LIMIT 12`, since(7));
  } catch (_) { use = null; }
  const rel = await releases(ctx);
  const today_ = today;
  const old = cohorts.filter((c) => c.day < today_);
  const back = { n: old.reduce((a, c) => a + c.n, 0), later: old.reduce((a, c) => a + c.later, 0) };
  const retention = cohorts.map((c) => ({ ...c, pending: c.day >= yesterday }));
  const asc = daily.slice().reverse();
  const days = asc.map((r) => r.day);
  const vis = (day, page) => (visits.find((v) => v.day === day && v.page === page) || {}).n || 0;
  if (url.searchParams.get('format') === 'json') return json({ today: d1, week: d7, month: d30, daily, versions, platforms, ever: total.n, since: started.d, cameBack: back, retention, week1: w1, month1: m1, quiet, byVersion, visits, use, setup, newSetup, problems, releases: rel });
  const pct = (a, b) => (b ? `${Math.round(((a || 0) / b) * 100)}%` : '–');
  const card = (t, o) => `<div class="c"><h2>${t}</h2><b>${esc(o.all_)}</b><span>played ${esc(o.played)} · PoE2 ${esc(o.poe2)} · PoE1 ${esc(o.poe1)}${o.both_ ? ` · both ${esc(o.both_)}` : ''}</span></div>`;
  const big = (t, v, sub) => `<div class="c"><h2>${t}</h2><b>${v}</b><span>${sub}</span></div>`;
  const rows = (list, cols) => list.map((r) => `<tr>${cols.map((c) => `<td>${esc(typeof c === 'function' ? c(r) : r[c])}</td>`).join('')}</tr>`).join('');
  // releases and events on the chart (config 'events': [{"day":"2026-10-27","label":"Reddit"}])
  let events = [];
  try { const e = await one("SELECT v FROM config WHERE k = 'events'"); events = e.v ? JSON.parse(e.v) : []; } catch (_) { events = []; }
  const marks = [...rel.filter((r) => !r.pre).map((r) => ({ day: r.day, label: r.tag })), ...(Array.isArray(events) ? events : []).filter((e) => e && e.day).map((e) => ({ day: String(e.day), label: String(e.label || '') }))];
  const C1 = '#c9a86a'; const C2 = '#5f7fa8'; const CL = '#e8d9a8';
  const activity = chart(days, [{ label: 'new', color: C1, values: asc.map((r) => r.fresh) }, { label: 'returning', color: C2, values: asc.map((r) => r.n - r.fresh) }], { label: 'played', color: CL, values: asc.map((r) => r.played) }, marks);
  // update speed: the newest stable release's share of each day's active installs
  const stable = rel.filter((r) => !r.pre).sort((a, b) => (a.day < b.day ? 1 : -1));
  const newest = stable[0];
  const adopt = newest ? days.filter((d) => d >= newest.day).map((d) => { const tot = byVersion.filter((x) => x.day === d).reduce((a, x) => a + x.n, 0); const on = byVersion.filter((x) => x.day === d && x.version === newest.tag).reduce((a, x) => a + x.n, 0); return { day: d, on, tot }; }) : [];
  const stuck = newest ? byVersion.filter((x) => x.day >= ago(2) && x.version !== newest.tag) : [];
  const stuckBy = {}; for (const x of stuck) stuckBy[x.version] = Math.max(stuckBy[x.version] || 0, x.n);
  // the website funnel, last 7 days
  const wk = (page) => visits.filter((v) => v.day >= since(7) && v.page === page).reduce((a, v) => a + v.n, 0);
  const newWeek = daily.filter((r) => r.day >= since(7)).reduce((a, r) => a + r.fresh, 0);
  const newWeekBack = cohorts.filter((c) => c.day >= since(7) && c.day < today_).reduce((a, c) => a + c.later, 0);
  const newWeekOld = cohorts.filter((c) => c.day >= since(7) && c.day < today_).reduce((a, c) => a + c.n, 0);
  const dl = rel.reduce((a, r) => a + r.downloads, 0);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Usage · PoE Upgrade Checker</title><style>
:root{color-scheme:dark}body{margin:0;padding:24px 16px;background:#0e1013;color:#d8d2c4;font:15px/1.5 system-ui,sans-serif}main{max-width:900px;margin:auto}
h1{font-size:20px;margin:0 0 4px}p{color:#8d8a82;margin:0 0 20px}.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:24px}
.c{background:#181b20;border:1px solid #2c3038;border-radius:8px;padding:14px}.c h2{font-size:13px;font-weight:600;color:#8d8a82;margin:0}.c b{display:block;font-size:30px;color:#f1e4c2}.c span{color:#8d8a82;font-size:13px}
table{width:100%;border-collapse:collapse;margin-bottom:24px;font-variant-numeric:tabular-nums}td,th{text-align:left;padding:5px 8px;border-bottom:1px solid #2c3038}th{color:#8d8a82;font-weight:600;font-size:13px}h3{font-size:15px;margin:28px 0 6px}p.n{font-size:13px;margin:-2px 0 8px}
.wrap{overflow-x:auto}.chart{width:100%;height:auto;display:block;background:#14171b;border:1px solid #2c3038;border-radius:8px;margin-bottom:6px}.chart .grid{stroke:#2c3038}.chart .ax{fill:#8d8a82;font-size:11px}.chart .mark{stroke:#e8d9a8;stroke-dasharray:3 3;opacity:.6}.chart .mk{fill:#e8d9a8;font-size:11px}
.lg{display:flex;flex-wrap:wrap;gap:14px;font-size:13px;color:#8d8a82;margin-bottom:20px}.lg i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
details{margin-bottom:20px}summary{cursor:pointer;color:#c9a86a;font-size:14px;margin-bottom:6px}.wrap table{min-width:520px}
.funnel{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:6px}.funnel div{background:#181b20;border:1px solid #2c3038;border-radius:8px;padding:10px}.funnel b{display:block;font-size:22px;color:#f1e4c2}.funnel span{font-size:12px;color:#8d8a82}
</style></head><body><main><h1>PoE Upgrade Checker: active users</h1><p>Installs that sent the anonymous daily ping (users who opted out aren't counted). ${esc(total.n)} installs since counting started${started.d ? ` on ${esc(started.d)}` : ''}: an install is "new" the first day it's counted, so the first days include people who had it already. "Played" means a game was used that day; the rest only had the app open (in the tray). Days are UTC.</p>
<div class="g">${card('Today', d1)}${card('Last 7 days', d7)}${card('Last 30 days', d30)}</div>
<div class="g">${big('Came back', pct(back.later, back.n), `${esc(back.later)} of ${esc(back.n)} installs used it again on a later day`)}${big('Still using it a week later', w1.n ? pct(w1.kept, w1.n) : '–', w1.n ? `${esc(w1.kept)} of ${esc(w1.n)} installs first counted 7+ days ago` : 'once installs are 7 days old')}${big('A month later', m1.n ? pct(m1.kept, m1.n) : '–', m1.n ? `${esc(m1.kept)} of ${esc(m1.n)} installs first counted 30+ days ago` : 'once installs are 30 days old')}${big('Gone quiet', esc(quiet.quiet || 0), `of ${esc(quiet.n || 0)} installs, not seen for 7 days or more`)}</div>
<h3>Each day</h3><div class="wrap">${activity}</div>${legend([{ label: 'new installs', color: C1 }, { label: 'returning', color: C2 }, { label: 'line: played (a game used)', color: CL }, { label: 'dashed: a release or event', color: '#8d8a82' }])}
<details><summary>Day by day</summary><div class="wrap"><table><tr><th>Day</th><th>Active</th><th>Played</th><th>App open only</th><th>PoE2</th><th>PoE1</th><th>New installs</th></tr>${rows(daily, ['day', 'n', 'played', (r) => r.n - r.played, 'poe2', 'poe1', 'fresh'])}</table></div></details>
<h3>From the website to a user (last 7 days)</h3><p class="n">Page views and Download clicks are counted by this site (a number per day). New installs are the first ping after the first-run guide, so people who stop before finishing it aren't in it. Google search clicks are in Search Console.</p>
<div class="funnel"><div><b>${esc(wk('/'))}</b><span>home page views</span></div><div><b>${esc(wk('/path-of-building-poe2/'))}</b><span>Path of Building page views</span></div><div><b>${esc(wk('download'))}</b><span>Download clicks</span></div><div><b>${esc(newWeek)}</b><span>new installs</span></div><div><b>${pct(newWeekBack, newWeekOld)}</b><span>of those (before today) came back</span></div></div>
<p class="n">GitHub counts ${esc(dl)} installer downloads over all releases: that includes the app updating itself, so it's more than new users.</p>
<details><summary>Day by day (last 14 days)</summary><div class="wrap"><table><tr><th>Day</th><th>Home</th><th>PoB page</th><th>Download clicks</th><th>New installs</th></tr>${daily.filter((r) => r.day >= since(14)).map((r) => `<tr><td>${esc(r.day)}</td><td>${vis(r.day, '/')}</td><td>${vis(r.day, '/path-of-building-poe2/')}</td><td>${vis(r.day, 'download')}</td><td>${esc(r.fresh)}</td></tr>`).join('')}</table></div></details>
<h3>Came back, by the day they were first counted</h3><p class="n">Of the installs first counted that day, how many used it again the next day, and on any day since. The newest days are still filling up.</p><details${cohorts.length > 10 ? '' : ' open'}><summary>By first day</summary><div class="wrap"><table><tr><th>First day</th><th>Installs</th><th>Next day</th><th>Any later day</th></tr>${retention.map((c) => `<tr><td>${esc(c.day)}</td><td>${esc(c.n)}</td><td>${c.day >= today_ ? '–' : `${esc(c.next_day)} (${pct(c.next_day, c.n)})${c.pending ? ' so far' : ''}`}</td><td>${c.day >= today_ ? '–' : `${esc(c.later)} (${pct(c.later, c.n)})`}</td></tr>`).join('')}</table></div></details>
${use && use.n ? `<h3>What's used (last 7 days)</h3><p class="n">Installs on app 0.5.3 or later that used each part, and how many times in all.</p><table><tr><th>Part</th><th>Installs</th><th>Times</th></tr>
<tr><td>Item checks (F2, Ctrl+C)</td><td>${esc(use.checks_i)} (${pct(use.checks_i, use.n)})</td><td>${esc(use.checks || 0)}</td></tr><tr><td>Price checks (F3)</td><td>${esc(use.prices_i)} (${pct(use.prices_i, use.n)})</td><td>${esc(use.prices || 0)}</td></tr>
<tr><td>Trade searches</td><td>${esc(use.searches_i)} (${pct(use.searches_i, use.n)})</td><td>${esc(use.searches || 0)}</td></tr><tr><td>League start (steps moved on)</td><td>${esc(use.route_i)} (${pct(use.route_i, use.n)})</td><td>${esc(use.route || 0)}</td></tr></table>
<h3>How far people set it up</h3><p class="n">As each install was on its latest day. New installs: first counted in the last 7 days.</p><table><tr><th></th><th>Finished the guide</th><th>Build loaded</th><th>Gear saved</th><th>Checked an item</th></tr>
<tr><td>Active (7 days), ${esc(setup.n || 0)}</td><td>${pct(setup.guide, setup.n)}</td><td>${pct(setup.build, setup.n)}</td><td>${pct(setup.gear, setup.n)}</td><td>${pct(setup.checked, setup.n)}</td></tr>
<tr><td>New, ${esc(newSetup.n || 0)}</td><td>${pct(newSetup.guide, newSetup.n)}</td><td>${pct(newSetup.build, newSetup.n)}</td><td>${pct(newSetup.gear, newSetup.n)}</td><td>${pct(newSetup.checked, newSetup.n)}</td></tr></table>
<h3>Problems by version (last 7 days)</h3><p class="n">Installs that had each problem at least once.</p><table><tr><th>Version</th><th>Installs</th><th>Hotkey not registered</th><th>Path of Building failed</th><th>Trade search failed</th></tr>${rows(problems, ['version', 'n', (r) => `${r.hotkey} (${pct(r.hotkey, r.n)})`, (r) => `${r.pob} (${pct(r.pob, r.n)})`, (r) => `${r.trade} (${pct(r.trade, r.n)})`])}</table>`
    : '<h3>What\'s used, setup and problems</h3><p class="n">These come from app 0.5.3 and later: nothing yet.</p>'}
<h3>Update speed</h3><p class="n">${newest ? `${esc(newest.tag)} (${esc(newest.day)}): its share of each day's active installs.` : 'No release found on GitHub.'}</p>
${adopt.length ? `<table><tr><th>Day</th><th>On ${esc(newest.tag)}</th></tr>${adopt.slice().reverse().map((a) => `<tr><td>${esc(a.day)}</td><td>${esc(a.on)} of ${esc(a.tot)} (${pct(a.on, a.tot)})</td></tr>`).join('')}</table>` : ''}
${Object.keys(stuckBy).length ? `<p class="n">Seen in the last 3 days on an older version (auto-update off, or not working for them): ${Object.entries(stuckBy).map(([v, n]) => `${esc(v)} × ${esc(n)}`).join(', ')}.</p>` : ''}
<h3>Versions (last 7 days, each install at its latest)</h3><table><tr><th>Version</th><th>Installs</th></tr>${rows(versions, ['version', 'n'])}</table>
<h3>Systems (last 7 days)</h3><table><tr><th>System</th><th>Installs</th></tr>${rows(platforms, ['platform', 'n'])}</table></main></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

// ---------- /download: the newest release, betas included ----------
// GitHub's /releases/latest skips pre-releases, so the site and README link here instead. The answer
// is cached for 10 minutes (GitHub allows 60 unauthenticated API calls an hour).
const RELEASES = 'https://github.com/ets-public/poe2-upgrade-checker/releases';
async function download(ctx) {
  const key = new Request('https://poe2upgrade.com/download-cache');
  const hit = await caches.default.match(key);
  let url = hit ? await hit.text() : null;
  if (!url) {
    try {
      const res = await fetch('https://api.github.com/repos/ets-public/poe2-upgrade-checker/releases?per_page=10', { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' } });
      const list = res.ok ? await res.json() : [];
      const r = (Array.isArray(list) ? list : []).filter((x) => x && !x.draft && x.html_url)
        .sort((a, b) => Date.parse(b.published_at || b.created_at || 0) - Date.parse(a.published_at || a.created_at || 0))[0];
      if (r) { url = r.html_url; ctx.waitUntil(caches.default.put(key, new Response(url, { headers: { 'Cache-Control': 'public, max-age=600' } }))); }
    } catch (_) { /* fall back to the list */ }
  }
  return Response.redirect(url || RELEASES, 302);
}

// ---------- page views and Download clicks: one number per page per day ----------
// Nothing about the visitor is kept (no address, no cookie, no id): the day's count goes up by one.
// Crawlers and link previews aren't counted, and each address counts once a minute at most.
const BOTS = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|curl|wget|python|headless|lighthouse|monitor/i;
function countVisit(request, env, ctx, page) {
  if (!env.STATS || BOTS.test(request.headers.get('User-Agent') || '')) return;
  ctx.waitUntil((async () => {
    if (!await allowed(env, 'RL_VISIT', request, 'visit:' + page)) return;
    const day = new Date().toISOString().slice(0, 10);
    await env.STATS.prepare('INSERT INTO visits (day, page, n) VALUES (?1, ?2, 1) ON CONFLICT (day, page) DO UPDATE SET n = n + 1').bind(day, page).run();
  })().catch(() => { /* the visits table isn't there yet */ }));
}

// ---------- rate limits (Workers Rate Limiting bindings, wrangler.site.jsonc) ----------
// Counted per visitor address for the current minute only, in Cloudflare's memory: the address isn't
// stored or logged. Only work that costs something is counted: a price list that isn't cached yet
// (each one is a call to poe.ninja), a usage ping (a database write) and the stats page (its key).
// Without the binding (local test) everything is allowed.
async function allowed(env, binding, request, what) {
  const rl = env[binding];
  if (!rl || typeof rl.limit !== 'function') return true;
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  try { return (await rl.limit({ key: `${what}:${ip}` })).success; } catch (_) { return true; } // never block on a limiter fault
}
const tooMany = () => new Response(JSON.stringify({ error: 'Too many requests: try again in a minute.' }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '60', 'Cache-Control': 'no-store' } });
// league names: letters, digits, spaces and a little punctuation ("Rise of the Abyssal", "HC SSF Mercenaries")
const LEAGUE = /^[A-Za-z0-9 '()._-]{1,80}$/;

// every answer: HTTPS only from now on, and no guessing a file's type
async function secured(res) {
  const out = new Response(res.body, res);
  out.headers.set('X-Content-Type-Options', 'nosniff');
  out.headers.set('Strict-Transport-Security', 'max-age=31536000');
  return out;
}

export default {
  async fetch(request, env, ctx) {
    return secured(await handle(request, env, ctx));
  },
};

async function handle(request, env, ctx) {
  {
    const url = new URL(request.url);
    // one address for the site: www.poe2upgrade.com goes to poe2upgrade.com
    if (url.hostname === 'www.poe2upgrade.com') { url.hostname = 'poe2upgrade.com'; return Response.redirect(url.toString(), 301); }
    if (url.pathname === '/api/ping') {
      if (request.method !== 'POST') return json({ ok: false }, 405);
      if (!await allowed(env, 'RL_PING', request, 'ping')) return tooMany();
      return ping(request, env).catch(() => json({ ok: false }, 500));
    }
    if (url.pathname === '/download' || url.pathname === '/download/') { countVisit(request, env, ctx, 'download'); return download(ctx); }
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/path-of-building-poe2/')) countVisit(request, env, ctx, url.pathname);
    if (url.pathname === '/api/stats') {
      if (!await allowed(env, 'RL_STATS', request, 'stats')) return tooMany();
      return stats(url, env, ctx).catch(() => new Response('Error', { status: 500 }));
    }
    if (!url.pathname.startsWith('/ninja/')) return env.ASSETS.fetch(request);
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
    const league = url.searchParams.get('league');
    if (league != null && !LEAGUE.test(league)) return new Response(JSON.stringify({ error: 'bad league' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    const all = url.pathname.match(ALL);
    if (all) {
      const key = new Request(`https://poe2upgrade.com/ninja-cache/${all[1]}/exchange/all?league=${encodeURIComponent(league || '')}`);
      const hit = await caches.default.match(key);
      if (hit) return hit;
      if (!await allowed(env, 'RL_NINJA', request, 'ninja')) return tooMany();
      return exchangeAll(all[1], league || '', ctx);
    }
    const m = url.pathname.match(ALLOWED);
    if (!m) return new Response('Not found', { status: 404 });
    if (!typeAllowed(m[1], m[2], url.searchParams.get('type'))) return new Response(JSON.stringify({ error: 'unknown type' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    const q = QUERY.filter((k) => url.searchParams.get(k)).map((k) => `${k}=${encodeURIComponent(url.searchParams.get(k).slice(0, 80))}`).join('&');
    const target = `https://poe.ninja/${m[1]}/api/economy/${m[2]}${q ? '?' + q : ''}`;
    // one cache entry per poe.ninja URL, whatever else the request carried
    const key = new Request(`https://poe2upgrade.com/ninja-cache/${m[1]}/${m[2]}?${q}`);
    const cache = caches.default;
    const hit = await cache.match(key);
    if (hit) return hit;
    if (!await allowed(env, 'RL_NINJA', request, 'ninja')) return tooMany();
    let res;
    try {
      res = await fetch(target, { headers: { 'User-Agent': UA, Accept: 'application/json' }, cf: { cacheTtl: TTL[m[1]], cacheEverything: true } });
    } catch (err) {
      return new Response(JSON.stringify({ error: 'poe.ninja unreachable' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }
    const body = await res.text();
    const out = new Response(body, {
      status: res.status,
      headers: {
        'Content-Type': 'application/json', // always: never let poe.ninja's answer be read as a page on this site
        'Cache-Control': res.ok ? `public, max-age=${TTL[m[1]]}` : 'no-store',
        'Access-Control-Allow-Origin': '*',
        'X-Proxied-From': 'poe.ninja',
      },
    });
    if (res.ok) ctx.waitUntil(cache.put(key, out.clone()));
    return out;
  }
}
