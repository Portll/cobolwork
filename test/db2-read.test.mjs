import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDb2, classify, parseDb2Statement } from '../lib/db2/read.mjs';

const kinds = (sql) => readDb2(sql).statements.map(classify);

test('statements end at semicolons; comments, literals and delimited names keep theirs', () => {
  const { statements } = readDb2("-- a; comment\nCREATE TABLE \"A;B\" (C CHAR(1) DEFAULT ';'); /* ; */ GRANT SELECT ON T TO PUBLIC;");
  assert.equal(statements.length, 2);
  assert.deepEqual(statements[0].toks.filter((t) => t.t === 'ident').map((t) => t.v), ['A;B']);
});

test('a routine body is one statement, its inner statements and nested blocks included', () => {
  const sql = `CREATE PROCEDURE P (IN X INT)
LANGUAGE SQL
BEGIN
  DECLARE V INT;
  IF X > 0 THEN SET V = 1; END IF;
  BEGIN SET V = 2; END;
END;
GRANT EXECUTE ON PROCEDURE P TO PUBLIC;`;
  assert.deepEqual(kinds(sql), ['CREATE PROCEDURE', 'GRANT']);
});

test('--#SET TERMINATOR names the character that ends a statement', () => {
  assert.deepEqual(kinds('--#SET TERMINATOR @\nCREATE VIEW V AS SELECT 1 FROM T; @\nCOMMIT@'), ['CREATE VIEW', 'COMMIT']);
});

test('leading words give the kind, whatever qualifies the object', () => {
  assert.deepEqual(kinds('CREATE UNIQUE INDEX I ON T (C); CREATE OR REPLACE PROCEDURE P () BEGIN END; CREATE GLOBAL TEMPORARY TABLE G (C INT); COMMENT ON TABLE T IS \'X\'; GO;'),
    ['CREATE INDEX', 'CREATE PROCEDURE', 'CREATE TABLE', 'COMMENT ON', 'UNKNOWN']);
});

test('a data statement is recognised without parsing; a definition with no parser yet is unbuilt', () => {
  const [ins, tab] = readDb2("INSERT INTO T VALUES (1); CREATE TABLE T (C INT);").statements.map(parseDb2Statement);
  assert.deepEqual([ins.status, ins.node.data, tab.status], ['parsed', true, 'unbuilt']);
});
