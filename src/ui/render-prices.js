'use strict';

// Shared renderer: scores, poe.ninja prices and trends, selling advice, the price card, the F3 price
// popup and gem prices.

(function () {
  const R = window.RENDER = window.RENDER || {}; // helpers shared by the render files
  // the number in carved type, the words after it in plain text ("+26.8%" + "for your build")
  const POB_TIP = "Path of Building's score for this item: the % change to your damage and effective HP (weighted as set on Build &amp; stats), plus half a point per resistance point toward your cap";
  window.POB_SCORE_TIP = POB_TIP;
  function scoreHtml(label) {
    if (!label) return '';
    const m = String(label).match(/^([+\-−]?[\d.,]+%?)\s*(.*)$/);
    const tip = / pts /.test(label) ? ` title="${POB_TIP}"` : '';
    return m ? `<span class="score"${tip}>${R.esc(m[1])}${m[2] ? ` <small>${R.esc(m[2])}</small>` : ''}</span>` : `<span class="score"${tip}>${R.esc(label)}</span>`;
  }

  function pointsLabel(r) {
    // a loss verdict with a positive score would read like an upgrade: the banner says what it costs
    if (r.scoreMode === 'pob') return r.delta == null || ((r.verdict === 'dmgloss' || r.verdict === 'resloss') && r.delta > 0) ? '' : `${r.delta > 0 ? '+' : ''}${r.delta} pts for your build`;
    if (r.scoreMode === 'gear') {
      if (r.delta == null) return '';
      return `${r.delta > 0 ? '+' : ''}${r.delta} gear score`;
    }
    if (r.delta == null || r.verdict === 'unjudged') return '';
    const pct = r.pct == null ? '' : ` (${R.fmt(r.pct)}%)`;
    return `${R.fmt(r.delta)}${pct}`;
  }

  // a poe.ninja price: "≈ 0.8 div (120 ex)", or just ex/chaos below a divine
  const nf = (v) => (v == null ? '' : Number(v).toLocaleString('en', { maximumFractionDigits: v >= 100 ? 0 : v >= 10 ? 1 : 2 }));
  function ninjaPrice(p, total) {
    if (!p) return '';
    const v = total ? p.total : p.each; const d = total ? p.totalDiv : p.eachDiv;
    const c = total ? p.totalChaos : p.eachChaos; const ch = c != null && c > 0 ? `${nf(c)} chaos` : '';
    if (d != null && d >= 1) return `≈ <b>${nf(d)} div</b>${v != null || ch ? ` <span class="dim">(${[v != null ? `${nf(v)} ${R.esc(p.unit)}` : '', ch].filter(Boolean).join(' · ')})</span>` : ''}`;
    return v != null ? `≈ <b>${nf(v)} ${R.esc(p.unit)}</b>${(d != null && d >= 0.01) || ch ? ` <span class="dim">(${[d != null && d >= 0.01 ? `${nf(d)} div` : '', ch].filter(Boolean).join(' · ')})</span>` : ''}` : '';
  }
  function trend(p) {
    if (!p || p.change == null) return '';
    const c = p.change; const cls = c > 2 ? 'pos' : c < -2 ? 'neg' : 'unweighted';
    return `<span class="chg ${cls}" title="Change over the last 7 days on poe.ninja">7 days ${c > 0 ? '+' : ''}${nf(c)}%</span>`;
  }
  // the last 7 days on poe.ninja as a small line (relative prices, 1 = today)
  window.sparkHtml = function (p, w, h) {
    const hst = p && Array.isArray(p.history) ? p.history : [];
    const pts = hst.map((v, i) => [i, v]).filter(([, v]) => v != null && Number.isFinite(v));
    if (pts.length < 2) return '';
    w = w || 120; h = h || 28;
    const lo = Math.min(...pts.map(([, v]) => v)); const hi = Math.max(...pts.map(([, v]) => v));
    const span = hi - lo || 1; const n = Math.max(hst.length - 1, 1);
    const xy = pts.map(([i, v]) => `${Math.round((i / n) * (w - 4) + 2)},${Math.round(h - 3 - ((v - lo) / span) * (h - 6))}`).join(' ');
    const up = pts[pts.length - 1][1] >= pts[0][1];
    const unit = (v) => (p.each != null ? `${nf(p.each * v)} ${p.unit}` : `${nf(v * 100)}%`);
    return `<svg class="spark ${up ? 'spark-up' : 'spark-down'}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Price over the last 7 days, from ${R.esc(unit(pts[0][1]))} to ${R.esc(unit(1))}"><title>Last 7 days on poe.ninja: ${R.esc(unit(lo))} to ${R.esc(unit(hi))}</title><polyline points="${xy}" fill="none" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  };
  window.ninjaLine = function (p, advice) {
    if (!p) return '';
    if (advice) return `<div class="ninja">${ninjaPrice(p)} <span class="adv-inline">· ${R.esc(advice)}</span> ${trend(p)}${window.sparkHtml(p, 56, 14)}${p.unsure ? ` <span class="dim">price of the ${R.esc(p.variant || 'most common')} version?</span>` : ''}</div>`;
    return `<div class="ninja"><span class="pob-tag" title="poe.ninja, ${R.esc(p.league || '')}">NINJA</span> ${ninjaPrice(p)} ${trend(p)}${window.sparkHtml(p, 56, 14)}${p.few ? ' <span class="dim" title="Few listed: the price is a rough guess">few listed</span>' : ''}${p.unsure ? ` <span class="dim" title="This unique comes in several versions and the app can't tell which one this is">price of the ${R.esc(p.variant || 'most common')} version?</span>` : ''}</div>`;
  };
  const linksHtml = (links) => (links || []).map((l) => `<button class="link info-link" data-url="${R.esc(l.url)}">${R.esc(l.label)}</button>`).join('');
  const bindLinks = (el) => el.querySelectorAll('.info-link').forEach((b) => b.addEventListener('click', () => window.api.openUrl(b.dataset.url)));

  // keep / sell / vendor, under the verdict
  const ADV = { keep: ['KEEP', 'up'], sell: ['SELL', 'sell'], vendor: ['VENDOR', 'same'], check: ['PRICE CHECK', 'risky'] };
  // selling helper: a price a little under poe.ninja and a price note to paste into a premium stash tab
  window.sellHtml = function (r) {
    if (!r.sellNote) return '';
    const a = window.keepSell && window.keepSell.advise(r);
    if (a && (a.action === 'vendor' || a.action === 'keep')) return '';
    return `<div class="sell-row"><span class="dim small">List it at</span> <b>${R.esc(r.sellNote.text)}</b> <button class="link" id="copySell" title="Copies &quot;${R.esc(r.sellNote.note)}&quot;: right-click the item in a premium stash tab and paste it into the note">Copy price note</button></div>`;
  };
  window.bindSell = function (el, r) {
    const b = el.querySelector('#copySell');
    if (b) b.addEventListener('click', () => { window.api.copyText(r.sellNote.note); b.textContent = 'Copied'; });
  };
  window.adviceHtml = function (r) {
    const a = window.keepSell && window.keepSell.advise(r);
    if (!a) return '<div class="advice" id="advice"></div>';
    const [t, c] = ADV[a.action];
    return `<div class="advice" id="advice"><span class="adv adv-${c}">${t}</span>${a.text ? ` <span class="dim">${R.esc(a.text)}</span>` : ''}</div>`;
  };
  // something that isn't gear (currency, a gem, a map, a divination card...): what it's worth
  window.renderPriceCard = function (el, r, opts) {
    opts = opts || {};
    const it = r.item || {};
    const p = r.ninja;
    const what = [p && p.gemLevel ? `level ${p.gemLevel}${p.gemQuality ? `, ${p.gemQuality}% quality` : ''}` : '', p && p.links ? `${p.links}-link` : '', p && p.mapTier ? `tier ${p.mapTier}` : '', p && p.variant && !p.gemLevel ? p.variant : ''].filter(Boolean).join(' · ');
    el.innerHTML = `<div class="card price-card">
        <div class="name ${R.esc((it.rarity || '').toLowerCase())}">${R.esc(it.name || '')}</div>
        <div class="meta">${R.esc(it.itemClass || '')}${p && p.stack > 1 ? ` · stack of ${nf(p.stack)}` : ''}</div>
        ${opts.closable ? '<button class="x" id="closeBtn" title="Close">×</button>' : ''}
        ${r.pricePending ? '<div class="note"><span class="spinner"></span> Getting the price from poe.ninja…</div>' : ''}
        ${p ? `<div class="price-big">${ninjaPrice(p)} <span class="dim">each</span></div>
          ${p.stack > 1 ? `<div>Stack: ${ninjaPrice(p, true)}</div>` : ''}
          ${window.sparkHtml(p, 200, 34) ? `<div class="spark-row">${window.sparkHtml(p, 200, 34)}<span class="dim small">last 7 days</span></div>` : ''}
          <div class="dim small">${trend(p)}${what ? ` · priced as ${R.esc(what)}` : ''}${p.few ? ' · few listed, so a rough guess' : ''}${p.unsure ? ` · several versions: this is the ${R.esc(p.variant || 'most common')} one's price` : ''} · poe.ninja${p.league ? `, ${R.esc(p.league)}` : ''}</div>` : ''}
        ${window.gemHtml(r)}
        ${p ? window.adviceHtml(r) : ''}
        ${window.sellHtml(r)}
        ${r.priceNote ? `<div class="note">${R.esc(r.priceNote)}</div>` : ''}
        ${/tablet/i.test(it.itemClass || '') ? '<div class="actions"><button class="find" id="tradeWorth" title="What tablets like this sell for on the trade site">What\'s it worth?</button></div><div class="note" id="findMsg"></div>' : ''}
        ${r.links && r.links.length ? `<div class="actions">${linksHtml(r.links)}</div>` : ''}
      </div>`;
    bindLinks(el);
    window.bindTradeWorth(el, it, opts);
    window.bindSell(el, r);
    const c = el.querySelector('#closeBtn');
    if (c) c.addEventListener('click', () => window.api.close());
  };
  const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m === 1 ? '1 min ago' : m < 120 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };
  // "What's it worth?" on a waystone, map or tablet card: the trade site's price
  window.bindTradeWorth = function (el, it, opts) {
    const b = el.querySelector('#tradeWorth');
    if (!b) return;
    b.addEventListener('click', async () => {
      const msg = el.querySelector('#findMsg');
      b.disabled = true; msg.innerHTML = '<span class="spinner"></span> Checking prices…';
      if (opts && opts.onResize) opts.onResize();
      const res = await window.api.priceCheck(it.id ? { itemId: it.id } : '__last').catch((err) => ({ ok: false, error: (err && err.message) || String(err) }));
      b.disabled = false;
      window.showSearchResult(msg, res);
      if (opts && opts.onResize) opts.onResize();
    });
  };
  // how far to trust a price: a small chip, the reason in its tooltip
  const CONF = { solid: ['solid price', 'conf-solid'], rough: ['rough price', 'conf-rough'], guess: ['a guess', 'conf-guess'] };
  window.confHtml = function (c) {
    if (!c || !CONF[c.grade]) return '';
    const [t, cls] = CONF[c.grade];
    return ` <span class="conf ${cls}" title="${R.esc(c.grade === 'solid' ? 'Plenty of recent listings close to this item, at similar prices' : `Treat it as ${c.grade === 'rough' ? 'a rough figure' : 'a guess'}: ${c.why}`)}">${t}</span>`;
  };
  // an earlier check of the same search, searched again hours later: what went (sold or taken down)
  window.soldHtml = function (sold) {
    if (!sold || !sold.text) return '';
    return `<div class="sold-line small" title="The instant buyout listings from your check of this item ${R.esc(ago(sold.at))}, searched again later. A gone one was bought, or its seller took it down, so this is an estimate."><b>What sold</b> (your check ${R.esc(ago(sold.at))}): ${R.esc(sold.text)}</div>`;
  };
  // your verdict on a price: saved with the check, to measure the pricing against what you know
  window.priceFeedbackHtml = function (caseId) {
    if (!caseId) return '';
    return `<div class="price-fb small dim" data-case="${R.esc(caseId)}">Price right? <button class="link" data-fb="low">Too low</button> · <button class="link" data-fb="right">About right</button> · <button class="link" data-fb="high">Too high</button>
      <span class="fb-more hidden"> Worth about <input type="text" class="fb-actual" size="8" placeholder="3 div" aria-label="What it's worth"> <button class="link fb-save">Save</button></span><span class="fb-msg"></span></div>`;
  };
  window.bindPriceFeedback = function (el, onResize) {
    const box = el.querySelector('.price-fb');
    if (!box) return;
    const id = box.dataset.case; const msg = box.querySelector('.fb-msg'); const more = box.querySelector('.fb-more');
    let rating = null;
    const send = async (actual) => {
      const res = await window.api.priceFeedback(id, rating, actual).catch((err) => ({ ok: false, error: err.message }));
      msg.textContent = res && res.ok ? ' Thanks, saved.' : ` ${(res && res.error) || 'Not saved.'}`;
      if (onResize) onResize();
    };
    box.querySelectorAll('[data-fb]').forEach((b) => b.addEventListener('click', () => {
      rating = b.dataset.fb;
      box.querySelectorAll('[data-fb]').forEach((x) => x.classList.toggle('on', x === b));
      if (rating === 'right') { more.classList.add('hidden'); send(''); return; }
      more.classList.remove('hidden'); msg.textContent = '';
      const inp = box.querySelector('.fb-actual'); if (inp) inp.focus();
      if (onResize) onResize();
    }));
    const save = () => send(box.querySelector('.fb-actual').value.trim());
    box.querySelector('.fb-save').addEventListener('click', save);
    box.querySelector('.fb-actual').addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  };

  // the price hotkey (F3): the item's name and its price, nothing else
  window.renderQuickPrice = function (el, r, opts) {
    opts = opts || {};
    const it = r.item || {};
    const p = r.ninja; const t = r.trade;
    const base = it.baseType && it.baseType !== it.name ? it.baseType : it.itemClass || '';
    let body;
    if (r.pending) body = '<div class="dim"><span class="spinner"></span> Checking the price…</div>';
    else if (p) body = `<div class="price-answer"><b>${ninjaPrice(p)}</b></div><div class="dim small">${p.stack > 1 ? `stack: ${ninjaPrice(p, true)} · ` : ''}poe.ninja${p.league ? `, ${R.esc(p.league)}` : ''}</div>`;
    else if (t) body = `<div class="price-answer">≈ <b>${R.esc(t.typical)}</b>${window.confHtml(t.confidence)}</div><div class="dim small">${t.range ? `most ${R.esc(t.range)} · ` : ''}${R.esc(t.sellers || t.total)} seller${(t.sellers || t.total) === 1 ? '' : 's'}${t.baits ? ` (${R.esc(t.baits)} far cheaper left out as likely baits)` : ''} · ${R.esc(r.source || 'trade site')}${r.checkedAt ? ` · checked ${R.esc(ago(r.checkedAt))} <button class="link" id="qpRefresh">refresh</button>` : ''}</div>`;
    else body = `<div class="dim">${R.esc(r.error || 'No price found.')}</div>`;
    if (!r.pending && !p) body += window.soldHtml((t && t.sold) || r.sold) + window.priceFeedbackHtml((t && t.caseId) || r.caseId);
    el.innerHTML = `<div class="card price-card quick-price">
        <div class="name ${R.esc((it.rarity || '').toLowerCase())}">${R.esc(it.name || '')}</div>
        ${base ? `<div class="meta">${R.esc(base)}</div>` : ''}
        ${opts.closable ? '<button class="x" id="closeBtn" title="Close">×</button>' : ''}
        ${body}
      </div>`;
    const c = el.querySelector('#closeBtn');
    if (c) c.addEventListener('click', () => window.api.close());
    const rf = el.querySelector('#qpRefresh');
    if (rf) rf.addEventListener('click', () => { rf.disabled = true; window.api.quickPriceRefresh(); });
    window.bindPriceFeedback(el, opts.onResize);
  };
  // a gem: what the same gem in your build would do at this level and quality
  const pct = (v) => (v == null || Math.abs(v) < 0.05 ? null : `${v > 0 ? '+' : ''}${v}%`);
  const gemLq = (l, q) => `level ${l}${q ? ` / ${q}% quality` : ''}`;
  window.gemHtml = function (r) {
    if (r.gemPending) return '<div class="note"><span class="spinner"></span> Trying this gem in your build with Path of Building…</div>';
    if (r.gemError) return `<div class="note">Couldn't try this gem in your build (${R.esc(r.gemError)}).</div>`;
    if (!r.gem) return '';
    if (!r.gem.hits.length) return '<div class="dim small gem-check">This gem isn\'t in your Path of Building build (or it\'s switched off there).</div>';
    return `<div class="gem-check">${r.gem.hits.map((h) => {
      const same = h.level === h.newLevel && h.quality === h.newQuality;
      const ch = [pct(h.dps) && `DPS ${pct(h.dps)}`, pct(h.ehp) && `effective HP ${pct(h.ehp)}`].filter(Boolean).join(', ');
      const [t, c] = same ? ['SAME AS YOURS', 'same'] : h.verdict === 'upgrade' || h.verdict === 'small' ? ['UPGRADE', 'up'] : h.verdict === 'same' ? ['NO CHANGE', 'same'] : ['WORSE', 'down'];
      return `<div class="verdict ${c}"><span class="badge">${t}</span><span class="dim">in ${R.esc(h.group)}: yours is ${gemLq(h.level, h.quality)}${same ? '' : `, this one ${gemLq(h.newLevel, h.newQuality)}`}${ch && !same ? ` · ${R.esc(ch)}` : ''}</span></div>`;
    }).join('')}</div>`;
  };

  // a map or waystone: each mod and what it means for your build; click a mod to mark it
  const MAPV = { danger: ['DANGER', 'down'], warn: ['CAREFUL', 'risky'], ok: ['LOOKS FINE', 'up'] };

  Object.assign(R, { scoreHtml, pointsLabel, linksHtml, bindLinks, MAPV });
})();
