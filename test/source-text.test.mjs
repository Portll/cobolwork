import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import './pin-machine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_INPUTS = /^(test\/fixtures|bench\/cases)\//;
const HIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/;

test('no tracked file outside the scan inputs holds a control, bidirectional or invisible character', (t) => {
  const ls = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  if (ls.status !== 0) return t.skip('not a git checkout');
  const files = ls.stdout.split('\0').filter((f) => f && !SCAN_INPUTS.test(f));
  assert.ok(files.length > 100, `found ${files.length} tracked files`);
  const hits = [];
  for (const f of files) {
    let bytes;
    try { bytes = readFileSync(join(ROOT, f)); } catch { continue; }
    if (bytes.includes(0)) continue;
    bytes.toString('utf8').split('\n').forEach((line, i) => {
      const m = HIDDEN.exec(line);
      if (m) hits.push(`${f}:${i + 1} U+${m[0].charCodeAt(0).toString(16).padStart(4, '0')}`);
    });
  }
  assert.deepEqual(hits, []);
});
