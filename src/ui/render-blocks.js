'use strict';

// Shared renderer: the character, Path of Building and gear score blocks, and prices in both units.

(function () {
  const R = window.RENDER = window.RENDER || {}; // helpers shared by the render files
  // "If you equip it": changes to your character's totals (resistances vs cap, Spirit, ES, ...)
  window.characterBlock = function (ch, opts) {
    if (!ch) return '';
    opts = opts || {};
    const n = (v) => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
    const sg = (v) => `${v > 0 ? '+' : '−'}${n(Math.abs(v))}`;
    const items = [];
    if (ch.overall && ch.overall.delta) items.push({ cls: ch.overall.delta > 0 ? 'pos' : 'neg', html: `Average gear score of all you wear ${ch.overall.from} → <b>${ch.overall.to}</b>` });
    for (const r of ch.res || []) {
      if (r.from == null) { items.push({ cls: r.delta > 0 ? 'pos' : 'neg', html: `${R.esc(r.label)} ${sg(r.delta)}%` }); continue; }
      const capped = (v) => (v >= r.cap ? `${r.cap}%${v > r.cap ? ` (+${n(v - r.cap)} over)` : ''}` : `${n(v)}%`);
      // only matters when it crosses or sits below the cap
      const matters = r.under || r.wasUnder || (r.thin && r.delta < 0);
      items.push({ cls: r.under && r.delta < 0 ? 'neg warn' : r.thin && r.delta < 0 ? 'neg warn' : r.wasUnder && r.delta > 0 ? 'pos' : 'dim', html: `${R.esc(r.label)} ${capped(r.from)} → <b>${capped(r.to)}</b>${r.under ? ` ${window.ICON.warn} below cap` : r.thin && r.delta < 0 ? ` ${window.ICON.warn} barely capped` : ''}`, minor: !matters });
    }
    for (const l of ch.lines || []) items.push({ cls: l.delta > 0 ? 'pos' : 'neg', html: `${R.esc(l.label)} ${n(l.from)} → <b>${n(l.to)}</b> <span class="dim">(${sg(l.delta)})</span>` });
    if (!items.length && !(opts.risks && opts.risks.length)) return opts.empty ? '<div class="charch dim">No change to your totals.</div>' : '';
    const shown = opts.compact ? items.filter((x) => !x.minor).slice(0, 4) : items;
    const losses = (ch.res || []).filter((r) => r.from != null && r.delta < 0 && r.under && (r.el !== 'chaos' || !r.wasUnder));
    const banner = window.resLossBanner && losses.length && !opts.noBanner ? window.resLossBanner(losses) : '';
    const otherRisks = (opts.risks || []).filter((x) => !/res (drops below|goes further under) the cap/.test(x));
    const risk = banner + (otherRisks.length ? `<div class="risks">${window.ICON.warn} ${otherRisks.map(R.esc).join(' · ')}</div>` : '');
    if (!shown.length) return risk;
    return `${risk}<div class="charch"><span class="dim" title="Totals from your saved gear; resistances use the totals from Path of Building / My gear">If you equip it:</span> ${shown.map((x) => `<span class="cc ${x.cls}">${x.html}</span>`).join('')}</div>`;
  };

  // Big red warning for resistances an item drops off (or further under) the cap.
  // rows: [{ el, from, to, max }] (PoB) or the app's own res rows ({ label, from, to, cap })
  window.resLossBanner = function (rows, o) {
    if (!rows || !rows.length) return '';
    const txt = rows.map((r) => {
      const el = r.el || String(r.label || '').replace(/ res$/, '');
      const max = r.max || r.cap || 75;
      const from = Math.round(r.from); const to = Math.round(r.to);
      return `<b>${R.esc(el)}</b> ${Math.min(from, max)}% → <b>${to}%</b> <span>(${to - Math.min(from, max)} ${from >= max ? 'off the cap' : 'further under the cap'})</span>`;
    }).join(' · ');
    return o && o.plain ? `<div class="loss-line">${txt}</div>` : `<div class="res-loss-banner">${window.ICON.warn} Loses resistance: ${txt}</div>`;
  };
  // the same for an item that costs a big part of your damage (e.g. a ring without your minion mods)
  window.dmgLossBanner = function (d, o) {
    if (!d) return '';
    const n = (v) => (v >= 1000 ? Math.round(v).toLocaleString('en') : Math.round(v));
    if (o && o.plain) return `<div class="loss-line"><b>${d.minion ? 'Minion DPS' : 'DPS'} ${n(d.from)} → ${n(d.to)}</b> (−${Math.abs(d.pct)}%: it doesn't have the damage mods your item gives)</div>`;
    return `<div class="res-loss-banner">${window.ICON.warn} Loses damage: <b>${d.minion ? 'Minion DPS' : 'DPS'} ${n(d.from)} → ${n(d.to)}</b> <span>(−${Math.abs(d.pct)}%: it doesn't have the damage mods your item gives)</span></div>`;
  };

  // "At 20% quality: +6.1% (UPGRADE)": the same item judged again by Path of Building with 20% quality
  //   r.atQuality: { quality, from, score, verdict, gain } (core/quality.js summarise)
  window.atQualityHtml = function (r) {
    const q = r && !r.isEquipped && r.pob && r.atQuality;
    if (!q) return '';
    const v = (R.VERDICT && R.VERDICT[q.verdict]) || null;
    const sc = `${q.score > 0 ? '+' : q.score < 0 ? '−' : '±'}${Math.abs(q.score)}%`;
    return `<div class="at-quality small" title="Path of Building judged this item again with ${q.quality}% quality (it has ${q.from}% now). Quality raises an armour piece's defences and a weapon's physical damage; a few Armourer's Scraps, Blacksmith's Whetstones or Arcanist's Etchers get it there.">At ${q.quality}% quality: <b>${sc}</b> for your build${v ? ` <span class="dim">(${R.esc(v.text)})</span>` : ''} <span class="dim">· ${q.from}% now</span></div>`;
  };

  // Best mods to add (features/craft.js): the free slots' best mods for your build
  window.craftBestHtml = function (res) {
    if (!res || !res.ok) return `<div class="note">${R.esc((res && res.error) || 'Path of Building could not try the mods.')}</div>`;
    const sg = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v)}%`;
    const rows = res.list.map((x) => `<tr class="${x.gain != null && x.gain >= 0.3 ? 'pos' : 'unweighted'}">
        <td><span class="tier ${x.tier <= 2 ? 'tier-top' : x.tier <= 4 ? 'tier-mid' : 'tier-low'}" title="${R.esc(x.affix ? `"${x.affix}", ` : '')}${x.type.toLowerCase()}, tier ${x.tier} of ${x.tiers} (the best this item level allows)">${x.type === 'Prefix' ? 'P' : 'S'} T${x.tier}</span> ${R.esc(x.lines.join(' / '))}${x.capped.length ? ` <span class="small">✓ caps ${R.esc(x.capped.join(', ').toLowerCase())}</span>` : ''}</td>
        <td class="r"><b>${sg(x.score)}</b>${x.gain != null ? ` <span class="dim small">(${sg(x.gain)})</span>` : ''}</td></tr>`).join('');
    return `<div class="dim small">With one more mod (${res.open.prefix} prefix${res.open.prefix === 1 ? '' : 'es'}, ${res.open.suffix} suffix${res.open.suffix === 1 ? '' : 'es'} free), for your build vs what you wear${res.now != null ? `; in brackets, the gain over this item as it is (${sg(res.now)})` : ''}. Best tier for item level ${R.esc(res.ilvl)}, middle roll; a random craft rolls lower tiers too.</div>
      <table class="rows craft-table">${rows}</table>
      <div class="dim small">${res.tried} mods tried${res.useless ? `; ${res.useless} add next to nothing for your build` : ''}.</div>`;
  };

  // Path of Building's verdict: what the item really does to your build
  //   p: pobverdict.judge() output; opts: { pending, error, compact }
  window.pobBlock = function (p, opts) {
    opts = opts || {};
    if (opts.pending && !p) return '<div class="pob dim"><span class="pob-tag">PoB</span> <span class="spinner"></span> Checking with Path of Building…</div>';
    if (!p) return opts.error ? `<div class="pob dim"><span class="pob-tag">PoB</span> ${R.esc(opts.error)}</div>` : '';
    const n = (v) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en') : Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10);
    const sgn = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±');
    const pc = (v) => (v == null ? '' : `<b class="${v > 0.05 ? 'pos' : v < -0.05 ? 'neg' : 'dim'}">${sgn(v)}${Math.abs(Math.round(v * 10) / 10)}%</b>`);
    const dl = (label, d) => (d ? `<span class="cc ${d.delta > 0 ? 'pos' : 'neg'}">${label} ${n(d.from)} → <b>${n(d.to)}</b></span>` : '');
    const dmgName = `<span title="${R.esc(p.skill === 'Full DPS' ? 'Path of Building\'s Full DPS: every skill ticked to count in it' : p.skill ? `Judged on your main skill in Path of Building: ${p.skill}` : 'Your main skill in Path of Building')}">${p.dpsKey === 'MinionDPS' ? 'Minion DPS' : 'DPS'}${p.skill && p.skill !== 'Full DPS' ? ` <span class="dim">(${R.esc(p.skill)})</span>` : ''}</span>`;
    // only what changes: no "±0%" (a flask, say, changes neither), and a resistance loss already said above isn't said again
    const moved = (v) => v != null && Math.abs(v) >= 0.05;
    const bits = [
      p.noDamage ? '<span class="dim" title="Your main skill in Path of Building deals no damage. Set your damage skill as the main skill in PoB and import again.">no damage to compare</span>' : moved(p.dps && p.dps.pct) ? `${dmgName} ${pc(p.dps.pct)}` : '',
      moved(p.ehp && p.ehp.pct) ? `Effective HP ${pc(p.ehp.pct)}` : '',
      p.resFirst && p.resGain && !(opts.lossShown && p.resGain < 0) ? `<span title="Resistance points toward your cap (Priorities: cap resistances first)"><b class="${p.resGain > 0 ? 'pos' : 'neg'}">${p.resGain > 0 ? '+' : '−'}${Math.abs(p.resGain)}</b> res to cap</span>` : '',
    ].filter(Boolean);
    const head = bits.length ? `<span class="pob-tag" title="Calculated by Path of Building with your build">PoB</span>
      <span class="pob-main">${bits.join(' · ')}</span>` : opts.flask ? '' : `<span class="pob-tag" title="Calculated by Path of Building with your build">PoB</span> <span class="dim">No change to damage or effective HP</span>`;
    const res = (p.res || []).filter((r) => r.capped !== r.wasCapped || !r.capped || Math.round(r.from) !== Math.round(r.to))
      .filter((r) => !(opts.lossShown && ((r.wasCapped && !r.capped) || (p.resLoss || []).some((x) => x.el === r.el)))) // said in the loss line
      .map((r) => {
      const bad = r.wasCapped && !r.capped; const good = !r.wasCapped && r.capped;
      return `<span class="cc ${bad || (!r.capped && r.to < r.from) ? 'neg warn' : good || r.to > r.from ? 'pos' : 'dim'}">${R.esc(r.el)} res ${Math.round(r.from)}% → <b>${Math.round(r.to)}%</b>${bad ? ` ${window.ICON.warn} off the cap` : good ? ' ✓ capped' : !r.capped ? ' (under cap)' : ''}</span>`;
    }).join('');
    const hitLabel = p.dpsKey === 'MinionDPS' ? 'Minion hit' : 'Hit';
    const hit = p.hit && !p.noDamage && Math.abs(p.hit.delta) / Math.max(1, p.hit.from) >= 0.005
      ? `<span class="cc ${p.hit.delta > 0 ? 'pos' : 'neg'}" title="Average damage per hit of your main skill (Path of Building's Average Hit)">${hitLabel} ${n(p.hit.from)} → <b>${n(p.hit.to)}</b></span>` : '';
    // movement speed: every point is felt, a loss is flagged (Priorities: keep my movement speed)
    const spd = p.speed ? `<span class="cc ${p.speed.delta > 0 ? 'pos' : 'neg'}${p.speed.delta <= -3 ? ' warn' : ''}" title="Movement speed with this item, from Path of Building (base speed = 0%)">Speed ${p.speed.from}% → <b>${p.speed.to}%</b></span>` : '';
    const parts = [spd, hit, dl('ES', p.es), dl('Life', p.life), dl(p.game === 'poe1' ? 'Ward' : 'Runic Ward', p.ward), dl('Spirit', p.spirit), dl('Mana', p.mana), res].filter(Boolean);
    // resistance losses get their own banner, above everything else
    const lossBanner = opts.noBanner ? '' : window.resLossBanner(p.resLoss) + window.dmgLossBanner(p.dmgLoss);
    const capLine = p.resCapped && p.resCapped.length ? `<div class="res-cap">✓ Caps your ${R.esc(p.resCapped.join(' and ').toLowerCase())} resistance</div>` : '';
    const other = (p.breaks || []).filter((b) => !/res (drops off|goes further under)|^(Minion damage|Damage) drops/.test(b));
    const risk = other.length ? `<div class="risks">${window.ICON.warn} ${other.map(R.esc).join(' · ')}</div>` : '';
    return `${lossBanner}${capLine}${head ? `<div class="pob">${head}</div>` : ''}${risk}${parts.length ? `<div class="charch">${opts.compact ? parts.slice(0, 5).join('') : parts.join('')}</div>` : ''}`;
  };

  // Gear score block: "78 A · for your build · yours 56 (+22)" + why? details
  window.gearBlock = function (g, yours, idSuffix) {
    if (!g) return '';
    if (g.unique) return '<div class="gear dim">Gear score: uniques aren\'t rated (their mods are fixed).</div>';
    const diff = yours != null ? g.score - yours : null;
    const cmp = diff == null ? '' : ` · yours ${yours} <b class="${diff > 0 ? 'pos' : diff < 0 ? 'neg' : ''}">(${diff > 0 ? '+' : ''}${diff})</b>`;
    const contrib = (g.contributions || []).slice(0, 8).map((c) => `<div class="gc"><span>${R.esc(c.label)}${c.source === 'socket' ? ' (rune)' : ''}</span><span class="dim">${c.quality}% roll</span><b>+${c.points}</b></div>`).join('');
    const detail = `<div class="dim gs-one">How good this item is for your build in this slot (100 = about the best it can roll). Points per stat:</div>${contrib}${g.missing && g.missing.length ? `<div class="note">Missing: ${R.esc(g.missing.join(', '))}</div>` : ''}${g.wasted && g.wasted.length ? `<div class="dim">Not useful to your build: ${R.esc(g.wasted.join(', '))}</div>` : ''}${g.resNote ? `<div class="dim">${R.esc(g.resNote)}</div>` : ''}`;
    return `<div class="gear"><span class="gs g-${R.esc(g.grade)}" title="${R.esc(g.buildName || '')}">${g.score} ${R.esc(g.grade)}</span>
      <span>Gear score${cmp}</span> <button class="link gear-why" data-why="${idSuffix || 'x'}">why?</button></div>
      <div class="gear-detail hidden" data-whybox="${idSuffix || 'x'}">${detail}</div>`;
  };
  // The plain-language explanation of the gear score, shown in the results window,
  // the popup's "why?" and on the Build & stats page.
  window.gearExplainHtml = function (opts) {
    opts = opts || {};
    // PoE1 has no gear score: Path of Building's verdict is all there is
    if (opts.game === 'poe1') {
      return `<div class="gs-explain">
      <p><b>Path of Exile 1 items are judged by Path of Building</b> with your build: your passive tree, skill gems and Configuration.</p>
      <ul>
        <li><b>pts</b> is Path of Building's score: the % change to your damage and effective HP (weighted as set on Build &amp; stats), plus half a point per resistance point toward your cap.</li>
        <li><span class="vchip up">UPGRADE</span> clearly better · <span class="vchip up">SMALL UPGRADE</span> a little better · <span class="vchip same">SIDEGRADE</span> about the same · <span class="vchip down">DOWNGRADE</span> worse ·
          <span class="vchip risky">UPGRADE, BUT…</span> better, but it costs reservation, links or a resistance below the cap ·
          <span class="vchip down">LOSES RESISTANCE</span> a resistance drops off the cap · <span class="vchip down">LOSES DAMAGE</span> your damage drops. Both go to the bottom of the results.</li>
        <li>Rings are compared with your weakest ring, jewels in each of your sockets, flasks in your flask slots. Cluster and timeless jewels aren't judged yet.</li>
        ${opts.pobOn ? '' : '<li><b>No build loaded:</b> paste your Path of Building Community export on My gear, or items get no verdict.</li>'}
      </ul></div>`;
    }
    return `<div class="gs-explain">
      ${opts.pobOn ? '<p class="note">Your Path of Building build is loaded, so <b>verdicts come from Path of Building</b> (the change to your damage, effective HP and resistances). The gear score below is a rough guide shown alongside, and is used for anything PoB can\'t check (e.g. jewels).</p>' : ''}
      <p><b>Gear score (0–100)</b> is how good an item is <b>for your build, in that slot</b>. 100 is about the best that slot can roll for you: your build's most important stats there, at top rolls.</p>
      <ul>
        <li><b>How it's worked out:</b> every stat your build cares about counts by how important it is (Build &amp; stats page) × how good the roll is. A 50% roll of an important stat beats a perfect roll of a minor one.</li>
        <li><b>What doesn't count:</b> stats your build doesn't use, stats you've ignored, and resistance past your cap. Rune bonuses count half, because you can swap runes. Conditional mods (<b>"…if you've Hit Recently"</b>) count a bit less.</li>
        <li><b>Grades:</b> <span class="gs g-S">S</span> 85+ <span class="gs g-A">A</span> 70+ <span class="gs g-B">B</span> 55+ <span class="gs g-C">C</span> 40+ <span class="gs g-D">D</span> below. Uniques aren't rated.</li>
        <li><b>The verdict</b> compares it with what you wear in that slot (for rings, charms and jewels, your weakest one):
          <span class="vchip up">UPGRADE</span> +6 or more ·
          <span class="vchip up">SMALL UPGRADE</span> +3 to +5 ·
          <span class="vchip same">SIDEGRADE</span> within 2 ·
          <span class="vchip down">DOWNGRADE</span> −3 or worse ·
          <span class="vchip risky">UPGRADE, BUT…</span> better, but it costs Spirit or reservation, links, a resistance below the cap, or minion levels ·
          <span class="vchip down">LOSES RESISTANCE</span> a resistance drops off the cap, or further under it ·
          <span class="vchip down">LOSES DAMAGE</span> your damage drops (when <b>Never lose damage</b> is on); both go to the bottom of the results.</li>
        ${opts.pobOn
    ? `<li><b>The verdicts use your whole build.</b> Path of Building knows your passive tree, skill gems and Configuration, so the verdict and the PoB line under each listing show the real change to your damage, effective HP and resistances${opts.where ? `. The gear score is tuned on the ${opts.where}` : ''}.</li>`
    : `<li><b>It isn't a damage calculator.</b> It doesn't know your passive tree or skill gems. Check <b>If you equip it</b> under each listing for what changes on your character${opts.where ? `, and tune what each stat is worth on the ${opts.where}` : ''}. Add your Path of Building build on My gear for exact verdicts.</li>`}
      </ul></div>`;
  };

  // "Why this score?": points per stat for this item next to yours, so a +9 is easy to read.
  window.gearCompareHtml = function (g, ge) {
    if (!g) return '';
    const mine = new Map(); const theirs = new Map();
    const roll = new Map();
    for (const c of g.contributions || []) { mine.set(c.label, (mine.get(c.label) || 0) + c.points); roll.set(c.label, Math.max(roll.get(c.label) || 0, c.quality || 0)); }
    for (const c of (ge && ge.contributions) || []) theirs.set(c.label, (theirs.get(c.label) || 0) + c.points);
    const labels = [...new Set([...mine.keys(), ...theirs.keys()])]
      .map((l) => ({ l, a: mine.get(l) || 0, b: theirs.get(l) || 0 }))
      .sort((x, y) => Math.abs(y.a - y.b) - Math.abs(x.a - x.b) || y.a - x.a).slice(0, 10);
    const r1 = (v) => Math.round(v * 10) / 10;
    const rows = labels.map(({ l, a, b }) => {
      const d = r1(a - b);
      return `<tr><td>${R.esc(l)}${roll.get(l) ? ` <span class="dim">${roll.get(l)}% roll</span>` : ''}</td><td class="r">${r1(a) || '–'}</td>${ge ? `<td class="r dim">${r1(b) || '–'}</td><td class="r ${d > 0 ? 'pos' : d < 0 ? 'neg' : 'dim'}">${d > 0 ? '+' : ''}${d || '0'}</td>` : ''}</tr>`;
    }).join('');
    const scale = g.ideal ? ` Points are out of ${Math.round(g.ideal)} for a perfect item here, then scaled to 100.` : '';
    return `<div class="dim gs-one">How good this item is for your build in this slot (0–100).${scale}</div>
      <table class="gs-table"><tr><th>Stat</th><th class="r">This</th>${ge ? '<th class="r">Yours</th><th class="r">±</th>' : ''}</tr>${rows || '<tr><td class="dim" colspan="4">None of its stats count for your build in this slot.</td></tr>'}</table>
      ${g.missing && g.missing.length ? `<div class="note">Missing: ${R.esc(g.missing.join(', '))}</div>` : ''}
      ${g.wasted && g.wasted.length ? `<div class="dim">Not useful to your build: ${R.esc(g.wasted.join(', '))}</div>` : ''}
      ${g.resNote ? `<div class="dim">${R.esc(g.resNote)}</div>` : ''}
      <button class="link gs-help">What is the gear score?</button>`;
  };

  window.bindGearWhy = function (root) {
    root.querySelectorAll('.gs-help').forEach((b) => b.addEventListener('click', () => {
      if (window.showGearHelp) window.showGearHelp(); else if (window.api.openSettingsTab) window.api.openSettingsTab('build');
    }));
    root.querySelectorAll('.gear-why').forEach((b) => b.addEventListener('click', () => {
      const box = root.querySelector(`[data-whybox="${b.dataset.why}"]`);
      if (box) box.classList.toggle('hidden');
      if (window.__popupResize) window.__popupResize();
    }));
  };

  // Price with the other unit alongside: "180 ex (0.26 div)" / "3 div (2,089 ex)"
  window.dualPrice = function (amount, currency, divineRate) {
    const a = Number(amount);
    if (!divineRate || !Number.isFinite(a)) return '';
    if (currency === 'divine') return `${Math.round(a * divineRate).toLocaleString()} ex`;
    if (currency === 'exalted') return `${Math.round((a / divineRate) * 100) / 100} div`;
    return '';
  };
})();
