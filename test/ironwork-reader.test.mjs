// checkWithIronwork reads `ironwork check` by its exit code, and by the wording of its errors only
// where the code leaves the program undecided. A stub stands in for the binary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import './pin-machine.mjs';
import { checkWithIronwork, ironworkVerdict } from '../lib/ironwork.mjs';

function run(status, stderr) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-iw-'));
  try {
    writeFileSync(join(dir, 'P.cbl'), '       IDENTIFICATION DIVISION.\n       PROGRAM-ID. P.\n');
    const stub = join(dir, 'ironwork-stub');
    writeFileSync(stub, `#!/bin/sh\necho '${stderr}' >&2\nexit ${status}\n`);
    chmodSync(stub, 0o755);
    return checkWithIronwork(stub, dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('exit 0 and 4 compile', () => {
  assert.equal(ironworkVerdict(run(0, '')), true);
  const warned = run(4, 'P.cbl:1:1: warning: odd');
  assert.equal(warned.warned, 1);
  assert.equal(ironworkVerdict(warned), true);
});

test('exit 8 fails the program though the error says "not supported"', () => {
  const r = run(8, 'P.cbl:3:8: this clause is not supported here');
  assert.equal(r.failed.length, 1);
  assert.equal(ironworkVerdict(r), false);
});

test('exit 12 with "not supported" is undecided', () => {
  const r = run(12, 'P.cbl:3:8: USAGE X is not supported yet');
  assert.equal(r.notModelled.length, 1);
  assert.equal(ironworkVerdict(r), null);
});

test('exit 12 with a translator name undefined is undecided; any other name fails', () => {
  assert.equal(run(12, 'P.cbl:3:8: EIBCALEN is not defined').notModelled.length, 1);
  assert.equal(run(12, 'P.cbl:3:8: WS-X is not defined').failed.length, 1);
});

test('a missing copy member is unresolved', () => {
  assert.equal(run(12, 'P.cbl:2:8: CUST: no such member in the copy libraries').unresolved.length, 1);
});

test('an exit outside the codes is unrun', () => {
  assert.equal(run(2, 'usage').unrun.length, 1);
});
