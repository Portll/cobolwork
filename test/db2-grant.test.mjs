// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for Db2 GRANT and REVOKE statement parsers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDb2, parseDb2Statement } from '../lib/db2/read.mjs';

const parse = (sql) => parseDb2Statement(readDb2(sql).statements[0]);

test('GRANT SELECT, INSERT, UPDATE ON TABLE TO NAME', () => {
  const r = parse('GRANT SELECT, INSERT, UPDATE ON TABLE CABSRTHS TO CABSBAT;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'GRANT');
  assert.deepEqual(r.node.privileges, [
    { name: 'SELECT', columns: null },
    { name: 'INSERT', columns: null },
    { name: 'UPDATE', columns: null }
  ]);
  assert.equal(r.node.objectType, 'TABLE');
  assert.deepEqual(r.node.objects, [['CABSRTHS']]);
  assert.deepEqual(r.node.grantees, [{ type: 'NAME', name: 'CABSBAT' }]);
  assert.equal(r.node.withGrantOption, false);
});

test('GRANT USAGE ON SEQUENCE TO ROLE', () => {
  const r = parse('GRANT USAGE ON SEQUENCE AUTOSALE.FPL_SEQ TO ROLE AUTOSALES_APP;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'GRANT');
  assert.deepEqual(r.node.privileges, [{ name: 'USAGE', columns: null }]);
  assert.equal(r.node.objectType, 'SEQUENCE');
  assert.deepEqual(r.node.objects, [['AUTOSALE', 'FPL_SEQ']]);
  assert.deepEqual(r.node.grantees, [{ type: 'ROLE', name: 'AUTOSALES_APP' }]);
  assert.equal(r.node.withGrantOption, false);
});

test('GRANT ALL ON DATABASE TO NAME', () => {
  const r = parse('GRANT ALL ON DATABASE test_conn TO test_conn;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'GRANT');
  assert.deepEqual(r.node.privileges, [{ name: 'ALL', columns: null }]);
  assert.equal(r.node.objectType, 'DATABASE');
  assert.deepEqual(r.node.objects, [['test_conn']]);
  assert.deepEqual(r.node.grantees, [{ type: 'NAME', name: 'test_conn' }]);
  assert.equal(r.node.withGrantOption, false);
});

test('GRANT SELECT ON TABLE TO PUBLIC WITH GRANT OPTION', () => {
  const r = parse('GRANT SELECT ON TABLE T TO PUBLIC WITH GRANT OPTION;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'GRANT');
  assert.deepEqual(r.node.grantees, [{ type: 'PUBLIC', name: 'PUBLIC' }]);
  assert.equal(r.node.withGrantOption, true);
});

test('REVOKE SELECT ON TABLE FROM NAME', () => {
  const r = parse('REVOKE SELECT ON TABLE T FROM CABSBAT;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'REVOKE');
  assert.deepEqual(r.node.privileges, [{ name: 'SELECT', columns: null }]);
  assert.equal(r.node.objectType, 'TABLE');
  assert.deepEqual(r.node.objects, [['T']]);
  assert.deepEqual(r.node.grantees, [{ type: 'NAME', name: 'CABSBAT' }]);
  assert.equal(r.node.by, null);
  assert.equal(r.node.dependent, null);
});

test('REVOKE ALL ON DATABASE FROM ROLE BY ALL RESTRICT', () => {
  const r = parse('REVOKE ALL ON DATABASE D FROM ROLE R BY ALL RESTRICT;');
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'REVOKE');
  assert.deepEqual(r.node.privileges, [{ name: 'ALL', columns: null }]);
  assert.equal(r.node.objectType, 'DATABASE');
  assert.deepEqual(r.node.objects, [['D']]);
  assert.deepEqual(r.node.grantees, [{ type: 'ROLE', name: 'R' }]);
  assert.equal(r.node.by, 'ALL');
  assert.equal(r.node.dependent, 'RESTRICT');
});

test('USE OF names its objects with no ON, AT ALL LOCATIONS is accepted, and a bare ON means a table', () => {
  const use = parse('GRANT USE OF TABLESPACE DB1.TS1 TO PUBLIC;');
  assert.deepEqual([use.status, use.node.objectType, use.node.objects, use.node.grantees[0].type], ['parsed', 'TABLESPACE', [['DB1', 'TS1']], 'PUBLIC']);
  const at = parse('GRANT SELECT ON T TO PUBLIC AT ALL LOCATIONS;');
  assert.deepEqual([at.status, at.node.objectType, at.node.atAllLocations], ['parsed', 'TABLE', true]);
});
