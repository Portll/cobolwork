// SPDX-License-Identifier: AGPL-3.0-or-later
// Tests for the IMS and Db2 DDL rule sets over a tree: which files they read, what they report and
// what they say they did not read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanIms } from '../lib/sets/ims.mjs';
import { scanDb2 } from '../lib/sets/ddl.mjs';
import { sniffKind, isSource } from '../lib/sources.mjs';
import './pin-machine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'imsddl');
const rows = (r) => r.findings.map((f) => [f.rule, f.path, f.line, f.sev]).sort((a, b) => String(a).localeCompare(String(b)));

test('the IMS set reads .dbd and .psb files, assembler files holding a PSB, and members with no extension', () => {
  const r = scanIms(ROOT);
  assert.equal(r.tool, 'cobolwork-ims');
  assert.deepEqual([r.summary.filesScanned, r.summary.dbdFiles, r.summary.psbFiles], [4, 1, 3]);
  assert.deepEqual(rows(r), [
    ['ims-definition-inconsistent', 'psb/ORDRPT.psb', 1, 'low'],
    ['ims-pcb-procopt-all', 'asm/ORDUPD.asm', 2, 'info'],
    ['ims-pcb-procopt-all', 'pds/ORDMNT', 1, 'info'],
    ['ims-senseg-unknown-segment', 'asm/ORDUPD.asm', 4, 'low'],
  ]);
  assert.equal(r.findings.find((f) => f.rule === 'ims-definition-inconsistent').evidence, 'construct');
  assert.equal(r.findings.find((f) => f.rule === 'ims-pcb-procopt-all').evidence, 'context');
  assert.equal(r.summary.coverageIncomplete, false);
});

test('a statement the IMS reader refuses is named, and the coverage is incomplete', () => {
  assert.equal(scanIms(ROOT).summary.statementsNotRead, undefined);
  const withRefusal = scanIms(join(ROOT, '..', 'imsddl-refused'));
  assert.equal(withRefusal.summary.coverageIncomplete, true);
  assert.deepEqual(Object.keys(withRefusal.summary.statementsNotRead), ['SEGM']);
});

test('the DDL set reports PUBLIC grants, a grant option and an authority, and counts a foreign statement as not read', () => {
  const r = scanDb2(ROOT);
  assert.equal(r.tool, 'cobolwork-ddl');
  assert.deepEqual(rows(r), [
    ['db2-grant-to-public', 'pds/GRANTMBR', 2, 'crit'],
    ['db2-grant-to-public', 'sql/GRANTS.sql', 1, 'high'],
    ['db2-grant-to-public', 'sql/GRANTS.sql', 2, 'crit'],
    ['db2-grant-with-grant-option', 'sql/GRANTS.sql', 4, 'med'],
    ['db2-system-authority-granted', 'sql/GRANTS.sql', 4, 'med'],
  ]);
  assert.equal(r.summary.filesScanned, 2);
  assert.equal(r.summary.coverageIncomplete, true);
  assert.equal(r.summary.statementsNotRead['CREATE TABLE'].first, 'sql/GRANTS.sql:5');
});

test('a member with no extension is an IMS definition or Db2 DDL by what it holds, and neither is COBOL source', () => {
  assert.equal(sniffKind(join(ROOT, 'pds', 'ORDMNT')), 'ims');
  assert.equal(sniffKind(join(ROOT, 'pds', 'GRANTMBR')), 'db2');
  assert.equal(isSource(join(ROOT, 'pds', 'ORDMNT')), false);
  assert.equal(isSource(join(ROOT, 'pds', 'GRANTMBR')), false);
});
