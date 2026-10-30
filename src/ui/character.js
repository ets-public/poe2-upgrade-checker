'use strict';
/* global window, document */

// Character page: everything Path of Building calculates for your character (yours and your
// minions'), with the gear you copied in game, plus what the app itself knows.
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
  const n0 = (v) => (isNum(v) ? Math.round(v).toLocaleString('en') : '–');
  const n1 = (v) => (isNum(v) ? (Math.round(v * 10) / 10).toLocaleString('en') : '–');
  const big = (v) => (!isNum(v) ? '–' : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}k` : n0(v));
  const pct = (v) => (isNum(v) ? `${n1(v)}%` : '–');
  const row = (k, v, hint) => (v == null || v === '–' ? '' : `<tr><td>${esc(k)}${hint ? ` <small>${esc(hint)}</small>` : ''}</td><td>${v}</td></tr>`);
  const card = (title, body, extra) => (body ? `<div class="card-p ${extra || ''}"><h3>${esc(title)}</h3>${body}</div>` : '');
  const table = (rows) => { const r = rows.filter(Boolean).join(''); return r ? `<table class="kv">${r}</table>` : ''; };
  const SLOT_ORDER = ['Weapon', 'Offhand', 'Helmet', 'Body Armour', 'Gloves', 'Boots', 'Amulet', 'Ring 1', 'Ring 2', 'Ring 3', 'Belt', 'Flask 1', 'Flask 2', 'Flask 3', 'Flask 4', 'Flask 5'];
  const POB_SLOT = { Weapon: 'Weapon 1', Offhand: 'Weapon 2' };

  let busy = false;
  let again = null; // a render asked for while one runs: do it straight after, not never
  async function render(refresh) {
    if (busy) { again = again || !!refresh; return; }
    busy = true;
    const body = $('#charBody');
    try {
      const [st, d] = await Promise.all([window.api.getState(), window.api.pobSheet(!!refresh)]);
      const prof = (st.profiles || []).find((p) => p.active);
      $('#charTitle').textContent = prof ? prof.name : 'Character';
      sheetAt = d.at || null;
      if (bossLast && bossAt !== sheetAt) bossLast = null; // build or gear changed since: check again
      body.innerHTML = d.sheet ? sheetHtml(d, st) : noPobHtml(d, st);
      $('#charSub').textContent = d.sheet
        ? `Calculated by Path of Building with your build${d.sheet.overridden && d.sheet.overridden.length ? ` and the ${d.sheet.overridden.length} item${d.sheet.overridden.length === 1 ? '' : 's'} you copied in game` : ''}${d.at ? ` · ${new Date(d.at).toLocaleTimeString()}` : ''}.${d.error ? ` Couldn't recalculate just now: ${d.error}` : ''}`
        : 'Add your Path of Building build on My gear to see your full character sheet.';
      $('#charRefresh').classList.toggle('hidden', !d.on);
      // widths set here: the page's security policy doesn't allow inline styles
      body.querySelectorAll('[data-w]').forEach((e) => { e.style.width = `${Number(e.dataset.w) || 0}%`; });
      renderStrings();
      if (d.sheet) fillMainSkills();
      body.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => document.querySelector(`.tabs button[data-tab="${b.dataset.goto}"]`).click()));
    } catch (err) {
      body.innerHTML = `<div class="card-p">Couldn't load your character: ${esc(err.message || err)}</div>`;
    } finally {
      busy = false;
      if (again !== null) { const r = again; again = null; render(r); }
    }
  }

  // the main skill picker: every active skill of the build and the weapon's default attack, with
  // each one's damage as the main skill (Path of Building works them out, so they come a moment later)
  async function fillMainSkills() {
    const sel = $('#mainSkillSel'); const msg = $('#mainSkillMsg');
    if (!sel) return;
    sel.disabled = true;
    msg.textContent = 'working out each skill\'s damage…';
    const r = await window.api.pobMainSkills().catch((err) => ({ ok: false, error: err.message }));
    if (!document.body.contains(sel)) return;
    if (!r || !r.ok) { msg.textContent = (r && r.error) || ''; return; }
    const pobMain = r.list.find((c) => c.main && !r.pick) || null;
    const label = (c) => `${c.name}${c.default ? " (weapon's default attack)" : ''}${c.dps != null ? ` – ${c.dps >= 1e4 ? `${(c.dps / 1e3).toFixed(1)}k` : Math.round(c.dps).toLocaleString('en')} ${c.minion ? 'minion ' : ''}DPS` : ''}`;
    sel.innerHTML = `<option value="">As in Path of Building${pobMain ? ` (${esc(pobMain.name)})` : ''}</option>`
      + r.list.map((c, i) => `<option value="${i}" ${r.pick && !r.missing && c.name === r.pick.name && (!r.pick.slot || c.slot === r.pick.slot) ? 'selected' : ''}>${esc(label(c))}</option>`).join('');
    if (!r.pick || r.missing) sel.value = '';
    sel.disabled = false;
    msg.textContent = r.missing ? `${r.pick.name} isn't in this build any more, so Path of Building's own main skill is used.` : '';
    sel.onchange = async () => {
      const c = sel.value === '' ? null : r.list[Number(sel.value)];
      sel.disabled = true; msg.textContent = 'recalculating…';
      const res = await window.api.setPobMainSkill(c ? { name: c.name, slot: c.slot } : null).catch((err) => ({ ok: false, error: err.message }));
      if (!res || !res.ok) { msg.textContent = (res && res.error) || 'Could not change the main skill.'; sel.disabled = false; return; }
      render(false);
    };
  }

  function resBars(list, ci) {
    return list.map((r) => {
      const el = String(r.el).toLowerCase();
      if (el === 'chaos' && ci) return `<div class="resbar chaos ok"><div class="rl"><span>Chaos</span><b>immune</b></div><div class="track"><div class="fill" data-w="100"></div></div><div class="dim small">Chaos Inoculation – chaos resistance doesn't matter.</div></div>`;
      const max = r.max || 75; const v = isNum(r.value) ? r.value : null;
      const under = v != null && v < max - 0.5;
      const over = isNum(r.over) && r.over > 0 ? ` <small class="dim">(${n0(r.total)}%, ${n0(r.over)} over the cap)</small>` : '';
      return `<div class="resbar ${el} ${under ? 'under' : 'ok'}"><div class="rl"><span>${esc(r.el)}</span><span><b>${v == null ? '–' : n0(v)}%</b> / ${n0(max)}%${over}${under ? ` <small>${n0(max - v)} short</small>` : ''}</span></div><div class="track"><div class="fill" data-w="${v == null ? 0 : Math.max(0, Math.min(100, (v / max) * 100))}"></div></div></div>`;
    }).join('');
  }

  function sheetHtml(d, st) {
    const s = d.sheet; const p = s.player || {}; const m = s.minion; const ci = !!p.ChaosInoculation || (isNum(p.Life) && p.Life <= 1);
    const minionMain = m && isNum(m.CombinedDPS) && m.CombinedDPS > 0;
    const playerDps = Math.max(p.FullDPS || 0, p.CombinedDPS || 0, p.TotalDPS || 0);
    const tags = [
      `<label class="main-pick">Main skill <select id="mainSkillSel" title="The skill Path of Building judges your damage with. Pick another to see its numbers and have items judged for it."><option>${esc(s.mainSkill || '…')}</option></select></label><span class="dim small" id="mainSkillMsg" role="status"></span>`,
      ci ? '<span class="char-tag good">Chaos Inoculation</span>' : '',
      ...(s.tree && s.tree.keystones ? s.tree.keystones.filter((k) => k !== 'Chaos Inoculation').map((k) => `<span class="char-tag">${esc(k)}</span>`) : []),
    ].join('');
    const tiles = [
      minionMain ? ['Minion DPS', big(m.CombinedDPS)] : null,
      playerDps > 0 ? [minionMain ? 'Your DPS' : 'DPS', big(playerDps)] : null,
      ['Effective HP', big(p.TotalEHP)],
      isNum(p.EnergyShield) && p.EnergyShield > 0 ? ['Energy Shield', n0(p.EnergyShield)] : null,
      !ci ? ['Life', n0(p.Life)] : null,
      ['Mana', n0(p.Mana)],
      // PoE2: Spirit; PoE1 has none, its auras reserve mana or life
      isNum(p.Spirit) ? ['Spirit free', `${n0(p.SpiritUnreserved)} <small class="dim tile-sub">/ ${n0(p.Spirit)}</small>`]
        : isNum(p.ManaUnreservedPercent) ? ['Mana unreserved', `${n0(p.ManaUnreservedPercent)}%`] : null,
      isNum(p.MovementSpeedMod) ? ['Movement speed', `${p.MovementSpeedMod >= 1 ? '+' : ''}${n0((p.MovementSpeedMod - 1) * 100)}%`] : null,
    ].filter(Boolean).map(([k, v]) => `<div class="tile"><b>${v}</b><span>${esc(k)}</span></div>`).join('');
    const hero = `<div class="card-p"><div class="char-hero"><div class="who">${esc(s.ascendancy || s.className || 'Your character')}<small>${esc(s.ascendancy && s.className ? s.className + ' · ' : '')}Level ${esc(s.level || '?')}${s.tree && s.tree.points ? ` · ${s.tree.points} passive points` : ''}</small></div><div class="char-tags">${tags}</div></div><div class="char-big">${tiles}</div></div>`;

    const mres = m ? ['Fire', 'Cold', 'Lightning', 'Chaos'].map((el) => (isNum(m[`${el}Resist`]) ? `${n0(m[`${el}Resist`])}%` : '–')).join(' / ') : null;
    const minionCard = m ? card(m.name ? `Minions – ${m.name}` : 'Minions', table([
      row('DPS', big(m.CombinedDPS || m.TotalDPS)),
      row('Damage per hit', big(m.AverageHit), 'average'),
      isNum(m.Speed) && m.Speed > 0 ? row('Uses per second', n1(m.Speed), isNum(m.Cooldown) && m.Cooldown > 0 ? 'with the cooldown' : '') : '',
      isNum(m.CastRate) && m.CastRate > 0 && !(isNum(m.Speed) && Math.abs(m.CastRate - m.Speed) < 0.05) ? row('Cast rate', `${n1(m.CastRate)}/s`, 'without the cooldown') : '',
      isNum(m.Cooldown) && m.Cooldown > 0 ? row('Cooldown', `${n1(m.Cooldown)} s`) : '',
      row('Critical hit chance', pct(m.CritChance)),
      row('Critical damage', isNum(m.CritMultiplier) ? `×${n1(m.CritMultiplier)}` : null),
      row('Hit chance', pct(m.HitChance)),
      isNum(m.AreaOfEffectRadiusMetres) ? row('Area radius', `${n1(m.AreaOfEffectRadiusMetres)} m`) : '',
      row('Life', n0(m.Life)),
      isNum(m.EnergyShield) && m.EnergyShield > 0 ? row('Energy shield', n0(m.EnergyShield)) : '',
      isNum(m.Armour) && m.Armour > 0 ? row('Armour', n0(m.Armour), isNum(m.PhysicalDamageReduction) ? `${n0(m.PhysicalDamageReduction)}% phys. reduction` : '') : '',
      isNum(m.Evasion) && m.Evasion > 0 ? row('Evasion', n0(m.Evasion)) : '',
      row('Effective HP', n0(m.TotalEHP)),
      row('Resistances', mres, 'fire / cold / lightning / chaos'),
    ])) : '';

    const offence = playerDps > 0 || !minionMain ? card(minionMain ? 'Your own damage' : 'Offence', table([
      Number(p.FullDPS) > 0 ? row('Full DPS', big(p.FullDPS)) : '', row('Main skill DPS', big(p.CombinedDPS || p.TotalDPS)), isNum(p.TotalDotDPS) && p.TotalDotDPS > 0 ? row('Damage over time', big(p.TotalDotDPS)) : '',
      row('Damage per hit', big(p.AverageHit), 'average'), isNum(p.Speed) && p.Speed > 0 ? row('Uses per second', n1(p.Speed)) : '',
      row('Critical hit chance', pct(p.CritChance)), row('Critical damage', isNum(p.CritMultiplier) ? `×${n1(p.CritMultiplier)}` : null),
      row('Hit chance', pct(p.HitChance)), row('Accuracy', n0(p.Accuracy)),
    ])) : '';

    const defence = card('Defences', table([
      row('Effective HP', n0(p.TotalEHP)),
      isNum(p.EnergyShield) && p.EnergyShield > 0 ? row('Energy shield', n0(p.EnergyShield), isNum(p.EnergyShieldRecharge) ? `recharges ${n0(p.EnergyShieldRecharge)}/s after ${n1(p.EnergyShieldRechargeDelay)} s` : '') : '',
      ci ? row('Life', '1', 'Chaos Inoculation') : row('Life', n0(p.Life), isNum(p.LifeRegenRecovery) && p.LifeRegenRecovery > 0 ? `regenerates ${n1(p.LifeRegenRecovery)}/s` : ''),
      isNum(p.Ward) && p.Ward > 0 ? row(st && st.game === 'poe1' ? 'Ward' : 'Runic Ward', n0(p.Ward)) : '',
      row('Armour', n0(p.Armour), isNum(p.PhysicalDamageReduction) && p.PhysicalDamageReduction > 0 ? `${n0(p.PhysicalDamageReduction)}% physical reduction` : ''),
      row('Evasion', n0(p.Evasion), isNum(p.EvadeChance) ? `${n0(p.EvadeChance)}% chance to evade` : ''),
      isNum(p.DeflectChance) && p.DeflectChance > 0 ? row('Deflect chance', pct(p.DeflectChance)) : '',
      row('Block chance', isNum(p.BlockChance) ? `${n0(p.BlockChance)}%${isNum(p.BlockChanceMax) ? ` <small>of ${n0(p.BlockChanceMax)}%</small>` : ''}` : null),
      isNum(p.SpellBlockChance) && p.SpellBlockChance > 0 ? row('Spell block chance', pct(p.SpellBlockChance)) : '',
      row('Stun threshold', n0(p.StunThreshold)), row('Ailment threshold', n0(p.AilmentThreshold)),
    ]));

    const res = card('Resistances', resBars(s.res || [], ci) + (d.resists && d.resists.source === 'game' ? '<div class="dim small">From Path of Building. Your typed-in character sheet numbers are on My gear.</div>' : ''));

    const hit = (v) => (v === null || v === undefined ? (ci ? 'immune' : '–') : n0(v));
    const maxHit = card('Biggest hit you can take', table([
      row('Physical', hit(p.PhysicalMaximumHitTaken)), row('Fire', hit(p.FireMaximumHitTaken)), row('Cold', hit(p.ColdMaximumHitTaken)),
      row('Lightning', hit(p.LightningMaximumHitTaken)), row('Chaos', ci ? 'immune' : hit(p.ChaosMaximumHitTaken)),
    ]) + '<div class="dim small">From full energy shield / life, after your resistances and mitigation.</div>');

    const spPct = isNum(p.Spirit) && p.Spirit > 0 && isNum(p.SpiritReserved) ? Math.min(100, (p.SpiritReserved / p.Spirit) * 100) : 0;
    const spiritBar = isNum(p.Spirit) ? `<div class="resbar spiritbar"><div class="rl"><span>Spirit</span><span><b>${n0(p.SpiritReserved)}</b> reserved of ${n0(p.Spirit)} · <b class="${isNum(p.SpiritUnreserved) && p.SpiritUnreserved < 0 ? 'neg' : 'pos'}">${n0(p.SpiritUnreserved)}</b> free</span></div><div class="track"><div class="fill" data-w="${spPct}"></div></div></div>` : '';
    const resources = card(isNum(p.Spirit) ? 'Spirit & mana' : 'Mana & reservation', spiritBar + table([
      row('Mana', n0(p.Mana), isNum(p.ManaUnreserved) && p.ManaUnreserved !== p.Mana ? `${n0(p.ManaUnreserved)} unreserved` : ''),
      isNum(p.ManaReserved) && p.ManaReserved > 0 ? row('Mana reserved', n0(p.ManaReserved), isNum(p.ManaUnreservedPercent) ? `${n0(p.ManaUnreservedPercent)}% free` : '') : '',
      isNum(p.LifeReserved) && p.LifeReserved > 0 ? row('Life reserved', n0(p.LifeReserved), isNum(p.LifeUnreservedPercent) ? `${n0(p.LifeUnreservedPercent)}% free` : '') : '',
      isNum(p.SpellSuppressionChance) && p.SpellSuppressionChance > 0 ? row('Spell suppression', `${n0(p.SpellSuppressionChance)}%`) : '',
      row('Mana regeneration', isNum(p.ManaRegenRecovery) ? `${n1(p.ManaRegenRecovery)}/s` : null),
    ]));

    const attr = (k, label) => { const have = p[k]; const need = p[`Req${k}`]; const ok = !isNum(need) || have >= need; return row(label, `<b class="${ok ? '' : 'neg'}">${n0(have)}</b>${isNum(need) && need > 0 ? ` <small>needs ${n0(need)}</small>` : ''}`); };
    const charges = ['Power', 'Frenzy', 'Endurance'].map((c) => (isNum(p[`${c}ChargesMax`]) ? `${c} ${n0(p[`${c}ChargesMax`])}` : null)).filter(Boolean).join(' · ');
    const misc = card('Attributes & more', table([
      attr('Str', 'Strength'), attr('Dex', 'Dexterity'), attr('Int', 'Intelligence'),
      isNum(p.MovementSpeedMod) ? row('Movement speed', `${p.MovementSpeedMod >= 1 ? '+' : ''}${n0((p.MovementSpeedMod - 1) * 100)}%`) : '',
      charges ? row('Max charges', charges) : '',
      isNum(p.PresenceRadiusMetres) ? row('Presence radius', `${n1(p.PresenceRadiusMetres)} m`) : '',
      isNum(p.TotalCompanionLife) && p.TotalCompanionLife > 0 ? row('Companion life', n0(p.TotalCompanionLife)) : '',
    ]));

    // skills: one line per skill group, the main one first and highlighted (duplicates PoB keeps for
    // item-granted skills are left out)
    const seen = new Set();
    const groups = (s.skills || []).filter((g) => { const act = (g.gems || []).filter((x) => !x.support); const k = (act.length ? act : g.gems || []).map((x) => x.name).join('|'); if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => (b.main ? 1 : 0) - (a.main ? 1 : 0));
    const skills = groups.length ? card(`Skills (${groups.length})`, groups.map((g) => {
      const act = g.gems.filter((x) => !x.support); const sup = g.gems.filter((x) => x.support);
      return `<div class="skill-group ${g.main ? 'main' : ''} ${g.enabled ? '' : 'off'}"><div class="sk">${act.map((x) => `${esc(x.name)} <small class="dim">${x.level ? `lvl ${x.level}` : ''}${x.quality ? ` · ${x.quality}%` : ''}</small>`).join(' + ') || esc(g.label)}${g.main ? ' <span class="char-tag">main</span>' : ''}${g.default ? ' <small class="dim">weapon\'s default attack</small>' : ''}${g.enabled ? '' : ' <small class="dim">(disabled)</small>'}</div>${sup.length ? `<div class="gems">${sup.map((x) => `<span class="sup">${esc(x.name)}</span>`).join(' · ')}</div>` : ''}</div>`;
    }).join('')) : '';

    const t = s.tree || {};
    const tree = t.points ? card('Passive tree', `<div class="dim small">${t.points} points allocated${t.notables ? ` · ${t.notables.length} notables` : ''}</div>`
      + (t.keystones && t.keystones.length ? `<div class="small">Keystones</div><div class="chips key">${t.keystones.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : '')
      + (t.ascendancy && t.ascendancy.length ? `<div class="small">${esc(s.ascendancy || 'Ascendancy')}</div><div class="chips asc">${t.ascendancy.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : '')
      + (t.notables && t.notables.length ? `<div class="small">Notables</div><div class="chips">${t.notables.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : '')) : '';

    const over = new Set(s.overridden || []);
    const gs = st.gearScores || {};
    const gear = card('Gear', table(SLOT_ORDER.map((slot) => {
      const it = (st.equipped || {})[slot]; const pobName = (s.gear || {})[POB_SLOT[slot] || slot];
      const name = it ? it.name : pobName; if (!name) return '';
      const g = gs[slot];
      return row(slot, `${esc(name)}${over.has(POB_SLOT[slot] || slot) ? ' <small>copied in game</small>' : it && it.fromPob ? ' <small>from PoB</small>' : ''}${g && g.score != null ? ` <span class="gs g-${esc(g.grade)}">${g.score} ${esc(g.grade)}</span>` : ''}`);
    })) + (s.sockets && s.sockets.length ? `<h4 class="small">Jewel sockets on your tree</h4>${table(s.sockets.map((j) => row(j.label, j.jewel ? esc(j.jewel) : '<span class="neg">empty</span>')))}` : '')
      + '<div class="row"><button class="link" data-goto="gear">Change gear on My gear →</button></div>');

    // three groups of related cards, each stacked without gaps: what you deal, what you survive,
    // what you wear and how you're built
    const stack = (cls, title, parts) => { const inner = parts.filter(Boolean).join(''); return inner ? `<section class="char-stack ${cls}"><h4 class="char-group">${esc(title)}</h4>${inner}</section>` : ''; };
    return `${hero}<div class="char-cols">${stack('s-off', 'Offence', [minionCard, offence, skills])}${stack('s-def', 'Defence', [defence, res, maxHit, st.game === 'poe1' ? bossCard() : '', resources])}${stack('s-build', 'Gear & build', [gear, anointCard(st.game), st.game === 'poe1' ? '' : runeCard(), misc || tree ? `<div class="char-sub">${misc}${tree}</div>` : '', '<div class="card-p" id="strBox"></div>'])}</div>`;
  }

  // PoE1 boss check: Path of Building's boss skill presets, one at a time
  let bossLast = null; let bossAt = null; let sheetAt = null;
  function bossCard() {
    return card('Boss hits', `<div class="help">How many of each big boss hit you can take, worked out by Path of Building with its boss presets (Pinnacle and Uber). Under 1 means it kills you from full.</div>
      <div id="bossOut">${bossLast ? bossTable(bossLast) : ''}</div>
      <div class="row"><button id="bossBtn">${bossLast ? 'Check again' : 'Check boss hits'}</button></div>`);
  }
  const hitsTxt = (h) => (!isNum(h) ? '–' : h < 1 ? '<b class="neg">one-shot</b>' : h < 2 ? '<span class="warn-t">1 hit</span>' : `${Math.floor(h)} hits`);
  function bossTable(r) {
    if (!r.ok) return `<div class="note">${esc(r.error)}</div>`;
    const by = {};
    for (const x of r.skills) (by[x.name] = by[x.name] || {})[x.tier] = x;
    const names = Object.keys(by);
    if (!names.length) return '<div class="dim">No boss presets in this Path of Building.</div>';
    return `<table class="kv boss"><tr><th>Boss skill</th><th>Pinnacle</th><th>Uber</th></tr>${names.map((n) => `<tr><td>${esc(n)}</td><td>${hitsTxt(by[n].Pinnacle && by[n].Pinnacle.hits)}</td><td>${hitsTxt(by[n].Uber && by[n].Uber.hits)}</td></tr>`).join('')}</table>
      <div class="dim small">Before dodge, block and evade luck. Some of these are meant to be dodged (Atziri's Flameblast, the Maven's memory game).</div>`;
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest && e.target.closest('#bossBtn');
    if (!b) return;
    b.disabled = true; b.textContent = 'Checking…';
    bossAt = sheetAt;
    bossLast = await window.api.bossCheck().catch((err) => ({ ok: false, error: err.message || String(err) }));
    const out = $('#bossOut'); if (out) out.innerHTML = bossTable(bossLast);
    b.disabled = false; b.textContent = 'Check again';
  });

  // the best notables for your amulet: anoint (PoE1, oils) or instil (PoE2, distilled emotions)
  let anointLast = null;
  function anointCard(game) {
    const word = game === 'poe1' ? 'anoint' : 'instil';
    return card(game === 'poe1' ? 'Best anoint' : 'Best instil', `<div class="help">Every notable that can go on your amulet, tried by Path of Building in place of its current one. Notables already on your tree are left out.</div>
      <div id="anointOut">${anointLast ? anointTable(anointLast) : ''}</div>
      <div class="row"><button id="anointBtn" data-word="${word}">${anointLast ? 'Check again' : `Find the best ${word}`}</button></div>`);
  }
  const sgn = (v) => (!isNum(v) || Math.abs(v) < 0.05 ? '' : `${v > 0 ? '+' : ''}${n1(v)}%`);
  function anointTable(r) {
    if (!r.ok) return `<div class="note">${esc(r.error)}</div>`;
    if (!r.top.length) return '<div class="dim">Path of Building found no notables to try.</div>';
    const cur = r.current[0];
    const dmg = r.top[0] && r.top[0].dpsKey === 'MinionDPS' ? 'Minion DPS' : 'DPS';
    const rows = r.top.filter((x) => x.score > 0 || x.current).slice(0, 8).map((x) => `<tr${x.current ? ' class="cur"' : ''}><td title="${esc(x.stats.join('\n'))}"><b>${esc(x.name)}</b>${x.current ? ' <span class="dim small">(yours)</span>' : ''}<div class="dim small">${esc(x.recipe.map((o) => (r.game === 'poe1' ? String(o).replace(/(\w)Oil$/, '$1 Oil') : `Distilled ${o}`)).join(' + '))}</div></td><td>${sgn(x.dps) || '–'}</td><td>${sgn(x.ehp) || '–'}</td></tr>`).join('');
    const now = r.noAmulet ? 'Your build has no amulet, so a plain one was used.' : r.now.length ? `Your amulet has <b>${esc(r.now.join(', '))}</b>${cur ? '' : ' (on your tree too, so it adds nothing)'}.` : 'Your amulet has nothing on it yet.';
    return `<div class="small">${now}</div>${rows ? `<table class="kv anoint"><tr><th>Notable</th><th>${dmg}</th><th>Effective HP</th></tr>${rows}</table>` : '<div class="dim">None of them would help this build.</div>'}
      <div class="dim small">Compared with the amulet bare. Hover a name for what it does.${r.checked < r.total ? ` Checked ${r.checked} of ${r.total} (out of time).` : ''}</div>`;
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest && e.target.closest('#anointBtn');
    if (!b) return;
    b.disabled = true; b.innerHTML = '<span class="spinner"></span> Trying every notable…';
    const gen = charGen;
    const res = await window.api.anointCheck().catch((err) => ({ ok: false, error: err.message || String(err) }));
    const btn = $('#anointBtn') || b;
    btn.disabled = false;
    // another character (or new gear) since it was asked: that answer is for the old one
    if (gen !== charGen) { btn.textContent = `Find the best ${btn.dataset.word || 'anoint'}`; return; }
    anointLast = res;
    const out = $('#anointOut'); if (out) out.innerHTML = anointTable(anointLast);
    btn.textContent = 'Check again';
  });

  // PoE2: the best rune, soul core or idol for each socket on your gear
  let runeLast = null;
  // bumped whenever the character, its gear or the settings change: a check still running for the
  // character before throws its answer away
  let charGen = 0;
  function runeCard() {
    return card('Best runes and soul cores', `<div class="help">Every rune, soul core and idol that fits each socket on your gear, tried by Path of Building in place of what's there. Only the best tier your level can use of each is tried. Gear with no socket is tried with one added (an Artificer's Orb); corrupted gear is left out.</div>
      <div id="runeOut">${runeLast ? runeTable(runeLast) : ''}</div>
      <div class="row"><button id="runeBtn">${runeLast ? 'Check again' : 'Find the best runes'}</button></div>`);
  }
  const price = (p) => (!p ? '' : p.eachDiv != null && p.eachDiv >= 0.5 ? `${n1(p.eachDiv)} div` : p.each != null ? `${n1(p.each)} ${esc(p.unit || 'ex')}` : '');
  function runeTable(r) {
    if (!r.ok) return `<div class="note">${esc(r.error)}</div>`;
    if (!r.ranked.length) return '<div class="dim">None of your gear has a socket, or could get one.</div>';
    const dmgOf = (o) => [sgn(o.dpsPct) && `${sgn(o.dpsPct)} dmg`, sgn(o.ehpPct) && `${sgn(o.ehpPct)} EHP`, o.resGain ? `${o.resGain > 0 ? '+' : ''}${Math.round(o.resGain)} res` : ''].filter(Boolean).join(' · ') || 'small gain';
    const rows = r.ranked.map((x) => {
      const where = `${esc(x.slot)}${x.sockets > 1 ? ` <span class="dim small">socket ${x.socket}</span>` : ''}${x.added ? '<div class="dim small">no socket yet: Artificer\'s Orb</div>' : ''}`;
      const gives = x.yours && (x.yours.dpsPct || x.yours.ehpPct || x.yours.resGain) ? `<div class="dim small">gives you ${esc(dmgOf(x.yours))}</div>` : '';
      const now = x.unknown ? `<span class="dim" title="The copied text doesn't say which rune it is: copy the item again (F2) so the app sees its sockets">unknown rune</span>${gives}`
        : x.current ? `${esc(x.current)}${x.guessed ? ' <span class="dim small" title="Worked out from what it does: the copied text doesn\'t name it">(worked out)</span>' : ''}${gives}` : '<span class="dim">empty</span>';
      const alts = x.options.filter((o) => !x.best || o.rune !== x.best.rune).slice(0, 3).map((o) => `${o.rune}: ${dmgOf(o)}${o.breaks.length ? ' (breaks the build)' : ''}`).join('\n');
      const best = x.best ? `<b title="${esc([...x.best.lines, alts ? '\nAlso good:\n' + alts : ''].join('\n'))}">${esc(x.best.rune)}</b> <span class="dim small">${esc(x.best.type === 'SoulCore' ? 'soul core' : String(x.best.type || 'rune').toLowerCase())}</span><div class="small pos">${esc(dmgOf(x.best))}</div>`
        : `<span class="dim">${x.current || x.unknown ? 'keep it: nothing better' : 'nothing helps'}</span>`;
      return `<tr${x.best ? '' : ' class="dim"'}><td>${where}</td><td>${now}</td><td>${best}</td><td class="nowrap">${x.best ? price(r.prices[x.best.rune]) || '<span class="dim">–</span>' : ''}</td></tr>`;
    }).join('');
    const t = r.together;
    const tog = t ? `<div class="small">All of them together: <b class="${t.breaks.length ? 'neg' : 'pos'}">${esc([sgn(t.dpsPct) && `${sgn(t.dpsPct)} damage`, sgn(t.ehpPct) && `${sgn(t.ehpPct)} effective HP`].filter(Boolean).join(', ') || 'a small gain')}</b>${t.breaks.length ? ` <span class="neg">but ${esc(t.breaks[0])}</span>` : ''}.</div>` : '';
    const shop = (r.shop || []).filter((x) => x.priceDiv != null).slice(0, 3);
    const first = shop.length > 1 ? `<div class="small">Best value first: ${shop.map((x) => `<b>${esc(x.rune)}</b> in your ${esc(x.slot)} (${x.priceDiv < 0.5 ? 'cheap' : `${n1(x.priceDiv)} div`})`).join(' · ')}.</div>` : '';
    return `<table class="kv runes"><tr><th>Socket</th><th>Now</th><th>Best for your build</th><th>Price</th></tr>${rows}</table>${tog}${first}
      <div class="dim small">At level ${r.level}. Hover a rune for what it does and the next best ones.${r.partial ? ' Ran out of time: some runes weren\'t tried.' : ''}</div>`;
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest && e.target.closest('#runeBtn');
    if (!b) return;
    b.disabled = true; b.innerHTML = '<span class="spinner"></span> Trying every rune…';
    const gen = charGen;
    const res = await window.api.runeCheck(!!runeLast).catch((err) => ({ ok: false, error: err.message || String(err) }));
    const btn = $('#runeBtn') || b;
    btn.disabled = false;
    if (gen !== charGen) { btn.textContent = 'Find the best runes'; return; } // for the character before
    runeLast = res;
    const out = $('#runeOut'); if (out) out.innerHTML = runeTable(runeLast);
    btn.textContent = 'Check again';
  });

  // search strings for the game's search box: vendors and stash (things you want), maps (mods you don't)
  const strOpts = { move: true, life: false, gems: false, links: false, res: null };
  async function renderStrings() {
    const box = $('#strBox'); if (!box) return;
    const g = await window.api.stringsGet();
    if (strOpts.res === null) strOpts.res = g.resShort; // start with the resistances you're short of
    const map = g.game === 'poe1' ? 'map' : 'waystone';
    const cb = (k, label) => `<label class="small"><input type="checkbox" data-str="${k}" ${strOpts[k] ? 'checked' : ''}> ${label}</label>`;
    const rcb = (el) => `<label class="small"><input type="checkbox" data-sres="${el}" ${strOpts.res.includes(el) ? 'checked' : ''}> ${el[0].toUpperCase() + el.slice(1)} res${g.resShort.includes(el) ? ' <small class="neg">short</small>' : ''}</label>`;
    const v = await window.api.stringsVendor({ ...strOpts });
    const line = (r, id) => (r.text ? `<div class="str-line"><code>${esc(r.text)}</code> <span class="dim small">${r.length}/${g.limit}</span> <button class="link" data-copy="${id}">Copy</button></div>${r.left.length ? `<div class="dim small">${r.left.length} more didn't fit: ${esc(r.left.join(', '))}</div>` : ''}` : '');
    box.innerHTML = `<h3>Search strings</h3>
      <div class="help">Paste into the search box in game (Ctrl+F at a vendor, in your stash or at the map device): matching items light up.</div>
      <h4 class="small">Vendors &amp; stash: things worth a look</h4>
      <div class="row wrap">${cb('move', 'Movement speed')}${['fire', 'cold', 'lightning'].map(rcb).join('')}${cb('life', 'Life')}${cb('gems', '+ gem levels')}${g.game === 'poe1' ? cb('links', '3 linked sockets') : ''}</div>
      ${line(v, 'v') || '<div class="dim small">Tick something to look for.</div>'}
      <h4 class="small">${map[0].toUpperCase() + map.slice(1)}s without your dangerous mods</h4>
      ${line(g.mapAvoid, 'm') || `<div class="dim small">Check a ${map} (hover it, press your hotkey) and click its mods to mark the dangerous ones: they show up here.</div>`}
      <div class="dim small">Each mod is cut to a short word, so check it lights up what you expect.</div>`;
    const texts = { v: v.text, m: g.mapAvoid.text };
    box.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => { window.api.copyText(texts[b.dataset.copy]); b.textContent = 'Copied'; }));
    box.querySelectorAll('[data-str]').forEach((c) => c.addEventListener('change', () => { strOpts[c.dataset.str] = c.checked; renderStrings(); }));
    box.querySelectorAll('[data-sres]').forEach((c) => c.addEventListener('change', () => { strOpts.res = strOpts.res.filter((x) => x !== c.dataset.sres).concat(c.checked ? [c.dataset.sres] : []); renderStrings(); }));
  }

  function noPobHtml(d, st) {
    const why = !d.hasBuild ? 'Paste your Path of Building export on <b>My gear</b> and this page shows your whole character: damage (or your minions\'), defences, resistances against the cap, the biggest hits you can take, ' + (st && st.game === 'poe1' ? 'mana and life reservation' : 'Spirit') + ', attributes, skills and passive tree.'
      : !d.enabled ? 'Path of Building is switched off on My gear (<i>Judge items with Path of Building</i>). Switch it on to see your character sheet.'
        : !d.available ? 'The Path of Building engine isn\'t included with this copy of the app.' : 'Path of Building isn\'t available right now.';
    const rs = d.resists;
    const res = rs ? card('Resistances (from My gear)', resBars(['fire', 'cold', 'lightning', 'chaos'].filter((el) => rs[el] != null).map((el) => ({ el: el[0].toUpperCase() + el.slice(1), value: Math.min(rs[el], (rs.caps && rs.caps[el]) || rs.cap || 75), total: rs[el], over: rs[el] - ((rs.caps && rs.caps[el]) || rs.cap || 75), max: (rs.caps && rs.caps[el]) || rs.cap || 75 })), false)) : '';
    const gs = st.gearScores || {};
    const gear = card('Gear', table(SLOT_ORDER.map((slot) => { const it = (st.equipped || {})[slot]; const g = gs[slot]; return it ? row(slot, `${esc(it.name)}${g && g.score != null ? ` <span class="gs g-${esc(g.grade)}">${g.score} ${esc(g.grade)}</span>` : ''}`) : ''; })));
    return `<div class="card-p"><h3>Your character sheet</h3><div class="help">${why}</div><div class="row"><button class="primary" data-goto="gear">Go to My gear</button></div></div><div class="grid g-cards">${res}${gear}<div class="card-p" id="strBox"></div></div>`;
  }

  document.querySelector('.tabs button[data-tab="char"]').addEventListener('click', () => render(false));
  $('#charRefresh').addEventListener('click', () => render(true));
  // keep it current while it's open (gear copied, build changed, character switched)
  window.api.onChanged(() => { charGen++; anointLast = null; runeLast = null; if ($('#tab-char').classList.contains('active')) render(false); });
  window.renderCharacter = render;
})();
