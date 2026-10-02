// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for the PL/I entry-variable and fetch-title rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { programOf } from '../lib/pli/rules/index.mjs';
import { RULES, check } from '../lib/pli/rules/entry.mjs';
import './pin-machine.mjs';

test('every RULES entry has sev, evidence, cwe and text', () => {
  for (const [id, rule] of Object.entries(RULES)) {
    assert.ok(rule, `rule ${id} is defined`);
    assert.ok(['info', 'low', 'med', 'high', 'crit'].includes(rule.sev), `${id} has a valid sev`);
    assert.ok(['coverage', 'construct', 'advisory'].includes(rule.evidence), `${id} has a valid evidence`);
    assert.match(rule.cwe, /^CWE-\d+$/, `${id} has a valid cwe`);
    assert.ok(typeof rule.text === 'string' && rule.text.length > 0, `${id} has text`);
  }
});

test('reports a CALL through an entry variable with the assigned entry constant', () => {
  const src = [
    ' DCL PROC1 ENTRY;',
    ' DCL EV ENTRY VARIABLE;',
    ' EV = PROC1;',
    ' CALL EV;',
  ].join('\n');
  const program = programOf('entry.mpl', src);
  const findings = check(program);
  const call = findings.find((f) => f.rule === 'pli-entry-variable-call');
  assert.ok(call, 'a pli-entry-variable-call finding is reported');
  assert.equal(call.line, 4);
  assert.match(call.detail, /CALL EV/);
  assert.match(call.detail, /PROC1/);
});

test('does not report a CALL of an entry constant', () => {
  const src = [
    ' DCL PROC1 ENTRY;',
    ' CALL PROC1;',
  ].join('\n');
  const program = programOf('entry.mpl', src);
  const findings = check(program);
  assert.equal(findings.length, 0, 'no findings for a direct call of a procedure');
});

test('reports a FETCH whose TITLE is a variable', () => {
  const src = [
    ' DCL MODNAME CHAR(8);',
    ' FETCH MODNAME TITLE(MODNAME);',
  ].join('\n');
  const program = programOf('fetch.mpl', src);
  const findings = check(program);
  const fetch = findings.find((f) => f.rule === 'pli-fetch-title-variable');
  assert.ok(fetch, 'a pli-fetch-title-variable finding is reported');
  assert.equal(fetch.line, 2);
  assert.match(fetch.detail, /FETCH MODNAME/);
});

test('does not report a FETCH whose TITLE is a literal', () => {
  const src = [
    " FETCH MODNAME TITLE('MODNAME');",
  ].join('\n');
  const program = programOf('fetch.mpl', src);
  const findings = check(program);
  assert.equal(findings.length, 0, 'no findings for a fetch with a literal title');
});

test('an ENTRY member of a structure is a variable, and a literal FETCH title is not a finding', () => {
  const src = [
    ' DCL 1 HANDLERS, 2 H(3) ENTRY;',
    " FETCH PAYCALC TITLE('PAYCALC');",
    ' CALL H(2);',
  ].join('\n');
  const findings = check(programOf('m.pli', src));
  assert.deepEqual(findings.map((f) => f.rule), ['pli-entry-variable-call']);
});
