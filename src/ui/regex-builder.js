'use strict';
/* global window, document */

// Search string builder window (features/regexbuilder.js and core/regexbuild.js do the work).
// Two tabs build a string for the game's search box; the box at the bottom can also be edited by
// hand, copied, tested on the item you copied last, and saved for the search strings hotkey.
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fresh = () => ({ tab: 'map', map: { mins: {}, maxs: {}, anyProp: false, flags: {}, avoid: [], want: [], wantAll: false, extra: '', q: '' }, item: { rows: [], mode: 'all' } });
  let D = null; let S = fresh(); let lastBuilt = '';

  const norm = (t) => String(t || '').toLowerCase().replace(/[+-]?\d+(\.\d+)?/g, '#').replace(/\s+/g, ' ').trim();
  const has = (list, m) => list.some((x) => norm(x) === norm(m));
  const toggle = (list, m, on) => { const l = list.filter((x) => norm(x) !== norm(m)); if (on) l.push(m); return l; };

  async function load() {
    D = await window.api.rxData();
    S = D.state ? { ...fresh(), ...D.state, map: { ...fresh().map, ...(D.state.map || {}) }, item: { ...fresh().item, ...(D.state.item || {}) } } : fresh();
    // first time: your DANGER marks from map checks start ticked as "avoid"
    if (!D.state && D.danger.length) S.map.avoid = [...D.danger];
    renderAll();
  }
  function renderAll() { tab(S.tab); renderMap(); renderItem(); renderSaved(); rebuild(); }

  let saveT = null;
  function persist() { clearTimeout(saveT); saveT = setTimeout(() => window.api.rxState(S), 300); }
  function tab(t) {
    S.tab = t === 'item' ? 'item' : 'map';
    for (const b of document.querySelectorAll('.rxb-tabs [role="tab"]')) b.setAttribute('aria-selected', String(b.dataset.tab === S.tab));
    $('#rxMap').classList.toggle('hidden', S.tab !== 'map');
    $('#rxItem').classList.toggle('hidden', S.tab !== 'item');
  }

  // ---------- maps & waystones ----------
  function renderMap() {
    const m = S.map; const what = D.game === 'poe1' ? 'map' : 'waystone';
    const num = (id, v, label, ph) => `<input type="number" min="0" max="999" class="rxb-num" data-${id}="${esc(label)}" value="${v == null ? '' : esc(v)}" placeholder="${ph}" aria-label="${esc(label)}">`;
    const props = D.props.map((p) => `<label class="rxb-prop"><span>${esc(p.label)}</span>${num('min', m.mins[p.id], p.id, 'min')}${p.id === 'tier' ? num('max', m.maxs[p.id], p.id, 'max') : ''}${p.unit ? '<span class="dim">%</span>' : ''}</label>`).join('');
    const flag = (f) => {
      const v = m.flags[f.id] || '';
      const b = (val, t) => `<button data-flag="${f.id}" data-v="${val}" aria-pressed="${v === val}">${t}</button>`;
      return `<span class="rxb-flag"><span>${esc(f.label)}</span>${b('', 'either')}${b('yes', 'yes')}${b('no', 'no')}</span>`;
    };
    const q = (m.q || '').toLowerCase();
    const groups = Object.entries(D.modGroups).map(([g, list]) => {
      const rows = list.filter((t) => !q || t.toLowerCase().includes(q)).map((t) => {
        const a = has(m.avoid, t); const w = has(m.want, t);
        return `<li class="${a ? 'avoid' : w ? 'want' : ''}"><span class="rxb-mod">${esc(t)}${has(D.danger, t) ? ' <small class="neg">danger</small>' : ''}</span>
          <button data-avoid="${esc(t)}" aria-pressed="${a}" title="${what}s with this mod go dark">Avoid</button><button data-want="${esc(t)}" aria-pressed="${w}" title="Light up ${what}s with this mod">Want</button></li>`;
      }).join('');
      return rows ? `<h4>${esc(g)}</h4><ul class="rxb-mods">${rows}</ul>` : '';
    }).join('');
    // ticked mods that aren't in our list (typed in, or seen once): still shown so you can untick them
    const known = Object.values(D.modGroups).flat();
    const custom = [...m.avoid, ...m.want].filter((t) => !has(known, t));
    $('#rxMap').innerHTML = `
      <h3>Properties <span class="dim small">(at least)</span></h3>
      <div class="rxb-props">${props}</div>
      <label class="small"><input type="checkbox" id="rxAnyProp" ${m.anyProp ? 'checked' : ''}> Any one of these is enough (otherwise all of them)</label>
      <h3>Must be / must not be</h3>
      <div class="rxb-flags">${D.flags.map(flag).join('')}</div>
      <h3>Mods <span class="dim small">${m.avoid.length} to avoid, ${m.want.length} wanted</span></h3>
      <div class="row wrap"><input type="search" id="rxModQ" placeholder="Search mods…" value="${esc(m.q || '')}" aria-label="Search mods">
        <label class="small"><input type="checkbox" id="rxWantAll" ${m.wantAll ? 'checked' : ''}> Wanted mods: all of them (otherwise any)</label></div>
      <div class="row wrap"><input id="rxOwnMod" placeholder="A mod that isn't listed (as the game writes it)" aria-label="Your own mod">
        <button id="rxOwnAvoid">Avoid</button><button id="rxOwnWant">Want</button></div>
      ${custom.length ? `<h4>Your own</h4><ul class="rxb-mods">${custom.map((t) => `<li class="${has(m.avoid, t) ? 'avoid' : 'want'}"><span class="rxb-mod">${esc(t)}</span><button data-drop="${esc(t)}">Remove</button></li>`).join('')}</ul>` : ''}
      <div class="rxb-groups">${groups || '<div class="dim">No mod matches that search.</div>'}</div>
      <h3>Add your own text</h3>
      <input id="rxExtra" class="wide" placeholder='Added as it is, e.g. "map boss"' value="${esc(m.extra || '')}" aria-label="Extra search text">
      <div class="dim small">Mods you've marked on map checks, and the ${what} you copied last, are listed too. Each mod becomes the shortest piece of its text that no other mod shares, so check it on a ${what} before you trust it.</div>`;
    const sec = $('#rxMap');
    sec.querySelectorAll('[data-min]').forEach((i) => i.addEventListener('input', () => { S.map.mins[i.dataset.min] = i.value === '' ? null : Number(i.value); changed(); }));
    sec.querySelectorAll('[data-max]').forEach((i) => i.addEventListener('input', () => { S.map.maxs[i.dataset.max] = i.value === '' ? null : Number(i.value); changed(); }));
    $('#rxAnyProp').addEventListener('change', (e) => { S.map.anyProp = e.target.checked; changed(); });
    $('#rxWantAll').addEventListener('change', (e) => { S.map.wantAll = e.target.checked; changed(); });
    sec.querySelectorAll('[data-flag]').forEach((b) => b.addEventListener('click', () => { S.map.flags[b.dataset.flag] = b.dataset.v; changed(true); }));
    sec.querySelectorAll('[data-avoid]').forEach((b) => b.addEventListener('click', () => { const t = b.dataset.avoid; const on = !has(S.map.avoid, t); S.map.avoid = toggle(S.map.avoid, t, on); if (on) S.map.want = toggle(S.map.want, t, false); changed(true); }));
    sec.querySelectorAll('[data-want]').forEach((b) => b.addEventListener('click', () => { const t = b.dataset.want; const on = !has(S.map.want, t); S.map.want = toggle(S.map.want, t, on); if (on) S.map.avoid = toggle(S.map.avoid, t, false); changed(true); }));
    sec.querySelectorAll('[data-drop]').forEach((b) => b.addEventListener('click', () => { S.map.avoid = toggle(S.map.avoid, b.dataset.drop, false); S.map.want = toggle(S.map.want, b.dataset.drop, false); changed(true); }));
    const own = (where) => { const t = $('#rxOwnMod').value.trim(); if (!t) return; S.map[where] = toggle(S.map[where], t, true); S.map[where === 'avoid' ? 'want' : 'avoid'] = toggle(S.map[where === 'avoid' ? 'want' : 'avoid'], t, false); changed(true); };
    $('#rxOwnAvoid').addEventListener('click', () => own('avoid'));
    $('#rxOwnWant').addEventListener('click', () => own('want'));
    $('#rxModQ').addEventListener('input', (e) => { S.map.q = e.target.value; persist(); const pos = e.target.selectionStart; renderMap(); const i = $('#rxModQ'); i.focus(); i.setSelectionRange(pos, pos); });
    $('#rxExtra').addEventListener('input', (e) => { S.map.extra = e.target.value; changed(); });
  }

  // ---------- any item ----------
  function renderItem() {
    const it = S.item;
    const row = (r, i) => `<li class="rxb-row">
        <select data-kind="${i}" aria-label="Kind of row"><option value="num" ${r.kind === 'num' ? 'selected' : ''}>number</option><option value="text" ${r.kind === 'text' ? 'selected' : ''}>text</option><option value="raw" ${r.kind === 'raw' ? 'selected' : ''}>regex</option></select>
        ${r.kind === 'num'
    ? `<input class="grow" data-tpl="${i}" value="${esc(r.template || '')}" placeholder="#% increased movement speed" aria-label="Mod text, # for the number"> at least <input type="number" class="rxb-num" min="0" max="9999" data-rmin="${i}" value="${r.min == null ? '' : esc(r.min)}" aria-label="At least">`
    : `<input class="grow" data-txt="${i}" value="${esc(r.text || '')}" placeholder="${r.kind === 'raw' ? 'regex, e.g. -\\w-\\w-' : 'text, e.g. crossbow'}" aria-label="Text">`}
        <label class="small" title="Items with this go dark instead"><input type="checkbox" data-not="${i}" ${r.not ? 'checked' : ''}> not</label>
        <button class="link" data-del="${i}" title="Remove this row">×</button></li>`;
    $('#rxItem').innerHTML = `
      <h3>Rows</h3>
      <ul class="rxb-rows">${it.rows.map(row).join('') || '<li class="dim">Add a row: pick one below, or a blank one.</li>'}</ul>
      <div class="row wrap"><select id="rxPreset" aria-label="Ready-made row">${D.presets.map((p, i) => `<option value="${i}">${esc(p.label)}</option>`).join('')}</select>
        <button id="rxAddPreset">Add</button><button id="rxAddNum">Blank number row</button><button id="rxAddText">Text row</button></div>
      <label class="small"><input type="radio" name="rxMode" value="all" ${it.mode !== 'any' ? 'checked' : ''}> Item must have every row</label>
      <label class="small"><input type="radio" name="rxMode" value="any" ${it.mode === 'any' ? 'checked' : ''}> Any one row is enough</label>
      <div class="dim small">A number row is the mod as the game writes it with # for the number: "+#% to fire resistance" at least 30 lights up 30% and more. A "not" row hides items that have it (for example "not quiver").</div>`;
    const sec = $('#rxItem');
    const add = (r) => { S.item.rows.push(r); changed(true); };
    $('#rxAddPreset').addEventListener('click', () => { const p = D.presets[Number($('#rxPreset').value)]; if (p) add({ kind: 'num', template: p.template, min: p.min }); });
    $('#rxAddNum').addEventListener('click', () => add({ kind: 'num', template: '', min: 1 }));
    $('#rxAddText').addEventListener('click', () => add({ kind: 'text', text: '' }));
    sec.querySelectorAll('[data-kind]').forEach((s) => s.addEventListener('change', () => { const r = S.item.rows[Number(s.dataset.kind)]; r.kind = s.value; changed(true); }));
    sec.querySelectorAll('[data-tpl]').forEach((i) => i.addEventListener('input', () => { S.item.rows[Number(i.dataset.tpl)].template = i.value; changed(); }));
    sec.querySelectorAll('[data-txt]').forEach((i) => i.addEventListener('input', () => { S.item.rows[Number(i.dataset.txt)].text = i.value; changed(); }));
    sec.querySelectorAll('[data-rmin]').forEach((i) => i.addEventListener('input', () => { S.item.rows[Number(i.dataset.rmin)].min = i.value === '' ? null : Number(i.value); changed(); }));
    sec.querySelectorAll('[data-not]').forEach((c) => c.addEventListener('change', () => { S.item.rows[Number(c.dataset.not)].not = c.checked; changed(); }));
    sec.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { S.item.rows.splice(Number(b.dataset.del), 1); changed(true); }));
    sec.querySelectorAll('input[name="rxMode"]').forEach((r) => r.addEventListener('change', () => { S.item.mode = r.value; changed(); }));
  }

  // ---------- the string ----------
  function changed(redraw) {
    persist();
    if (redraw) { if (S.tab === 'map') renderMap(); else renderItem(); }
    rebuild();
  }
  let buildN = 0;
  async function rebuild() {
    const n = ++buildN;
    const r = S.tab === 'item' ? await window.api.rxBuild('item', S.item) : await window.api.rxBuild('map', S.map);
    if (n !== buildN || !r) return;
    lastBuilt = r.text || '';
    $('#rxText').value = lastBuilt;
    $('#rxTestOut').textContent = '';
    showCount(r.notes || []);
  }
  function showCount(notes) {
    const len = $('#rxText').value.length;
    $('#rxCount').textContent = `${len}/${D.limit}`;
    $('#rxCount').className = len > D.limit ? 'neg' : 'dim';
    $('#rxNotes').textContent = (notes || []).join(' ');
  }
  $('#rxText').addEventListener('input', () => showCount(Number($('#rxText').value.length) > D.limit ? [`Over the game's ${D.limit} characters.`] : []));

  $('#rxCopy').addEventListener('click', async () => {
    const t = $('#rxText').value.trim(); if (!t) return;
    await window.api.rxCopy(t);
    $('#rxCopy').textContent = 'Copied'; setTimeout(() => { $('#rxCopy').textContent = 'Copy'; }, 1500);
  });
  $('#rxTest').addEventListener('click', async () => {
    const t = $('#rxText').value.trim(); const out = $('#rxTestOut');
    if (!t) { out.textContent = 'Build a string first.'; return; }
    const r = await window.api.rxTest(t);
    if (r.none) { out.innerHTML = 'No item copied yet: hover one in game and press Ctrl+C (or your check hotkey), then test again.'; return; }
    const why = (r.groups || []).map((g) => `<li class="${(g.not ? !g.hit : g.hit) && !g.error ? 'pos' : 'neg'}"><code>${esc(g.not ? '!' + g.rx : g.rx)}</code> ${g.error ? esc(g.error) : g.not ? (g.hit ? `found it: ${esc(g.line || '')}` : 'not on it, good') : (g.hit ? `found: ${esc(g.line || '')}` : 'not on it')}</li>`).join('');
    out.innerHTML = `<b class="${r.ok ? 'pos' : 'neg'}">${r.ok ? 'Lights up' : 'Stays dark'}:</b> ${esc(r.name)}<ul>${why}</ul>`;
  });

  // ---------- saved strings (the search strings hotkey copies these) ----------
  function renderSaved() {
    const sel = $('#rxSaved');
    sel.innerHTML = D.saved.length ? D.saved.map((x, i) => `<option value="${i}">${esc(x.name || 'Saved string')}</option>`).join('') : '<option value="">No saved strings</option>';
    $('#rxLoad').disabled = $('#rxRemove').disabled = !D.saved.length;
  }
  $('#rxSave').addEventListener('click', async () => {
    const r = await window.api.rxSave($('#rxName').value, $('#rxText').value);
    if (!r.ok) { $('#rxTestOut').textContent = r.error; return; }
    D.saved = r.saved; renderSaved();
    $('#rxTestOut').textContent = D.hotkey ? `Saved. In game, ${D.hotkey} copies your strings one after another.` : 'Saved. Set a Search strings hotkey in Settings to copy it in game, or use Copy here.';
  });
  $('#rxLoad').addEventListener('click', () => { const x = D.saved[Number($('#rxSaved').value)]; if (!x) return; $('#rxText').value = x.text; $('#rxName').value = x.name || ''; showCount([]); });
  $('#rxRemove').addEventListener('click', async () => { const r = await window.api.rxRemove(Number($('#rxSaved').value)); if (r.ok) { D.saved = r.saved; renderSaved(); } });

  // ---------- window ----------
  for (const b of document.querySelectorAll('.rxb-tabs [role="tab"]')) b.addEventListener('click', () => { tab(b.dataset.tab); persist(); rebuild(); });
  $('#rxReset').addEventListener('click', () => { const t = S.tab; S[t] = fresh()[t]; persist(); renderAll(); });
  $('#rxClose').addEventListener('click', () => window.api.rxHide());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.api.rxHide(); });
  window.api.onRxRefresh(() => load());
  if (window.api.onGameChanged) window.api.onGameChanged(() => load());
  load();
}());
