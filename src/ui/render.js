'use strict';

// Shared renderer for a comparison result, used by the popup, the results window and the settings
// window ("Check an item"). Split over render*.js (loaded in order): this one has the shared
// helpers, item mods and search results; render-blocks.js the character, Path of Building and gear
// score blocks; render-prices.js the price cards; render-cards.js the map card and the comparison
// itself (window.renderComparison).

(function () {
  const R = window.RENDER = window.RENDER || {}; // helpers shared by the render files
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => {
    const r = Math.round(n * 100) / 100;
    return (r > 0 ? '+' : '') + (Number.isInteger(r) ? r : r.toFixed(1));
  };

  function label(key, diff) {
    key = String(key).replace(/^\[Base\]\s*/, '').replace(/\s*\(Local\)\s*$/i, ''); // internal tags, not game text
    if (!key.includes('#')) return `${fmt(diff)} ${key}`;
    let first = true;
    // "+# to x" style keys: put the signed diff in the first #, leave other #s as "…"
    return key.replace(/#/g, () => { if (first) { first = false; return fmt(diff); } return '…'; })
      .replace(/^\+\+/, '+').replace(/^\+-/, '-');
  }

  // a trade stat's template as a name: "# to maximum Life" -> "Maximum Life", "#% increased Energy Shield" -> "Increased Energy Shield"
  function statName(key) {
    let t = String(key).replace(/^\[(Base|Weapon)\]\s*/, '').replace(/\s*\(Local\)\s*$/i, '');
    t = t.replace(/^[+-]?#%?\s*(to\s+)?/i, '').replace(/#%?/g, '…').trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : String(key);
  }
  window.statName = statName;
  // an item's mods, each with its tier (T1 is the best) and how high it rolled, when the game said (advanced copy)
  window.modsHtml = function (lines) {
    return (lines || []).filter((l) => l.tag !== 'info').map((l) => {
      const t = l.tier != null ? `<span class="tier ${l.tier <= 2 ? 'tier-top' : l.tier <= 4 ? 'tier-mid' : 'tier-low'}" title="${esc(l.affix ? `"${l.affix}", ` : '')}tier ${l.tier} (T1 is the best)">T${esc(l.tier)}</span>` : '';
      const roll = l.roll != null ? ` <span class="dim small" title="How high in its range it rolled">${esc(l.roll)}%</span>` : '';
      return `<div class="mod ${esc(l.tag)}">${t}${esc(l.text)}${roll}</div>`;
    }).join('');
  };
  const VERDICT = {
    upgrade: { text: 'UPGRADE', cls: 'up' },
    small: { text: 'SMALL UPGRADE', cls: 'up' },
    risky: { text: 'UPGRADE ⚠', cls: 'risky' },
    resloss: { text: 'LOSES RESISTANCE', cls: 'down' },
    dmgloss: { text: 'LOSES DAMAGE', cls: 'down' },
    downgrade: { text: 'DOWNGRADE', cls: 'down' },
    same: { text: 'SIDEGRADE', cls: 'same' },
    new: { text: 'EMPTY SLOT', cls: 'new' },
    equipped: { text: 'EQUIPPED', cls: 'same' },
    unjudged: { text: 'NOT JUDGED', cls: 'same' },
  };

  function equipButtons(r) {
    const item = r.item;
    let slots;
    const groups = (r.slots && r.slotGroups) || {};
    if (groups[item.slot]) slots = groups[item.slot];
    else if (item.slot === 'Ring') slots = ['Ring 1', 'Ring 2'];
    else slots = [item.slot];
    return slots.map((s) => `<button class="equip" data-slot="${esc(s)}">Set as ${esc(s)}</button>`).join('');
  }

  // Shows the outcome of a trade search in `el` (text + "open anyway" link).
  window.showSearchResult = function (el, res) {
    if (!res) { el.textContent = ''; return; }
    if (!res.ok) { el.textContent = res.error || 'Search failed.'; return; }
    const where = `${res.league}${res.budget ? ', ' + res.budget : ''}`;
    let t;
    if (res.total === 0) {
      t = `No listings found (${where}).`;
      if (res.mode === 'price') t += ' Nothing similar is listed – it may be rare (or worth little).';
      else if (res.mode === 'craft') t += ' No rare base with those stats and an open affix right now – try a higher price limit.';
      else if (res.mode === 'similar') t += ` Even at ${res.levelLabel || 'looser values'} with ${res.need} of ${res.of} stats nothing is listed – try a higher price limit, or Custom search and untick a stat.`;
      else if (res.mode === 'weights') t += ' Nothing scores higher with your weights – check they suit your build.';
      else if (res.mode === 'pob') t += ' Nothing is listed in your price range with the stats Path of Building looked for – try a higher price limit.';
      else if (res.mode === 'gear') t += ` Nothing listed is better for your build${res.score != null ? ` than your gear score ${res.score}` : ''}, even within 10% – try a higher price limit.`;
      else t += ' Untick a stat or lower some minimums.';
    } else {
      t = `${res.inApp ? 'Showing in the results window' : res.opened ? 'Opened in your browser' : 'Search ready'} (${where})${res.total != null ? ` – ${res.total} listing${res.total === 1 ? '' : 's'}` : ''}.`;
      if (res.mode === 'price' && res.summary && res.summary.typical) {
        // the answer first, big; the details small under it
        const sm = res.summary;
        el.innerHTML = `<div class="price-answer">≈ <b>${esc(sm.typical)}</b>${window.confHtml(sm.confidence)}</div>${sm.sell ? `<div class="sell-row"><span class="dim small">List it at</span> <b>${esc(sm.sell.text)}</b> <button class="link" data-note="${esc(sm.sell.note)}" title="Copies &quot;${esc(sm.sell.note)}&quot;: right-click the item in a premium stash tab and paste it into the note">Copy price note</button></div>` : ''}<div class="dim small">${[sm.range ? `most ${esc(sm.range)}` : '', `${esc(res.total)} similar listed`, sm.cheapest && !sm.range ? `cheapest ${esc(sm.cheapest)}` : '', res.level > 0 ? `compared with ${esc(res.levelLabel)}` : ''].filter(Boolean).join(' · ')}${sm.notes && sm.notes.length ? `. ${esc(sm.notes.join('; '))}` : ''}</div>${window.soldHtml ? window.soldHtml(sm.sold) : ''}${window.priceFeedbackHtml ? window.priceFeedbackHtml(sm.caseId) : ''}`;
        const cp = el.querySelector('[data-note]');
        if (cp) cp.addEventListener('click', () => { window.api.copyText(cp.dataset.note); cp.textContent = 'Copied'; });
        if (window.bindPriceFeedback) window.bindPriceFeedback(el);
        return;
      }
      if (res.mode === 'price' && res.summary) {
        const sm = res.summary;
        t = `${sm.verdict || ''} ${res.total} similar listed.${sm.notes && sm.notes.length ? ` Note: ${sm.notes.join('; ')}.` : ''}`;
      }
      if (res.mode === 'price' && res.level > 0) t += ` Compared with ${res.levelLabel}.`;
      if (res.mode === 'craft' && res.keyStats) t += ` Rare bases with ${res.keyStats.join(' + ')} and an open affix to craft.`;
      if (res.mode === 'similar' && res.of) {
        t += res.unique ? ` Same unique${res.need ? `, ${res.need} of ${res.of} mods at ${res.levelLabel}` : ''}.` : ` At least ${res.need} of your ${res.of} stats at ${res.levelLabel}.`;
        if (res.level > 0) t += ' (Loosened: nothing matched your exact values.)';
      }
      if (res.mode === 'gear') t += res.level === 1 ? ' No clear upgrade listed; these are a little better than yours.' : res.level > 1 ? ` Nothing beats yours yet; these come close (${res.levelLabel}).` : ` Clearly better for your build than yours${res.score != null ? ` (gear score ${res.score})` : ''} – best for your build first.`;
      if (res.fallback) t = "The trade site didn't answer the search (it may be busy or down). Try again in a moment, or open it on the trade site.";
    }
    if (res.skipped && res.skipped.length) t += ` ${res.skipped.length} rune bonus${res.skipped.length === 1 ? '' : 'es'} left out (you can socket your own).`;
    if (res.ignored && res.ignored.length) t += ` Ignored: ${res.ignored.length} stat${res.ignored.length === 1 ? '' : 's'}.`;
    if (res.excluded) t += ' Listings with your excluded stats are hidden.';
    if (res.unmatched && res.unmatched.length) t += ` Not searchable: ${res.unmatched.join(', ')}.`;
    el.textContent = t;
    if (res.url && !res.opened) {
      const a = document.createElement('button');
      a.className = 'link'; a.textContent = res.fallback ? 'Open on trade site' : 'Open on trade site anyway';
      a.addEventListener('click', () => window.api.openUrl(res.url));
      el.appendChild(document.createTextNode(' ')); el.appendChild(a);
    }
  };

  Object.assign(R, { esc, fmt, label, statName, VERDICT, equipButtons });
})();
