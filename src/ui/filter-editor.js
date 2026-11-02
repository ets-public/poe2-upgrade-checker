'use strict';
/* global window, document */

// Loot filter editor window (features/filtereditor.js does the files). Changes are saved as you make
// them, as override blocks at the top of the filter; the filter you started from stays below.
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = { file: null, data: null, item: null, info: null, q: '' };
  const msg = (t) => { $('#lfMsg').textContent = t || ''; };

  // the game's beam and minimap colours, and our own price tiers' looks (same as core/filterfile.js)
  const BEAMS = ['Red', 'Green', 'Blue', 'Brown', 'White', 'Yellow', 'Cyan', 'Grey', 'Orange', 'Pink', 'Purple'];
  const BEAM_CSS = { Red: '#e03c3c', Green: '#3cc85a', Blue: '#4a78e8', Brown: '#8a5a32', White: '#f0f0f0', Yellow: '#e8d23c', Cyan: '#3cd2e0', Grey: '#8a8a8a', Orange: '#f0962c', Pink: '#f078c8', Purple: '#9a5ae0' };
  const SHAPES = ['Circle', 'Diamond', 'Hexagon', 'Square', 'Star', 'Triangle', 'Cross', 'Moon', 'Raindrop', 'Kite', 'Pentagon', 'UpsideDownHouse'];
  const OUR_TIERS = [
    { label: 'Tier S', styles: { SetFontSize: ['45'], SetTextColor: ['255', '0', '0', '255'], SetBorderColor: ['255', '0', '0', '255'], SetBackgroundColor: ['255', '255', '255', '255'], PlayAlertSound: ['6', '300'], PlayEffect: ['Red'], MinimapIcon: ['0', 'Red', 'Star'] } },
    { label: 'Tier A', styles: { SetFontSize: ['45'], SetTextColor: ['255', '255', '255', '255'], SetBorderColor: ['255', '255', '255', '255'], SetBackgroundColor: ['240', '90', '80', '255'], PlayAlertSound: ['1', '300'], PlayEffect: ['Orange'], MinimapIcon: ['0', 'Orange', 'Circle'] } },
    { label: 'Tier B', styles: { SetFontSize: ['42'], SetTextColor: ['0', '0', '0', '255'], SetBorderColor: ['0', '0', '0', '255'], SetBackgroundColor: ['250', '170', '90', '255'], PlayAlertSound: ['2', '250'], PlayEffect: ['Yellow'], MinimapIcon: ['1', 'Yellow', 'Circle'] } },
    { label: 'Tier C', styles: { SetFontSize: ['38'], SetTextColor: ['255', '210', '160', '255'], SetBorderColor: ['200', '150', '100', '255'], SetBackgroundColor: ['40', '25', '15', '230'] } },
    { label: 'Tier D', styles: { SetFontSize: ['34'], SetTextColor: ['200', '200', '200', '255'], SetBorderColor: ['100', '100', '100', '255'], SetBackgroundColor: ['20', '20', '20', '200'] } },
  ];

  const rgba = (v, fb) => { if (!v || v.length < 3) return fb; const a = v[3] != null ? Number(v[3]) / 255 : 1; return `rgba(${Number(v[0])}, ${Number(v[1])}, ${Number(v[2])}, ${a.toFixed(2)})`; };
  const hex = (v, fb) => { if (!v || v.length < 3) return fb; return '#' + v.slice(0, 3).map((x) => Math.max(0, Math.min(255, Number(x) || 0)).toString(16).padStart(2, '0')).join(''); };
  const fromHex = (h, a) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16), a == null ? 255 : a].map(String);
  // a label drawn as the game draws it: colours, border and size from the filter's style lines
  function paint(el, styles, hidden) {
    const s = styles || {};
    el.style.color = rgba(s.SetTextColor, '#c8c8c8');
    el.style.background = rgba(s.SetBackgroundColor, 'rgba(0,0,0,0.7)');
    el.style.borderColor = rgba(s.SetBorderColor, 'transparent');
    const size = Number((s.SetFontSize || [])[0]) || 32;
    el.style.fontSize = `${Math.round(Math.max(11, Math.min(45, size)) * 0.55)}px`;
    el.classList.toggle('hidden-item', !!hidden);
  }

  async function loadFiles() {
    const l = await window.api.lfList();
    const sel = $('#lfFile');
    const last = st.file || await window.api.lfLast();
    const opt = (v, t) => `<option value="${esc(v)}">${esc(t)}</option>`;
    sel.innerHTML = `<option value="">Pick a filter…</option>${l.local.length ? `<optgroup label="Your filters (local)">${l.local.map((f) => opt(f.file, `${f.name}${f.edited ? ` (${f.edited} edits)` : ''}`)).join('')}</optgroup>` : ''}${
      l.online.length ? `<optgroup label="Online filters: edit a local copy">${l.online.map((f) => opt('online:' + f.id, `${f.name} (online)`)).join('')}</optgroup>` : ''}`;
    if (!l.local.length && !l.online.length) msg(`No filters in ${l.folder}. Put a .filter file there, or pick an online filter in the game once so it downloads it.`);
    if (last && l.local.some((f) => f.file === last)) { sel.value = last; await openFile(last); }
  }

  async function openFile(file) {
    if (!file) return;
    if (file.startsWith('online:')) {
      const r = await window.api.lfCopyOnline(file.slice(7));
      if (!r.ok) { msg(r.error); return; }
      msg(`Made a local copy, "${r.name}". You edit the copy; the online filter stays as it is, as your backup. In game, pick "${r.name}" (or Copy reload command) to use it.`);
      st.file = r.file;
      await loadFiles();
      $('#lfFile').value = r.file;
      return openFile(r.file);
    }
    const d = await window.api.lfOpen(file);
    if (!d.ok) { msg(d.error); return; }
    st.file = file; st.data = d;
    $('#lfAuto').checked = d.autoTiers > 0;
    const reset = $('#lfResetOnline');
    reset.classList.toggle('hidden', !d.online);
    reset.textContent = 'Reset to online'; delete reset.dataset.armed;
    renderList();
    if (st.item) selectItem(st.item);
  }

  function renderList() {
    const d = st.data; if (!d) return;
    const q = st.q.trim().toLowerCase();
    const edited = new Map(d.edits.map((e) => [e.baseType.toLowerCase(), e]));
    const items = q ? d.items.filter((x) => x.toLowerCase().includes(q)) : d.items;
    $('#lfItems').innerHTML = items.slice(0, 600).map((x) => { const e = edited.get(x.toLowerCase()); return `<li role="option" tabindex="0" data-item="${esc(x)}" class="${e ? (e.auto ? 'auto' : 'edited') : ''}" aria-selected="${st.item && st.item.baseType === x}">${esc(x)}</li>`; }).join('');
    $('#lfCount').textContent = `${items.length} item${items.length === 1 ? '' : 's'}${items.length > 600 ? ' (first 600 shown: search to narrow)' : ''} · ${d.edits.length} edit${d.edits.length === 1 ? '' : 's'}${d.autoTiers ? ` (${d.autoTiers} by price)` : ''}`;
  }

  async function selectItem(item) {
    if (!st.file) { msg('Pick a filter first.'); return; }
    st.item = item;
    const info = await window.api.lfItem(st.file, item);
    if (!info.ok) { msg(info.error); return; }
    st.info = info;
    renderItem();
    document.querySelectorAll('#lfItems li').forEach((li) => li.setAttribute('aria-selected', String(li.dataset.item === item.baseType)));
  }

  // the edit as it stands (yours, or the filter's look as a starting point)
  function currentEdit() {
    const i = st.info;
    if (i.edit) return JSON.parse(JSON.stringify(i.edit));
    const now = i.now;
    return { show: !now || now.action !== 'Hide', style: now ? JSON.parse(JSON.stringify(now.styles || {})) : {} };
  }
  async function save(edit, note) {
    const r = await window.api.lfSetEdit(st.file, st.item.baseType, edit ? { ...edit, note: note || `${st.item.baseType}: your edit` } : null);
    if (!r.ok) { msg(r.error); return; }
    st.info = r;
    const d = await window.api.lfOpen(st.file);
    if (d.ok) { st.data = d; renderList(); }
    renderItem();
    msg('Saved. Reload the filter in game to see it (Copy reload command, then Enter, Ctrl+V, Enter).');
  }

  function renderItem() {
    const i = st.info; const box = $('#lfItem');
    const now = i.now;
    const hidden = now && now.action === 'Hide';
    const e = currentEdit();
    const s = e.style || {};
    const gearish = st.item.rarity && !/currency/i.test(st.item.itemClass || '');
    const tiers = [...OUR_TIERS, ...((st.data && st.data.tiers) || []).slice(0, 40)];
    box.innerHTML = `
      <div class="lfe-preview"><span class="lfe-label" id="lfPrev">${esc(st.item.name && st.item.name !== st.item.baseType ? `${st.item.name} (${st.item.baseType})` : st.item.baseType)}</span></div>
      <div class="lfe-where dim">${now ? `${hidden ? 'Hidden' : 'Shown'} by <b>${esc(now.label)}</b> (line ${now.line})${i.edit ? ' · your edit' : ''}${now.unsure.length ? ` · also depends on ${esc(now.unsure.join(', '))}` : ''}` : 'No block of this filter matches it: the game shows it plainly.'}
        ${i.edit && i.original ? `<br>Without your edit: ${i.original.action === 'Hide' ? 'hidden' : 'shown'} by ${esc(i.original.label)}` : ''}</div>
      <div class="lfe-row"><label><input type="checkbox" id="lfShow" ${hidden ? '' : 'checked'}> Show</label>
        ${i.edit ? '<button id="lfReset" title="Take your edit off: the filter decides again">Back to the filter\'s look</button>' : ''}
        ${gearish ? `<label class="small" title="An edit is for every item of this base. Limit it to some rarities, so e.g. rare ones keep the filter's look.">Only <select id="lfRarity"><option value="">every rarity</option>${['<= Normal', '<= Magic', 'Rare', 'Unique'].map((r) => `<option ${e.rarity === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>` : ''}</div>
      <h4>Give it a tier's look</h4>
      <div class="lfe-tiers" id="lfTiers">${tiers.map((t, k) => `<button class="lfe-tier" data-tier="${k}" title="${esc(t.label)}">${esc(t.label)}</button>`).join('')}</div>
      <h4>Or your own</h4>
      <div class="lfe-row"><span class="k">Text</span><input type="color" id="cText" value="${hex(s.SetTextColor, '#c8c8c8')}"><span class="k">Background</span><input type="color" id="cBg" value="${hex(s.SetBackgroundColor, '#000000')}"><span class="k">Border</span><input type="color" id="cBorder" value="${hex(s.SetBorderColor, '#000000')}"> <button class="link" id="noBorder">no border</button></div>
      <div class="lfe-row"><span class="k">Label size</span><input type="range" id="cSize" min="18" max="45" value="${Number((s.SetFontSize || [])[0]) || 32}"><span id="cSizeV" class="dim small">${Number((s.SetFontSize || [])[0]) || 32}</span></div>
      <div class="lfe-row lfe-sounds"><span class="k">Alert sound</span>${['None', ...Array.from({ length: 16 }, (_, k) => String(k + 1))].map((n) => `<button data-sound="${n}" aria-pressed="${(s.PlayAlertSound ? String(s.PlayAlertSound[0]) : 'None') === n}">${n}</button>`).join('')}</div>
      <div class="lfe-row"><span class="k">Beam</span><div class="lfe-swatch" id="cBeam"><button data-beam="" title="No beam" aria-pressed="${!s.PlayEffect}">×</button>${BEAMS.map((b) => `<button data-beam="${b}" title="${b}" aria-pressed="${s.PlayEffect && s.PlayEffect[0] === b}"></button>`).join('')}</div></div>
      <div class="lfe-row"><span class="k">Minimap icon</span><select id="cIconSize"><option value="">none</option><option value="0">large</option><option value="1">medium</option><option value="2">small</option></select>
        <select id="cIconColour">${BEAMS.map((b) => `<option>${b}</option>`).join('')}</select><select id="cIconShape">${SHAPES.map((b) => `<option>${b}</option>`).join('')}</select></div>
      <div class="dim small">Changes are saved as you make them, at the top of the filter; the filter you started from stays below them. A copy of the file as it was is kept next to it (.before-edits.bak).</div>`;
    paint($('#lfPrev'), hidden ? (i.original && i.original.styles) : (now && now.styles), hidden);
    box.querySelectorAll('[data-beam]').forEach((b) => { if (b.dataset.beam) b.style.background = BEAM_CSS[b.dataset.beam]; });
    box.querySelectorAll('[data-tier]').forEach((b) => paint(b, tiers[Number(b.dataset.tier)].styles, false));
    const ic = s.MinimapIcon || [];
    $('#cIconSize').value = ic.length ? String(ic[0]) : '';
    if (ic[1]) $('#cIconColour').value = ic[1];
    if (ic[2]) $('#cIconShape').value = ic[2];

    const change = (fn, note) => { const ed = currentEdit(); ed.show = true; ed.style = ed.style || {}; fn(ed); const r = $('#lfRarity'); if (r && r.value) ed.rarity = r.value; else delete ed.rarity; save(ed, note); };
    $('#lfShow').addEventListener('change', () => { const ed = currentEdit(); ed.show = $('#lfShow').checked; save(ed, `${st.item.baseType}: ${ed.show ? 'shown' : 'hidden'}`); });
    const reset = $('#lfReset'); if (reset) reset.addEventListener('click', () => save(null));
    const rar = $('#lfRarity'); if (rar) rar.addEventListener('change', () => change(() => {}));
    box.querySelectorAll('[data-tier]').forEach((b) => b.addEventListener('click', () => { const t = tiers[Number(b.dataset.tier)]; change((ed) => { ed.style = JSON.parse(JSON.stringify(t.styles)); }, `${st.item.baseType}: ${t.label}`); }));
    $('#cText').addEventListener('change', (ev) => change((ed) => { ed.style.SetTextColor = fromHex(ev.target.value); }));
    $('#cBg').addEventListener('change', (ev) => change((ed) => { ed.style.SetBackgroundColor = fromHex(ev.target.value, 240); }));
    $('#cBorder').addEventListener('change', (ev) => change((ed) => { ed.style.SetBorderColor = fromHex(ev.target.value); }));
    $('#noBorder').addEventListener('click', () => change((ed) => { delete ed.style.SetBorderColor; }));
    $('#cSize').addEventListener('input', (ev) => { $('#cSizeV').textContent = ev.target.value; });
    $('#cSize').addEventListener('change', (ev) => change((ed) => { ed.style.SetFontSize = [String(ev.target.value)]; }));
    box.querySelectorAll('[data-sound]').forEach((b) => b.addEventListener('click', () => change((ed) => { if (b.dataset.sound === 'None') { delete ed.style.PlayAlertSound; ed.style.DisableDropSound = []; } else { ed.style.PlayAlertSound = [b.dataset.sound, '300']; delete ed.style.DisableDropSound; } })));
    box.querySelectorAll('[data-beam]').forEach((b) => b.addEventListener('click', () => change((ed) => { if (b.dataset.beam) ed.style.PlayEffect = [b.dataset.beam]; else delete ed.style.PlayEffect; })));
    const icon = () => change((ed) => { const sz = $('#cIconSize').value; if (sz === '') delete ed.style.MinimapIcon; else ed.style.MinimapIcon = [sz, $('#cIconColour').value, $('#cIconShape').value]; });
    ['#cIconSize', '#cIconColour', '#cIconShape'].forEach((k) => $(k).addEventListener('change', icon));
  }

  $('#lfFile').addEventListener('change', (e) => { st.item = null; $('#lfItem').innerHTML = '<div class="dim">Pick an item on the left, or <b>Use copied item</b>.</div>'; msg(''); openFile(e.target.value); });
  $('#lfSearch').addEventListener('input', (e) => { st.q = e.target.value; renderList(); });
  $('#lfItems').addEventListener('click', (e) => { const li = e.target.closest('[data-item]'); if (li) selectItem({ baseType: li.dataset.item }); });
  $('#lfItems').addEventListener('keydown', (e) => { if (e.key === 'Enter') { const li = e.target.closest('[data-item]'); if (li) selectItem({ baseType: li.dataset.item }); } });
  $('#lfCopied').addEventListener('click', async () => {
    const it = await window.api.lfCopied();
    if (!it) { msg('Copy an item in game first (hover it and press F2, F3 or Ctrl+C).'); return; }
    msg('');
    selectItem(it);
  });
  $('#lfAuto').addEventListener('change', async (e) => {
    if (!st.file) { e.target.checked = false; msg('Pick a filter first.'); return; }
    msg(e.target.checked ? 'Getting today\'s prices…' : '');
    const r = await window.api.lfAutoTiers(st.file, e.target.checked);
    if (!r.ok) { msg(r.error); e.target.checked = false; return; }
    msg(e.target.checked ? `${r.count} items put in tiers by today's prices in ${r.league} (${Object.entries(r.by || {}).map(([k, v]) => `${k}: ${v}`).join(', ')}). Tick it again later to use newer prices. Reload the filter in game to see it.` : 'Tiers by price taken off: the filter decides again (your own edits stay).');
    await openFile(st.file);
  });
  // two clicks: the first says what goes, the second (within a few seconds) resets
  $('#lfResetOnline').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    if (!st.file || !st.data || !st.data.online) return;
    if (!b.dataset.armed) {
      b.dataset.armed = '1';
      b.textContent = 'Click again to reset';
      const n = st.data.edits.length;
      msg(`Reset to "${st.data.online.name}" as it is online now? ${n ? `Your ${n} edit${n === 1 ? '' : 's'} in this copy will be taken off. ` : ''}The file as it is now is kept as a .before-reset.bak copy.`);
      setTimeout(() => { if (b.dataset.armed) { delete b.dataset.armed; b.textContent = 'Reset to online'; } }, 5000);
      return;
    }
    delete b.dataset.armed; b.textContent = 'Reset to online';
    const r = await window.api.lfResetOnline(st.file);
    if (!r.ok) { msg(r.error); return; }
    await loadFiles(); // opens the file again
    msg(`Reset to "${r.online}" as it is online now${r.dropped ? ` (${r.dropped} edit${r.dropped === 1 ? '' : 's'} taken off)` : ''}. Reload the filter in game to see it (Copy reload command).`);
  });
  $('#lfReload').addEventListener('click', async () => {
    if (!st.file) { msg('Pick a filter first.'); return; }
    const r = await window.api.lfReload(st.file);
    msg(r.ok ? `Copied "${r.cmd}". In game: Enter, Ctrl+V, Enter. The game loads the filter again.` : r.error);
  });
  $('#lfFolderBtn').addEventListener('click', () => window.api.lfFolder());
  $('#lfClose').addEventListener('click', () => window.api.lfHide());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.activeElement !== $('#lfSearch')) window.api.lfHide(); });
  loadFiles();
})();
