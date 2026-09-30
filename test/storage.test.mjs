// How much storage a program acquires, when a caller decides it. In a CICS region the storage is
// shared by every task; a batch job's own command line exhausts only its own address space.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../lib/sets/flow.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'storage');
const report = scan(FIXTURES);
const of = (file) => report.findings.filter((f) => f.path === file && f.rule.endsWith('-to-storage-length'));

test('terminal input that sets the length of a GETMAIN is reported there', () => {
  const [f, ...rest] = of('GETMAININ.cbl');
  assert.equal(rest.length, 0);
  assert.equal(f.rule, 'cics-terminal-to-storage-length');
  assert.equal(f.sev, 'med');
  assert.equal(f.cwe, 'CWE-770');
  assert.equal(f.line, 12);
  assert.match(f.detail, /EXEC CICS GETMAIN FLENGTH\(WS-LEN\), which decides how much storage is acquired/);
});

test('an upper bound tested before the GETMAIN clears the route', () => {
  assert.deepEqual(of('GETMAINOK.cbl'), []);
  const [c] = report.checked.filter((x) => x.path === 'GETMAINOK.cbl');
  assert.equal(c.rule, 'cics-terminal-to-storage-length');
  assert.equal(c.guard.line, 12);
});

test('a length the program chose itself is not a route', () => {
  assert.deepEqual(of('GETMAINLIT.cbl'), []);
});

test('a batch heap request sized from the command line is reported low, at CEEGTST', () => {
  const [f] = of('HEAPPARM.cbl');
  assert.equal(f.rule, 'argv-or-env-to-storage-length');
  assert.equal(f.sev, 'low');
  assert.equal(f.line, 14);
  assert.match(f.detail, /CALL 'CEEGTST' with size WS-SIZE/);
});
