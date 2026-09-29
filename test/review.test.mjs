import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { diffRefs } from '../lib/diff.mjs';
import { scanCopybooks } from '../lib/sets/copybook.mjs';
import { TRACE_KEEP } from '../lib/dataflow.mjs';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const git = (dir, ...args) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
};
const program = (id, body, ws = '', linkage = '', using = '') => [
  '       IDENTIFICATION DIVISION.', `       PROGRAM-ID. ${id}.`, '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
  ws, linkage ? '       LINKAGE SECTION.' : '', linkage, `       PROCEDURE DIVISION${using ? ` USING ${using}` : ''}.`, body, '           GOBACK.', '',
].filter(l => l !== '').join('\n');
const record = (nameLen) => `       01  CUST-REC.\n           05  CUST-ID    PIC X(8).\n           05  CUST-NAME  PIC X(${nameLen}).\n           05  CUST-BAL   PIC S9(7)V99 COMP-3.\n`;

test('the benchmark scores every case as declared, so a flow change cannot regress a case silently', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'bench', 'run.mjs'), '--json'], { encoding: 'utf8' });
  const out = JSON.parse(r.stdout);
  assert.ok(out.cases >= 23, `only ${out.cases} cases found`);
  assert.deepEqual(out.results.filter(x => x.missing.length || x.extra.length).map(x => x.id), []);
  assert.equal(r.status, 0);
});

test('a copybook edit is reported in every program it reaches, including ones whose source did not change', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-review-'));
  try {
    mkdirSync(join(dir, 'copy'));
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'copy', 'CUSTREC.cpy'), record(30));
    writeFileSync(join(dir, 'src', 'PAYA.cbl'), program('PAYA', "           CALL 'PAYB' USING CUST-REC", '       COPY CUSTREC.'));
    writeFileSync(join(dir, 'src', 'PAYB.cbl'), program('PAYB', '           DISPLAY CUST-NAME', "       01  WS-PGM PIC X(8) VALUE 'AUDIT'.", '       COPY CUSTREC.', 'CUST-REC'));
    writeFileSync(join(dir, 'src', 'REPT.cbl'), program('REPT', '           DISPLAY CUST-BAL', '       COPY CUSTREC.'));
    git(dir, 'init', '-q');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');
    writeFileSync(join(dir, 'copy', 'CUSTREC.cpy'), record(40));
    const payb = readFileSync(join(dir, 'src', 'PAYB.cbl'), 'utf8').replace('           DISPLAY CUST-NAME', '           DISPLAY CUST-NAME\n           CALL WS-PGM');
    writeFileSync(join(dir, 'src', 'PAYB.cbl'), payb);

    const r = diffRefs(dir, 'HEAD', null, { only: ['flow'] });
    const by = (rule) => r.findings.filter(f => f.rule === rule).map(f => f.program).sort();
    assert.deepEqual(by('diff-interface-layout-changed'), ['PAYA', 'PAYB'], 'both ends of the CALL carry the widened record');
    assert.deepEqual(by('diff-layout-changed-unedited-program'), ['REPT'], 'a program nobody edited still changed');
    assert.deepEqual(by('diff-new-dynamic-call'), ['PAYB']);
    assert.equal(r.summary.reachedOnlyThroughCopybooks, 2);
    assert.deepEqual(r.summary.copybooksImplicated, ['copy/CUSTREC.cpy']);
    assert.match(r.findings.find(f => f.program === 'REPT').detail, /CUST-BAL 5→5 bytes at offset 38→48/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unchanged tree reports nothing, and a revision that does not exist is an error rather than an empty diff', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-review-'));
  try {
    writeFileSync(join(dir, 'P.cbl'), program('P', '           DISPLAY CUST-ID', '       COPY CUSTREC.'));
    writeFileSync(join(dir, 'CUSTREC.cpy'), record(30));
    git(dir, 'init', '-q');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');
    const r = diffRefs(dir, 'HEAD', null, { only: ['flow'] });
    assert.equal(r.summary.programsCompared, 1, 'the comparison must have read the program, or its zero means nothing');
    assert.deepEqual(r.findings, []);
    assert.throws(() => diffRefs(dir, 'no-such-ref'), /no-such-ref failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('two copybooks answering to one name with different layouts, and a copy of a system copybook, are reported', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-shadow-'));
  try {
    for (const [app, len] of [['app1', 30], ['app2', 40]]) {
      mkdirSync(join(dir, app));
      writeFileSync(join(dir, app, 'CUSTREC.cpy'), record(len));
      writeFileSync(join(dir, app, `P${app}.cbl`), program(`P${app}`, '           DISPLAY CUST-ID', '       COPY CUSTREC.\n       COPY SQLCA.'));
    }
    mkdirSync(join(dir, 'lib'));
    writeFileSync(join(dir, 'lib', 'SQLCA.cpy'), '       01  SQLCA.\n           05  SQLCODE PIC S9(9) COMP.\n');
    // Identical layouts differing only in the sequence area are the same copybook, not a shadow.
    mkdirSync(join(dir, 'app3'));
    writeFileSync(join(dir, 'app3', 'ADDR.cpy'), '000100 01  ADDR  PIC X(20).\n');
    writeFileSync(join(dir, 'lib', 'ADDR.cpy'), '000999 01  ADDR  PIC X(20).\n');

    const r = scanCopybooks(dir);
    const shadowed = r.findings.filter(f => f.rule === 'copybook-shadowed');
    assert.deepEqual(shadowed.map(f => f.name), ['CUSTREC']);
    assert.equal(shadowed[0].sev, 'med', 'the two programs resolve the name to different files');
    const sys = r.findings.filter(f => f.rule === 'copybook-shadows-system');
    assert.deepEqual(sys.map(f => [f.name, f.users, f.sev]), [['SQLCA', 2, 'med']]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a misspelled rule set is refused rather than running nothing', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'cobolwork.mjs'), 'scan', HERE, '--only', 'copybok'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /--only takes/);
});

// A working tree whose files git checked out through core.autocrlf, which is the default on
// Windows. The base is read out of the object store and the head is that tree, so comparing the
// two as raw bytes makes every file look edited and the unedited-program rule never fires. The
// config is set explicitly so the case is reproduced on every platform, not only on Windows.
test('a copybook edit is still attributed to the copybook when the working tree was checked out as CRLF', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-crlf-'));
  const origin = join(dir, 'origin');
  const work = join(dir, 'work');
  try {
    mkdirSync(join(origin, 'copy'), { recursive: true });
    mkdirSync(join(origin, 'src'), { recursive: true });
    writeFileSync(join(origin, 'copy', 'CUSTREC.cpy'), record(20));
    writeFileSync(join(origin, 'src', 'REPT.cbl'), program('REPT', '           DISPLAY CUST-BAL', '       COPY CUSTREC.'));
    git(origin, 'init', '-q');
    git(origin, 'add', '-A');
    git(origin, 'commit', '-qm', 'base');

    const clone = spawnSync('git', ['-c', 'core.autocrlf=true', 'clone', '-q', origin, work], { encoding: 'utf8' });
    assert.equal(clone.status, 0, clone.stderr);
    git(work, 'config', 'core.autocrlf', 'true');
    assert.ok(readFileSync(join(work, 'src', 'REPT.cbl'), 'utf8').includes('\r\n'), 'the checkout did not produce CRLF');
    assert.equal(spawnSync('git', ['-C', work, 'status', '--porcelain'], { encoding: 'utf8' }).stdout.trim(), '', 'the clone is not clean');

    // Only the copybook changes, and it keeps the tree's own line endings.
    writeFileSync(join(work, 'copy', 'CUSTREC.cpy'), record(30).replace(/\n/g, '\r\n'));

    const r = diffRefs(work, 'HEAD', null, { only: ['flow'] });
    assert.deepEqual(r.findings.filter(f => f.rule === 'diff-layout-changed-unedited-program').map(f => f.program),
      ['REPT'], 'a program nobody edited still changed');
    assert.equal(r.summary.reachedOnlyThroughCopybooks, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The flag reaches the scans diff runs over both trees. Accepted and ignored, it would exit 0 and
// hand back a truncated trace, which is the quiet wrong answer the CLI refuses elsewhere.
test('--full-trace reaches the findings a diff introduces', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-difftrace-'));
  try {
    const n = 90;
    const pad = (i) => String(i).padStart(3, '0');
    const chain = [
      '       IDENTIFICATION DIVISION.', '       PROGRAM-ID. LONGCH.',
      '       DATA DIVISION.', '       WORKING-STORAGE SECTION.', '       01 WS-Q             PIC X(200).',
      ...Array.from({ length: n }, (_, i) => `       01 WS-F${pad(i)}          PIC X(200).`),
      '       01 WS-STMT          PIC X(400).', '       PROCEDURE DIVISION.',
      '           EXEC CICS WEB RECEIVE INTO(WS-Q) LENGTH(200) END-EXEC', '           MOVE WS-Q TO WS-F000',
      ...Array.from({ length: n - 1 }, (_, i) => `           MOVE WS-F${pad(i)} TO WS-F${pad(i + 1)}`),
      `           MOVE WS-F${pad(n - 1)} TO WS-STMT`,
      '           EXEC SQL EXECUTE IMMEDIATE :WS-STMT END-EXEC', '           GOBACK.', ''].join('\n');

    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'LONGCH.cbl'), program('LONGCH', '           DISPLAY WS-Q', '       01 WS-Q PIC X(200).'));
    git(dir, 'init', '-q');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'base');
    writeFileSync(join(dir, 'src', 'LONGCH.cbl'), chain);

    const traces = (opts) => diffRefs(dir, 'HEAD', null, { only: ['flow'], ...opts })
      .introduced.filter(f => f.trace).map(f => f.trace.length);
    const capped = traces({});
    assert.deepEqual(capped, [TRACE_KEEP * 2 + 1], 'the default keeps both ends');
    assert.deepEqual(traces({ fullTrace: true }), [n + 2], 'every hop of the introduced flow');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
