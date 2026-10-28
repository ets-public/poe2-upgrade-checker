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
  // a step's number in its act, counting only the steps shown (optional ones hidden, the endgame rush):
  // { n, of } for the step at index idx
  function pos(v, idx) {
    const s = v.steps[idx];
    if (!s) return null;
    let n = 0; let of = 0;
    v.steps.forEach((x, j) => { if (x.act !== s.act || (x.hide && j !== idx)) return; of++; if (j <= idx) n++; });
    return { n, of };
  }
  // who is playing, in words (League start tab and overlay): { state: 'owner' | 'other' | 'unknown', text }
  function whereIs(area, level) {
    const a = String(area || '');
    const lvl = level ? ` (area level ${level})` : '';
    if (/^Map/i.test(a)) return `in a map${lvl}`;
    if (/hideout/i.test(a)) return 'in a hideout';
    return a ? `in ${a}${lvl}` : '';
  }
  function who(v) {
    const s = v.session || { who: 'unknown' };
    const me = v.character || 'the route character';
    if (s.who === 'owner') return { state: 'owner', text: v.character ? `Following ${v.character}${v.level ? ` (level ${v.level})` : ''}` : 'Following the first character to level up in the campaign' };
    if (s.who === 'other') {
      const them = s.by === 'name' && s.name ? s.name : 'Another character';
      return { state: 'other', text: `Paused: ${them} is playing${s.area ? ` ${whereIs(s.area, s.areaLevel)}` : ''}. It carries on when ${me} is back.` };
    }
    return { state: 'unknown', text: `Waiting to see who logged in: it carries on when ${me} enters a zone of the route or levels up.` };
  }
  window.routeUi = { esc, tags, rewardLine, pos, who };
}());
