// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for the IMS DBD and PSB models and what DBDGEN and PSBGEN refuse in them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelOf, concatenatedKey } from '../lib/ims/model.mjs';
import './pin-machine.mjs';

const src = (...lines) => lines.map((l) => `         ${l}`).join('\n');
const messages = (m) => m.problems.map((p) => p.message);

const ORDERS = src(
  'DBD   NAME=ORDERDB,ACCESS=(HIDAM,VSAM)',
  'SEGM  NAME=ORDER,PARENT=0,BYTES=100',
  'FIELD NAME=(ORDNO,SEQ,U),BYTES=10,START=1,TYPE=C',
  'FIELD NAME=ORDDATE,BYTES=8,START=11,TYPE=C',
  'SEGM  NAME=ITEM,PARENT=ORDER,BYTES=(60,20)',
  'FIELD NAME=(ITEMNO,SEQ,U),BYTES=6,START=3,TYPE=C',
  'SEGM  NAME=NOTE,PARENT=((ITEM,DBLE)),BYTES=40',
  'DBDGEN',
  'FINISH',
  'END',
);

test('a DBD holds its segments in order, each with its parent, length and fields', () => {
  const m = modelOf(ORDERS);
  assert.equal(m.kind, 'DBD');
  assert.equal(m.name, 'ORDERDB');
  assert.deepEqual(m.access, { type: 'HIDAM', method: 'VSAM' });
  assert.deepEqual(m.segments.map((s) => [s.name, s.parent, s.bytes.max]), [['ORDER', null, 100], ['ITEM', 'ORDER', 60], ['NOTE', 'ITEM', 40]]);
  assert.deepEqual(m.segments[0].fields.map((f) => [f.name, f.seq, f.start, f.bytes]), [['ORDNO', true, 1, 10], ['ORDDATE', false, 11, 8]]);
  assert.equal(m.segments[1].bytes.min, 20);
  assert.deepEqual(m.problems, []);
  assert.equal(m.complete, true);
});

test('a field ending past its segment is FLD170, measured against the maximum of BYTES=(max,min)', () => {
  const m = modelOf(src(
    'DBD   NAME=D,ACCESS=HIDAM',
    'SEGM  NAME=ROOT,BYTES=(30,10)',
    'FIELD NAME=(K,SEQ,U),BYTES=10,START=3',
    'FIELD NAME=FITS,BYTES=10,START=21',
    'FIELD NAME=LONG,BYTES=10,START=22',
  ));
  assert.deepEqual(messages(m), ['FLD170']);
  assert.match(m.problems[0].text, /LONG ends at byte 31, past segment ROOT's 30 bytes/);
  assert.equal(m.problems[0].line, 5);
});

test('system-related fields take START from the concatenated key, so they are not measured against BYTES', () => {
  const m = modelOf(src('DBD   NAME=D,ACCESS=HIDAM', 'SEGM  NAME=ROOT,BYTES=8', 'FIELD NAME=(K,SEQ,U),BYTES=8,START=1', 'FIELD NAME=/CK,BYTES=8,START=5'));
  assert.deepEqual(m.problems, []);
});

test('a second sequence field is FLD120, except on a logical child', () => {
  const twice = modelOf(src('DBD   NAME=D,ACCESS=HIDAM', 'SEGM  NAME=ROOT,BYTES=20', 'FIELD NAME=(A,SEQ,U),BYTES=4,START=1', 'FIELD NAME=(B,SEQ,U),BYTES=4,START=5'));
  assert.deepEqual(messages(twice), ['FLD120']);
  assert.equal(twice.problems[0].line, 4);
  const child = modelOf(src(
    'DBD   NAME=D,ACCESS=HIDAM',
    'SEGM  NAME=ROOT,BYTES=20',
    'FIELD NAME=(A,SEQ,U),BYTES=4,START=1',
    'SEGM NAME=LC,PARENT=((ROOT,SNGL),(LP,PHYSICAL,ODB)),BYTES=20',
    'FIELD NAME=(B,SEQ,U),BYTES=4,START=1',
    'FIELD NAME=(C,SEQ,M),BYTES=4,START=5',
  ));
  assert.deepEqual(child.problems, []);
  assert.equal(child.segments[1].parent, 'ROOT');
  assert.equal(child.segments[1].logicalParent, 'LP');
});

test('a sequence field after another field is FLD230', () => {
  const m = modelOf(src('DBD   NAME=D,ACCESS=HIDAM', 'SEGM  NAME=ROOT,BYTES=20', 'FIELD NAME=DATA,BYTES=4,START=5', 'FIELD NAME=(KEY,SEQ,U),BYTES=4,START=1'));
  assert.deepEqual(messages(m), ['FLD230']);
});

test('duplicate fields and segments, an undefined parent and a field before any SEGM are refused by number', () => {
  const m = modelOf(src(
    'DBD   NAME=D,ACCESS=HIDAM',
    'FIELD NAME=EARLY,BYTES=4,START=1',
    'SEGM  NAME=ROOT,BYTES=20',
    'FIELD NAME=(K,SEQ,U),BYTES=4,START=1',
    'FIELD NAME=K,BYTES=4,START=5',
    'SEGM  NAME=ROOT,PARENT=0,BYTES=20',
    'SEGM  NAME=KID,PARENT=GHOST,BYTES=20',
  ));
  assert.deepEqual(messages(m), ['FLD100', 'FLD190', 'SEGM140', 'SEGM170']);
});

test('fields after a SEGM the reader refused belong to no segment, and parents are not checked past it', () => {
  const m = modelOf(src(
    'DBD   NAME=D,ACCESS=HIDAM',
    'SEGM  NAME=ROOT,BYTES=20',
    'FIELD NAME=(K,SEQ,U),BYTES=4,START=1',
    'SEGM  NAME=MID,PARENT=ROOT,BYTES=ABC',
    'FIELD NAME=WIDE,BYTES=40,START=1',
    'SEGM  NAME=LEAF,PARENT=MID,BYTES=20',
  ));
  assert.deepEqual(m.problems, []);
  assert.equal(m.complete, false);
  assert.deepEqual(m.unread.map((u) => [u.line, u.operation]), [[4, 'SEGM']]);
  assert.deepEqual(m.segments.map((s) => s.name), ['ROOT', 'LEAF']);
  assert.deepEqual(m.segments[0].fields.map((f) => f.name), ['K']);
});

const PAYROLL = src(
  'PCB   TYPE=TP,MODIFY=YES',
  'PCB   TYPE=DB,DBDNAME=ORDERDB,KEYLEN=16',
  'SENSEG NAME=ORDER,PARENT=0',
  'SENSEG NAME=ITEM,PARENT=ORDER,PROCOPT=G',
  'PCB   TYPE=DB,DBDNAME=ORDERDB,PROCOPT=GR,KEYLEN=10,PCBNAME=RDR',
  'SENSEG NAME=ORDER',
  'PSBGEN LANG=COBOL,PSBNAME=PAYROLL',
  'END',
);

test('a PSB holds its PCBs, PROCOPT A when the PCB omits it, and SENSEGs inheriting the PCB PROCOPT', () => {
  const m = modelOf(PAYROLL);
  assert.equal(m.kind, 'PSB');
  assert.equal(m.name, 'PAYROLL');
  assert.equal(m.lang, 'COBOL');
  assert.deepEqual(m.pcbs.map((p) => [p.name, p.type, p.dbd, p.procopt, p.procoptWritten, p.keylen]), [
    ['PCB 1', 'TP', null, null, null, null],
    ['PCB 2', 'DB', 'ORDERDB', 'A', null, 16],
    ['RDR', 'DB', 'ORDERDB', 'GR', 'GR', 10],
  ]);
  assert.deepEqual(m.pcbs[1].sensegs.map((s) => [s.name, s.parent, s.procopt, s.procoptWritten]), [['ORDER', null, 'A', null], ['ITEM', 'ORDER', 'G', 'G']]);
  assert.equal(m.pcbs[2].sensegs[0].procopt, 'GR');
  assert.deepEqual(m.problems, []);
});

test('SENSEG order and placement are refused by PSBGEN number', () => {
  const m = modelOf(src(
    'SENSEG NAME=EARLY',
    'PCB   TYPE=TP,LTERM=OUT',
    'SENSEG NAME=ONTP',
    'PCB   TYPE=DB,DBDNAME=D,KEYLEN=8',
    'SENSEG NAME=ROOT',
    'SENSEG NAME=ROOT',
    'SENSEG NAME=KID,PARENT=GHOST',
    'PSBGEN PSBNAME=P,LANG=COBOL',
  ));
  assert.deepEqual(messages(m), ['SEG110', 'SEG140', 'SEG150', 'SEG160']);
  assert.deepEqual(m.problems.map((p) => p.line), [1, 3, 6, 7]);
});

test('a SENSEG parent is not checked after a SENSEG the reader refused', () => {
  const m = modelOf(src('PCB   TYPE=DB,DBDNAME=D,KEYLEN=8', 'SENSEG NAME=ROOT', 'SENSEG NAME=MID,PARENT=ROOT,PROCOPT=X', 'SENSEG NAME=LEAF,PARENT=MID', 'PSBGEN PSBNAME=P'));
  assert.deepEqual(m.problems, []);
  assert.equal(m.pcbs[0].complete, false);
});

test('the concatenated key adds the first sequence field of each segment from the root down', () => {
  const m = modelOf(ORDERS);
  assert.equal(concatenatedKey(m, 'ORDER'), 10);
  assert.equal(concatenatedKey(m, 'ITEM'), 16);
  assert.equal(concatenatedKey(m, 'NOTE'), 16);
  assert.equal(concatenatedKey(m, 'MISSING'), null);
});

test('text with no DBD or PSB macro has no model', () => {
  assert.equal(modelOf(src('TITLE \'X\'', 'PRINT NOGEN')), null);
});
