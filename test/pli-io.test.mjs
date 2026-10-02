// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for PL/I OPEN, CLOSE and record I/O statement parsers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPli } from '../lib/pli/lex.mjs';
import { parseStatement } from '../lib/pli/statements.mjs';
import './pin-machine.mjs';

const parse = (src) => parseStatement(readPli(src).statements[0]);

test('parses OPEN FILE with INPUT option', () => {
  const r = parse(' OPEN FILE(POTVSAM) INPUT;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'OPEN');
  assert.equal(r.node.files.length, 1);
  assert.equal(r.node.files[0].file.name, 'POTVSAM');
  assert.equal(r.node.files[0].options.INPUT, true);
});

test('parses OPEN FILE with no options', () => {
  const r = parse(' OPEN FILE(TRANFILE);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'OPEN');
  assert.equal(r.node.files.length, 1);
  assert.equal(r.node.files[0].file.name, 'TRANFILE');
  assert.deepEqual(r.node.files[0].options, {});
});

test('parses OPEN FILE with multiple files', () => {
  const r = parse(' OPEN FILE(A) INPUT, FILE(B) OUTPUT;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'OPEN');
  assert.equal(r.node.files.length, 2);
  assert.equal(r.node.files[0].file.name, 'A');
  assert.equal(r.node.files[1].file.name, 'B');
});

test('parses CLOSE FILE', () => {
  const r = parse(' CLOSE FILE(POTVSAM);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'CLOSE');
  assert.equal(r.node.files.length, 1);
  assert.equal(r.node.files[0].file.name, 'POTVSAM');
});

test('parses CLOSE FILE(*)', () => {
  const r = parse(' CLOSE FILE(*);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'CLOSE');
  assert.equal(r.node.files.length, 1);
  assert.equal(r.node.files[0].file.t, 'star');
});

test('parses READ FILE INTO', () => {
  const r = parse(' READ FILE(POTVSAM) INTO(POTVSAM_REC);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'READ');
  assert.equal(r.node.file.name, 'POTVSAM');
  assert.equal(r.node.target.name, 'POTVSAM_REC');
  assert.equal(r.node.options.INTO.name, 'POTVSAM_REC');
});

test('parses READ FILE INTO with KEY', () => {
  const r = parse(" READ FILE(INFILE) INTO(INREC) KEY('4343');");
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'READ');
  assert.equal(r.node.file.name, 'INFILE');
  assert.equal(r.node.target.name, 'INREC');
  assert.equal(r.node.options.KEY.t, 'expr');
});

test('parses WRITE FILE FROM', () => {
  const r = parse(' WRITE FILE(REPORT) FROM(LINE_BLANK);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'WRITE');
  assert.equal(r.node.file.name, 'REPORT');
  assert.equal(r.node.target.name, 'LINE_BLANK');
  assert.equal(r.node.options.FROM.name, 'LINE_BLANK');
});

test('parses WRITE FILE FROM with KEYFROM', () => {
  const r = parse(' WRITE FILE(RATEMST) FROM(RATE_REC) KEYFROM(RATE_KEY);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'WRITE');
  assert.equal(r.node.file.name, 'RATEMST');
  assert.equal(r.node.target.name, 'RATE_REC');
  assert.equal(r.node.options.KEYFROM.t, 'expr');
});

test('parses REWRITE FILE FROM', () => {
  const r = parse(' REWRITE FILE(RATEMST) FROM(RATE_REC);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'REWRITE');
  assert.equal(r.node.file.name, 'RATEMST');
  assert.equal(r.node.target.name, 'RATE_REC');
});

test('parses DELETE FILE', () => {
  const r = parse(' DELETE FILE(RATEMST);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'DELETE');
  assert.equal(r.node.file.name, 'RATEMST');
  assert.equal(r.node.target, null);
});

test('parses LOCATE ref FILE', () => {
  const r = parse(' LOCATE REC FILE(F);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'LOCATE');
  assert.equal(r.node.file.name, 'F');
  assert.equal(r.node.target.name, 'REC');
});

test('parses UNLOCK FILE KEY', () => {
  const r = parse(' UNLOCK FILE(F) KEY(K);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'UNLOCK');
  assert.equal(r.node.file.name, 'F');
  assert.equal(r.node.options.KEY.t, 'expr');
});

test('an option with an expression argument is read once, parentheses included', () => {
  for (const src of [' READ FILE(F) INTO(R) KEY(K);', ' WRITE FILE(F) FROM(R) KEYFROM(K);', ' LOCATE R FILE(F) KEYFROM(K);']) {
    assert.equal(parse(src).status, 'parsed', src);
  }
});
