'use strict';

// Settings export / import: one file with everything the app keeps for you (characters, gear,
// builds, priorities, saved searches, hotkeys, League start progress) plus your Path of Building
// builds, for a new PC or a reinstall. Left out: the install number for usage statistics (a copy
// on another PC is another install) and caches that the app fetches again (trade site data, rates).

const FORMAT = 1;
const APP = 'poe-upgrade-checker';
// data keys never exported (per install, or fetched again)
const SKIP_DATA = ['installId', 'statsDay', 'statsChecked'];
// settings that belong to this PC, not to you
const SKIP_SETTINGS = ['settingsBounds', 'settingsMaximized', 'popupDragged', 'resultsBounds', 'routeOverlayBounds', 'startWithWindows', 'divineRate', 'divineRateAt', 'divineRateLeague', 'currencyRates', 'seenVersion',
  // folders on this PC: a backup someone shares must not point the app at folders of theirs
  'filterFolders', 'filterEditorFile'];
const POB_FILE = /^[\w.-]{1,80}\.(xml|build)$/;

function pack(data, pobFiles, meta = {}) {
  const d = JSON.parse(JSON.stringify(data || {}));
  for (const k of SKIP_DATA) delete d[k];
  if (d.settings) for (const k of SKIP_SETTINGS) delete d.settings[k];
  if (d.settings && d.settings.route && typeof d.settings.route === 'object') delete d.settings.route.logPath;
  const pob = {};
  for (const [name, text] of Object.entries(pobFiles || {})) if (POB_FILE.test(name) && typeof text === 'string') pob[name] = text;
  return { app: APP, format: FORMAT, version: meta.version || null, made: meta.made || new Date().toISOString(), data: d, pob };
}

// -> { ok, data, pob } or { ok:false, error }. current: the data the app has now (what stays from it)
function unpack(text, current = {}) {
  let o;
  try { o = typeof text === 'string' ? JSON.parse(text) : text; } catch (_) { return { ok: false, error: "That file isn't a PoE Upgrade Checker backup (it isn't JSON)." }; }
  if (!o || o.app !== APP || !o.data || typeof o.data !== 'object') return { ok: false, error: "That file isn't a PoE Upgrade Checker backup." };
  if (Number(o.format) > FORMAT) return { ok: false, error: 'That backup was made by a newer version of the app. Update the app first, then import it.' };
  const data = { ...o.data };
  // keep this PC's own: install number and window places
  for (const k of SKIP_DATA) if (current[k] !== undefined) data[k] = current[k];
  data.settings = { ...(o.data.settings || {}) };
  for (const k of SKIP_SETTINGS) {
    delete data.settings[k];
    if (current.settings && current.settings[k] !== undefined) data.settings[k] = current.settings[k];
  }
  // the League start route keeps this PC's Client.txt paths
  if (data.settings.route && typeof data.settings.route === 'object') {
    const here = current.settings && current.settings.route && current.settings.route.logPath;
    data.settings.route = { ...data.settings.route, logPath: here && typeof here === 'object' ? here : {} };
  }
  const pob = {};
  for (const [name, t] of Object.entries(o.pob || {})) if (POB_FILE.test(name) && typeof t === 'string' && t.length < 20e6) pob[name] = t;
  const profiles = data.profiles && typeof data.profiles === 'object' ? Object.keys(data.profiles).length : 0;
  return { ok: true, data, pob, summary: { version: o.version || null, made: o.made || null, characters: profiles, builds: Object.keys(pob).length } };
}

module.exports = { pack, unpack, FORMAT, APP };
