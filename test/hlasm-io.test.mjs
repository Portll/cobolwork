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
  assert.match(r.reason, /type XX is not SF, SB, SF64, or SF64P/);
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

test('WRITE parses with MF=(M,addr) keyword', () => {
  const r = parse('         WRITE DECB,SF,DCB,AREA,MF=(M,ADDR)');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'WRITE');
  assert.equal(r.node.mf, '(M,ADDR)');
  assert.equal(r.node.keywords.MF, '(M,ADDR)');
});

test('WRITE refuses invalid type', () => {
  const r = parse('         WRITE DECB,SB,DCB,AREA');
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /type SB is not SF, SF64, or SF64P/);
});
