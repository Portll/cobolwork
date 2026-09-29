import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanOpaque, OPAQUE_RULES } from '../lib/sets/opaque.mjs';
import { ALL_RULES, RULE_SETS } from '../lib/scan.mjs';
import './pin-machine.mjs';

const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-opaque-'));
  for (const [name, text] of Object.entries(files)) {
    const p = join(root, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
};
const prog = (id, ws, body) => [
  '       IDENTIFICATION DIVISION.', `       PROGRAM-ID. ${id}.`,
  '       DATA DIVISION.', '       WORKING-STORAGE SECTION.', ws,
  '       PROCEDURE DIVISION.', body, '           GOBACK.', '',
].join('\n');

const rules = (root) => scanOpaque(root).findings.map((f) => f.rule).sort();

// These are not defects. They are the reason a clean flow result over this program is less clean
// than it looks, which is the same claim coverageIncomplete makes about files nobody read.
test('every opaque rule is informational, never a severity that implies a defect', () => {
  for (const [id, r] of Object.entries(OPAQUE_RULES)) assert.equal(r.sev, 'info', id);
});

test('repointing storage is reported, because what the item holds afterwards came from nowhere the engine can see', () => {
  const root = tree({ 'P.cbl': prog('P', '       01 WS-PTR USAGE IS POINTER.', '           SET ADDRESS OF LK-REC TO WS-PTR') });
  const f = scanOpaque(root).findings.filter((x) => x.rule === 'opaque-pointer-addressing');
  assert.equal(f.length, 1);
  assert.match(f[0].detail, /LK-REC/);
});

test('control flow altered at run time is reported, in both of its forms', () => {
  const root = tree({
    'A.cbl': prog('A', '       01 WS-N PIC 9(4).', '           ALTER PARA-A TO PROCEED TO PARA-B'),
    'B.cbl': prog('B', '       01 WS-N PIC 9(4).', '           GO TO PARA-A PARA-B DEPENDING ON WS-N'),
  });
  assert.deepEqual(rules(root), ['opaque-altered-control-flow', 'opaque-altered-control-flow']);
});

test('an alternate entry point is reported, because the flow rules never start there', () => {
  const root = tree({ 'E.cbl': ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. E.',
    '       PROCEDURE DIVISION.', '           GOBACK.', '       ENTRY "SECOND".', '           GOBACK.', ''].join('\n') });
  const f = scanOpaque(root).findings.filter((x) => x.rule === 'opaque-alternate-entry');
  assert.equal(f.length, 1);
  assert.match(f[0].detail, /SECOND/);
});

// A CALL of a variable is already reported by the flow rules as a dynamic program load. This set
// only adds something when the variable was declared a pointer, or it would double-report.
test('a call through a declared procedure pointer is reported; an ordinary variable call is not', () => {
  const viaPointer = tree({ 'P.cbl': prog('P',
    '       01 WS-TARGET USAGE IS PROCEDURE-POINTER.', '           CALL WS-TARGET USING WS-TARGET') });
  assert.ok(rules(viaPointer).includes('opaque-procedure-pointer'));

  const viaName = tree({ 'Q.cbl': prog('Q',
    '       01 WS-NAME PIC X(8).', '           CALL WS-NAME USING WS-NAME') });
  assert.ok(!rules(viaName).includes('opaque-procedure-pointer'),
    'the flow rules already call this a dynamic program load');
});

test('an ordinary program is silent, so the set means something when it speaks', () => {
  const root = tree({ 'C.cbl': prog('C', '       01 WS-A PIC X(10).', '           MOVE SPACES TO WS-A') });
  assert.deepEqual(scanOpaque(root).findings, []);
  assert.equal(scanOpaque(root).summary.programsOpaque, 0);
});

test('a construct inside a comment is not a construct', () => {
  const root = tree({ 'D.cbl': [
    '       IDENTIFICATION DIVISION.', '       PROGRAM-ID. D.', '       PROCEDURE DIVISION.',
    '      * ALTER PARA-A TO PROCEED TO PARA-B was removed in 1998',
    '           GOBACK.', ''].join('\n') });
  assert.deepEqual(scanOpaque(root).findings, [],
    'matching raw text would fire on every commented-out ALTER in the estate');
});

test('every file read is counted, including the ones the cheap filter skipped', () => {
  // filesScanned is what a report uses to say how much it read. A file skipped for holding none of
  // these words was still opened and read.
  const root = tree({
    'X.cbl': prog('X', '       01 WS-PTR USAGE IS POINTER.', '           SET ADDRESS OF LK TO WS-PTR'),
    'Y.cbl': prog('Y', '       01 WS-A PIC X.', '           MOVE SPACES TO WS-A'),
  });
  assert.equal(scanOpaque(root).summary.filesScanned, 2);
});

test('the opaque set is registered and catalogued', () => {
  assert.ok(RULE_SETS.includes('opaque'));
  for (const id of Object.keys(OPAQUE_RULES)) assert.ok(ALL_RULES[id], `${id} is in ALL_RULES`);
});
