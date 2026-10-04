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
const text = (toks) => toks.map((t) => (t.t === 'lit' ? `'${t.v}'` : t.v)).join(' ');
const shown = (n) => ({ ...n, fullselect: text(n.fullselect), with: n.with.map((w) => ({ ...w, fullselect: text(w.fullselect) })) });

test('IBM example 1: VPROJRE1, a read-only join of PROJ and EMP with seven named columns', () => {
  const n = node(` CREATE VIEW DSN8D10.VPROJRE1
 (PROJNO,PROJNAME,PROJDEP,RESPEMP,
 FIRSTNME,MIDINIT,LASTNAME)
 AS SELECT ALL
 PROJNO,PROJNAME,DEPTNO,EMPNO,
 FIRSTNME,MIDINIT,LASTNAME
 FROM DSN8D10.PROJ, DSN8D10.EMP
 WHERE RESPEMP = EMPNO;`);
  assert.deepEqual(shown(n), {
    kind: 'CREATE VIEW', name: 'DSN8D10.VPROJRE1',
    columns: ['PROJNO', 'PROJNAME', 'PROJDEP', 'RESPEMP', 'FIRSTNME', 'MIDINIT', 'LASTNAME'],
    with: [],
    fullselect: 'SELECT ALL PROJNO , PROJNAME , DEPTNO , EMPNO , FIRSTNME , MIDINIT , LASTNAME FROM DSN8D10 . PROJ , DSN8D10 . EMP WHERE RESPEMP = EMPNO',
    checkOption: null,
    tables: ['DSN8D10.PROJ', 'DSN8D10.EMP'],
  });
});

test('IBM example 2: FIRSTQTR, the UNION ALL of three monthly fullselects', () => {
  const n = node(` CREATE VIEW DSN8D10.FIRSTQTR (SNO, CHARGES, DATE) AS
 SELECT SNO, CHARGES, DATE
 FROM MONTH1
 WHERE DATE BETWEEN '01/01/2000' and '01/31/2000'
 UNION All
 SELECT SNO, CHARGES, DATE
 FROM MONTH2
 WHERE DATE BETWEEN '02/01/2000' and '02/29/2000'
 UNION All
 SELECT SNO, CHARGES, DATE
 FROM MONTH3
 WHERE DATE BETWEEN '03/01/2000' and '03/31/2000';`);
  assert.deepEqual(shown(n), {
    kind: 'CREATE VIEW', name: 'DSN8D10.FIRSTQTR', columns: ['SNO', 'CHARGES', 'DATE'], with: [],
    fullselect: "SELECT SNO , CHARGES , DATE FROM MONTH1 WHERE DATE BETWEEN '01/01/2000' and '01/31/2000' UNION All " +
      "SELECT SNO , CHARGES , DATE FROM MONTH2 WHERE DATE BETWEEN '02/01/2000' and '02/29/2000' UNION All " +
      "SELECT SNO , CHARGES , DATE FROM MONTH3 WHERE DATE BETWEEN '03/01/2000' and '03/31/2000'",
    checkOption: null,
    tables: ['MONTH1', 'MONTH2', 'MONTH3'],
  });
});

test("the reference's check option views: CASCADED is the default, LOCAL is kept", () => {
  assert.equal(node('CREATE VIEW V1 AS SELECT COL1 FROM T1 WHERE COL1 > 10;').checkOption, null);
  assert.equal(node('CREATE VIEW V2 AS SELECT COL1 FROM V1 WITH CASCADED CHECK OPTION;').checkOption, 'CASCADED');
  assert.equal(node('CREATE VIEW V3 AS SELECT COL1 FROM V2 WITH CHECK OPTION;').checkOption, 'CASCADED');
  assert.equal(node('CREATE VIEW V4 AS SELECT COL1 FROM V3 WITH LOCAL CHECK OPTION;').checkOption, 'LOCAL');
});

test('common table expressions stay apart from the fullselect, and their names are not tables', () => {
  const n = node('CREATE VIEW S.V (D, N) AS WITH TOTALS (D, N) AS (SELECT DEPT, COUNT(*) FROM S.EMP GROUP BY DEPT), BIG AS (SELECT D FROM TOTALS WHERE N > 9) SELECT D, N FROM TOTALS WHERE D IN (SELECT D FROM BIG);');
  assert.deepEqual(shown(n).with, [
    { name: 'TOTALS', columns: ['D', 'N'], fullselect: 'SELECT DEPT , COUNT ( * ) FROM S . EMP GROUP BY DEPT' },
    { name: 'BIG', columns: null, fullselect: 'SELECT D FROM TOTALS WHERE N > 9' },
  ]);
  assert.equal(text(n.fullselect), 'SELECT D , N FROM TOTALS WHERE D IN ( SELECT D FROM BIG )');
  assert.deepEqual(n.tables, ['S.EMP']);
});

test('tables come from joins, nested table expressions and subqueries, not from EXTRACT or IS DISTINCT FROM', () => {
  const n = node(`CREATE VIEW V AS
    SELECT EXTRACT(YEAR FROM A.D), B.X
    FROM A INNER JOIN B ON A.K = B.K
      LEFT OUTER JOIN (C CROSS JOIN D.E) ON 1 = 1,
      (SELECT X FROM F) AS G,
      TABLE (UDF1(A.K)) AS H,
      TABLE (SELECT Y FROM I WHERE I.K = A.K) AS J
    WHERE A.Q IS NOT DISTINCT FROM B.Q AND A.R = (SELECT MAX(R) FROM K FOR SYSTEM_TIME AS OF CURRENT TIMESTAMP);`);
  assert.deepEqual(n.tables, ['A', 'B', 'C', 'D.E', 'F', 'I', 'K']);
});

test('a parenthesised fullselect is a fullselect', () => {
  const n = node('CREATE VIEW V AS ((SELECT A FROM T1) UNION (SELECT A FROM T2));');
  assert.deepEqual(n.tables, ['T1', 'T2']);
});

test('forms Db2 for z/OS does not take are refused, with the dialect named where it is known', () => {
  const refused = (sql, reason) => {
    const r = parse(sql);
    assert.equal(r.status, 'unparsed', sql);
    if (reason) assert.match(r.reason, reason, sql);
  };
  refused('CREATE OR REPLACE VIEW V AS SELECT 1 FROM T;', /no CREATE OR REPLACE VIEW/);
  refused('create or replace view RAW.S.V as (SELECT $1 as col1 FROM RAW.S.ORDERS LIMIT 5);', /no CREATE OR REPLACE VIEW/);
  refused('CREATE VIEW IF NOT EXISTS V AS SELECT 1 FROM T;', /IF \[NOT\] EXISTS/);
  refused('CREATE MATERIALIZED VIEW V AS SELECT 1 FROM T;', /materialized query tables/);
  refused('CREATE VIEW TEHMSDTA/RMVAVAIL AS SELECT R.RM_NO FROM TEHMSDTA/RMPROOM R;', /Db2 for i/);
  refused('CREATE VIEW V AS SELECT * FROM T WITH READ ONLY;', /Oracle/);
  refused('CREATE VIEW V AS SELECT * FROM T WITH CHECK OPTION CONSTRAINT C1;', /Oracle/);
  refused('CREATE VIEW V WITH (security_barrier) AS SELECT * FROM T;');
  refused('CREATE VIEW V AS WITH RECURSIVE R AS (SELECT 1 FROM T) SELECT * FROM R;', /WITH RECURSIVE/);
  refused('CREATE VIEW V AS VALUES 1;');
  refused('CREATE VIEW V (S.A) AS SELECT A FROM T;');
  refused('CREATE VIEW V SELECT A FROM T;');
  refused('CREATE VIEW V AS SELECT A FROM T WITH UR;');
});
