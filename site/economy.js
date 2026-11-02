// poe2upgrade.com/economy/: the currency exchange prices of a league, from the site's own poe.ninja
// cache (/ninja/<game>/exchange/all, worker/site-worker.js), so a visit costs poe.ninja nothing extra.
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var NAMES = { // poe.ninja's list names, as players say them
    Currency: 'Currency', Fragments: 'Fragments', Fragment: 'Fragments', Abyss: 'Abyss', UncutGems: 'Uncut gems', LineageSupportGems: 'Lineage gems', Essences: 'Essences', Essence: 'Essences',
    SoulCores: 'Soul cores', Idols: 'Idols', Runes: 'Runes', Ritual: 'Omens & ritual', Expedition: 'Expedition', Delirium: 'Delirium', Breach: 'Breach', Verisium: 'Verisium',
    Runegraft: 'Runegrafts', AllflameEmber: 'Allflame embers', Tattoo: 'Tattoos', Omen: 'Omens', DjinnCoin: 'Djinn coins', Ducat: 'Ducats', EnshroudingCrystal: 'Crystals',
    DivinationCard: 'Divination cards', Artifact: 'Artifacts', Oil: 'Oils', DeliriumOrb: 'Delirium orbs', Scarab: 'Scarabs', Astrolabe: 'Astrolabes', Fossil: 'Fossils', Resonator: 'Resonators',
  };
  var st = { game: 'poe2', league: null, cat: null, sort: 'value', dir: -1, q: '', data: null };
  try { var saved = JSON.parse(localStorage.getItem('eco') || '{}'); if (saved.game === 'poe1' || saved.game === 'poe2') st.game = saved.game; } catch (e) { /* no storage */ }
  function remember() { try { localStorage.setItem('eco', JSON.stringify({ game: st.game })); } catch (e) { /* no storage */ } }

  function getJson(url) { return fetch(url, { headers: { Accept: 'application/json' } }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); }
  function leaguesOf(j) {
    var list = Array.isArray(j) ? j : (j && (j.economyLeagues || j.leagues)) || [];
    return list.map(function (l) { return typeof l === 'string' ? { name: l, label: l } : { name: l.name || l.id, label: l.displayName || l.name || l.id }; }).filter(function (l) { return l.name; });
  }

  // one row per item: its value in the league's main currency, in divines, its 7-day change and volume
  function rows(types) {
    var out = [];
    Object.keys(types || {}).forEach(function (t) {
      var d = types[t];
      if (!d || !Array.isArray(d.lines)) return;
      var core = d.core || {};
      var items = {};
      (core.items || []).concat(d.items || []).forEach(function (i) { items[i.id] = i; });
      var divRate = core.rates && Number(core.rates.divine);
      d.lines.forEach(function (l) {
        var it = items[l.id];
        var v = Number(l.primaryValue);
        if (!it || !it.name || !(v > 0)) return;
        var s = l.sparkline || l.sparkLine;
        var ch = s && Number(s.totalChange);
        out.push({ cat: t, name: it.name, value: v, primary: core.primary || '', div: divRate > 0 ? v * divRate : null, change: isFinite(ch) ? ch : null,
          spark: s && Array.isArray(s.data) ? s.data : [], volume: Number(l.volumePrimaryValue) || 0 });
      });
    });
    return out;
  }
  var unitName = function (p) { return { exalted: 'ex', chaos: 'c', divine: 'div' }[p] || p; };
  function num(v) {
    if (v == null) return '–';
    if (v >= 1000) return Math.round(v).toLocaleString('en');
    if (v >= 10) return String(Math.round(v * 10) / 10);
    if (v >= 0.1) return String(Math.round(v * 100) / 100);
    return v.toPrecision(2);
  }
  function chg(c) { return c == null ? '<span class="dim">–</span>' : '<span class="' + (c > 0.5 ? 'up' : c < -0.5 ? 'dn' : 'dim') + '">' + (c > 0 ? '+' : '') + Math.round(c) + '%</span>'; }
  function spark(d) {
    var p = d.filter(function (x) { return x != null && isFinite(x); });
    if (p.length < 2) return '';
    var min = Math.min.apply(null, p); var max = Math.max.apply(null, p); var w = 60; var h = 16;
    var pts = d.map(function (x, i) { return x == null ? null : (i * w / (d.length - 1)).toFixed(1) + ',' + (h - ((x - min) / ((max - min) || 1)) * h).toFixed(1); }).filter(Boolean).join(' ');
    return '<svg class="spark" viewBox="0 0 60 16" width="60" height="16" aria-hidden="true"><polyline points="' + pts + '" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
  }

  function renderMovers(all) {
    var box = $('#ecoMovers');
    // moved most this week, among items people actually trade (top half by volume)
    var vols = all.map(function (r) { return r.volume; }).sort(function (a, b) { return a - b; });
    var minVol = vols.length ? vols[Math.floor(vols.length / 2)] : 0;
    var liquid = all.filter(function (r) { return r.change != null && r.volume >= minVol && r.volume > 0; });
    var up = liquid.slice().sort(function (a, b) { return b.change - a.change; }).slice(0, 5).filter(function (r) { return r.change > 0; });
    var dn = liquid.slice().sort(function (a, b) { return a.change - b.change; }).slice(0, 5).filter(function (r) { return r.change < 0; });
    var li = function (r) { return '<li><span>' + esc(r.name) + '</span> ' + chg(r.change) + ' <span class="dim">' + num(r.value) + ' ' + esc(unitName(r.primary)) + '</span></li>'; };
    box.innerHTML = (up.length ? '<div class="mv frame"><h3>Rising this week</h3><ol>' + up.map(li).join('') + '</ol></div>' : '') +
      (dn.length ? '<div class="mv frame"><h3>Falling this week</h3><ol>' + dn.map(li).join('') + '</ol></div>' : '');
  }

  function renderTabs(all) {
    var cats = [];
    all.forEach(function (r) { if (cats.indexOf(r.cat) < 0) cats.push(r.cat); });
    if (!st.cat || (st.cat !== 'all' && cats.indexOf(st.cat) < 0)) st.cat = cats[0] || 'all';
    $('#ecoTabs').innerHTML = ['all'].concat(cats).map(function (c) {
      return '<button class="btn small" role="tab" data-cat="' + esc(c) + '" aria-selected="' + (c === st.cat) + '">' + esc(c === 'all' ? 'All' : NAMES[c] || c) + '</button>';
    }).join('');
  }

  function renderTable() {
    var all = rows(st.data && st.data.types);
    var q = st.q.trim().toLowerCase();
    var list = all.filter(function (r) { return (q ? r.name.toLowerCase().indexOf(q) >= 0 : st.cat === 'all' || r.cat === st.cat); });
    list.sort(function (a, b) {
      var k = st.sort; var x = a[k]; var y = b[k];
      if (k === 'name') return st.dir * String(x).localeCompare(String(y));
      return st.dir * ((x == null ? -Infinity : x) - (y == null ? -Infinity : y));
    });
    document.querySelectorAll('#ecoTable th').forEach(function (th) { th.setAttribute('aria-sort', th.dataset.sort === st.sort ? (st.dir > 0 ? 'ascending' : 'descending') : 'none'); });
    $('#ecoTable tbody').innerHTML = list.length ? list.slice(0, 400).map(function (r) {
      return '<tr><td>' + esc(r.name) + (q ? ' <span class="dim small">' + esc(NAMES[r.cat] || r.cat) + '</span>' : '') + '</td><td class="r">' + num(r.value) + ' <span class="dim">' + esc(unitName(r.primary)) + '</span></td>' +
        '<td class="r">' + (r.div == null ? '–' : num(r.div)) + '</td><td class="r">' + spark(r.spark) + ' ' + chg(r.change) + '</td><td class="r dim">' + (r.volume ? num(r.volume) : '–') + '</td></tr>';
    }).join('') : '<tr><td colspan="5" class="dim">' + (st.data && st.data.error ? esc(st.data.error) : 'Nothing found.') + '</td></tr>';
  }

  function render() {
    var all = rows(st.data && st.data.types);
    renderTabs(all);
    renderMovers(all);
    renderTable();
    var cur = all.find(function (r) { return /^divine orb$/i.test(r.name); });
    var chaos = all.find(function (r) { return /^chaos orb$/i.test(r.name); });
    $('#ecoRate').innerHTML = cur ? 'Divine Orb: <b>' + num(cur.value) + ' ' + esc(unitName(cur.primary)) + '</b>' + (chaos && cur.primary !== 'chaos' ? ' · Chaos Orb: <b>' + num(chaos.value) + ' ' + esc(unitName(chaos.primary)) + '</b>' : '') : '';
    $('#ecoSub').textContent = st.league ? 'in ' + st.league + ' (' + (st.game === 'poe2' ? 'PoE2' : 'PoE1') + ')' : 'for the current league';
  }

  function loadLeague() {
    $('#ecoTable tbody').innerHTML = '<tr><td colspan="5" class="dim">Loading prices…</td></tr>';
    return getJson('/ninja/' + st.game + '/exchange/all?league=' + encodeURIComponent(st.league)).then(function (d) { st.data = d; render(); })
      .catch(function () { st.data = { types: {}, error: "Couldn't load the prices just now. Try again in a minute." }; render(); });
  }
  function loadGame() {
    document.querySelectorAll('[data-game]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.game === st.game)); });
    st.cat = null;
    return getJson('/ninja/' + st.game + '/leagues').then(function (j) {
      var ls = leaguesOf(j);
      $('#ecoLeague').innerHTML = ls.map(function (l) { return '<option value="' + esc(l.name) + '">' + esc(l.label) + '</option>'; }).join('');
      st.league = ls.length ? ls[0].name : null;
      if (!st.league) throw new Error('no leagues');
      return loadLeague();
    }).catch(function () { st.data = { types: {}, error: "Couldn't load the leagues just now. Try again in a minute." }; render(); });
  }

  document.querySelectorAll('[data-game]').forEach(function (b) { b.addEventListener('click', function () { if (st.game !== b.dataset.game) { st.game = b.dataset.game; remember(); loadGame(); } }); });
  $('#ecoLeague').addEventListener('change', function (e) { st.league = e.target.value; loadLeague(); });
  $('#ecoSearch').addEventListener('input', function (e) { st.q = e.target.value; renderTable(); });
  $('#ecoTabs').addEventListener('click', function (e) { var b = e.target.closest('[data-cat]'); if (b) { st.cat = b.dataset.cat; st.q = ''; $('#ecoSearch').value = ''; renderTabs(rows(st.data && st.data.types)); renderTable(); } });
  document.querySelectorAll('#ecoTable th').forEach(function (th) {
    th.tabIndex = 0;
    var go = function () { if (st.sort === th.dataset.sort) st.dir = -st.dir; else { st.sort = th.dataset.sort; st.dir = th.dataset.sort === 'name' ? 1 : -1; } renderTable(); };
    th.addEventListener('click', go);
    th.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  loadGame();
})();
