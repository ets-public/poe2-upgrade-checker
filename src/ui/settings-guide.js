'use strict';

// Settings window: the setup checklist, the first-run guide, and your characters.

// ---------- setup checklist + guide ----------
const SETUP_SLOTS = ['Weapon', 'Offhand', 'Helmet', 'Body Armour', 'Gloves', 'Boots', 'Belt', 'Amulet', 'Ring 1', 'Ring 2'];
function renderSetup() {
  const have = SETUP_SLOTS.filter((s) => state.equipped[s]);
  const box = $('#setupBox');
  if (have.length >= SETUP_SLOTS.length || state.settings.setupHidden) { box.innerHTML = ''; return; }
  const hk = (state.hotkeyStatus && state.hotkeyStatus.accelerator) || state.settings.hotkey || 'F2';
  box.innerHTML = `<div class="setup-head"><b>Set up your gear: ${have.length} of ${SETUP_SLOTS.length} slots saved</b>
      <div class="progress"><span id="setupBar"></span></div></div>
    <div class="help">In game, open your character screen (C), hover each item and press <b>${esc(hk)}</b>, then click <b>Set as …</b> in the popup. Or import everything from Path of Building below.</div>
    <div class="slotchips">${SETUP_SLOTS.map((s) => `<span class="chip ${state.equipped[s] ? 'done' : ''}">${state.equipped[s] ? '✓' : '○'} ${esc(s)}</span>`).join('')}</div>
    <div class="row"><button class="link" id="setupHide">Hide this</button></div>`;
  $('#setupBar').style.width = `${Math.round((have.length / SETUP_SLOTS.length) * 100)}%`; // CSSOM is fine under the CSP
  $('#setupHide').addEventListener('click', async () => { await window.api.setSetting('setupHidden', true); load(); });
}

let wizStep = 0;
const WIZ = [
  {
    title: 'Welcome to PoE Upgrade Checker',
    body: () => `<p>Hover any item in game and press your hotkey: a popup tells you if it's an <b>upgrade for your build</b> – worked out by Path of Building with your own build – and finds better items on the trade site in one click.</p>
      <p class="help">This guide takes about a minute. You can run it again from <b>My gear → Setup guide</b>.</p>
      <div class="warnbox">⚠ Set the game to <b>Windowed Fullscreen</b> (Options → Graphics). In fullscreen the popup can't show over the game: it's the most common reason it seems to do nothing.</div>
      <p class="help"><label><input type="checkbox" id="wizStats" ${state.settings.usageStats !== false ? 'checked' : ''}> Send anonymous usage statistics</label>: a random install number, the app version and which game you play, so we know how many people use it. No account, items or builds. You can change this in Settings.</p>`,
    after: () => { $('#wizStats').addEventListener('change', async () => { await window.api.setSetting('usageStats', $('#wizStats').checked); const u = $('#usageStats'); if (u) u.checked = $('#wizStats').checked; }); },
  },
  {
    title: 'Your game and league',
    body: () => `<p>Which game are you playing? (Copying an item from the other game later switches by itself, each game with its own character.)</p>
      <div class="row"><label><input type="radio" name="wizGame" value="poe2" ${state.game !== 'poe1' ? 'checked' : ''}> Path of Exile 2</label>
        <label><input type="radio" name="wizGame" value="poe1" ${state.game === 'poe1' ? 'checked' : ''}> Path of Exile 1 <span class="beta-tag">BETA</span></label></div>
      <p>League for trade searches and prices:</p>
      <div class="row"><select id="wizLeague"><option>Loading…</option></select></div>
      <p class="help">Pick the league you play in (Standard is the permanent one). You can change it any time on <b>Find upgrades</b>, or from the popup.</p>`,
    after: () => {
      // the current league stays unpinned (so the app follows the next league by itself) unless you pick one;
      // an answer for the game you've just left is dropped
      const leagues = async () => {
        const sel = $('#wizLeague');
        const game = state.game;
        const t = await ensureTradeInfo(true);
        if (game !== state.game || !$('#wizLeague')) return;
        if (!t || !t.ok) { sel.innerHTML = `<option value="">${esc(state.settings.league || 'The current league')}</option>`; return; }
        const saved = state.settings.league || '';
        sel.innerHTML = `<option value="" ${saved ? '' : 'selected'}>The current league (${esc(t.leagues.find((l) => !/hardcore|standard|ssf|solo/i.test(l)) || t.leagues[0] || 'Standard')})</option>`
          + t.leagues.map((l) => `<option value="${esc(l)}" ${l === saved ? 'selected' : ''}>${esc(l)}</option>`).join('');
      };
      document.querySelectorAll('input[name="wizGame"]').forEach((r) => r.addEventListener('change', async () => {
        if (!r.checked) return;
        $('#wizLeague').innerHTML = '<option>Loading…</option>';
        await window.api.chooseGame(r.value);
        state = await window.api.getState();
        await leagues();
      }));
      $('#wizLeague').addEventListener('change', async () => { await window.api.setSetting('league', $('#wizLeague').value || null); state = await window.api.getState(); });
      leagues();
    },
  },
  {
    title: 'Your build',
    body: () => (state.pobOn ? `<p class="ok-line">✓ Your Path of Building build is loaded for this character, so every item is judged with it.</p><p class="help">To use another build, paste its export or pobb.in link:</p>` : '') + `<p${state.pobOn ? ' class="hidden"' : ''}><b>Best:</b> paste your <b>Path of Building</b> export (in Path of Building: Import/Export Build → Generate; Path of Building 2 for PoE2, Path of Building Community for PoE1) or a pobb.in link. The app then judges every item with Path of Building's own calculations for <i>your</i> build – any class, any skill – and loads your gear.</p>
      <div class="row"><input id="wizPob" class="grow" placeholder="https://pobb.in/…  or  eNrt…"><button id="wizPobBtn" class="primary gilded">Import</button></div><div class="note" id="wizPobMsg"></div>
      ${state.pobOn ? '' : state.game === 'poe1' ? '<p class="help">Path of Exile 1 items are judged by Path of Building only, so this step is what makes the popup work. You can also do it later on <b>My gear</b>.</p>'
    : `<p class="help">No PoB? Pick the closest profile for a rough gear score instead, and save your gear in the next steps:</p>
      <div class="row"><select id="wizBuild">${(state.builds || []).map((b) => `<option value="${esc(b.id)}" ${b.id === (state.settings.build || state.defaultBuild) ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}<option value="off">None – score by my own stat weights</option></select></div>
      <p class="help" id="wizBuildHelp"></p>`}`,
    after: () => {
      const u = () => { if (!$('#wizBuild')) return; const b = (state.builds || []).find((x) => x.id === $('#wizBuild').value); $('#wizBuildHelp').textContent = b ? b.summary : 'You set stat weights yourself in Build & stats.'; };
      u();
      if ($('#wizBuild')) $('#wizBuild').addEventListener('change', async () => { await window.api.setSetting('build', $('#wizBuild').value); u(); });
      $('#wizPobBtn').addEventListener('click', async () => { $('#wizPobMsg').textContent = 'Importing… (the first time, Path of Building takes a few seconds to start)'; const r = await window.api.importPob($('#wizPob').value.trim()); $('#wizPobMsg').textContent = r.ok ? r.message : r.error; if (r.ok) { await load(); state = await window.api.getState(); if ($('#wizBuild')) $('#wizBuild').value = state.settings.build; u(); } });
    },
  },
  {
    title: 'Your hotkey',
    body: () => `<p>Your check-item hotkey is <b>${esc((state.hotkeyStatus && state.hotkeyStatus.accelerator) || state.settings.hotkey || 'F2')}</b>${state.hotkeyStatus && state.hotkeyStatus.ok ? ' and it\'s working.' : ' – <span class="note">it isn\'t working: another program may be using it. Pick another key in Settings after this guide.</span>'}</p>
      <p>Where should the popup appear?</p><div class="row"><select id="wizPos"><option value="cursor">Next to the mouse</option><option value="left">Left side of the screen</option><option value="right">Right side of the screen</option><option value="top">Top of the screen</option></select> <button id="wizTest">Show a test popup</button></div>
      <p class="help">If it covers the game's item tooltip, pick a side of the screen, or drag the popup by its name: it stays where you put it.</p>`,
    after: () => { $('#wizPos').value = state.settings.popupPosition || 'cursor'; $('#wizPos').addEventListener('change', async () => { await window.api.setSetting('popupPosition', $('#wizPos').value); }); $('#wizTest').addEventListener('click', () => window.api.testPopup()); },
  },
  {
    title: 'Your gear',
    body: () => `<p>${state.pobOn ? `<span class="ok-line">✓ Your build's gear is loaded (${Object.keys(state.equipped || {}).length} items).</span> If you wear something different now, hover it in game, press the hotkey and click <b>Set as …</b> in the popup: items you copy in game replace Path of Building's.` : `${Object.keys(state.equipped || {}).length ? `You have <b>${Object.keys(state.equipped).length}</b> items saved.` : 'Save what you\'re wearing so the app can compare.'} In game, hover each equipped item, press the hotkey and click <b>Set as …</b> in the popup.`}</p>
      <p class="help">The <b>My gear</b> tab shows a checklist.${state.pobOn ? '' : ' Without a Path of Building build, also type your resistances from the character sheet there.'}</p>`,
  },
  {
    title: "You're set",
    body: () => `<p>Try it now: hover an item in game and press <b>${esc((state.hotkeyStatus && state.hotkeyStatus.accelerator) || state.settings.hotkey || 'F2')}</b>.</p>
      <div class="note" id="wizLive"><span class="spinner"></span> Waiting for your first item…</div>
      <ul><li><b>Find upgrades</b> searches the trade site and shows listings scored for your build.</li><li><b>What's it worth?</b> prices loot.</li><li>Set your price range and stats to ignore on the <b>Find upgrades</b> page.</li></ul>`,
  },
];
// the last step waits for a real hotkey press and says it worked
let wizLiveHooked = false;
function hookWizLive() {
  if (wizLiveHooked) return; wizLiveHooked = true;
  window.api.onItemCopied((info) => { const el = document.getElementById('wizLive'); if (el) { el.className = 'ok-line'; el.textContent = `✓ It works: ${(info && info.name) || 'your item'} was checked. You're all set.`; } });
}
function renderWiz() {
  hookWizLive();
  const st = WIZ[wizStep];
  $('#wizTitle').textContent = st.title;
  $('#wizBody').innerHTML = st.body();
  $('#wizStep').textContent = `Step ${wizStep + 1} of ${WIZ.length}`;
  $('#wizBack').disabled = wizStep === 0;
  $('#wizNext').textContent = wizStep === WIZ.length - 1 ? 'Done' : 'Next';
  if (st.after) st.after();
}
function openWizard() {
  wizStep = 0; wizOpener = document.activeElement;
  $('#wizard').classList.remove('hidden'); renderWiz();
  const first = $('#wizBody').querySelector('input, select, textarea') || $('#wizNext');
  first.focus();
}
let wizOpener = null;
async function closeWizard() {
  if ($('#wizard').classList.contains('hidden')) return;
  $('#wizard').classList.add('hidden');
  if (wizOpener && wizOpener.isConnected && wizOpener !== document.body) wizOpener.focus();
  await window.api.setSetting('wizardDone', true); load();
}
$('#wizard').__cancel = closeWizard;
$('#wizNext').addEventListener('click', () => { if (wizStep === WIZ.length - 1) closeWizard(); else { wizStep++; renderWiz(); } });
$('#wizBack').addEventListener('click', () => { if (wizStep > 0) { wizStep--; renderWiz(); } });
$('#wizClose').addEventListener('click', closeWizard);
$('#wizardBtn').addEventListener('click', openWizard);

// ---------- characters ----------
async function renderProfiles() {
  const list = state.profiles || [];
  // with characters from both games, group them by game
  const opt = (p) => `<option value="${esc(p.id)}" ${p.active ? 'selected' : ''}>${esc(p.name)}</option>`;
  const games = [...new Set(list.map((p) => p.game || 'poe2'))];
  if ($('#gameBeta')) $('#gameBeta').classList.toggle('hidden', state.game !== 'poe1');
  // with one game only, each name says which game it's for
  const tagged = (p) => `<option value="${esc(p.id)}" ${p.active ? 'selected' : ''}>${esc(p.name)}${/PoE ?[12]/i.test(p.name || '') ? '' : ` (${(p.game || 'poe2') === 'poe1' ? 'PoE1' : 'PoE2'})`}</option>`;
  $('#profileSel').innerHTML = games.length < 2 ? list.map(tagged).join('')
    : [['poe2', 'Path of Exile 2'], ['poe1', 'Path of Exile 1']].filter(([g]) => games.includes(g))
      .map(([g, name]) => `<optgroup label="${name}">${list.filter((p) => (p.game || 'poe2') === g).map(opt).join('')}</optgroup>`).join('');
  $('#profileDelete').disabled = list.length < 2;
  // switched character (here, from the tray or by creating one): drop the last one's PoB code and message
  const act = (list.find((p) => p.active) || {}).id;
  if (lastProfileId && act && act !== lastProfileId) { clearPobBox(); refreshFindForCharacter(); }
  lastProfileId = act || lastProfileId;
}
let lastProfileId = null;
// a PoB code or import message belongs to the character it was typed for
function clearPobBox() { $('#pobInput').value = ''; $('#pobMsg').textContent = ''; }
$('#profileSel').addEventListener('change', async () => { await window.api.switchProfile($('#profileSel').value); clearPobBox(); await load(); });
$('#profileNew').addEventListener('click', async () => {
  const name = await askText('Name for the new character', '', 'e.g. Witch league starter');
  if (!name) return;
  const cur = (state.profiles || []).find((p) => p.active);
  const how = await askChoice(`<h2>New character: ${esc(name)}</h2><p><b>Start empty</b>: no gear, no build, default weights and resistances, and League start from the first step.</p><p class="dim">Or copy ${esc(cur ? `"${cur.name}"` : 'this character')}: its gear, Path of Building build, weights, ignored stats and resistances.</p>`,
    [{ label: 'Start empty', value: 'empty', cls: 'primary' }, { label: 'Copy everything', value: 'copy' }, { label: 'Cancel', value: null }]);
  if (!how) return;
  await window.api.createProfile(name, how === 'copy');
  clearPobBox();
  await load();
});
$('#profileReset').addEventListener('click', async () => {
  const cur = (state.profiles || []).find((p) => p.active);
  if (!cur) return;
  if (!await askYesNo(`Start "${cur.name}" again from nothing? Its gear, Path of Building build, weights, ignored stats, resistances and League start progress are cleared. This can't be undone.`, 'Clear it')) return;
  await window.api.resetProfile(cur.id);
  clearPobBox();
  await load();
});
$('#profileRename').addEventListener('click', async () => {
  const cur = (state.profiles || []).find((p) => p.active);
  const name = await askText('Rename character', cur ? cur.name : '');
  if (name) { await window.api.renameProfile(cur.id, name); await load(); }
});
$('#profileDelete').addEventListener('click', async () => {
  const cur = (state.profiles || []).find((p) => p.active);
  if (cur && await askYesNo(`Delete "${cur.name}" and its saved gear? This can't be undone.`, 'Delete')) { await window.api.deleteProfile(cur.id); clearPobBox(); await load(); }
});

// tiny in-page dialogs (window.prompt isn't available in Electron).
// buttons: [{ label, value, cls }]; a value that is a function gets the dialog element.
// The first input (or button) gets focus, Tab stays inside, Esc = cancel (null).
function dialog(html, buttons) {
  return new Promise((resolve) => {
    const opener = document.activeElement;
    const m = document.createElement('div');
    m.className = 'modal';
    m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = `<div class="modal-box wizard-box">${html}<div class="row wiz-nav"><span class="grow"></span>${buttons.map((b, i) => `<button data-btn="${i}" class="${esc(b.cls || '')}">${esc(b.label)}</button>`).join('')}</div></div>`;
    document.body.appendChild(m);
    const done = (v) => { m.remove(); if (opener && opener.isConnected && opener !== document.body) opener.focus(); resolve(v); };
    const pick = (b) => done(typeof b.value === 'function' ? b.value(m) : b.value);
    m.__cancel = () => done(null);
    m.querySelectorAll('[data-btn]').forEach((el) => el.addEventListener('click', () => pick(buttons[Number(el.dataset.btn)])));
    const ok = buttons.find((b) => /primary/.test(b.cls || ''));
    const inp = m.querySelector('input');
    if (inp) { inp.focus(); inp.select(); if (ok) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(ok); }); } else m.querySelector('[data-btn]').focus();
  });
}
function askText(title, value, placeholder) {
  return dialog(`<h2>${esc(title)}</h2><input class="grow wide" value="${esc(value || '')}" placeholder="${esc(placeholder || '')}">`,
    [{ label: 'Cancel', value: null }, { label: 'OK', cls: 'primary', value: (m) => m.querySelector('input').value.trim() || null }]);
}
function askYesNo(text, okLabel) { return dialog(`<p>${esc(text)}</p>`, [{ label: 'Cancel', value: null }, { label: okLabel || 'OK', cls: 'primary', value: true }]).then((v) => !!v); }
function askChoice(html, buttons) { return dialog(html, buttons); }

// every open dialog (this file's, the setup guide, the stat database): Esc closes the top one, Tab stays inside it
const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])';
function topModal() { return [...document.querySelectorAll('.modal')].filter((m) => !m.classList.contains('hidden')).pop() || null; }
document.addEventListener('keydown', (e) => {
  const m = topModal();
  if (!m) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    if (m.__cancel) m.__cancel(); else m.classList.add('hidden');
    return;
  }
  if (e.key !== 'Tab') return;
  const f = [...m.querySelectorAll(FOCUSABLE)].filter((x) => !x.disabled && x.getClientRects().length);
  if (!f.length) { e.preventDefault(); return; }
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && (i === -1 || i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
}, true);
