'use strict';

// Settings window: your Path of Building build (import, file link, guide stages and skills) and
// resistances.

// ---------- Path of Building ----------
$('#pobImport').addEventListener('click', async () => {
  $('#pobMsg').textContent = 'Importing…';
  const r = await window.api.importPob($('#pobInput').value.trim());
  $('#pobMsg').textContent = r.ok ? r.message : r.error;
  if (r.ok) { $('#pobInput').value = ''; await load(); renderPob(false); }
});
$('#pobLinkFile').addEventListener('click', async () => {
  $('#pobMsg').textContent = 'Pick your build file…';
  const r = await window.api.linkPobFile();
  $('#pobMsg').textContent = r.canceled ? '' : r.ok ? r.message : r.error;
  if (r.ok) { await load(); renderPob(false); }
});
// the linked build (pobb.in or a PoB file): read it again, or stop following it
// what you've typed in the skills table but not applied yet: the page redraws whenever a setting
// changes (an account check, a linked build file read again), and that mustn't wipe it
function guideDraft() {
  const box = $('#guideSkills');
  if (!box || box.dataset.dirty !== '1') return null;
  const d = { rows: {}, level: $('#gskLevel').value, levelN: $('#gskLevelN').value, q: $('#gskQ').value };
  box.querySelectorAll('tr[data-gid]').forEach((tr) => {
    d.rows[tr.dataset.gid] = { lv: tr.querySelector('.gsk-lv').value, q: tr.querySelector('.gsk-q').value, main: tr.querySelector('input[name=gskMain]').checked, full: tr.querySelector('.gsk-full').checked };
  });
  return d;
}
function restoreGuideDraft(d) {
  const box = $('#guideSkills');
  if (!d || !box) return;
  const rows = [...box.querySelectorAll('tr[data-gid]')];
  if (rows.length !== Object.keys(d.rows).length || rows.some((tr) => !d.rows[tr.dataset.gid])) return; // another guide or stage: its own skills
  for (const tr of rows) {
    const r = d.rows[tr.dataset.gid];
    tr.querySelector('.gsk-lv').value = r.lv; tr.querySelector('.gsk-q').value = r.q;
    tr.querySelector('input[name=gskMain]').checked = r.main;
    const cb = tr.querySelector('.gsk-full'); cb.checked = r.full; cb.disabled = r.main;
  }
  $('#gskLevel').value = d.level; $('#gskLevelN').value = d.levelN; $('#gskQ').value = d.q;
  $('#gskLevelN').classList.toggle('hidden', d.level !== 'n');
  box.dataset.dirty = '1';
}
async function renderPobSource() {
  const el = $('#pobSource');
  const draft = guideDraft();
  const src = await window.api.pobSource();
  if (!src) { el.innerHTML = ''; return; }
  const when = src.at ? ` · read ${new Date(src.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : '';
  // a guide's Build Planner file: its stages (levelling guides have several) and "follow my level"
  let stageHtml = '';
  if (src.planner && src.stages && src.stages.length > 1) {
    const cur = src.stage;
    const opts = src.stages.map((x) => `<option value="${x.to}" ${cur !== 'level' && Number(cur) >= x.from && Number(cur) <= x.to ? 'selected' : ''}>${esc(x.label)}</option>`).join('');
    stageHtml = `<div class="row small">Stage <select id="pobStage">${opts}<option value="level" ${cur === 'level' ? 'selected' : ''}>Follow my level${src.levelNow ? ` (${src.levelNow})` : ' (set it on Find upgrades)'}</option></select></div>`;
  }
  el.innerHTML = (src.planner
    ? `Guide <b>${esc(src.title || src.name)}</b>${src.type === 'file' ? ` (<span title="${esc(src.name)}">${esc(src.name)}</span>): the file is followed, so a newer version of the guide updates this character` : ''}${when}.`
    : src.type === 'file'
      ? `Following <b>${esc(src.name)}</b>: saving it in Path of Building updates this character${when}.`
      : `From <b>${esc(src.name.replace(/^https?:\/\//, ''))}</b>${when}.`)
    + ` <button class="link" id="pobSyncNow">Update now</button> <button class="link" id="pobUnlink">Unlink</button>${stageHtml}${guideSkillsHtml(src)}`;
  bindGuideSkills(src);
  restoreGuideDraft(draft);
  const stg = $('#pobStage');
  if (stg) stg.addEventListener('change', async () => {
    $('#pobMsg').textContent = 'Building that stage…';
    const r = await window.api.setPobStage(stg.value === 'level' ? 'level' : Number(stg.value));
    $('#pobMsg').textContent = r.ok ? r.message : r.error;
    if (r.ok) { await load(); renderPob(false); } else renderPobSource();
  });
  $('#pobSyncNow').addEventListener('click', async () => {
    $('#pobMsg').textContent = 'Reading your build again…';
    const r = await window.api.syncPob();
    $('#pobMsg').textContent = r.ok ? r.message : r.error;
    if (r.ok && !r.same) { await load(); renderPob(false); } else renderPobSource();
  });
  $('#pobUnlink').addEventListener('click', async () => { await window.api.unlinkPob(); $('#pobMsg').textContent = 'Unlinked: your build stays as it is.'; renderPobSource(); });
}
// a guide's skills: .build files have no gem levels or quality, and don't say which skill is the
// damage one. You set them here; Path of Building can show each skill's damage to help pick.
let guideOpen = false;
function guideSkillsHtml(src) {
  const list = src.planner && src.skillList;
  if (!list || !list.length) return '';
  const cfg = src.skills || {};
  const lvMode = cfg.level === 'max' ? 'max' : Number(cfg.level) > 0 ? 'n' : 'stage';
  const rows = list.map((k) => `<tr data-gid="${esc(k.id)}"><td><b>${esc(k.name)}</b>${k.supports.length ? ` <span class="dim small" title="${esc(k.supports.join(', '))}">+${k.supports.length} support${k.supports.length === 1 ? '' : 's'}</span>` : ''}</td>
    <td><input type="number" class="num gsk-lv" min="1" max="40" placeholder="${k.level}" value="${k.own && cfg.gems && cfg.gems[k.id] && cfg.gems[k.id].level ? cfg.gems[k.id].level : ''}" aria-label="${esc(k.name)} level" title="Level ${k.level} now (max ${k.max}). Type one to set this gem apart."></td>
    <td><input type="number" class="num gsk-q" min="0" max="23" placeholder="${k.quality}" value="${k.own && cfg.gems && cfg.gems[k.id] && cfg.gems[k.id].quality != null ? cfg.gems[k.id].quality : ''}" aria-label="${esc(k.name)} quality"></td>
    <td class="c"><input type="radio" name="gskMain" value="${esc(k.id)}" ${k.main ? 'checked' : ''} aria-label="Judge items on ${esc(k.name)}"></td>
    <td class="c"><input type="checkbox" class="gsk-full" ${k.full ? 'checked' : ''} ${k.main ? 'disabled' : ''} aria-label="Count ${esc(k.name)} in total DPS"></td>
    <td class="gsk-dps dim small"></td></tr>`).join('');
  return `<details class="fold" id="guideSkills" ${guideOpen ? 'open' : ''}><summary>Skills <span class="fold-why dim small">${esc(list.find((k) => k.main) ? 'main: ' + list.find((k) => k.main).name : '')}</span></summary>
    <div class="row wrap small">Gem levels <select id="gskLevel"><option value="stage" ${lvMode === 'stage' ? 'selected' : ''}>For the stage</option><option value="max" ${lvMode === 'max' ? 'selected' : ''}>Top level</option><option value="n" ${lvMode === 'n' ? 'selected' : ''}>All at…</option></select>
      <input type="number" id="gskLevelN" class="num ${lvMode === 'n' ? '' : 'hidden'}" min="1" max="40" value="${lvMode === 'n' ? Number(cfg.level) : 20}" aria-label="Level for every gem">
      Quality <input type="number" id="gskQ" class="num" min="0" max="23" value="${Number(cfg.quality) || 0}" aria-label="Quality for every skill gem"></div>
    <table class="tbl small gsk"><tr><th>Skill</th><th>Level</th><th>Quality</th><th title="The skill items are judged on">Main</th><th title="Also counted in Path of Building's total DPS">In total</th><th>Damage</th></tr>${rows}</table>
    <div class="row"><button id="gskApply" class="primary">Apply</button><button id="gskCompare" title="Path of Building works out each skill's damage as the main skill">Compare skills</button><span class="note" id="gskMsg"></span></div>
    <div class="help">A guide's file has no gem levels or quality: "For the stage" uses about what you'd have at that point. Type a level or quality on a row to set that gem apart. Your choices are kept when the guide updates.</div>
  </details>`;
}
function bindGuideSkills(src) {
  const box = $('#guideSkills');
  if (!box) return;
  box.addEventListener('toggle', () => { guideOpen = box.open; });
  const dirty = () => { box.dataset.dirty = '1'; };
  box.addEventListener('input', dirty); box.addEventListener('change', dirty);
  $('#gskLevel').addEventListener('change', () => $('#gskLevelN').classList.toggle('hidden', $('#gskLevel').value !== 'n'));
  box.querySelectorAll('input[name=gskMain]').forEach((r) => r.addEventListener('change', () => {
    box.querySelectorAll('tr[data-gid]').forEach((tr) => { const cb = tr.querySelector('.gsk-full'); const main = tr.querySelector('input[name=gskMain]').checked; cb.disabled = main; if (main) cb.checked = true; });
  }));
  $('#gskApply').addEventListener('click', async () => {
    const gems = {}; const full = {}; let main = null;
    box.querySelectorAll('tr[data-gid]').forEach((tr) => {
      const id = tr.dataset.gid;
      const lv = tr.querySelector('.gsk-lv').value; const q = tr.querySelector('.gsk-q').value;
      if (lv !== '' || q !== '') gems[id] = { level: lv, quality: q };
      if (tr.querySelector('input[name=gskMain]').checked) main = id;
      else if (tr.querySelector('.gsk-full').checked) full[id] = true;
    });
    const mode = $('#gskLevel').value;
    $('#gskMsg').textContent = 'Building it with your skills…';
    const r = await window.api.setGuideSkills({ level: mode === 'n' ? $('#gskLevelN').value : mode, quality: $('#gskQ').value, gems, main, full });
    $('#pobMsg').textContent = r.ok ? r.message : r.error;
    if (r.ok) { box.dataset.dirty = '0'; await load(); renderPob(false); } else $('#gskMsg').textContent = r.error;
  });
  $('#gskCompare').addEventListener('click', async () => {
    $('#gskMsg').textContent = 'Path of Building is trying each skill as the main one…';
    const r = await window.api.guideSkillDps();
    if (!r.ok) { $('#gskMsg').textContent = r.error; return; }
    box.querySelectorAll('tr[data-gid]').forEach((tr) => {
      const d = r.dps[tr.dataset.gid]; const cell = tr.querySelector('.gsk-dps');
      cell.textContent = d ? `${kfmt(d.dps)}${d.minion ? ' (minions)' : ''}` : '–';
      cell.classList.toggle('pos', tr.dataset.gid === r.best);
    });
    const best = r.best && (src.skillList || []).find((k) => k.id === r.best);
    const cur = (src.skillList || []).find((k) => k.main);
    $('#gskMsg').textContent = !best ? 'None of these skills does damage in Path of Building.' : cur && best.id === cur.id ? `${best.name} does the most damage: it's already the main skill.` : `${best.name} does the most damage. Pick it as Main and press Apply to judge items on it.`;
  });
}
const kfmt = (v) => (v == null ? '–' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e4 ? Math.round(v / 1000) + 'k' : Math.round(v).toLocaleString('en'));
async function renderPob(load) {
  const el = $('#pobStatus');
  renderPriorities();
  renderPobSource();
  $('#pobUse').checked = state.settings.usePob !== false;
  // the slider goes from Damage (left) to Survivability (right): its value is the survivability share
  $('#pobBalance').value = Math.round((1 - (state.settings.pobDamageWeight == null ? 0.6 : state.settings.pobDamageWeight)) * 100);
  const st = await window.api.pobStatus(!!load);
  $('#pobControls').classList.toggle('hidden', !(st.available && st.hasBuild));
  const p1s = state && state.game === 'poe1';
  if (!st.available) { el.innerHTML = `<div class="note">The Path of Building engine${p1s ? ' for PoE1' : ''} isn't included in this copy of the app – ${p1s ? "PoE1 items can't be judged without it. Reinstall the app or run test-build.bat again." : 'items are judged by the gear score instead.'}</div>`; return; }
  if (!st.hasBuild) { el.innerHTML = '<div class="note">No build yet: paste your PoB export above so items are judged by Path of Building.</div>'; return; }
  if (!st.enabled) { el.innerHTML = `<div class="dim">Turned off – ${p1s ? "PoE1 items aren't judged while it's off." : 'items are judged by the gear score.'}</div>`; return; }
  if (st.error) { el.innerHTML = `<div class="note">Path of Building: ${esc(st.error)}</div>`; return; }
  const m = st.summary;
  if (!m) {
    // start it in the background the first time you look, so the status is right without a click
    if (!window.__pobAutoLoad) { window.__pobAutoLoad = true; el.innerHTML = '<div class="dim"><span class="spinner"></span> Starting Path of Building…</div>'; renderPob(true); return; }
    el.innerHTML = '<div class="dim">Build saved. Path of Building starts the first time an item is checked. <button class="link" id="pobLoad">Check it now</button></div>'; const b = $('#pobLoad'); if (b) b.addEventListener('click', () => { el.innerHTML = '<div class="dim"><span class="spinner"></span> Starting Path of Building…</div>'; renderPob(true); }); return;
  }
  const res = (m.res || []).filter((r) => r.value != null && !(m.ci && r.el === 'Chaos')).map((r) => `${esc(r.el)} ${Math.round(r.value)}%${r.total > r.value ? ` <span class="dim">(${Math.round(r.total)})</span>` : ''}`).join(' · ');
  $('#prChaos').disabled = !!m.ci || !$('#prRes').checked;
  if (m.ci) { $('#prChaos').checked = false; $('#prChaos').parentNode.title = 'Chaos Inoculation: you are immune to chaos damage, so chaos resistance is ignored'; }
  el.innerHTML = `<div class="pob"><span class="pob-tag">PoB</span> <b>${esc(m.ascendancy || m.className || '')}</b> level ${esc(m.level)}${m.mainSkill ? ` · ${esc(m.mainSkill)}` : ''}${m.ci ? ' · <span title="Life is 1 in your build: chaos resistance is ignored everywhere">Chaos Inoculation</span>' : ''}</div>
    <div class="dim">${m.dpsKey === 'MinionDPS' ? 'Minion DPS' : 'DPS'} <b>${kfmt(m.dps)}</b> · Effective HP <b>${kfmt(m.ehp)}</b> · ES <b>${kfmt(m.es)}</b>${m.spirit == null ? '' : ` · Spirit free <b>${m.spiritFree == null ? '–' : Math.round(m.spiritFree)}</b> of ${Math.round(m.spirit)}`}</div>
    <div class="dim">Resistances: ${res}</div>
    ${m.overridden && m.overridden.length ? `<div class="dim">Using your in-game copies for: ${esc(m.overridden.join(', '))}</div>` : ''}
    ${m.mismatch.map((x) => `<div class="note">${window.ICON.warn} ${esc(x)}</div>`).join('')}`;
}
// what "Better for my build" does depends on the build: PoB judges, or the gear score, or off
function renderModeHints() {
  const off = state.settings.build === 'off';
  const fg = $('#findGear');
  if (fg) {
    fg.classList.toggle('hidden', off && !state.pobOn);
    fg.title = state.pobOn ? 'Path of Building builds the search from your build, then checks every listing with it' : 'Listings that score higher for your build (gear score)';
  }
  document.querySelectorAll('.gs-fallback-note').forEach((e) => e.classList.toggle('hidden', !state.pobOn));
  // Path of Building knows your resistances: the boxes to type them in only matter without it
  $('#resCard').classList.toggle('hidden', !!state.pobOn);
  // with a build loaded, verdicts come from Path of Building: the gear score tools fold away (still there)
  if (foldedFor !== !!state.pobOn) {
    foldedFor = !!state.pobOn;
    for (const id of ['gsEditorFold', 'weightsFold']) { const d = document.getElementById(id); if (d) d.open = !state.pobOn; }
  }
  document.querySelectorAll('.fold-why').forEach((e) => e.classList.toggle('hidden', !state.pobOn));
  // stat weights are only used when you score by your own weights
  const wc = $('#weightsCard'); if (wc) wc.classList.toggle('hidden', state.settings.build !== 'off');
  $('#gsExplain').innerHTML = window.gearExplainHtml({ where: 'gear score editor on this page', pobOn: state.pobOn, game: state.game });
}
function renderPriorities() {
  const p = state.priorities || {};
  $('#prRes').checked = !!p.resFirst; $('#prChaos').checked = !!p.chaos; $('#prChaos').disabled = !p.resFirst;
  $('#prSpirit').checked = !!p.spirit; $('#prAttrs').checked = !!p.attrs; $('#prDmg').checked = !!p.keepDmg; $('#prSpeed').checked = p.speed !== false;
  $('#prNote').textContent = p.resFirst
    ? 'Resistances first: each resistance point an item adds toward your cap counts +0.5 points on its score (losing them costs the same), and Find upgrades searches for the resistances you still need.'
    : 'Resistances count through effective HP like everything else. An item that drops a resistance off the cap is still marked LOSES RESISTANCE.';
}
['#prRes', '#prChaos', '#prDmg', '#prSpirit', '#prAttrs', '#prSpeed'].forEach((id) => $(id).addEventListener('change', async () => {
  state.priorities = await window.api.setPriorities({ resFirst: $('#prRes').checked, chaos: $('#prChaos').checked, keepDmg: $('#prDmg').checked, spirit: $('#prSpirit').checked, attrs: $('#prAttrs').checked, speed: $('#prSpeed').checked });
  renderPriorities();
}));
$('#pobUse').addEventListener('change', async () => { await window.api.pobEnable($('#pobUse').checked); state = await window.api.getState(); renderPob(false); });
$('#pobBalance').addEventListener('change', async () => { await window.api.setSetting('pobDamageWeight', 1 - Number($('#pobBalance').value) / 100); state = await window.api.getState(); });


// ---------- resistances ----------
function renderResists() {
  const r = state.liveResists || state.settings.resists || {};
  const set = (id, v) => { if (document.activeElement !== $(id)) $(id).value = v == null ? '' : v; };
  set('#resFire', r.fire); set('#resCold', r.cold); set('#resLightning', r.lightning); set('#resChaos', r.chaos); set('#resCap', r.cap); set('#resBuffer', r.buffer);
  const rec = state.settings.resists;
  const when = rec && rec.at ? new Date(rec.at).toLocaleDateString() : '';
  $('#resSource').textContent = !rec ? '' : rec.source === 'pob'
    ? `From Path of Building${when ? ` (${when})` : ''}, adjusted for gear you've changed since. PoB can count ${state && state.game === 'poe1' ? 'flasks' : 'flasks, charms'} and buffs that aren't always on – check them against your character sheet and type the real numbers here.`
    : `From your character sheet${when ? ` (${when})` : ''}, adjusted for gear you've changed since.`;
}
['#resFire', '#resCold', '#resLightning', '#resChaos', '#resCap', '#resBuffer'].forEach((id) => $(id).addEventListener('change', async () => {
  const v = (x) => $(x).value.trim();
  const saved = await window.api.setResists({ fire: v('#resFire'), cold: v('#resCold'), lightning: v('#resLightning'), chaos: v('#resChaos'), cap: v('#resCap'), buffer: v('#resBuffer') });
  $('#resMsg').textContent = saved ? 'Saved.' : 'Cleared – resistance caps are ignored.';
  state = await window.api.getState(); renderSlots();
}));
