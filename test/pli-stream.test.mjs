// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for the stream I/O statement parsers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPli } from '../lib/pli/lex.mjs';
import { parseStatement } from '../lib/pli/statements.mjs';
import './pin-machine.mjs';

const parse = (src) => parseStatement(readPli(src).statements[0]);

test('PUT SKIP LIST parses a simple list', () => {
  const r = parse(' PUT SKIP LIST(\'text\', X);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'PUT');
  assert.equal(r.node.skip, true);
  assert.equal(r.node.mode, 'LIST');
  assert.equal(r.node.data.length, 2);
});

test('PUT FILE EDIT parses file and formats', () => {
  const r = parse(' PUT FILE(SYSPRINT) EDIT (A, B) (A, F(5));');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'PUT');
  assert.equal(r.node.file.name, 'SYSPRINT');
  assert.equal(r.node.mode, 'EDIT');
  assert.equal(r.node.data.length, 2);
  assert.equal(r.node.formats.length, 1);
  assert.equal(r.node.formats[0].length, 2);
});

test('PUT SKIP EDIT parses with string and formats', () => {
  const r = parse(' PUT SKIP EDIT (\'*** \', MSG) (A, A(80));');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'PUT');
  assert.equal(r.node.skip, true);
  assert.equal(r.node.mode, 'EDIT');
  assert.equal(r.node.data.length, 2);
  assert.equal(r.node.formats.length, 1);
  assert.equal(r.node.formats[0].length, 2);
});

test('PUT SKIP parses with no data', () => {
  const r = parse(' PUT SKIP;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'PUT');
  assert.equal(r.node.skip, true);
  assert.equal(r.node.mode, null);
});

test('PUT SKIP LIST parses expression with ||', () => {
  const r = parse(' PUT SKIP LIST (\'at line \' || TRIM(SL) );');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'PUT');
  assert.equal(r.node.skip, true);
  assert.equal(r.node.mode, 'LIST');
  assert.equal(r.node.data.length, 1);
});

test('PUT EDIT parses multiple data items and formats', () => {
  const r = parse(' PUT EDIT ( LETTER(A), 8-B, \'-\', LETTER(X), 8-Y) (A, F(1), A, A, F(1));');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'PUT');
  assert.equal(r.node.mode, 'EDIT');
  assert.equal(r.node.data.length, 5);
  assert.equal(r.node.formats.length, 1);
  assert.equal(r.node.formats[0].length, 5);
});

test('GET EDIT with no FILE reads its data list and formats', () => {
  const r = parse(' GET EDIT (INPUT) (L);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'GET');
  assert.equal(r.node.file, null);
  assert.deepEqual(r.node.data[0].refs, ['INPUT']);
  assert.equal(r.node.mode, 'EDIT');
  assert.equal(r.node.data.length, 1);
  assert.equal(r.node.formats.length, 1);
  assert.equal(r.node.formats[0].length, 1);
});

test('DISPLAY parses simple string', () => {
  const r = parse(' DISPLAY (\'The input data set has not been defined.\');');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'DISPLAY');
  assert.equal(r.node.reply, null);
});

test('DISPLAY parses expression with ||', () => {
  const r = parse(' DISPLAY (\'Unspecified error occurred.  ONCODE=\' || ONCODE );');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'DISPLAY');
  assert.equal(r.node.reply, null);
});

test('DISPLAY parses with REPLY', () => {
  const r = parse(' DISPLAY (\'Enter a name or Q to quit\') REPLY( theAnswer );');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'DISPLAY');
  assert.equal(r.node.reply.name, 'THEANSWER');
});

test('DISPLAY parses reference', () => {
  const r = parse(' DISPLAY (MYARGS);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'DISPLAY');
  assert.equal(r.node.reply, null);
});

test('FORMAT parses simple list', () => {
  const r = parse(' FORMAT ( A(22),A(4),A(1),A(2),A(1),A(2),A(20) );');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'FORMAT');
  assert.equal(r.node.items.length, 7);
});

test('FORMAT parses with SKIP and P picture', () => {
  const r = parse(' FORMAT ( SKIP,A(5),X(1),A(17),X(1),A(28),X(2), P\'ZZZ,ZZ9V.99\',X(1),P\'ZZ,ZZZ,ZZ9\' );');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'FORMAT');
  assert.equal(r.node.items.length, 10);
});

test('FORMAT parses with PAGE', () => {
  const r = parse(' FORMAT ( PAGE,A(40),A(2),A(1),A(2),A(1),A(4),A(20), A(2),A(1),A(2),A(1),A(2) );');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'FORMAT');
  assert.equal(r.node.items.length, 13);
});

test('FORMAT parses with SKIP(n)', () => {
  const r = parse(' FORMAT ( SKIP(1),A(20),X(5),A(25),A(29) );');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'FORMAT');
  assert.equal(r.node.items.length, 5);
});

test('FLUSH FILE parses reference', () => {
  const r = parse(' FLUSH FILE(SYSPRINT);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'FLUSH');
  assert.equal(r.node.file.name, 'SYSPRINT');
});

test('FLUSH FILE(*) parses star', () => {
  const r = parse(' FLUSH FILE(*);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'FLUSH');
  assert.equal(r.node.file, '*');
});

test('a data list item may be a repetitive specification, and a comma separates items', () => {
  const r = parse(" PUT SKIP LIST('total', (A(I) DO I = 1 TO N), B);");
  assert.equal(r.status, 'parsed');
  assert.deepEqual(r.node.data.map((d) => d.t), ['expr', 'repetitive', 'expr']);
});

test("a P format item takes its picture literal", () => {
  assert.equal(parse(" PUT EDIT (X) (P'ZZ9V99', X(2));").status, 'parsed');
});

test('PUT and GET EDIT take any number of data list and format list pairs', () => {
  const put = parse(" PUT FILE (REPORT) SKIP EDIT ('A', N) (COL(15), A, P'Z9') ('B') (A);");
  assert.equal(put.status, 'parsed', put.reason);
  assert.equal(put.node.formats.length, 2);
  assert.equal(put.node.data.length, 3);
  const get = parse(' GET EDIT (A, B) (A(5), F(3)) (C) (A(2));');
  assert.deepEqual([get.status, get.node.formats.length, get.node.data.length], ['parsed', 2, 3]);
});
