import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { directoryTree, pdsExportTree, unframeRecords, validateTree } from '../lib/kernel/source-tree.mjs';
import { scanAll } from '../lib/scan.mjs';
import { ebcdicByte, isCopybook, isJcl, isProgram } from '../lib/sources.mjs';
import './pin-machine.mjs';

const CLI = fileURLToPath(new URL('../bin/cobolwork.mjs', import.meta.url));
const posix = process.platform === 'win32';
const program = (id, ws, body) => ['       IDENTIFICATION DIVISION.', `       PROGRAM-ID. ${id}.`, '       DATA DIVISION.',
  '       WORKING-STORAGE SECTION.', ws, '       PROCEDURE DIVISION.', body, '           GOBACK.', ''].join('\n');
const PAYCALC = program('PAYCALC', '       01 WS-CMD PIC X(80).\n       COPY CUSTREC.', '           ACCEPT WS-CMD FROM COMMAND-LINE\n           CALL "SYSTEM" USING WS-CMD');
const CUSTREC = '       01 CUSTREC.\n          05 CUST-ID PIC X(8).\n';

function exportDir(files) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-pds-'));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}
const ebcdic = (line) => Buffer.from([...line.padEnd(80)].map((ch) => ebcdicByte(ch) ?? 0x40));
const framed = (records) => Buffer.concat(records.flatMap((r) => { const n = Buffer.alloc(4); n.writeUInt32BE(r.length); return [n, r]; }));

test('what zowe download all-members writes is read as members named for their data sets, and a directory scan of it reads nothing', () => {
  const dir = exportDir({ 'ibmuser/cobol/paycalc.txt': PAYCALC, 'ibmuser/copylib/custrec.txt': CUSTREC, 'ibmuser/cntl/runpay.txt': '//RUNPAY JOB (ACCT)\n//STEP1 EXEC PGM=PAYCALC\n' });
  try {
    const tree = validateTree(pdsExportTree(dir));
    assert.deepEqual(tree.list().map(tree.rel), ['IBMUSER.CNTL/RUNPAY', 'IBMUSER.COBOL/PAYCALC', 'IBMUSER.COPYLIB/CUSTREC']);
    assert.deepEqual(tree.list().map((p) => [isProgram(p), isCopybook(p), isJcl(p)]), [[false, false, true], [true, false, false], [false, true, false]]);
    assert.equal(tree.origin(resolve(tree.root, 'IBMUSER.COBOL/PAYCALC')), 'ibmuser/cobol/paycalc.txt');
    assert.deepEqual(tree.export, { dataSets: 3, members: 3, byKind: { jcl: 1, program: 1, copybook: 1 } });
    const r = tree.parse(resolve(tree.root, 'IBMUSER.COBOL/PAYCALC'));
    assert.deepEqual(r.copies.map((c) => [c.status, tree.rel(c.path)]), [['resolved', 'IBMUSER.COPYLIB/CUSTREC']]);

    const report = scanAll(tree.root, { tree });
    assert.deepEqual(report.findings.filter((f) => f.rule === 'argv-or-env-to-os-command').map((f) => [f.path, f.line]), [['IBMUSER.COBOL/PAYCALC', 9]]);
    assert.ok(report.findings[0].fingerprint);
    assert.equal(directoryTree(dir).list().filter(isProgram).length, 0, 'a .txt member is no kind to a directory scan');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('upper case, no extension and a directory named for the data set all name a member the same way, and a second file for it is reported', () => {
  const dir = exportDir({
    'IBMUSER/COBOL/PAYCALC': PAYCALC,
    'SYS1.COPYLIB/CUSTREC': CUSTREC,
    'sys1/copylib/custrec.cpy': '       01 OTHER PIC X.\n',
  });
  try {
    const tree = pdsExportTree(dir);
    assert.deepEqual(tree.list().map(tree.rel), ['IBMUSER.COBOL/PAYCALC', 'SYS1.COPYLIB/CUSTREC']);
    assert.equal(tree.export.duplicates, 1);
    assert.deepEqual(tree.export.duplicatesListed, ['sys1/copylib/custrec.cpy: SYS1.COPYLIB/CUSTREC is SYS1.COPYLIB/CUSTREC']);
    assert.equal(tree.parse(resolve(tree.root, 'IBMUSER.COBOL/PAYCALC')).programs[0].items.find((i) => i.name === 'CUST-ID').size, 8);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a path that is not a data set and member is counted and not read', () => {
  const dir = exportDir({
    'README.md': 'notes\n',
    'ibmuser/cobol/toolongname.txt': PAYCALC,
    'ibmuser/1bad/member.txt': PAYCALC,
    'my programs/paycalc.txt': PAYCALC,
    'ibmuser/cobol/pay.calc.txt': PAYCALC,
    'ibmuser/cobol/ok.txt': PAYCALC,
  });
  try {
    const tree = pdsExportTree(dir);
    assert.deepEqual(tree.list().map(tree.rel), ['IBMUSER.COBOL/OK', 'README']);
    assert.equal(tree.export.notMembers, 4);
    assert.deepEqual(tree.export.notMembersListed.sort(), ['ibmuser/1bad/member.txt', 'ibmuser/cobol/pay.calc.txt', 'ibmuser/cobol/toolongname.txt', 'my programs/paycalc.txt']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('members downloaded with --binary and with --record are decoded and parse', () => {
  const lines = PAYCALC.split('\n').filter(Boolean);
  const dir = exportDir({
    'ibmuser/cobol/paycalc': Buffer.concat(lines.map(ebcdic)),
    'ibmuser/cobol2/paycalc': framed(lines.map((l) => ebcdic(l).subarray(0, 72))),
    'ibmuser/copylib/custrec': framed(CUSTREC.split('\n').filter(Boolean).map((l) => Buffer.from(l, 'latin1'))),
  });
  try {
    const tree = pdsExportTree(dir);
    assert.deepEqual(tree.export.byKind, { program: 2, copybook: 1 });
    for (const m of ['IBMUSER.COBOL/PAYCALC', 'IBMUSER.COBOL2/PAYCALC']) {
      const p = resolve(tree.root, m);
      assert.equal(tree.text(p).encoding, 'ebcdic', m);
      const r = tree.parse(p);
      assert.equal(r.programs[0].id, 'PAYCALC', m);
      assert.equal(r.copies[0].status, 'resolved', m);
    }
    assert.equal(tree.text(resolve(tree.root, 'IBMUSER.COPYLIB/CUSTREC')).text, CUSTREC);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('record framing is taken only where the lengths chain exactly to the end', () => {
  const text = Buffer.from('       01 A PIC X.\n');
  assert.equal(unframeRecords(text), text);
  assert.equal(unframeRecords(Buffer.alloc(0)).length, 0);
  const whole = framed([Buffer.from('AB'), Buffer.from('C')]);
  assert.equal(unframeRecords(whole).toString(), 'AB\nC\n');
  const short = whole.subarray(0, whole.length - 1);
  assert.equal(unframeRecords(short), short);
  const long = Buffer.concat([whole, Buffer.from([0])]);
  assert.equal(unframeRecords(long), long);
  const huge = framed([Buffer.alloc(0)]);
  huge.writeUInt32BE(40000);
  assert.equal(unframeRecords(huge), huge);
  const empties = Buffer.alloc(12);
  assert.equal(unframeRecords(empties), empties);
});

test('COPY cannot leave a PDS export: absolute and climbing names are refused, and COBCPY is a declared library', () => {
  const lib = mkdtempSync(join(tmpdir(), 'cw-pds-lib-'));
  const dir = exportDir({ 'ibmuser/cobol/c.txt': program('C', '       COPY "/etc/hosts".\n       COPY "../../outside".\n       COPY SHARED.', '') });
  const saved = process.env.COBCPY;
  try {
    writeFileSync(join(lib, 'SHARED.cpy'), '       01 SH PIC X(4).\n');
    writeFileSync(join(dir, 'outside.cpy'), '       01 O PIC X.\n');
    const tree = pdsExportTree(dir);
    const parse = () => tree.parse(resolve(tree.root, 'IBMUSER.COBOL/C')).copies.map((c) => c.status);
    delete process.env.COBCPY;
    assert.deepEqual(parse(), ['refused-absolute', 'refused-outside', 'missing']);
    process.env.COBCPY = lib;
    assert.deepEqual(parse(), ['refused-absolute', 'refused-outside', 'resolved']);
  } finally {
    if (saved === undefined) delete process.env.COBCPY; else process.env.COBCPY = saved;
    rmSync(dir, { recursive: true, force: true });
    rmSync(lib, { recursive: true, force: true });
  }
});

test('a file on disk where the export\'s root would be is never read in its place', () => {
  const dir = exportDir({ 'ibmuser/cobol/p.txt': program('P', '       COPY GHOST.', '') });
  try {
    const tree = pdsExportTree(dir);
    mkdirSync(join(tree.root, 'IBMUSER.COBOL'), { recursive: true });
    writeFileSync(join(tree.root, 'IBMUSER.COBOL', 'GHOST'), '       01 G PIC X.\n');
    try {
      assert.equal(tree.parse(resolve(tree.root, 'IBMUSER.COBOL/P')).copies[0].status, 'missing');
      assert.equal(tree.contains(join(tree.root, 'IBMUSER.COBOL', 'GHOST')), false);
    } finally { rmSync(tree.root, { recursive: true, force: true }); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a link out of the export is not followed, and a member swapped for a link after the walk is refused', { skip: posix }, () => {
  const outside = mkdtempSync(join(tmpdir(), 'cw-pds-out-'));
  const dir = exportDir({ 'ibmuser/cobol/p.txt': program('P', '       COPY SECRET.', ''), 'ibmuser/copylib/a.txt': CUSTREC });
  try {
    writeFileSync(join(outside, 'secret.txt'), '       01 S PIC X.\n');
    symlinkSync(join(outside, 'secret.txt'), join(dir, 'ibmuser', 'copylib', 'secret.txt'));
    const tree = pdsExportTree(dir);
    assert.deepEqual(tree.list().map(tree.rel), ['IBMUSER.COBOL/P', 'IBMUSER.COPYLIB/A']);
    assert.equal(tree.index.symlinks.outside, 1);
    assert.equal(tree.parse(resolve(tree.root, 'IBMUSER.COBOL/P')).copies[0].status, 'missing');

    unlinkSync(join(dir, 'ibmuser', 'copylib', 'a.txt'));
    symlinkSync(join(outside, 'secret.txt'), join(dir, 'ibmuser', 'copylib', 'a.txt'));
    assert.throws(() => tree.bytes(resolve(tree.root, 'IBMUSER.COPYLIB/A')), { code: 'ELOOP' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('scan --pds-export reads the export, and the flag is refused where it does nothing', () => {
  const dir = exportDir({ 'ibmuser/cobol/paycalc.txt': PAYCALC, 'ibmuser/copylib/custrec.txt': CUSTREC });
  try {
    const env = { ...process.env, COBOLWORK_FREE_MEMORY_MB: '8000' };
    const r = spawnSync(process.execPath, [CLI, 'scan', dir, '--pds-export'], { encoding: 'utf8', env });
    assert.equal(r.status, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.summary.pdsExport.members, 2);
    assert.ok(report.findings.some((f) => f.rule === 'argv-or-env-to-os-command' && f.path === 'IBMUSER.COBOL/PAYCALC'));
    for (const argv of [['gate', dir, '--pds-export', '--base', 'HEAD', '--target', 'x'], ['scan', dir, '--pds-export', '--repos']]) {
      const refused = spawnSync(process.execPath, [CLI, ...argv], { encoding: 'utf8', env });
      assert.equal(refused.status, 2, argv.join(' '));
      assert.match(refused.stderr, /--pds-export/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
