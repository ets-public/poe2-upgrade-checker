'use strict';
/* global window, document */

// Settings window: the League start tab. The campaign route for the game you're on, the step
// you're on, what you've collected (passive points, ascendancy, resistances, Spirit), following your
// zones from the game's log (off until you switch it on), the overlay, and the first endgame steps.
(function () {
  const { esc, tags, rewardLine, pos, who, xpText, fmtTime, actClock } = window.routeUi;
  const body = () => document.getElementById('routeBody');
  let v = null;
  let shownAct = null; // the act whose steps are listed (follows the current step unless you pick one)
  let resetArmed = false;
  let timesOpen = false; // the act times table, opened
  let pending = false; // an update came while you were typing: shown when you're done

  function render() {
    if (!v) return;
    const cur = v.steps[v.current];
    if (shownAct == null) shownAct = cur ? cur.act : 'end';
    const next = v.steps.slice(v.current + 1).find((x) => !x.hide);
    const gameName = v.game === 'poe1' ? 'Path of Exile' : 'Path of Exile 2';
    const total = v.totalsOf && v.totalsOf.passives;
    const sum = [
      `<span>Passive points <b>${v.totals.passives}</b>${total ? ` of ${total}` : ''}</span>`,
      v.game === 'poe1' ? `<span>Trials <b>${v.totals.trials}</b> of 12 · Labyrinths <b>${v.totals.labs}</b> of 3</span>` : `<span>Ascendancy trials <b>${v.totals.trials}</b> of 2</span>`,
      v.game === 'poe2' && v.totals.spirit ? `<span>Spirit <b>+${v.totals.spirit}</b></span>` : '',
      v.level ? `<span>${esc(v.character || 'Level')} <b>${esc(v.level)}</b></span>` : '',
      v.areaLevel ? `<span>Area level <b>${esc(v.areaLevel)}</b></span>` : '',
      xpHtml(),
    ].filter(Boolean).join('');
    const nowCard = `<div class="card-p route-top"><div>
        <div class="dim small">${esc(gameName)} · ${cur ? `${esc(v.acts[cur.act].name)}, step ${pos(v, v.current).n} of ${pos(v, v.current).of}` : 'campaign done'}</div>
        <div class="route-now">${cur ? `${cur.o ? '<span class="dim">Optional: </span>' : ''}${esc(cur.t)}${tags(cur)}${cur.l ? ` <span class="dim small">(level ${esc(cur.l)})</span>` : ''}` : 'Campaign done: the endgame steps are below.'}</div>
        ${cur && cur.h ? `<div class="dim small">${esc(cur.h)}</div>` : ''}${cur && rewardLine(cur) ? `<div class="small">${esc(rewardLine(cur))}</div>` : ''}${cur && cur.gems ? `<div class="small route-gems">${esc(cur.gems)}</div>` : ''}
        ${next ? `<div class="dim small route-next">Next: ${esc(next.t)}</div>` : ''}
        <label class="small route-rush"><input type="checkbox" id="routeRush" ${v.rush ? 'checked' : ''}> <b>Endgame rush</b>: only the fastest way to the endgame. Skips every optional quest and side objective${v.game === 'poe2' ? ', but keeps the optional bosses and quests that give passive points, ascendancy, Spirit, life or resistances (as the speed route does)' : ''}.</label>
        <div class="route-sum">${sum}</div>
        ${timerHtml()}
      </div><div class="row">
        <button id="routeBack" title="Back one step">◀ Back</button><button class="primary" id="routeNext" title="This step is done">Step done ▶</button>
      </div></div>`;
    const follow = `<div class="card-p route-log">
        <label><input type="checkbox" id="routeFollow" ${v.follow ? 'checked' : ''}> <b>Follow my zones</b>: move on by itself as I enter each area</label>
        <div class="help">This reads the game's own log file (<b>Client.txt</b>), only the lines saying which area you entered, your level and your quest rewards. Nothing is sent anywhere and nothing is sent to the game. Grinding Gear Games allows tools to read this file as long as you know about it. Off, you move on with <b>Step done</b> or by clicking a step.</div>
        <div class="small">${v.found ? `Log: <span class="path">${esc(v.found)}</span>` : '<span class="warn">Client.txt not found where the game usually puts it.</span>'} <button class="link" id="routeBrowse">${v.found ? 'Use another file' : 'Find Client.txt'}</button>${v.status ? ` <span class="dim">· ${esc(v.status)}</span>` : ''}</div>
        ${whoHtml()}
        ${linkHtml()}
        <div class="small route-opts">Overlay over the game: <button class="link" id="routeOverlay2">${v.overlay ? 'Hide it' : 'Show it'}</button> · hotkey <input id="routeHotkey" size="14" value="${esc(v.hotkey)}" title="Shows or hides the overlay, e.g. Ctrl+Shift+L (empty: no hotkey)">${v.hotkeyOk ? '' : ' <span class="warn">that hotkey is taken by another app</span>'}
        · <label title="${v.rush ? 'The endgame rush hides them' : ''}"><input type="checkbox" id="routeOptional" ${v.optional && !v.rush ? 'checked' : ''} ${v.rush ? 'disabled' : ''}> show optional steps</label>
        · <button class="link" id="routeReset">${resetArmed ? 'Sure? Start over' : 'Start over (new character)'}</button></div>
      </div>`;
    const acts = `<div class="route-acts">${v.acts.map((a, i) => `<button data-act="${i}" class="${i === shownAct ? 'on' : ''}">${esc(a.name)}${a.levels ? ` <span class="dim small">${esc(a.levels)}</span>` : ''}</button>`).join('')}<button data-act="end" class="${shownAct === 'end' ? 'on' : ''}">Endgame</button></div>`;
    let list = '';
    if (shownAct === 'end') {
      list = `<div class="card-p route-end">${(v.endgame || []).map((c) => `<h4>${esc(c.title)}</h4><ul>${c.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`).join('')}</div>`;
    } else {
      const rows = v.steps.map((s, idx) => ({ s, idx })).filter((x) => x.s.act === shownAct && (!x.s.hide || x.idx === v.current));
      list = `<div class="card-p"><ul class="route-steps">${rows.map(({ s, idx }) => `<li data-i="${idx}" class="${idx < v.current ? 'done' : idx === v.current ? 'cur' : ''}${s.o ? ' opt' : ''}" title="Make this the current step">
          <span class="rn">${pos(v, idx).n}</span><span><span class="rt">${esc(s.t)}</span>${tags(s)}${s.h ? `<span class="rh">${esc(s.h)}</span>` : ''}${rewardLine(s) ? `<span class="rh">${esc(rewardLine(s))}</span>` : ''}${s.gems ? `<span class="rh route-gems">${esc(s.gems)}</span>` : ''}</span><span class="rl">${s.l ? `lvl ${esc(s.l)}` : ''}</span></li>`).join('')}</ul></div>`;
    }
    const credit = `<div class="route-credit">Route for ${esc(gameName)} ${esc(v.for)}, checked ${esc(v.checked)}. ${esc(v.note || '')} Route data: ${(v.sources || []).map((x) => `${esc(x.name)} by ${esc(x.by)} (${esc(x.licence)})`).join(', ')}; endgame notes${v.game === 'poe1' ? ' and the optional side quests (facts from poedb.tw)' : ''} are our own.${v.game === 'poe1' ? (v.gemsFor ? ` Quest gems for your build (${esc(v.gemsFor)}) from exile-leveling's gem data (MIT).` : ' Import your Path of Building build on My gear to see which quest gems to take and buy for it.') : ''}</div>`;
    body().innerHTML = nowCard + follow + acts + list + credit;
    const ob = document.getElementById('routeOverlayBtn'); if (ob) ob.textContent = v.overlay ? 'Hide overlay' : 'Show overlay';
    bind();
  }

  // the experience penalty where you are
  function xpHtml() {
    const x = xpText(v);
    return x ? `<span class="route-xp ${x.cls}" title="${esc(x.long)}">${x.cls === 'ok' ? esc(x.short) : `<b>${esc(x.short)}</b>`}</span>` : '';
  }
  // the act timer: this act now, its best, and every act in a table
  function timerHtml() {
    const t = v.timer || {};
    const c = actClock(v, Date.now());
    const earlier = (t.best || []).some((x) => x != null) || (t.last || []).some((x) => x != null);
    if (!c.any && !earlier) return `<div class="small dim route-timer">Act timer: starts when you enter a zone of the route${v.follow ? '' : ' (with Follow my zones on)'}.</div>`;
    const actName = (i) => (v.acts[i] ? v.acts[i].name : 'Endgame');
    const best = (t.best || [])[c.act];
    const rows = v.acts.map((a, i) => {
      const run = (t.acts || [])[i];
      const ms = i === c.act ? c.ms : run ? run.ms : null;
      if (ms == null && (t.best || [])[i] == null && (t.last || [])[i] == null) return '';
      return `<tr><td>${esc(a.name)}</td><td${i === c.act ? ' class="route-clock-cell"' : ''}>${ms == null ? '–' : fmtTime(ms)}${run && run.done ? '' : i === c.act ? '' : ms ? ' <span class="dim">(not done)</span>' : ''}</td><td>${fmtTime((t.best || [])[i])}</td><td>${fmtTime((t.last || [])[i])}</td></tr>`;
    }).join('');
    return `<div class="small route-timer"><span>${c.any ? '' : '<span class="dim">Act timer: starts when you enter a zone of the route. </span>'}${esc(actName(c.act))}: <b id="routeClock">${fmtTime(c.ms)}</b>${c.running ? ' <span class="route-live" title="Counting: you\'re playing the route character">●</span>' : ' <span class="dim">(stopped)</span>'}${best != null ? ` · best ${fmtTime(best)}` : ''}</span>
      <details id="routeTimes" ${timesOpen ? 'open' : ''}><summary>Act times</summary>
      <table class="route-times"><thead><tr><th>Act</th><th>This run</th><th>Best${v.rush ? ' (rush)' : ''}</th><th>Last run</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="dim">Nothing yet.</td></tr>'}</tbody></table>
      <div class="dim">Counts only while the route's character plays (stops after 10 minutes without a new zone). An act is done when you enter the next one. Best is over your earlier runs${v.rush ? ' with the endgame rush' : ' without the endgame rush'}; Start over begins a new run.</div></details></div>`;
  }
  // your characters in this app, linked to their names in the game: the app switches by itself
  function linkHtml() {
    const mine = v.appChars || [];
    const seen = (v.seen || []).map((x) => x.name);
    const opts = `<datalist id="routeSeenNames">${seen.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>`;
    const rows = mine.map((c) => `<div class="route-link-row"><span class="route-link-name" title="${esc(c.name)}">${esc(c.name)}${c.active ? ' <span class="dim">(open now)</span>' : ''}</span> is <input type="text" list="routeSeenNames" data-link="${esc(c.id)}" value="${esc(c.gameChar || '')}" placeholder="name in game" maxlength="40" spellcheck="false"> in game</div>`).join('');
    return `<div class="route-link">
      <label class="small"><input type="checkbox" id="routeAuto" ${v.autoSwitch ? 'checked' : ''}> <b>Switch this app's character by itself</b> to the one playing</label>
      <div class="help">Link each character here to its name in the game. The app switches when the log names it (a level up or a quest reward), when the route's character enters a zone of the route, or (with just one other linked) when someone else turns up in a map. This reads the same log file, even with Follow my zones off.</div>
      ${v.autoSwitch || mine.some((c) => c.gameChar) ? `${opts}${rows}${mine.length < 2 ? '<div class="small dim">You have one character for this game: make one for each of yours with <b>+ New character</b> on My gear.</div>' : ''}${!seen.length ? '<div class="small dim">No names from the log yet: type them, or level up or finish a quest with each.</div>' : ''}` : ''}
    </div>`;
  }

  // the character the route follows, and whether it's the one playing now
  function whoHtml() {
    const w = who(v);
    const names = [...new Set([...(v.character ? [v.character] : []), ...(v.seen || []).map((x) => x.name)])];
    const label = (n) => { const x = (v.seen || []).find((y) => y.name === n); return `${n}${x && (x.className || x.level) ? ` (${[x.className, x.level ? `level ${x.level}` : ''].filter(Boolean).join(', ')})` : ''}`; };
    const pick = names.length
      ? `<select id="routeChar" title="The character this route is for: the app only moves it on for that character">${v.character ? '' : '<option value="" selected>the first to level up in the campaign</option>'}${names.map((n) => `<option value="${esc(n)}" ${n === v.character ? 'selected' : ''}>${esc(label(n))}</option>`).join('')}</select>`
      : '<span class="dim">the first character to level up in the campaign</span>';
    const state = v.follow ? `<div class="route-who ${w.state}">${esc(w.text)}${w.state !== 'owner' && v.character ? ` <button class="link" id="routePlaying">I'm on ${esc(v.character)} now</button>` : ''}</div>` : '';
    return `<div class="small route-char">Route character: ${pick}</div>${state}`;
  }
  async function set(patch) { v = await window.api.routeSet(patch); render(); }
  function bind() {
    document.getElementById('routeBack').addEventListener('click', async () => { v = await window.api.routeStep(-1, 'tab'); render(); });
    document.getElementById('routeNext').addEventListener('click', async () => { v = await window.api.routeStep(1, 'tab'); render(); });
    document.getElementById('routeFollow').addEventListener('change', (e) => set({ follow: e.target.checked }));
    document.getElementById('routeOptional').addEventListener('change', (e) => set({ optional: e.target.checked }));
    document.getElementById('routeRush').addEventListener('change', (e) => set({ rush: e.target.checked }));
    const rc = document.getElementById('routeChar'); if (rc) rc.addEventListener('change', (e) => { if (e.target.value) set({ character: e.target.value }); });
    const rp = document.getElementById('routePlaying'); if (rp) rp.addEventListener('click', () => set({ playing: true }));
    document.getElementById('routeOverlay2').addEventListener('click', () => set({ overlay: !v.overlay }));
    document.getElementById('routeBrowse').addEventListener('click', async () => { v = await window.api.routeBrowse(); render(); });
    document.getElementById('routeHotkey').addEventListener('change', (e) => set({ hotkey: e.target.value.trim() }));
    const ra = document.getElementById('routeAuto'); if (ra) ra.addEventListener('change', async (e) => { await window.api.setSetting('autoSwitchChar', e.target.checked); await refresh(); });
    body().querySelectorAll('[data-link]').forEach((inp) => inp.addEventListener('change', async () => { await window.api.linkProfile(inp.dataset.link, inp.value.trim()); await refresh(); }));
    const rt = document.getElementById('routeTimes'); if (rt) rt.addEventListener('toggle', () => { timesOpen = rt.open; });
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
    // not while you're typing in a box of this tab (the hotkey, a character's name): when you're done
    const a = document.activeElement;
    if (a && body().contains(a) && a.tagName === 'INPUT' && a.type === 'text') { pending = true; return; }
    render();
  }
  body().addEventListener('focusout', () => { if (pending) { pending = false; setTimeout(() => { const a = document.activeElement; if (!(a && body().contains(a) && a.tagName === 'INPUT' && a.type === 'text')) render(); else pending = true; }, 0); } });
  // the clock counts on every second while you play
  setInterval(() => {
    const el = document.getElementById('routeClock');
    if (!el || !v) return;
    const c = actClock(v, Date.now());
    if (c.running) { el.textContent = fmtTime(c.ms); const cell = body().querySelector('.route-clock-cell'); if (cell) cell.textContent = fmtTime(c.ms); }
  }, 1000);
  async function refresh() { try { update(await window.api.routeGet()); } catch (err) { body().innerHTML = `<div class="card-p note">Could not load the route: ${esc(err.message)}</div>`; } }
  const ob = document.getElementById('routeOverlayBtn');
  if (ob) ob.addEventListener('click', () => set({ overlay: !(v && v.overlay) }));
  window.api.onRouteUpdate(update);
  if (window.api.onGameChanged) window.api.onGameChanged(() => { shownAct = null; refresh(); });
  refresh();
}());
