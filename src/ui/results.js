'use strict';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n, d = 1) => { const r = Math.round(n * 10 ** d) / 10 ** d; return (r > 0 ? '+' : '') + r; };
let data = null;

function label(key, diff) {
  key = String(key).replace(/^\[(Base|Weapon)\]\s*/, '').replace(/\s*\(Local\)\s*$/i, ''); // internal tags, not game text
  let first = true;
  const t = key.includes('#') ? key.replace(/#/g, () => { if (first) { first = false; return fmt(diff); } return '…'; }) : `${fmt(diff)} ${key}`;
  return t.replace(/^\+\+/, '+').replace(/^\+-/, '-');
}

const VERDICT = {
  upgrade: ['UPGRADE', 'up'], small: ['SMALL UPGRADE', 'up'], risky: ['UPGRADE, BUT…', 'risky'], resloss: ['LOSES RESISTANCE', 'down'], dmgloss: ['LOSES DAMAGE', 'down'], downgrade: ['DOWNGRADE', 'down'], same: ['SIDEGRADE', 'same'],
  new: ['EMPTY SLOT', 'new'], equipped: ['EQUIPPED', 'same'], unjudged: ['NOT JUDGED', 'same'],
};

// PoE2: the same price in chaos orbs too
function chaosOf(priceEx, currency) {
  const c = Number(data.chaosRate);
  if (!(c > 0) || !(priceEx > 0) || currency === 'chaos') return '';
  const v = priceEx / c;
  return `${v < 10 ? Math.round(v * 10) / 10 : Math.round(v).toLocaleString('en')} chaos`;
}
function dual(p, priceEx) {
  const t = dual0(p, priceEx); const ch = chaosOf(priceEx, p.currency);
  return ch ? (t ? `${t} · ${ch}` : `≈ ${ch}`) : t;
}
function dual0(p, priceEx) {
  const a = Number(p.amount); const d = Number(data.divineRate);
  const base = data.game === 'poe1' ? 'chaos' : 'exalted'; // the everyday currency
  if (!(d > 0)) return p.currency !== base && priceEx > 0 ? `≈ ${Math.round(priceEx).toLocaleString('en')} ${data.unit || 'ex'}` : '';
  if (p.currency === 'divine') return `≈ ${Math.round(a * d).toLocaleString('en')} ${data.unit || 'ex'}`;
  if (p.currency === base) return `≈ ${Math.round((a / d) * 100) / 100} div`;
  // another currency (PoE1 exalts, alchs…): what it comes to in the everyday currency
  if (priceEx > 0) return `≈ ${Math.round(priceEx).toLocaleString('en')} ${data.unit || 'ex'}`;
  return '';
}

const num = (v) => (v == null || Number.isNaN(Number(v)) ? -1e9 : Number(v)); // 0 is a real value

function valueRank(x) {
  const g = x.compare && x.compare.delta;
  if (!(g > 0)) return -1e9;
  const div = data && data.divineRate > 0 && x.priceEx > 0 ? x.priceEx / data.divineRate : null;
  return div ? g - 10 * Math.log10(Math.max(div, 0.01)) : g - 1e6;
}
function sorted(list) {
  const mode = $('#sort').value;
  const rank = (x) => (x.compare && x.compare.resRank) || 0;
  // items that lose resistance or damage go below everything else when sorting by upgrade or value
  const lost = (x) => (x.compare && (x.compare.verdict === 'resloss' || x.compare.verdict === 'dmgloss') ? 1 : 0);
  let by = {
    // caps a resistance you're short of → adds toward the cap → no change → loses resistance; then best upgrade
    res: (a, b) => (rank(b) - rank(a)) || (num(b.compare && b.compare.delta) - num(a.compare && a.compare.delta)),
    upgrade: (a, b) => (lost(a) - lost(b)) || (num(b.compare && b.compare.delta) - num(a.compare && a.compare.delta)),
    // best value, Path of Building's way: the gain minus 10 points for each tenfold of the price in
    // divines (gain per divine put every 1-ex listing on top)
    value: (a, b) => (lost(a) - lost(b)) || (valueRank(b) - valueRank(a)),
    price: (a, b) => ((a.priceEx != null ? a.priceEx : 1e15) - (b.priceEx != null ? b.priceEx : 1e15)),
    gear: (a, b) => ((b.gear && b.gear.score != null ? b.gear.score : -1) - (a.gear && a.gear.score != null ? a.gear.score : -1)),
    site: () => 0,
  }[mode];
  // sellers you can buy from now come first (an offline seller can't answer a whisper)
  const away = (x) => (!x.instant && !x.online ? 1 : 0);
  // the listing you picked (from Where to spend) stays on top, whatever the order
  const focus = data && data.focusId;
  const top = (x) => (focus && x.id === focus ? 1 : 0);
  const by0 = by; by = (a, b) => (top(b) - top(a)) || (mode === 'site' ? 0 : away(a) - away(b)) || by0(a, b);
  let out = (list || []).map((x, i) => ({ ...x, _i: i }));
  if ($('#noCorrupt').checked) out = out.filter((x) => !(x.item && x.item.corrupted));
  if ($('#onlyUp').checked) out = out.filter((x) => x.compare && (['upgrade', 'small', 'risky', 'new'].includes(x.compare.verdict)));
  out = out.sort((a, b) => by(a, b) || a._i - b._i);
  if ($('#onePerSeller').checked) { const seen = new Set(); out = out.filter((x) => { const k = x.account || x.seller || x.id; if (seen.has(k)) return false; seen.add(k); return true; }); }
  return out;
}

// the listing that gives most for your build per divine, and the biggest upgrade (among ones you can buy now)
let best = { value: null, up: null };
function pickBest(list) {
  const ok = list.filter((x) => x.compare && x.compare.delta > 0 && !['resloss', 'dmgloss'].includes(x.compare.verdict) && (x.instant || x.online));
  const top = (f) => ok.reduce((m, x) => (f(x) != null && (m == null || f(x) > f(m)) ? x : m), null);
  const v = top((x) => x.valuePerDiv); const u = top((x) => x.compare.delta);
  best = { value: v && v.id, up: u && u.id };
}
function card(x) {
  const it = x.item;
  const c = x.compare;
  const [vt, vc] = c ? (VERDICT[c.verdict] || VERDICT.same) : ['?', 'same'];
  const lines = (it ? it.lines : []).filter((l) => l.tag !== 'info');
  const mods = window.modsHtml ? window.modsHtml(lines) : lines.map((l) => `<div class="mod ${esc(l.tag)}">${esc(l.text)}</div>`).join('');
  const gearMode = c && (c.scoreMode === 'gear' || c.scoreMode === 'pob');
  const n = modCount();
  const changed = c ? c.rows.filter((r) => r.diff) : [];
  const rows = c ? changed.slice(0, n).map((r) => {
    const useful = gearMode ? r.useful > 0 : !!r.weight;
    const cls = !useful ? 'unweighted' : (gearMode ? r.diff > 0 : r.impact > 0) ? 'pos' : 'neg';
    return `<span class="chg ${cls}">${esc(label(r.key, r.diff))}</span>`;
  }).join('') : '';
  const loss = c && (c.verdict === 'dmgloss' || c.verdict === 'resloss');
  const value = x.valuePerDiv != null && Math.abs(x.valuePerDiv) >= 0.05 && c && c.delta > 0 && !loss ? `<span class="value" title="${c && c.scoreMode === 'pob' ? 'Path of Building points for your build' : gearMode ? 'Gear score points gained' : 'Upgrade score'} per divine spent">${fmt(x.valuePerDiv, 1)} / div</span>` : '';
  const rr = c ? c.resRank || 0 : 0;
  const offline = !x.instant && !x.online;
  const ribbons = [data && data.focusId === x.id ? '<span class="ribbon pick">You picked this</span>' : '', best.up === x.id ? '<span class="ribbon">Biggest upgrade</span>' : '', best.value === x.id ? '<span class="ribbon">Best value</span>' : ''].filter(Boolean).join('');
  return `<article class="listing ${rr < 0 ? 'res-loss' : rr === 2 ? 'res-cap-item' : ''} ${offline ? 'offline' : ''}">${ribbons ? `<div class="ribbons">${ribbons}</div>` : ''}
    <div class="l-top">
      <div>
        <div class="name ${esc(((it && it.rarity) || '').toLowerCase())}">${esc(it ? it.name : 'Unreadable listing')}</div>
        <div class="dim">${esc(it && it.baseType !== it.name ? it.baseType : '')}${it && it.itemLevel ? ` · ilvl ${it.itemLevel}` : ''}${it && it.corrupted ? ' · <span class="corrupt-tag" title="Corrupted: it can\'t be changed with currency any more">Corrupted</span>' : ''}</div>
      </div>
      <div class="l-price">
        <div class="price">${esc(x.priceText)}</div>
        ${x.price && dual(x.price, x.priceEx) ? `<div class="dim">${esc(dual(x.price, x.priceEx))}</div>` : ''}
        <div class="dim">${x.instant ? 'Instant buyout' : `${x.online ? '<span class="dot on"></span>online' : '<span class="dot"></span>offline'} · ${esc(x.seller)}`}</div>
      </div>
    </div>
    ${c ? `<div class="verdict ${vc}"><span class="badge">${vt}</span><span class="score">${c.verdict === 'new' || c.delta == null || (loss && c.delta > 0) ? '' : c.scoreMode === 'pob' ? `<span title="${window.POB_SCORE_TIP || ''}">${esc(fmt(c.delta, 1))} pts <small>for your build</small></span>` : gearMode ? `${esc(fmt(c.delta, 0))} <small>gear score</small>` : esc(fmt(c.delta))}${!gearMode && c.pct != null && c.verdict !== 'equipped' ? ` <small>(${esc(fmt(c.pct))}%)</small>` : ''}</span>${value}<span class="dim">vs ${esc((c.replacing || []).join(' + ') || c.targetSlot)}</span></div>` : ''}
    ${x.gear && x.gear.score != null && !(c && c.pob) ? `<div class="gear"><span class="gs g-${esc(x.gear.grade)}" title="Gear score: how good it is for your build in this slot, 0–100">${x.gear.score} ${esc(x.gear.grade)}</span> <span>Gear score${x.gearEquipped != null ? ` · yours ${x.gearEquipped} <b class="${x.gear.score > x.gearEquipped ? 'pos' : x.gear.score < x.gearEquipped ? 'neg' : ''}">(${x.gear.score - x.gearEquipped > 0 ? '+' : ''}${x.gear.score - x.gearEquipped})</b>` : ''}</span>${x.gear.missing && x.gear.missing.length ? ` <span class="dim">missing ${esc(x.gear.missing.join(', '))}</span>` : ''} <button class="link gear-why" data-why="${esc(x.id)}">why?</button></div>
      <div class="gear-detail hidden" data-whybox="${esc(x.id)}">${window.gearCompareHtml ? window.gearCompareHtml(x.gear, x.gearEquippedDetail) : ''}</div>` : ''}
    ${rows ? `<div class="chgs">${rows}${changed.length > n ? `<span class="dim">+${changed.length - n} more</span>` : ''}</div>` : ''}
    ${c && c.pob && window.pobBlock ? window.pobBlock(c.pob) : c && window.characterBlock ? window.characterBlock(c.character, { risks: c.risks }) : ''}
    <details><summary>Item mods</summary>${mods}</details>
    <div class="actions">
      ${x.instant ? `<button class="primary gilded" data-hideout="${esc(x.id)}" title="${data.signedIn ? 'Asks the trade site to take you to the seller\'s hideout, straight from here' : 'Takes you to the seller\'s hideout from here – you sign in to pathofexile.com once the first time'}">Travel to hideout</button>` : ''}
      ${x.whisper ? `<button class="${offline ? '' : 'primary gilded'}" data-whisper="${esc(x.id)}" title="${offline ? 'The seller is offline: they won\'t see a whisper until they come back' : 'Copies the seller\'s whisper – paste it in game chat with Enter, Ctrl+V'}">${offline ? 'Copy whisper (seller offline)' : 'Copy whisper'}</button>` : ''}
      <button class="link" data-listing="${esc(x.id)}" title="Opens the trade site in your browser on just this seller's listing">on trade site ↗</button>
    </div>
  </article>`;
}

function render() {
  if (!data) return;
  $('#title').textContent = data.title || 'Trade results';
  const bt = document.getElementById('betaTag');
  if (bt) bt.classList.toggle('hidden', !data.gameBeta);
  $('#gsHelpBtn').textContent = data.pobOn || data.game === 'poe1' ? 'How are items judged?' : "What's the gear score?";
  $('#hideHint').textContent = `Esc hides${data.resultsHotkey ? ` · ${data.resultsHotkey} reopens` : ''}`;
  const ups = (data.listings || []).filter((x) => x.compare && ['upgrade', 'small', 'risky', 'new'].includes(x.compare.verdict)).length;
  const losing = (data.listings || []).filter((x) => x.compare && x.compare.verdict === 'resloss').length;
  const dmgLosing = (data.listings || []).filter((x) => x.compare && x.compare.pob && x.compare.pob.dmgLoss).length;
  const capping = (data.listings || []).filter((x) => x.compare && x.compare.resRank === 2).length;
  $('#sub').textContent = data.total == null ? (data.league || '') : `${data.league} · ${data.total} listing${data.total === 1 ? '' : 's'} · showing ${data.shown}${data.listings && data.listings.length ? ` · ${ups} upgrade${ups === 1 ? '' : 's'} for you${capping ? ` · ${capping} cap a resistance` : ''}${losing ? ` · ${losing} lose resistance` : ''}${dmgLosing ? ` · ${dmgLosing} lose damage` : ''}` : ''}${data.divineRate ? ` · 1 div ≈ ${data.divineRate} ${data.unit || 'ex'}` : ''}`;
  $('#note').textContent = [data.otherGame, data.note].filter(Boolean).join(' ');
  if (data.priceSummary) {
    $('#priceBanner').classList.remove('hidden');
    const ps = data.priceSummary;
    $('#priceBanner').innerHTML = (ps.typical
      ? `Typical <b>${esc(ps.typical)}</b>${window.confHtml ? window.confHtml(ps.confidence) : ''}${ps.range ? ` · most <b>${esc(ps.range)}</b>` : ''} · cheapest <b>${esc(ps.cheapest)}</b>${ps.sell ? ` · list at <b>${esc(ps.sell.text)}</b> <button class="link" id="copyPriceNote" data-note="${esc(ps.sell.note)}">Copy price note</button>` : ''}`
      : `<b>${esc(ps.verdict || 'No price')}</b>`)
      + ` <span class="dim">(each seller's cheapest: ${ps.sellers} seller${ps.sellers === 1 ? '' : 's'} in ${ps.total} listings loaded)</span>`
      + (ps.notes && ps.notes.length ? `<div class="dim small">${esc(ps.notes.join(' · '))}</div>` : '');
    const cpn = $('#copyPriceNote');
    if (cpn) cpn.addEventListener('click', () => { window.api.copyText(cpn.dataset.note); cpn.textContent = 'Copied'; });
  } else $('#priceBanner').classList.add('hidden');
  $('#save').textContent = data.saved ? '★ Saved' : '☆ Save search';
  $('#save').disabled = !!data.saved;
  const all = data.listings || [];
  const list = sorted(all);
  pickBest(list);
  // a failed search or fetch must not leave the previous search's listings on screen
  $('#list').innerHTML = data.error ? `<div class="note">${esc(data.error)}</div>`
    : list.map(card).join('') || `<div class="note">${!all.length && data.total ? 'The listings couldn\'t be loaded. Use Open on trade site to see them in your browser.' : !all.length ? 'Nothing listed.' : `None of the ${all.length} loaded listings ${$('#onlyUp').checked ? 'is an upgrade' : 'is left'}. Untick ${[$('#onlyUp').checked && '<b>Upgrades only</b>', $('#noCorrupt').checked && '<b>Hide corrupted</b>'].filter(Boolean).join(' or ')}${data.more ? ', or load more' : ''}.`}</div>`;
  $('#more').classList.toggle('hidden', !data.more || !!data.error);
  $('#site').disabled = !data.url;
  $('#save').classList.toggle('hidden', !!data.error);
  if (window.bindGearWhy) window.bindGearWhy(document);
  document.querySelectorAll('[data-whisper]').forEach((b) => b.addEventListener('click', () => {
    const x = data.listings.find((l) => l.id === b.dataset.whisper);
    window.api.copyText(x.whisper);
    b.textContent = 'Copied – paste in game chat';
  }));
  document.querySelectorAll('[data-listing]').forEach((b) => b.addEventListener('click', async () => {
    const r = await window.api.openListing(b.dataset.listing);
    if (r && r.ok) b.textContent = 'Opened in your browser';
  }));
  document.querySelectorAll('[data-hideout]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true; b.textContent = 'Asking the trade site…';
    let r = await window.api.hideout(b.dataset.hideout).catch((err) => ({ ok: false, error: (err && err.message) || String(err) }));
    if (r && r.needSignIn) {
      b.textContent = 'Sign in to pathofexile.com…';
      const s = await window.api.signIn().catch(() => null);
      if (s && s.signedIn) { data.signedIn = true; b.textContent = 'Asking the trade site…'; r = await window.api.hideout(b.dataset.hideout).catch((err) => ({ ok: false, error: (err && err.message) || String(err) })); }
      else r = { ok: false, error: 'Not signed in – click "on trade site" to buy it from your browser.' };
    }
    b.disabled = false;
    const old = b.parentNode.querySelector('.note'); if (old) old.remove();
    b.textContent = r.ok ? 'Sent – check the game' : 'Travel to hideout';
    if (!r.ok) { const n = document.createElement('span'); n.className = 'note'; n.textContent = ' ' + r.error; b.after(n); }
  }));
}

// colour-blind palette, same setting as the popup and the app pages
function applyColorblind() {
  window.api.getState().then((st) => { document.body.classList.toggle('cb', !!(st && st.settings && st.settings.colorblind)); }).catch(() => {});
}
applyColorblind();

window.api.onResults((d) => {
  data = d || { error: 'No results.' };
  applyColorblind();
  $('#moreMsg').textContent = '';
  // price checks read best cheapest-first; upgrade searches best-upgrade-first
  $('#sort').value = data.mode === 'price' ? 'price' : data.resFirst ? 'res' : 'upgrade';
  render();
  window.scrollTo(0, 0);
});
$('#sort').addEventListener('change', render);
$('#onlyUp').addEventListener('change', render);
// remembered in this window only (per computer): a convenience, not a setting
try { $('#noCorrupt').checked = localStorage.getItem('noCorrupt') === '1'; } catch (_) { /* ignore */ }
try { $('#onePerSeller').checked = localStorage.getItem('onePerSeller') === '1'; } catch (_) { /* ignore */ }
$('#onePerSeller').addEventListener('change', () => { try { localStorage.setItem('onePerSeller', $('#onePerSeller').checked ? '1' : '0'); } catch (_) { /* ignore */ } render(); });
$('#noCorrupt').addEventListener('change', () => { try { localStorage.setItem('noCorrupt', $('#noCorrupt').checked ? '1' : '0'); } catch (_) { /* ignore */ } render(); });
function modCount() { const v = $('#modCount').value; return v === 'all' ? 1e9 : Number(v) || 4; }
try { const v = localStorage.getItem('modCount'); if (v && [...$('#modCount').options].some((o) => o.value === v)) $('#modCount').value = v; else $('#modCount').value = '4'; } catch (_) { $('#modCount').value = '4'; }
$('#modCount').addEventListener('change', () => { try { localStorage.setItem('modCount', $('#modCount').value); } catch (_) {} render(); });
$('#site').addEventListener('click', () => data && window.api.openUrl(data.url));
$('#save').addEventListener('click', async () => {
  const r = await window.api.saveSearch(data.title);
  if (r && r.ok) { data.saved = true; render(); }
});
$('#more').addEventListener('click', async () => {
  $('#more').disabled = true; $('#moreMsg').textContent = 'Loading…';
  const d = await window.api.resultsMore().catch((err) => ({ error: (err && err.message) || String(err) }));
  $('#more').disabled = false;
  if (d && d.error) { $('#moreMsg').textContent = d.error; return; }
  $('#moreMsg').textContent = '';
  if (d) { data = d; render(); }
});
window.api.onChanged(async () => { applyColorblind(); const d = await window.api.resultsRescore(); if (d) { data = d; render(); } });

// Esc hides the results window; bring it back with the results hotkey (Ctrl+Shift+D) or a new search.
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.api.hideResults(); });

// "What's the gear score?" panel
window.showGearHelp = () => {
  const p = $('#gsHelp');
  p.innerHTML = window.gearExplainHtml({ where: 'Build & stats page of the main window', pobOn: data && data.pobOn, game: data && data.game });
  p.classList.remove('hidden');
  p.scrollIntoView({ block: 'nearest' });
};
$('#gsHelpBtn').addEventListener('click', () => {
  const p = $('#gsHelp');
  if (p.classList.contains('hidden')) window.showGearHelp(); else p.classList.add('hidden');
});
