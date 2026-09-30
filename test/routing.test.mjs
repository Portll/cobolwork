// Routing by input: the region a CICS command is shipped to, and the resource a system-programming
// command changes. A literal in either is the program's own choice and no route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../lib/sets/flow.mjs';
import { classesOfRule } from '../lib/consequence.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'routing');
const report = scan(FIXTURES);
const of = (file, sink) => report.findings.filter((f) => f.path === file && f.rule.endsWith(`-to-${sink}`));

test('terminal input naming the SYSID of a LINK is reported, medium', () => {
  const [f, ...rest] = of('SYSIDIN.cbl', 'cics-sysid');
  assert.equal(rest.length, 0);
  assert.equal(f.rule, 'cics-terminal-to-cics-sysid');
  assert.equal(f.sev, 'med');
  assert.equal(f.cwe, 'CWE-15');
  assert.equal(f.line, 12);
  assert.match(f.detail, /EXEC CICS LINK SYSID\(WS-REGION\)/);
});

test('a region chosen from a list of literals clears the route', () => {
  assert.deepEqual(of('SYSIDOK.cbl', 'cics-sysid'), []);
  const [c] = report.checked.filter((x) => x.path === 'SYSIDOK.cbl');
  assert.equal(c.rule, 'cics-terminal-to-cics-sysid');
});

test('terminal input naming the program an EXEC CICS SET disables is high, and escalates', () => {
  const [f] = of('SETPGM.cbl', 'cics-system-resource');
  assert.equal(f.rule, 'cics-terminal-to-cics-system-resource');
  assert.equal(f.sev, 'high');
  assert.equal(f.line, 11);
  assert.match(f.detail, /EXEC CICS SET PROGRAM\(WS-PGM\)/);
  assert.deepEqual(classesOfRule(f.rule), ['privilege-escalation']);
});

test('ASSIGN SYSID returns the region into the field, so it is no route', () => {
  assert.deepEqual(of('SYSIDASK.cbl', 'cics-sysid'), []);
});
