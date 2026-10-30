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
// POST /api/ping { id, v, p, beta, poe1, poe2 }: one row per install per day. The install id is a
// random number the app made; it's hashed again here, and nothing else is kept: no IP address, no
// account, no character, no items. GET /api/stats?key=… shows the totals (the key is in D1's config).
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
  return json({ ok: true });
}
const esc = (x) => String(x == null ? '' : x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
async function stats(url, env) {
  if (!env.STATS) return new Response('Statistics are not set up.', { status: 503 });
  const row = await env.STATS.prepare("SELECT v FROM config WHERE k = 'stats_key'").first();
  const key = url.searchParams.get('key') || '';
  if (!row || !key || key !== row.v) return new Response('Not found', { status: 404 });
  const since = (days) => new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
  const active = async (days) => env.STATS.prepare(`SELECT COUNT(DISTINCT install) AS all_, COUNT(DISTINCT CASE WHEN poe1 = 1 THEN install END) AS poe1,
      COUNT(DISTINCT CASE WHEN poe2 = 1 THEN install END) AS poe2, COUNT(DISTINCT CASE WHEN poe1 = 1 AND poe2 = 1 THEN install END) AS both_
      FROM pings WHERE day >= ?1`).bind(since(days)).first();
  const [d1, d7, d30] = await Promise.all([active(1), active(7), active(30)]);
  const daily = (await env.STATS.prepare(`SELECT day, COUNT(*) AS n, SUM(poe1) AS poe1, SUM(poe2) AS poe2, SUM(CASE WHEN first_seen = day THEN 1 ELSE 0 END) AS fresh
      FROM pings WHERE day >= ?1 GROUP BY day ORDER BY day DESC`).bind(since(30)).all()).results || [];
  // each install counted once, at the version it was on last (an install that updated was counted under both)
  const versions = (await env.STATS.prepare(`WITH l AS (SELECT install, MAX(day) AS d FROM pings WHERE day >= ?1 GROUP BY install)
      SELECT p.version, COUNT(*) AS n FROM pings p JOIN l ON l.install = p.install AND l.d = p.day GROUP BY p.version ORDER BY n DESC LIMIT 20`).bind(since(7)).all()).results || [];
  // who came back: installs by the day they were first counted, and how many pinged the next day or on any later day
  const cohorts = (await env.STATS.prepare(`WITH f AS (SELECT install, MIN(day) AS d FROM pings GROUP BY install)
      SELECT f.d AS day, COUNT(*) AS n, SUM(EXISTS(SELECT 1 FROM pings p WHERE p.install = f.install AND p.day = date(f.d, '+1 day'))) AS next_day,
      SUM(EXISTS(SELECT 1 FROM pings p WHERE p.install = f.install AND p.day > f.d)) AS later
      FROM f WHERE f.d >= ?1 GROUP BY f.d ORDER BY f.d DESC`).bind(since(30)).all()).results || [];
  const started = await env.STATS.prepare('SELECT MIN(day) AS d FROM pings').first();
  const platforms = (await env.STATS.prepare('SELECT platform, COUNT(DISTINCT install) AS n FROM pings WHERE day >= ?1 GROUP BY platform ORDER BY n DESC').bind(since(7)).all()).results || [];
  const total = await env.STATS.prepare('SELECT COUNT(DISTINCT install) AS n FROM pings').first();
  const today = since(1);
  // came back: of the installs first counted before today, the share seen again on a later day
  const old = cohorts.filter((c) => c.day < today);
  const back = { n: old.reduce((a, c) => a + c.n, 0), later: old.reduce((a, c) => a + c.later, 0) };
  // the next day is only known once it's over: the newest days are "so far"
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const retention = cohorts.map((c) => ({ ...c, pending: c.day >= yesterday }));
  if (url.searchParams.get('format') === 'json') return json({ today: d1, week: d7, month: d30, daily, versions, platforms, ever: total && total.n, since: started && started.d, cameBack: back, retention });
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '–');
  const card = (t, o) => `<div class="c"><h2>${t}</h2><b>${esc(o.all_)}</b><span>PoE2 ${esc(o.poe2)} · PoE1 ${esc(o.poe1)}${o.both_ ? ` · both ${esc(o.both_)}` : ''}</span></div>`;
  const rows = (list, cols) => list.map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c])}</td>`).join('')}</tr>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Usage · PoE Upgrade Checker</title><style>
:root{color-scheme:dark}body{margin:0;padding:24px 16px;background:#0e1013;color:#d8d2c4;font:15px/1.5 system-ui,sans-serif}main{max-width:900px;margin:auto}
h1{font-size:20px;margin:0 0 4px}p{color:#8d8a82;margin:0 0 20px}.g{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:24px}
.c{background:#181b20;border:1px solid #2c3038;border-radius:8px;padding:14px}.c h2{font-size:13px;font-weight:600;color:#8d8a82;margin:0}.c b{display:block;font-size:30px;color:#f1e4c2}.c span{color:#8d8a82;font-size:13px}
table{width:100%;border-collapse:collapse;margin-bottom:24px;font-variant-numeric:tabular-nums}td,th{text-align:left;padding:5px 8px;border-bottom:1px solid #2c3038}th{color:#8d8a82;font-weight:600;font-size:13px}h3{font-size:15px;margin:0 0 6px}p.n{font-size:13px;margin:-2px 0 8px}
</style></head><body><main><h1>PoE Upgrade Checker: active users</h1><p>Installs that sent the anonymous daily ping (users who opted out aren't counted). ${esc(total && total.n)} installs since counting started${started && started.d ? ` on ${esc(started.d)}` : ''}: an install is "new" the first day it's counted, so the first days include people who had it already. Days are UTC.</p>
<div class="g">${card('Today', d1)}${card('Last 7 days', d7)}${card('Last 30 days', d30)}<div class="c"><h2>Came back</h2><b>${pct(back.later, back.n)}</b><span>${esc(back.later)} of ${esc(back.n)} installs used it again on a later day</span></div></div>
<h3>Each day</h3><table><tr><th>Day</th><th>Active</th><th>PoE2</th><th>PoE1</th><th>New installs</th></tr>${rows(daily, ['day', 'n', 'poe2', 'poe1', 'fresh'])}</table>
<h3>Came back, by the day they were first counted</h3><p class="n">Of the installs first counted that day, how many used it again the next day, and on any day since. The newest days are still filling up.</p><table><tr><th>First day</th><th>Installs</th><th>Next day</th><th>Any later day</th></tr>${retention.map((c) => `<tr><td>${esc(c.day)}</td><td>${esc(c.n)}</td><td>${c.day >= today ? '–' : `${esc(c.next_day)} (${pct(c.next_day, c.n)})${c.pending ? ' so far' : ''}`}</td><td>${c.day >= today ? '–' : `${esc(c.later)} (${pct(c.later, c.n)})`}</td></tr>`).join('')}</table>
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
    if (url.pathname === '/download' || url.pathname === '/download/') return download(ctx);
    if (url.pathname === '/api/stats') {
      if (!await allowed(env, 'RL_STATS', request, 'stats')) return tooMany();
      return stats(url, env).catch(() => new Response('Error', { status: 500 }));
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
