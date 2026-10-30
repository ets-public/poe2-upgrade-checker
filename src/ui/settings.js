'use strict';

// Settings window: shared helpers, the tabs, loading the app's state and the My gear page.
// The window's other pages are in settings-*.js (loaded in order, sharing these globals), then
// character.js, spend.js and picker.js.

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let state = null;

document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
}));

let accountAt = 0; // when the sign-in status was last checked
// words that differ between the games: <span class="p2">…</span><span class="p1">…</span> in the page,
// and a few attributes set here
// a stat as the game writes it: "# to maximum Life" -> "… to maximum Life", without the app's internal tags
const niceKey = (k) => String(k || '').replace(/^\[(Base|Weapon)\]\s*/, '').replace(/\s*\(Local\)\s*$/i, '').replace(/#/g, '…');
function gameWords() {
  const p1 = state && state.game === 'poe1';
  document.body.classList.toggle('game-poe1', p1);
  const ps = $('#pickerSearch'); if (ps) ps.placeholder = p1 ? 'Search stats, e.g. energy shield, minion, reservation, cast speed…' : 'Search stats, e.g. energy shield, minion, spirit, cast speed…';
  const fs = $('#findSimilar'); if (fs) fs.title = `Listings with this item's stats at its values or higher. If nothing is listed it loosens step by step (90%, 80%, 65%) and tells you.${p1 ? '' : ' Rune bonuses are left out – you can socket your own.'}`;
  const rb = $('#resBuffer'); if (rb && rb.parentElement) rb.parentElement.title = `How far over the cap a resistance must be before more of it stops counting. PoB numbers can include ${p1 ? 'flasks' : 'charms'} and buffs that aren't always on.`;
  const aug = document.querySelector('option[value="augment"]'); if (aug) aug.textContent = p1 ? 'Enchant / other' : 'Rune';
}
let foldedFor = null; // the Path of Building state the folds were last set for (a click you make stays)
async function load() {
  state = await window.api.getState();
  gameWords();
  renderSlots();
  renderWeights();
  $('#weightsJson').value = JSON.stringify(state.weights, null, 2);
  $('#autoHide').value = state.settings.autoHideSeconds;
  $('#paused').checked = !!state.settings.paused;
  loadBudget();
  renderIgnore();
  renderSaved();
  renderHistory();
  $('#buildSel').innerHTML = (state.builds || []).map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('') + '<option value="off">None – score by my own stat weights</option>';
  $('#buildSel').value = state.settings.build || state.defaultBuild;
  // "By my weights" only makes sense when you score by stat weights (build turned off)
  $('#findQuick').classList.toggle('hidden', state.settings.build !== 'off');
  const bd = (state.builds || []).find((b) => b.id === $('#buildSel').value);
  $('#buildHelp').textContent = bd ? bd.summary + ' Ignored stats (Find upgrades page) are left out of the score.' : 'Gear score is turned off.';
  $('#popupPosition').value = state.settings.popupPosition || 'cursor';
  $('#uiScale').value = String(state.settings.uiScale || 1);
  $('#popupDetail').value = state.settings.popupDetail || 'compact';
  $('#colorblind').checked = !!state.settings.colorblind;
  document.body.classList.toggle('cb', !!state.settings.colorblind);
  if (document.activeElement !== $('#resultsHotkey')) $('#resultsHotkey').value = state.settings.resultsHotkey || 'Ctrl+Shift+D';
  renderSetup();
  renderProfiles();
  renderResists();
  renderBuildEditor();
  $('#startWithWindows').checked = !!state.settings.startWithWindows;
  if (state.platform === 'linux') { $('#startWithLabel').textContent = 'Start when I log in'; if (state.dataDir) $('#dataDirText').textContent = state.dataDir; }
  $('#openSettingsOnStart').checked = state.settings.openSettingsOnStart !== false;
  $('#advancedCopy').checked = !!state.settings.advancedCopy;
  $('#watchClipboard').checked = state.settings.watchClipboard !== false;
  $('#autoUpdateGear').checked = state.settings.autoUpdateGear !== false;
  const hs = state.hotkeyStatus || {};
  if (document.activeElement !== $('#hotkey')) $('#hotkey').value = state.settings.hotkey || 'F2';
  if (document.activeElement !== $('#priceHotkey')) $('#priceHotkey').value = priceKeyNow() || '';
  if (document.activeElement !== $('#equipHotkey')) $('#equipHotkey').value = state.settings.equipHotkey || '';
  $('#hotkeyMsg').textContent = hs.ok ? `Active: ${hs.accelerator}` : (hs.error || 'Hotkey not registered.');
  $('#hotkeyLine').innerHTML = hs.ok
    ? `In game: hover an item and press <b>${esc(hs.accelerator)}</b>${priceKeyNow() ? ` (<b>${esc(priceKeyNow())}</b> for just its price)` : ''}.<br>You can close this window; the app keeps running in the tray.`
    : `<span class="note">Hotkey isn't working: ${esc(hs.error || 'not registered')} – change it in Settings.</span>`;
  renderPob(false);
  if (Date.now() - accountAt > 30000) renderAccount(); // not on every change: it asks the trade site
  renderModeHints();
  const le = $('#loadError');
  if (le) { le.classList.toggle('hidden', !state.loadError); if (state.loadError) le.textContent = `Your settings file couldn't be read (${state.loadError}), so the app started with defaults. The old file was kept next to it as poe2-upgrade-checker.json.unreadable-…`; }
}

function summary(item) {
  const top = (item.lines || []).filter((l) => l.key).slice(0, 4).map((l) => l.text).join(' · ');
  return top;
}

function renderGearSummary() {
  const gs = state.gearScores || {};
  const main = state.mainSlots || [];
  const rated = Object.entries(gs).filter(([slot, g]) => g && g.score != null && (!main.length || main.includes(slot)));
  if (!rated.length || state.settings.build === 'off') { $('#gearSummary').innerHTML = ''; return; }
  const avg = Math.round(rated.reduce((a, [, g]) => a + g.score, 0) / rated.length);
  const grade = avg >= 85 ? 'S' : avg >= 70 ? 'A' : avg >= 55 ? 'B' : avg >= 40 ? 'C' : 'D';
  const weakest = rated.slice().sort((a, b) => a[1].score - b[1].score).slice(0, 3);
  const build = (state.builds || []).find((b) => b.id === (state.settings.build || state.defaultBuild));
  $('#gearSummary').innerHTML = `<div class="gear"><span class="gs g-${grade}">${avg} ${grade}</span> <b>Overall gear score</b> <span class="dim">for ${esc(build ? build.name : 'your build')}${state.pobOn ? ' – a rough guide; verdicts come from Path of Building' : ''}</span></div>
    <div>Upgrade first: ${weakest.map(([slot, g]) => `<button class="link" data-quick2="${esc(slot)}">${esc(slot)} (${g.score})</button>`).join(' · ')}
    <span class="note" id="gearSumMsg"></span></div>`;
  document.querySelectorAll('[data-quick2]').forEach((b) => b.addEventListener('click', async () => {
    $('#gearSumMsg').textContent = ` Searching upgrades for ${b.dataset.quick2}…`;
    window.showSearchResult($('#gearSumMsg'), await window.api.quickFind(b.dataset.quick2, 'upgrade').catch((err) => ({ ok: false, error: (err && err.message) || String(err) })));
  }));
}

function renderSlots() {
  renderGearSummary();
  const gs = state.gearScores || {};
  const main = state.mainSlots || state.slots;
  // jewel slots: the first 6, any that hold a jewel and one empty one after them (a build can have many)
  let lastJewel = 0;
  state.slots.forEach((s) => { const m = /^Jewel (\d+)$/.exec(s); if (m && state.equipped[s]) lastJewel = Math.max(lastJewel, Number(m[1])); });
  const extras = state.slots.filter((s) => !main.includes(s)).filter((s) => { const m = /^Jewel (\d+)$/.exec(s); return !m || Number(m[1]) <= Math.max(6, lastJewel + 1); });
  const showExtras = extras.filter((s) => state.equipped[s]);
  const extraOpen = window.__extraOpen != null ? window.__extraOpen : showExtras.length > 0;
  const row = (s) => {
    const it = state.equipped[s];
    const g = gs[s];
    const gcell = !it ? '' : !g ? '' : g.score == null ? `<span class="dim">${g.unique ? 'unique' : g.unrated === 'unidentified' ? 'unidentified' : 'not rated'}</span>`
      : `<span class="gs g-${esc(g.grade)}" title="${esc((g.missing || []).length ? 'Missing: ' + g.missing.join(', ') : '')}">${g.score} ${esc(g.grade)}</span>`;
    return `<tr class="slotrow"><td>${esc(s)}</td><td>${gcell}</td>
      <td class="item-cell">${it ? `<b class="rar-${esc(String(it.rarity || '').toLowerCase())}">${esc(it.name)}</b> <span class="dim">${esc(it.baseType !== it.name ? it.baseType : '')}</span>${it.fromPob ? ' <span class="dim small">· from PoB</span>' : ''}<div class="dim mods-line" title="${esc(summary(it))}">${esc(summary(it).replace(/\(-?\d+(?:\.\d+)?-\d+(?:\.\d+)?\)/g, ''))}</div>`
        : '<span class="empty">not set</span>'}</td>
      <td class="nowrap">${it ? `<button data-quick="${esc(s)}">Find upgrades</button>
        <button class="link" data-custom="${esc(s)}">Custom…</button>
        <button class="link" data-clear="${esc(s)}" title="Forget the item saved for this slot">Clear</button>` : ''}</td></tr>`;
  };
  $('#slots').innerHTML = `<tr><th>Slot</th><th>${state.game === 'poe1' ? '' : 'Gear score'}</th><th>Item</th><th></th></tr>` + main.map(row).join('')
    + `<tr><td colspan="4"><button class="link" id="extraToggle">${extraOpen ? '▾' : '▸'} ${state && state.game === 'poe1' ? 'Weapon swap, flasks &amp; jewels' : 'Weapon swap, flasks, charms &amp; jewels'} (${showExtras.length} saved)</button></td></tr>`
    + (extraOpen ? extras.map(row).join('') : '')
    + '<tr><td colspan="4" class="note" id="gearMsg"></td></tr>';
  $('#extraToggle').addEventListener('click', () => { window.__extraOpen = !extraOpen; renderSlots(); });
  // Clear asks once more (a mis-click would lose the saved item)
  document.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', async () => {
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Clear it?'; setTimeout(() => { if (b.isConnected) { delete b.dataset.sure; b.textContent = 'Clear'; } }, 4000); return; }
    await window.api.clearSlot(b.dataset.clear); load();
  }));
  // the full mods of an item: click its line
  document.querySelectorAll('.mods-line').forEach((m) => m.addEventListener('click', () => m.classList.toggle('open')));
  // the answer shows right under the button you clicked (the table's last row is often off screen)
  document.querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', async () => {
    document.querySelectorAll('.slot-msg').forEach((x) => x.remove());
    const msg = document.createElement('div'); msg.className = 'note slot-msg'; msg.textContent = 'Searching the trade site…';
    b.parentNode.appendChild(msg);
    document.querySelectorAll('[data-quick]').forEach((x) => { x.disabled = true; });
    try { window.showSearchResult(msg, await window.api.quickFind(b.dataset.quick, 'upgrade')); } finally {
      document.querySelectorAll('[data-quick]').forEach((x) => { x.disabled = false; });
    }
  }));
  document.querySelectorAll('[data-custom]').forEach((b) => b.addEventListener('click', () => openFind(b.dataset.custom)));
}
