'use strict';
/* global window, document */

// League start overlay: the current step of the campaign route over the game, and the next one.
// It moves on by itself when following your zones is on (League start tab); ◀ ▶ step by hand.
(function () {
  const { esc, tags, pos, who, xpText, fmtTime, actClock } = window.routeUi;
  let last = null;
  const box = document.getElementById('rov');
  function render(v) {
    if (!v) return;
    const s = v.steps[v.current];
    const next = v.steps.slice(v.current + 1).find((x) => !x.hide);
    const act = s ? v.acts[s.act] : null;
    const head = `<div class="rov-head"><span class="rov-act">${esc(act ? act.name : 'Campaign done')}${s ? ` · step ${pos(v, v.current).n} of ${pos(v, v.current).of}` : ''}</span>
      <button id="rovBack" title="Back one step">◀</button><button id="rovNext" title="Step done">▶</button><button id="rovClose" title="Hide (${esc(v.hotkey || 'League start tab')})">×</button></div>`;
    const now = s
      ? `<div class="rov-now">${s.o ? '<span class="dim">Optional: </span>' : ''}${esc(s.t)}${tags(s)}${s.l ? ` <span class="dim">(level ${esc(s.l)})</span>` : ''}${s.h ? `<span class="rov-hint">${esc(s.h)}</span>` : ''}</div>`
      + (s.gems ? `<div class="rov-gems">${esc(s.gems)}</div>` : '')
      : `<div class="rov-now">Campaign done. ${esc((v.endgame && v.endgame[0] && v.endgame[0].items[0]) || '')}</div>`;
    const nx = next ? `<div class="rov-next">Next: ${esc(next.t)}</div>` : '';
    const total = v.totalsOf && v.totalsOf.passives;
    const x = xpText(v);
    const c = actClock(v, Date.now());
    const best = c.any && v.timer && (v.timer.best || [])[c.act];
    const foot = `<div class="rov-foot"><span>Passives ${v.totals.passives}${total ? ` of ${total}` : ''}</span>${v.level ? `<span>${esc(v.character || 'Level')} ${esc(v.level)}</span>` : ''}${v.areaLevel ? `<span>Area ${esc(v.areaLevel)}</span>` : ''}${x ? `<span class="${x.cls === 'ok' ? 'rov-ok' : 'rov-warn'}" title="${esc(x.long)}">${esc(x.short)}</span>` : ''}${c.any ? `<span title="Time in this act${best != null ? `; your best is ${fmtTime(best)}` : ''}"><span id="rovClock">${fmtTime(c.ms)}</span>${best != null ? ` / ${fmtTime(best)}` : ''}</span>` : ''}${v.rush ? '<span>Endgame rush</span>' : ''}${!v.follow ? '<span class="rov-warn">Not following zones</span>' : who(v).state === 'other' ? '<span class="rov-warn">Paused: another character</span>' : who(v).state === 'unknown' ? '<span class="rov-warn">Who is playing?</span>' : ''}</div>`;
    last = v;
    box.innerHTML = head + now + nx + foot;
    document.getElementById('rovBack').addEventListener('click', () => window.api.routeStep(-1, 'overlay'));
    document.getElementById('rovNext').addEventListener('click', () => window.api.routeStep(1, 'overlay'));
    document.getElementById('rovClose').addEventListener('click', () => window.api.routeOverlayClose());
    window.api.routeOverlaySize(box.offsetHeight + 8); // (the box's 4px margin above and below)
  }
  window.api.onRouteUpdate(render);
  setInterval(() => { const el = document.getElementById('rovClock'); if (!el || !last) return; const c = actClock(last, Date.now()); if (c.running) el.textContent = fmtTime(c.ms); }, 1000);
  window.api.routeGet().then(render).catch(() => { box.innerHTML = '<div class="rov-now">Could not load the route.</div>'; });
}());
