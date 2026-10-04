// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for the IMS PSB macro parsers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readIms, parseImsStatement, PARSERS, IMS_MACROS } from '../lib/ims/read.mjs';
import './pin-machine.mjs';

const parse = (src) => parseImsStatement(readIms(src).statements[0]);
const node = (src) => { const r = parse(src); assert.equal(r.status, 'parsed', r.reason); return r.node; };
const refused = (src, why) => { const r = parse(src); assert.equal(r.status, 'unparsed'); assert.match(r.reason, why); };
const card = (text) => text.padEnd(71) + 'X';
// Text with no blanks run over as many cards as it needs, each continued in column 72.
const cards = (text) => {
  const out = [text.slice(0, 71)];
  for (let i = 71; i < text.length; i += 56) out.push(' '.repeat(15) + text.slice(i, i + 56));
  return out.map((c, i) => (i < out.length - 1 ? card(c) : c)).join('\n');
};

test('a database PCB carries its DBD, PROCOPT as written, KEYLEN, POS and name', () => {
  const n = node([
    card('PAUTBPCB PCB   TYPE=DB,DBDNAME=DBPAUTP0,PROCOPT=GOTP,'),
    '               KEYLEN=14,POS=M,PROCSEQ=X4',
  ].join('\n'));
  assert.equal(n.kind, 'PCB');
  assert.equal(n.type, 'DB');
  assert.equal(n.name, 'PAUTBPCB');
  assert.equal(n.label, 'PAUTBPCB');
  assert.equal(n.pcbname, null);
  assert.equal(n.dbd, 'DBPAUTP0');
  assert.equal(n.procopt, 'GOTP');
  assert.equal(n.keylen, 14);
  assert.equal(n.pos, 'MULTIPLE');
  assert.equal(n.procseq, 'X4');
  assert.equal(n.list, true);
});

test('a database PCB with no PROCOPT carries null rather than the default A', () => {
  const n = node('PARTROOT PCB TYPE=DB,DBDNAME=PARTMSTR,KEYLEN=10,LIST=NO');
  assert.equal(n.procopt, null);
  assert.equal(n.list, false);
  assert.equal(n.keylen, 10);
});

test('a database PCB requires KEYLEN, an integer up to 32767', () => {
  refused('PARTROOT PCB TYPE=DB,DBDNAME=PARTMSTR,PROCOPT=A,LIST=NO', /requires KEYLEN/);
  refused('         PCB   TYPE=DB,DBDNAME=D,KEYLEN=32768', /KEYLEN must be an integer from 0 to 32767/);
  refused('         PCB   TYPE=DB,DBDNAME=D,KEYLEN=ABC', /KEYLEN must be an integer/);
  assert.equal(node('         PCB   TYPE=DB,DBDNAME=D,KEYLEN=32767').keylen, 32767);
});

test('NAME stands for DBDNAME on a database PCB, and the two together are refused', () => {
  assert.equal(node('         PCB      TYPE=DB,NAME=FISDBD1,PROCOPT=GRP,KEYLEN=20').dbd, 'FISDBD1');
  refused('         PCB   TYPE=DB,DBDNAME=A,NAME=B,PROCOPT=A', /DBDNAME and NAME/);
  refused('         PCB   TYPE=DB,PROCOPT=A,KEYLEN=8', /requires DBDNAME or NAME/);
});

test('PROCOPT letters outside the reference set, or more than four, are refused by name', () => {
  for (const ok of ['A', 'GIDR', 'GOTP', 'LS', 'GS', 'AP', 'GONP', 'GE', 'AH']) assert.equal(node(`         PCB   TYPE=DB,DBDNAME=D,PROCOPT=${ok},KEYLEN=8`).procopt, ok);
  refused('         PCB   TYPE=DB,DBDNAME=D,PROCOPT=GX,KEYLEN=8', /PROCOPT GX: X/);
  refused('         PCB   TYPE=DB,DBDNAME=D,PROCOPT=GK,KEYLEN=8', /PROCOPT GK: K/);
  refused('         PCB   TYPE=DB,DBDNAME=D,PROCOPT=GIRDP,KEYLEN=8', /more than 4/);
  refused('         PCB   TYPE=DB,DBDNAME=D,PROCOPT=,KEYLEN=8', /PROCOPT is empty/);
});

test('O, N and T are read only in the forms GO, GOP, GON, GONP, GOT and GOTP', () => {
  for (const ok of ['GO', 'GOP', 'GON', 'GONP', 'GOT', 'GOTP']) assert.equal(node(`         PCB   TYPE=DB,DBDNAME=D,PROCOPT=${ok},KEYLEN=8`).procopt, ok);
  for (const bad of ['GIO', 'O', 'GN', 'AT', 'GONH', 'GOTH', 'GOH']) refused(`         PCB   TYPE=DB,DBDNAME=D,PROCOPT=${bad},KEYLEN=8`, /O, N and T are written only as/);
});

test('a label and PCBNAME on a database PCB must be the same name', () => {
  assert.equal(node('PRT      PCB   TYPE=DB,DBDNAME=D,PCBNAME=PRT,KEYLEN=8').name, 'PRT');
  refused('PRT      PCB   TYPE=DB,DBDNAME=D,PCBNAME=OTHER,KEYLEN=8', /label PRT and PCBNAME OTHER/);
  assert.equal(node('         PCB   TYPE=DB,DBDNAME=D,PCBNAME=PARTMSTR,KEYLEN=8').name, 'PARTMSTR');
});

test('LIST=NO is refused on a PCB with no name', () => {
  refused('         PCB   TYPE=DB,DBDNAME=D,LIST=NO', /LIST=NO/);
});

test('PSELOPT and ACCESS are read only with PROCSEQD, and ACCESS takes DB, INDEX or the INDEX pairs', () => {
  const n = node([
    card('         PCB   TYPE=DB,DBDNAME=EDUCDB,PROCOPT=GR,KEYLEN=100,'),
    '               PROCSEQD=NAMESXDB,PSELOPT=SNGL,ACCESS=(INDEX,VSAM)',
  ].join('\n'));
  assert.equal(n.procseqd, 'NAMESXDB');
  assert.equal(n.pselopt, 'SNGL');
  assert.deepEqual(n.access, { type: 'INDEX', method: 'VSAM' });
  assert.deepEqual(node('         PCB   TYPE=DB,DBDNAME=E,KEYLEN=8,PROCSEQD=X,ACCESS=INDEX').access, { type: 'INDEX', method: null });
  assert.deepEqual(node('         PCB   TYPE=DB,DBDNAME=E,KEYLEN=8,PROCSEQD=X,ACCESS=DB').access, { type: 'DB', method: null });
  refused('         PCB   TYPE=DB,DBDNAME=E,PSELOPT=MULT', /PSELOPT is valid only with PROCSEQD/);
  refused('         PCB   TYPE=DB,DBDNAME=E,KEYLEN=8,PROCSEQD=X,ACCESS=(INDEX,OSAM)', /ACCESS must be/);
  refused('         PCB   TYPE=DB,DBDNAME=E,KEYLEN=8,PROCSEQD=X,ACCESS=(DB)', /ACCESS must be/);
});

test('database PCB choices outside the reference are refused', () => {
  refused('         PCB   TYPE=DB,DBDNAME=D,KEYLEN=8,POS=MULTPLE', /POS must be/);
  refused('         PCB   TYPE=DB,DBDNAME=D,KEYLEN=8,SB=YES', /SB must be NO or COND/);
  refused('         PCB   TYPE=DB,DBDNAME=D,KEYLEN=8,VIEW=DEDB', /VIEW must be/);
  const n = node([
    card('         PCB   TYPE=DB,DBDNAME=D,SB=COND,VIEW=MSDBL,DBVER=3,KEYLEN=8,'),
    '               EXTERNALNAME=PARTS_PCB,POS=S',
  ].join('\n'));
  assert.deepEqual([n.sb, n.view, n.dbver, n.externalname, n.pos], ['COND', 'MSDBL', 3, 'PARTS_PCB', 'SINGLE']);
});

test('an alternate PCB carries its LTERM destination and response options', () => {
  const n = node([
    card('         PCB   TYPE=TP,LTERM=HOWARD,ALTRESP=YES,SAMETRM=YES,'),
    '               EXPRESS=YES,PCBNAME=OUTPCB1',
  ].join('\n'));
  assert.equal(n.type, 'TP');
  assert.deepEqual(n.destination, { kind: 'LTERM', name: 'HOWARD' });
  assert.deepEqual([n.altresp, n.sametrm, n.modify, n.express], [true, true, false, true]);
  assert.equal(n.name, 'OUTPCB1');
  assert.equal(n.dbd, undefined);
  assert.equal(n.procopt, undefined);
});

test('an alternate PCB NAME is a transaction destination, and a modifiable one takes none', () => {
  assert.deepEqual(node('         PCB   TYPE=TP,NAME=OUT1').destination, { kind: 'TRANSACTION', name: 'OUT1' });
  const m = node('         PCB   TYPE=TP,MODIFY=YES');
  assert.equal(m.destination, null);
  assert.equal(m.modify, true);
  assert.deepEqual([m.altresp, m.sametrm, m.express], [false, false, false]);
  assert.equal(node('         PCB   TYPE=TP,LTERM=A,MODIFY=NO').modify, false);
  refused('         PCB   TYPE=TP,LTERM=A,MODIFY=YES', /MODIFY=YES takes no LTERM or NAME/);
  refused('         PCB   TYPE=TP,NAME=T,MODIFY=YES', /MODIFY=YES takes no LTERM or NAME/);
  refused('         PCB TYPE=TP', /requires LTERM or NAME unless MODIFY=YES/);
  refused('         PCB   TYPE=TP,LTERM=A,NAME=B', /LTERM and NAME/);
  refused('         PCB   TYPE=TP,LTERM=A,EXPRESS=MAYBE', /EXPRESS must be YES or NO/);
});

test('an alternate PCB refuses database operands, and a label with PCBNAME', () => {
  refused('         PCB   TYPE=TP,LTERM=A,PROCOPT=A', /PCB TYPE=TP has no PROCOPT operand/);
  refused('         PCB   TYPE=TP,DBDNAME=A', /PCB TYPE=TP has no DBDNAME operand/);
  refused('ALT      PCB   TYPE=TP,LTERM=A,PCBNAME=ALT', /label or PCBNAME, not both/);
});

test('a GSAM PCB requires PROCOPT G, GS, L or LS and takes no database-only operands', () => {
  const n = node('         PCB   TYPE=GSAM,DBDNAME=PASFLDBD,PROCOPT=LS');
  assert.deepEqual([n.type, n.dbd, n.procopt], ['GSAM', 'PASFLDBD', 'LS']);
  refused('         PCB   TYPE=GSAM,DBDNAME=REPORT', /requires PROCOPT/);
  refused('         PCB   TYPE=GSAM,DBDNAME=REPORT,PROCOPT=A', /PROCOPT must be G or GS or L or LS/);
  refused('         PCB   TYPE=GSAM,DBDNAME=REPORT,PROCOPT=G,KEYLEN=8', /PCB TYPE=GSAM has no KEYLEN operand/);
});

test('a PCB without TYPE, or with a type the reference does not list, is refused', () => {
  refused('         PCB   DBDNAME=D,PROCOPT=A', /PCB requires TYPE/);
  refused('         PCB   TYPE=IO,DBDNAME=D', /TYPE IO is not TP, DB or GSAM/);
});

test('PCB names are at most 8 characters, a PCB name may not begin with DFS, an external name is at most 128', () => {
  refused('LONGLABEL PCB  TYPE=DB,DBDNAME=D,KEYLEN=8', /label LONGLABEL is longer than 8 characters/);
  refused('         PCB   TYPE=DB,DBDNAME=D,KEYLEN=8,PCBNAME=DFSPCB1', /PCBNAME DFSPCB1 begins with DFS/);
  refused('         PCB   TYPE=DB,DBDNAME=ACCTDBV00,KEYLEN=8', /DBDNAME ACCTDBV00 is longer than 8/);
  refused('         PCB   TYPE=DB,DBDNAME=D,KEYLEN=8,PROCSEQ=INDEXDB01', /PROCSEQ INDEXDB01 is longer than 8/);
  refused('         PCB   TYPE=TP,LTERM=TERMINAL1', /LTERM TERMINAL1 is longer than 8/);
  refused('         PCB   TYPE=DB,DBDNAME=D,KEYLEN=8,EXTERNALNAME=DFS_PARTS', /EXTERNALNAME DFS_PARTS begins with DFS/);
  assert.equal(node(cards('         PCB   TYPE=DB,DBDNAME=D,KEYLEN=8,EXTERNALNAME=' + 'E'.repeat(128))).externalname.length, 128);
  refused(cards('         PCB   TYPE=DB,DBDNAME=D,KEYLEN=8,EXTERNALNAME=' + 'E'.repeat(129)), /EXTERNALNAME .* is longer than 128/);
});

test('SENSEG reads PARENT=0 and an absent PARENT as a root, and carries PROCOPT and INDICES', () => {
  const root = node('         SENSEG  NAME=PAUTSUM0,PARENT=0');
  assert.deepEqual([root.kind, root.name, root.parent, root.procopt, root.indices, root.ssptr], ['SENSEG', 'PAUTSUM0', null, null, null, null]);
  assert.equal(node('         SENSEG    NAME=POMSTR').parent, null);
  const dep = node('         SENSEG    NAME=DE,PARENT=DC,PROCOPT=GRI,INDICES=(X5,X6)');
  assert.deepEqual([dep.parent, dep.procopt, dep.indices], ['DC', 'GRI', ['X5', 'X6']]);
  assert.deepEqual(node('         SENSEG    NAME=DC,PARENT=DA,INDICES=X5').indices, ['X5']);
  assert.equal(node('         SENSEG    NAME=A,PARENT=0,PROCOPT=K').procopt, 'K');
});

test('SENSEG refuses the PCB-only processing options N, T, O, L, S and H, and more than four', () => {
  for (const p of ['GON', 'GOT', 'GO', 'L', 'GS', 'AH']) refused(`         SENSEG  NAME=A,PARENT=0,PROCOPT=${p}`, /is not a processing option it takes/);
  refused('         SENSEG  NAME=A,PARENT=0,PROCOPT=GIRDE', /more than 4 options/);
  refused('         SENSEG  PARENT=0', /SENSEG requires NAME/);
  refused('         SENSEG  NAME=A,PARENT=', /PARENT must be 0 or a segment name/);
  refused('         SENSEG  NAME=A,KEYLEN=8', /SENSEG has no KEYLEN operand/);
});

test('SENSEG names, its parent and its secondary indexes are at most 8 characters', () => {
  refused('         SENSEG  NAME=SEGMENT01,PARENT=0', /NAME SEGMENT01 is longer than 8/);
  refused('         SENSEG  NAME=A,PARENT=PARENT001', /PARENT PARENT001 is longer than 8/);
  refused('         SENSEG  NAME=A,PARENT=B,INDICES=(X1,INDEX0001)', /INDICES name INDEX0001 is longer than 8/);
});

test('SENSEG SSPTR carries each subset pointer, read-sensitive unless U is written', () => {
  assert.deepEqual(node('         SENSEG NAME=B,PARENT=A,SSPTR=((1,R),(2,U),(5))').ssptr, [
    { pointer: 1, sensitivity: 'R' }, { pointer: 2, sensitivity: 'U' }, { pointer: 5, sensitivity: 'R' },
  ]);
  refused('         SENSEG NAME=B,PARENT=A,SSPTR=((9,R))', /pointer number must be 1 to 8/);
  refused('         SENSEG NAME=B,PARENT=A,SSPTR=((1,W))', /sensitivity must be R or U/);
  refused('         SENSEG NAME=B,PARENT=A,SSPTR=(1,R)', /SSPTR must be/);
});

test('SSPTR is refused on a root segment, and update sensitivity where PROCOPT has no A, R, I or D', () => {
  refused('         SENSEG NAME=A,PARENT=0,SSPTR=((1,R))', /not supported on a root segment/);
  refused('         SENSEG NAME=A,SSPTR=((1,R))', /not supported on a root segment/);
  refused('         SENSEG NAME=B,PARENT=A,PROCOPT=G,SSPTR=((1,R),(2,U))', /pointer 2 is update-sensitive/);
  assert.equal(node('         SENSEG NAME=B,PARENT=A,PROCOPT=GR,SSPTR=((2,U))').ssptr[0].sensitivity, 'U');
  assert.equal(node('         SENSEG NAME=B,PARENT=A,PROCOPT=G,SSPTR=((1,R))').ssptr.length, 1);
});

test('SENFLD carries NAME, START and whether the field may be replaced, REPL and REPLACE alike', () => {
  const n = node('        SENFLD   NAME=EMPLNAME,START=13,REPL=NO');
  assert.deepEqual([n.kind, n.name, n.start, n.replace], ['SENFLD', 'EMPLNAME', 13, false]);
  assert.equal(node('        SENFLD   NAME=EMPMI,START=11').replace, true);
  assert.equal(node('        SENFLD   NAME=EMPMI,START=11,REPLACE=N').replace, false);
  assert.equal(node('        SENFLD   NAME=EMPMI,START=11,REPLACE=Y').replace, true);
  refused('        SENFLD   NAME=EMPMI,START=11,REPL=NO,REPLACE=NO', /REPLACE or REPL, not both/);
  refused('        SENFLD   NAME=EMPMI', /requires START/);
  refused('        SENFLD   NAME=EMPMI,START=0', /START must be an integer from 1 to 32767/);
  refused('        SENFLD   NAME=EMPMI,START=32768', /START must be/);
  refused('        SENFLD   NAME=EMPMI,START=1,REPL=MAYBE', /REPL must be/);
  refused('        SENFLD   NAME=FIELDNAME,START=1', /NAME FIELDNAME is longer than 8/);
});

test('PSBGEN carries every operand the reference lists, with its defaults', () => {
  const n = node([
    card('         PSBGEN PSBNAME=APPLPGM1,LANG=PL/I,CMPAT=YES,IOASIZE=4096,'),
    card('               SSASIZE=560,MAXQ=10,OLIC=YES,GSROLBOK=YES,LOCKMAX=5,'),
    '               IOEROPN=(451,WTOR),DBLEVEL=BASE',
  ].join('\n'));
  assert.deepEqual(
    [n.kind, n.psbname, n.lang, n.cmpat, n.ioasize, n.ssasize, n.maxq, n.olic, n.gsrolbok, n.lockmax, n.ioeropn, n.dblevel],
    ['PSBGEN', 'APPLPGM1', 'PL/I', true, 4096, 560, 10, true, true, 5, { code: 451, wtor: true }, 'BASE'],
  );
  const d = node('         PSBGEN  LANG=COBOL,PSBNAME=DLIGSAMP');
  assert.deepEqual([d.cmpat, d.olic, d.gsrolbok, d.maxq, d.lockmax, d.ioeropn], [false, false, false, null, null, null]);
  assert.deepEqual(node('         PSBGEN  PSBNAME=P,IOEROPN=8').ioeropn, { code: 8, wtor: false });
  assert.equal(node('         PSBGEN  PSBNAME=P,LANG=').lang, '');
  assert.equal(node('         PSBGEN  PSBNAME=P').lang, null);
  for (const lang of ['PLI', 'PL1', 'ASSEM', 'PASCAL', 'JAVA']) assert.equal(node(`         PSBGEN  PSBNAME=P,LANG=${lang}`).lang, lang);
});

test('PSBGEN refuses a missing PSBNAME and values outside the reference', () => {
  refused('         PSBGEN  LANG=COBOL', /requires PSBNAME/);
  refused('         PSBGEN  LANG=COBOL,PSBNAME=PSBNAME01', /PSBNAME PSBNAME01 is longer than 8/);
  refused('         PSBGEN  PSBNAME=P,LANG=FORTRAN', /LANG must be/);
  refused('         PSBGEN  PSBNAME=P,LOCKMAX=256', /LOCKMAX must be an integer from 0 to 255/);
  refused('         PSBGEN  PSBNAME=P,IOEROPN=(4,WTO)', /IOEROPN must be/);
  refused('         PSBGEN  PSBNAME=P,IOEROPN=(4)', /IOEROPN must be/);
  refused('         PSBGEN  PSBNAME=P,CMPAT=Y', /CMPAT must be YES or NO/);
  refused('         PSBGEN  PSBNAME=P,DBLEVEL=LAST', /DBLEVEL must be CURR or BASE/);
  refused('         PSBGEN  PSBNAME=P,KEYLEN=8', /PSBGEN has no KEYLEN operand/);
});

test('REMARKS is 1 to 256 characters with no double quote, <, > or &', () => {
  assert.equal(node("         PSBGEN  PSBNAME=P,REMARKS='Applies to XYZ'").keywords.REMARKS, "'Applies to XYZ'");
  assert.equal(node(cards("         PSBGEN PSBNAME=P,REMARKS='" + 'R'.repeat(256) + "'")).psbname, 'P');
  refused(cards("         PSBGEN PSBNAME=P,REMARKS='" + 'R'.repeat(257) + "'"), /REMARKS must be 1 to 256 characters/);
  refused("         PSBGEN  PSBNAME=P,REMARKS=''", /REMARKS must be 1 to 256 characters/);
  refused("         SENSEG  NAME=A,REMARKS='A&&B'", /REMARKS cannot contain/);
  refused("         PCB   TYPE=TP,LTERM=A,REMARKS='<B>'", /REMARKS cannot contain/);
});

test('a PSB macro whose operands end in a comma is refused, since the next card was not joined to it', () => {
  const src = [
    '         PCB   TYPE=DB,DBDNAME=ACCTDBV0,',
    '               PROCOPT=I,',
  ].join('\n');
  const [pcb, rest] = readIms(src).statements.map(parseImsStatement);
  assert.equal(pcb.status, 'unparsed');
  assert.match(pcb.reason, /end in a comma/);
  assert.equal(rest.status, 'unknown');
});

test('every IMS macro has a parser, so none reads as unbuilt', () => {
  for (const m of IMS_MACROS) assert.equal(typeof PARSERS[m], 'function', m);
});

test('a whole PSB deck reads statement by statement, every one parsed', () => {
  const deck = [
    '         PRINT NOGEN',
    '         PCB   TYPE=TP,NAME=OUTPUT1,PCBNAME=OUTPCB1',
    'PAUTBPCB PCB   TYPE=DB,DBDNAME=DBPAUTP0,PROCOPT=AP,KEYLEN=14',
    '         SENSEG  NAME=PAUTSUM0,PARENT=0',
    '         SENFLD  NAME=ACCNTID,START=1',
    '         SENSEG  NAME=PAUTDTL1,PARENT=PAUTSUM0,PROCOPT=G',
    '         PCB   TYPE=GSAM,DBDNAME=PASFLDBD,PROCOPT=LS',
    '         PSBGEN  LANG=COBOL,PSBNAME=PSBPAUTB,CMPAT=YES',
    '         END',
  ].join('\n');
  const results = readIms(deck).statements.map(parseImsStatement);
  assert.deepEqual(results.map((r) => r.status), Array(9).fill('parsed'));
  assert.deepEqual(results.map((r) => r.kind), ['ASSEMBLER', 'PCB', 'PCB', 'SENSEG', 'SENFLD', 'SENSEG', 'PCB', 'PSBGEN', 'ASSEMBLER']);
});
