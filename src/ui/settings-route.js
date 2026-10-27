'use strict';
/* global window, document */

// Settings window: the League start tab. The campaign route for the game you're on, the step
// you're on, what you've collected (passive points, ascendancy, resistances, Spirit), following your
// zones from the game's log (off until you switch it on), the overlay, and the first endgame steps.
(function () {
  const { esc, tags, rewardLine } = window.routeUi;
  const body = () => document.getElementById('routeBody');
  let v = null;
  let shownAct = null; // the act whose steps are listed (follows the current step unless you pick one)
  let resetArmed = false;

  function render() {
    if (!v) return;
    const cur = v.steps[v.current];
    if (shownAct == null) shownAct = cur ? cur.act : 'end';
    const next = v.steps.slice(v.current + 1).find((x) => v.optional || !x.o);
    const gameName = v.game === 'poe1' ? 'Path of Exile' : 'Path of Exile 2';
    const total = v.totalsOf && v.totalsOf.passives;
    const sum = [
      `<span>Passive points <b>${v.totals.passives}</b>${total ? ` of ${total}` : ''}</span>`,
      v.game === 'poe1' ? `<span>Trials <b>${v.totals.trials}</b> of 12 · Labyrinths <b>${v.totals.labs}</b> of 3</span>` : `<span>Ascendancy trials <b>${v.totals.trials}</b> of 2</span>`,
      v.game === 'poe2' && v.totals.spirit ? `<span>Spirit <b>+${v.totals.spirit}</b></span>` : '',
      v.level ? `<span>${esc(v.character || 'Level')} <b>${esc(v.level)}</b></span>` : '',
      v.areaLevel ? `<span>Area level <b>${esc(v.areaLevel)}</b></span>` : '',
    ].filter(Boolean).join('');
    const nowCard = `<div class="card-p route-top"><div>
        <div class="dim small">${esc(gameName)} · ${cur ? `${esc(v.acts[cur.act].name)}, step ${cur.i + 1} of ${v.acts[cur.act].count}` : 'campaign done'}</div>
        <div class="route-now">${cur ? `${cur.o ? '<span class="dim">Optional: </span>' : ''}${esc(cur.t)}${tags(cur)}${cur.l ? ` <span class="dim small">(level ${esc(cur.l)})</span>` : ''}` : 'Campaign done: the endgame steps are below.'}</div>
        ${cur && cur.h ? `<div class="dim small">${esc(cur.h)}</div>` : ''}${cur && rewardLine(cur) ? `<div class="small">${esc(rewardLine(cur))}</div>` : ''}
        ${next ? `<div class="dim small route-next">Next: ${esc(next.t)}</div>` : ''}
        <div class="route-sum">${sum}</div>
      </div><div class="row">
        <button id="routeBack" title="Back one step">◀ Back</button><button class="primary" id="routeNext" title="This step is done">Step done ▶</button>
      </div></div>`;
    const follow = `<div class="card-p route-log">
        <label><input type="checkbox" id="routeFollow" ${v.follow ? 'checked' : ''}> <b>Follow my zones</b>: move on by itself as I enter each area</label>
        <div class="help">This reads the game's own log file (<b>Client.txt</b>), only the lines saying which area you entered and your level. Nothing is sent anywhere and nothing is sent to the game. Grinding Gear Games allows tools to read this file as long as you know about it. Off, you move on with <b>Step done</b> or by clicking a step.</div>
        <div class="small">${v.found ? `Log: <span class="path">${esc(v.found)}</span>` : '<span class="warn">Client.txt not found where the game usually puts it.</span>'} <button class="link" id="routeBrowse">${v.found ? 'Use another file' : 'Find Client.txt'}</button>${v.status ? ` <span class="dim">· ${esc(v.status)}</span>` : ''}</div>
        <div class="small route-opts">Overlay over the game: <button class="link" id="routeOverlay2">${v.overlay ? 'Hide it' : 'Show it'}</button> · hotkey <input id="routeHotkey" size="14" value="${esc(v.hotkey)}" title="Shows or hides the overlay, e.g. Ctrl+Shift+L (empty: no hotkey)">${v.hotkeyOk ? '' : ' <span class="warn">that hotkey is taken by another app</span>'}
        · <label><input type="checkbox" id="routeOptional" ${v.optional ? 'checked' : ''}> show optional steps</label>
        · <button class="link" id="routeReset">${resetArmed ? 'Sure? Start over' : 'Start over (new character)'}</button></div>
      </div>`;
    const acts = `<div class="route-acts">${v.acts.map((a, i) => `<button data-act="${i}" class="${i === shownAct ? 'on' : ''}">${esc(a.name)}${a.levels ? ` <span class="dim small">${esc(a.levels)}</span>` : ''}</button>`).join('')}<button data-act="end" class="${shownAct === 'end' ? 'on' : ''}">Endgame</button></div>`;
    let list = '';
    if (shownAct === 'end') {
      list = `<div class="card-p route-end">${(v.endgame || []).map((c) => `<h4>${esc(c.title)}</h4><ul>${c.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`).join('')}</div>`;
    } else {
      const rows = v.steps.map((s, idx) => ({ s, idx })).filter((x) => x.s.act === shownAct && (v.optional || !x.s.o));
      list = `<div class="card-p"><ul class="route-steps">${rows.map(({ s, idx }) => `<li data-i="${idx}" class="${idx < v.current ? 'done' : idx === v.current ? 'cur' : ''}${s.o ? ' opt' : ''}" title="Make this the current step">
          <span class="rn">${s.i + 1}</span><span><span class="rt">${esc(s.t)}</span>${tags(s)}${s.h ? `<span class="rh">${esc(s.h)}</span>` : ''}${rewardLine(s) ? `<span class="rh">${esc(rewardLine(s))}</span>` : ''}</span><span class="rl">${s.l ? `lvl ${esc(s.l)}` : ''}</span></li>`).join('')}</ul></div>`;
    }
    const credit = `<div class="route-credit">Route for ${esc(gameName)} ${esc(v.for)}, checked ${esc(v.checked)}. ${esc(v.note || '')} Route data: ${(v.sources || []).map((x) => `${esc(x.name)} by ${esc(x.by)} (${esc(x.licence)})`).join(', ')}; endgame notes are our own.</div>`;
    body().innerHTML = nowCard + follow + acts + list + credit;
    const ob = document.getElementById('routeOverlayBtn'); if (ob) ob.textContent = v.overlay ? 'Hide overlay' : 'Show overlay';
    bind();
  }

  async function set(patch) { v = await window.api.routeSet(patch); render(); }
  function bind() {
    document.getElementById('routeBack').addEventListener('click', async () => { v = await window.api.routeStep(-1); render(); });
    document.getElementById('routeNext').addEventListener('click', async () => { v = await window.api.routeStep(1); render(); });
    document.getElementById('routeFollow').addEventListener('change', (e) => set({ follow: e.target.checked }));
    document.getElementById('routeOptional').addEventListener('change', (e) => set({ optional: e.target.checked }));
    document.getElementById('routeOverlay2').addEventListener('click', () => set({ overlay: !v.overlay }));
    document.getElementById('routeBrowse').addEventListener('click', async () => { v = await window.api.routeBrowse(); render(); });
    document.getElementById('routeHotkey').addEventListener('change', (e) => set({ hotkey: e.target.value.trim() }));
    document.getElementById('routeReset').addEventListener('click', async () => {
      if (!resetArmed) { resetArmed = true; render(); setTimeout(() => { if (resetArmed) { resetArmed = false; render(); } }, 4000); return; }
      resetArmed = false; shownAct = null; v = await window.api.routeReset(); render();
    });
    body().querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => { shownAct = b.dataset.act === 'end' ? 'end' : Number(b.dataset.act); render(); }));
    body().querySelectorAll('.route-steps li').forEach((li) => li.addEventListener('click', async () => { v = await window.api.routeJump(Number(li.dataset.i)); render(); }));
  }

  // the list follows the current step's act as you play (unless you're looking at another act)
  let lastAct = null;
  function update(nv) {
    const was = v && v.steps[v.current];
    v = nv;
    const cur = v.steps[v.current];
    if (cur && (shownAct === null || (was && shownAct === was.act && cur.act !== was.act) || lastAct === null)) shownAct = cur.act;
    lastAct = cur ? cur.act : null;
    render();
  }
  async function refresh() { try { update(await window.api.routeGet()); } catch (err) { body().innerHTML = `<div class="card-p note">Could not load the route: ${esc(err.message)}</div>`; } }
  const ob = document.getElementById('routeOverlayBtn');
  if (ob) ob.addEventListener('click', () => set({ overlay: !(v && v.overlay) }));
  window.api.onRouteUpdate(update);
  if (window.api.onGameChanged) window.api.onGameChanged(() => { shownAct = null; refresh(); });
  refresh();
}());
