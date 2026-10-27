'use strict';
/* global window */

// League start: what the overlay and the League start tab both show about a step.
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // the rewards of a step as small tags: "+1 passive", "Ascendancy", "−30% res", "+30 Spirit"
  function tags(s) {
    const out = [];
    if (s.p) out.push(`<span class="rtag" title="Passive skill points">+${s.p} passive</span>`);
    const k = s.k || [];
    if (k.includes('trial')) out.push(`<span class="rtag trial" title="${esc(s.r || 'Labyrinth trial: needed for the Labyrinth')}">${s.r && /Ascendancy/.test(s.r) ? 'Ascendancy' : 'Trial'}</span>`);
    if (k.includes('lab')) out.push(`<span class="rtag lab" title="${esc(s.r || '')}">Ascendancy</span>`);
    if (k.includes('spirit')) { const m = String(s.r || '').match(/\+(\d+) Spirit/); out.push(`<span class="rtag spirit" title="${esc(s.r || '')}">${m ? `+${m[1]} Spirit` : 'Spirit'}</span>`); }
    if (k.includes('res')) out.push(`<span class="rtag res" title="${esc(s.r || '')}">${/−|-30%/.test(s.r || '') ? '−30% res' : 'Resistance'}</span>`);
    if (k.includes('choice')) out.push(`<span class="rtag" title="${esc(s.r || '')}">Choice</span>`);
    return out.join('');
  }
  // the reward text, when it says more than the tags (a PoE2 permanent buff, the bandit choice)
  const rewardLine = (s) => (s.r && !s.p && !(s.k || []).some((k) => ['lab', 'spirit'].includes(k)) ? s.r : s.r && s.k && s.k.includes('choice') ? s.r : '');
  window.routeUi = { esc, tags, rewardLine };
}());
