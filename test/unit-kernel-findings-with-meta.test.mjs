// Stamps severity, CWE and evidence onto findings from a rule table, refusing unknown rule ids and invalid evidence (lib/kernel/findings.mjs withMeta).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withMeta } from '../lib/kernel/findings.mjs';
import './pin-machine.mjs';

test('stamps missing severity, cwe, and evidence from the rule table', () => {
  const rules = { r1: { sev: 'high', cwe: 79, evidence: 'path' } };
  const findings = [{ rule: 'r1' }];
  const result = withMeta(rules, findings);
  assert.strictEqual(result, findings);
  assert.strictEqual(findings[0].sev, 'high');
  assert.strictEqual(findings[0].cwe, 79);
  assert.strictEqual(findings[0].evidence, 'path');
});

test('keeps existing severity, cwe, and evidence on the finding', () => {
  const rules = { r1: { sev: 'high', cwe: 79, evidence: 'path' } };
  const findings = [{ rule: 'r1', sev: 'low', cwe: 89, evidence: 'construct' }];
  const result = withMeta(rules, findings);
  assert.strictEqual(result, findings);
  assert.strictEqual(findings[0].sev, 'low');
  assert.strictEqual(findings[0].cwe, 89);
  assert.strictEqual(findings[0].evidence, 'construct');
});

test('throws ERULEID when the finding names a rule not in the table', () => {
  const rules = { r1: { sev: 'high', cwe: 79, evidence: 'path' } };
  const findings = [{ rule: 'unknown' }];
  assert.throws(() => withMeta(rules, findings), (err) => {
    assert.strictEqual(err.code, 'ERULEID');
    assert.strictEqual(err.rule, 'unknown');
    assert.strictEqual(err.set, 'rule set');
    assert.match(err.message, /a finding names rule 'unknown'/);
    return true;
  });
});

test('throws EEVIDENCE when the stamped evidence is not a valid EVIDENCE key', () => {
  const rules = { r1: { sev: 'high', cwe: 79, evidence: 'bogus' } };
  const findings = [{ rule: 'r1' }];
  assert.throws(() => withMeta(rules, findings), (err) => {
    assert.strictEqual(err.code, 'EEVIDENCE');
    assert.strictEqual(err.rule, 'r1');
    assert.strictEqual(err.set, 'rule set');
    assert.match(err.message, /declares evidence 'bogus'/);
    return true;
  });
});

test('throws EEVIDENCE when the finding carries an invalid evidence value', () => {
  const rules = { r1: { sev: 'high', cwe: 79, evidence: 'path' } };
  const findings = [{ rule: 'r1', evidence: 'not-a-key' }];
  assert.throws(() => withMeta(rules, findings), (err) => {
    assert.strictEqual(err.code, 'EEVIDENCE');
    assert.strictEqual(err.rule, 'r1');
    assert.strictEqual(err.set, 'rule set');
    assert.match(err.message, /declares evidence 'not-a-key'/);
    return true;
  });
});

test('stamps cwe as null when the rule table has no cwe property', () => {
  const rules = { r1: { sev: 'medium', evidence: 'advisory' } };
  const findings = [{ rule: 'r1' }];
  const result = withMeta(rules, findings);
  assert.strictEqual(result, findings);
  assert.strictEqual(findings[0].sev, 'medium');
  assert.strictEqual(findings[0].cwe, null);
  assert.strictEqual(findings[0].evidence, 'advisory');
});

test('uses the custom set name in error messages', () => {
  const rules = { r1: { sev: 'high', cwe: 79, evidence: 'path' } };
  const findings = [{ rule: 'missing' }];
  assert.throws(() => withMeta(rules, findings, 'vendor pack'), (err) => {
    assert.strictEqual(err.code, 'ERULEID');
    assert.strictEqual(err.set, 'vendor pack');
    assert.match(err.message, /vendor pack: a finding names rule 'missing'/);
    return true;
  });
});

test('processes multiple findings and returns the same array reference', () => {
  const rules = {
    r1: { sev: 'high', cwe: 79, evidence: 'path' },
    r2: { sev: 'low', cwe: 89, evidence: 'construct' },
  };
  const findings = [
    { rule: 'r1' },
    { rule: 'r2', sev: 'critical' },
  ];
  const result = withMeta(rules, findings);
  assert.strictEqual(result, findings);
  assert.strictEqual(findings[0].sev, 'high');
  assert.strictEqual(findings[0].cwe, 79);
  assert.strictEqual(findings[0].evidence, 'path');
  assert.strictEqual(findings[1].sev, 'critical');
  assert.strictEqual(findings[1].cwe, 89);
  assert.strictEqual(findings[1].evidence, 'construct');
});
