// Findings one parsed Db2 statement gives (lib/db2/rules.mjs statementFindings).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statementFindings } from '../lib/db2/rules.mjs';
import './pin-machine.mjs';

test('returns an empty array when the statement status is not parsed', () => {
  const out = statementFindings('a.sql', { line: 1 }, { status: 'error', kind: 'GRANT', node: {} });
  assert.deepEqual(out, []);
});

test('returns an empty array when the kind is not a recognised statement', () => {
  const out = statementFindings('a.sql', { line: 1 }, { status: 'parsed', kind: 'SELECT', node: {} });
  assert.deepEqual(out, []);
});

test('flags a grant to PUBLIC as critical when a write privilege is granted', () => {
  const node = {
    privileges: [{ name: 'INSERT' }],
    grantees: [{ name: 'PUBLIC', type: 'PUBLIC' }],
    withGrantOption: false,
    objectType: 'TABLE',
    objects: [['SALES', 'ORDERS']],
  };
  const out = statementFindings('a.sql', { line: 10 }, { status: 'parsed', kind: 'GRANT', node });
  assert.deepEqual(out, [
    {
      rule: 'db2-grant-to-public',
      path: 'a.sql',
      line: 10,
      sev: 'crit',
      detail: 'INSERT on TABLE SALES.ORDERS granted to PUBLIC',
    },
  ]);
});

test('flags a grant to PUBLIC as high when only a read privilege is granted', () => {
  const node = {
    privileges: [{ name: 'SELECT' }],
    grantees: [{ name: 'PUBLIC', type: 'PUBLIC' }],
    withGrantOption: false,
    objectType: 'TABLE',
    objects: [['SALES', 'ORDERS']],
  };
  const out = statementFindings('a.sql', { line: 10 }, { status: 'parsed', kind: 'GRANT', node });
  assert.deepEqual(out, [
    {
      rule: 'db2-grant-to-public',
      path: 'a.sql',
      line: 10,
      sev: 'high',
      detail: 'SELECT on TABLE SALES.ORDERS granted to PUBLIC',
    },
  ]);
});

test('flags a grant to PUBLIC as critical when a system authority is granted', () => {
  const node = {
    privileges: [{ name: 'DBADM' }],
    grantees: [{ name: 'PUBLIC', type: 'PUBLIC' }],
    withGrantOption: false,
    objectType: 'DATABASE',
    objects: [['MYDB']],
  };
  const out = statementFindings('a.sql', { line: 10 }, { status: 'parsed', kind: 'GRANT', node });
  assert.deepEqual(out, [
    {
      rule: 'db2-grant-to-public',
      path: 'a.sql',
      line: 10,
      sev: 'crit',
      detail: 'DBADM on DATABASE MYDB granted to PUBLIC',
    },
    {
      rule: 'db2-system-authority-granted',
      path: 'a.sql',
      line: 10,
      sev: 'med',
      detail: 'DBADM on DATABASE MYDB granted to PUBLIC',
    },
  ]);
});

test('flags a grant with grant option for a named grantee', () => {
  const node = {
    privileges: [{ name: 'SELECT' }],
    grantees: [{ name: 'APPUSER', type: 'USER' }],
    withGrantOption: true,
    objectType: 'TABLE',
    objects: [['SALES', 'ORDERS']],
  };
  const out = statementFindings('a.sql', { line: 10 }, { status: 'parsed', kind: 'GRANT', node });
  assert.deepEqual(out, [
    {
      rule: 'db2-grant-with-grant-option',
      path: 'a.sql',
      line: 10,
      sev: 'med',
      detail: 'APPUSER may grant SELECT on TABLE SALES.ORDERS to others',
    },
  ]);
});

test('flags a system authority granted to a named user', () => {
  const node = {
    privileges: [{ name: 'SYSADM' }],
    grantees: [{ name: 'DBA', type: 'USER' }],
    withGrantOption: false,
    objectType: 'SUBSYSTEM',
    objects: [['DB2A']],
  };
  const out = statementFindings('a.sql', { line: 10 }, { status: 'parsed', kind: 'GRANT', node });
  assert.deepEqual(out, [
    {
      rule: 'db2-system-authority-granted',
      path: 'a.sql',
      line: 10,
      sev: 'med',
      detail: 'SYSADM on SUBSYSTEM DB2A granted to DBA',
    },
  ]);
});

test('returns an empty array for a grant that triggers no rule', () => {
  const node = {
    privileges: [{ name: 'SELECT' }],
    grantees: [{ name: 'APPUSER', type: 'USER' }],
    withGrantOption: false,
    objectType: 'TABLE',
    objects: [['SALES', 'ORDERS']],
  };
  const out = statementFindings('a.sql', { line: 10 }, { status: 'parsed', kind: 'GRANT', node });
  assert.deepEqual(out, []);
});

test('flags an editproc and a fieldproc on a created table', () => {
  const node = {
    name: 'ORDERS',
    options: { editproc: { program: 'EDIT1' } },
    columns: [
      { name: 'CUST', fieldproc: { program: 'F1' } },
      { name: 'AMT' },
    ],
  };
  const out = statementFindings('a.sql', { line: 20 }, { status: 'parsed', kind: 'CREATE TABLE', node });
  assert.deepEqual(out, [
    {
      rule: 'db2-exit-routine-declared',
      path: 'a.sql',
      line: 20,
      sev: 'info',
      detail: 'ORDERS runs EDITPROC EDIT1',
    },
    {
      rule: 'db2-exit-routine-declared',
      path: 'a.sql',
      line: 20,
      sev: 'info',
      detail: 'ORDERS.CUST runs FIELDPROC F1',
    },
  ]);
});

test('flags a validproc on a created table', () => {
  const node = {
    name: 'ORDERS',
    options: { validproc: 'VP1' },
    columns: [],
  };
  const out = statementFindings('a.sql', { line: 20 }, { status: 'parsed', kind: 'CREATE TABLE', node });
  assert.deepEqual(out, [
    {
      rule: 'db2-exit-routine-declared',
      path: 'a.sql',
      line: 20,
      sev: 'info',
      detail: 'ORDERS runs VALIDPROC VP1',
    },
  ]);
});

test('returns an empty array for a created table with no exit routines', () => {
  const node = {
    name: 'ORDERS',
    options: {},
    columns: [{ name: 'CUST' }],
  };
  const out = statementFindings('a.sql', { line: 20 }, { status: 'parsed', kind: 'CREATE TABLE', node });
  assert.deepEqual(out, []);
});

test('flags an external load module for a created procedure', () => {
  const node = {
    name: 'P1',
    language: 'JAVA',
    security: 'DEFINER',
    external: { name: 'MYMOD' },
    wlmEnvironment: { name: 'W1' },
  };
  const out = statementFindings('a.sql', { line: 30 }, { status: 'parsed', kind: 'CREATE PROCEDURE', node });
  assert.deepEqual(out, [
    {
      rule: 'db2-external-routine',
      path: 'a.sql',
      line: 30,
      sev: 'info',
      detail: 'P1 runs JAVA load module MYMOD with SECURITY DEFINER in WLM environment W1',
    },
  ]);
});

test('flags an implicit external load module for a created function', () => {
  const node = {
    name: 'F1',
    language: 'C',
    security: 'DEFINER',
    external: { name: 'IMPMOD', implicit: true },
    wlmEnvironment: null,
  };
  const out = statementFindings('a.sql', { line: 30 }, { status: 'parsed', kind: 'CREATE FUNCTION', node });
  assert.deepEqual(out, [
    {
      rule: 'db2-external-routine',
      path: 'a.sql',
      line: 30,
      sev: 'info',
      detail: 'F1 runs C load module IMPMOD (named by the routine) with SECURITY DEFINER',
    },
  ]);
});

test('returns an empty array for a created procedure with no external module', () => {
  const node = {
    name: 'P1',
    language: 'SQL',
    security: 'DEFINER',
    external: null,
    wlmEnvironment: null,
  };
  const out = statementFindings('a.sql', { line: 30 }, { status: 'parsed', kind: 'CREATE PROCEDURE', node });
  assert.deepEqual(out, []);
});
