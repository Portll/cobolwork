// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for the PL/I condition handling rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { programOf } from '../lib/pli/rules/index.mjs';
import * as conditions from '../lib/pli/rules/conditions.mjs';
import './pin-machine.mjs';

test('every RULES entry has sev, evidence, cwe and text', () => {
  for (const [id, rule] of Object.entries(conditions.RULES)) {
    assert.ok(rule.sev, `${id} missing sev`);
    assert.ok(rule.evidence, `${id} missing evidence`);
    assert.ok(rule.cwe, `${id} missing cwe`);
    assert.ok(rule.text, `${id} missing text`);
  }
});

test('reports ON ERROR with null unit', () => {
  const src = `
    ON ERROR;
  `;
  const prog = programOf('test.pli', src);
  const findings = conditions.check(prog);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'pli-error-condition-ignored');
  assert.match(findings[0].detail, /ON ERROR/);
});

test('does not report ON ERROR with PUT', () => {
  const src = `
    ON ERROR BEGIN;
      PUT LIST('ERROR OCCURRED');
    END;
  `;
  const prog = programOf('test.pli', src);
  const findings = conditions.check(prog);
  assert.equal(findings.length, 0);
});

test('reports ON ERROR with GO TO only', () => {
  const src = `
    ON ERROR BEGIN;
      GO TO EXIT;
    END;
  `;
  const prog = programOf('test.pli', src);
  const findings = conditions.check(prog);
  assert.equal(findings.length, 1);
  assert.match(findings[0].detail, /GO TO/);
});

test('does not report ON ERROR with SIGNAL', () => {
  const src = `
    ON ERROR BEGIN;
      SIGNAL ERROR;
    END;
  `;
  const prog = programOf('test.pli', src);
  const findings = conditions.check(prog);
  assert.equal(findings.length, 0);
});

test('does not report ON ERROR SYSTEM', () => {
  const src = `
    ON ERROR SYSTEM;
  `;
  const prog = programOf('test.pli', src);
  const findings = conditions.check(prog);
  assert.equal(findings.length, 0);
});

test('does not report ON ENDFILE with GO TO', () => {
  const src = `
    ON ENDFILE(INFILE) BEGIN;
      GO TO EXIT;
    END;
  `;
  const prog = programOf('test.pli', src);
  const findings = conditions.check(prog);
  assert.equal(findings.length, 0);
});

test('reports ON ZERODIVIDE with null unit', () => {
  const src = `
    ON ZERODIVIDE;
  `;
  const prog = programOf('test.pli', src);
  const findings = conditions.check(prog);
  assert.equal(findings.length, 1);
  assert.match(findings[0].detail, /ZERODIVIDE/);
});

test('does not report ON ZERODIVIDE with CALL PLIRETC', () => {
  const src = `
    ON ZERODIVIDE BEGIN;
      CALL PLIRETC (1);
    END;
  `;
  const prog = programOf('test.pli', src);
  const findings = conditions.check(prog);
  assert.equal(findings.length, 0);
});

test('a block nested in the ON unit does not end it early, and a unit that writes is handling', () => {
  const src = [
    ' ON CONVERSION BEGIN;',
    '   IF ONCODE = 612 THEN DO;',
    '     GO TO NEXT;',
    '   END;',
    '   PUT SKIP LIST(ONSOURCE);',
    ' END;',
  ].join('\n');
  assert.deepEqual(conditions.check(programOf('n.pli', src)), []);
});
