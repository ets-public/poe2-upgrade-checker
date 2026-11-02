'use strict';
/* global window, document */

// Settings window, Check an item page: your recent trade price checks and what sold since (each is
// searched again a few hours later, features/sold.js).
(function () {
  const box = () => document.getElementById('soldList');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 120 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
  const inT = (t) => { const m = Math.round((t - Date.now()) / 60000); return m <= 1 ? 'soon' : m < 120 ? `in about ${m} min` : `in about ${Math.round(m / 60)} h`; };
  async function render() {
    if (!box() || !window.api.soldList) return;
    let d;
    try { d = await window.api.soldList(); } catch (err) { box().innerHTML = `<div class="note">${esc(err.message)}</div>`; return; }
    // For sale: items you copied a price note for, checked on the trade site when you ask (features/forsale.js)
  const fbox = () => document.getElementById('forSaleList');
  async function renderForSale() {
    if (!fbox() || !window.api.forSaleList) return;
    const list = await window.api.forSaleList();
    if (!list.length) { fbox().innerHTML = '<div class="small dim">Nothing yet: price check an item you want to sell and click <b>Copy price note</b>.</div>'; return; }
    fbox().innerHTML = `<ul class="sold-items">${list.map((x) => `<li data-id="${esc(x.id)}"><div><span class="${esc((x.item.rarity || '').toLowerCase())}">${esc(x.item.name || x.item.baseType || 'Item')}</span> <span class="dim small">${esc(x.game === 'poe1' ? 'PoE1' : 'PoE2')} · ${esc(x.note)} · ${esc(when(x.at))}</span></div>
      <div class="small ${x.check && x.check.gone ? 'pos' : x.check ? '' : 'dim'}">${x.check ? `${esc(x.check.text)} <span class="dim">(${esc(when(x.check.at))})</span>` : 'Not checked yet.'}</div>
      <div class="row">${x.canCheck ? '<button class="link" data-fs="check">Check</button>' : '<span class="dim small">Price check it again to be able to check it.</span>'} <button class="link" data-fs="remove">Remove</button></div></li>`).join('')}</ul>`;
    fbox().querySelectorAll('[data-fs]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.closest('li').dataset.id;
      if (b.dataset.fs === 'remove') { await window.api.forSaleRemove(id); renderForSale(); return; }
      b.disabled = true; b.textContent = 'Checking…';
      const r = await window.api.forSaleCheck(id);
      if (!r.ok) { b.disabled = false; b.textContent = 'Check'; b.insertAdjacentHTML('afterend', ` <span class="note small">${esc(r.error)}</span>`); return; }
      renderForSale();
    }));
  }
  if (window.api.onForSaleUpdate) window.api.onForSaleUpdate(renderForSale);
  document.querySelectorAll('[data-tab="test"]').forEach((b) => b.addEventListener('click', renderForSale));
  renderForSale();
  const cb = document.getElementById('soldOn'); if (cb) cb.checked = !!d.on;
    if (!d.list.length) { box().innerHTML = `<div class="small dim">${d.on ? 'Nothing yet: price check an item (the price hotkey, or Price check in the popup).' : 'Off.'}</div>`; return; }
    box().innerHTML = `<ul class="sold-items">${d.list.map((f) => `<li><div><span class="${esc((f.item.rarity || '').toLowerCase())}">${esc(f.item.name || f.item.baseType || 'Item')}</span> <span class="dim small">${esc(f.game === 'poe1' ? 'PoE1' : 'PoE2')}, ${esc(f.league)}, checked ${esc(when(f.at))}</span></div>
      <div class="small ${f.state === 'done' ? '' : 'dim'}">${f.state === 'done' ? esc(f.text) : f.state === 'failed' ? 'Could not search it again.' : d.on ? `Searching again ${esc(inT(f.dueAt))} (${esc(f.count)} instant buyout listings).` : 'Waiting (turned off).'}</div></li>`).join('')}</ul>`;
  }
  const cb = document.getElementById('soldOn');
  if (cb) cb.addEventListener('change', async () => { await window.api.setSetting('soldCheck', cb.checked); render(); });
  if (window.api.onSoldUpdate) window.api.onSoldUpdate(render);
  document.querySelectorAll('[data-tab="test"]').forEach((b) => b.addEventListener('click', render));
  render();
}());
