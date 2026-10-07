// Filters and sorts report findings into display rows (lib/tui/model.mjs rows).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rows } from '../lib/tui/model.mjs';
import './pin-machine.mjs';

test('returns empty array when report has no findings', () => {
  const report = { findings: [] };
  const result = rows(report);
  assert.deepEqual(result, []);
});

test('maps finding fields to row properties with defaults', () => {
  const report = {
    findings: [
      {
        sev: 'high',
        rule: 'R1',
        program: 'PROG1',
        path: 'src/prog1.cob',
        line: 42,
        evidence: 'E1',
        exploitability: { verdict: 'V1' },
        crossProgram: true,
        detail: 'some detail'
      }
    ]
  };
  const result = rows(report);
  assert.equal(result.length, 1);
  const row = result[0];
  assert.equal(row.sev, 'high');
  assert.equal(row.letter, 'H');
  assert.equal(row.evidence, 'E1');
  assert.equal(row.exploit, 'V1');
  assert.equal(row.rule, 'R1');
  assert.equal(row.program, 'PROG1');
  assert.equal(row.path, 'src/prog1.cob');
  assert.equal(row.line, 42);
  assert.equal(row.where, 'prog1.cob:42');
  assert.equal(row.cross, true);
});

test('uses question mark for unknown severity letter', () => {
  const report = {
    findings: [
      {
        sev: 'unknown',
        rule: 'R1',
        program: 'PROG1',
        path: 'src/prog1.cob',
        line: 1,
        evidence: 'E1',
        exploitability: { verdict: 'V1' }
      }
    ]
  };
  const result = rows(report);
  assert.equal(result[0].letter, '?');
});

test('filters findings by evidence when view.evidence is set', () => {
  const report = {
    findings: [
      { sev: 'high', rule: 'R1', program: 'P1', path: 'a.cob', line: 1, evidence: 'E1', exploitability: { verdict: 'V1' } },
      { sev: 'med', rule: 'R2', program: 'P2', path: 'b.cob', line: 2, evidence: 'E2', exploitability: { verdict: 'V2' } }
    ]
  };
  const result = rows(report, { sort: 'severity', evidence: ['E1'], exploit: null, find: '' });
  assert.equal(result.length, 1);
  assert.equal(result[0].evidence, 'E1');
});

test('filters findings by exploitability verdict when view.exploit is set', () => {
  const report = {
    findings: [
      { sev: 'high', rule: 'R1', program: 'P1', path: 'a.cob', line: 1, evidence: 'E1', exploitability: { verdict: 'V1' } },
      { sev: 'med', rule: 'R2', program: 'P2', path: 'b.cob', line: 2, evidence: 'E2', exploitability: { verdict: 'V2' } }
    ]
  };
  const result = rows(report, { sort: 'severity', evidence: null, exploit: ['V2'], find: '' });
  assert.equal(result.length, 1);
  assert.equal(result[0].exploit, 'V2');
});

test('filters findings by case-insensitive find across rule, program, path, and detail', () => {
  const report = {
    findings: [
      { sev: 'high', rule: 'RULE_A', program: 'PROG_X', path: 'src/file.cob', line: 1, evidence: 'E1', exploitability: { verdict: 'V1' }, detail: 'some text' },
      { sev: 'med', rule: 'RULE_B', program: 'PROG_Y', path: 'other/file.cob', line: 2, evidence: 'E2', exploitability: { verdict: 'V2' }, detail: 'other text' }
    ]
  };
  const result = rows(report, { sort: 'severity', evidence: null, exploit: null, find: 'rule_a' });
  assert.equal(result.length, 1);
  assert.equal(result[0].rule, 'RULE_A');
});

test('sorts by severity with crit before high before med before low before info', () => {
  const report = {
    findings: [
      { sev: 'low', rule: 'R1', program: 'P1', path: 'a.cob', line: 1, evidence: 'E1', exploitability: { verdict: 'V1' } },
      { sev: 'crit', rule: 'R2', program: 'P2', path: 'b.cob', line: 2, evidence: 'E2', exploitability: { verdict: 'V2' } },
      { sev: 'high', rule: 'R3', program: 'P3', path: 'c.cob', line: 3, evidence: 'E3', exploitability: { verdict: 'V3' } },
      { sev: 'med', rule: 'R4', program: 'P4', path: 'd.cob', line: 4, evidence: 'E4', exploitability: { verdict: 'V4' } },
      { sev: 'info', rule: 'R5', program: 'P5', path: 'e.cob', line: 5, evidence: 'E5', exploitability: { verdict: 'V5' } }
    ]
  };
  const result = rows(report, { sort: 'severity', evidence: null, exploit: null, find: '' });
  const sevs = result.map(r => r.sev);
  assert.deepEqual(sevs, ['crit', 'high', 'med', 'low', 'info']);
});

test('sorts by rule alphabetically when sort is rule', () => {
  const report = {
    findings: [
      { sev: 'high', rule: 'ZULU', program: 'P1', path: 'a.cob', line: 1, evidence: 'E1', exploitability: { verdict: 'V1' } },
      { sev: 'high', rule: 'ALPHA', program: 'P2', path: 'b.cob', line: 2, evidence: 'E2', exploitability: { verdict: 'V2' } },
      { sev: 'high', rule: 'MIKE', program: 'P3', path: 'c.cob', line: 3, evidence: 'E3', exploitability: { verdict: 'V3' } }
    ]
  };
  const result = rows(report, { sort: 'rule', evidence: null, exploit: null, find: '' });
  const rules = result.map(r => r.rule);
  assert.deepEqual(rules, ['ALPHA', 'MIKE', 'ZULU']);
});

test('sorts by program name when sort is program', () => {
  const report = {
    findings: [
      { sev: 'high', rule: 'R1', program: 'ZPROG', path: 'a.cob', line: 1, evidence: 'E1', exploitability: { verdict: 'V1' } },
      { sev: 'high', rule: 'R2', program: 'APROG', path: 'b.cob', line: 2, evidence: 'E2', exploitability: { verdict: 'V2' } },
      { sev: 'high', rule: 'R3', program: 'MPROG', path: 'c.cob', line: 3, evidence: 'E3', exploitability: { verdict: 'V3' } }
    ]
  };
  const result = rows(report, { sort: 'program', evidence: null, exploit: null, find: '' });
  const programs = result.map(r => r.program);
  assert.deepEqual(programs, ['APROG', 'MPROG', 'ZPROG']);
});

test('handles missing optional fields with empty string or zero defaults', () => {
  const report = {
    findings: [
      {
        sev: 'med',
        rule: 'R1',
        program: 'P1',
        path: '',
        line: 0,
        evidence: '',
        exploitability: null,
        crossProgram: false
      }
    ]
  };
  const result = rows(report);
  const row = result[0];
  assert.equal(row.evidence, '');
  assert.equal(row.exploit, '');
  assert.equal(row.path, '');
  assert.equal(row.line, 0);
  assert.equal(row.where, '');
  assert.equal(row.cross, false);
});
