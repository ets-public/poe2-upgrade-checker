'use strict';

// Settings window: the gear score editor, alerts, your account, updates, the gear score help,
// and the watchlist.

// ---------- gear score editor ----------
function renderBuildEditor() {
  const stats = state.buildStats || [];
  const tw = state.settings.buildTweaks || {};
  if (state.settings.build === 'off' || !stats.length) { $('#buildEditor').innerHTML = '<tr><td class="dim">Untick Custom above to edit the gear score of a profile.</td></tr>'; return; }
  const opts = [0, 0.5, 1, 1.5, 2, 3];
  $('#buildEditor').innerHTML = '<tr><th>Stat</th><th>Counts on (importance)</th><th>How much it matters</th></tr>' + stats.map((x) => {
    const cur = tw[x.label] != null ? Number(tw[x.label]) : 1;
    return `<tr><td>${esc(x.label)}</td><td class="dim small">${esc(x.where)}</td>
      <td><select data-tweak="${esc(x.label)}">${opts.map((o) => `<option value="${o}" ${o === cur ? 'selected' : ''}>${o === 0 ? 'Off' : o + '×'}</option>`).join('')}</select></td></tr>`;
  }).join('');
  document.querySelectorAll('[data-tweak]').forEach((sel) => sel.addEventListener('change', async () => {
    const t = { ...(state.settings.buildTweaks || {}) };
    if (Number(sel.value) === 1) delete t[sel.dataset.tweak]; else t[sel.dataset.tweak] = Number(sel.value);
    await window.api.setSetting('buildTweaks', t);
    $('#buildMsg').textContent = 'Saved – gear scores updated.';
    await load();
  }));
}
$('#buildTweaksReset').addEventListener('click', async () => { await window.api.setSetting('buildTweaks', {}); $('#buildMsg').textContent = "Back to the profile's defaults."; await load(); });

// ---------- alerts ----------
async function renderAlertStatus() {
  const st = await window.api.alertsStatus();
  if (document.activeElement !== $('#alertEvery')) $('#alertEvery').value = String(st.every || 0);
  $('#alertStatus').textContent = !st.every ? 'Alerts are off.' : st.lastRun ? `Last checked ${ago(st.lastRun)}.` : 'Checks start within a minute.';
}
$('#alertEvery').addEventListener('change', async () => { await window.api.setSetting('alertEvery', Number($('#alertEvery').value)); renderAlertStatus(); });

// ---------- account ----------
async function renderAccount() {
  accountAt = Date.now();
  const st = await window.api.accountStatus();
  $('#signStatus').textContent = st.signedIn ? 'Signed in.' : 'Not signed in.';
  $('#signOut').disabled = !st.signedIn;
}
$('#signIn').addEventListener('click', async () => { $('#signStatus').textContent = 'Sign in in the window that opened…'; await window.api.signIn(); renderAccount(); });
$('#signOut').addEventListener('click', async () => { await window.api.signOut(); renderAccount(); });

// ---------- updates ----------
async function renderUpdate(st) {
  st = st || await window.api.updateStatus();
  const v = `Version ${st.current}`;
  const msg = {
    dev: `${v}. Running from source (start.bat), so updates don't apply – pull the new files instead.`,
    portable: state && state.platform === 'linux'
      ? `${v}. Only the AppImage updates itself – download PoE-Upgrade-Checker.AppImage from the releases page to get updates.`
      : `${v}. The portable .exe can't update itself – install the Setup version from the releases page to get updates.`,
    unavailable: `${v}. The updater isn't installed in this copy.`,
    idle: `${v}.`,
    checking: `${v}. Checking…`,
    latest: `${v}. You're up to date.`,
    available: `${v}. Version ${st.version} is available.`,
    downloading: `${v}. Downloading ${st.version}${st.progress != null ? ` (${st.progress}%)` : ''}…`,
    ready: `${v}. Version ${st.version} is ready.`,
    error: `${v}. Couldn't check: ${st.error || 'unknown error'}`,
  }[st.state] || v;
  $('#updStatus').textContent = msg;
  const noUpd = ['dev', 'portable', 'unavailable'].includes(st.state);
  $('#updCheck').disabled = noUpd || st.state === 'checking';
  $('#autoUpdate').disabled = noUpd;
  $('#betaUpdates').disabled = noUpd;
  const act = $('#updAction');
  act.classList.toggle('hidden', !['available', 'ready'].includes(st.state));
  act.textContent = st.state === 'ready' ? 'Restart & update' : 'Download';
}
$('#updCheck').addEventListener('click', async () => { $('#updStatus').textContent = 'Checking…'; renderUpdate(await window.api.updateCheck()); });
$('#updAction').addEventListener('click', async () => {
  const st = await window.api.updateStatus();
  if (st.state === 'ready') window.api.updateInstall(); else renderUpdate(await window.api.updateDownload());
});
window.api.onUpdateChanged(() => renderUpdate());

// ---------- gear score explanation ----------
$('#gsExplain').innerHTML = window.gearExplainHtml({ where: 'gear score editor on this page' });
window.showGearHelp = () => {
  document.querySelector('.tabs button[data-tab="build"]').click();
  setTimeout(() => $('#gsExplainCard').scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
};
document.querySelectorAll('.page-head .gs-help').forEach((b) => b.addEventListener('click', () => window.showGearHelp()));

// Watchlist: saved searches and alerts, or recent searches
document.querySelectorAll('[data-watch]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-watch]').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.watch-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== b.dataset.watch));
}));

// ---------- start ----------
// Runs once every settings-*.js file has loaded, so each page's functions exist by then.
renderFilterStatus();
load();
window.api.getState().then((st) => { if (!st.settings.wizardDone && !Object.keys(st.equipped || {}).length) openWizard(); });
renderAccount();
(async () => {
  const s = (await window.api.getState()).settings || {};
  $('#autoUpdate').checked = s.autoUpdate !== false;
  $('#autoUpdate').addEventListener('change', () => window.api.setSetting('autoUpdate', $('#autoUpdate').checked));
  $('#betaUpdates').checked = s.betaUpdates === true;
  $('#usageStats').checked = s.usageStats !== false;
  $('#usageStats').addEventListener('change', () => window.api.setSetting('usageStats', $('#usageStats').checked));
  const info = window.api.updateInfo ? await window.api.updateInfo() : null;
  if (info && info.beta) $('#betaNote').textContent = `You're on a beta (${info.current}), so you get the next betas and then the full release. Untick to stay on full releases from the next one on.`;
  $('#betaUpdates').addEventListener('change', async () => { await window.api.setSetting('betaUpdates', $('#betaUpdates').checked); renderUpdate(); });
})();
renderUpdate();
