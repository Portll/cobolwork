// A finding's identity across runs: what diff, a baseline and commitwork's issue store key on. The
// property every test here holds is the one a line-keyed identity broke - code moving above a
// finding is not the finding changing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanAll } from '../lib/scan.mjs';
import { toSarif } from '../lib/sarif.mjs';
import { diffRefs } from '../lib/diff.mjs';
import { cobolScopes, jclScopes, FINGERPRINT_VERSION } from '../lib/kernel/identity.mjs';
import './pin-machine.mjs';

const git = (dir, ...args) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
};
const inTemp = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-identity-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

// Fixed format, with a sequence number and an identification area the fingerprint must not see.
const fixed = (lines, tag = 'RUN01') => lines.map((l, i) => `${String((i + 1) * 100).padStart(6, '0')} ${l.padEnd(65)}${tag}`).join('\n') + '\n';
const program = (paragraphs, { before = [] } = {}) => fixed([
  'IDENTIFICATION DIVISION.',
  'PROGRAM-ID. RUNCMD.',
  'DATA DIVISION.',
  'WORKING-STORAGE SECTION.',
  '01 WS-IN PIC X(80).',
  '01 WS-CMD PIC X(80).',
  '01 WS-OTHER PIC X(80).',
  'PROCEDURE DIVISION.',
  'MAIN-LINE.',
  '    ACCEPT WS-IN FROM COMMAND-LINE',
  '    MOVE WS-IN TO WS-CMD',
  '    MOVE WS-IN TO WS-OTHER.',
  ...before,
  ...paragraphs,
  '    GOBACK.',
]);
const scanFlow = (dir) => scanAll(dir, { only: ['flow'] });
const runs = (report) => report.findings.filter((f) => f.rule === 'argv-or-env-to-os-command');

test('a finding keeps its fingerprint when code above it moves', () => inTemp((dir) => {
  const sink = ['RUN-IT.', "    CALL 'SYSTEM' USING WS-CMD."];
  writeFileSync(join(dir, 'RUNCMD.cbl'), program(sink));
  const [was] = runs(scanFlow(dir));
  writeFileSync(join(dir, 'RUNCMD.cbl'), program(sink, { before: ['    DISPLAY "A NEW LINE"', '    PERFORM LOG-IT.', 'LOG-IT.', '    DISPLAY "LOGGED".'] }));
  const [now] = runs(scanFlow(dir));
  assert.notEqual(now.line, was.line, 'the finding moved');
  assert.equal(now.fingerprint, was.fingerprint, 'and is the same finding');
  assert.match(now.fingerprint, /^[0-9a-f]{32}$/);
}));

test('renumbering the sequence and identification areas is not a change', () => inTemp((dir) => {
  const sink = ['RUN-IT.', "    CALL 'SYSTEM' USING WS-CMD."];
  writeFileSync(join(dir, 'RUNCMD.cbl'), program(sink));
  const [was] = runs(scanFlow(dir));
  writeFileSync(join(dir, 'RUNCMD.cbl'), program(sink).replace(/RUN01/g, 'CHG99').replace(/^\d{6}/gm, '000000'));
  const [now] = runs(scanFlow(dir));
  assert.equal(now.fingerprint, was.fingerprint);
}));

test('one rule twice in one file is two findings when the paragraphs differ, and one when nothing does', () => inTemp((dir) => {
  writeFileSync(join(dir, 'RUNCMD.cbl'), program(['FIRST-RUN.', "    CALL 'SYSTEM' USING WS-CMD.", 'SECOND-RUN.', "    CALL 'SYSTEM' USING WS-CMD."]));
  const two = scanFlow(dir);
  assert.equal(runs(two).length, 2);
  assert.equal(new Set(runs(two).map((f) => f.fingerprint)).size, 2, 'a paragraph is a stable name for where a statement is');
  assert.equal(two.summary.identity.shared, 0);

  writeFileSync(join(dir, 'RUNCMD.cbl'), program(['RUN-IT.', "    CALL 'SYSTEM' USING WS-CMD", "    CALL 'SYSTEM' USING WS-CMD."]));
  const same = scanFlow(dir);
  assert.equal(runs(same).length, 2, 'both statements are still reported');
  assert.equal(new Set(runs(same).map((f) => f.fingerprint)).size, 1, 'but nothing tells them apart except position');
  assert.equal(same.summary.identity.shared, 1, 'and the report says one identity was shared');
  assert.equal(same.summary.identity.version, FINGERPRINT_VERSION);
}));

test('editing the flagged statement makes it a different finding', () => inTemp((dir) => {
  writeFileSync(join(dir, 'RUNCMD.cbl'), program(['RUN-IT.', "    CALL 'SYSTEM' USING WS-CMD."]));
  const [was] = runs(scanFlow(dir));
  writeFileSync(join(dir, 'RUNCMD.cbl'), program(['RUN-IT.', "    CALL 'SYSTEM' USING WS-OTHER."]));
  const [now] = runs(scanFlow(dir));
  assert.notEqual(now.fingerprint, was.fingerprint);
}));

test('the program, not the file, carries a program finding, so moving the file keeps it', () => inTemp((dir) => {
  mkdirSync(join(dir, 'old'));
  mkdirSync(join(dir, 'new'));
  const src = program(['RUN-IT.', "    CALL 'SYSTEM' USING WS-CMD."]);
  writeFileSync(join(dir, 'old', 'RUNCMD.cbl'), src);
  const [was] = runs(scanFlow(dir));
  rmSync(join(dir, 'old'), { recursive: true });
  writeFileSync(join(dir, 'new', 'RUNCMD.cbl'), src);
  const [now] = runs(scanFlow(dir));
  assert.notEqual(now.path, was.path);
  assert.equal(now.fingerprint, was.fingerprint);
}));

test('a JCL finding is known by its job, step and DD, so a step added above it changes nothing', () => inTemp((dir) => {
  const job = (extra) => [
    '//PAYJOB   JOB (ACCT),CLASS=A',
    ...extra,
    '//STEP2    EXEC PGM=IKJEFT01',
    '//SYSIN    DD *',
    '  ALTUSER PAYUSR PASSWORD(SECRET1)',
    '/*',
    '',
  ].join('\n');
  writeFileSync(join(dir, 'PAY.jcl'), job([]));
  const pick = (r) => r.findings.filter((f) => f.rule === 'jcl-instream-credential');
  const [was] = pick(scanAll(dir, { only: ['jcl'] }));
  writeFileSync(join(dir, 'PAY.jcl'), job(['//STEP1    EXEC PGM=IEFBR14', '//DD1      DD DSN=A.B,DISP=SHR']));
  const [now] = pick(scanAll(dir, { only: ['jcl'] }));
  assert.ok(was && now);
  assert.notEqual(now.line, was.line);
  assert.equal(now.fingerprint, was.fingerprint);
}));

test('the same program in two repositories is two programs', () => inTemp((dir) => {
  for (const repo of ['a', 'b']) {
    mkdirSync(join(dir, repo));
    writeFileSync(join(dir, repo, 'RUNCMD.cbl'), program(['RUN-IT.', "    CALL 'SYSTEM' USING WS-CMD."]));
  }
  const r = scanAll(dir, { only: ['flow'], repos: ['a', 'b'] });
  const fps = runs(r).map((f) => f.fingerprint);
  assert.equal(fps.length, 2);
  assert.notEqual(fps[0], fps[1]);
}));

test('SARIF carries the identity, and a severity that survives critical and info', () => inTemp((dir) => {
  writeFileSync(join(dir, 'RUNCMD.cbl'), program(['RUN-IT.', "    CALL 'SYSTEM' USING WS-CMD."]));
  const report = scanFlow(dir);
  const run = toSarif(report, { toolVersion: 'test' }).runs[0];
  const i = report.findings.findIndex((f) => f.rule === 'argv-or-env-to-os-command');
  const result = run.results[i];
  assert.equal(result.partialFingerprints[FINGERPRINT_VERSION], report.findings[i].fingerprint);
  assert.equal(result.fingerprints[FINGERPRINT_VERSION], report.findings[i].fingerprint);
  assert.equal(result.level, 'error');
  assert.equal(result.properties.severity, 'crit', 'error alone cannot say critical');
  assert.equal(result.properties['security-severity'], '9.5');
  const rule = run.tool.extensions.flatMap((e) => e.rules).find((d) => d.id === 'argv-or-env-to-os-command');
  assert.equal(rule.properties['security-severity'], '9.5', 'code scanning ranks by the rule descriptor');
  const info = toSarif({ findings: [{ rule: 'opaque-alternate-entry', path: 'X.cbl', line: 3, sev: 'info', evidence: 'coverage', detail: 'x' }], summary: {} }).runs[0].results[0];
  assert.equal(info.properties.severity, 'info');
  assert.equal(info.properties['security-severity'], undefined, 'coverage is not ranked as a vulnerability');
}));

test('diff sees one finding fixed and another added, where the old key saw no change', () => inTemp((dir) => {
  writeFileSync(join(dir, 'RUNCMD.cbl'), program(['FIRST-RUN.', "    CALL 'SYSTEM' USING WS-CMD."]));
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'base');
  writeFileSync(join(dir, 'RUNCMD.cbl'), program(['FIRST-RUN.', "    DISPLAY WS-CMD.", 'SECOND-RUN.', "    CALL 'SYSTEM' USING WS-OTHER."]));
  const r = diffRefs(dir, 'HEAD', null, { only: ['flow'] });
  assert.deepEqual(r.introduced.map((f) => f.rule), ['argv-or-env-to-os-command']);
  assert.deepEqual(r.resolved.map((f) => f.rule), ['argv-or-env-to-os-command']);
}));

test('scopes come from labels and records the source declares, never from comments', () => {
  const src = fixed([
    'IDENTIFICATION DIVISION.',
    'PROGRAM-ID. SCOPED.',
    'DATA DIVISION.',
    'WORKING-STORAGE SECTION.',
    '01 WS-REC.',
    '   05 WS-A PIC X.',
    'PROCEDURE DIVISION.',
    'MAIN SECTION.',
    'START-UP.',
    '    DISPLAY "NOT-A-LABEL."',
    '*FAKE-LABEL.',
    '    STOP RUN.',
  ]);
  const at = cobolScopes(src, 'SCOPED.cbl');
  assert.equal(at[6], 'SCOPED/WS-REC');
  assert.equal(at[10], 'SCOPED/MAIN.START-UP');
  assert.equal(at[12], 'SCOPED/MAIN.START-UP', 'a commented label is not a label');
  const jcl = jclScopes(['//J1 JOB 1', '//S1 EXEC PGM=X', '//IN DD *', 'DATA', '/*'].join('\n'));
  assert.equal(jcl[4], 'J1/S1/IN');
});
