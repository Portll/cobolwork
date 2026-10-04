import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDb2, classify, parseDb2Statement } from '../lib/db2/read.mjs';
import './pin-machine.mjs';

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
  const [ins, trig] = readDb2("INSERT INTO T VALUES (1); CREATE TRIGGER TR AFTER INSERT ON T FOR EACH ROW MODE DB2SQL VALUES (1);").statements.map(parseDb2Statement);
  assert.deepEqual([ins.status, ins.node.data, trig.kind, trig.status], ['parsed', true, 'CREATE TRIGGER', 'unbuilt']);
});

test('a CASE expression or statement inside a routine body does not end the routine at its END', () => {
  const sql = `CREATE PROCEDURE P1 (IN A INT, OUT X INT)
  LANGUAGE SQL
  BEGIN
    SET X = CASE WHEN A = 1 THEN 10 ELSE 20 END;
    CASE A WHEN 2 THEN SET X = 30; ELSE SET X = 40; END CASE;
    IF A = 3 THEN SET X = 50; END IF;
  END;
  GRANT EXECUTE ON PROCEDURE P1 TO PUBLIC;`;
  const { statements } = readDb2(sql);
  assert.deepEqual(statements.map(classify), ['CREATE PROCEDURE', 'GRANT']);
  assert.equal(parseDb2Statement(statements[0]).status, 'parsed');
});
