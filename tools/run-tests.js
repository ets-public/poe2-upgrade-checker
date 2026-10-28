#!/usr/bin/env node
'use strict';
// npm test: every test/*.test.js, so a new test file can't be left out of the run. (Node only
// expands a glob given to --test from version 21; this works from Node 18.)
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.join(__dirname, '..', 'test');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort().map((f) => path.join('test', f));
if (!files.length) { console.error('No test files in test/'); process.exit(1); }
const r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: path.join(__dirname, '..') });
process.exit(r.status == null ? 1 : r.status);
