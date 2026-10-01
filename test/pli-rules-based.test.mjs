// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for the PL/I BASED storage addressing rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { programOf } from '../lib/pli/rules/index.mjs';
import * as based from '../lib/pli/rules/based.mjs';

test('RULES entry has sev, evidence, cwe, and text', () => {
  const rule = based.RULES['pli-based-storage-addressing'];
  assert.ok(rule, 'rule should exist');
  assert.equal(rule.sev, 'info');
  assert.equal(rule.evidence, 'coverage');
  assert.equal(rule.cwe, 'CWE-119');
  assert.ok(rule.text, 'text should be present');
});

test('reports finding for BASED variable', () => {
  const src = `
    DCL X CHAR(8) BASED;
    X = 'HELLO';
  `;
  const program = programOf('test.pli', src);
  const findings = based.check(program);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'pli-based-storage-addressing');
  assert.equal(findings[0].path, 'test.pli');
  assert.ok(findings[0].detail.includes('X'));
});

test('does not report finding for non-BASED variable', () => {
  const src = `
    DCL X CHAR(8);
    X = 'HELLO';
  `;
  const program = programOf('test.pli', src);
  const findings = based.check(program);
  assert.equal(findings.length, 0);
});

test('reports finding for BASED with ADDR locator', () => {
  const src = `
    DCL Y CHAR(8);
    DCL X CHAR(8) BASED(ADDR(Y));
    X = 'HELLO';
  `;
  const program = programOf('test.pli', src);
  const findings = based.check(program);
  assert.equal(findings.length, 1);
  assert.ok(findings[0].detail.includes('ADDR'));
});

test('reports finding for BASED with POINTER locator', () => {
  const src = `
    DCL P POINTER;
    DCL X CHAR(8) BASED(P);
    X = 'HELLO';
  `;
  const program = programOf('test.pli', src);
  const findings = based.check(program);
  assert.equal(findings.length, 1);
  assert.ok(findings[0].detail.includes('X'));
});

test('reports multiple BASED variables with count', () => {
  const src = `
    DCL X CHAR(8) BASED;
    DCL Y CHAR(8) BASED;
    DCL Z CHAR(8) BASED;
    DCL W CHAR(8) BASED;
  `;
  const program = programOf('test.pli', src);
  const findings = based.check(program);
  assert.equal(findings.length, 1);
  assert.ok(findings[0].detail.includes('4 variables'));
  assert.ok(findings[0].detail.includes('X'));
  assert.ok(findings[0].detail.includes('Y'));
  assert.ok(findings[0].detail.includes('Z'));
});

test('mentions computed address assignment to POINTER variable', () => {
  const src = `
    DCL P POINTER;
    DCL X CHAR(8) BASED(P);
    P = POINTERADD(P, 8);
  `;
  const program = programOf('test.pli', src);
  const findings = based.check(program);
  assert.equal(findings.length, 1);
  assert.ok(findings[0].detail.includes('P'));
  assert.ok(findings[0].detail.includes('computed address'));
});
