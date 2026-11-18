'use strict';

// The settings the app's pages may set with setting:set. Everything else has its own call that checks
// what it gets (hotkeys, folders, the filter file, the route...), so a page can't set a path or a
// hotkey around those checks. test/audit-fixes.test.js fails when a page sets a key not listed here.
const SETTABLE = new Set([
  'advancedCopy', 'alertEvery', 'autoHideSeconds', 'autoRate', 'autoSwitchChar', 'autoUpdate', 'autoUpdateGear',
  'betaUpdates', 'budget', 'build', 'buildTweaks', 'colorblind', 'divineRate', 'league', 'leveling', 'noCorrupted',
  'openSettingsOnStart', 'paused', 'pobDamageWeight', 'popupDetail', 'popupPosition', 'resultsHotkey', 'setupHidden',
  'soldCheck', 'startWithWindows', 'status', 'uiScale', 'usageStats', 'watchClipboard', 'wizardDone',
]);

const settable = (key) => typeof key === 'string' && SETTABLE.has(key);

module.exports = { SETTABLE, settable };
