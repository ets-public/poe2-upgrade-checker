'use strict';

// The gear score profile picker (Build & stats, and the setup guide): what your build's damage is
// (melee, bows/crossbows/spears, spells, minions...) and how it stays alive (life and Armour, Energy
// Shield...), or Custom: your own stat weights. With a Path of Building build loaded, the app picks
// the pair that fits it, and "Match my Path of Building build" picks it again.
window.renderProfilePicker = function (el, opts) {
  if (!el) return;
  opts = opts || {};
  const parts = state.buildParts || { off: [], def: [] };
  const now = state.buildNow || {};
  const custom = state.settings.build === 'off';
  const options = (list, cur) => list.map((x) => `<option value="${esc(x.id)}" ${x.id === cur ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  const canFit = state.pobOn && state.game === 'poe2';
  const how = custom ? 'The gear score uses your own <b>Stat weights</b>.'
    : esc(now.summary || '') + ' Ignored stats (Find upgrades page) are left out.' + (canFit && state.settings.buildPicked === false ? ' <span class="dim">Matched to your Path of Building build.</span>' : '');
  el.innerHTML = `<div class="gs-pick">
      <label><span>Damage</span><select class="gs-off" ${custom ? 'disabled' : ''}>${options(parts.off, now.off || 'any')}</select></label>
      <label><span>Defence</span><select class="gs-def" ${custom ? 'disabled' : ''}>${options(parts.def, now.def || 'life')}</select></label>
    </div>
    <div class="row gs-opts"><label><input type="checkbox" class="gs-custom" ${custom ? 'checked' : ''}> Custom: score by my own stat weights</label>
      ${canFit ? '<button class="link gs-fit" title="Pick the damage and defence that fit the build loaded from Path of Building">Match my Path of Building build</button>' : ''}</div>
    <div class="help gs-summary">${how}</div><div class="note gs-msg" role="status"></div>`;
  const msg = (t) => { el.querySelector('.gs-msg').textContent = t; };
  const save = async (value) => {
    const ok = await window.api.setSetting('build', value);
    if (ok === false) { msg("That profile isn't known."); return; }
    if (opts.after) await opts.after(); else await load();
  };
  const pair = () => `${el.querySelector('.gs-off').value}/${el.querySelector('.gs-def').value}`;
  el.querySelector('.gs-off').addEventListener('change', () => save(pair()));
  el.querySelector('.gs-def').addEventListener('change', () => save(pair()));
  el.querySelector('.gs-custom').addEventListener('change', (e) => save(e.target.checked ? 'off' : pair()));
  const fit = el.querySelector('.gs-fit');
  if (fit) fit.addEventListener('click', async () => {
    msg('Matching…');
    const r = await window.api.fitProfile();
    if (!r || !r.ok) { msg((r && r.error) || 'Could not match the build.'); return; }
    if (opts.after) await opts.after(); else await load();
  });
};

// build sites and "My gear" from the league starter note
document.querySelectorAll('#gsStarter [data-site]').forEach((b) => b.addEventListener('click', () => window.api.openUrl(b.dataset.site)));
document.querySelectorAll('#gsStarter [data-goto]').forEach((b) => b.addEventListener('click', () => document.querySelector(`.tabs button[data-tab="${b.dataset.goto}"]`).click()));
