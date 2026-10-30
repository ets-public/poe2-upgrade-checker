'use strict';

// Settings window: the loot filter, hotkeys, and your budget and levelling options.

// ---------- loot filter from your build ----------
$('#filterMake').addEventListener('click', async () => {
  const b = $('#filterMake'); b.disabled = true;
  $('#filterMsg').innerHTML = '<span class="spinner"></span> Asking Path of Building which mods matter for each slot (about half a minute)…';
  try {
    const r = await window.api.filterMake();
    $('#filterMsg').textContent = r && r.ok ? r.message : (r && r.error) || 'Something went wrong.';
  } catch (err) { $('#filterMsg').textContent = err.message; }
  b.disabled = false;
  renderFilterStatus();
});
// the filter you made for this character: up to date with your gear and build?
let filterStatusBusy = false;
async function renderFilterStatus() {
  if (filterStatusBusy || !$('#filterStatus')) return;
  filterStatusBusy = true;
  try {
    const st = await window.api.filterStatus().catch(() => null);
    const el = $('#filterStatus');
    $('#filterRemake').classList.toggle('hidden', !st);
    if (!st) { el.innerHTML = ''; return; }
    const when = new Date(st.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    el.innerHTML = !st.exists ? `<span class="warn">${esc(st.file)} is gone: make the filter again.</span>`
      : st.upToDate === false ? `<span class="warn">⚠ ${esc(st.file)} (made ${esc(when)}) is out of date: your gear or build has changed since. Press <b>Remake</b>.</span>`
        : `<span class="dim">${esc(st.file)} made ${esc(when)}${st.source ? ` from ${esc(st.source)}` : ''}${st.upToDate ? ': up to date' : ''}.</span>`;
  } finally { filterStatusBusy = false; }
}
$('#filterRemake').addEventListener('click', async () => {
  const b = $('#filterRemake'); b.disabled = true;
  $('#filterMsg').innerHTML = '<span class="spinner"></span> Making it again…';
  try { const r = await window.api.filterRemake(); $('#filterMsg').textContent = r && r.ok ? r.message : (r && r.error) || 'Something went wrong.'; } catch (err) { $('#filterMsg').textContent = err.message; }
  b.disabled = false;
  renderFilterStatus();
});
window.api.onChanged(() => renderFilterStatus());
// you changed game: forget this window's copy of the other game's leagues, stats and recent items
if (window.api.onGameChanged) window.api.onGameChanged(async () => {
  tradeInfo = null; budgetGame = null;
  if (window.__pickerRefresh) window.__pickerRefresh();
  await load();
  await refreshFindForCharacter();
});

// ---------- hotkey capture ----------
function toAccelerator(e) {
  const k = e.key;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(k)) return null;
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  let key;
  if (/^F\d{1,2}$/.test(k)) key = k;
  else if (k.length === 1 && /[a-z0-9]/i.test(k)) key = k.toUpperCase();
  else if (e.code && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (e.code && /^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (k === ' ') key = 'Space';
  else key = { Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', '`': '`' }[k];
  if (!key) return null;
  if (!parts.length && !/^F\d/.test(key)) return null; // plain letters would block typing everywhere
  return [...parts, key].join('+');
}
// Tab / Shift+Tab move on as usual; Esc puts the saved key back and leaves the box
function captureKeys(e, inp, saved, msg) {
  if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) return true;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); inp.value = saved(); if (msg) msg.textContent = ''; inp.blur(); return true; }
  e.preventDefault();
  return false;
}
$('#hotkey').addEventListener('keydown', (e) => {
  if (captureKeys(e, $('#hotkey'), () => (state && state.settings.hotkey) || 'F2', $('#hotkeyMsg'))) return;
  const acc = toAccelerator(e);
  if (acc) { $('#hotkey').value = acc; $('#hotkeyMsg').textContent = 'Click Save to use it.'; }
  else if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) $('#hotkeyMsg').textContent = 'Use a modifier (Ctrl/Alt) plus a key, or an F-key.';
});
$('#hotkeySave').addEventListener('click', async () => {
  const res = await window.api.setHotkey($('#hotkey').value.trim());
  await load();
  $('#hotkeyMsg').textContent = res.ok ? `Saved. Active: ${res.accelerator}.${res.warning ? ' ' + res.warning : ''}` : res.error;
});
function priceKeyNow() { const k = state && state.settings.priceHotkey; return k === undefined ? 'F3' : k; }
$('#priceHotkey').addEventListener('keydown', (e) => {
  if (captureKeys(e, $('#priceHotkey'), priceKeyNow, $('#priceHotkeyMsg'))) return;
  const acc = toAccelerator(e);
  if (acc) { $('#priceHotkey').value = acc; $('#priceHotkeyMsg').textContent = 'Click Save to use it.'; }
  else if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) $('#priceHotkeyMsg').textContent = 'Use a modifier (Ctrl/Alt) plus a key, or an F-key.';
});
const savePriceKey = async (k) => {
  const res = await window.api.setPriceHotkey(k);
  await load();
  $('#priceHotkeyMsg').textContent = res.ok ? (res.accelerator ? `Saved. Active: ${res.accelerator}.` : 'Turned off.') : res.error;
};
$('#priceHotkeySave').addEventListener('click', () => savePriceKey($('#priceHotkey').value.trim()));
// "Save as equipped": hover an item you wear and press it (off until you pick a key)
const equipKeyNow = () => (state && state.settings.equipHotkey) || '';
$('#equipHotkey').addEventListener('keydown', (e) => {
  if (captureKeys(e, $('#equipHotkey'), equipKeyNow, $('#equipHotkeyMsg'))) return;
  const acc = toAccelerator(e);
  if (acc) { $('#equipHotkey').value = acc; $('#equipHotkeyMsg').textContent = 'Click Save to use it.'; }
  else if (!['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) $('#equipHotkeyMsg').textContent = 'Use a modifier (Ctrl/Alt) plus a key, or an F-key.';
});
const saveEquipKey = async (k) => {
  const res = await window.api.setEquipHotkey(k);
  await load();
  $('#equipHotkeyMsg').textContent = res.ok ? (res.accelerator ? `Saved. Hover an item you wear and press ${res.accelerator}.${res.warning ? ' ' + res.warning : ''}` : 'Turned off.') : res.error;
};
$('#equipHotkeySave').addEventListener('click', () => saveEquipKey($('#equipHotkey').value.trim()));
$('#equipHotkeyOff').addEventListener('click', () => saveEquipKey(''));
$('#priceHotkeyOff').addEventListener('click', () => savePriceKey(''));
$('#advancedCopy').addEventListener('change', () => window.api.setSetting('advancedCopy', $('#advancedCopy').checked));
$('#watchClipboard').addEventListener('change', () => window.api.setSetting('watchClipboard', $('#watchClipboard').checked));
$('#autoUpdateGear').addEventListener('change', () => window.api.setSetting('autoUpdateGear', $('#autoUpdateGear').checked));
$('#testPopup').addEventListener('click', () => window.api.testPopup());
$('#openLog').addEventListener('click', () => window.api.openLog());

// ---------- budget ----------
// PoE1 budgets are in divines or chaos (exalts aren't an everyday currency there)
function gameBudgetOptions() {
  const o = document.querySelector('#budgetCurrency option[value="exalted"]');
  if (o) o.hidden = !!(state && state.game === 'poe1');
  if (o && o.hidden && $('#budgetCurrency').value === 'exalted') $('#budgetCurrency').value = 'divine';
}
function readBudget() {
  const n = (id) => { const v = Number($(id).value.trim()); return $(id).value.trim() && v > 0 ? v : null; };
  let min = n('#budgetMin'); let max = n('#budgetMax');
  if (min == null && max == null) return null;
  if (min != null && max != null && min > max) [min, max] = [max, min];
  return { min, max, currency: $('#budgetCurrency').value, divineRate: $('#divineRate').value ? Number($('#divineRate').value) : null };
}
function budgetHelp() {
  const b = readBudget();
  $('#rateWrap').classList.toggle('hidden', $('#budgetCurrency').value !== 'divine');
  if (!b) { $('#budgetHelp').textContent = 'No price limits. They apply to every trade search.'; return; }
  const name = { divine: 'div', exalted: 'ex', chaos: 'chaos' }[b.currency];
  const range = b.min != null && b.max != null ? `between ${b.min} and ${b.max} ${name}` : b.max != null ? `up to ${b.max} ${name}` : `at least ${b.min} ${name}`;
  let t;
  const f = (x) => Number(x).toLocaleString();
  // matches trade.priceFilter: the trade site's own "exalted equivalent" is far off the market rate
  // PoE1 counts everyday prices in chaos, PoE2 in exalts
  const p1 = state && state.game === 'poe1';
  const bw = p1 ? 'chaos' : 'exalts'; const bs = p1 ? 'chaos' : 'ex';
  // PoE1: every currency, counted in chaos the way the PoE1 trade site does (trade.priceFilter)
  if (p1 && (b.currency === 'chaos' || (b.currency === 'divine' && b.divineRate))) {
    const c = (v) => f(b.currency === 'divine' ? Math.round(v * b.divineRate) : v);
    const conv = b.max != null ? `${b.min != null ? c(b.min) + '–' : 'up to '}${c(b.max)} chaos` : `${c(b.min)}+ chaos`;
    t = `Listings in any currency, ${range}${b.currency === 'divine' ? ` (${conv} at today's rate)` : ''}, counted in chaos the way the trade site does.`;
  } else if (b.currency === 'divine' && b.max != null && b.max <= 2 && b.divineRate) t = `Listings priced in ${bw}, ${range} (${b.min != null ? f(Math.ceil(b.min * b.divineRate)) + '–' : 'up to '}${f(Math.floor(b.max * b.divineRate))} ${bs} at today's rate). At these prices almost everything is listed in ${bw}.`;
  else if (b.currency === 'divine') t = `Listings priced in Divine Orbs, ${range}. (Items priced only in ${bw} aren't included – at these prices almost everything is listed in divines.)`;
  else if (b.currency === 'exalted') t = `Listings priced in Exalted Orbs, ${range}.`;
  else t = `Only listings priced in Chaos Orbs, ${range}.`;
  if (b.min != null) t += ' Cheaper junk is filtered out.';
  $('#budgetHelp').textContent = t;
}
let budgetGame = null; // the game the budget form shows
function loadBudget() {
  const b = state.settings.budget;
  const p1g = state.game === 'poe1';
  if ($('#rateUnit')) $('#rateUnit').textContent = p1g ? 'Chaos' : 'Exalted';
  if ($('#prSpiritText')) {
    $('#prSpiritText').textContent = p1g ? 'Never run short of mana or life for your auras' : 'Never run short of Spirit';
    $('#prSpirit').parentNode.title = p1g ? 'An item that leaves too little unreserved mana or life for your auras is never an upgrade' : 'An item that leaves you without enough Spirit for your minions and auras is never an upgrade';
  }
  // don't overwrite what you're typing, unless the form still shows the other game's budget
  if (budgetGame === state.game && document.activeElement && document.activeElement.closest && document.activeElement.closest('.filterbar')) return;
  budgetGame = state.game;
  $('#budgetMax').value = b && b.max != null ? b.max : '';
  $('#budgetMin').value = b && b.min != null ? b.min : '';
  $('#budgetCurrency').value = (b && b.currency) || 'divine';
  gameBudgetOptions();
  const auto = state.settings.autoRate !== false;
  $('#autoRate').checked = auto;
  $('#divineRate').readOnly = auto;
  $('#divineRate').value = auto ? (state.settings.divineRate || '') : ((b && b.divineRate) || state.settings.divineRate || '');
  const lv = state.settings.leveling || {};
  $('#levelOn').checked = !!lv.on;
  $('#noCorrupted').checked = state.settings.noCorrupted === true;
  $('#levelCap').value = lv.level || state.charLevel || '';
  $('#levelFromPob').classList.toggle('hidden', !state.charLevel || Number(lv.level) === state.charLevel);
  budgetHelp();
}
function ago(t) {
  if (!t) return '';
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}
async function showRate(force) {
  if (!$('#autoRate').checked) { $('#rateStatus').textContent = 'Using your own rate.'; return; }
  $('#rateStatus').textContent = 'Getting the latest Divine price from poe.ninja…';
  const r = await window.api.getRate(!!force);
  if (r.rate) { $('#divineRate').value = r.rate; budgetHelp(); }
  $('#rateStatus').textContent = r.ok
    ? `1 Divine ≈ ${r.rate} ${state && state.game === 'poe1' ? 'Chaos' : 'Exalted'} (${r.league || 'current league'}, poe.ninja, ${ago(r.at)}). Updates every hour.`
    : `Couldn't get the rate from poe.ninja (${r.error}).` + (r.rate ? ` Using the last known rate, ${r.rate} ${state && state.game === 'poe1' ? 'chaos' : 'ex'}.` : ' Untick Auto and type the rate in.');
}
async function saveBudget() {
  budgetHelp();
  const b = readBudget();
  await window.api.setSetting('budget', b);
  if ($('#divineRate').value) await window.api.setSetting('divineRate', Number($('#divineRate').value));
}
['#budgetMin', '#budgetMax', '#budgetCurrency', '#divineRate'].forEach((id) => $(id).addEventListener('change', saveBudget));
$('#budgetMax').addEventListener('input', budgetHelp);
$('#budgetMin').addEventListener('input', budgetHelp);
// leveling mode: upgrade searches only find items you can wear at your level
async function saveLeveling() {
  const level = Math.max(1, Math.min(100, Math.round(Number($('#levelCap').value) || 0))) || null;
  await window.api.setSetting('leveling', { on: $('#levelOn').checked && !!level, level });
  state = await window.api.getState();
  $('#levelFromPob').classList.toggle('hidden', !state.charLevel || level === state.charLevel);
  budgetHelp();
}
$('#levelOn').addEventListener('change', () => { if ($('#levelOn').checked && !$('#levelCap').value && state.charLevel) $('#levelCap').value = state.charLevel; saveLeveling(); });
$('#levelCap').addEventListener('change', saveLeveling);
$('#noCorrupted').addEventListener('change', async () => { await window.api.setSetting('noCorrupted', $('#noCorrupted').checked); });
$('#levelFromPob').addEventListener('click', () => { $('#levelCap').value = state.charLevel; saveLeveling(); });
$('#budgetClear').addEventListener('click', () => { $('#budgetMax').value = ''; $('#budgetMin').value = ''; saveBudget(); });

$('#autoRate').addEventListener('change', async () => {
  await window.api.setSetting('autoRate', $('#autoRate').checked);
  $('#divineRate').readOnly = $('#autoRate').checked;
  showRate(false);
});
$('#rateRefresh').addEventListener('click', () => showRate(true));
document.querySelector('.tabs button[data-tab="find"]').addEventListener('click', () => showRate(false));
window.api.onFindUpgrade(() => showRate(false));
