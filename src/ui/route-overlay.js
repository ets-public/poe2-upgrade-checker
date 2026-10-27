'use strict';
/* global window, document */

// League start overlay: the current step of the campaign route over the game, and the next one.
// It moves on by itself when following your zones is on (League start tab); ◀ ▶ step by hand.
(function () {
  const { esc, tags } = window.routeUi;
  const box = document.getElementById('rov');
  function render(v) {
    if (!v) return;
    const s = v.steps[v.current];
    const next = v.steps.slice(v.current + 1).find((x) => v.optional || !x.o);
    const act = s ? v.acts[s.act] : null;
    const head = `<div class="rov-head"><span class="rov-act">${esc(act ? act.name : 'Campaign done')}${s ? ` · step ${s.i + 1} of ${act.count}` : ''}</span>
      <button id="rovBack" title="Back one step">◀</button><button id="rovNext" title="Step done">▶</button><button id="rovClose" title="Hide (${esc(v.hotkey || 'League start tab')})">×</button></div>`;
    const now = s
      ? `<div class="rov-now">${s.o ? '<span class="dim">Optional: </span>' : ''}${esc(s.t)}${tags(s)}${s.l ? ` <span class="dim">(level ${esc(s.l)})</span>` : ''}${s.h ? `<span class="rov-hint">${esc(s.h)}</span>` : ''}</div>`
      : `<div class="rov-now">Campaign done. ${esc((v.endgame && v.endgame[0] && v.endgame[0].items[0]) || '')}</div>`;
    const nx = next ? `<div class="rov-next">Next: ${esc(next.t)}</div>` : '';
    const total = v.totalsOf && v.totalsOf.passives;
    const foot = `<div class="rov-foot"><span>Passives ${v.totals.passives}${total ? ` of ${total}` : ''}</span>${v.level ? `<span>Level ${esc(v.level)}</span>` : ''}${v.areaLevel ? `<span>Area ${esc(v.areaLevel)}</span>` : ''}${!v.follow ? '<span class="rov-warn">Not following zones</span>' : ''}</div>`;
    box.innerHTML = head + now + nx + foot;
    document.getElementById('rovBack').addEventListener('click', () => window.api.routeStep(-1));
    document.getElementById('rovNext').addEventListener('click', () => window.api.routeStep(1));
    document.getElementById('rovClose').addEventListener('click', () => window.api.routeOverlayClose());
    window.api.routeOverlaySize(box.offsetHeight + 8); // (the box's 4px margin above and below)
  }
  window.api.onRouteUpdate(render);
  window.api.routeGet().then(render).catch(() => { box.innerHTML = '<div class="rov-now">Could not load the route.</div>'; });
}());
