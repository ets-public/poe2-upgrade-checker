'use strict';

// Testing a typed search string against an item, without risking the app. The string is a regex you
// typed, and some regexes take forever on some text ("(a|aa)+$" doubles its time with every letter).
// Run in the app itself, one of those would freeze everything: hotkeys, the popup, the overlays.
// So the test runs in a worker thread of its own, which is stopped if it takes too long.
const fs = require('fs');
const { Worker } = require('worker_threads');

// The worker gets regexbuild.js as text (it has no requires), so this works from inside the packaged
// app's archive too, where a worker can't load a file by its path.
let SOURCE = null;
const source = () => (SOURCE = SOURCE || fs.readFileSync(require.resolve('./regexbuild'), 'utf8'));
const WORKER = `
const { parentPort, workerData } = require('worker_threads');
const module_ = { exports: {} };
new Function('module', 'exports', workerData.source)(module_, module_.exports);
parentPort.postMessage(module_.exports.test(workerData.query, workerData.text));
`;

// -> what regexbuild.test gives, or { ok: false, timedOut: true, error } when it took too long
function testSafe(query, itemText, { timeoutMs = 1500 } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); w.terminate().catch(() => {}); resolve(r); };
    let w;
    try { w = new Worker(WORKER, { eval: true, workerData: { source: source(), query: String(query || ''), text: String(itemText || '') }, resourceLimits: { maxOldGenerationSizeMb: 64 } }); } catch (err) { resolve({ ok: false, groups: [], error: 'Couldn\'t test it: ' + err.message }); return; }
    const timer = setTimeout(() => finish({ ok: false, timedOut: true, groups: [], error: `That search took over ${Math.round(timeoutMs / 100) / 10} seconds to test, so it was stopped: part of it makes the regex try too many ways (a repeat inside a repeat, like (a+)+). Simplify it.` }), timeoutMs);
    w.once('message', (r) => finish(r));
    w.once('error', (err) => finish({ ok: false, groups: [], error: 'Couldn\'t test it: ' + (err && err.message || err) }));
    w.once('exit', (code) => finish({ ok: false, groups: [], error: `Couldn't test it (stopped with code ${code}).` }));
  });
}

module.exports = { testSafe };
