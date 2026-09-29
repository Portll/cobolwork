// Taint that reaches a group reaches a table inside it only if the tainted bytes fall inside the
// table; which element holds them is not known, so the walk goes on without claiming bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../lib/sets/flow.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'tables');
const report = scan(FIXTURES);
const at = (file, rule) => report.findings.filter(f => f.path === file && f.rule === rule);

test('bytes read back as a table element through a REDEFINES are followed', () => {
  const f = at('TABLEHIT.cbl', 'argv-or-env-to-os-command');
  assert.equal(f.length, 1);
  assert.ok(f[0].trace.some(t => t.item === 'WS-PART'), 'the path runs through the table element');
});

test('a field beside a table in the same group does not taint the table', () => {
  assert.deepEqual(at('TABLEMISS.cbl', 'argv-or-env-to-os-command'), []);
});

test('a date checked numeric before it is built into submitted job text is followed, and stopped', () => {
  // Digits cannot carry a JCL statement, and the check returns before the date is used.
  assert.deepEqual(at('JOBTABLE.cbl', 'cics-terminal-to-internal-reader'), []);
  const c = report.checked.filter(x => x.path === 'JOBTABLE.cbl' && x.rule === 'cics-terminal-to-internal-reader');
  assert.equal(c.length, 1);
  assert.ok(c[0].trace.some(t => t.item === 'JOB-LINES'));
  // WS-OTHER is unchecked and shares a group with JCL-RECORD. Up into that group and down into a
  // sibling is not a route, and the pass that looks for unchecked routes must not take it either.
  assert.equal(c[0].guard.item, 'IN-DATE');
});
