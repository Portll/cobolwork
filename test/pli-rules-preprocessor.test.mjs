// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for the PL/I preprocessor rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { programOf } from '../lib/pli/rules/index.mjs';
import { RULES, check } from '../lib/pli/rules/preprocessor.mjs';
import './pin-machine.mjs';

test('every RULES entry has sev, evidence, cwe and text', () => {
  for (const [id, r] of Object.entries(RULES)) {
    assert.ok(r.sev, `${id} missing sev`);
    assert.ok(r.evidence, `${id} missing evidence`);
    assert.ok(r.cwe, `${id} missing cwe`);
    assert.ok(r.text, `${id} missing text`);
  }
});

test('fires on a program with preprocessor directives', () => {
  const src = `
 %DCL DEBUG CHAR;
 %DEBUG = 'YES';
 %IF DEBUG = 'YES' %THEN %INCLUDE DBGRTN;
   DCL X CHAR(8);
`;
  const program = programOf('test.pli', src);
  const findings = check(program);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'pli-preprocessor-in-use');
  assert.equal(findings[0].path, 'test.pli');
  assert.ok(findings[0].detail.includes('IF'));
});

test('does not fire on a program with only include directives', () => {
  const src = `
 %INCLUDE 'COPYBOOK';
 DCL X CHAR(8);
`;
  const program = programOf('test.pli', src);
  const findings = check(program);
  assert.equal(findings.length, 0);
});
