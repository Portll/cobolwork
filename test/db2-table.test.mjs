// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDb2, parseDb2Statement } from '../lib/db2/read.mjs';
import './pin-machine.mjs';

const parse = (sql) => parseDb2Statement(readDb2(sql).statements[0]);
const node = (sql) => {
  const r = parse(sql);
  assert.equal(r.status, 'parsed', r.reason);
  return r.node;
};

test('IBM example 1: DEPT in DSN8D13A.DSN8S13D, five columns and a primary key', () => {
  const n = node(`CREATE TABLE DSN8D10.DEPT
 (DEPTNO CHAR(3) NOT NULL,
 DEPTNAME VARCHAR(36) NOT NULL,
 MGRNO CHAR(6) ,
 ADMRDEPT CHAR(3) NOT NULL,
 LOCATION CHAR(16) ,
 PRIMARY KEY(DEPTNO) )
 IN DSN8D13A.DSN8S13D;`);
  assert.equal(n.name, 'DSN8D10.DEPT');
  assert.deepEqual(n.columns.map((c) => [c.name, c.type.name, c.type.length, c.notNull]), [
    ['DEPTNO', 'CHAR', 3, true], ['DEPTNAME', 'VARCHAR', 36, true], ['MGRNO', 'CHAR', 6, false],
    ['ADMRDEPT', 'CHAR', 3, true], ['LOCATION', 'CHAR', 16, false],
  ]);
  assert.deepEqual(n.constraints, [{ type: 'PRIMARY KEY', name: null, columns: ['DEPTNO'] }]);
  assert.deepEqual(n.options.in, { database: 'DSN8D13A', tableSpace: 'DSN8S13D' });
});

test('types take their defaults and synonyms: DEC is DECIMAL(5,0), CHAR is CHAR(1), CLOB is 1M', () => {
  const n = node('CREATE TABLE T (A DEC, B CHAR, C CLOB, D CHARACTER VARYING(9) FOR BIT DATA, E BINARY LARGE OBJECT(2G), F TIMESTAMP(12) WITH TIME ZONE, G FLOAT, H S1.MONEY);');
  assert.deepEqual(n.columns.map((c) => c.type), [
    { name: 'DECIMAL', precision: 5, scale: 0 }, { name: 'CHAR', length: 1 }, { name: 'CLOB', length: '1M' },
    { name: 'VARCHAR', length: 9, forData: 'BIT' }, { name: 'BLOB', length: '2G' },
    { name: 'TIMESTAMP', precision: 12, timeZone: true }, { name: 'FLOAT', precision: 53 }, { name: 'DISTINCT', distinct: 'S1.MONEY' },
  ]);
});

test('a column carries its default, identity, references and check', () => {
  const n = node(`CREATE TABLE T (
    ID INTEGER GENERATED ALWAYS AS IDENTITY (START WITH 1, INCREMENT BY 1, NOCACHE),
    AMT DECIMAL(9,2) NOT NULL WITH DEFAULT,
    USR CHAR(8) NOT NULL WITH DEFAULT USER,
    CODE CHAR(2) DEFAULT 'XX' CONSTRAINT C1 CHECK (CODE <> ''),
    DEPT CHAR(3) REFERENCES DEPT ON DELETE SET NULL,
    RID ROWID NOT NULL GENERATED ALWAYS);`);
  const [id, amt, usr, code, dept, rid] = n.columns;
  assert.deepEqual(id.generated, { when: 'ALWAYS', as: 'IDENTITY', identity: { startWith: '1', incrementBy: '1', cache: false } });
  assert.deepEqual([amt.notNull, amt.default], [true, { implicit: true }]);
  assert.deepEqual(usr.default, { register: 'SESSION_USER' });
  assert.deepEqual([code.default.constant, code.constraints[0].type, code.constraints[0].name], ['XX', 'CHECK', 'C1']);
  assert.deepEqual(dept.constraints[0].references, { table: 'DEPT', columns: null, onDelete: 'SET NULL' });
  assert.deepEqual(rid.generated, { when: 'ALWAYS' });
});

test('table constraints, a period and placement clauses in any order', () => {
  const n = node(`CREATE TABLE T (A INT NOT NULL, B INT, S TIMESTAMP(12) NOT NULL GENERATED ALWAYS AS ROW BEGIN,
    E TIMESTAMP(12) NOT NULL GENERATED ALWAYS AS ROW END, PERIOD SYSTEM_TIME (S, E),
    CONSTRAINT FK FOREIGN KEY (B) REFERENCES P (PB) ON DELETE CASCADE, UNIQUE (A, B))
    AUDIT CHANGES IN DATABASE DB1 DATA CAPTURE CHANGES CCSID EBCDIC NOT VOLATILE COMPRESS YES;`);
  assert.deepEqual(n.periods, [{ name: 'SYSTEM_TIME', begin: 'S', end: 'E' }]);
  assert.deepEqual(n.constraints.map((c) => [c.type, c.name, c.columns]), [['FOREIGN KEY', 'FK', ['B']], ['UNIQUE', null, ['A', 'B']]]);
  assert.deepEqual(n.options, { audit: 'CHANGES', in: { database: 'DB1' }, dataCapture: 'CHANGES', ccsid: 'EBCDIC', volatile: false, compress: 'YES' });
});

test('range partitions by ENDING AT or the older PART n VALUES', () => {
  const a = node('CREATE TABLE T (A INT) PARTITION BY RANGE (A) (PARTITION 1 ENDING AT (100), PARTITION 2 ENDING AT (MAXVALUE));');
  const b = node('CREATE TABLE T (A INT) PARTITION BY (A) (PART 1 VALUES (100), PART 2 VALUES (200));');
  assert.deepEqual(a.options.partitioning.partitions.map((p) => p.limits), [['100'], ['MAXVALUE']]);
  assert.deepEqual(b.options.partitioning.partitions.map((p) => p.number), [1, 2]);
});

test('LIKE, AS ... WITH NO DATA, and a materialized query table', () => {
  assert.equal(node('CREATE TABLE T LIKE S INCLUDING IDENTITY COLUMN ATTRIBUTES;').copy.identity, 'INCLUDING');
  const r = node('CREATE TABLE T (X, Y) AS (SELECT A, B FROM S) WITH NO DATA;');
  assert.deepEqual([r.asResult.columns, r.asResult.withNoData], [['X', 'Y'], true]);
  assert.equal(node('CREATE TABLE T AS (SELECT A FROM S) DEFINITION ONLY;').asResult.withNoData, true);
  const mq = node('CREATE TABLE T AS (SELECT A, COUNT(*) AS N FROM S GROUP BY A) DATA INITIALLY DEFERRED REFRESH DEFERRED MAINTAINED BY USER;');
  assert.deepEqual([mq.table, mq.asResult.maintainedBy], ['MATERIALIZED QUERY', 'USER']);
});

test('global temporary and auxiliary tables', () => {
  const g = node('CREATE GLOBAL TEMPORARY TABLE G (A INT NOT NULL, B VARCHAR(10)) CCSID UNICODE;');
  assert.deepEqual([g.table, g.columns.length, g.ccsid], ['GLOBAL TEMPORARY', 2, 'UNICODE']);
  const x = node('CREATE AUX TABLE X IN DB1.LOBTS STORES T COLUMN DOC PART 3;');
  assert.deepEqual([x.table, x.in, x.stores, x.column, x.part], ['AUXILIARY', { database: 'DB1', tableSpace: 'LOBTS' }, 'T', 'DOC', 3]);
});

test('forms Db2 for z/OS does not take are refused', () => {
  for (const sql of [
    'CREATE TABLE T (A INT AUTO_INCREMENT);',
    'CREATE TABLE T (A TIMESTAMP DEFAULT CURRENT TIMESTAMP);',
    'CREATE TABLE IF NOT EXISTS T (A INT);',
    'CREATE TABLE T (A INT, );',
    'CREATE TABLE T (A INT) IN TABLESPACE TS1;',
    'CREATE TABLE T (A DECFLOAT(20));',
    'CREATE TABLE T (A INT) AUDIT ALL AUDIT NONE;',
  ]) assert.equal(parse(sql).status, 'unparsed', sql);
});
