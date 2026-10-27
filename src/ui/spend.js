'use strict';
/* global window, document */

// Where to spend: every slot searched within your budget and checked with your build, ranked by
// how much each upgrade gives you per divine; plus pairs of items that cap your resistances.
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const n1 = (v) => (v == null || !Number.isFinite(Number(v)) ? '–' : (Math.round(v * 10) / 10).toLocaleString('en'));
  const div = (v) => (v == null ? '' : v >= 10 ? `${Math.round(v)} div` : `${Math.round(v * 100) / 100} div`);
  const body = () => $('#spendBody');
  let running = false;
  let live = []; let liveMode = null; let shown = null; // rows as they arrive; the run on show

  // the alert's price: chaos in PoE1 (what most things cost there), divines in PoE2
  function alertPrice(run, b) {
    if (run.unit === 'chaos') return b && b.priceEx ? Math.ceil(b.priceEx) : 50;
    return b && b.priceDiv ? Math.max(0.1, Math.ceil(b.priceDiv * 10) / 10) : 1;
  }
  function render(run, msg) {
    shown = run || shown;
    if (!run) { if (msg) body().innerHTML = `<div class="card-p note">${esc(msg)}</div>`; return; }
    const rows = run.rows || [];
    const gs = run.mode === 'gear'; // without Path of Building: gear score points instead of % for your build
    const gain = (v) => (gs ? `+${n1(v)} gear score` : `+${n1(v)} pts`);
    const per = (v) => `${n1(v)} pts`;
    const withBest = rows.filter((r) => r.best);
    const top = withBest[0];
    // when it ran: the time today, else the day too ("Sat 18:42")
    const stamp = (t) => { if (!t) return ''; const d = new Date(t); const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`; };
    const when = stamp(run.at);
    const ageH = run.at ? (Date.now() - run.at) / 3600000 : 0;
    const prevBest = run.prevBest || {};
    const changed = new Set(run.changed || []);
    // this slot's best value against your last run: cheaper, better, gone…
    const trend = (r) => {
      const was = prevBest[r.slot]; const b = r.best;
      if (!was || !b || was.perDiv == null || b.perDiv == null) return '';
      const ch = (b.perDiv - was.perDiv) / Math.max(was.perDiv, 0.01);
      if (Math.abs(ch) < 0.1) return '';
      return ` <span class="${ch > 0 ? 'pos' : 'neg'} small" title="Last run (${esc(stamp(run.prevAt))}): ${esc(gain(was.gain))} for ${esc(was.price)}">${ch > 0 ? '▲ better value' : '▼ worse value'} than last time</span>`;
    };
    // every slot failed for the same reason (e.g. no damage skill set in Path of Building): say it once
    const errs = rows.map((r) => r.error).filter(Boolean);
    const sameErr = !run.partial && rows.length > 1 && errs.length === rows.length && errs.every((e) => e === errs[0]) ? errs[0] : null;
    if (sameErr) {
      body().innerHTML = `<div class="card-p note">${esc(sameErr)}</div><div class="card-p dim">From the search at ${esc(when)}${run.reused ? ' (kept for 30 minutes)' : ''}. <button class="link" id="spendAgain">Search again now</button></div><div class="row"><button class="primary" data-goto-gear>Go to My gear</button></div>`;
      const g = body().querySelector('[data-goto-gear]');
      if (g) g.addEventListener('click', () => document.querySelector('.tabs button[data-tab="gear"]').click());
      body().querySelector('#spendAgain').addEventListener('click', () => go(true));
      return;
    }
    const headline = run.partial ? '' : top
      ? `<div class="card-p spend-top"><h3>Best value: ${esc(top.slot)}</h3>
          <p><b>${esc(top.best.name)}</b> for ${esc(top.best.price)}: <b class="pos">${gain(top.best.gain)}</b> for your build${top.best.perDiv != null ? ` · <b>${per(top.best.perDiv)} per divine</b>` : ''}.</p>
          ${withBest[1] ? `<p class="dim">Next: ${esc(withBest[1].slot)} (${gain(withBest[1].best.gain)} for ${esc(withBest[1].best.price)})${withBest[2] ? `, then ${esc(withBest[2].slot)} (${gain(withBest[2].best.gain)} for ${esc(withBest[2].best.price)})` : ''}.</p>` : ''}
        </div>`
      : '<div class="card-p note">Nothing in your price range is an upgrade for your build. Try a higher maximum on Find upgrades.</div>';
    // a listing's name opens it in the results window (first, then the rest of that slot's search)
    const pickLink = (r, c, bold) => (c.listingId && r.searched ? `<button class="link spend-pick${bold ? ' b' : ''}" data-slot="${esc(r.slot)}" data-id="${esc(c.listingId)}" title="Show this listing (the trade site's own search, this one first)">${esc(c.name)}</button>` : bold ? `<b>${esc(c.name)}</b>` : esc(c.name));
    const row = (r) => {
      const b = r.best; const big = r.biggest && r.biggest !== b && r.biggest.name !== (b && b.name) ? r.biggest : null;
      const what = r.error ? `<span class="${r.soft ? 'dim' : 'neg'}">${esc(r.error)}</span>`
        : b ? `${pickLink(r, b, true)} <span class="dim">${esc(b.base || '')}</span>${b.socket ? `<br><span class="small">goes in ${esc(b.socket.label)}${b.socket.replacing ? ` in place of ${esc(b.socket.replacing)}` : ' (empty now)'}</span>` : ''}<br><span class="pos">${gain(b.gain)}</span> for ${esc(b.price)}${b.risks && b.risks.length ? ` <span class="warn" title="${esc(b.risks.join('; '))}">⚠ ${esc(b.risks[0])}</span>` : ''}${big ? `<br><span class="dim">Biggest gain: ${gain(big.gain)} for ${esc(big.price)} (${pickLink(r, big, false)})</span>` : ''}`
          : r.none ? '<span class="dim">Nothing listed in your price range.</span>' : `<span class="dim">None of the ${r.total ? `${r.total} listed` : 'listings'} in your price range beats what you wear.</span>`;
      return `<tr><td><b>${esc(r.slot)}</b>${r.current ? `<br><span class="dim small">${esc(r.current)}</span>` : ''}${changed.has(r.slot) ? '<br><span class="warn small" title="What you wear in this slot has changed since this run: run it again for gains against your new item">changed since</span>' : ''}</td>
        <td>${what}${trend(r)}</td><td class="num">${b && b.perDiv != null ? `<b>${per(b.perDiv)}</b>` : '–'}</td>
        <td class="nowrap">${r.total ? `<button class="link spend-open" data-slot="${esc(r.slot)}">See all ${r.total}</button>` : ''}${!run.partial && r.searched ? `<br><button class="link spend-alert" data-slot="${esc(r.slot)}" title="Get a notification when a new listing for this slot is this much better for your build, under your price">Alert me…</button>` : ''}</td></tr>
        ${!run.partial && r.searched ? `<tr class="spend-alert-row hidden" data-for="${esc(r.slot)}"><td></td><td colspan="3">Tell me when a new ${esc(r.slot)} listing is
          <input type="number" class="num sa-gain" min="0.1" step="any" value="${esc(Math.max(1, Math.round(((b && b.gain) || (gs ? 5 : 3)) * 10) / 10))}"> ${gs ? 'gear score' : 'pts'} better for my build, for at most
          <input type="number" class="num sa-div" min="0.01" step="any" value="${esc(alertPrice(run, b))}"> ${esc(run.unit === 'chaos' ? 'chaos' : 'div')}
          <button class="primary sa-save">Save alert</button> <span class="dim small sa-msg"></span></td></tr>` : ''}`;
    };
    const pairs = run.pairs || [];
    const pairHtml = run.short && run.short.length ? `<div class="card-p"><h3>Cap your resistances (${esc(run.short.join(', '))} short)</h3>
        ${pairs.length ? `<table class="kv">${pairs.map((p) => `<tr><td>${p.all ? '<b class="pos">All capped</b>' : `Caps ${esc(p.capped.join(', '))}`}</td>
          <td><b>${esc(p.a.slot)}</b>: ${esc(p.a.name)} (${esc(p.a.price)})<br><b>${esc(p.b.slot)}</b>: ${esc(p.b.name)} (${esc(p.b.price)})</td>
          <td class="num">${p.priceDiv != null ? esc(div(p.priceDiv)) : ''}${p.gain ? `<br><span class="${p.gain > 0 ? 'pos' : 'neg'}">${p.gain > 0 ? '+' : ''}${n1(p.gain)} pts</span>` : ''}</td></tr>`).join('')}</table>
          <p class="dim small">Each pair was checked together with Path of Building: wearing both caps these resistances without losing damage. Prices are what they're listed for now.</p>`
          : '<p class="dim">No two of the listings found cap your missing resistances together. A single item from the table above, or a higher price range, may.</p>'}</div>` : '';
    const old = !run.partial && ageH >= 0.5;
    const reused = run.reused || old ? `<div class="card-p ${ageH >= 6 ? 'note' : 'dim'}">From the search ${ageH >= 20 ? 'on' : 'at'} ${esc(when)}${ageH >= 6 ? ': prices and listings will have changed since' : run.reused ? ' (kept for 30 minutes)' : ''}${changed.size ? `, and you've changed your ${esc([...changed].join(', '))} since` : ''}. <button class="link" id="spendAgain">Search again now</button></div>` : '';
    body().innerHTML = `${msg ? `<div class="card-p note">${esc(msg)}</div>` : ''}${reused}${headline}
      <div class="card-p"><h3>Every slot</h3><table class="kv spend"><tr><th>Slot</th><th>Best value in your price range</th><th>Per divine</th><th></th></tr>${rows.map(row).join('')}</table>
      <p class="dim small">${esc(run.league || '')}${run.budget ? ` · ${esc(run.budget)}` : ''}${when ? ` · checked at ${esc(when)}` : ''} · ${gs ? 'Gear score points gained over what you wear (no Path of Building build loaded, so no resistance pairs)' : '"pts" is Path of Building\'s score for your build, as in the popup: the % change to your damage and effective HP, plus half a point per resistance point toward your cap'}, checked on the first 10 listings of each search.${run.stopped ? ` Stopped early: ${esc(run.stopped)}` : ''}</p></div>
      ${pairHtml}`;
    body().querySelectorAll('.spend-open').forEach((b) => b.addEventListener('click', async () => { b.disabled = true; await window.api.spendOpen(b.dataset.slot); b.disabled = false; }));
    body().querySelectorAll('.spend-pick').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      const res = await window.api.spendOpen(b.dataset.slot, b.dataset.id);
      b.disabled = false;
      if (res && !res.ok && res.error) b.title = res.error;
    }));
    body().querySelectorAll('.spend-alert').forEach((b) => b.addEventListener('click', () => {
      const tr = body().querySelector(`.spend-alert-row[data-for="${b.dataset.slot}"]`);
      if (tr) tr.classList.toggle('hidden');
    }));
    body().querySelectorAll('.spend-alert-row').forEach((tr) => tr.querySelector('.sa-save').addEventListener('click', async () => {
      const msg = tr.querySelector('.sa-msg');
      const r = await window.api.spendAlert(tr.dataset.for, tr.querySelector('.sa-gain').value, tr.querySelector('.sa-div').value);
      msg.textContent = r && r.ok ? `Saved: "${r.name}". Alerts are checked every ${r.every} minutes (Saved searches).` : (r && r.error) || 'Not saved.';
    }));
    const again = body().querySelector('#spendAgain');
    if (again) again.addEventListener('click', () => go(true));
  }
  // while it runs: each slot as soon as its search is done
  function renderLive(p) {
    const done = live.length; const total = (p && p.total) || done;
    const rows = live.slice().sort((a, b) => ((b.best && b.best.perDiv) || -1) - ((a.best && a.best.perDiv) || -1));
    render({ rows, mode: liveMode, short: [], pairs: [], at: 0, partial: true });
    const prog = `<div class="card-p"><span class="spinner"></span> <span id="spendProg">${done} of ${total} slots searched… the trade site allows only a few searches a minute.</span></div>`;
    body().insertAdjacentHTML('afterbegin', prog);
  }

  async function go(force) {
    if (running) return;
    running = true; $('#spendRun').disabled = true; live = []; liveMode = null;
    body().innerHTML = '<div class="card-p"><span class="spinner"></span> <span id="spendProg">Starting…</span></div>';
    try {
      const r = await window.api.spendRun(force);
      if (!r || !r.ok) render(null, (r && r.error) || 'Something went wrong.');
      else render(r);
    } catch (err) { render(null, err.message); }
    running = false; $('#spendRun').disabled = false;
  }
  $('#spendRun').addEventListener('click', () => go(false)); // a run from the last 30 minutes is shown again; "Search again now" forces a new one
  window.api.onSpendProgress((p) => {
    if (p && p.row) { live.push(p.row); liveMode = p.mode; renderLive(p); return; }
    const el = $('#spendProg');
    if (!el || !p) return;
    el.textContent = p.finished ? 'Done.' : p.pairs ? 'Trying pairs of items for your resistances…' : `Searching ${p.slot} (${p.done + 1} of ${p.total})… the trade site allows only a few searches a minute.`;
  });
  // the last run for this game, when you open the page
  document.querySelector('.tabs button[data-tab="spend"]').addEventListener('click', async () => {
    if (running) return;
    const r = await window.api.spendGet();
    if (r) render(r);
  });
  if (window.api.onGameChanged) window.api.onGameChanged(() => { shown = null; if (!running) body().innerHTML = '<div class="card-p dim">Press <b>Find where to spend</b> for this game\'s character.</div>'; });
})();
