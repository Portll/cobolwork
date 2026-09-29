// The tools for the hand-labelled corpus: a worksheet that gives away none of the engine's answers,
// a sealed key that holds them exactly, a selection a seed reproduces, and a scorer that refuses
// what the gate refuses and counts what it accepts.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { labelSheet, writeSheet, select, FILES } from '../diag/label-sheet.mjs';
import { score, readKey, readLabels, rowsFromWorksheet, wilson, report } from '../diag/score-corpus.mjs';
import { EXPLOITABILITY } from '../lib/kernel/findings.mjs';
import { analyze } from '../lib/dataflow.mjs';
import { scan } from '../lib/sets/flow.mjs';
import { setMemoryReaders } from '../lib/kernel/memory.mjs';
import { verifyRow } from '../feed/verify.mjs';
import './pin-machine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CASES = join(ROOT, 'bench', 'cases');
// Five programs the engine reports a path in and three it does not, one repository each.
const REPOS = ['001-argv-reaches-os-command', '002-argv-not-the-argument-passed', '003-terminal-input-chooses-program',
  '004-web-input-built-into-sql', '005-literal-command-and-literal-sql', '017-sibling-of-tainted-field',
  '037-a-job-parameter-reaches-an-os-command', '053-terminal-input-chooses-a-table-row'];

// The machine is declared rather than asked. These tests are about labelling, and a memory guard
// stopping on a busy box would turn them into a measurement of the box.
setMemoryReaders({ free: () => 4096 * 1024 * 1024 });

const work = mkdtempSync(join(tmpdir(), 'cobolwork-label-'));
const corpus = join(work, 'corpus');
for (const r of REPOS) cpSync(join(CASES, r), join(corpus, r), { recursive: true });
after(() => { rmSync(work, { recursive: true, force: true }); setMemoryReaders(); });

const made = labelSheet(corpus, { programs: 8, seed: 'test' });
const sheetDir = join(work, 'sheet');
writeSheet(sheetDir, made);
const sheetText = readFileSync(join(sheetDir, FILES.worksheet), 'utf8');
const sheet = JSON.parse(sheetText);
const key = readKey(join(sheetDir, FILES.key));
const place = (s) => `${s.repo}|${s.program}|${s.file}|${s.line}|${s.sink}`;

test('the engine lists every sink it knows when asked, and nothing when not', () => {
  const dir = join(corpus, '002-argv-not-the-argument-passed');
  assert.equal(analyze(dir).sinks, undefined);
  const r = analyze(dir, { listSinks: true });
  assert.equal(r.findings.length, 0);
  assert.deepEqual(r.sinks, [{ program: 'N2', programFile: 'N2.cbl', file: 'N2.cbl', line: 10, kind: 'os-command', item: 'WS-LOCAL', detail: "CALL 'SYSTEM' USING WS-LOCAL" }]);
  const bounds = analyze(join(corpus, '053-terminal-input-chooses-a-table-row'), { listSinks: true }).sinks;
  assert.deepEqual(bounds.map((s) => [s.kind, s.item, s.onlyFrom.includes('file-record')]), [['subscript', 'WS-SEL', false]]);
});

test('the worksheet lists every sink site in the chosen programs, and none of the engine\'s answers', () => {
  assert.equal(sheet.programs.length, 8);
  const expected = [];
  for (const p of sheet.programs) {
    for (const s of analyze(join(corpus, p.repo), { listSinks: true }).sinks) {
      if (s.programFile === p.file) expected.push(`${p.repo}|${s.program}|${s.file}|${s.line}|${s.kind}`);
    }
  }
  assert.deepEqual(sheet.sites.map(place).sort(), [...new Set(expected)].sort());
  assert.ok(sheet.sites.some((s) => s.repo === '002-argv-not-the-argument-passed'), 'a sink nothing reaches is listed');

  // No rule id, no route and no verdict, anywhere in the file.
  const kinds = Object.keys(key.sourceKinds).flatMap((s) => Object.keys(key.sinkKinds).map((k) => `${s}-to-${k}`));
  for (const rule of new Set([...kinds, ...Object.keys(scan(corpus, { repos: REPOS }).ruleText)])) {
    assert.ok(!sheetText.includes(rule), `the worksheet names ${rule}`);
  }
  assert.doesNotMatch(sheetText, /trace|finding|reached|hops/i);
  for (const s of sheet.sites) {
    assert.deepEqual(Object.keys(s), ['id', 'repo', 'program', 'file', 'line', 'sink', 'operands', 'sourcesThatCount', 'code', 'reachable', 'from', 'reasoning', 'labelledAt']);
    assert.deepEqual([s.reachable, s.from, s.reasoning], ['', [], '']);
  }
  const selection = readFileSync(join(sheetDir, FILES.selection), 'utf8');
  assert.doesNotMatch(selection, /reported|trace|finding/i);
  assert.deepEqual(sheet.sites.find((s) => s.repo.startsWith('053')).code, ['           MOVE WS-ROW(WS-SEL) TO WS-OUT']);
});

test('the answer key holds exactly the paths the engine reports to those sites', () => {
  assert.equal(JSON.stringify(sheet.sites.map((s) => s.id)), JSON.stringify(key.sites.map((s) => s.id)));
  const report = scan(corpus, { repos: REPOS });
  const chosen = new Set(key.programs.map((p) => `${p.repo}/${p.file}`));
  const reported = new Map();
  for (const f of report.findings.filter((x) => x.trace)) {
    // A flow finding's path is relative to the corpus root; the key's is relative to its repository.
    const [repo, ...rest] = f.path.split('/');
    const programFile = `${repo}/${f.trace[f.trace.length - 1].file.split('/').slice(1).join('/')}`;
    if (!chosen.has(programFile)) continue;
    const k = `${repo}|${f.program}|${rest.join('/')}|${f.line}`;
    reported.set(k, [...(reported.get(k) || []), f.rule]);
  }
  let reachedSites = 0;
  for (const s of key.sites) {
    const rules = reported.get(`${s.repo}|${s.program}|${s.file}|${s.line}`)?.filter((r) => r.endsWith(`-to-${s.sink}`)) || [];
    assert.deepEqual([...s.rules].sort(), rules.sort(), `${s.id}`);
    assert.equal(s.reached, rules.length > 0, `${s.id}`);
    assert.deepEqual([...s.sources].sort(), rules.map((r) => r.slice(0, -`-to-${s.sink}`.length)).sort(), `${s.id}`);
    if (s.reached) reachedSites++;
  }
  const inKey = key.sites.reduce((n, s) => n + s.rules.length, 0);
  assert.equal(inKey, [...reported.values()].reduce((n, r) => n + r.length, 0), 'every reported path to a chosen program is in the key');
  assert.ok(reachedSites > 0 && reachedSites < key.sites.length, 'the key holds sites both reached and not');
});

test('the same seed gives the same selection, and another seed another order', () => {
  const pick = (seed) => select(corpus, { programs: 5, seed }).selected.map((c) => `${c.repo}/${c.file}`);
  assert.deepEqual(pick('a'), pick('a'));
  assert.notDeepEqual(pick('a'), pick('b'));
  const again = labelSheet(corpus, { programs: 8, seed: 'test' });
  assert.equal(again.worksheet.sheet, sheet.sheet);
  assert.deepEqual(again.worksheet.sites, made.worksheet.sites);
  assert.deepEqual(again.key.sites, made.key.sites);
});

test('programs are distinct by content and taken round-robin across repositories', () => {
  // Two programs in each of x and y, and z holding a copy of one of x's.
  const copies = join(work, 'copies');
  cpSync(join(CASES, REPOS[3]), join(copies, 'x'), { recursive: true });
  cpSync(join(CASES, REPOS[7]), join(copies, 'x'), { recursive: true });
  cpSync(join(CASES, REPOS[4]), join(copies, 'y'), { recursive: true });
  cpSync(join(CASES, REPOS[6]), join(copies, 'y'), { recursive: true });
  cpSync(join(CASES, REPOS[3]), join(copies, 'z'), { recursive: true });
  for (const seed of ['a', 'b', 'c']) {
    const two = select(copies, { programs: 2, seed }).selected;
    assert.equal(new Set(two.map((c) => c.repo)).size, 2, 'one program per repository per round');
    const all = select(copies, { programs: 5, seed });
    assert.equal(all.selected.length, 4, 'two copies of one program are one sample');
    assert.equal(all.skipped['a copy of a program already chosen'], 1);
  }
});

test('the triage takes programs with no reported path without saying which they are', () => {
  const mixed = labelSheet(corpus, { programs: 6, seed: 'test', prefer: 'mixed' });
  assert.deepEqual(mixed.key.programs.map((p) => p.reported).sort(), [false, false, false, true, true, true]);
  assert.doesNotMatch(JSON.stringify(mixed.worksheet) + JSON.stringify(mixed.selection), /"reported"/);
  // Chosen alternately, so the order they were chosen in would say which is which.
  const named = mixed.worksheet.programs.map((p) => `${p.repo}/${p.file}`);
  assert.deepEqual(named, [...named].sort());
  assert.deepEqual(mixed.selection.programs.map((p) => `${p.repo}/${p.file}`), named);
  const none = labelSheet(corpus, { programs: 8, seed: 'test', prefer: 'no-findings' });
  assert.equal(none.key.programs.length, 3);
  assert.ok(none.key.programs.every((p) => !p.reported));
  assert.ok(none.key.sites.every((s) => !s.reached));
  assert.equal(none.selection.shortfall, 5);
  assert.match(none.selection.caveats.join(' '), /someone else should label/);

  // Most sink sites first within a repository, reached or not.
  const multi = join(work, 'multi');
  mkdirSync(join(multi, 'one'), { recursive: true });
  cpSync(join(CASES, REPOS[7], 'SELROW.cbl'), join(multi, 'one', 'SELROW.cbl'));
  cpSync(join(CASES, REPOS[4], 'N3.cbl'), join(multi, 'one', 'N3.cbl'));
  assert.deepEqual(select(multi, { programs: 2, prefer: 'sinks' }).selected.map((c) => [c.file, c.sites]), [['N3.cbl', 2], ['SELROW.cbl', 1]]);
});

test('a site shows its statement down to the line that names the operand', () => {
  const wrapped = join(work, 'wrapped');
  mkdirSync(join(wrapped, 'one'), { recursive: true });
  writeFileSync(join(wrapped, 'one', 'WRAPPED.cbl'), [
    '       IDENTIFICATION DIVISION.',
    '       PROGRAM-ID. WRAPPED.',
    '       DATA DIVISION.',
    '       WORKING-STORAGE SECTION.',
    '       01 WS-CMD PIC X(80).',
    '       PROCEDURE DIVISION.',
    '           ACCEPT WS-CMD FROM COMMAND-LINE',
    "           CALL 'SYSTEM'",
    '               USING WS-CMD',
    '           GOBACK.',
  ].join('\n'));
  const [site] = labelSheet(wrapped, { programs: 1 }).worksheet.sites;
  assert.equal(site.line, 8);
  assert.deepEqual(site.code, ["           CALL 'SYSTEM'", '               USING WS-CMD']);
});

test('an existing worksheet is never written over', () => {
  assert.throws(() => writeSheet(sheetDir, made), /exists and may hold labels/);
});

// Labels written for the tests, on cases this project wrote. They are fixtures, not corpus rows.
const FIXTURE = { labeller: 'test fixture, not a label', method: 'human', labelledAt: '2026-09-24' };
const row = (site, reachable, extra = {}) => ({
  kind: 'corpus', ...FIXTURE, repo: site.repo, program: site.program, sink: site.sink, line: site.line,
  reachable, reasoning: 'A fixture reason, long enough for the gate to accept it as reviewable.', file: site.file, site: site.id, ...extra,
});

test('a filled worksheet becomes rows the gate accepts, undecidable included', () => {
  const filled = JSON.parse(sheetText);
  Object.assign(filled, FIXTURE);
  filled.sites[0].reachable = 'Undecidable';
  filled.sites[0].reasoning = 'Depends on which caller runs it, and no caller is in the repository.';
  filled.sites[1].reachable = 'yes';
  filled.sites[1].from = 'cics-terminal';
  filled.sites[1].reasoning = 'The received area is moved field by field into the operand.';
  filled.sites[1].labelledAt = '2026-09-25';
  const labels = rowsFromWorksheet(filled);
  assert.equal(labels.length, 2, 'a site with nothing filled in is not a label');
  assert.equal(labels[0].row.reachable, 'undecidable');
  assert.deepEqual([labels[1].row.reachable, labels[1].row.from, labels[1].row.labelledAt], [true, ['cics-terminal'], '2026-09-25']);
  assert.equal(labels[0].row.labelledAt, '2026-09-24');
  for (const l of labels) assert.deepEqual(verifyRow(l.row), []);
  assert.deepEqual(verifyRow({ ...labels[0].row, reachable: 'maybe' }), ["reachable: must be true, false or 'undecidable'"]);

  const path = join(work, 'filled.json');
  writeFileSync(path, JSON.stringify(filled));
  const r = score(readLabels(path), key);
  assert.equal(r.scored, false, 'nothing is scored while a site has no label');
  assert.equal(r.labels.unlabelled, key.sites.length - 2);
  assert.equal(r.overall, undefined);
});

test('the scorer refuses a label the gate refuses, and says which and why', () => {
  const [a, b, c, d] = key.sites;
  const labels = [
    { at: 'line 1', row: row(a, false, { method: 'model' }) },
    { at: 'line 2', row: row(b, false, { reasoning: 'short' }) },
    { at: 'line 3', row: row(c, true, { from: ['keyboard'] }) },
    { at: 'line 4', row: row(d, false, { program: 'ELSEWHERE', site: undefined }) },
    { at: 'line 5', row: null, error: 'not JSON: Unexpected token' },
  ];
  const r = score(labels, key, { partial: true });
  assert.equal(r.labels.accepted, 0);
  assert.deepEqual(r.refused.map((f) => f.at), ['line 1', 'line 2', 'line 3', 'line 4', 'line 5']);
  assert.match(r.refused[0].problems.join(), /method: must be 'human'/);
  assert.match(r.refused[1].problems.join(), /reasoning: missing or too short/);
  assert.match(r.refused[2].problems.join(), /'keyboard' is not one of/);
  assert.equal(r.overall.tp + r.overall.fp + r.overall.fn + r.overall.tn + r.overall.undecidable, 0, 'a refused row is not scored');
  assert.match(r.notCovered[0], /^PARTIAL/);

  const subscript = key.sites.find((s) => s.sink === 'subscript');
  const wrongSource = score([{ at: 'x', row: row(subscript, true, { from: ['file-record'] }) }], key, { partial: true });
  assert.match(wrongSource.refused[0].problems.join(), /'file-record' does not count at a subscript site/);
  const stranger = score([{ at: 'x', row: row(d, false, { program: 'ELSEWHERE', site: undefined }) }], key, { partial: true });
  assert.match(stranger.refused[0].problems.join(), /not in this selection/);
});

test('precision, recall and the undecidable rate are counted as defined, overall, per sink kind and per rule', () => {
  const ALL = ['argv-or-env', 'cics-terminal', 'cics-web', 'file-record', 'database', 'jcl-parm', 'jcl-instream'];
  const OUTSIDE = ['argv-or-env', 'cics-terminal', 'cics-web', 'jcl-parm', 'jcl-instream'];
  const site = (n, sink, sources, count = ALL) => ({ id: `s${n}`, repo: 'r', program: 'P', file: 'P.cbl', line: n, sink,
    sourcesThatCount: count, reached: sources.length > 0, sources, rules: sources.map((k) => `${k}-to-${sink}`) });
  const hand = {
    sheet: 'hand', toolVersion: 'x', flowModel: 'x', programs: [{ repo: 'r', file: 'P.cbl', programs: ['P'] }],
    sourceKinds: Object.fromEntries(ALL.map((k) => [k, k])), sinkKinds: { 'os-command': '', 'dynamic-sql': '', subscript: '' },
    sites: [
      site(1, 'os-command', ['argv-or-env']),        // yes, from argv-or-env         TP
      site(2, 'os-command', ['file-record']),        // no                            FP
      site(3, 'os-command', []),                     // yes, from database            FN
      site(4, 'os-command', []),                     // no                            TN
      site(5, 'dynamic-sql', ['cics-web', 'database']), // yes, from cics-web only  TP, and a wrong source
      site(6, 'dynamic-sql', []),                    // undecidable
      site(7, 'subscript', ['cics-terminal'], OUTSIDE), // undecidable
      site(8, 'subscript', [], OUTSIDE),             // yes, no source named          FN
    ],
  };
  const said = [[true, ['argv-or-env']], [false], [true, ['database']], [false], [true, ['cics-web']], ['undecidable'], ['undecidable'], [true]];
  const labels = hand.sites.map((s, i) => ({ at: s.id, row: row(s, said[i][0], said[i][1] ? { from: said[i][1] } : {}) }));
  labels.push({ at: 'again', row: row(hand.sites[1], true, { from: ['file-record'], labeller: 'second person' }) });
  const r = score(labels, hand);
  assert.equal(r.scored, true);
  assert.deepEqual(r.refused, []);
  const pick = (m) => ({ tp: m.tp, fp: m.fp, fn: m.fn, tn: m.tn, undecidable: m.undecidable, precision: m.precision, recall: m.recall, undecidableRate: m.undecidableRate });

  assert.deepEqual(pick(r.overall), { tp: 2, fp: 1, fn: 2, tn: 1, undecidable: 2, precision: 0.667, recall: 0.5, undecidableRate: 0.25 });
  assert.deepEqual(r.overall.confusion, { yes: { reported: 2, notReported: 2 }, no: { reported: 1, notReported: 1 }, undecidable: { reported: 1, notReported: 1 } });
  assert.deepEqual(r.overall.precisionInterval, wilson(2, 3));

  assert.deepEqual(pick(r.byKind['os-command']), { tp: 1, fp: 1, fn: 1, tn: 1, undecidable: 0, precision: 0.5, recall: 0.5, undecidableRate: 0 });
  assert.deepEqual(pick(r.byKind['dynamic-sql']), { tp: 1, fp: 0, fn: 0, tn: 0, undecidable: 1, precision: 1, recall: 1, undecidableRate: 0.5 });
  assert.deepEqual(pick(r.byKind.subscript), { tp: 0, fp: 0, fn: 1, tn: 0, undecidable: 1, precision: null, recall: 0, undecidableRate: 0.5 });

  const rule = (id) => { const m = r.byRule[id]; return [m.tp, m.fp, m.fn, m.tn, m.undecidable]; };
  assert.deepEqual(rule('argv-or-env-to-os-command'), [1, 0, 0, 3, 0]);
  assert.deepEqual(rule('file-record-to-os-command'), [0, 1, 0, 3, 0]);
  assert.deepEqual(rule('database-to-os-command'), [0, 0, 1, 3, 0]);
  assert.deepEqual(rule('cics-web-to-dynamic-sql'), [1, 0, 0, 0, 0]);
  assert.deepEqual(rule('database-to-dynamic-sql'), [0, 1, 0, 0, 0], 'the right site from the wrong source is a false positive of that rule');
  assert.deepEqual(rule('cics-terminal-to-subscript'), [0, 0, 0, 0, 1]);
  assert.equal(r.byRule['file-record-to-subscript'], undefined, 'a source that does not count at a site asks no question there');
  assert.equal(r.unattributed, 1);

  assert.deepEqual(r.disagreements.falsePositives.map((x) => x.site), ['s2']);
  assert.deepEqual(r.disagreements.falseNegatives.map((x) => x.site), ['s3', 's8']);
  assert.deepEqual(r.second, [{ site: 's2', at: 'again', first: false, then: true, agree: false }]);
  assert.equal(r.labels.accepted, 9);
});

test('the key holds the verdict the engine gives each site, and none where it reports nothing', () => {
  const verdicts = new Set(Object.keys(EXPLOITABILITY));
  for (const s of key.sites) {
    if (s.reached) assert.ok(verdicts.has(s.verdict), `${s.id} has a verdict`);
    else assert.equal(s.verdict, null, `${s.id}`);
    assert.ok(!['exploitable', 'restricted', 'confirmed'].includes(s.verdict), 'a public corpus declares no access facts or witness');
  }
  assert.ok(key.sites.some((s) => s.verdict === 'attacker-driven'));
  assert.ok(!sheetText.includes('attacker-driven') && !sheetText.includes('"verdict"'), 'the worksheet gives no verdict away');
});

test('a rate per verdict: a route verdict holds where the site is reachable, refuted where it is not', () => {
  const site = (n, verdict, sources) => ({ id: `v${n}`, repo: 'r', program: 'P', file: 'P.cbl', line: n, sink: 'os-command',
    sourcesThatCount: ['argv-or-env'], reached: sources.length > 0, sources, rules: sources.map((k) => `${k}-to-os-command`), verdict });
  const hand = {
    sheet: 'verdicts', toolVersion: 'x', flowModel: 'x', programs: [{ repo: 'r', file: 'P.cbl', programs: ['P'] }],
    sourceKinds: { 'argv-or-env': '' }, sinkKinds: { 'os-command': '' },
    sites: [
      site(1, 'attacker-driven', ['argv-or-env']), site(2, 'attacker-driven', ['argv-or-env']), site(3, 'attacker-driven', ['argv-or-env']),
      site(4, 'refuted', ['argv-or-env']), site(5, 'refuted', ['argv-or-env']),
      site(6, 'mitigated', ['argv-or-env']), site(7, null, []),
    ],
  };
  const said = [true, true, false, false, true, 'undecidable', false];
  const labels = hand.sites.map((s, i) => ({ at: s.id, row: row(s, said[i], said[i] === true ? { from: ['argv-or-env'] } : {}) }));
  const r = score(labels, hand);
  assert.equal(r.scored, true);
  assert.deepEqual(r.byVerdict['attacker-driven'], { sites: 3, holds: 2, wrong: 1, undecidable: 0, rate: 0.667, interval: wilson(2, 3) });
  assert.deepEqual(r.byVerdict.refuted, { sites: 2, holds: 1, wrong: 1, undecidable: 0, rate: 0.5, interval: wilson(1, 2) });
  assert.deepEqual(r.byVerdict.mitigated, { sites: 1, holds: 0, wrong: 0, undecidable: 1, rate: null, interval: null });
  assert.equal(Object.keys(r.byVerdict).length, 3, 'a site the engine reports nothing at has no verdict to measure');
  assert.match(report(r), /by verdict[\s\S]*attacker-driven\s+3\s+2\s+1\s+0\s+0\.667/);
  assert.ok(r.notCovered.some((n) => /route half of the verdict only/.test(n)));
});

test('the two scripts run from the command line, and the scorer knows the key the selection sealed', () => {
  const dir = join(work, 'cli');
  const node = (script, ...args) => spawnSync(process.execPath, [join(ROOT, 'diag', script), ...args], { encoding: 'utf8' });
  const made = node('label-sheet.mjs', corpus, '--programs', '3', '--seed', 'cli', '--out', dir);
  // The child reads the real machine's memory; if its guard stopped a repository, the skips say so.
  const skips = () => { try { return JSON.stringify(JSON.parse(readFileSync(join(dir, FILES.selection), 'utf8')).skipped); } catch { return ''; } };
  assert.equal(made.status, 0, made.stdout + made.stderr + skips());
  assert.match(made.stdout, /^3 programs from 3 repositories/);
  assert.doesNotMatch(made.stdout.split(dir).join(''), /-to-|reach|path/, 'nothing about the answers is printed');
  const again = node('label-sheet.mjs', corpus, '--programs', '3', '--out', dir);
  assert.equal(again.status, 2);
  assert.match(again.stderr, /may hold labels/);

  const filled = JSON.parse(readFileSync(join(dir, FILES.worksheet), 'utf8'));
  Object.assign(filled, FIXTURE);
  for (const s of filled.sites) Object.assign(s, { reachable: 'undecidable', reasoning: 'A fixture reason, long enough for the gate to accept it.' });
  const path = join(dir, 'filled.json');
  writeFileSync(path, JSON.stringify(filled));
  const scored = node('score-corpus.mjs', path, join(dir, FILES.key), '--rows', join(dir, 'rows.jsonl'));
  assert.equal(scored.status, 0, scored.stdout + scored.stderr);
  assert.match(scored.stdout, /answer key: the one selection.json sealed/);
  assert.match(scored.stdout, /undecidable 3 \(100\.0%\)/);
  assert.equal(readFileSync(join(dir, 'rows.jsonl'), 'utf8').trim().split('\n').length, 3);

  const swapped = readKey(join(dir, FILES.key));
  swapped.sites[0].reached = !swapped.sites[0].reached;
  writeFileSync(join(dir, FILES.key), gzipSync(JSON.stringify(swapped)));
  assert.match(node('score-corpus.mjs', path, join(dir, FILES.key)).stdout, /answer key: NOT the one selection.json sealed/);
});

test('a Wilson interval matches the published values', () => {
  assert.deepEqual(wilson(2, 3), [0.208, 0.939]);
  assert.deepEqual(wilson(0, 10), [0, 0.278]);
  assert.equal(wilson(0, 0), null);
});

// The worksheet names each site by its kind of sink, and the labeller reads what that kind means from
// here; a kind the engine emits with no description reaches them as nothing.
test('every kind of source and sink the engine names is described for the worksheet', () => {
  const text = readFileSync(new URL('../lib/dataflow.mjs', import.meta.url), 'utf8');
  const named = new Set([...text.matchAll(/kind: ([^,}]*)/g)].flatMap((m) => [...m[1].matchAll(/'([a-z]+(?:-[a-z]+)*)'/g)].map((x) => x[1])));
  const dir = mkdtempSync(join(tmpdir(), 'cw-kinds-'));
  const r = analyze(dir);
  const described = new Set([...Object.keys(r.sourceKinds), ...Object.keys(r.sinkKinds)]);
  assert.ok(named.size > 20, 'the scan of the engine found its kinds');
  assert.deepEqual([...named].filter((k) => !described.has(k)), []);
});
