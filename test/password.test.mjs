// A program that checks passwords itself: one it reads back from its own file or table, and one it
// folds to a single case first. Passwords are known by field name, and each finding says so.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanCics, CICS_RULES } from '../lib/sets/cics.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'password');
const report = scanCics(FIXTURES);
const of = (file, rule) => report.findings.filter((f) => f.path === file && f.rule === rule);

test('a password read from the user file and compared in the program is reported where it is compared', () => {
  const [f, ...rest] = of('STOREDPW.cbl', 'program-checks-stored-password');
  assert.equal(rest.length, 0);
  assert.equal(f.line, 17);
  assert.equal(f.sev, 'med');
  assert.equal(f.cwe, 'CWE-256');
  assert.match(f.detail, /compares SEC-USR-PWD with WS-USER-PWD, and SEC-USR-PWD is read back from the program's own file or table/);
  assert.match(f.detail, /recognised by its field name/);
});

test('a typed password upper-cased before the comparison is reported at the MOVE', () => {
  const [f] = of('FOLDPW.cbl', 'password-case-folded-before-compare');
  assert.equal(f.line, 14);
  assert.equal(f.sev, 'low');
  assert.equal(f.cwe, 'CWE-178');
  assert.match(f.detail, /folds the case of WS-PASSWD-IN with FUNCTION UPPER-CASE/);
  assert.deepEqual(of('FOLDPW.cbl', 'program-checks-stored-password'), [], 'a literal in VALUE is not a record read back');
});

test('a program that asks RACF with VERIFY PASSWORD is not checking passwords itself', () => {
  assert.deepEqual(report.findings.filter((f) => f.path === 'RACFPW.cbl' && /password/.test(f.rule)), []);
});

test('both rules are constructs, since no input has to reach them', () => {
  assert.equal(CICS_RULES['program-checks-stored-password'].evidence, 'construct');
  assert.equal(CICS_RULES['password-case-folded-before-compare'].evidence, 'construct');
});
