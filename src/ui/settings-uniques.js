'use strict';
/* global window, document */

// Find upgrades: the best uniques for the slot picked above. Path of Building tries every unique in
// its item database that fits, in your build; best first, with poe.ninja's price and a trade search.
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const VERDICT = { upgrade: ['UPGRADE', 'up'], small: ['SMALL UPGRADE', 'up'], same: ['SIDEGRADE', 'same'], downgrade: ['DOWNGRADE', 'dn'], risky: ['RISKY', 'warn'], resloss: ['LOSES RESISTANCE', 'dn'], dmgloss: ['LOSES DAMAGE', 'dn'] };
  const slotOf = (v) => (/^Ring [12]$/.test(v) ? 'Ring' : v);
  const pct = (v) => (v == null ? '' : `${v > 0 ? '+' : ''}${Math.round(v * 10) / 10}%`);
  const price = (u) => (u.priceDiv >= 1 ? `${Math.round(u.priceDiv * 10) / 10} div` : u.price != null ? `${Math.round(u.price)} ${window.__unit || 'ex'}` : '–');
  async function run() {
    const card = $('#uniqueCard'); const btn = $('#findUniques');
    const sel = $('#findSlot').value;
    const slot = slotOf(sel.replace(/^item:.*/, 'item'));
    card.classList.remove('hidden');
    card.innerHTML = `<h3>Best uniques${slot === 'item' ? '' : `: ${esc(slot)}`}</h3><div class="note"><span class="spinner"></span> Path of Building is trying every unique that fits…</div>`;
    btn.disabled = true;
    let r;
    try { r = await window.api.bestUniques(sel); } catch (err) { r = { ok: false, error: err.message }; }
    btn.disabled = false;
    if (!r || !r.ok) { card.innerHTML = `<h3>Best uniques</h3><div class="note">${esc((r && r.error) || 'Something went wrong.')}</div>`; return; }
    const rows = r.list.map((u) => {
      const v = VERDICT[u.verdict] || [u.verdict, 'same'];
      return `<tr><td><b class="unique">${esc(u.name)}</b><div class="dim small">${esc(u.base || '')}${u.level ? ` · level ${esc(u.level)}` : ''}${r.slot === 'Ring' ? ` · in ${esc(u.slot)}` : ''}</div>${u.breaks && u.breaks.length ? `<div class="small warn">${esc(u.breaks.join('; '))}</div>` : ''}</td>
        <td><span class="verd ${v[1]}">${esc(v[0])}</span><div class="small">${u.score > 0 ? '+' : ''}${esc(u.score)} pts</div></td>
        <td class="small">${u.dps != null ? `Damage ${pct(u.dps)}<br>` : ''}${u.ehp != null ? `Eff. HP ${pct(u.ehp)}` : ''}</td>
        <td>${esc(price(u))}</td>
        <td><button class="link" data-uname="${esc(u.name)}" data-ubase="${esc(u.base || '')}" title="Search the trade site for this unique">Trade</button></td></tr>`;
    }).join('');
    card.innerHTML = `<h3>Best uniques: ${esc(r.slot)}</h3>
      <div class="help">Every unique Path of Building knows that fits ${esc(r.slot === 'Ring' ? 'a ring slot' : 'this slot')}${r.maxLevel ? ` up to level ${esc(r.maxLevel)}` : ''}, tried in your build at its usual rolls (${esc(r.tried || r.list.length)} tried${r.cached ? ', from a few minutes ago' : ''}), best first; ones that cost you a resistance or your damage go last. Prices from poe.ninja.</div>
      ${rows ? `<table class="list uniques">${rows}</table>` : '<div class="note">No unique fits this slot in your build.</div>'}`;
    card.querySelectorAll('[data-uname]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { const res = await window.api.searchUnique(b.dataset.uname, b.dataset.ubase); if (res && res.error) b.title = res.error; } finally { b.disabled = false; }
    }));
  }
  const b = $('#findUniques');
  if (b) b.addEventListener('click', run);
  $('#findSlot').addEventListener('change', () => { const c = $('#uniqueCard'); if (c) { c.classList.add('hidden'); c.innerHTML = ''; } });
}());
