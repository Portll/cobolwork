// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for the IMS DBD macro parsers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readIms, parseImsStatement } from '../lib/ims/read.mjs';
import './pin-machine.mjs';

const parse = (src) => parseImsStatement(readIms(src).statements[0]);

test('parses DBD with ACCESS, PASSWD, and VERSION', () => {
  const src = `       DBD     NAME=DBPAUTP0,ACCESS=(HIDAM,VSAM),PASSWD=NO,            C
               EXIT=(*,KEY,DATA,NOPATH,(NOCASCADE),LOG),               C
               VERSION=`;
  const result = parse(src);
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.kind, 'DBD');
  assert.equal(result.node.name, 'DBPAUTP0');
  assert.deepEqual(result.node.access, { type: 'HIDAM', method: 'VSAM' });
  assert.equal(result.node.passwd, 'NO');
  assert.equal(result.node.keywords['VERSION'], '');
});

test('parses DBD with INDEX access and PROT', () => {
  const src = `       DBD     NAME=DBPAUTX0,ACCESS=(INDEX,VSAM,PROT),PASSWD=NO,       X
               VERSION=`;
  const result = parse(src);
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.kind, 'DBD');
  assert.equal(result.node.name, 'DBPAUTX0');
  assert.deepEqual(result.node.access, { type: 'INDEX', method: 'VSAM' });
});

test('parses DBD with GSAM BSAM access', () => {
  const src = `       DBD     NAME=PADFLDBD,ACCESS=(GSAM,BSAM),PASSWD=NO,             C
               VERSION=             DATE 08/22/21 TIME 05.35`;
  const result = parse(src);
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.kind, 'DBD');
  assert.equal(result.node.name, 'PADFLDBD');
  assert.deepEqual(result.node.access, { type: 'GSAM', method: 'BSAM' });
});

test('parses DBD with RMNAME', () => {
  const src = `   DBD      NAME=DEDBJN21,                                             C
               ACCESS=(PHDAM,OSAM),                                    C
               RMNAME=(DFSHDC20,3,3,25),                               C
               PASSWD=NO`;
  const result = parse(src);
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.kind, 'DBD');
  assert.equal(result.node.name, 'DEDBJN21');
  assert.deepEqual(result.node.access, { type: 'PHDAM', method: 'OSAM' });
  assert.deepEqual(result.node.rmname, ['DFSHDC20', '3', '3', '25']);
  assert.equal(result.node.passwd, 'NO');
});

test('parses DATASET with label and keywords', () => {
  const src = `DSG001 DATASET DD1=DDPAUTP0,SIZE=(4096),SCAN=3`;
  const result = parse(src);
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.kind, 'DATASET');
  assert.equal(result.node.label, 'DSG001');
  assert.equal(result.node.dd1, 'DDPAUTP0');
  assert.deepEqual(result.node.size, ['4096']);
});

test('parses DATASET with DD1, DD2, RECORD, RECFM', () => {
  const src = `DSG001 DATASET DD1=PADFILIP,DD2=PADFILOP,RECORD=(200),RECFM=F`;
  const result = parse(src);
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.kind, 'DATASET');
  assert.equal(result.node.label, 'DSG001');
  assert.equal(result.node.dd1, 'PADFILIP');
  assert.equal(result.node.dd2, 'PADFILOP');
  assert.equal(result.node.keywords['RECFM'], 'F');
});

test('parses DATASET with DEVICE and BLOCK', () => {
  const src = `DSGROUP0 DATASET DD1=VPARTESD,                                         X
               DEVICE=3380,                                            X
               BLOCK=(4072)`;
  const result = parse(src);
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.kind, 'DATASET');
  assert.equal(result.node.label, 'DSGROUP0');
  assert.equal(result.node.dd1, 'VPARTESD');
  assert.equal(result.node.device, '3380');
});

test('parses DATASET with only DD1', () => {
  const src = `       DATASET   DD1=USRSCN`;
  const result = parse(src);
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.kind, 'DATASET');
  assert.equal(result.node.dd1, 'USRSCN');
});

test('parses SEGM with PARENT=0 and RULES', () => {
  const src = `       SEGM    NAME=PAUTSUM0,PARENT=0,BYTES=100,RULES=(,HERE),         X
               POINTER=(TWINBWD)`;
  const result = parse(src);
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.kind, 'SEGM');
  assert.equal(result.node.name, 'PAUTSUM0');
  assert.equal(result.node.parent, null);
  assert.deepEqual(result.node.bytes, { max: 100, min: 100 });
  assert.deepEqual(result.node.rules, ['', 'HERE']);
  assert.deepEqual(result.node.pointer, ['TWINBWD']);
});

test('parses SEGM with PARENT sublist', () => {
  const src = `       SEGM    NAME=PAUTDTL1,PARENT=((PAUTSUM0,)),BYTES=200`;
  const result = parse(src);
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.kind, 'SEGM');
  assert.equal(result.node.name, 'PAUTDTL1');
  assert.equal(result.node.parent, '(PAUTSUM0,)');
  assert.deepEqual(result.node.bytes, { max: 200, min: 200 });
});

test('parses SEGM with FREQ', () => {
  const src = `       SEGM    NAME=PAUTINDX,PARENT=0,BYTES=6,                         X
               FREQ=100000`;
  const result = parse(src);
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.kind, 'SEGM');
  assert.equal(result.node.name, 'PAUTINDX');
  assert.equal(result.node.parent, null);
  assert.deepEqual(result.node.bytes, { max: 6, min: 6 });
  assert.equal(result.node.keywords['FREQ'], '100000');
});

test('parses SEGM with BYTES sublist and TYPE', () => {
  const src = `    SEGM    NAME=HOSPITAL,                                             C
               PARENT=0,                                               C
               BYTES=(900),                                            C
               RULES=(LLL,HERE)`;
  const result = parse(src);
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.kind, 'SEGM');
  assert.equal(result.node.name, 'HOSPITAL');
  assert.equal(result.node.parent, null);
  assert.deepEqual(result.node.bytes, { max: 900, min: 900 });
  assert.deepEqual(result.node.rules, ['LLL', 'HERE']);
});

test('parses SEGM with PARENT name and TYPE=DIR', () => {
  const src = `    SEGM    NAME=PAYMENTS,                                             C
               PARENT=HOSPITAL,                                        C
               BYTES=(900),                                            C
               TYPE=DIR,                                               C
               RULES=(LLL,FIRST)`;
  const result = parse(src);
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.kind, 'SEGM');
  assert.equal(result.node.name, 'PAYMENTS');
  assert.equal(result.node.parent, 'HOSPITAL');
  assert.deepEqual(result.node.bytes, { max: 900, min: 900 });
  assert.equal(result.node.keywords['TYPE'], 'DIR');
});

test('parses FIELD with SEQ and U', () => {
  const src = `       FIELD   NAME=(ACCNTID,SEQ,U),START=1,BYTES=6,TYPE=P`;
  const result = parse(src);
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.kind, 'FIELD');
  assert.equal(result.node.name, 'ACCNTID');
  assert.equal(result.node.seq, true);
  assert.equal(result.node.unique, true);
  assert.equal(result.node.start, 1);
  assert.equal(result.node.bytes, 6);
  assert.equal(result.node.type, 'P');
});

test('parses FIELD with default TYPE C', () => {
  const src = `       FIELD   NAME=(PAUT9CTS,SEQ,U),START=1,BYTES=8,TYPE=C`;
  const result = parse(src);
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.kind, 'FIELD');
  assert.equal(result.node.name, 'PAUT9CTS');
  assert.equal(result.node.seq, true);
  assert.equal(result.node.unique, true);
  assert.equal(result.node.type, 'C');
});

test('parses FIELD without SEQ', () => {
  const src = `      FIELD NAME=(HOSPNAME),                                           C
               START=15,                                               C
               BYTES=17,                                               C
               TYPE=C`;
  const result = parse(src);
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.kind, 'FIELD');
  assert.equal(result.node.name, 'HOSPNAME');
  assert.equal(result.node.seq, false);
  assert.equal(result.node.unique, null);
  assert.equal(result.node.start, 15);
  assert.equal(result.node.bytes, 17);
  assert.equal(result.node.type, 'C');
});

test('parses LCHILD with NAME sublist and POINTER', () => {
  const src = `       LCHILD  NAME=(PAUTINDX,DBPAUTX0),                               X
               POINTER=INDX`;
  const result = parse(src);
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.kind, 'LCHILD');
  assert.equal(result.node.name, 'PAUTINDX');
  assert.equal(result.node.dbd, 'DBPAUTX0');
  assert.equal(result.node.keywords['POINTER'], 'INDX');
});

test('parses LCHILD with INDEX', () => {
  const src = `       LCHILD  NAME=(PAUTSUM0,DBPAUTP0),                               X
               INDEX=ACCNTID`;
  const result = parse(src);
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.kind, 'LCHILD');
  assert.equal(result.node.name, 'PAUTSUM0');
  assert.equal(result.node.dbd, 'DBPAUTP0');
  assert.equal(result.node.keywords['INDEX'], 'ACCNTID');
});

test('parses LCHILD with PTR', () => {
  const src = `       LCHILD    NAME=(USRSCNX,USRSCNI),PTR=INDX`;
  const result = parse(src);
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.kind, 'LCHILD');
  assert.equal(result.node.name, 'USRSCNX');
  assert.equal(result.node.dbd, 'USRSCNI');
  assert.equal(result.node.keywords['PTR'], 'INDX');
});

test('parses DBDGEN with no operands', () => {
  const src = `       DBDGEN`;
  const result = parse(src);
  assert.equal(result.status, 'parsed');
  assert.equal(result.node.kind, 'DBDGEN');
});

test('assembler instructions and IMS macros parse, anything else is unknown', () => {
  const src = `       TITLE
       SENSEG  NAME=TEST
       FOO     BAR`;
  const results = readIms(src).statements.map(parseImsStatement);
  assert.deepEqual(results.map(r => r.status), ['parsed', 'parsed', 'unknown']);
});

test('an operand the macro does not take is refused, so a statement counts as read only when every operand was', () => {
  const r = parse('         SEGM  NAME=A,PARENT=0,BYTES=8,COLOUR=RED');
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /COLOUR/);
});
