// The PL/I benchmark cases: every positive found, every negative quiet, except what a case names as
// an open limit or a rule PL/I does not have yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCase } from '../diag/pli-bench.mjs';
import './pin-machine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'bench', 'pli');
const cases = readdirSync(ROOT).map((d) => join(ROOT, d)).filter((d) => statSync(d).isDirectory() && existsSync(join(d, 'manifest.json')));

test('every PL/I benchmark case passes, or names the limit or missing rule it waits on', () => {
  assert.ok(cases.length >= 10);
  const failed = cases.map(runCase).filter((r) => r.verdict === 'missed' || r.verdict === 'false-positive');
  assert.deepEqual(failed.map((r) => `${r.id}: ${r.verdict} ${[...r.missing, ...r.unexpected].join(', ')}`), []);
});
