import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gateRefs, findCobc, kindsOf, lineDiff } from '../lib/gate.mjs';
import { scanAll } from '../lib/scan.mjs';
import { RULES as FLOW_RULES } from '../lib/sets/flow.mjs';
import { baselineEntries, BASELINE_FILE } from '../lib/baseline.mjs';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'bin', 'cobolwork.mjs');
const SPEC = readFileSync(join(HERE, '..', 'docs', 'spec', 'remediation-gate.md'), 'utf8');

const hasGit = spawnSync('git', ['--version']).status === 0;
const skip = !hasGit && 'git is not installed';
const git = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

const cobol = (lines) => lines.map((l) => {
  if (l.length > 72) throw new Error(`past column 72: ${l}`);
  return l;
}).join('\n') + '\n';
const program = (id, body, ws = []) => cobol([
  '       IDENTIFICATION DIVISION.',
  `       PROGRAM-ID. ${id}.`,
  '       DATA DIVISION.',
  '       WORKING-STORAGE SECTION.',
  '       01 WS-IN               PIC X(8).',
  "       01 WS-ERR              PIC X VALUE 'N'.",
  "          88 ERR-ON           VALUE 'Y'.",
  '       01 WS-CMD              PIC X(80).',
  '       01 WS-OTHER            PIC X(80).',
  ...ws,
  '       PROCEDURE DIVISION.',
  ...body.map((l) => `           ${l}`),
]);
const ACCEPT = 'ACCEPT WS-IN FROM COMMAND-LINE';
const MOVE = 'MOVE WS-IN TO WS-CMD';
const CALL = "CALL 'SYSTEM' USING WS-CMD";
const BASE = program('P', [ACCEPT, MOVE, CALL, 'GOBACK.']);

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'cw-gate-'));
  git(root, ['init', '-q']);
  for (const [k, v] of [['user.email', 't@example.com'], ['user.name', 't'], ['core.autocrlf', 'false']]) git(root, ['config', k, v]);
  patch(root, files);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'base']);
  return root;
}
function patch(root, files) {
  for (const [name, text] of Object.entries(files)) {
    const to = join(root, name);
    if (text === null) { rmSync(to, { force: true }); continue; }
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, text);
  }
}
const fingerprintOf = (root, pick) => {
  const f = scanAll(root).findings.find(pick);
  assert.ok(f, 'the base holds the finding the scenario targets');
  return f.fingerprint;
};
const osCommandIn = (path, line) => (f) => f.rule === 'argv-or-env-to-os-command' && f.path === path && (line === undefined || f.line === line);
const NO_COMPILER = { why: 'no compiler in this test' };
const gate = (root, fp, opts = {}) => gateRefs(root, 'HEAD', null, fp, { compiler: NO_COMPILER, ...opts });

// A base, its target, and the gate's document for a patch applied to the working tree.
function gated(files, edits, pick = osCommandIn('P.cbl'), opts = {}) {
  const root = repo(files);
  const fp = fingerprintOf(root, pick);
  patch(root, edits);
  return { root, fp, doc: gate(root, fp, opts) };
}

test('G1.1 A check the patch adds that stops the route passes', { skip }, () => {
  const allow = ['EVALUATE WS-IN', "   WHEN 'DAILY'", "   WHEN 'MONTHLY'", '      CONTINUE', '   WHEN OTHER', '      GOBACK', 'END-EVALUATE'];
  const { doc } = gated({ 'P.cbl': BASE }, { 'P.cbl': program('P', [ACCEPT, ...allow, MOVE, CALL, 'GOBACK.']) });
  assert.equal(doc.outcome, 'cleared-by-check');
  assert.equal(doc.verdict, 'pass');
  assert.deepEqual(doc.reasons, []);
});

test('G1.2 A check the patch adds that only lowers the finding is undecided', { skip }, () => {
  const flagged = [ACCEPT, 'IF WS-IN IS NOT NUMERIC', "   MOVE 'Y' TO WS-ERR", 'END-IF', 'IF NOT ERR-ON', `   ${MOVE}`, `   ${CALL}`, 'END-IF', 'GOBACK.'];
  const { doc } = gated({ 'P.cbl': BASE }, { 'P.cbl': program('P', flagged) });
  assert.equal(doc.outcome, 'lowered-by-check');
  assert.equal(doc.checks.target, null);
  assert.equal(doc.verdict, 'undecided');
});

test('G1.3 Removing the flagged statement passes', { skip }, () => {
  const { doc } = gated({ 'P.cbl': BASE }, { 'P.cbl': program('P', [ACCEPT, MOVE, 'GOBACK.']) });
  assert.equal(doc.outcome, 'statement-removed');
  assert.equal(doc.verdict, 'pass');
});

test('G1.4 Rewording the flagged statement is not a fix', { skip }, () => {
  const { doc } = gated({ 'P.cbl': BASE }, { 'P.cbl': program('P', [ACCEPT, MOVE, 'CALL "SYSTEM" USING WS-CMD', 'GOBACK.']) });
  assert.equal(doc.outcome, 'still-reported');
  assert.equal(doc.pairedBy, 'scope');
  assert.equal(doc.checks.added, true, 'the reworded target is not also a finding added');
  assert.equal(doc.verdict, 'fail');
});

test('G1.5 Removing the source passes', { skip }, () => {
  const { doc } = gated({ 'P.cbl': BASE }, { 'P.cbl': program('P', ["MOVE 'DAILY' TO WS-IN", MOVE, CALL, 'GOBACK.']) });
  assert.ok(['source-removed', 'cleared-by-check'].includes(doc.outcome), doc.outcome);
  assert.equal(doc.verdict, 'pass');
});

test('G1.6 Deleting the program fails', { skip }, () => {
  const { doc } = gated({ 'P.cbl': BASE, 'Q.cbl': program('Q', ['GOBACK.']) }, { 'P.cbl': null });
  assert.equal(doc.outcome, 'program-removed');
  assert.equal(doc.verdict, 'fail');
});

test('G1.7 A construct the patch repairs no longer fires', { skip }, () => {
  const cics = (body) => cobol([
    '       IDENTIFICATION DIVISION.',
    '       PROGRAM-ID. C.',
    '       DATA DIVISION.',
    '       WORKING-STORAGE SECTION.',
    '       01 WS-NUM           PIC X(10).',
    '       LINKAGE SECTION.',
    '       01 DFHCOMMAREA.',
    '          05 CA-CUSTOMER   PIC X(10).',
    '       PROCEDURE DIVISION.',
    ...body.map((l) => `           ${l}`),
  ]);
  const read = ['MOVE CA-CUSTOMER TO WS-NUM', 'EXEC CICS RETURN END-EXEC.'];
  const tested = ['IF EIBCALEN = 0', '    EXEC CICS RETURN END-EXEC', 'END-IF', ...read];
  const { doc } = gated({ 'C.cbl': cics(read) }, { 'C.cbl': cics(tested) },
    (f) => f.rule === 'cics-commarea-without-length-check' && f.path === 'C.cbl');
  assert.equal(doc.outcome, 'no-longer-fires');
  assert.equal(doc.verdict, 'pass');
});

test('G1.8 A route cut between its ends is undecided', { skip }, () => {
  const { doc } = gated({ 'P.cbl': BASE }, { 'P.cbl': program('P', [ACCEPT, CALL, 'GOBACK.']) });
  assert.equal(doc.outcome, 'gone-unexplained');
  assert.equal(doc.verdict, 'undecided');
  assert.match(doc.reasons[0], /a person decides/);
});

test('G1.9 An unknown fingerprint is refused', { skip }, () => {
  const root = repo({ 'P.cbl': BASE });
  assert.throws(() => gate(root, '0'.repeat(32)), (e) => e.code === 'EGATETARGET');
  const r = spawnSync(process.execPath, [CLI, 'gate', root, '--base', 'HEAD', '--target', '0'.repeat(32), '--cobc', join(root, 'none')], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '', 'no verdict is written');
});

test('G2.1 A finding the patch adds fails, and is named by rule and place', { skip }, () => {
  const { doc } = gated({ 'P.cbl': BASE, 'Q.cbl': program('Q', ['GOBACK.']) },
    { 'P.cbl': program('P', [ACCEPT, MOVE, 'GOBACK.']), 'Q.cbl': program('Q', [ACCEPT, MOVE, CALL, 'GOBACK.']) });
  assert.equal(doc.outcome, 'statement-removed');
  assert.equal(doc.checks.added, false);
  assert.equal(doc.verdict, 'fail');
  assert.ok(doc.reasons.some((r) => /adds argv-or-env-to-os-command \(crit\) at Q\.cbl:13/.test(r)), doc.reasons.join('\n'));
});

test('G2.2 An edited line of another finding is not a finding added', { skip }, () => {
  const other = program('Q', [ACCEPT, MOVE, CALL, 'GOBACK.']);
  const { doc } = gated({ 'P.cbl': BASE, 'Q.cbl': other },
    { 'P.cbl': program('P', [ACCEPT, MOVE, 'GOBACK.']), 'Q.cbl': program('Q', [ACCEPT, MOVE, 'CALL "SYSTEM" USING WS-CMD', 'GOBACK.']) });
  assert.equal(doc.checks.added, true);
  assert.equal(doc.verdict, 'pass');
});

test('G2.3 A change to the site file or the baseline fails', { skip }, () => {
  const root = repo({ 'P.cbl': BASE });
  const fp = fingerprintOf(root, osCommandIn('P.cbl'));
  const { entries } = baselineEntries(scanAll(root).findings.filter((f) => f.fingerprint === fp), [],
    { reason: 'accepted', who: 't', expires: '2099-01-01T00:00:00.000Z', at: '2026-09-24T00:00:00.000Z' });
  patch(root, { [BASELINE_FILE]: JSON.stringify({ entries }) });
  const doc = gate(root, fp);
  assert.equal(doc.checks.configuration, false);
  assert.equal(doc.verdict, 'fail');
  assert.equal(doc.outcome, 'still-reported', 'the gate reads findings, not what a baseline accepts');
});

test('G2.4 A layout moved in a program the patch did not edit fails', { skip }, () => {
  const rec = (n) => cobol([`       01 WS-REC.`, `          05 WS-A            PIC X(${n}).`, '          05 WS-B            PIC X(4).']);
  const copier = program('Q', ['DISPLAY WS-B', 'GOBACK.'], ['       COPY REC.']);
  const { doc } = gated({ 'P.cbl': BASE, 'Q.cbl': copier, 'REC.cpy': rec(4) },
    { 'P.cbl': program('P', [ACCEPT, MOVE, 'GOBACK.']), 'REC.cpy': rec(8) });
  assert.equal(doc.outcome, 'statement-removed');
  assert.equal(doc.checks.layout, false);
  assert.equal(doc.verdict, 'fail');
});

test('G2.5 A new call target fails', { skip }, () => {
  const { doc } = gated({ 'P.cbl': BASE }, { 'P.cbl': program('P', [ACCEPT, MOVE, "CALL 'SAFERUN' USING WS-CMD", 'GOBACK.']) });
  assert.equal(doc.checks.calls, false);
  assert.equal(doc.verdict, 'fail');
});

test('G2.6 Incomplete coverage is undecided, never pass', { skip }, () => {
  const fields = cobol(['       01 WS-IN               PIC X(8).', '       01 WS-CMD              PIC X(80).']);
  const copying = cobol([
    '       IDENTIFICATION DIVISION.',
    '       PROGRAM-ID. P.',
    '       DATA DIVISION.',
    '       WORKING-STORAGE SECTION.',
    '       COPY WSREC.',
    '       PROCEDURE DIVISION.',
    `           ${ACCEPT}`,
    `           ${MOVE}`,
    `           ${CALL}`,
    '           GOBACK.',
  ]);
  const { doc } = gated({ 'P.cbl': copying, 'WSREC.cpy': fields }, { 'WSREC.cpy': null });
  assert.equal(doc.checks.coverage, null);
  assert.equal(doc.verdict, 'undecided');
});

test('G2.7 A fixed finding is not paired with its neighbour', { skip }, () => {
  const two = program('P', [ACCEPT, MOVE, 'MOVE WS-IN TO WS-OTHER', CALL, "CALL 'SYSTEM' USING WS-OTHER", 'GOBACK.']);
  const { doc } = gated({ 'P.cbl': two }, { 'P.cbl': program('P', [ACCEPT, MOVE, 'MOVE WS-IN TO WS-OTHER', "CALL 'SYSTEM' USING WS-OTHER", 'GOBACK.']) },
    osCommandIn('P.cbl', 14));
  assert.equal(doc.target.line, 14);
  assert.equal(doc.outcome, 'statement-removed');
  assert.equal(doc.checks.added, true);
});

test('G2.8 A statement written back elsewhere is not removed', { skip }, () => {
  const { doc } = gated({ 'P.cbl': BASE }, { 'P.cbl': program('P', [ACCEPT, MOVE, "CALL 'SYSTEM' USING WS-OTHER", 'GOBACK.']) });
  assert.notEqual(doc.outcome, 'statement-removed');
  assert.equal(doc.outcome, 'gone-unexplained');
});

test('G2.9 --target-only answers for the target and coverage alone', { skip }, () => {
  const files = { 'P.cbl': BASE, 'Q.cbl': program('Q', ['GOBACK.']) };
  const edits = { 'P.cbl': program('P', [ACCEPT, MOVE, 'GOBACK.']), 'Q.cbl': program('Q', [ACCEPT, MOVE, CALL, 'GOBACK.']) };
  const { root, fp, doc } = gated(files, edits);
  assert.equal(doc.verdict, 'fail');
  const only = gate(root, fp, { targetOnly: true });
  assert.equal(only.verdict, 'pass');
  assert.deepEqual(Object.keys(only.checks).sort(), ['coverage', 'target']);
});

test('G3.1 No output carries source text', { skip }, () => {
  const marker = 'ZQXMARKQZ';
  const marked = program('P', [ACCEPT, `MOVE '${marker}' TO WS-OTHER`, MOVE, CALL, 'GOBACK.']);
  const { doc } = gated({ 'P.cbl': marked }, { 'P.cbl': program('P', [ACCEPT, `MOVE '${marker}' TO WS-OTHER`, MOVE, "CALL 'SYSTEM' USING WS-OTHER", CALL, 'GOBACK.']) });
  const text = JSON.stringify(doc);
  assert.equal(text.includes(marker), false);
  assert.equal(text.includes('WS-OTHER'), false, 'no operand the source names');
});

test('G3.2 The compiler is not taken from the reviewed tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-gate-cobc-'));
  for (const name of ['cobc', 'cobc.exe']) writeFileSync(join(root, name), '');
  assert.equal(findCobc({ repo: root, env: { PATH: root } }).path, null);
  assert.equal(findCobc({ repo: root, env: { PATH: '.' } }).path, null, 'a relative entry is never searched');
  assert.equal(findCobc({ repo: root, explicit: join(root, 'cobc') }).path, null);
  const outside = mkdtempSync(join(tmpdir(), 'cw-gate-bin-'));
  for (const name of ['cobc', 'cobc.exe']) writeFileSync(join(outside, name), '');
  assert.ok(findCobc({ repo: root, env: { PATH: outside } }).path.startsWith(outside));
});

test('G3.3 A program that stopped compiling fails; one that never compiled does not', { skip }, () => {
  const root = repo({ 'P.cbl': BASE });
  const fp = fingerprintOf(root, osCommandIn('P.cbl'));
  patch(root, { 'P.cbl': program('P', [ACCEPT, MOVE, 'GOBACK.']) });
  const headFails = { run: (file) => !readFileSync(file, 'latin1').includes('GOBACK.') || readFileSync(file, 'latin1').includes(CALL) };
  const regressed = gate(root, fp, { compiler: headFails });
  assert.equal(regressed.checks.compile, false);
  assert.equal(regressed.verdict, 'fail');
  const never = gate(root, fp, { compiler: { run: () => false } });
  assert.equal(never.checks.compile, null);
  assert.equal(never.verdict, 'pass', 'not compiled alone does not stop a pass');
  const fine = gate(root, fp, { compiler: { run: () => true } });
  assert.equal(fine.checks.compile, true);
});

test('G3.3a A program that stopped compiling carries the compiler\'s error lines, named by the path in the repository', { skip }, () => {
  const root = repo({ 'P.cbl': BASE });
  const fp = fingerprintOf(root, osCommandIn('P.cbl'));
  patch(root, { 'P.cbl': program('P', [ACCEPT, MOVE, 'GOBACK.']) });
  const headFails = {
    run: (file) => (readFileSync(file, 'latin1').includes(CALL) ? { ok: true, messages: [] }
      : { ok: false, messages: [1, 2, 3, 4].map((n) => `${file}:${n}: error: syntax error ${n}`) }),
  };
  const doc = gate(root, fp, { compiler: headFails });
  assert.equal(doc.checks.compile, false);
  const said = doc.reasons.filter((r) => r.startsWith('the compiler: '));
  assert.deepEqual(said, [1, 2, 3].map((n) => `the compiler: P.cbl:${n}: error: syntax error ${n}`));
});

test('G3.4 The same inputs give the same document', { skip }, () => {
  const root = repo({ 'P.cbl': BASE });
  const fp = fingerprintOf(root, osCommandIn('P.cbl'));
  patch(root, { 'P.cbl': program('P', [ACCEPT, MOVE, 'GOBACK.']) });
  assert.deepEqual(gate(root, fp), gate(root, fp));
});

test('G3.5 The spec and the suite name the same scenarios', () => {
  const specIds = [...SPEC.matchAll(/^#### (G\d+\.\d+) /gm)].map((m) => m[1]);
  assert.ok(specIds.length >= 20, 'the spec holds scenarios');
  assert.equal(new Set(specIds).size, specIds.length, 'no scenario id is used twice');
  const testIds = [...readFileSync(fileURLToPath(import.meta.url), 'utf8').matchAll(/^test\((['"])(G\d+\.\d+) /gm)].map((m) => m[2]);
  assert.equal(new Set(testIds).size, testIds.length, 'no test id is used twice');
  assert.deepEqual(specIds.filter((id) => !testIds.includes(id)), [], 'every scenario has a test');
  assert.deepEqual(testIds.filter((id) => !specIds.includes(id)), [], 'every test has a scenario');
});

test('G3.6 --exit-code turns the verdict into the exit status', { skip }, () => {
  const root = repo({ 'P.cbl': BASE });
  const fp = fingerprintOf(root, osCommandIn('P.cbl'));
  patch(root, { 'P.cbl': program('P', [ACCEPT, MOVE, 'CALL "SYSTEM" USING WS-CMD', 'GOBACK.']) });
  const run = (...extra) => spawnSync(process.execPath, [CLI, 'gate', root, '--base', 'HEAD', '--target', fp, '--cobc', join(root, 'none'), ...extra], { encoding: 'utf8' });
  const coded = run('--exit-code');
  assert.equal(coded.status, 1, coded.stderr);
  assert.equal(JSON.parse(coded.stdout).verdict, 'fail');
  assert.equal(run().status, 0);
});

test('G3.7 The compiler has one budget for the whole check', { skip }, () => {
  const root = repo({ 'P.cbl': BASE });
  const fp = fingerprintOf(root, osCommandIn('P.cbl'));
  patch(root, { 'P.cbl': program('P', [ACCEPT, MOVE, 'GOBACK.']) });
  const doc = gate(root, fp, { compiler: { run: () => true, budgetMs: -1 } });
  assert.equal(doc.checks.compile, null);
  assert.match(doc.compiled, /budget/);
});

test('G3.8 A baseline is refused rather than ignored', { skip }, () => {
  const root = repo({ 'P.cbl': BASE });
  const fp = fingerprintOf(root, osCommandIn('P.cbl'));
  for (const flag of [['--baseline', join(root, 'b.json')], ['--no-baseline']]) {
    const r = spawnSync(process.execPath, [CLI, 'gate', root, '--base', 'HEAD', '--target', fp, ...flag], { encoding: 'utf8' });
    assert.equal(r.status, 2, flag[0]);
    assert.match(r.stderr, /applies no baseline/);
  }
});

test('every path rule spells exactly one source kind and one sink kind', () => {
  const path = Object.entries(FLOW_RULES).filter(([, v]) => v.evidence === 'path').map(([k]) => k);
  assert.ok(path.length > 50);
  assert.deepEqual(path.filter((r) => !kindsOf(r)), []);
});

test('the line diff marks a reworded line deleted and inserted, and gives up past its bound', () => {
  const d = lineDiff(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e']);
  assert.deepEqual([...d.deleted], [2]);
  assert.deepEqual([...d.inserted].sort(), [2, 5]);
  const many = Array.from({ length: 50 }, (_, i) => `l${i}`);
  assert.equal(lineDiff(many, many.map((l) => `${l}x`), 10), null);
  const r = lineDiff([], ['a', 'b']);
  assert.deepEqual([...r.inserted], [1, 2]);
});

test('a scan not asked for the engine listings carries none, and one asked prints none', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-gate-list-'));
  writeFileSync(join(root, 'P.cbl'), BASE);
  const plain = scanAll(root, { only: ['flow'] });
  assert.equal(plain.listed, undefined);
  const asked = scanAll(root, { only: ['flow'], listSinks: true, listSources: true });
  assert.ok(asked.listed.sinks.some((s) => s.kind === 'os-command' && s.line === 13));
  assert.ok(asked.listed.sources.some((s) => s.kind === 'argv-or-env' && s.line === 11));
  assert.equal(JSON.stringify(asked), JSON.stringify(plain));
});
