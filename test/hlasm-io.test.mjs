import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';
import './pin-machine.mjs';

const parse = (src) => parseHlasmStatement(readHlasmStatements(src).statements[0]);

test('GET parses standard form with dcb and area', () => {
  const r = parse('         GET   FILEIN,INREC');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'GET');
  assert.equal(r.node.dcb, 'FILEIN');
  assert.equal(r.node.area, 'INREC');
});

test('GET parses register form for area', () => {
  const r = parse('         GET   TRXNIN,(R3)');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'GET');
  assert.equal(r.node.dcb, 'TRXNIN');
  assert.equal(r.node.area, '(R3)');
});

test('GET parses with TYPE=P keyword', () => {
  const r = parse('         GET   PDAB,AREA,TYPE=P');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'GET');
  assert.equal(r.node.dcb, 'PDAB');
  assert.equal(r.node.area, 'AREA');
  assert.equal(r.node.type, 'P');
});

test('GET parses with MF=L keyword', () => {
  const r = parse('         GET   FILEIN,INREC,MF=L');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'GET');
  assert.equal(r.node.mf, 'L');
});

test('GET refuses unknown keyword', () => {
  const r = parse('         GET   FILEIN,INREC,FOO=BAR');
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /unknown keyword FOO/);
});

test('PUT parses standard form with dcb and area', () => {
  const r = parse('         PUT   FILEOUT,OUTREC');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'PUT');
  assert.equal(r.node.dcb, 'FILEOUT');
  assert.equal(r.node.area, 'OUTREC');
});

test('PUT parses register form for area', () => {
  const r = parse('         PUT   OUTFILE,(2)');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'PUT');
  assert.equal(r.node.dcb, 'OUTFILE');
  assert.equal(r.node.area, '(2)');
});

test('PUT parses with MF=(E,addr) keyword', () => {
  const r = parse('         PUT   FILEOUT,OUTREC,MF=(E,ADDR)');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'PUT');
  assert.equal(r.node.mf, '(E,ADDR)');
});

test('PUT refuses unknown keyword', () => {
  const r = parse('         PUT   FILEOUT,OUTREC,TYPE=P');
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /unknown keyword TYPE/);
});

test('READ parses standard form with all positional operands', () => {
  const r = parse('         READ  DECB,SF,DCB,AREA');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'READ');
  assert.equal(r.node.decb, 'DECB');
  assert.equal(r.node.type, 'SF');
  assert.equal(r.node.dcb, 'DCB');
  assert.equal(r.node.area, 'AREA');
  assert.equal(r.node.length, null);
});

test('READ parses with length S', () => {
  const r = parse("         READ  DECB,SF,DCB,AREA,'S'");
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'READ');
  assert.equal(r.node.length, "'S'");
});

test('READ parses with MF=L keyword', () => {
  const r = parse('         READ  DECB,SF,DCB,AREA,MF=L');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'READ');
  assert.equal(r.node.mf, 'L');
  assert.equal(r.node.keywords.MF, 'L');
});

test('READ refuses invalid type', () => {
  const r = parse('         READ  DECB,XX,DCB,AREA');
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /type XX is not one the access methods define/);
});

test('WRITE parses standard form with all positional operands', () => {
  const r = parse('         WRITE DECB,SF,DCB,AREA');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'WRITE');
  assert.equal(r.node.decb, 'DECB');
  assert.equal(r.node.type, 'SF');
  assert.equal(r.node.dcb, 'DCB');
  assert.equal(r.node.area, 'AREA');
  assert.equal(r.node.length, null);
});

test('WRITE parses with length value', () => {
  const r = parse('         WRITE DECB,SF,DCB,AREA,100');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'WRITE');
  assert.equal(r.node.length, '100');
});

test('WRITE refuses MF=(M,addr), which its list and execute forms do not define', () => {
  const r = parse('         WRITE DECB,SF,DCB,AREA,MF=(M,ADDR)');
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /MF= value \(M,ADDR\) is not L or E/);
});

test('WRITE refuses invalid type', () => {
  const r = parse('         WRITE DECB,SB,DCB,AREA');
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /type SB is not one the access methods define/);
});

test('READ and WRITE read the BDAM and BSAM forms and their list and execute forms', () => {
  const bdam = parse("         READ  RDECB4,DI,BDAMIN,0,'S',0,BDAMTTR");
  assert.equal(bdam.status, 'parsed');
  assert.equal(bdam.node.key, '0');
  assert.equal(bdam.node.block, 'BDAMTTR');
  assert.equal(parse("         READ  HDECB2,DKFRU,(R3),(R2),'S','S',BLK,NXT").status, 'parsed');
  assert.equal(parse('         READ  DECB1,SF,MF=L').status, 'parsed');
  const exec = parse("         READ  DECB,SF,VTOC,DSCB,'S',MF=E");
  assert.equal(exec.node.mf, 'E');
  assert.equal(parse("         READ  DYNDECB,SF,,(R2),'S',MF=E").node.dcb, null);
  assert.equal(parse('         WRITE (R9),SF,(R5),(R6),MF=E').node.decb, '(R9)');
  assert.equal(parse('         WRITE WDECB3,SZ,BDAMOUT').status, 'unparsed');
  assert.equal(parse('         WRITE WDECB3,SZ,BDAMOUT,AREA').status, 'parsed');
  assert.equal(parse("         WRITE DECBMODW,DK,0,'S','S',0,0,MF=L").status, 'parsed');
  assert.match(parse('         READ  DECB,SF,DCB,AREA,MF=(E,LIST)').reason, /MF= value \(E,LIST\) is not L or E/);
  assert.match(parse('         READ  DECB,SF,,AREA').reason, /dcb address is missing/);
});

test('GET and PUT read the VSAM form, which names a request parameter list', () => {
  assert.deepEqual(parse('         GET   RPL=GETRPL').node, { kind: 'GET', rpl: 'GETRPL' });
  assert.equal(parse('         PUT   RPL=(R5)').node.rpl, '(R5)');
  assert.match(parse('         GET   INDCB,RPL=GETRPL').reason, /RPL= takes no positional operands/);
});
