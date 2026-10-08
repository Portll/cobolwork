// Precision from machine labels (docs/spec/reach.md §9.6): each number names its label source, and
// an unknown widens the range rather than counting either way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { precision, outcomeOf, measure, markdown } from '../bench/precision.mjs';
import { scanAll } from '../lib/scan.mjs';
import { scoreVerdicts, wilson, report } from '../diag/score-corpus.mjs';
import './pin-machine.mjs';

const CASES = join(dirname(fileURLToPath(import.meta.url)), '..', 'bench', 'cases');

function withFiles(docs, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-precision-'));
  try {
    const files = docs.map((d, i) => { const f = join(dir, `labels-${i}.json`); writeFileSync(f, JSON.stringify(d)); return f; });
    return fn(files);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('a label says right, wrong, unknown or missed, and an unreported near-miss says nothing', () => {
  assert.equal(outcomeOf({ source: 'execution', label: 'confirmed' }), 'right');
  assert.equal(outcomeOf({ source: 'execution', label: 'refuted' }), 'wrong');
  assert.equal(outcomeOf({ source: 'execution', label: 'unknown' }), 'unknown');
  assert.equal(outcomeOf({ source: 'planted', label: 'flaw', reported: true }), 'right');
  assert.equal(outcomeOf({ source: 'planted', label: 'near-miss', reported: true }), 'wrong');
  assert.equal(outcomeOf({ source: 'planted', label: 'flaw', reported: false }), 'missed');
  assert.equal(outcomeOf({ source: 'planted', label: 'near-miss', reported: false }), null);
});

test('unknowns make precision a range, and recall comes only from planted labels', () => {
  const m = measure({ labelled: 10, right: 3, wrong: 1, unknown: 6, missed: 0 }, 'execution');
  assert.deepEqual(m.precision, { low: 0.3, high: 0.9 });
  assert.equal(m.recall, undefined);
  const p = measure({ labelled: 8, right: 3, wrong: 1, unknown: 0, missed: 1 }, 'planted');
  assert.deepEqual(p.precision, { low: 0.75, high: 0.75 });
  assert.equal(p.recall, 0.75);
});

test('labels from both sources are counted per rule, each under its own source', () => withFiles([
  { labels: [
    { source: 'execution', rule: 'cics-terminal-to-log', label: 'confirmed' },
    { source: 'execution', rule: 'cics-terminal-to-log', label: 'unknown' },
  ] },
  { labels: [
    { source: 'planted', rule: 'cics-terminal-to-log', label: 'flaw', reported: true },
    { source: 'planted', rule: 'cics-terminal-to-log', label: 'near-miss', reported: true },
    { source: 'planted', rule: 'cics-terminal-to-log', label: 'near-miss', reported: false },
  ] },
], (files) => {
  const doc = precision(files);
  const r = doc.byRule['cics-terminal-to-log'];
  assert.deepEqual(r.execution.precision, { low: 0.5, high: 1 });
  assert.deepEqual(r.planted.precision, { low: 0.5, high: 0.5 });
  assert.equal(r.planted.recall, 1);
  assert.equal(doc.byVerdict, undefined);
  assert.match(markdown(doc), /\| `cics-terminal-to-log` \| execution 2 \| 1 \| 0 \| 1 \| 50% to 100% \|/);
}));

test('execution labels are joined to their findings\' verdicts by fingerprint', () => {
  const repo = '001-argv-reaches-os-command';
  const [f] = scanAll(join(CASES, repo), { only: ['flow'] }).findings.filter((x) => x.fingerprint && x.exploitability);
  assert.ok(f);
  withFiles([{ labels: [
    { source: 'execution', repo, rule: f.rule, fingerprint: f.fingerprint, label: 'confirmed' },
    { source: 'execution', repo, rule: f.rule, fingerprint: 'not-a-finding', label: 'unknown' },
  ] }], (files) => {
    const doc = precision(files, { corpus: CASES });
    assert.equal(doc.byVerdict[f.exploitability.verdict].execution.right, 1);
    assert.equal(doc.unjoined, 1);
  });
});

test('a verdict is scored from its labels, with the range the unknowns allow and a Wilson interval over the decided', () => {
  const rows = scoreVerdicts({ byVerdict: { upstream: { execution: measure({ labelled: 12, right: 8, wrong: 0, unknown: 4, missed: 0 }, 'execution') } } });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].precision, { low: 0.667, high: 1 });
  assert.equal(rows[0].decided, 8);
  assert.ok(rows[0].interval[0] > 0.6 && rows[0].interval[1] === 1);
  assert.equal(wilson(0, 0), null);
  assert.match(report({ labels: 12, sources: [{ file: 'l.json', sources: ['execution'] }] }, rows), /execution\s+12\s+8\s+0\s+4/);
});

test('labels made on a rewritten copy are their own stratum, never pooled with the source\'s own', () => {
  const rule = 'argv-or-env-to-dynamic-program-load';
  const doc = { labels: [
    { source: 'execution', rule, label: 'confirmed' },
    { source: 'execution', labelledOn: 'rewritten', rule, label: 'confirmed' },
    { source: 'execution', labelledOn: 'rewritten', rule, label: 'unknown' },
    { source: 'execution', labelledOn: 'rewritten+extended', rule, label: 'confirmed' },
  ] };
  const out = withFiles([doc], (files) => precision(files));
  assert.deepEqual(out.sources[0].sources, ['execution', 'execution-rewritten', 'execution-rewritten+extended']);
  assert.deepEqual(out.byRule[rule].execution.precision, { low: 1, high: 1 });
  assert.deepEqual(out.byRule[rule]['execution-rewritten'].precision, { low: 0.5, high: 1 });
  assert.deepEqual(out.byRule[rule]['execution-rewritten+extended'].precision, { low: 1, high: 1 });
});

test('a model label is its own stratum: the judge\'s reaches is right, does-not-reach wrong, a withheld answer unknown', () => {
  assert.equal(outcomeOf({ source: 'model', label: 'reaches' }), 'right');
  assert.equal(outcomeOf({ source: 'model', label: 'does-not-reach' }), 'wrong');
  assert.equal(outcomeOf({ source: 'model', label: 'unknown' }), 'unknown');
  const dir = mkdtempSync(join(tmpdir(), 'cobolwork-precision-model-'));
  const file = join(dir, 'model.json');
  writeFileSync(file, JSON.stringify({ labels: [
    { source: 'model', rule: 'r', label: 'reaches' }, { source: 'model', rule: 'r', label: 'does-not-reach' }, { source: 'model', rule: 'r', label: 'unknown' },
    { source: 'execution', rule: 'r', label: 'confirmed' },
  ] }));
  const doc = precision([file]);
  rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(doc.byRule.r.model.precision, { low: 0.333, high: 0.667 });
  assert.deepEqual(doc.byRule.r.execution.precision, { low: 1, high: 1 });
});
