// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for the PL/I EXEC statement parser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPli } from '../lib/pli/lex.mjs';
import { parseStatement } from '../lib/pli/statements.mjs';

const parse = (src) => parseStatement(readPli(src).statements[0]);

test('parses EXEC CICS RETURN', () => {
  const r = parse(' EXEC CICS RETURN;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'EXEC');
  assert.equal(r.node.processor, 'CICS');
  assert.deepEqual(r.node.cics.command, ['RETURN']);
  assert.deepEqual(r.node.cics.options, []);
});

test('parses EXEC CICS RETURN with options', () => {
  const r = parse(" EXEC CICS RETURN TRANSID('EPP1') COMMAREA(W_COMMUNICATION_AREA);");
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.processor, 'CICS');
  assert.deepEqual(r.node.cics.command, ['RETURN']);
  assert.equal(r.node.cics.options.length, 2);
  assert.equal(r.node.cics.options[0].name, 'TRANSID');
  assert.equal(r.node.cics.options[1].name, 'COMMAREA');
});

test('parses EXEC CICS SEND TEXT', () => {
  const r = parse(' EXEC CICS SEND TEXT FROM (END_OF_TRANS_MSG) ERASE FREEKB;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.processor, 'CICS');
  assert.deepEqual(r.node.cics.command, ['SEND', 'TEXT']);
  assert.equal(r.node.cics.options.length, 4);
  assert.equal(r.node.cics.options[0].name, 'TEXT');
  assert.equal(r.node.cics.options[1].name, 'FROM');
  assert.equal(r.node.cics.options[2].name, 'ERASE');
  assert.equal(r.node.cics.options[3].name, 'FREEKB');
});

test('parses EXEC CICS RECEIVE MAP', () => {
  const r = parse(" EXEC CICS RECEIVE MAP('EPSP1M') MAPSET('EPSP1MP') INTO (EPSP1MI);");
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.processor, 'CICS');
  assert.deepEqual(r.node.cics.command, ['RECEIVE', 'MAP']);
  assert.equal(r.node.cics.options.length, 3);
  assert.equal(r.node.cics.options[0].name, 'MAP');
  assert.equal(r.node.cics.options[1].name, 'MAPSET');
  assert.equal(r.node.cics.options[2].name, 'INTO');
});

test('parses EXEC CICS LINK PROGRAM', () => {
  const r = parse(' EXEC CICS LINK PROGRAM(W_CALL_PROGRAM) COMMAREA(INTERFACE_AREA) LENGTH(INTERFACE_AREA_LENGTH);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.processor, 'CICS');
  assert.deepEqual(r.node.cics.command, ['LINK']);
  assert.equal(r.node.cics.options.length, 3);
  assert.equal(r.node.cics.options[0].name, 'PROGRAM');
  assert.equal(r.node.cics.options[1].name, 'COMMAREA');
  assert.equal(r.node.cics.options[2].name, 'LENGTH');
});

test('parses EXEC SQL DECLARE CURSOR', () => {
  const r = parse(' EXEC SQL DECLARE C1 CURSOR WITH RETURN WITH HOLD FOR SELECT * FROM ENGLAND.CITYTABLE;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'EXEC');
  assert.equal(r.node.processor, 'SQL');
  assert.equal(r.node.sql.verb, 'DECLARE');
  assert.deepEqual(r.node.sql.hostVars, []);
});

test('parses EXEC SQL OPEN', () => {
  const r = parse(' EXEC SQL OPEN C1;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.processor, 'SQL');
  assert.equal(r.node.sql.verb, 'OPEN');
});

test('parses EXEC SQL INSERT with host variables', () => {
  const r = parse(' EXEC SQL INSERT INTO ENGLAND.CITYTABLE (CITY, COUNTRY) VALUES (:CITY, :COUNTRY);');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.processor, 'SQL');
  assert.equal(r.node.sql.verb, 'INSERT');
  assert.equal(r.node.sql.hostVars.length, 2);
  assert.equal(r.node.sql.hostVars[0].host, 'CITY');
  assert.equal(r.node.sql.hostVars[1].host, 'COUNTRY');
});

test('parses EXEC SQL DELETE with host variables', () => {
  const r = parse(' EXEC SQL DELETE FROM ENGLAND.CITYTABLE WHERE CITY=:CITY AND COUNTRY=:COUNTRY;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.processor, 'SQL');
  assert.equal(r.node.sql.verb, 'DELETE');
  assert.equal(r.node.sql.hostVars.length, 2);
});

test('fails when EXEC has no processor word', () => {
  const r = parse(' EXEC;');
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /processor word/);
});

test('parses EXEC DLI', () => {
  const r = parse(' EXEC DLI SOME_COMMAND;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'EXEC');
  assert.equal(r.node.processor, 'DLI');
  assert.equal(r.node.toks.length, 1);
});

test('a CICS option carries the direction the translator table gives it', () => {
  const r = parseStatement(readPli(' EXEC CICS RECEIVE INTO(BUF) LENGTH(LEN) RESP(RC);').statements[0]);
  assert.deepEqual(r.node.cics.options.map((o) => [o.name, o.direction]), [['INTO', 'receives'], ['LENGTH', 'both'], ['RESP', 'receives']]);
});
