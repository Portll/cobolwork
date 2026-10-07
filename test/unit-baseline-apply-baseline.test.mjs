// Moves baseline-suppressed findings out of the report, recounts, and records what it did (lib/baseline.mjs applyBaseline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBaseline } from '../lib/baseline.mjs';
import './pin-machine.mjs';

test('returns the report unchanged when the baseline is falsy', () => {
  const report = { findings: [{ fingerprint: 'a', rule: 'r', path: 'p', line: 1, sev: 'high', evidence: 'e' }] };
  const out = applyBaseline(report, null);
  assert.strictEqual(out, report);
  assert.strictEqual(out.findings.length, 1);
  assert.strictEqual(out.suppressed, undefined);
  assert.strictEqual(out.summary, undefined);
});

test('suppresses a finding whose baseline entry is live at the given time', () => {
  const report = {
    findings: [{ fingerprint: 'a', rule: 'r', path: 'p', line: 1, sev: 'high', evidence: 'e' }],
    summary: { findings: 1, byRule: { r: 1 }, bySeverity: { high: 1 }, byEvidence: { e: 1 } },
  };
  const baseline = {
    path: 'b.json',
    source: 'outside',
    problems: [],
    entries: [{ fingerprint: 'a', rule: 'r', action: 'wont-fix', reason: 'ok', who: 'me', at: '2026-01-01T00:00:00Z', expires: '2026-01-02T00:00:00Z' }],
  };
  const out = applyBaseline(report, baseline, { now: '2026-01-01T12:00:00Z' });
  assert.strictEqual(out.findings.length, 0);
  assert.strictEqual(out.suppressed.length, 1);
  assert.strictEqual(out.suppressed[0].fingerprint, 'a');
  assert.strictEqual(out.suppressed[0].suppressed.action, 'wont-fix');
  assert.strictEqual(out.suppressed[0].suppressed.reason, 'ok');
  assert.strictEqual(out.suppressed[0].suppressed.who, 'me');
  assert.strictEqual(out.suppressed[0].suppressed.at, '2026-01-01T00:00:00Z');
  assert.strictEqual(out.suppressed[0].suppressed.expires, '2026-01-02T00:00:00Z');
  assert.strictEqual(out.summary.findings, 0);
  assert.deepStrictEqual(out.summary.byRule, {});
  assert.deepStrictEqual(out.summary.bySeverity, {});
  assert.deepStrictEqual(out.summary.byEvidence, {});
  assert.strictEqual(out.summary.baseline.path, 'b.json');
  assert.strictEqual(out.summary.baseline.source, 'outside');
  assert.strictEqual(out.summary.baseline.suppressed, 1);
  assert.strictEqual(out.summary.baseline.expired, 0);
  assert.strictEqual(out.summary.baseline.stale, 0);
  assert.strictEqual(out.summary.baseline.refused, undefined);
  assert.strictEqual(out.summary.baseline.problems, undefined);
  assert.strictEqual(out.baselineExpired, undefined);
});

test('leaves a finding open and records it as expired when its baseline entry has lapsed', () => {
  const report = {
    findings: [{ fingerprint: 'a', rule: 'r', path: 'p', line: 1, sev: 'high', evidence: 'e' }],
    summary: { findings: 1, byRule: { r: 1 }, bySeverity: { high: 1 }, byEvidence: { e: 1 } },
  };
  const baseline = {
    path: 'b.json',
    source: 'outside',
    problems: [],
    entries: [{ fingerprint: 'a', rule: 'r', action: 'wont-fix', reason: 'ok', who: 'me', at: '2026-01-01T00:00:00Z', expires: '2026-01-01T12:00:00Z' }],
  };
  const out = applyBaseline(report, baseline, { now: '2026-01-01T12:00:00Z' });
  assert.strictEqual(out.findings.length, 1);
  assert.strictEqual(out.findings[0].fingerprint, 'a');
  assert.strictEqual(out.suppressed.length, 0);
  assert.strictEqual(out.baselineExpired.length, 1);
  assert.strictEqual(out.baselineExpired[0].fingerprint, 'a');
  assert.strictEqual(out.baselineExpired[0].rule, 'r');
  assert.strictEqual(out.baselineExpired[0].path, 'p');
  assert.strictEqual(out.baselineExpired[0].line, 1);
  assert.strictEqual(out.baselineExpired[0].expired, '2026-01-01T12:00:00Z');
  assert.strictEqual(out.baselineExpired[0].reason, 'ok');
  assert.strictEqual(out.baselineExpired[0].who, 'me');
  assert.strictEqual(out.summary.findings, 1);
  assert.deepStrictEqual(out.summary.byRule, { r: 1 });
  assert.strictEqual(out.summary.baseline.expired, 1);
  assert.strictEqual(out.summary.baseline.suppressed, 0);
  assert.strictEqual(out.summary.baseline.stale, 0);
});

test('refuses to suppress a tampering finding when the baseline comes from the scanned tree', () => {
  const report = {
    findings: [{ fingerprint: 'a', rule: 'r', path: 'p', line: 1, sev: 'high', evidence: 'tampering' }],
    summary: { findings: 1, byRule: { r: 1 }, bySeverity: { high: 1 }, byEvidence: { tampering: 1 } },
  };
  const baseline = {
    path: 'b.json',
    source: 'tree',
    problems: [],
    entries: [{ fingerprint: 'a', rule: 'r', action: 'wont-fix', reason: 'ok', who: 'me', at: '2026-01-01T00:00:00Z', expires: '2026-01-02T00:00:00Z' }],
  };
  const out = applyBaseline(report, baseline, { now: '2026-01-01T12:00:00Z' });
  assert.strictEqual(out.findings.length, 1);
  assert.strictEqual(out.findings[0].fingerprint, 'a');
  assert.strictEqual(out.suppressed.length, 0);
  assert.strictEqual(out.summary.baseline.refused, 1);
  assert.strictEqual(out.summary.baseline.refusedWhy, 'a baseline inside the scanned tree cannot hide tampering; pass one from outside the tree with --baseline');
  assert.strictEqual(out.summary.baseline.suppressed, 0);
  assert.strictEqual(out.summary.baseline.expired, 0);
  assert.strictEqual(out.summary.baseline.stale, 0);
});

test('counts baseline entries that no finding matched as stale', () => {
  const report = {
    findings: [{ fingerprint: 'a', rule: 'r', path: 'p', line: 1, sev: 'high', evidence: 'e' }],
    summary: { findings: 1, byRule: { r: 1 }, bySeverity: { high: 1 }, byEvidence: { e: 1 } },
  };
  const baseline = {
    path: 'b.json',
    source: 'outside',
    problems: [],
    entries: [
      { fingerprint: 'a', rule: 'r', action: 'wont-fix', reason: 'ok', who: 'me', at: '2026-01-01T00:00:00Z', expires: '2026-01-02T00:00:00Z' },
      { fingerprint: 'z', rule: 'r', action: 'wont-fix', reason: 'ok', who: 'me', at: '2026-01-01T00:00:00Z', expires: '2026-01-02T00:00:00Z' },
    ],
  };
  const out = applyBaseline(report, baseline, { now: '2026-01-01T12:00:00Z' });
  assert.strictEqual(out.summary.baseline.stale, 1);
  assert.strictEqual(out.summary.baseline.suppressed, 1);
  assert.strictEqual(out.findings.length, 0);
});

test('reports baseline problems when the baseline carries any', () => {
  const report = { findings: [], summary: { findings: 0, byRule: {} } };
  const baseline = {
    path: 'b.json',
    source: 'outside',
    problems: ['bad entry'],
    entries: [],
  };
  const out = applyBaseline(report, baseline, { now: '2026-01-01T12:00:00Z' });
  assert.deepStrictEqual(out.summary.baseline.problems, ['bad entry']);
  assert.strictEqual(out.summary.baseline.stale, 0);
  assert.strictEqual(out.summary.baseline.suppressed, 0);
});

test('recounts byExploitability over the open findings', () => {
  const report = {
    findings: [
      { fingerprint: 'a', rule: 'r', path: 'p', line: 1, sev: 'high', evidence: 'e', exploitability: { verdict: 'yes' } },
      { fingerprint: 'b', rule: 'r', path: 'p', line: 2, sev: 'low', evidence: 'e', exploitability: { verdict: 'no' } },
    ],
    summary: { findings: 2, byRule: { r: 2 }, bySeverity: { high: 1, low: 1 }, byEvidence: { e: 2 }, byExploitability: { yes: 1, no: 1, maybe: 0 } },
  };
  const baseline = {
    path: 'b.json',
    source: 'outside',
    problems: [],
    entries: [{ fingerprint: 'a', rule: 'r', action: 'wont-fix', reason: 'ok', who: 'me', at: '2026-01-01T00:00:00Z', expires: '2026-01-02T00:00:00Z' }],
  };
  const out = applyBaseline(report, baseline, { now: '2026-01-01T12:00:00Z' });
  assert.strictEqual(out.findings.length, 1);
  assert.deepStrictEqual(out.summary.byExploitability, { yes: 0, no: 1, maybe: 0 });
  assert.strictEqual(out.summary.baseline.suppressed, 1);
});

test('treats a baseline entry whose action is not suppressing as not live', () => {
  const report = {
    findings: [{ fingerprint: 'a', rule: 'r', path: 'p', line: 1, sev: 'high', evidence: 'e' }],
    summary: { findings: 1, byRule: { r: 1 }, bySeverity: { high: 1 }, byEvidence: { e: 1 } },
  };
  const baseline = {
    path: 'b.json',
    source: 'outside',
    problems: [],
    entries: [{ fingerprint: 'a', rule: 'r', action: 'note', reason: 'ok', who: 'me', at: '2026-01-01T00:00:00Z', expires: '2026-01-02T00:00:00Z' }],
  };
  const out = applyBaseline(report, baseline, { now: '2026-01-01T12:00:00Z' });
  assert.strictEqual(out.findings.length, 1);
  assert.strictEqual(out.suppressed.length, 0);
  assert.strictEqual(out.baselineExpired, undefined);
  assert.strictEqual(out.summary.baseline.stale, 0);
  assert.strictEqual(out.summary.baseline.suppressed, 0);
  assert.strictEqual(out.summary.baseline.expired, 0);
});

test('treats a baseline entry whose start time equals now as live', () => {
  const report = {
    findings: [{ fingerprint: 'a', rule: 'r', path: 'p', line: 1, sev: 'high', evidence: 'e' }],
    summary: { findings: 1, byRule: { r: 1 }, bySeverity: { high: 1 }, byEvidence: { e: 1 } },
  };
  const baseline = {
    path: 'b.json',
    source: 'outside',
    problems: [],
    entries: [{ fingerprint: 'a', rule: 'r', action: 'wont-fix', reason: 'ok', who: 'me', at: '2026-01-01T12:00:00Z', expires: '2026-01-02T00:00:00Z' }],
  };
  const out = applyBaseline(report, baseline, { now: '2026-01-01T12:00:00Z' });
  assert.strictEqual(out.findings.length, 0);
  assert.strictEqual(out.suppressed.length, 1);
  assert.strictEqual(out.summary.baseline.suppressed, 1);
  assert.strictEqual(out.summary.baseline.expired, 0);
});

test('treats a baseline entry whose expiry equals now as lapsed', () => {
  const report = {
    findings: [{ fingerprint: 'a', rule: 'r', path: 'p', line: 1, sev: 'high', evidence: 'e' }],
    summary: { findings: 1, byRule: { r: 1 }, bySeverity: { high: 1 }, byEvidence: { e: 1 } },
  };
  const baseline = {
    path: 'b.json',
    source: 'outside',
    problems: [],
    entries: [{ fingerprint: 'a', rule: 'r', action: 'wont-fix', reason: 'ok', who: 'me', at: '2026-01-01T00:00:00Z', expires: '2026-01-01T12:00:00Z' }],
  };
  const out = applyBaseline(report, baseline, { now: '2026-01-01T12:00:00Z' });
  assert.strictEqual(out.findings.length, 1);
  assert.strictEqual(out.suppressed.length, 0);
  assert.strictEqual(out.baselineExpired.length, 1);
  assert.strictEqual(out.summary.baseline.expired, 1);
  assert.strictEqual(out.summary.baseline.suppressed, 0);
});

test('recounts bySeverity and byEvidence over the open findings', () => {
  const report = {
    findings: [
      { fingerprint: 'a', rule: 'r', path: 'p', line: 1, sev: 'high', evidence: 'e1' },
      { fingerprint: 'b', rule: 'r', path: 'p', line: 2, sev: 'high', evidence: 'e2' },
      { fingerprint: 'c', rule: 'r', path: 'p', line: 3, sev: 'low', evidence: 'e1' },
    ],
    summary: { findings: 3, byRule: { r: 3 }, bySeverity: { high: 2, low: 1 }, byEvidence: { e1: 2, e2: 1 } },
  };
  const baseline = {
    path: 'b.json',
    source: 'outside',
    problems: [],
    entries: [{ fingerprint: 'a', rule: 'r', action: 'wont-fix', reason: 'ok', who: 'me', at: '2026-01-01T00:00:00Z', expires: '2026-01-02T00:00:00Z' }],
  };
  const out = applyBaseline(report, baseline, { now: '2026-01-01T12:00:00Z' });
  assert.strictEqual(out.findings.length, 2);
  assert.deepStrictEqual(out.summary.bySeverity, { high: 1, low: 1 });
  assert.deepStrictEqual(out.summary.byEvidence, { e1: 1, e2: 1 });
  assert.strictEqual(out.summary.baseline.suppressed, 1);
});
