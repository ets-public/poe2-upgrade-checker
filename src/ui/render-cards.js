'use strict';

// Shared renderer: the map / waystone card, and the comparison itself (window.renderComparison).

(function () {
  const R = window.RENDER = window.RENDER || {}; // helpers shared by the render files
  const MAPICON = { danger: '☠', warn: '⚠', ok: '✓', info: '·' };
  const NEXT = { '': 'd', d: 'w', w: 'g', g: '' };
  window.renderMapCard = function (el, r, opts) {
    opts = opts || {};
    const it = r.item || {};
    const c = r.check || { rows: [] };
    // without a build only your own marks can say anything: no "looks fine" for mods nobody checked
    const [vt, vc] = r.noBuild && c.verdict === 'ok' && !(c.rows || []).some((m) => m.mark) ? ['NOT CHECKED', 'same'] : R.MAPV[c.verdict] || R.MAPV.ok;
    const tier = (it.lines || []).map((l) => l.text || '').find((t) => /^(Map|Waystone) Tier:/i.test(t));
    el.innerHTML = `<div class="card map-card">
        <div class="name ${R.esc((it.rarity || '').toLowerCase())}">${R.esc(it.name || '')}</div>
        <div class="meta">${R.esc(it.baseType && it.baseType !== it.name ? it.baseType + ' · ' : '')}${R.esc(tier || it.itemClass || '')}</div>
        ${opts.closable ? '<button class="x" id="closeBtn" title="Close">×</button>' : ''}
        <div class="verdict ${vc}"><span class="badge">${vt}</span>${c.all ? `<span class="dim">for your build: ${R.esc(c.all.text)}</span>` : ''}</div>
        ${r.pending ? '<div class="note"><span class="spinner"></span> Checking the mods with Path of Building…</div>' : ''}
        ${r.noBuild ? '<div class="dim small">Load your Path of Building build on My gear and each mod is worked out for your character.</div>' : ''}
        ${r.pobError ? `<div class="note">${R.esc(r.pobError)}</div>` : ''}
        ${c.summary && (c.summary.adds || c.summary.text) ? `<div class="small">${c.summary.adds ? `Adds <b>${R.esc(c.summary.adds)}</b>` : ''}${c.summary.adds && c.summary.text ? ': ' : ''}${c.summary.text ? `mods ${R.esc(c.summary.text)}` : ''}</div>` : ''}
        ${c.uses != null || (c.reward && c.reward.length) ? `<div class="dim small">${[c.uses != null ? `${c.uses} use${c.uses === 1 ? '' : 's'} left` : '', ...(c.reward || [])].filter(Boolean).map(R.esc).join(' · ')}</div>` : ''}
        <div class="map-mods">${(c.groups && c.groups.length > 1 ? c.groups : [{ rows: c.rows }]).map((g) => `${g.label ? `<div class="map-group">${R.esc(g.label)}</div>` : ''}${g.rows.map((m) => `<div class="map-mod lv-${R.esc(m.level)}" data-key="${R.esc(m.key)}" data-mark="${R.esc(m.mark || '')}" title="Click to mark this mod: dangerous → careful → fine → no mark">
            <span class="mi">${MAPICON[m.level] || '·'}</span><span class="mt">${R.esc(m.text)}${m.mark ? ' <small class="dim">(your mark)</small>' : ''}${m.note ? `<br><small class="${m.level === 'ok' ? 'dim' : ''}">${R.esc(m.note)}</small>` : ''}</span></div>`).join('')}`).join('') || '<div class="dim">No mods.</div>'}</div>
        ${c.extraLife ? `<div class="dim small">Monsters have about ${Math.round(c.extraLife)}% more life here: they take that much longer to kill.</div>` : ''}
        ${r.ninja ? window.ninjaLine(r.ninja) : ''}
        <div class="dim small">${c.calculated ? `${c.calculated} mod${c.calculated === 1 ? '' : 's'} worked out by Path of Building; ` : ''}click a mod to mark it dangerous, careful or fine for all your ${r.game === 'poe1' ? 'maps' : 'waystones and tablets'}.</div>
        <div class="actions"><button class="find" id="tradeWorth" title="What ${r.game === 'poe1' ? 'maps' : 'waystones'} like this sell for on the trade site">What's it worth?</button></div>
        <div class="note" id="findMsg"></div>
        <div class="sell-row"><button class="link" id="avoidBtn" title="Copies a search for the map device or stash that leaves out ${r.game === 'poe1' ? 'maps' : 'waystones'} with your dangerous mods">Copy a search that avoids dangerous mods</button><span class="dim small" id="avoidOut"></span></div>
        ${r.links && r.links.length ? `<div class="actions">${R.linksHtml(r.links)}</div>` : ''}
      </div>`;
    R.bindLinks(el);
    window.bindTradeWorth(el, it, opts);
    el.querySelectorAll('.map-mod').forEach((m) => m.addEventListener('click', () => window.api.mapMark(m.dataset.key, NEXT[m.dataset.mark || ''])));
    const av = el.querySelector('#avoidBtn');
    if (av) av.addEventListener('click', async () => {
      const res = await window.api.mapAvoid(c.rows.filter((m) => m.level === 'danger').map((m) => m.key));
      const out = el.querySelector('#avoidOut');
      out.textContent = res.text ? `Copied ${res.text}${res.left.length ? ` (${res.left.length} more didn't fit in the game's 50 letters)` : ''}. Paste it in the search box and check it highlights what you expect.` : 'Mark a mod as dangerous first (click it).';
      if (opts.onResize) opts.onResize();
    });
    const x = el.querySelector('#closeBtn');
    if (x) x.addEventListener('click', () => window.api.close());
  };

  // Popup / test view. Compact by default: item, verdict, gear score, top
  // changes and two buttons; "More" shows everything else.
  window.renderComparison = function (el, r, opts) {
    opts = opts || {};
    // which item is shown (a search answer for an item shown before it is dropped: see run below)
    el.dataset.shown = String((r && r.item && (r.item.id || r.item.name)) || '');
    const ui = (r && r.ui) || {};
    document.body.classList.toggle('cb', !!ui.colorblind);
    if (r && r.kind === 'price') return window.renderPriceCard(el, r, opts);
    if (r && r.kind === 'quickprice') return window.renderQuickPrice(el, r, opts);
    if (r && r.kind === 'map' && window.renderMapCard) return window.renderMapCard(el, r, opts);
    if (!r || !r.ok) {
      el.innerHTML = `<div class="card ${r && r.loading ? 'loading' : ''}">${opts.closable ? '<button class="x" id="closeBtn" title="Close">×</button>' : ''}
        <div class="note">${r && r.loading ? '<span class="spinner"></span> ' : ''}${R.esc((r && r.reason) || 'Nothing to show.')}</div></div>`;
      const c0 = el.querySelector('#closeBtn');
      if (c0) c0.addEventListener('click', () => window.api.close());
      return;
    }
    const it = r.item;
    const unique = /unique/i.test(it.rarity || '');
    const checking = !!(r.pobPending && !r.pob && !r.isEquipped);
    const v = checking ? { text: 'CHECKING…', cls: 'same checking' } : R.VERDICT[r.verdict] || R.VERDICT.same;
    const rarity = (it.rarity || '').toLowerCase();
    const full = opts.expanded || ui.detail === 'full';
    const gearMode = r.scoreMode === 'gear' || r.scoreMode === 'pob';
    // jewels judged by PoB: the search is for your tree's sockets, starting from this jewel
    const target = it.slot === 'Jewel' && r.pob && r.pob.socket && it.id ? { itemId: it.id } : ['Ring', 'Charm', 'Jewel'].includes(it.slot) ? it.slot : r.targetSlot;
    const budget = r.budgetLabel ? ' ' + r.budgetLabel.replace(/ \(.*\)$/, '') : '';

    const rowCls = (row) => {
      const useful = gearMode ? row.useful > 0 : row.weight !== 0;
      if (!useful) return 'unweighted';
      return row.diff > 0 ? 'pos' : 'neg';
    };
    const top = r.rows.filter((row) => (gearMode ? row.useful > 0 : row.weight)).slice(0, 4)
      .map((row) => `<span class="chg ${rowCls(row)}">${R.esc(R.label(row.key, row.diff))}</span>`).join('');

    const rows = r.rows.map((row) => `<tr class="${rowCls(row)}">
        <td class="stat" title="${R.esc(row.key)}">${R.esc(R.label(row.key, row.diff))}
          <span class="fromto">${R.esc(R.fmt(row.oldValue).replace('+', ''))} → ${R.esc(R.fmt(row.newValue).replace('+', ''))}</span></td>
        ${gearMode ? '' : `<td class="w"><input class="weight" type="number" step="0.1" value="${row.weight || ''}" placeholder="0" data-key="${R.esc(row.key)}" title="Weight for this stat"></td>
        <td class="imp">${row.weight ? R.esc(R.fmt(row.impact)) : ''}</td>`}
        <td class="ig"><button class="ignore" data-key="${R.esc(row.key)}" title="Ignore this stat (hide it from the score and from searches)">⊘</button></td>
      </tr>`).join('');

    const g = r.gear;
    const yours = r.gearEquipped && r.gearEquipped.score != null ? r.gearEquipped.score : null;
    const gearChip = g && g.score != null ? `<span class="gs g-${R.esc(g.grade)}" title="Gear score for ${R.esc(g.buildName || 'your build')}">${g.score} ${R.esc(g.grade)}</span>` : '';
    const gearLine = !g || r.pob || checking ? '' : g.unrated === 'unidentified' ? '<div class="dim">Unidentified – identify it to see its gear score.</div>'
      : g.unique ? '' : `<div class="gear">${gearChip}<span>gear score${yours != null ? ` · yours ${yours}` : ''}</span> <button class="link gear-why" data-why="p">why?</button></div>
        <div class="gear-detail hidden" data-whybox="p">${window.gearCompareHtml(g, r.isEquipped ? null : r.gearEquipped)}</div>`;

    const emptySlot = !r.replacing.length && !r.isEquipped && it.slot !== 'Flask';
    const craft = it.affixes && it.affixes.known && !unique ? `<div class="craft">${it.affixes.openPrefix || it.affixes.openSuffix
      ? `Open: <b>${it.affixes.openPrefix}</b> prefix${it.affixes.openPrefix === 1 ? '' : 'es'}, <b>${it.affixes.openSuffix}</b> suffix${it.affixes.openSuffix === 1 ? '' : 'es'} – craftable`
      : 'All 6 affixes taken'}</div>` : '';

    const flask = it.slot === 'Flask'; // PoE1 flasks: no slot of their own in the app
    const primary = unique
      ? `<button class="find" id="priceFind">What's it worth?</button><button id="likeFind" title="This unique on the trade site, cheapest first">Find cheaper copies</button>`
      : `${r.replacing.length && !flask ? `<button class="find" id="quickFind" title="Listings that score higher for your build than your equipped ${R.esc(r.targetSlot)}">Find upgrades${R.esc(budget)}</button>`
        : `<button class="find" id="likeFind" title="Listings with this item's stats">Find items like this${R.esc(budget)}</button>`}
         <button id="priceFind" title="What similar items sell for">What's it worth?</button>
         <button class="link" id="pricePick" title="Choose which stats the price check matches, and their minimums">Price by chosen stats…</button>`;

    const lossRows = r.isEquipped ? [] : r.pob ? (r.pob.resLoss || []) : ((r.character && r.character.res) || []).filter((x) => x.from != null && x.delta < 0 && x.under && (x.el !== 'chaos' || !x.wasUnder));
    const dmgLoss = !r.isEquipped && r.pob ? r.pob.dmgLoss : null;
    const named = ['resloss', 'dmgloss'].includes(r.verdict);
    const lossBanner = window.resLossBanner(lossRows, { plain: named }) + window.dmgLossBanner(dmgLoss, { plain: named });
    // keep / sell / vendor next to the price when there is one; KEEP needs no words under an upgrade
    const adv = window.keepSell && window.keepSell.advise(r);
    const advWord = adv && r.ninja && (adv.action === 'sell' || adv.action === 'vendor') ? (adv.action === 'sell' ? 'worth selling' : 'not worth selling') : null;
    const adviceBlock = advWord || (adv && adv.action === 'keep' && !adv.text) ? '' : window.adviceHtml(r);
    el.innerHTML = `
      <div class="card ${lossRows.length || dmgLoss ? 'res-loss' : ''}">
        <div class="name ${R.esc(rarity)}">${R.esc(it.name || '')}</div>
        <div class="meta">${it.baseType && it.baseType !== it.name ? `${R.esc(it.baseType)} · ` : ''}${R.esc(it.itemClass || '')}${it.itemLevel ? ` · ilvl ${it.itemLevel}` : ''}</div>
        ${opts.closable ? '<button class="x" id="closeBtn" title="Close">×</button>' : ''}
        ${unique && !r.pob ? `<div class="verdict same"><span class="badge">UNIQUE</span>${r.replacing.length && !r.isEquipped ? `<span class="dim">vs ${R.esc(r.replacing.join(' + '))}</span>` : ''}</div>
          <div class="dim">${r.pobPending ? 'Checking with Path of Building…' : r.game === 'poe1' ? 'Load your Path of Building Community build on My gear to see what it does for your build – or check its price.' : "Uniques have fixed mods, so there's no gear score – check its price, or compare the changes below."}</div>`
          : `<div class="verdict ${v.cls}">
          <span class="badge">${v.text}</span>
          ${r.isEquipped || emptySlot || checking ? '' : R.scoreHtml(R.pointsLabel(r))}
          ${r.isEquipped ? '' : r.replacing.length ? `<span class="dim">vs ${R.esc(r.replacing.join(' + '))}</span>` : r.verdict === 'unjudged' ? '' : it.slot === 'Flask' ? (r.pobPending ? '<span class="dim">trying it in your flask slots</span>' : '') : `<span class="dim">${R.esc(r.targetSlot)} slot is empty</span>`}
        </div>`}
        ${r.savedAs ? `<div class="auto-saved small">${r.savedAs.same ? `✓ Already saved as your ${R.esc(r.savedAs.slot)}` : `✓ Saved as your ${R.esc(r.savedAs.slot)}${r.savedAs.was ? ` (was ${R.esc(r.savedAs.was)})` : ''} <button class="link" id="equipUndo">Undo</button>`}</div>` : ''}
        ${r.savePick ? `<div class="auto-saved small">Which one is it? Click <b>Set as …</b> below (both slots hold other items).</div>` : ''}
        ${r.autoSaved ? `<div class="auto-saved small" title="It's the item you have saved as your ${R.esc(r.autoSaved.slot)} (same base, item level${rarity === 'rare' || unique ? ' and name' : ' and mods'}), changed since. The verdict above is against your gear before this change.">✓ Saved as your ${R.esc(r.autoSaved.slot)}: it changed since you last saved it</div>` : ''}
        ${lossBanner}
        ${r.ninja ? window.ninjaLine(r.ninja, advWord) : ''}
        ${adviceBlock}
        ${window.sellHtml(r)}
        ${gearLine}
        ${craft}
        ${r.flaskNote ? `<div class="dim small">${R.esc(r.flaskNote)}</div>` : ''}${r.limitNote ? `<div class="dim small">${R.esc(r.limitNote)}</div>` : ''}
        ${r.isEquipped ? `<div class="note">This is your equipped ${R.esc(r.targetSlot)}.</div>` : ''}
        ${top && !r.isEquipped ? `<div class="chgs">${top}</div>` : ''}
        ${r.unjudged && !r.pobNudge && !r.pob ? `<div class="note">${R.esc(r.unjudged)}</div>` : ''}
        ${r.pobNudge && !r.isEquipped ? (r.game === 'poe1'
    ? '<div class="note">PoE1 items are judged by Path of Building: paste your <b>Path of Building Community</b> export on <b>My gear</b> (this character is your PoE1 one).</div>'
    : '<div class="dim small">For exact verdicts, paste your Path of Building export on <b>My gear</b>.</div>') : ''}
        ${r.isEquipped ? '' : r.pob || r.pobPending || r.pobError ? window.pobBlock(r.pob, { pending: r.pobPending, error: r.pobError, compact: !full, noBanner: true, lossShown: true, flask: it.slot === 'Flask' }) : window.characterBlock(r.character, { compact: !full, risks: r.risks, noBanner: true })}
        ${r.notes.filter((n) => !/^Nothing saved/.test(n) || (!emptySlot && it.slot !== 'Flask')).filter((n) => full || /unidentified|two-handed|Two-handed/i.test(n)).map((n) => `<div class="note">${R.esc(n)}</div>`).join('')}
        ${emptySlot ? `<div class="actions">${R.equipButtons(r)}</div>` : ''}
        <div class="actions main-actions">${primary}</div>
        ${r.league ? `<div class="dim small league-line">League: <b>${R.esc(r.league)}</b> · <button class="link" id="leagueChange" title="Searches and prices use this league (each game has its own)">change</button></div>` : ''}
        <div class="price-pick hidden" id="pricePickBox"></div>
        <div class="note" id="findMsg"></div>
        <button class="link more" id="moreBtn">${full ? 'Less ▴' : 'More ▾'}</button>
        <div class="more-box ${full ? '' : 'hidden'}" id="moreBox">
          ${r.ignoring && r.ignoring.length ? `<div class="dim">Ignoring: ${R.esc(r.ignoring.join(', '))} <button class="link" id="ignoreChange">change</button></div>` : ''}
          ${!full ? r.notes.filter((n) => !/unidentified|two-handed/i.test(n) && !(it.slot === 'Flask' && /^Nothing saved/.test(n))).map((n) => `<div class="note">${R.esc(n)}</div>`).join('') : ''}
          ${(it.lines || []).some((l) => l.tier != null) ? `<div class="mods-tiers"><div class="dim small">Mods and tiers</div>${window.modsHtml(it.lines)}</div>` : ''}
          ${r.isEquipped ? '' : rows ? `<table class="rows"><thead><tr><th>Change</th>${gearMode ? '' : '<th>Weight</th><th>Score</th>'}<th></th></tr></thead><tbody>${rows}</tbody></table>`
            : '<div class="note">No stat differences.</div>'}
          ${r.isEquipped || emptySlot || it.slot === 'Flask' ? '' : `<div class="actions">${R.equipButtons(r)}</div>`}
          <div class="more-searches"><span class="dim small">More searches:</span>
            ${r.replacing.length && !r.isEquipped && !unique ? '<button class="link" id="likeFind2" title="Listings with the stats of the item you just copied">Like this item</button>' : ''}
            ${r.replacing.length && !unique ? `<button class="link" id="sameFind" title="Listings with every stat of your equipped item at your value or higher">As good as my ${R.esc(r.targetSlot || 'item')}</button>` : ''}
            ${r.replacing.length && !gearMode ? '<button class="link" id="weightFind" title="Listings that beat your equipped item by your stat weights">By my weights</button>' : ''}
            ${!unique && it.slot ? '<button class="link" id="craftFind" title="Bases with your key stats and an open affix to craft">Craftable bases</button>' : ''}
            <button class="link" id="customFind" title="Pick which of this item\'s stats to search for">Pick stats…</button>
          </div>
          <div class="actions">
            ${R.linksHtml(r.links)}
            ${opts.closable ? '<button class="link" id="settingsBtn">Settings</button>' : ''}
          </div>
        </div>
      </div>`;

    const resize = () => opts.onResize && opts.onResize();
    const msgEl = () => el.querySelector('#findMsg');
    // a search's answer belongs to the item it was asked for: a redraw of the same item (Path of
    // Building answered, a setting changed) shows it again, working buttons and all; another item
    // shown meanwhile never gets it
    const shownKey = String(it.id || it.name || '');
    el.dataset.shown = shownKey;
    const run = (btn, fn, busy) => btn && btn.addEventListener('click', async () => {
      el.__search = { key: shownKey, busy, btn: btn.id };
      btn.disabled = true; msgEl().innerHTML = `<span class="spinner"></span> ${busy}`;
      resize();
      let res;
      try { res = await fn(); } catch (err) { res = { ok: false, error: (err && err.message) || String(err) }; }
      if (el.dataset.shown !== shownKey) return; // another item is shown now
      el.__search = { key: shownKey, res };
      const b = (btn.id && el.querySelector('#' + btn.id)) || btn;
      b.disabled = false;
      if (msgEl()) window.showSearchResult(msgEl(), res);
      resize();
    });
    const ref = it.id ? { itemId: it.id } : '__last';
    const undo = el.querySelector('#equipUndo');
    if (undo) undo.addEventListener('click', async () => { undo.disabled = true; const ok = await window.api.equipUndo(); if (ok) { undo.parentElement.textContent = 'Undone: your saved item is back.'; resize(); } });
    run(el.querySelector('#quickFind'), () => window.api.quickFind(target, 'upgrade'), 'Searching the trade site…');
    run(el.querySelector('#sameFind'), () => window.api.quickFind(target, 'similar'), 'Searching the trade site…');
    run(el.querySelector('#weightFind'), () => window.api.quickFind(target, 'weights'), 'Searching the trade site…');
    run(el.querySelector('#likeFind'), () => window.api.quickFind(ref, 'similar'), 'Searching the trade site…');
    run(el.querySelector('#likeFind2'), () => window.api.quickFind(ref, 'similar'), 'Searching the trade site…');
    run(el.querySelector('#craftFind'), () => window.api.quickFind(ref, 'craft'), 'Looking for craftable bases…');
    // a price check also answers keep / sell / vendor
    const withWorth = (p) => p.then((res) => {
      if (el.dataset.shown === shownKey && res && res.ok && res.summary && res.summary.typicalEx != null) { r.worthEx = res.summary.typicalEx; const a = el.querySelector('#advice'); if (a) a.outerHTML = window.adviceHtml(r); }
      return res;
    });
    run(el.querySelector('#priceFind'), () => withWorth(window.api.priceCheck(ref)), 'Checking prices…');
    // "Choose stats…": tick the stats the price check should match, with their minimums
    const pp = el.querySelector('#pricePick');
    if (pp) pp.addEventListener('click', async () => {
      const box = el.querySelector('#pricePickBox');
      if (!box.classList.contains('hidden')) { box.classList.add('hidden'); resize(); return; }
      const f = await window.api.findRows(ref);
      const rows = ((f && f.rows) || []).filter((x) => x.source !== 'base' || /^\[(Base|Weapon)\]/.test(x.key));
      if (!rows.length) { msgEl().textContent = 'No stats to choose from.'; resize(); return; }
      // the trade site's totals: one "total elemental resistance" counts fire, cold, lightning and all-res mods alike
      const ele = { fire: 1, cold: 1, lightning: 1 };
      let resSum = 0; let resRows = 0;
      for (const x of rows) {
        const k = String(x.key); const v = Number(x.value) || 0;
        if (x.source === 'socket' || x.source === 'base') continue;
        if (/^\+?#% to all Elemental Resistances$/i.test(k)) { resSum += 3 * v; resRows++; continue; }
        const m = k.match(/^\+?#% to (Fire|Cold|Lightning)(?: and (Fire|Cold|Lightning))? Resistances?$/i);
        if (m && ele[m[1].toLowerCase()]) { resSum += (m[2] ? 2 : 1) * v; resRows++; x.inTotal = true; }
        if (/all Elemental Resistances/i.test(k)) x.inTotal = true;
      }
      if (resRows >= 2 && resSum > 0) rows.unshift({ key: 'Total elemental resistance', id: 'pseudo.pseudo_total_elemental_resistance', idType: 'pseudo', value: resSum, total: true });
      box.innerHTML = `<div class="dim small">Match these stats (at least the value shown):</div>
        <div class="pp-presets"><span class="dim small">Minimums:</span> <button class="link" data-pct="0.8">80%</button> <button class="link" data-pct="0.9">90%</button> <button class="link" data-pct="1">100%</button></div>
        ${rows.map((x, i) => `<label class="pp-row"><input type="checkbox" data-i="${i}" ${x.source === 'socket' || x.inTotal ? '' : 'checked'}> <span title="${R.esc(x.key)}">${x.total ? `<b>${R.esc(x.key)}</b> (%)` : `${R.esc(R.statName(x.key))}${/#%/.test(x.key) ? ' (%)' : ''}`}</span>
          <input type="number" class="num pp-min" data-i="${i}" value="${R.esc(Math.floor(Number(x.value) * 10) / 10)}" step="any"></label>`).join('')}
        <div class="actions"><button class="find" id="pricePickGo">Price with these</button></div>`;
      box.classList.remove('hidden');
      box.querySelectorAll('[data-pct]').forEach((b) => b.addEventListener('click', () => {
        rows.forEach((x, i) => { const inp = box.querySelector(`.pp-min[data-i="${i}"]`); if (inp) inp.value = Math.floor(Number(x.value) * Number(b.dataset.pct) * 10) / 10; });
      }));
      resize();
      run(box.querySelector('#pricePickGo'), () => {
        const picks = rows.map((x, i) => ({ x, on: box.querySelector(`input[type=checkbox][data-i="${i}"]`).checked, min: box.querySelector(`.pp-min[data-i="${i}"]`).value }))
          .filter((p) => p.on).map((p) => ({ key: p.x.key, min: p.min === '' ? null : Number(p.min), source: p.x.source, id: p.x.id, idType: p.x.idType }));
        if (!picks.length) return Promise.resolve({ ok: false, error: 'Tick at least one stat.' });
        return withWorth(window.api.priceCheck(ref, picks));
      }, 'Checking prices…');
    });
    window.__popupResize = opts.onResize || null;
    window.bindGearWhy(el);
    R.bindLinks(el);
    window.bindSell(el, r);
    const mb = el.querySelector('#moreBtn');
    if (mb) mb.addEventListener('click', () => {
      const box = el.querySelector('#moreBox');
      box.classList.toggle('hidden');
      mb.textContent = box.classList.contains('hidden') ? 'More ▾' : 'Less ▴';
      if (opts.onToggle) opts.onToggle(!box.classList.contains('hidden'));
      resize();
    });
    const cf = el.querySelector('#customFind');
    if (cf) cf.addEventListener('click', () => window.api.findUpgrade(ref));
    const lc = el.querySelector('#leagueChange');
    if (lc) lc.addEventListener('click', () => window.api.openSettingsTab && window.api.openSettingsTab('league'));
    const ic = el.querySelector('#ignoreChange');
    if (ic) ic.addEventListener('click', () => window.api.openSettingsTab && window.api.openSettingsTab('search'));
    el.querySelectorAll('button.ignore').forEach((b) => b.addEventListener('click', async () => {
      const st = await window.api.getState();
      const rules = (st.settings.ignoreStats || []).filter((x) => x.key !== b.dataset.key);
      rules.push({ key: b.dataset.key, mode: 'ignore' });
      await window.api.setIgnore(rules); // the popup re-renders itself
      if (opts.onChange) opts.onChange();
    }));
    el.querySelectorAll('input.weight').forEach((inp) => {
      inp.addEventListener('change', () => window.api.setWeight(inp.dataset.key, inp.value).then(() => opts.onChange && opts.onChange()));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    });
    el.querySelectorAll('button.equip').forEach((b) => {
      b.addEventListener('click', async () => {
        await window.api.equip(b.dataset.slot, it.id ? { itemId: it.id } : (opts.itemText || null));
        b.textContent = `Saved as ${b.dataset.slot} ✓`;
        b.disabled = true;
        if (opts.onChange) opts.onChange();
      });
    });
    const c = el.querySelector('#closeBtn');
    if (c) c.addEventListener('click', () => window.api.close());
    const s = el.querySelector('#settingsBtn');
    if (s) s.addEventListener('click', () => window.api.openSettings());
    // this item's search from before the redraw: still running (spinner, button off) or its answer
    const prev = el.__search;
    if (prev && prev.key === shownKey && msgEl()) {
      if (prev.res) window.showSearchResult(msgEl(), prev.res);
      else { msgEl().innerHTML = `<span class="spinner"></span> ${prev.busy}`; const pb = prev.btn && el.querySelector('#' + prev.btn); if (pb) pb.disabled = true; }
    } else el.__search = null;
  };
})();
