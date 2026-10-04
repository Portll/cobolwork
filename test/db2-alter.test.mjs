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
const clauses = (sql) => node(sql).clauses;
const text = (toks) => toks.map((t) => (t.t === 'lit' ? `'${t.v}'` : t.v)).join(' ');
const shown = (constraint) => (constraint.condition ? { ...constraint, condition: text(constraint.condition) } : constraint);
const refused = (sql, reason) => {
  const r = parse(sql);
  assert.equal(r.status, 'unparsed', sql);
  if (reason) assert.match(r.reason, reason, sql);
};

test('IBM example 1: widen DEPTNAME to VARCHAR(50), then add BLDG as CHAR(3) FOR SBCS DATA without the COLUMN keyword', () => {
  assert.deepEqual(node(`ALTER TABLE DSN8D10.DEPT
 ALTER COLUMN DEPTNAME SET DATA TYPE VARCHAR(50)
 ADD BLDG CHAR(3) FOR SBCS DATA;`), {
    kind: 'ALTER TABLE', name: 'DSN8D10.DEPT',
    clauses: [
      { action: 'ALTER COLUMN', column: 'DEPTNAME', change: 'SET DATA TYPE', type: { name: 'VARCHAR', length: 50 } },
      { action: 'ADD COLUMN', column: { name: 'BLDG', type: { name: 'CHAR', length: 3, forData: 'SBCS' }, notNull: false, constraints: [] } },
    ],
  });
});

test('IBM examples 2 and 3: VALIDPROC names a validation routine, VALIDPROC NULL removes it', () => {
  assert.deepEqual(node('ALTER TABLE DSN8D10.EMP\n VALIDPROC DSN8EAEM;'), { kind: 'ALTER TABLE', name: 'DSN8D10.EMP', clauses: [{ action: 'VALIDPROC', program: 'DSN8EAEM' }] });
  assert.deepEqual(node('ALTER TABLE DSN8D10.EMP\n VALIDPROC NULL;'), { kind: 'ALTER TABLE', name: 'DSN8D10.EMP', clauses: [{ action: 'VALIDPROC', program: null }] });
});

test('IBM example 4: a self-referencing foreign key, ADD left out because it is the first clause', () => {
  assert.deepEqual(node('ALTER TABLE DSN8D10.DEPT\n FOREIGN KEY(ADMRDEPT) REFERENCES DSN8D10.DEPT ON DELETE CASCADE;'), {
    kind: 'ALTER TABLE', name: 'DSN8D10.DEPT',
    clauses: [{ action: 'ADD CONSTRAINT', constraint: { type: 'FOREIGN KEY', name: null, columns: ['ADMRDEPT'], references: { table: 'DSN8D10.DEPT', columns: null, onDelete: 'CASCADE' } } }],
  });
});

test('IBM example 5: a check constraint on SALARY, its condition kept as tokens', () => {
  const n = node('ALTER TABLE DSN8D10.EMP\n ADD CHECK (SALARY >= 10000);');
  assert.deepEqual({ ...n, clauses: n.clauses.map((x) => ({ ...x, constraint: shown(x.constraint) })) }, {
    kind: 'ALTER TABLE', name: 'DSN8D10.EMP', clauses: [{ action: 'ADD CONSTRAINT', constraint: { type: 'CHECK', name: null, condition: 'SALARY >= 10000' } }],
  });
});

test('IBM example 6: a foreign key on a non-primary unique key of PRODVER_1', () => {
  assert.deepEqual(node(` ALTER TABLE PRODINFO
 FOREIGN KEY (PRODNAME,PRODVERNO)
 REFERENCES PRODVER_1 (VERNAME,RELNO) ON DELETE RESTRICT;`), {
    kind: 'ALTER TABLE', name: 'PRODINFO',
    clauses: [{ action: 'ADD CONSTRAINT', constraint: { type: 'FOREIGN KEY', name: null, columns: ['PRODNAME', 'PRODVERNO'], references: { table: 'PRODVER_1', columns: ['VERNAME', 'RELNO'], onDelete: 'RESTRICT' } } }],
  });
});

test('IBM example 7: a named unique key KEY_DEPTNAME', () => {
  assert.deepEqual(node('ALTER TABLE DSN8D10.DEPT\n ADD CONSTRAINT KEY_DEPTNAME UNIQUE( DEPTNAME );'), {
    kind: 'ALTER TABLE', name: 'DSN8D10.DEPT', clauses: [{ action: 'ADD CONSTRAINT', constraint: { type: 'UNIQUE', name: 'KEY_DEPTNAME', columns: ['DEPTNAME'] } }],
  });
});

test('IBM example 8: TRANSCOUNT registered as a user-maintained materialized query table', () => {
  const n = node(`ALTER TABLE TRANSCOUNT ADD MATERIALIZED QUERY
 (SELECT ACCTID, LOCID, YEAR, COUNT(*) as cnt
 FROM TRANSadd
 GROUP BY ACCTID, LOCID, YEAR )
 DATA INITIALLY DEFERRED
 REFRESH DEFERRED
 MAINTAINED BY USER;`);
  assert.deepEqual({ ...n, clauses: [{ ...n.clauses[0], fullselect: text(n.clauses[0].fullselect) }] }, {
    kind: 'ALTER TABLE', name: 'TRANSCOUNT',
    clauses: [{ action: 'ADD MATERIALIZED QUERY', fullselect: 'SELECT ACCTID , LOCID , YEAR , COUNT ( * ) as cnt FROM TRANSadd GROUP BY ACCTID , LOCID , YEAR', maintainedBy: 'USER' }],
  });
});

test('IBM example 9: CHAR(4) FOR BIT DATA column COL1 altered to BINARY(6)', () => {
  assert.deepEqual(node('ALTER TABLE TB1 \n ALTER COLUMN COL1 \n SET DATA TYPE BINARY(6);'), {
    kind: 'ALTER TABLE', name: 'TB1', clauses: [{ action: 'ALTER COLUMN', column: 'COL1', change: 'SET DATA TYPE', type: { name: 'BINARY', length: 6 } }],
  });
});

test('IBM example 10: a table-level key label for encryption', () => {
  assert.deepEqual(node('ALTER TABLE DSN8C10.EMP\n KEY LABEL SECUREKEY01;'), { kind: 'ALTER TABLE', name: 'DSN8C10.EMP', clauses: [{ action: 'KEY LABEL', keyLabel: 'SECUREKEY01' }] });
});

test('IBM column access control example: ACTIVATE COLUMN ACCESS CONTROL on CUSTOMER', () => {
  assert.deepEqual(node('ALTER TABLE CUSTOMER\n ACTIVATE COLUMN ACCESS CONTROL;'), { kind: 'ALTER TABLE', name: 'CUSTOMER', clauses: [{ action: 'ACTIVATE COLUMN ACCESS CONTROL' }] });
});

test('a column alteration sets a type and inline length, a default, an inline length, or drops the default', () => {
  assert.deepEqual(clauses('ALTER TABLE T ALTER COLUMN DOC SET DATA TYPE CLOB(2M) INLINE LENGTH 1000 ALTER NOTE SET DEFAULT \'N/A\' ALTER COLUMN WHO SET WITH DEFAULT USER ALTER COLUMN AMT SET DEFAULT ALTER COLUMN TXT SET INLINE LENGTH 200 ALTER COLUMN OLD DROP DEFAULT;'), [
    { action: 'ALTER COLUMN', column: 'DOC', change: 'SET DATA TYPE', type: { name: 'CLOB', length: '2M' }, inlineLength: 1000 },
    { action: 'ALTER COLUMN', column: 'NOTE', change: 'SET DEFAULT', default: { constant: 'N/A', prefix: '' } },
    { action: 'ALTER COLUMN', column: 'WHO', change: 'SET DEFAULT', default: { register: 'SESSION_USER' } },
    { action: 'ALTER COLUMN', column: 'AMT', change: 'SET DEFAULT', default: { implicit: true } },
    { action: 'ALTER COLUMN', column: 'TXT', change: 'SET INLINE LENGTH', inlineLength: 200 },
    { action: 'ALTER COLUMN', column: 'OLD', change: 'DROP DEFAULT' },
  ]);
});

test('an identity column is restarted and re-attributed, with or without SET GENERATED, and NOCACHE reads as NO CACHE', () => {
  assert.deepEqual(clauses('ALTER TABLE T ALTER COLUMN ID SET GENERATED BY DEFAULT RESTART WITH 100 SET INCREMENT BY 5 SET NO CYCLE SET NOCACHE SET MAXVALUE 99999;'), [{
    action: 'ALTER COLUMN', column: 'ID', change: 'SET GENERATED', generated: { when: 'BY DEFAULT' },
    identity: { restart: '100', incrementBy: '5', cycle: false, cache: false, maxValue: '99999' },
  }]);
  assert.deepEqual(clauses('ALTER TABLE T ALTER ID RESTART SET ORDER;'), [{ action: 'ALTER COLUMN', column: 'ID', change: 'IDENTITY', identity: { restart: null, order: true } }]);
  refused('ALTER TABLE T ALTER COLUMN ID SET CYCLE SET NO CYCLE;', /no second cycle/);
});

test('SET GENERATED makes a row-begin, row-end or transaction-start-ID column, ALWAYS being the default', () => {
  assert.deepEqual(clauses('ALTER TABLE T ALTER COLUMN S SET GENERATED ALWAYS AS ROW START ALTER COLUMN E SET GENERATED AS ROW END ALTER COLUMN X SET GENERATED AS TRANSACTION START ID;').map((x) => x.generated), [
    { when: 'ALWAYS', as: 'ROW BEGIN' }, { when: 'ALWAYS', as: 'ROW END' }, { when: 'ALWAYS', as: 'TRANSACTION START ID' },
  ]);
});

test('columns are added with or without COLUMN, each definition ending where the next clause begins', () => {
  assert.deepEqual(clauses(`ALTER TABLE T
    ADD COLUMN CHG TIMESTAMP NOT NULL GENERATED ALWAYS FOR EACH ROW ON UPDATE AS ROW CHANGE TIMESTAMP
    ADD DEPT CHAR(3) REFERENCES DEPT ON DELETE SET NULL
    ADD COLUMN DATA VARCHAR(10) FOR MIXED DATA
    DATA CAPTURE CHANGES;`), [
    { action: 'ADD COLUMN', column: { name: 'CHG', type: { name: 'TIMESTAMP', precision: 6, timeZone: false }, notNull: true, constraints: [], generated: { when: 'ALWAYS', as: 'ROW CHANGE TIMESTAMP' } } },
    { action: 'ADD COLUMN', column: { name: 'DEPT', type: { name: 'CHAR', length: 3 }, notNull: false, constraints: [{ type: 'FOREIGN KEY', name: null, references: { table: 'DEPT', columns: null, onDelete: 'SET NULL' } }] } },
    { action: 'ADD COLUMN', column: { name: 'DATA', type: { name: 'VARCHAR', length: 10, forData: 'MIXED' }, notNull: false, constraints: [] } },
    { action: 'DATA CAPTURE', value: 'CHANGES' },
  ]);
});

test('RENAME COLUMN, and DROP COLUMN with the RESTRICT Db2 for z/OS requires', () => {
  assert.deepEqual(clauses('ALTER TABLE T RENAME COLUMN A TO B;'), [{ action: 'RENAME COLUMN', from: 'A', to: 'B' }]);
  assert.deepEqual(clauses('ALTER TABLE T DROP COLUMN A RESTRICT;'), [{ action: 'DROP COLUMN', column: 'A' }]);
  assert.deepEqual(clauses('ALTER TABLE T DROP A RESTRICT;'), [{ action: 'DROP COLUMN', column: 'A' }]);
  refused('ALTER TABLE T DROP COLUMN A;', /RESTRICT/);
  refused('ALTER TABLE T DROP COLUMN A CASCADE;', /RESTRICT/);
});

test('constraints are added by name, by the older FOREIGN KEY name form, and dropped by kind or by name', () => {
  assert.deepEqual(clauses('ALTER TABLE T ADD PRIMARY KEY (A, BUSINESS_TIME WITHOUT OVERLAPS) ADD CONSTRAINT FK1 FOREIGN KEY (B, PERIOD BUSINESS_TIME) REFERENCES P (PB, PERIOD BUSINESS_TIME) ON DELETE RESTRICT NOT ENFORCED ADD CONSTRAINT C1 CHECK (A > 0);').map((x) => shown(x.constraint)), [
    { type: 'PRIMARY KEY', name: null, columns: ['A'], period: 'BUSINESS_TIME WITHOUT OVERLAPS' },
    { type: 'FOREIGN KEY', name: 'FK1', columns: ['B'], period: 'BUSINESS_TIME', references: { table: 'P', columns: ['PB'], period: 'BUSINESS_TIME', onDelete: 'RESTRICT', enforced: false } },
    { type: 'CHECK', name: 'C1', condition: 'A > 0' },
  ]);
  assert.deepEqual(clauses('ALTER TABLE T FOREIGN KEY FK2 (A) REFERENCES P;')[0].constraint, { type: 'FOREIGN KEY', name: 'FK2', columns: ['A'], references: { table: 'P', columns: null } });
  assert.deepEqual(clauses('ALTER TABLE T DROP PRIMARY KEY DROP FOREIGN KEY FK1 DROP UNIQUE U1 DROP CHECK C1;'), [
    { action: 'DROP CONSTRAINT', type: 'PRIMARY KEY', name: null }, { action: 'DROP CONSTRAINT', type: 'FOREIGN KEY', name: 'FK1' },
    { action: 'DROP CONSTRAINT', type: 'UNIQUE', name: 'U1' }, { action: 'DROP CONSTRAINT', type: 'CHECK', name: 'C1' },
  ]);
  assert.deepEqual(clauses('ALTER TABLE T DROP CONSTRAINT C1;'), [{ action: 'DROP CONSTRAINT', type: null, name: 'C1' }]);
});

test('periods, system-period versioning and its history table', () => {
  assert.deepEqual(clauses('ALTER TABLE T ADD PERIOD FOR SYSTEM_TIME (S, E) ADD PERIOD BUSINESS_TIME (BS, BE INCLUSIVE);'), [
    { action: 'ADD PERIOD', period: { name: 'SYSTEM_TIME', begin: 'S', end: 'E' } },
    { action: 'ADD PERIOD', period: { name: 'BUSINESS_TIME', begin: 'BS', end: 'BE', endpoint: 'INCLUSIVE' } },
  ]);
  assert.deepEqual(clauses('ALTER TABLE T ADD VERSIONING USE HISTORY TABLE T_HIST ON DELETE ADD EXTRA ROW;'), [{ action: 'ADD VERSIONING', historyTable: 'T_HIST', extraRow: true }]);
  assert.deepEqual(clauses('ALTER TABLE T ADD SYSTEM VERSIONING USE HISTORY TABLE H;'), [{ action: 'ADD VERSIONING', historyTable: 'H', extraRow: false }]);
  assert.deepEqual(clauses('ALTER TABLE T DROP SYSTEM VERSIONING;'), [{ action: 'DROP VERSIONING' }]);
});

test('a materialized query table is added, altered and dropped, IBM synonyms included', () => {
  const add = clauses('ALTER TABLE T ADD (SELECT A FROM S) DATA INITIALLY DEFERRED REFRESH DEFERRED DISABLE QUERY OPTIMIZATION MAINTAINED BY SYSTEM;')[0];
  assert.deepEqual({ ...add, fullselect: text(add.fullselect) }, { action: 'ADD MATERIALIZED QUERY', fullselect: 'SELECT A FROM S', queryOptimization: false, maintainedBy: 'SYSTEM' });
  assert.equal(clauses('ALTER TABLE T SET SUMMARY AS (SELECT A FROM S) DATA INITIALLY DEFERRED REFRESH DEFERRED;')[0].action, 'ADD MATERIALIZED QUERY');
  assert.deepEqual(clauses('ALTER TABLE T ALTER MATERIALIZED QUERY SET ENABLE QUERY OPTIMIZATION;'), [{ action: 'ALTER MATERIALIZED QUERY', queryOptimization: true }]);
  assert.deepEqual(clauses('ALTER TABLE T ALTER QUERY SET MAINTAINED BY USER;'), [{ action: 'ALTER MATERIALIZED QUERY', maintainedBy: 'USER' }]);
  for (const sql of ['ALTER TABLE T DROP MATERIALIZED QUERY;', 'ALTER TABLE T DROP QUERY;', 'ALTER TABLE T SET MATERIALIZED QUERY AS DEFINITION ONLY;', 'ALTER TABLE T SET SUMMARY AS DEFINITION ONLY;']) {
    assert.deepEqual(clauses(sql), [{ action: 'DROP MATERIALIZED QUERY' }], sql);
  }
  refused('ALTER TABLE T ADD MATERIALIZED QUERY (SELECT A FROM S) MAINTAINED BY USER;', /DATA/);
});

test('partitions are added, altered and rotated, and the partitioning scheme changed', () => {
  assert.deepEqual(clauses('ALTER TABLE T ADD PARTITION ENDING AT (100) INCLUSIVE ALTER PARTITION 3 ENDING AT (200);'), [
    { action: 'ADD PARTITION', limits: ['100'], inclusive: true }, { action: 'ALTER PARTITION', partition: 3, limits: ['200'] },
  ]);
  assert.deepEqual(clauses('ALTER TABLE T ADD PARTITION;'), [{ action: 'ADD PARTITION' }]);
  assert.deepEqual(clauses('ALTER TABLE T ALTER PARTITION 2 HASH SPACE 64 M;'), [{ action: 'ALTER PARTITION', partition: 2, hashSpace: '64M' }]);
  assert.deepEqual(clauses("ALTER TABLE T ROTATE PARTITION FIRST TO LAST ENDING AT ('2027-12-31') RESET;"), [{ action: 'ROTATE PARTITION', partition: 'FIRST', limits: ['2027-12-31'] }]);
  assert.deepEqual(clauses('ALTER TABLE T ROTATE PARTITION 4 TO LAST VALUES (MAXVALUE) RESET;'), [{ action: 'ROTATE PARTITION', partition: 4, limits: ['MAXVALUE'] }]);
  assert.deepEqual(clauses('ALTER TABLE T ALTER PARTITIONING TO PARTITION BY RANGE (A) (PARTITION 1 ENDING AT (10), PARTITION 2 ENDING AT (MAXVALUE));'), [{
    action: 'ALTER PARTITIONING', to: { by: 'RANGE', columns: [{ name: 'A' }], partitions: [{ number: 1, limits: ['10'] }, { number: 2, limits: ['MAXVALUE'] }] },
  }]);
  assert.deepEqual(clauses('ALTER TABLE T ALTER PARTITIONING TO PARTITION BY SIZE EVERY 4G MAXPARTITIONS 10;'), [{ action: 'ALTER PARTITIONING', to: { by: 'GROWTH', dssize: '4G', maxpartitions: 10 } }]);
  assert.deepEqual(clauses('ALTER TABLE T ADD PARTITION BY (A) (PART 1 VALUES (10));'), [{
    action: 'ADD PARTITION BY RANGE', partitioning: { by: 'RANGE', columns: [{ name: 'A' }], partitions: [{ number: 1, limits: ['10'] }] },
  }]);
  refused('ALTER TABLE T ROTATE PARTITION FIRST TO LAST ENDING AT (1);', /RESET/);
  refused('ALTER TABLE T ADD PARTITION HASH SPACE 1 G;', /HASH SPACE/);
});

test('the attribute, access control, clone, archive and hash organization clauses', () => {
  assert.deepEqual(clauses('ALTER TABLE T DATA CAPTURE NONE AUDIT CHANGES NOT VOLATILE CARDINALITY APPEND NO DROP RESTRICT ON DROP NO KEY LABEL;'), [
    { action: 'DATA CAPTURE', value: 'NONE' }, { action: 'AUDIT', value: 'CHANGES' }, { action: 'VOLATILE', value: false },
    { action: 'APPEND', value: false }, { action: 'DROP RESTRICT ON DROP' }, { action: 'KEY LABEL', keyLabel: null },
  ]);
  const one = (sql) => clauses(sql)[0];
  assert.deepEqual(one('ALTER TABLE T VOLATILE;'), { action: 'VOLATILE', value: true });
  assert.deepEqual(one('ALTER TABLE T ADD RESTRICT ON DROP;'), { action: 'ADD RESTRICT ON DROP' });
  assert.deepEqual(one('ALTER TABLE T DEACTIVATE ROW ACCESS CONTROL;'), { action: 'DEACTIVATE ROW ACCESS CONTROL' });
  assert.deepEqual(one('ALTER TABLE T ADD CLONE S.T_CLONE;'), { action: 'ADD CLONE', clone: 'S.T_CLONE' });
  assert.deepEqual(one('ALTER TABLE T DROP CLONE;'), { action: 'DROP CLONE' });
  assert.deepEqual(one('ALTER TABLE T ENABLE ARCHIVE USE T_ARCH;'), { action: 'ENABLE ARCHIVE', archiveTable: 'T_ARCH' });
  assert.deepEqual(one('ALTER TABLE T DISABLE ARCHIVE;'), { action: 'DISABLE ARCHIVE' });
  assert.deepEqual(one('ALTER TABLE T ADD ORGANIZE BY HASH UNIQUE (A, B) HASH SPACE 1 G;'), { action: 'ADD ORGANIZATION', columns: ['A', 'B'], hashSpace: '1G' });
  assert.deepEqual(one('ALTER TABLE T ALTER ORGANIZATION SET HASH SPACE 2 G;'), { action: 'ALTER ORGANIZATION', hashSpace: '2G' });
  assert.deepEqual(one('ALTER TABLE T DROP ORGANIZATION;'), { action: 'DROP ORGANIZATION' });
});

test("SQLCODE -637 lets row and column access control share a statement, each once", () => {
  assert.deepEqual(clauses('ALTER TABLE T ACTIVATE ROW ACCESS CONTROL ACTIVATE COLUMN ACCESS CONTROL;'), [{ action: 'ACTIVATE ROW ACCESS CONTROL' }, { action: 'ACTIVATE COLUMN ACCESS CONTROL' }]);
});

test('IBM DSNTEJ1 sample DDL: a foreign key named after FOREIGN KEY, and ALTER PART n VALUES (step 29)', () => {
  assert.deepEqual(clauses('ALTER TABLE DSN8D10.DEPT\n FOREIGN KEY RDD (ADMRDEPT) REFERENCES DSN8D10.DEPT\n ON DELETE CASCADE;'), [
    { action: 'ADD CONSTRAINT', constraint: { type: 'FOREIGN KEY', name: 'RDD', columns: ['ADMRDEPT'], references: { table: 'DSN8D10.DEPT', columns: null, onDelete: 'CASCADE' } } },
  ]);
  assert.deepEqual(clauses("ALTER TABLE DSN8D10.EMP ALTER PART 4 VALUES('499999');"), [{ action: 'ALTER PARTITION', partition: 4, limits: ['499999'] }]);
  assert.deepEqual(clauses("ALTER TABLE EMP ADD CONSTRAINT PERSON\n CHECK (SEX = 'M' OR SEX = 'F');")[0].constraint.name, 'PERSON');
});

test("IBM's ADD PARTITION example: a partition inserted before partition 11, the two clauses sharing a statement", () => {
  assert.deepEqual(clauses("ALTER TABLE TRANS ADD PARTITION ENDING AT ('06/30/2020') ALTER PARTITION 11 ENDING AT ('12/31/2020');"), [
    { action: 'ADD PARTITION', limits: ['06/30/2020'] }, { action: 'ALTER PARTITION', partition: 11, limits: ['12/31/2020'] },
  ]);
});

test("the reference's limits on sharing a statement: some clauses stand alone, the rest come once", () => {
  refused('ALTER TABLE T DROP COLUMN A RESTRICT ADD B INT;', /DROP COLUMN takes no other clause/);
  refused('ALTER TABLE T ACTIVATE ROW ACCESS CONTROL AUDIT ALL;', /takes no clause but the other access control clause/);
  refused('ALTER TABLE T ACTIVATE ROW ACCESS CONTROL DEACTIVATE ROW ACCESS CONTROL;', /no second ACTIVATE or DEACTIVATE ROW ACCESS CONTROL/);
  refused('ALTER TABLE T ADD MATERIALIZED QUERY (SELECT A FROM S) DATA INITIALLY DEFERRED REFRESH DEFERRED AUDIT ALL;', /ADD MATERIALIZED QUERY takes no other clause/);
  refused('ALTER TABLE T DROP MATERIALIZED QUERY AUDIT NONE;', /DROP MATERIALIZED QUERY takes no other clause/);
  refused('ALTER TABLE T ALTER COLUMN A SET DEFAULT 1 VALIDPROC P;', /ALTER COLUMN and VALIDPROC/);
  refused('ALTER TABLE T ADD ORGANIZE BY HASH UNIQUE (A) APPEND NO;', /ORGANIZE BY HASH and APPEND/);
  refused('ALTER TABLE T RENAME COLUMN A TO B AUDIT ALL;', /RENAME COLUMN takes no other clause/);
  refused('ALTER TABLE T AUDIT ALL AUDIT NONE;', /no second AUDIT/);
  refused('ALTER TABLE T VOLATILE NOT VOLATILE;', /no second VOLATILE/);
  refused('ALTER TABLE T ADD PERIOD SYSTEM_TIME (S, E) ADD PERIOD FOR SYSTEM_TIME (S2, E2);', /no second ADD PERIOD SYSTEM_TIME/);
  refused('ALTER TABLE T ALTER COLUMN A SET DEFAULT 1 ALTER COLUMN A DROP DEFAULT;', /column A/);
  refused('ALTER TABLE T ADD A INT ALTER COLUMN A SET DEFAULT 1;', /column A/);
  refused('ALTER TABLE T ADD C INT ALTER COLUMN A SET DATA TYPE BIGINT;', /SET DATA TYPE comes before/);
  refused('ALTER TABLE T ALTER COLUMN A SET DEFAULT 1 ROTATE PARTITION FIRST TO LAST ENDING AT (1) RESET;', /do not share/);
  refused('ALTER TABLE T ALTER PARTITIONING TO PARTITION BY GROWTH ADD PARTITION BY RANGE (A) (PARTITION 1 ENDING AT (1));', /do not share/);
  refused('ALTER TABLE T ADD C INT REFERENCES P ADD D INT REFERENCES Q;', /one added column/);
  refused('ALTER TABLE T DROP CONSTRAINT A DROP CHECK B;', /DROP CONSTRAINT does not share/);
  refused('ALTER TABLE T ADD C INT PRIMARY KEY;', /REFERENCES or CHECK, not PRIMARY KEY/);
  refused('ALTER TABLE T CHECK (A > 0);', /ADD before a check constraint/);
  refused('ALTER TABLE T AUDIT ALL FOREIGN KEY (A) REFERENCES P;', /only a first clause/);
  assert.equal(clauses('ALTER TABLE T ALTER COLUMN A SET DATA TYPE BIGINT ALTER COLUMN B SET DATA TYPE BIGINT ADD C INT;').length, 3);
  assert.equal(clauses('ALTER TABLE T ADD CONSTRAINT U1 UNIQUE (A) ADD CONSTRAINT U2 UNIQUE (B) DROP FOREIGN KEY F1 DROP FOREIGN KEY F2;').length, 4);
});

test('altered types, defaults and data types Db2 for z/OS does not take are refused', () => {
  refused('ALTER TABLE T ALTER COLUMN C SET DATA TYPE DATE;', /does not take DATE/);
  refused('ALTER TABLE T ALTER COLUMN C SET DATA TYPE TEXT;', /distinct type/);
  refused('ALTER TABLE T ALTER COLUMN C SET DATA TYPE CLOB(1M) FOR BIT DATA;', /CLOB FOR BIT DATA/);
  refused('ALTER TABLE T ALTER COLUMN C SET DATA TYPE GRAPHIC(4) CCSID 1200;', /CCSID/);
  refused('ALTER TABLE T ALTER COLUMN C SET DEFAULT CURRENT_TIMESTAMP;', /after DEFAULT/);
  refused('ALTER TABLE T ADD COLUMN C TIMESTAMP DEFAULT CURRENT TIMESTAMP;');
});

test('other dialects are refused with the reason named', () => {
  refused('ALTER TABLE test OWNER TO test_conn;', /PostgreSQL/);
  refused('ALTER TABLE customers ALTER COLUMN customer_id SET STATISTICS 1000;', /PostgreSQL/);
  refused('ALTER TABLE accounts ADD CONSTRAINT fk FOREIGN KEY (customer_id) REFERENCES customers (customer_id) ON DELETE RESTRICT ON UPDATE CASCADE;', /no ON UPDATE/);
  refused("ALTER TABLE tffm ADD COLUMN IF NOT EXISTS FILE_NAME VARCHAR(200) NULL, ADD COLUMN IF NOT EXISTS STATUS VARCHAR(20) DEFAULT 'PENDIENTE';", /IF \[NOT\] EXISTS/);
  refused('ALTER TABLE tffm ADD INDEX IF NOT EXISTS IDX_TFFM_REPLICA (REPLICA_NO);', /MySQL/);
  refused('ALTER TABLE IF EXISTS T ADD C INT;', /IF \[NOT\] EXISTS/);
  refused('ALTER TABLE T DROP COLUMN IF EXISTS C;', /IF \[NOT\] EXISTS/);
  refused('ALTER TABLE T MODIFY C INT;', /Oracle or MySQL/);
  refused('ALTER TABLE T CHANGE C D INT;', /MySQL/);
  refused('ALTER TABLE T ALTER COLUMN C TYPE VARCHAR(20);', /SET DATA TYPE/);
  refused('ALTER TABLE T ALTER COLUMN C SET NOT NULL;', /SET NOT NULL/);
  refused('ALTER TABLE T ALTER COLUMN C DROP NOT NULL;', /DROP NOT NULL/);
  refused('ALTER TABLE T ALTER COLUMN C SET DATA TYPE VARCHAR(10) USING C;', /USING/);
  refused('ALTER TABLE T ADD CONSTRAINT PK PRIMARY KEY (A) ENABLE NOVALIDATE;', /Oracle/);
  refused('ALTER TABLE T ADD CONSTRAINT FK FOREIGN KEY (A) REFERENCES P NOT VALID;', /PostgreSQL/);
  refused('ALTER TABLE T ADD CONSTRAINT U UNIQUE (A) DEFERRABLE INITIALLY DEFERRED;', /deferrable/);
  refused('ALTER TABLE T ADD C1 INT, C2 INT;', /without commas/);
  refused('ALTER TABLE T ADD (C1 INT, C2 INT);', /Oracle/);
  refused('ALTER TABLE T RENAME TO U;', /RENAME statement/);
  refused('ALTER TABLE T ADD C INT AFTER B;', /MySQL/);
  refused('ALTER TABLE T APPEND ON;', /Db2 for LUW/);
  refused('ALTER TABLE T ACTIVATE NOT LOGGED INITIALLY;', /Db2 for LUW/);
  refused('ALTER TABLE T LOCKSIZE ROW;', /ALTER TABLESPACE/);
  refused('ALTER TABLE LIB/T ADD C INT;', /Db2 for i/);
  refused('ALTER TABLE T;');
});
