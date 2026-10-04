// XMIT files and IEBCOPY unloads in a PDS export, built here byte by byte from IBM's published
// layouts: TSO/E Customization "Format of transmitted data" and "Numeric values", and DFSMSdfp
// Utilities "Unload partitioned data set format". No corpus holds a real one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { diffRefs } from '../lib/diff.mjs';
import { readArchive } from '../lib/kernel/pds-archive.mjs';
import { pdsExportTree, validateTree } from '../lib/kernel/source-tree.mjs';
import { scanAll } from '../lib/scan.mjs';
import { ebcdicByte } from '../lib/sources.mjs';
import './pin-machine.mjs';

const PAYCALC = ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. PAYCALC.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
  '       01 WS-CMD PIC X(80).', '       COPY CUSTREC.', '       PROCEDURE DIVISION.', '           ACCEPT WS-CMD FROM COMMAND-LINE',
  '           CALL "SYSTEM" USING WS-CMD', '           GOBACK.'];
const CUSTREC = ['       01 CUSTREC.', '          05 CUST-ID PIC X(8).'];

const ebcdic = (text, width = text.length) => Buffer.from([...text.padEnd(width)].map((ch) => ebcdicByte(ch) ?? 0x40));
const half = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const cards = (lines) => lines.map((l) => ebcdic(l, 80));

// A text unit: key, count, and each field after its length.
const unit = (key, ...fields) => Buffer.concat([half(key), half(fields.length), ...fields.flatMap((f) => [half(f.length), f])]);
const num = (n, width) => { const b = Buffer.alloc(width); b.writeUIntBE(n, 0, width); return b; };

// A transmission: each logical record cut into segments of at most 253 bytes after a length byte and
// a flag byte (X'80' first, X'40' last, X'20' control record), the stream padded to 80-byte cards.
function transmission(records) {
  const segments = records.flatMap(({ control, bytes }) => {
    const out = [];
    for (let at = 0; at < bytes.length || at === 0; at += 253) {
      const piece = bytes.subarray(at, at + 253);
      const flags = (at === 0 ? 0x80 : 0) | (at + 253 >= bytes.length ? 0x40 : 0) | (control ? 0x20 : 0);
      out.push(Buffer.from([piece.length + 2, flags]), piece);
    }
    return out;
  });
  const stream = Buffer.concat(segments);
  return Buffer.concat([stream, Buffer.alloc((80 - (stream.length % 80)) % 80, 0x40)]);
}

const control = (id, ...parts) => ({ control: true, bytes: Buffer.concat([ebcdic(id), ...parts]) });
const header = control('INMR01', unit(0x1011, ebcdic('NODEA')), unit(0x1012, ebcdic('IBMUSER')), unit(0x1001, ebcdic('NODEB')), unit(0x1002, ebcdic('IBMUSER')),
  unit(0x1024, ebcdic('20261004120000')), unit(0x0042, num(80, 2)), unit(0x102f, num(1, 4)));
const dsnam = (dsn) => unit(0x0002, ...dsn.split('.').map((q) => ebcdic(q)));

// The geometry the unloads below were taken on: 15 tracks a cylinder, the data set in two extents,
// the first from cylinder X'10' track 0 for 2 tracks, the second from cylinder X'20' track 5.
const TRACKS_PER_CYLINDER = 15;
const EXTENTS = [{ cc: 0x10, hh: 0, tracks: 2 }, { cc: 0x20, hh: 5, tracks: 30 }];

function copyr1({ pdse = false } = {}) {
  const r = Buffer.alloc(56);
  r[0] = pdse ? 0x41 : 0x00;
  Buffer.from([0xca, 0x6d, 0x0f]).copy(r, 1);
  r.writeUInt16BE(0x0200, 4);
  r.writeUInt16BE(160, 6);
  r.writeUInt16BE(80, 8);
  r[10] = 0x90;
  r.writeUInt16BE(184, 14);
  Buffer.from([0x30, 0x50, 0x20, 0x0f, 0, 0, 0xdc, 0xa8, 0x0d, 0x0b, 0, TRACKS_PER_CYLINDER]).copy(r, 16);
  return r;
}

function copyr2() {
  const r = Buffer.alloc(276);
  EXTENTS.forEach((e, i) => {
    const at = 16 + i * 16;
    r.writeUInt16BE(e.cc, at + 6);
    r.writeUInt16BE(e.hh, at + 8);
    r.writeUInt16BE(e.tracks, at + 14);
  });
  return r;
}

// Directory blocks: a count field that is zero but for the key length 8 and data length 256, the
// last name in the block as its key, and 256 bytes whose first halfword counts the bytes in use.
function directory(entries) {
  const data = Buffer.alloc(256);
  let at = 2;
  for (const { name, ttr, alias } of entries) {
    ebcdic(name, 8).copy(data, at);
    data.writeUIntBE(ttr, at + 8, 3);
    data[at + 11] = alias ? 0x80 : 0;
    at += 12;
  }
  Buffer.alloc(8, 0xff).copy(data, at);
  at += 12;
  data.writeUInt16BE(at, 0);
  const count = Buffer.alloc(12);
  count[9] = 8;
  count.writeUInt16BE(256, 10);
  return Buffer.concat([count, Buffer.alloc(8, 0xff), data, Buffer.alloc(12)]);
}

// A member's blocks, each after its count field (flag, M, BB, CC, HH, R, key length, data length),
// then the end-of-member block with no key and no data.
function memberRecord({ m, cc, hh, r }, lines) {
  const blocks = [];
  const records = cards(lines);
  for (let i = 0; i < records.length; i += 2) {
    const data = Buffer.concat(records.slice(i, i + 2));
    const count = Buffer.alloc(12);
    count[1] = m;
    count.writeUInt16BE(cc, 4);
    count.writeUInt16BE(hh, 6);
    count[8] = r + i / 2;
    count.writeUInt16BE(data.length, 10);
    blocks.push(count, data);
  }
  const eof = Buffer.alloc(12);
  eof[1] = m;
  return Buffer.concat([...blocks, eof]);
}

// PAYCALC's first block is on relative track 1, record 1: extent 0, cylinder X'10', track 1.
// CUSTREC's is on relative track 2 + 15 - 3 = 14, record 3: extent 1, cylinder X'21', track 2.
function unloadRecords(opts = {}) {
  return [copyr1(opts), copyr2(), directory([
    { name: 'CUSTREC', ttr: 0x000e03 }, { name: 'PAYCALC', ttr: 0x000101 }, { name: 'PAYOLD', ttr: 0x000101, alias: true },
  ]), memberRecord({ m: 0, cc: 0x10, hh: 1, r: 1 }, PAYCALC), memberRecord({ m: 1, cc: 0x21, hh: 2, r: 3 }, opts.custrec || CUSTREC)];
}

const withBdwSdw = (records) => Buffer.concat(records.map((r) => Buffer.concat([half(r.length + 8), half(0), half(r.length + 4), half(0), r])));
const withRdw = (records) => Buffer.concat(records.map((r) => Buffer.concat([half(r.length + 4), half(0), r])));

function xmitOfUnload(dsn, records) {
  return transmission([
    header,
    control('INMR02', num(1, 4), unit(0x1028, ebcdic('IEBCOPY')), dsnam(dsn), unit(0x003c, num(0x0200, 2)), unit(0x0042, num(80, 2)), unit(0x0049, num(0x9000, 2)), unit(0x102c, num(4000, 4))),
    control('INMR02', num(1, 4), unit(0x1028, ebcdic('INMCOPY')), unit(0x003c, num(0x4000, 2)), unit(0x0042, num(184, 2)), unit(0x0049, num(0x0001, 2)), unit(0x102c, num(4000, 4))),
    control('INMR03', unit(0x003c, num(0x4000, 2)), unit(0x0042, num(184, 2)), unit(0x0049, num(0x0001, 2)), unit(0x102c, num(4000, 4))),
    ...records.map((bytes) => ({ control: false, bytes })),
    control('INMR06'),
  ]);
}

function exportOf(files) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-pds-archive-'));
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(dir, name), bytes);
  return dir;
}

const lines = (tree, member) => tree.text(resolve(tree.root, member)).text.split('\n').map((l) => l.trimEnd()).filter(Boolean);

test('an XMIT of a partitioned data set gives its members under the data set it names, an alias counted and not held twice', () => {
  const dir = exportOf({ 'payroll.xmi': xmitOfUnload('IBMUSER.PAYROLL.COBOL', unloadRecords()) });
  try {
    const tree = validateTree(pdsExportTree(dir));
    assert.deepEqual(tree.list().map(tree.rel), ['IBMUSER.PAYROLL.COBOL/CUSTREC', 'IBMUSER.PAYROLL.COBOL/PAYCALC']);
    assert.deepEqual(lines(tree, 'IBMUSER.PAYROLL.COBOL/PAYCALC'), PAYCALC);
    assert.deepEqual(lines(tree, 'IBMUSER.PAYROLL.COBOL/CUSTREC'), CUSTREC);
    assert.equal(tree.origin(resolve(tree.root, 'IBMUSER.PAYROLL.COBOL/PAYCALC')), 'payroll.xmi(PAYCALC)');
    assert.deepEqual(tree.export.archives, { files: 1, members: 2, aliases: 1 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an unload alone is read with its descriptors, with RDWs or bare, and named by its file; a member is placed by the TTR its blocks\' MBBCCHHR gives across extents', () => {
  const records = unloadRecords();
  for (const bytes of [withBdwSdw(records), withRdw(records), Buffer.concat(records)]) {
    const a = readArchive(bytes);
    assert.equal(a.why, undefined);
    assert.deepEqual(a.members.map((m) => m.name), ['PAYCALC', 'CUSTREC']);
    assert.deepEqual(a.aliases, ['PAYOLD']);
  }
  const dir = exportOf({ 'IBMUSER.COPYLIB.unload': withBdwSdw(records) });
  try {
    const tree = pdsExportTree(dir);
    assert.deepEqual(tree.list().map(tree.rel), ['IBMUSER.COPYLIB/CUSTREC', 'IBMUSER.COPYLIB/PAYCALC']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a member whose blocks no directory entry names is counted, not held under a guessed name', () => {
  const records = unloadRecords();
  records[3] = memberRecord({ m: 0, cc: 0x10, hh: 0, r: 7 }, PAYCALC);
  const a = readArchive(Buffer.concat(records));
  assert.deepEqual(a.members.map((m) => m.name), ['CUSTREC']);
  assert.equal(a.unmatched, 1);
  assert.deepEqual(a.missing, ['PAYCALC']);
});

test('an XMIT of a sequential data set is one file named by its data set', () => {
  const xmit = transmission([
    header,
    control('INMR02', num(1, 4), unit(0x1028, ebcdic('INMCOPY')), dsnam('IBMUSER.PAYCALC.SOURCE'), unit(0x003c, num(0x4000, 2)), unit(0x0042, num(80, 2)), unit(0x0049, num(0x9000, 2)), unit(0x102c, num(800, 4))),
    control('INMR03', unit(0x003c, num(0x4000, 2)), unit(0x0042, num(80, 2)), unit(0x0049, num(0x9000, 2)), unit(0x102c, num(800, 4))),
    ...cards(PAYCALC).map((bytes) => ({ control: false, bytes })),
    control('INMR06'),
  ]);
  const dir = exportOf({ 'paycalc.xmit': xmit });
  try {
    const tree = pdsExportTree(dir);
    assert.deepEqual(tree.list().map(tree.rel), ['IBMUSER.PAYCALC.SOURCE']);
    assert.deepEqual(lines(tree, 'IBMUSER.PAYCALC.SOURCE'), PAYCALC);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a transmission cut short, a PDSE unload and an unload IEBCOPY marked in error are reported and not read', () => {
  const cut = xmitOfUnload('IBMUSER.PAYROLL.COBOL', unloadRecords());
  const pdse = withBdwSdw(unloadRecords({ pdse: true }));
  const broken = Buffer.concat(unloadRecords());
  broken[0] = 0x80;
  const dir = exportOf({ 'cut.xmi': cut.subarray(0, 400), 'PDSE.LIB.unload': pdse, 'BROKEN.LIB.unload': broken });
  try {
    const tree = pdsExportTree(dir);
    assert.deepEqual(tree.list(), []);
    assert.deepEqual(tree.export.archives.notReadListed, [
      'BROKEN.LIB.unload: IEBCOPY marked the unload incomplete or in error',
      'PDSE.LIB.unload: a PDSE unload, whose attribute records cobolwork does not read yet',
      'cut.xmi: the transmission ends before its INMR06 trailer',
    ]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a scan of an export holding an XMIT reports findings in the member, with COPY resolved in the same data set', () => {
  const dir = exportOf({ 'payroll.xmi': xmitOfUnload('IBMUSER.PAYROLL.COBOL', unloadRecords()) });
  try {
    const tree = pdsExportTree(dir);
    const report = scanAll(tree.root, { tree, feedRoot: dir, only: ['flow'] });
    assert.ok(report.findings.some((f) => f.rule === 'argv-or-env-to-os-command' && f.path === 'IBMUSER.PAYROLL.COBOL/PAYCALC'), JSON.stringify(report.findings.map((f) => [f.rule, f.path])));
    const parsed = tree.parse(resolve(tree.root, 'IBMUSER.PAYROLL.COBOL/PAYCALC'));
    assert.deepEqual(parsed.copies.map((c) => [c.status, tree.rel(c.path)]), [['resolved', 'IBMUSER.PAYROLL.COBOL/CUSTREC']]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const git = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const WIDER = ['       01 CUSTREC.', '          05 CUST-ID PIC X(10).'];

// A repository holding an export, a commit for each map of files.
function exportRepo(...revisions) {
  const root = mkdtempSync(join(tmpdir(), 'cw-pds-diff-'));
  git(root, ['init', '-q']);
  for (const [k, v] of [['user.email', 't@example.com'], ['user.name', 't'], ['core.autocrlf', 'false']]) git(root, ['config', k, v]);
  revisions.forEach((files, i) => {
    for (const [name, bytes] of Object.entries(files)) {
      mkdirSync(join(root, name, '..'), { recursive: true });
      writeFileSync(join(root, name), bytes);
    }
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', `r${i}`]);
  });
  return root;
}

const layoutChanged = (res) => res.findings.filter((f) => f.rule.startsWith('diff-layout')).map((f) => [f.rule, f.path]);

test('diff --pds-export compares two revisions of an export member by member, and the working tree against one', { skip: spawnSync('git', ['--version']).status !== 0 && 'git is not installed' }, () => {
  const text = (lines) => `${lines.join('\n')}\n`;
  const root = exportRepo(
    { 'ibmuser/cobol/paycalc.txt': text(PAYCALC), 'ibmuser/copylib/custrec.txt': text(CUSTREC) },
    { 'ibmuser/copylib/custrec.txt': text(WIDER) },
  );
  try {
    const res = diffRefs(root, 'HEAD~1', 'HEAD', { pdsExport: true });
    assert.deepEqual(layoutChanged(res), [['diff-layout-changed-unedited-program', 'IBMUSER.COBOL/PAYCALC']]);
    assert.equal(res.summary.pdsExport.head.members, 2);
    writeFileSync(join(root, 'ibmuser/copylib/custrec.txt'), text(CUSTREC));
    assert.deepEqual(layoutChanged(diffRefs(root, 'HEAD', null, { pdsExport: true })), [['diff-layout-changed-unedited-program', 'IBMUSER.COBOL/PAYCALC']]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('diff --pds-export reads an XMIT in each revision', { skip: spawnSync('git', ['--version']).status !== 0 && 'git is not installed' }, () => {
  const root = exportRepo(
    { 'payroll.xmi': xmitOfUnload('IBMUSER.PAYROLL.COBOL', unloadRecords()) },
    { 'payroll.xmi': xmitOfUnload('IBMUSER.PAYROLL.COBOL', unloadRecords({ custrec: WIDER })) },
  );
  try {
    assert.deepEqual(layoutChanged(diffRefs(root, 'HEAD~1', 'HEAD', { pdsExport: true })), [['diff-layout-changed-unedited-program', 'IBMUSER.PAYROLL.COBOL/PAYCALC']]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
