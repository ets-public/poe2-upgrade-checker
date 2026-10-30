'use strict';

// Settings window: ignored stats, the stat picker, saved and recent searches, suggested weights and
// popup options.

// ---------- ignored stats ----------
function ignoreRulesNow() { return (state && state.settings.ignoreStats) || []; }
function presetTest(id, key) {
  const t = {
    res: /^#% to (Fire|Cold|Lightning|Chaos) Resistance$/, eleres: /^#% to (Fire|Cold|Lightning) Resistance$/,
    chaosres: /^#% to Chaos Resistance$/, attributes: /^# to (Strength|Dexterity|Intelligence)$/,
    life: /^# to maximum Life$/, mana: /^# to maximum Mana$/,
  }[id];
  return !!(t && t.test(key));
}
// same normal form as src/core/statnorm.js
const normStat = (t) => String(t).toLowerCase().replace(/\+/g, '').replace(/\b(total|to)\b/g, ' ').replace(/\s*\(local\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
function isIgnoredKey(key) { return ignoreRulesNow().some((r) => (r.id ? presetTest(r.id, key) : (r.key === key || normStat(r.key) === normStat(key)))); }

function renderIgnore() {
  const rules = ignoreRulesNow();
  const presetRows = (state.ignorePresets || []).map((p) => {
    const r = rules.find((x) => x.id === p.id);
    return `<tr><td><label><input type="checkbox" data-preset="${esc(p.id)}" ${r ? 'checked' : ''}> ${esc(p.label)}</label></td>
      <td><select data-mode="${esc(p.id)}" ${r ? '' : 'disabled'}>
        <option value="ignore" ${r && r.mode !== 'exclude' ? 'selected' : ''}>Ignore</option>
        <option value="exclude" ${r && r.mode === 'exclude' ? 'selected' : ''}>Exclude listings with it</option>
      </select></td><td></td></tr>`;
  });
  const keyRows = rules.filter((r) => r.key).map((r) => `<tr><td>${esc(r.key)}</td>
      <td><select data-keymode="${esc(r.key)}">
        <option value="ignore" ${r.mode !== 'exclude' ? 'selected' : ''}>Ignore</option>
        <option value="exclude" ${r.mode === 'exclude' ? 'selected' : ''}>Exclude listings with it</option>
      </select></td><td><button data-unignore="${esc(r.key)}">Remove</button></td></tr>`);
  $('#ignoreList').innerHTML = presetRows.join('') + keyRows.join('');
  $('#ignoreStatsList').innerHTML = (state.seenStats || []).filter((k) => !k.startsWith('[')).map((k) => `<option value="${esc(k)}">`).join('');
  document.querySelectorAll('#ignoreList [data-preset]').forEach((cb) => cb.addEventListener('change', () => {
    const id = cb.dataset.preset;
    const next = ignoreRulesNow().filter((r) => r.id !== id);
    if (cb.checked) next.push({ id, mode: document.querySelector(`[data-mode="${id}"]`).value || 'ignore' });
    saveIgnore(next);
  }));
  document.querySelectorAll('#ignoreList [data-mode]').forEach((sel) => sel.addEventListener('change', () => {
    saveIgnore(ignoreRulesNow().map((r) => (r.id === sel.dataset.mode ? { ...r, mode: sel.value } : r)));
  }));
  document.querySelectorAll('#ignoreList [data-keymode]').forEach((sel) => sel.addEventListener('change', () => {
    saveIgnore(ignoreRulesNow().map((r) => (r.key === sel.dataset.keymode ? { ...r, mode: sel.value } : r)));
  }));
  document.querySelectorAll('#ignoreList [data-unignore]').forEach((b) => b.addEventListener('click', () => {
    saveIgnore(ignoreRulesNow().filter((r) => r.key !== b.dataset.unignore));
  }));
}

async function saveIgnore(rules) {
  const saved = await window.api.setIgnore(rules);
  state.settings.ignoreStats = saved;
  renderIgnore();
  // keep the custom search rows in step (without losing other edits)
  findRows.forEach((r) => {
    const ig = isIgnoredKey(r.key);
    if (ig && !r.ignored) r.keep = false;
    if (!ig && r.ignored && r.source !== 'socket') r.keep = true;
    r.ignored = ig;
  });
  renderFindRows();
}

$('#ignoreAddBtn').addEventListener('click', () => {
  const key = $('#ignoreAdd').value.trim();
  if (!key) return;
  $('#ignoreAdd').value = '';
  if (ignoreRulesNow().some((r) => r.key === key)) return;
  saveIgnore([...ignoreRulesNow(), { key, mode: 'ignore' }]);
});

// ---------- stat database picker hooks ----------
window.__ignoreRules = () => ignoreRulesNow();
window.__saveIgnore = (rules) => saveIgnore(rules);
window.__weights = () => (state && state.weights) || {};
window.__afterWeight = async () => { state = await window.api.getState(); renderWeights(); };
function currentFindClass() {
  const sel = $('#findSlot') && $('#findSlot').value;
  if (!sel) return null;
  if (sel.startsWith('item:')) { const r = recent.find((x) => 'item:' + x.id === sel); return r && r.itemClass; }
  return state.equipped[sel] && state.equipped[sel].itemClass;
}
$('#addBrowse').addEventListener('click', () => window.openStatPicker({
  mode: 'search', itemClass: currentFindClass(),
  onPick: ({ text, id, kind, min }) => {
    findRows.push({ key: text, id, idType: kind, current: null, keep: true, min, max: '' });
    rowsEdited = true;
    renderFindRows();
  },
}));
$('#ignoreBrowse').addEventListener('click', () => window.openStatPicker({ mode: 'ignore', itemClass: currentFindClass() }));
$('#weightBrowse').addEventListener('click', () => window.openStatPicker({ mode: 'weight', query: $('#filter').value.trim() }));

// ---------- options: results & startup ----------

$('#startWithWindows').addEventListener('change', () => window.api.setSetting('startWithWindows', $('#startWithWindows').checked));
$('#openSettingsOnStart').addEventListener('change', () => window.api.setSetting('openSettingsOnStart', $('#openSettingsOnStart').checked));

// ---------- saved searches ----------
async function renderSaved() {
  const list = await window.api.savedList();
  const ago2 = (t) => (t ? ago(t) : '');
  $('#savedList').innerHTML = list.length ? '<tr><th>Search</th><th>Listings last time</th><th></th></tr>' + list.map((x) => `<tr>
      <td><b>${esc(x.name)}</b><div class="dim">${esc(x.league)}${x.itemClass ? ' · ' + esc(x.itemClass) : ''}${x.value ? ' · build-value alert: only new listings that clear it are notified' : ''}</div></td>
      <td>${x.lastTotal != null ? esc(x.lastTotal) : '?'} <span class="dim">${esc(ago2(x.lastRun))}</span><div class="note" data-savedmsg="${esc(x.id)}"></div></td>
      <td class="nowrap"><label class="small"><input type="checkbox" data-alert="${esc(x.id)}" ${x.alert ? 'checked' : ''}> Alert</label> <button class="primary gilded" data-run="${esc(x.id)}">Run</button> <button data-del="${esc(x.id)}">Delete</button></td></tr>`).join('')
    : '<tr><td class="dim">No saved searches yet.</td></tr>';
  document.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', async () => {
    const msg = document.querySelector(`[data-savedmsg="${b.dataset.run}"]`);
    msg.textContent = 'Searching…'; b.disabled = true;
    const r = await window.api.savedRun(b.dataset.run).catch((err) => ({ ok: false, error: (err && err.message) || String(err) }));
    b.disabled = false;
    if (!r || !r.ok) { msg.textContent = (r && r.error) || 'Search failed.'; return; }
    const diff = r.prev != null && r.total != null ? r.total - r.prev : null;
    msg.textContent = r.total === 0 ? 'Nothing listed right now.' : `${r.total} listed${diff != null ? ` (${diff >= 0 ? '+' : ''}${diff} since last time)` : ''}.`;
    setTimeout(renderSaved, 1500);
  }));
  document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { await window.api.savedDelete(b.dataset.del); renderSaved(); }));
  document.querySelectorAll('[data-alert]').forEach((cb) => cb.addEventListener('change', async () => {
    await window.api.savedAlert(cb.dataset.alert, cb.checked);
    if (cb.checked && !Number($('#alertEvery').value)) { $('#alertEvery').value = '10'; await window.api.setSetting('alertEvery', 10); }
    renderAlertStatus();
  }));
  renderAlertStatus();
}
window.api.onSavedChanged(() => { renderSaved(); renderHistory(); });
window.api.onHistoryChanged(renderHistory);
const histMsgs = {}; // a search's last message, kept when the list is redrawn
async function renderHistory() {
  const list = await window.api.historyList();
  $('#historyClear').classList.toggle('hidden', !list.length);
  $('#historyList').innerHTML = list.length ? list.map((x) => `<tr>
      <td><b>${esc(x.title)}</b><div class="dim">${esc(x.league || '')}${x.total != null ? ` · ${esc(x.total)} listed` : ''} · ${esc(ago(x.at))}</div><div class="note" data-histmsg="${esc(x.searchKey)}">${esc(histMsgs[x.searchKey] || '')}</div></td>
      <td class="nowrap"><button class="primary gilded" data-hrun="${esc(x.id)}" data-hkey="${esc(x.searchKey)}">Run again</button> ${x.saved ? '<span class="dim small">saved</span>' : `<button data-hsave="${esc(x.id)}">☆ Save</button>`}</td></tr>`).join('')
    : '<tr><td class="dim">Searches you run show up here.</td></tr>';
  document.querySelectorAll('[data-hrun]').forEach((b) => b.addEventListener('click', async () => {
    const key = b.dataset.hkey;
    const say = (t) => { histMsgs[key] = t; const m = document.querySelector(`[data-histmsg="${key}"]`); if (m) m.textContent = t; };
    say('Searching…'); b.disabled = true;
    const r = await window.api.historyRun(b.dataset.hrun);
    b.disabled = false;
    say(!r.ok ? (r.error || 'Search failed.') : r.total === 0 ? 'Nothing listed right now.' : `${r.total} listed${r.prev != null && r.total != null ? ` (${r.total - r.prev >= 0 ? '+' : ''}${r.total - r.prev} since then)` : ''}.`);
  }));
  document.querySelectorAll('[data-hsave]').forEach((b) => b.addEventListener('click', async () => { await window.api.historySave(b.dataset.hsave); }));
}
$('#historyClear').addEventListener('click', async () => { await window.api.historyClear(); renderHistory(); });

// ---------- suggested weights ----------
$('#suggestBtn').addEventListener('click', async () => {
  const list = await window.api.suggestWeights();
  const box = $('#suggestBox');
  box.classList.remove('hidden');
  if (!list.length) { box.innerHTML = '<div class="note">Save your equipped gear first (My gear page) – the suggestions come from it.</div>'; return; }
  box.innerHTML = `<div class="help">Based on your equipped gear: each stat's typical roll is worth about 30 points, more if several of your items have it. You can tweak any number afterwards.</div>
    <table class="list"><tr><th>Stat</th><th>On items</th><th>Typical roll</th><th>Now</th><th>Suggested</th></tr>
    ${list.map((x) => `<tr><td>${esc(x.key)}</td><td>${x.slots}</td><td>${x.avg}</td><td class="dim">${state.weights[x.key] || '–'}</td><td><b>${x.weight}</b></td></tr>`).join('')}</table>
    <div class="row"><button class="primary" id="sugReplace">Use these weights</button><button id="sugMerge">Only add missing ones</button><button id="sugCancel">Cancel</button><span class="note" id="sugMsg"></span></div>`;
  $('#sugCancel').addEventListener('click', () => box.classList.add('hidden'));
  $('#sugReplace').addEventListener('click', async () => {
    const obj = {}; list.forEach((x) => { obj[x.key] = x.weight; });
    const backup = { ...state.weights };
    await window.api.replaceWeights(obj); await load();
    $('#sugMsg').innerHTML = 'Weights replaced. ';
    const u = document.createElement('button'); u.className = 'link'; u.textContent = 'Undo';
    u.addEventListener('click', async () => { await window.api.replaceWeights(backup); await load(); $('#sugMsg').textContent = 'Your previous weights are back.'; });
    $('#sugMsg').appendChild(u);
  });
  $('#sugMerge').addEventListener('click', async () => {
    const obj = { ...state.weights }; list.forEach((x) => { if (!obj[x.key]) obj[x.key] = x.weight; });
    await window.api.replaceWeights(obj); await load();
    $('#sugMsg').textContent = 'Added the missing weights; your existing ones were kept.';
  });
});


// ---------- popup / display options ----------
['popupPosition', 'uiScale', 'popupDetail'].forEach((k) => $('#' + k).addEventListener('change', async () => {
  const v = k === 'uiScale' ? Number($('#' + k).value) : $('#' + k).value;
  await window.api.setSetting(k, v);
  if (k === 'popupPosition') window.api.testPopup();
}));
$('#colorblind').addEventListener('change', async () => { await window.api.setSetting('colorblind', $('#colorblind').checked); document.body.classList.toggle('cb', $('#colorblind').checked); });
$('#resultsHotkey').addEventListener('keydown', (e) => {
  if (captureKeys(e, $('#resultsHotkey'), () => (state && state.settings.resultsHotkey) || 'Ctrl+Shift+D', $('#resultsHotkeyMsg'))) return;
  const acc = toAccelerator(e);
  if (acc) { $('#resultsHotkey').value = acc; $('#resultsHotkeyMsg').textContent = 'Click Save to use it.'; }
});
$('#resultsHotkeySave').addEventListener('click', async () => {
  await window.api.setSetting('resultsHotkey', $('#resultsHotkey').value.trim());
  const st = await window.api.getState();
  const k = $('#resultsHotkey').value.trim();
  const clash = k.toLowerCase() === String(st.settings.hotkey || 'F2').toLowerCase();
  $('#resultsHotkeyMsg').textContent = clash ? `${k} is your item hotkey – pick a different key for the results window.` : st.resultsHotkeyOk === false ? `Saved, but ${k} couldn't be registered – another app may use it.` : 'Saved.';
});
document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => document.querySelector(`.tabs button[data-tab="${b.dataset.goto}"]`).click()));
window.api.onSettingsTab((tab) => {
  // price range, sellers and ignored stats now live on the Find upgrades page
  const focus = tab === 'search' ? '#ignoreCard' : tab === 'league' ? '#findLeague' : null;
  if (tab === 'search' || tab === 'league') tab = 'find';
  const b = document.querySelector(`.tabs button[data-tab="${tab}"]`);
  if (b) b.click();
  if (focus) setTimeout(() => { const el = $(focus); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); if (focus === '#findLeague') el.focus(); } }, 150);
});

// Find tab extra buttons
$('#findCraft').addEventListener('click', () => runFind(() => window.api.quickFind(toTarget($('#findSlot').value), 'craft', searchExtra())));
$('#findPrice').addEventListener('click', () => runFind(() => window.api.priceCheck(toTarget($('#findSlot').value))));
