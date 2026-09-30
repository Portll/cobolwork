import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { scanCics, CICS_RULES } from '../lib/sets/cics.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cics');
const pos = scanCics(join(FIXTURES, 'pos'));
const neg = scanCics(join(FIXTURES, 'neg'));
const of = (r, rule) => r.findings.filter(f => f.rule === rule);

test('a program that reads its communication area without checking EIBCALEN is reported', () => {
  const f = of(pos, 'cics-commarea-without-length-check');
  assert.equal(f.length, 1);
  assert.equal(f[0].program, 'CNOEIB');
  assert.equal(f[0].sev, 'high');
  assert.match(f[0].detail, /EIBCALEN/);
});

const cicsTree = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-cics-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  return of(scanCics(root), 'cics-commarea-without-length-check');
};
const prog = (id, ws, linkage, body) => [
  '       IDENTIFICATION DIVISION.', `       PROGRAM-ID. ${id}.`, '       DATA DIVISION.', '       WORKING-STORAGE SECTION.', ...ws,
  '       LINKAGE SECTION.', ...linkage, '       PROCEDURE DIVISION.', ...body, '           GOBACK.', ''].join('\n');
const CALLEE = prog('CALLEE', ['       01 WS-X PIC X(10).'], ['       01 DFHCOMMAREA PIC X(50).'],
  ['           MOVE DFHCOMMAREA(1:10) TO WS-X', '           EXEC CICS RETURN END-EXEC']);
const CALLER = prog('CALLER', ['       01 AREA50 PIC X(50).', "       01 WS-PGM PIC X(8) VALUE 'CALLEE  '."], [],
  ['           EXEC CICS LINK PROGRAM(WS-PGM) COMMAREA(AREA50)', '                LENGTH(LENGTH OF AREA50) END-EXEC']);

test('a program every caller in the tree passes a whole area is low, unless a transaction starts it', () => {
  // Shapes read in the 500-repository corpus on 2026-09-27: the only caller links with the full
  // area, naming the program through a variable holding a literal.
  const [low] = cicsTree({ 'CALLEE.cbl': CALLEE, 'CALLER.cbl': CALLER });
  assert.equal(low.sev, 'low');
  assert.match(low.detail, /every caller in the tree passes at least 50 bytes, and no transaction starts it$/);
  const [started] = cicsTree({ 'CALLEE.cbl': CALLEE, 'CALLER.cbl': CALLER, 'APP.csd': 'DEFINE TRANSACTION(CLEE) GROUP(APP) PROGRAM(CALLEE)\n' });
  assert.equal(started.sev, 'high', 'a terminal starts a transaction with no communication area');
  const [alone] = cicsTree({ 'CALLEE.cbl': CALLEE });
  assert.equal(alone.sev, 'high');
});

test('a DFHCOMMAREA in a program with no EXEC CICS, or one it points at its own storage, is no caller\'s area', () => {
  const pointed = prog('CONV', ['       01 BUF-PTR POINTER.', '       01 WS-X PIC X(10).'], ['       01 DFHCOMMAREA PIC X(834).'],
    ['           SET ADDRESS OF DFHCOMMAREA TO BUF-PTR', '           MOVE DFHCOMMAREA(1:10) TO WS-X', '           EXEC CICS RETURN END-EXEC']);
  assert.deepEqual(cicsTree({ 'CONV.cbl': pointed }), []);
});

test('EIBCALEN checks the area only where it bounds the read', () => {
  const lengthRule = (body, ws = [], linkage = ['       01 DFHCOMMAREA PIC X(100).']) =>
    cicsTree({ 'LEN.cbl': prog('LEN', ['       01 WS-LEN PIC S9(4) COMP.', '       01 WS-X PIC X(10).', ...ws], linkage, body) })
      .filter(f => f.rule === 'cics-commarea-without-length-check').length;
  const read = ['           MOVE DFHCOMMAREA(1:10) TO WS-X', '           EXEC CICS RETURN END-EXEC'];
  assert.equal(lengthRule(['           MOVE EIBCALEN TO WS-LEN', ...read]), 1, 'copied and never tested');
  assert.equal(lengthRule(['           DISPLAY EIBCALEN', ...read]), 1, 'logged');
  assert.equal(lengthRule(['           MOVE EIBCALEN TO WS-LEN', '           IF WS-LEN < 10', '              EXEC CICS RETURN END-EXEC', '           END-IF', ...read]), 0, 'tested through a copy');
  assert.equal(lengthRule(['           EVALUATE TRUE', '              WHEN EIBCALEN = 0', '                 EXEC CICS RETURN END-EXEC', '           END-EVALUATE', ...read]), 0, 'EVALUATE');
  // The corpus's CPAT400 and CINT: operands inside parentheses are not a statement's sources.
  assert.equal(lengthRule(['           IF (EIBCALEN > 0)', '              MOVE DFHCOMMAREA(1:10) TO WS-X', '           END-IF', '           EXEC CICS RETURN END-EXEC']), 0, 'IF (EIBCALEN > 0)');
  assert.equal(lengthRule(['           COMPUTE WS-LEN = (EIBCALEN - 4)', '           IF WS-LEN < 6', '              EXEC CICS RETURN END-EXEC', '           END-IF', ...read]), 0, 'computed in parentheses');
  assert.equal(lengthRule(['           MOVE DFHCOMMAREA(1:EIBCALEN) TO WS-X', '           EXEC CICS RETURN END-EXEC']), 0, 'the length of the read');
  assert.equal(lengthRule(['           CALL \'CHKLEN\' USING DFHEIBLK DFHCOMMAREA', ...read]), 0, 'handed to a routine with the EIB');
  assert.equal(lengthRule(read, [], ['       01 DFHCOMMAREA.', '          05 CA-BYTE PIC X OCCURS 1 TO 100 DEPENDING ON EIBCALEN.']), 0, 'OCCURS DEPENDING ON');
});

test('a program that takes DFHCOMMAREA\'s address into a pointer still reads the caller\'s area', () => {
  // GenApp's LGACDB01 shape: SET WS-ADDR-DFHCOMMAREA TO ADDRESS OF DFHCOMMAREA.
  const addressed = prog('ADDR', ['       01 CA-PTR POINTER.', '       01 WS-X PIC X(10).'], ['       01 DFHCOMMAREA PIC X(834).'],
    ['           SET CA-PTR TO ADDRESS OF DFHCOMMAREA', '           MOVE DFHCOMMAREA(1:10) TO WS-X', '           EXEC CICS RETURN END-EXEC']);
  assert.deepEqual(cicsTree({ 'ADDR.cbl': addressed }).map(f => f.rule), ['cics-commarea-without-length-check']);
});

test('a length longer than the area passed is reported', () => {
  const f = of(pos, 'cics-commarea-length-exceeds-area');
  assert.equal(f.length, 1);
  assert.match(f[0].detail, /LENGTH\(200\).*100 bytes/);
});

test('a length longer than the callee declares is reported', () => {
  const f = of(pos, 'cics-commarea-length-exceeds-callee');
  assert.equal(f.length, 1);
  assert.match(f[0].detail, /CCALLEE.*50 bytes/);
});

test('a transfer to a program named by a variable is reported', () => {
  const f = of(pos, 'cics-transfer-to-variable-program');
  assert.equal(f.length, 1);
  assert.match(f[0].detail, /WS-PGM/);
});

test('a program that checks EIBCALEN, passes a fitting length and names its target is clean', () => {
  assert.deepEqual(neg.findings, []);
  assert.equal(neg.summary.cicsPrograms, 1);
  assert.equal(neg.summary.commareaRead, 1, 'the negative case must exercise the rule, not dodge it');
});

test('a tree with no CICS declares a void', () => {
  const none = scanCics(join(FIXTURES, 'pos', 'no-such-dir'));
  assert.equal(none.summary.filesScanned, 0);
  assert.equal(none.summary.nosrc, true);
});

// A construct finding says whether it is a defect to act on and how to fix it, the same for every
// instance. If a rule declares one it declares the other, so a reader is never told the impact
// without the fix or the reverse.
test('every CICS rule says what it lets someone do and how to fix it', () => {
  for (const [id, r] of Object.entries(CICS_RULES)) {
    assert.equal(typeof r.impact, 'string', `${id} has no impact`);
    assert.ok(r.impact.length > 20, `${id} impact is too short to say who can do what`);
    assert.equal(typeof r.remedy, 'string', `${id} has no remedy`);
    assert.ok(r.remedy.length > 20, `${id} remedy is too short to be a fix`);
  }
});
