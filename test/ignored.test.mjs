// A CICS command whose failure the program cannot see. It is common and mostly quiet trouble, so it
// is one finding per program, at the first place, with the count.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanCics, CICS_RULES } from '../lib/sets/cics.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ignored');
const report = scanCics(FIXTURES);
const of = (file) => report.findings.filter((f) => f.path === file && f.rule === 'cics-condition-ignored');

test('NOHANDLE with no RESP is one finding for the program, at the first, naming each', () => {
  const [f, ...rest] = of('NOHANDLE.cbl');
  assert.equal(rest.length, 0);
  assert.equal(f.line, 9);
  assert.equal(f.sev, 'low');
  assert.match(f.detail, /leaves 2 places where a CICS command's failure goes unseen: READ NOHANDLE at line 9, REWRITE NOHANDLE at line 12/);
});

test('a TS queue deleted with NOHANDLE is the ordinary shape, not a finding', () => {
  assert.doesNotMatch(of('NOHANDLE.cbl')[0].detail, /DELETEQ/);
});

test('NOHANDLE with RESP, or with EIBRESP tested before the next command, is read', () => {
  assert.deepEqual(of('TESTED.cbl'), []);
});

test('IGNORE CONDITION is reported where it is set', () => {
  const [f] = of('IGNORE.cbl');
  assert.equal(f.line, 9);
  assert.match(f.detail, /IGNORE CONDITION ERROR at line 9/);
  assert.equal(CICS_RULES['cics-condition-ignored'].cwe, 'CWE-252');
});

test('a line written to a transient-data log with NOHANDLE is the ordinary shape', () => {
  assert.deepEqual(of('LOGTD.cbl'), []);
});
