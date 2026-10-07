// Stamps severity, CWE and evidence from the rule table, sorts findings and tallies counts by rule (lib/kernel/findings.mjs finish).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finish } from '../lib/kernel/findings.mjs';
import './pin-machine.mjs';

test('returns empty findings and empty tally for no findings', () => {
  const rules = {};
  const findings = [];
  const result = finish(rules, findings, 'test set');
  assert.deepEqual(result, { findings: [], byRule: {} });
});

test('stamps severity, CWE, and evidence from rule table for findings missing them', () => {
  const rules = {
    'rule-a': { sev: 'high', cwe: 79, evidence: 'construct' },
  };
  const findings = [{ rule: 'rule-a', path: 'a.cob', line: 10 }];
  const result = finish(rules, findings, 'test set');
  assert.equal(result.findings[0].sev, 'high');
  assert.equal(result.findings[0].cwe, 79);
  assert.equal(result.findings[0].evidence, 'construct');
  assert.deepEqual(result.byRule, { 'rule-a': 1 });
});

test('keeps existing severity, CWE, and evidence on findings that already carry them', () => {
  const rules = {
    'rule-b': { sev: 'low', cwe: 119, evidence: 'path' },
  };
  const findings = [{ rule: 'rule-b', path: 'b.cob', line: 5, sev: 'critical', cwe: 22, evidence: 'tampering' }];
  const result = finish(rules, findings, 'test set');
  assert.equal(result.findings[0].sev, 'critical');
  assert.equal(result.findings[0].cwe, 22);
  assert.equal(result.findings[0].evidence, 'tampering');
});

test('throws ERULEID when a finding names a rule not in the table', () => {
  const rules = { 'known-rule': { sev: 'medium', cwe: 1, evidence: 'advisory' } };
  const findings = [{ rule: 'unknown-rule', path: 'c.cob', line: 1 }];
  assert.throws(() => finish(rules, findings, 'test set'), (err) => {
    assert.equal(err.code, 'ERULEID');
    assert.equal(err.rule, 'unknown-rule');
    assert.equal(err.set, 'test set');
    assert.match(err.message, /test set: a finding names rule 'unknown-rule'/);
    return true;
  });
});

test('throws EEVIDENCE when rule table declares evidence not in EVIDENCE set', () => {
  const rules = {
    'bad-evidence-rule': { sev: 'low', cwe: 1, evidence: 'not-a-valid-evidence' },
  };
  const findings = [{ rule: 'bad-evidence-rule', path: 'd.cob', line: 2 }];
  assert.throws(() => finish(rules, findings, 'test set'), (err) => {
    assert.equal(err.code, 'EEVIDENCE');
    assert.equal(err.rule, 'bad-evidence-rule');
    assert.equal(err.set, 'test set');
    assert.match(err.message, /rule 'bad-evidence-rule' declares evidence 'not-a-valid-evidence'/);
    return true;
  });
});

test('sorts findings by rule, then path, then line', () => {
  const rules = {
    'rule-z': { sev: 'low', cwe: 1, evidence: 'construct' },
    'rule-a': { sev: 'high', cwe: 2, evidence: 'path' },
  };
  const findings = [
    { rule: 'rule-z', path: 'a.cob', line: 5 },
    { rule: 'rule-a', path: 'b.cob', line: 10 },
    { rule: 'rule-a', path: 'a.cob', line: 3 },
  ];
  const result = finish(rules, findings, 'test set');
  assert.equal(result.findings[0].rule, 'rule-a');
  assert.equal(result.findings[0].path, 'a.cob');
  assert.equal(result.findings[0].line, 3);
  assert.equal(result.findings[1].rule, 'rule-a');
  assert.equal(result.findings[1].path, 'b.cob');
  assert.equal(result.findings[1].line, 10);
  assert.equal(result.findings[2].rule, 'rule-z');
  assert.equal(result.findings[2].path, 'a.cob');
  assert.equal(result.findings[2].line, 5);
});

test('treats missing line as 0 for sorting purposes', () => {
  const rules = {
    'rule-x': { sev: 'medium', cwe: 3, evidence: 'exposure' },
  };
  const findings = [
    { rule: 'rule-x', path: 'a.cob', line: 5 },
    { rule: 'rule-x', path: 'a.cob' },
  ];
  const result = finish(rules, findings, 'test set');
  assert.equal(result.findings[0].line, undefined);
  assert.equal(result.findings[1].line, 5);
});

test('tallies counts by rule correctly', () => {
  const rules = {
    'rule-1': { sev: 'low', cwe: 1, evidence: 'construct' },
    'rule-2': { sev: 'high', cwe: 2, evidence: 'path' },
  };
  const findings = [
    { rule: 'rule-1', path: 'a.cob', line: 1 },
    { rule: 'rule-2', path: 'b.cob', line: 2 },
    { rule: 'rule-1', path: 'c.cob', line: 3 },
    { rule: 'rule-1', path: 'd.cob', line: 4 },
  ];
  const result = finish(rules, findings, 'test set');
  assert.deepEqual(result.byRule, { 'rule-1': 3, 'rule-2': 1 });
});
