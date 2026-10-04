// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDb2, DB2_RULES } from '../lib/db2/rules.mjs';
import './pin-machine.mjs';

const check = (sql) => checkDb2('ddl.sql', sql).map(({ rule, line, sev, detail }) => ({ rule, line, sev, detail }));

test('a read granted to PUBLIC is high; a write or an authority granted to PUBLIC is crit', () => {
  assert.deepEqual(check('GRANT SELECT ON T1 TO PUBLIC;'), [{ rule: 'db2-grant-to-public', line: 1, sev: 'high', detail: 'SELECT on TABLE T1 granted to PUBLIC' }]);
  assert.deepEqual(check('GRANT INSERT, UPDATE ON TABLE S.T2 TO PUBLIC;').map((f) => [f.sev, f.detail]), [['crit', 'INSERT, UPDATE on TABLE S.T2 granted to PUBLIC']]);
  assert.deepEqual(check('GRANT USE OF ALL BUFFERPOOLS TO PUBLIC;').map((f) => [f.sev, f.detail]), [['high', 'USE on ALL BUFFERPOOLS granted to PUBLIC']]);
});

test('a grant to named users or a revoke from PUBLIC raises nothing', () => {
  assert.deepEqual(check('GRANT SELECT ON T1 TO USER1, ROLE R1; REVOKE SELECT ON T1 FROM PUBLIC;'), []);
});

test('WITH GRANT OPTION names every grantee', () => {
  assert.deepEqual(check('GRANT SELECT ON T1 TO USER1, USER2 WITH GRANT OPTION;'), [
    { rule: 'db2-grant-with-grant-option', line: 1, sev: 'med', detail: 'USER1, USER2 may grant SELECT on TABLE T1 to others' },
  ]);
});

test('system and database authorities, and PUBLIC on top', () => {
  assert.deepEqual(check('GRANT SYSADM TO USER1;').map((f) => f.detail), ['SYSADM granted to USER1']);
  assert.deepEqual(check('GRANT DBADM ON DATABASE DB1 TO USER1;').map((f) => f.detail), ['DBADM on DATABASE DB1 granted to USER1']);
  assert.deepEqual(check('GRANT DBCTRL ON DATABASE DB1 TO PUBLIC;').map((f) => [f.rule, f.sev]), [
    ['db2-grant-to-public', 'crit'], ['db2-system-authority-granted', 'med'],
  ]);
});

test('EDITPROC, VALIDPROC and FIELDPROC each name their program, on the statement line', () => {
  assert.deepEqual(check('\nCREATE TABLE T1 (C1 INT, C2 CHAR(8) FIELDPROC FP1) EDITPROC EP1 VALIDPROC VP1;').map((f) => [f.line, f.detail]), [
    [2, 'T1 runs EDITPROC EP1'], [2, 'T1 runs VALIDPROC VP1'], [2, 'T1.C2 runs FIELDPROC FP1'],
  ]);
});

test('tables with no exit routine, temporary and auxiliary tables raise nothing', () => {
  assert.deepEqual(check('CREATE TABLE T1 (C1 INT); CREATE GLOBAL TEMPORARY TABLE G (A INT); CREATE AUX TABLE X IN D.S STORES T1 COLUMN C1;'), []);
});

test('every rule has a severity, evidence, CWE and text', () => {
  for (const [id, r] of Object.entries(DB2_RULES)) assert.ok(r.sev && r.evidence && /^CWE-\d+$/.test(r.cwe) && r.text, id);
});

test('an external procedure names its load module, SECURITY and WLM environment', () => {
  assert.deepEqual(check('CREATE PROCEDURE S.P1 (IN A INT) LANGUAGE COBOL EXTERNAL NAME PGM1 PARAMETER STYLE GENERAL SECURITY USER WLM ENVIRONMENT WLMENV1;'), [
    { rule: 'db2-external-routine', line: 1, sev: 'info', detail: 'S.P1 runs COBOL load module PGM1 with SECURITY USER in WLM environment WLMENV1' },
  ]);
});

test('an external function with EXTERNAL alone runs the module its own name gives, under SECURITY DB2 by default', () => {
  assert.deepEqual(check('CREATE FUNCTION CENTER (FLOAT, FLOAT) RETURNS FLOAT EXTERNAL LANGUAGE C PARAMETER STYLE SQL NO SQL;').map((f) => f.detail), [
    'CENTER runs C load module CENTER (named by the routine) with SECURITY DB2',
  ]);
});

test('a native SQL procedure runs no load module and raises nothing', () => {
  assert.deepEqual(check('CREATE PROCEDURE P2 (IN A INT) LANGUAGE SQL BEGIN DECLARE X INT; SET X = A; END;'), []);
});
