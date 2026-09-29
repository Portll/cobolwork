import { test } from 'node:test';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventory } from '../lib/inventory.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'parser');

test('an unresolved copybook makes coverage incomplete', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cobolwork-inv-'));
  writeFileSync(join(dir, 'a.cbl'), [
    '       IDENTIFICATION DIVISION.',
    '       PROGRAM-ID. A.',
    '       DATA DIVISION.',
    '       WORKING-STORAGE SECTION.',
    '       COPY NOSUCHBOOK.',
    '       PROCEDURE DIVISION.',
    '           GOBACK.',
    '',
  ].join('\n'));
  const r = inventory(dir);
  assert.equal(r.summary.filesScanned, 1);
  assert.equal(r.summary.copiesMissing, 1);
  assert.equal(r.summary.coverageIncomplete, true, 'a tree whose copybooks are missing has not been fully read');
  assert.equal(r.missingCopybooks.NOSUCHBOOK, 1);
});

test('a copybook supplied by the system is not counted as missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cobolwork-inv-'));
  writeFileSync(join(dir, 'b.cbl'), [
    '       IDENTIFICATION DIVISION.',
    '       PROGRAM-ID. B.',
    '       DATA DIVISION.',
    '       WORKING-STORAGE SECTION.',
    '       COPY DFHAID.',
    '       PROCEDURE DIVISION.',
    '           GOBACK.',
    '',
  ].join('\n'));
  const r = inventory(dir);
  assert.equal(r.summary.copiesSystem, 1);
  assert.equal(r.summary.copiesMissing, 0);
});

test('an empty tree says it read nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cobolwork-inv-'));
  mkdirSync(join(dir, 'sub'));
  const r = inventory(dir);
  assert.equal(r.summary.filesScanned, 0);
  assert.equal(r.summary.nosrc, true);
});

test('the fixture tree reports its programs and formats', () => {
  const r = inventory(FIXTURES);
  assert.ok(r.summary.programs >= 14);
  assert.ok(r.summary.filesScanned >= 12);
  assert.ok(Object.keys(r.summary.formats).length >= 1);
});
