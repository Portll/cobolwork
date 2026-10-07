import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';
import './pin-machine.mjs';

const parse = (src) => parseHlasmStatement(readHlasmStatements(src).statements[0]);

test('LINK parses EP= and PARAM= with VL=1', () => {
  const res = parse('         LINK EP=TAED002A,Param=(ParmStr),VL=1');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.ep, 'TAED002A');
  assert.equal(res.node.eploc, null);
  assert.equal(res.node.de, null);
  assert.equal(res.node.dcb, null);
  assert.equal(res.node.param, '(ParmStr)');
  assert.equal(res.node.keywords.VL, '1');
});

test('LINK refuses unknown keyword', () => {
  const res = parse('         LINK EP=FOO,BAD=1');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /unknown keyword/);
});

test('ATTACH reads STAI and ESTAI as an exit address and a parameter list address', () => {
  assert.equal(parse('         ATTACH EP=SUB,ESTAI=((R8),(R9)),ECB=(R7)').status, 'parsed');
  assert.equal(parse('         ATTACH EP=SUB,ESTAI=(EXIT,PARMS),STAI=(EXIT)').status, 'parsed');
  assert.match(parse('         ATTACH EP=SUB,ESTAI=(A,B,C)').reason, /invalid ESTAI address/);
});

test('LOAD parses EP= with trailing comment', () => {
  const res = parse('         LOAD  EP=CEELOCT                LOAD ENTRY OF CEELOCT');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.ep, 'CEELOCT');
  assert.equal(res.node.eploc, null);
  assert.equal(res.node.de, null);
  assert.equal(res.node.dcb, null);
});

test('LOAD refuses missing EP/EPLOC/DE', () => {
  const res = parse('         LOAD  DCB=FOO');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /missing EP, EPLOC, or DE/);
});

test('XCTL parses register list and EPLOC=', () => {
  const res = parse('         XCTL (2,12),EPLOC=XCTLEP');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.ep, null);
  assert.equal(res.node.eploc, 'XCTLEP');
  assert.equal(res.node.de, null);
  assert.equal(res.node.dcb, null);
});

test('XCTL refuses invalid register list', () => {
  const res = parse('         XCTL (2,12,14),EP=FOO');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /invalid register list/);
});

test('ATTACH parses EP= and ECB=', () => {
  const res = parse('         ATTACH EP=FOO,ECB=BAR');
  assert.equal(res.status, 'parsed');
  assert.equal(res.node.ep, 'FOO');
  assert.equal(res.node.eploc, null);
  assert.equal(res.node.de, null);
  assert.equal(res.node.dcb, null);
  assert.equal(res.node.param, null);
  assert.equal(res.node.keywords.ECB, 'BAR');
});

test('ATTACH refuses unknown keyword', () => {
  const res = parse('         ATTACH EP=FOO,BAD=1');
  assert.equal(res.status, 'unparsed');
  assert.match(res.reason, /unknown keyword/);
});

test('LINK and XCTL read their list and execute forms', () => {
  const list = parse('LINKLST  LINK  EP=PROGA,SF=L');
  assert.equal(list.status, 'parsed');
  assert.equal(list.node.sf, 'L');
  const bare = parse('LINKLST  LINK  SF=L');
  assert.equal(bare.status, 'parsed');
  assert.equal(bare.node.ep, null);
  const exec = parse('         LINK  EP=PROGA,PARAM=(P1,P2),VL=1,MF=(E,PL),SF=(E,LL)');
  assert.equal(exec.status, 'parsed');
  assert.deepEqual(exec.node.mf, { form: 'E', list: 'PL' });
  assert.deepEqual(exec.node.sf, { form: 'E', list: 'LL' });
  assert.match(parse('         LINK  EP=PROGA,MF=L').reason, /MF only as \(E,addr\)/);
  assert.match(parse('         LINK  EP=PROGA,PARAM=(A),SF=L').reason, /list form of LINK takes no MF or PARAM/);
  assert.match(parse('         LINK  PARAM=(A),MF=(E,PLIST)').reason, /missing EP, EPLOC, or DE/);
  const xlist = parse('XCTLLST  XCTL  EP=PROGB,SF=L');
  assert.equal(xlist.node.sf, 'L');
  const xexec = parse('         XCTL  (2,12),EP=PROGB,PARAM=(A,B),VL=1,MF=(E,XP),SF=(E,XL)');
  assert.equal(xexec.status, 'parsed');
  assert.equal(xexec.node.param, '(A,B)');
  assert.match(parse('         XCTL  EP=PROGB,PARAM=(A)').reason, /PARAM and VL only with MF=\(E,addr\)/);
});

test('LOAD and ATTACH read their list and execute forms and authorized keywords, and addresses as HLASM writes them', () => {
  assert.equal(parse("         LOAD  EPLOC==CL8'IKJEFF02'").status, 'parsed');
  assert.equal(parse('         LOAD  EP=CROSSMEM,GLOBAL=YES,SF=L').node.sf, 'L');
  assert.equal(parse('         LOAD  DE=(R1),DCB=DCB').status, 'parsed');
  const attach = parse('         ATTACH EPLOC=(R6),ECB=(R7),SZERO=NO,JSTCB=YES,SF=(E,ATTACHD)');
  assert.equal(attach.status, 'parsed');
  assert.deepEqual(attach.node.sf, { form: 'E', list: 'ATTACHD' });
  assert.equal(parse('         ATTACH DE=0,SF=L').status, 'parsed');
  assert.match(parse('         ATTACH EP=X,HIARCHY=0').reason, /unknown keyword HIARCHY/);
  assert.equal(parse('         XCTL  (2,12),DE=(R8),MF=(E,(1)),SF=(E,(15))').status, 'parsed');
  assert.equal(parse('         LINK  ,SF=(E,PARSLINK)').status, 'parsed');
  assert.equal(parse('         LINK  EP=ASMA90,PARAM=((R3),DDNLIST),VL=1').status, 'parsed');
  assert.equal(parse('         LINK  SF=(E,LP),MF=(E,CP),PARAM=(,,(3)),VL=1').status, 'parsed');
  assert.match(parse('         LINK  EP=X,PARAM=(,A)').reason, /invalid PARAM address/);
});

test('a list form may leave keyword values for its execute form', () => {
  assert.equal(parse('LOADL    LOAD  EPLOC=,DCB=,LSEARCH=,SF=L').status, 'parsed');
  assert.match(parse('         LOAD  EPLOC=,DCB=').reason, /missing EP, EPLOC, or DE|invalid/);
});
