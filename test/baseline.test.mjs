// Judgements over findings: what a baseline suppresses, for how long, and what it may not hide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanAll } from '../lib/scan.mjs';
import { toSarif } from '../lib/sarif.mjs';
import { applyBaseline, loadBaseline, validateEntry, BASELINE_FILE } from '../lib/baseline.mjs';
import './pin-machine.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cobolwork.mjs');
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const inTemp = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-baseline-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

const PROGRAM = [
  '       IDENTIFICATION DIVISION.',
  '       PROGRAM-ID. RUNCMD.',
  '       DATA DIVISION.',
  '       WORKING-STORAGE SECTION.',
  '       01 WS-IN  PIC X(80).',
  '       PROCEDURE DIVISION.',
  '           ACCEPT WS-IN FROM COMMAND-LINE',
  "           CALL 'SYSTEM' USING WS-IN",
  '           GOBACK.',
  '',
].join('\n');
// A comment written to steer whatever reads the source next: the hidden set's tampering case.
const HIDDEN = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'bench', 'cases', '011-comment-directs-its-reader', 'HCOMMENT.cbl'), 'latin1');

const entry = (f, over = {}) => ({ fingerprint: f.fingerprint, rule: f.rule, path: f.path, action: 'accept', reason: 'a fixed command table replaces this next quarter', who: 'reviewer', at: '2026-01-01T00:00:00.000Z', expires: '2099-01-01T00:00:00.000Z', ...over });
const baselineOf = (entries, source = 'explicit') => ({ path: 'b.json', source, entries, problems: [] });

test('a suppressed finding leaves the findings and the counts, and says who judged it and until when', () => inTemp((dir) => {
  writeFileSync(join(dir, 'RUNCMD.cbl'), PROGRAM);
  const report = scanAll(dir, { only: ['flow'] });
  const f = report.findings.find((x) => x.rule === 'argv-or-env-to-os-command');
  const before = report.summary.findings;
  applyBaseline(report, baselineOf([entry(f)]), { now: '2026-09-24T00:00:00.000Z' });
  assert.equal(report.summary.findings, before - 1);
  assert.equal(report.summary.byRule['argv-or-env-to-os-command'], undefined);
  assert.equal(report.findings.some((x) => x.fingerprint === f.fingerprint), false);
  assert.equal(report.suppressed.length, 1);
  assert.equal(report.suppressed[0].suppressed.who, 'reviewer');
  assert.equal(report.suppressed[0].suppressed.expires, '2099-01-01T00:00:00.000Z');
  assert.deepEqual({ ...report.summary.baseline, path: null }, { path: null, source: 'explicit', suppressed: 1, expired: 0, stale: 0 });
}));

test('a lapsed judgement suppresses nothing, and the finding comes back naming the judgement that lapsed', () => inTemp((dir) => {
  writeFileSync(join(dir, 'RUNCMD.cbl'), PROGRAM);
  const report = scanAll(dir, { only: ['flow'] });
  const f = report.findings.find((x) => x.rule === 'argv-or-env-to-os-command');
  applyBaseline(report, baselineOf([entry(f, { expires: '2026-06-30T00:00:00.000Z' })]), { now: '2026-09-24T00:00:00.000Z' });
  assert.ok(report.findings.some((x) => x.fingerprint === f.fingerprint));
  assert.equal(report.summary.baseline.expired, 1);
  assert.equal(report.baselineExpired[0].expired, '2026-06-30T00:00:00.000Z');
  assert.equal(report.baselineExpired[0].reason, entry(f).reason);
}));

test('a suppression with no expiry, or a note, suppresses nothing', () => inTemp((dir) => {
  const bad = { ...entry({ fingerprint: 'a'.repeat(32), rule: 'r', path: 'p' }) };
  delete bad.expires;
  assert.match(validateEntry(bad).join(' '), /needs an expires date/);
  assert.deepEqual(validateEntry({ ...bad, action: 'note' }), [], 'a note hides nothing, so it needs no date');

  writeFileSync(join(dir, 'RUNCMD.cbl'), PROGRAM);
  writeFileSync(join(dir, BASELINE_FILE), JSON.stringify({ entries: [bad] }));
  const held = loadBaseline(dir);
  assert.equal(held.entries.length, 0);
  assert.equal(held.problems.length, 1);
  const report = scanAll(dir, { only: ['flow'] });
  const f = report.findings.find((x) => x.rule === 'argv-or-env-to-os-command');
  applyBaseline(report, baselineOf([entry(f, { action: 'note' })]), { now: '2026-09-24T00:00:00.000Z' });
  assert.equal(report.suppressed.length, 0);
}));

test('the tree cannot hide its own tampering; a baseline from outside it can', () => inTemp((dir) => {
  writeFileSync(join(dir, 'HIDE.cbl'), HIDDEN);
  const scan = () => scanAll(dir, { only: ['hidden'] });
  const f = scan().findings.find((x) => x.evidence === 'tampering');
  assert.ok(f, 'the fixture trips a tampering rule');
  const inTree = applyBaseline(scan(), baselineOf([entry(f)], 'tree'), { now: '2026-09-24T00:00:00.000Z' });
  assert.ok(inTree.findings.some((x) => x.fingerprint === f.fingerprint));
  assert.equal(inTree.summary.baseline.refused, 1);
  const outside = applyBaseline(scan(), baselineOf([entry(f)], 'explicit'), { now: '2026-09-24T00:00:00.000Z' });
  assert.equal(outside.suppressed.length, 1);
}));

test('an entry matching nothing is counted as stale', () => inTemp((dir) => {
  writeFileSync(join(dir, 'RUNCMD.cbl'), PROGRAM);
  const report = scanAll(dir, { only: ['flow'] });
  applyBaseline(report, baselineOf([entry({ fingerprint: 'b'.repeat(32), rule: 'argv-or-env-to-os-command', path: 'GONE.cbl' })]), { now: '2026-09-24T00:00:00.000Z' });
  assert.equal(report.summary.baseline.stale, 1);
  assert.equal(report.summary.baseline.suppressed, 0);
}));

test('SARIF keeps a suppressed finding as a result a person accepted', () => inTemp((dir) => {
  writeFileSync(join(dir, 'RUNCMD.cbl'), PROGRAM);
  const report = scanAll(dir, { only: ['flow'] });
  const f = report.findings.find((x) => x.rule === 'argv-or-env-to-os-command');
  applyBaseline(report, baselineOf([entry(f)]), { now: '2026-09-24T00:00:00.000Z' });
  const results = toSarif(report).runs[0].results;
  const r = results.find((x) => x.partialFingerprints?.['cobolwork/v1'] === f.fingerprint);
  assert.equal(r.suppressions[0].status, 'accepted');
  assert.match(r.suppressions[0].justification, /reviewer until 2099/);
}));

test('cobolwork baseline does not write through a link the tree put where its file goes', () => inTemp((dir) => {
  mkdirSync(join(dir, 'repo'));
  writeFileSync(join(dir, 'repo', 'RUNCMD.cbl'), PROGRAM);
  const target = join(dir, 'outside.txt');
  symlinkSync(target, join(dir, 'repo', BASELINE_FILE));
  const r = cli('baseline', join(dir, 'repo'), '--reason', 'r', '--who', 'w', '--expires', '2099-01-01');
  assert.equal(r.status, 2, r.stdout);
  assert.match(r.stderr, /symbolic link/);
  assert.equal(existsSync(target), false, 'nothing was created outside the tree');
}));

test('cobolwork baseline writes dated judgements, keeps old ones, and a rescan then shows none of them', () => inTemp((dir) => {
  writeFileSync(join(dir, 'RUNCMD.cbl'), PROGRAM);
  assert.equal(cli('baseline', dir, '--reason', 'r', '--who', 'w').status, 2, 'no expiry, no baseline');
  assert.equal(cli('baseline', dir, '--reason', 'r', '--who', 'w', '--expires', '2001-01-01').status, 2, 'an expiry in the past');
  const wrote = cli('baseline', dir, '--reason', 'accepted for the migration', '--who', 'reviewer', '--expires', '2099-01-01', '--only', 'flow');
  assert.equal(wrote.status, 0, wrote.stderr);
  const file = JSON.parse(readFileSync(join(dir, BASELINE_FILE), 'utf8'));
  assert.ok(file.entries.length > 0);
  for (const e of file.entries) assert.deepEqual(validateEntry(e), [], JSON.stringify(e));
  const again = cli('baseline', dir, '--reason', 'different', '--who', 'someone-else', '--expires', '2099-06-01', '--only', 'flow');
  assert.equal(JSON.parse(again.stdout).added, 0, 'nothing already judged is judged again');
  assert.equal(JSON.parse(readFileSync(join(dir, BASELINE_FILE), 'utf8')).entries[0].who, 'reviewer');

  const rescan = JSON.parse(cli('scan', dir, '--only', 'flow').stdout);
  assert.equal(rescan.summary.findings, 0);
  assert.equal(rescan.summary.baseline.suppressed, file.entries.length);
  const ignored = JSON.parse(cli('scan', dir, '--only', 'flow', '--no-baseline').stdout);
  assert.equal(ignored.summary.findings, file.entries.length);
}));
