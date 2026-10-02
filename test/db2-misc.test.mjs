// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for the Db2 miscellaneous statement parsers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDb2, parseDb2Statement } from '../lib/db2/read.mjs';
import './pin-machine.mjs';

const parse = (sql) => parseDb2Statement(readDb2(sql).statements[0]);

test('parses DROP TABLE with RESTRICT', () => {
  const r = parse('DROP TABLE GRADE RESTRICT;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.kind, 'DROP TABLE');
  assert.deepEqual(r.node.name, ['GRADE']);
  assert.equal(r.node.cascade, false);
});

test('parses DROP TABLE with CASCADE', () => {
  const r = parse('DROP TABLE GRADE CASCADE;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.kind, 'DROP TABLE');
  assert.deepEqual(r.node.name, ['GRADE']);
  assert.equal(r.node.cascade, true);
});

test('refuses DROP TABLE IF EXISTS', () => {
  const r = parse('DROP TABLE IF EXISTS GRADE;');
  assert.equal(r.status, 'unparsed');
  assert.match(r.reason, /IF EXISTS/);
});

test('parses DROP DATABASE', () => {
  const r = parse('DROP DATABASE DBNASE;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.kind, 'DROP DATABASE');
  assert.deepEqual(r.node.name, ['DBNASE']);
});

test('parses DROP VIEW', () => {
  const r = parse('DROP VIEW VBNKDETS;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.kind, 'DROP VIEW');
  assert.deepEqual(r.node.name, ['VBNKDETS']);
});

test('parses COMMENT ON TABLE with qualified name', () => {
  const r = parse("COMMENT ON TABLE ACME.EMPLOYEE_MASTER IS 'Employee master record.';");
  assert.equal(r.status, 'parsed');
  assert.equal(r.kind, 'COMMENT ON');
  assert.equal(r.node.objectType, 'TABLE');
  assert.deepEqual(r.node.name, ['ACME', 'EMPLOYEE_MASTER']);
  assert.equal(r.node.comment, 'Employee master record.');
});

test('parses COMMENT ON TABLESPACE with empty string', () => {
  const r = parse("COMMENT ON TABLESPACE TS32K IS '';");
  assert.equal(r.status, 'parsed');
  assert.equal(r.kind, 'COMMENT ON');
  assert.equal(r.node.objectType, 'TABLESPACE');
  assert.deepEqual(r.node.name, ['TS32K']);
  assert.equal(r.node.comment, '');
});

test('parses SET SCHEMA TO value', () => {
  const r = parse('SET SCHEMA TO carddemo;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.kind, 'SET');
  assert.equal(r.node.context, 'SCHEMA');
  assert.equal(r.node.value, 'carddemo');
});

test('parses CREATE SEQUENCE with options', () => {
  const r = parse('CREATE SEQUENCE fpl_seq START WITH 1 INCREMENT BY 1 NO MAXVALUE NO CYCLE CACHE 20;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.kind, 'CREATE SEQUENCE');
  assert.deepEqual(r.node.name, ['fpl_seq']);
  assert.equal(r.node.startWith, '1');
  assert.equal(r.node.incrementBy, '1');
  assert.equal(r.node.noMaxValue, true);
  assert.equal(r.node.cycle, false);
  assert.equal(r.node.cache, '20');
});

test('parses RENAME TABLE', () => {
  const r = parse('RENAME TABLE OLD_NAME TO NEW_NAME;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.kind, 'RENAME');
  assert.equal(r.node.objectType, 'TABLE');
  assert.deepEqual(r.node.from, ['OLD_NAME']);
  assert.deepEqual(r.node.to, ['NEW_NAME']);
});

test('parses TRUNCATE TABLE', () => {
  const r = parse('TRUNCATE TABLE MY_TABLE;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.kind, 'TRUNCATE');
  assert.deepEqual(r.node.name, ['MY_TABLE']);
  assert.equal(r.node.storage, null);
  assert.equal(r.node.triggers, null);
  assert.equal(r.node.immediate, false);
});

test('parses CREATE ALIAS', () => {
  const r = parse('CREATE ALIAS MY_ALIAS FOR MY_TABLE;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.kind, 'CREATE ALIAS');
  assert.deepEqual(r.node.name, ['MY_ALIAS']);
  assert.deepEqual(r.node.for, ['MY_TABLE']);
});

test('parses CREATE SCHEMA with AUTHORIZATION', () => {
  const r = parse('CREATE SCHEMA MY_SCHEMA AUTHORIZATION MY_USER;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.kind, 'CREATE SCHEMA');
  assert.deepEqual(r.node.name, ['MY_SCHEMA']);
  assert.deepEqual(r.node.authorization, ['MY_USER']);
});

test('parses CREATE ROLE', () => {
  const r = parse('CREATE ROLE MY_ROLE;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.kind, 'CREATE ROLE');
  assert.deepEqual(r.node.name, ['MY_ROLE']);
});

test('a table\'s columns take their comments in one statement, and SET takes CURRENT and a list', () => {
  const p = (sql) => parseDb2Statement(readDb2(sql).statements[0]);
  const c = p("COMMENT ON T (A IS 'a', B IS 'b');");
  assert.deepEqual([c.status, c.node.columns.map((x) => x.comment)], ['parsed', ['a', 'b']]);
  const s = p('SET CURRENT PATH = SYSIBM, SYSFUN, MYSCH;');
  assert.deepEqual([s.status, s.node.current, s.node.value], ['parsed', true, ['SYSIBM', 'SYSFUN', 'MYSCH']]);
  assert.equal(p("SET CURRENT SQLID = 'X';").status, 'parsed');
});
