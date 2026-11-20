'use strict';

// Why a trade search failed, as one of a few kinds for the anonymous usage statistics (never the
// message itself: it can name stats or a league). fails: [{ status: HTTP status or undefined, msg }],
// one per route tried (signed-in page, the app's own request). The most telling kind wins.
const KINDS = ['blocked', 'refused', 'complex', 'server', 'timeout', 'net', 'other'];
function kindOf(f) {
  const st = Number(f && f.status) || 0;
  const msg = String((f && f.msg) || '');
  if (/too complex|too many filters/i.test(msg)) return 'complex';
  if (st === 403 || /\bHTTP 403\b|forbidden|cloudflare|just a moment/i.test(msg)) return 'blocked';
  if (st >= 500 || /\bHTTP 5\d\d\b|maintenance|unavailable/i.test(msg)) return 'server';
  if ((st >= 400 && st < 500) || /\bHTTP 4\d\d\b|invalid|unknown|not found/i.test(msg)) return 'refused';
  if (/timed? ?out|timeout/i.test(msg)) return 'timeout';
  if (/net::|ERR_|ENOTFOUND|ECONN|EAI_AGAIN|fetch failed|network|offline/i.test(msg)) return 'net';
  return 'other';
}
function failReason(fails) {
  const kinds = (Array.isArray(fails) ? fails : []).map(kindOf);
  return KINDS.find((k) => kinds.includes(k)) || 'other';
}
module.exports = { failReason, FAIL_KINDS: KINDS };
