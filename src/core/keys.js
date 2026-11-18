'use strict';

// Hotkeys written as Electron accelerators ("Ctrl+Shift+X"). The same key can be written several ways:
// the modifiers in another order (Shift+Ctrl+X), another name for Ctrl (Control, CmdOrCtrl,
// CommandOrControl) or other case. normKey turns each into one form, so two of the app's keys can be
// compared and a clash is reported as the app's own key, not as "another program".
const ALIAS = {
  control: 'ctrl', cmdorctrl: 'ctrl', commandorcontrol: 'ctrl',
  command: 'cmd', option: 'alt', super: 'meta', windows: 'meta',
  return: 'enter', esc: 'escape',
};

function normKey(accel) {
  const parts = String(accel || '').toLowerCase().split('+').map((s) => s.trim());
  // "Ctrl++" (Ctrl and the plus key): the empty piece at the end is the + key
  if (parts.length > 1 && parts[parts.length - 1] === '' && parts[parts.length - 2] === '') { parts.splice(-2, 2, 'plus'); }
  const clean = parts.filter(Boolean).map((p) => ALIAS[p] || p);
  if (!clean.length) return '';
  const key = clean.pop();
  const mods = [...new Set(clean)].sort();
  return [...mods, key].join('+');
}

const sameKey = (a, b) => { const x = normKey(a); return x !== '' && x === normKey(b); };

// keys: [{ id, what, key }]. -> the first of them (other than `self`) that is the same key as want, or null
function clash(want, keys, self) {
  if (!normKey(want)) return null;
  return (keys || []).find((k) => k && k.id !== self && k.key && sameKey(want, k.key)) || null;
}

module.exports = { normKey, sameKey, clash };
