import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { scanCompile, COMPILE_RULES } from '../lib/sets/compile.mjs';
import './pin-machine.mjs';

const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-compile-'));
  for (const [name, text] of Object.entries(files)) {
    const p = join(root, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
};
const prog = (id, ws, body, head = '') => [
  '       IDENTIFICATION DIVISION.', `       PROGRAM-ID. ${id}.`, head,
  '       DATA DIVISION.', '       WORKING-STORAGE SECTION.', ws,
  '       PROCEDURE DIVISION.', body, '           GOBACK.', '',
].join('\n');

test('a name nothing declares is one finding per program, naming each name and where it is used', () => {
  const root = tree({ 'P.cbl': prog('P', '       01 WS-A PIC 9(4).',
    ['           ADD WS-A TO WS-CUSTOMER-TOTAL', '           DISPLAY WS-CUSTOMER-TOTAL WS-INVENTED'].join('\n')) });
  const r = scanCompile(root);
  assert.equal(r.findings.length, 1);
  const f = r.findings[0];
  assert.equal(f.rule, 'compile-undefined-name');
  assert.equal(f.line, 8, 'at the first use');
  assert.deepEqual(f.names, ['WS-CUSTOMER-TOTAL', 'WS-INVENTED']);
  assert.match(f.detail, /^P uses 2 name\(s\) .* WS-CUSTOMER-TOTAL \(line 8\), WS-INVENTED \(line 9\)$/);
  assert.equal(f.sev, 'med');
  assert.equal(f.evidence, 'construct');
  assert.equal(f.cwe, 'CWE-1127');
  assert.equal(r.summary.coverageIncomplete, false);
});

test('a long list is cut to five names and a count', () => {
  const names = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7'].map((n) => `WS-${n}`);
  const r = scanCompile(tree({ 'P.cbl': prog('P', '       01 WS-A PIC 9.', names.map((n) => `           MOVE WS-A TO ${n}`).join('\n')) }));
  assert.match(r.findings[0].detail, /uses 7 name\(s\).*WS-N5 \(line \d+\), and 2 more$/);
  assert.equal(r.findings[0].related.length, 7);
});

test('names the language, CICS, IMS and Db2 supply are not undefined', () => {
  const head = [
    '       ENVIRONMENT DIVISION.', '       CONFIGURATION SECTION.', '       SPECIAL-NAMES.',
    '           C01 IS TOP-OF-PAGE', '           UPSI-0 ON STATUS IS SW-ON', "           CLASS HEXIT IS '0' THRU '9' 'A' THRU 'F'.",
    '       INPUT-OUTPUT SECTION.', '       FILE-CONTROL.', '           SELECT RPT ASSIGN TO PRINTER.',
  ].join('\n');
  const ws = [
    '       01 WS-X PIC X(8).', '       01 WS-N PIC 9(4).', '       01 WS-T.', '          05 WS-E PIC X OCCURS 3 INDEXED BY T-IX.',
    '       78 WS-MAX VALUE 3.', '       COPY DFHAID.', '           EXEC SQL INCLUDE SQLCA END-EXEC.',
    '       LINKAGE SECTION.', '       01 DFHCOMMAREA PIC X(10).',
  ].join('\n');
  const body = [
    '       MAIN-PARA.',
    '           IF EIBCALEN = 0 OR EIBAID = DFHENTER CONTINUE END-IF',
    '           IF WS-N = DFHRESP(NOTFND) OR DFHVALUE(ACQUIRED)',
    '               CONTINUE',
    '           END-IF',
    '           IF SQLCODE NOT = 0 OR DIBSTAT = SPACES CONTINUE END-IF',
    '           MOVE LENGTH OF WS-X TO WS-N',
    '           MOVE FUNCTION CURRENT-DATE TO WS-X',
    '           MOVE WHEN-COMPILED TO WS-X',
    '           MOVE WS-MAX TO RETURN-CODE',
    '           SET T-IX TO 1',
    '           IF SW-ON AND WS-X IS HEXIT DISPLAY WS-X UPON CONSOLE END-IF',
    '           PERFORM NEXT-PARA THRU NEXT-EXIT',
    '           OPEN OUTPUT RPT',
    '           CLOSE RPT.',
    '       NEXT-PARA.', '           CONTINUE.', '       NEXT-EXIT.', '           EXIT.',
  ].join('\n');
  const src = prog('P', ws, body, head).replace('       DATA DIVISION.\n       WORKING-STORAGE SECTION.',
    '       DATA DIVISION.\n       FILE SECTION.\n       FD RPT.\n       01 RPT-LINE PIC X(80).\n       WORKING-STORAGE SECTION.');
  const r = scanCompile(tree({ 'P.cbl': src }));
  assert.deepEqual(r.findings.map((f) => f.detail), []);
  assert.equal(r.summary.programsUndecided, 0, 'DFHAID and SQLCA declare only what is already supplied');
});

// The SQLCA is the precompiler's; a program with no SQL has none.
test('SQLCODE counts as declared only in a program that uses SQL', () => {
  const r = scanCompile(tree({ 'P.cbl': prog('P', '       01 WS-A PIC 9.', '           IF SQLCODE = 0 CONTINUE END-IF') }));
  assert.deepEqual(r.findings.map((f) => f.names), [['SQLCODE']]);
});

test('with a copybook missing, the program is undecided and counted, not reported', () => {
  const root = tree({ 'P.cbl': prog('P', '       COPY CUSTREC.', '           MOVE SPACES TO CUST-NAME') });
  const r = scanCompile(root);
  assert.deepEqual(r.findings, []);
  assert.equal(r.summary.programsUndecided, 1);
  assert.deepEqual(r.summary.undecidedBecause, { 'a copybook it includes is not in the tree': 1 });
  assert.equal(r.summary.coverageIncomplete, true, 'a clean result over a tree with a copybook missing does not read as whole');
  assert.match(r.summary.readInPart, /^1 program\(s\) use names/);
});

test('a system copybook whose names are not known leaves the program undecided', () => {
  const r = scanCompile(tree({ 'P.cbl': prog('P', '       COPY CMQV.', '           MOVE MQCC-OK TO RETURN-CODE') }));
  assert.deepEqual(r.findings, []);
  assert.equal(r.summary.programsUndecided, 1);
});

test('a nested program sees what the program containing it declares', () => {
  const src = [
    '       IDENTIFICATION DIVISION.', '       PROGRAM-ID. OUTER.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
    '       01 WS-SHARED PIC X(4) GLOBAL.', '       PROCEDURE DIVISION.', '           CALL "INNER"', '           GOBACK.',
    '       IDENTIFICATION DIVISION.', '       PROGRAM-ID. INNER.', '       PROCEDURE DIVISION.', '           MOVE SPACES TO WS-SHARED',
    '           GOBACK.', '       END PROGRAM INNER.', '       END PROGRAM OUTER.', '',
  ].join('\n');
  const r = scanCompile(tree({ 'P.cbl': src }));
  assert.deepEqual(r.findings, []);
  assert.equal(r.summary.programsUndecided, 0, 'decided, not merely excused by the text');
});

// Micro Focus declares an ASSIGN operand that no item declares.
test('an ASSIGN operand counts as declared', () => {
  const src = prog('P', '', "           MOVE 'x.dat' TO WS-FILE-NAME", [
    '       ENVIRONMENT DIVISION.', '       INPUT-OUTPUT SECTION.', '       FILE-CONTROL.', '           SELECT F ASSIGN TO DISK WS-FILE-NAME.',
  ].join('\n')).replace('       WORKING-STORAGE SECTION.', '       FILE SECTION.\n       FD F.\n       01 F-REC PIC X.\n       WORKING-STORAGE SECTION.');
  assert.deepEqual(scanCompile(tree({ 'P.cbl': src })).findings, []);
});

// Columns 73 to 80 are not code, so a period past column 72 is lost and the next entry is read as
// part of this one. The compiler reads the same columns; what it would report is not this rule's.
test('a declaration the text holds and the parse missed is undecided, not reported', () => {
  const ws = ['       01 WS-TOTALS.',
    '           05  WS-ORDER-COUNT            PIC 9(9) COMP-3 VALUE ZERO.',
    '           05  WS-ORDER-TOTAL            PIC S9(11)V99 COMP-3 VALUE ZERO.',
    '           05  WS-ORDER-LIMIT            PIC S9(11)V99 COMP-3.'].join('\n');
  const r = scanCompile(tree({ 'P.cbl': prog('P', ws, '           MOVE WS-ORDER-LIMIT TO WS-ORDER-COUNT') }));
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.summary.undecidedBecause, { 'the parse missed a declaration the text holds': 1 });
});

test('a paragraph header with no period before it declares nothing, and the program is reported', () => {
  const body = (end) => ['       MAIN-PARA.', '           PERFORM 9000-RETURN', '           GOBACK.',
    '           MOVE ZERO TO WS-A', `           MOVE WS-A TO WS-B${end}`, '      *', '       9000-RETURN.', '           DISPLAY WS-A.'].join('\n');
  const ws = '       01 WS-A PIC 9.\n       01 WS-B PIC 9.';
  const r = scanCompile(tree({ 'P.cbl': prog('P', ws, body('')), 'Q.cbl': prog('Q', ws, body('.')) }));
  assert.deepEqual(r.findings.map((f) => [f.path, f.names]), [['P.cbl', ['9000-RETURN']]]);
  assert.equal(r.summary.programsUndecided, 0);
});

test('another copybook answering to a name the program copies may be the one its build finds', () => {
  const root = tree({
    'app/P.cbl': prog('P', '       COPY REC.', '           MOVE SPACES TO REC-ZOS-ONLY'),
    'app/REC.cpy': '       01 REC.\n          05 REC-COMMON PIC X.\n',
    'zos/REC.cpy': '       01 REC.\n          05 REC-COMMON PIC X.\n          05 REC-ZOS-ONLY PIC X.\n',
  });
  const r = scanCompile(root);
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.summary.undecidedBecause, { 'another copybook of a name it copies declares them': 1 });
});

test('an include the parser does not expand leaves the program undecided', () => {
  const r = scanCompile(tree({ 'P.cbl': prog('P', '       01 WS-A PIC X.', '           ++INCLUDE PROCS\n           PERFORM FROM-PROCS') }));
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.summary.undecidedBecause, { 'it includes source the parser does not expand': 1 });
});

test('INCLUDE opening a sentence is a COPY: its member is read, and a missing one is a missing copybook', () => {
  const missing = scanCompile(tree({ 'P.cbl': prog('P', '       01 WS-A PIC X.', '           INCLUDE PROCS.\n           PERFORM FROM-PROCS') }));
  assert.deepEqual(missing.findings, []);
  assert.deepEqual(missing.summary.undecidedBecause, { 'a copybook it includes is not in the tree': 1 });
  const found = scanCompile(tree({ 'P.cbl': prog('P', '       01 WS-A PIC X.', '           INCLUDE PROCS.'),
    'PROCS.cpy': '       FROM-PROCS.\n           MOVE "A" TO WS-A.\n' }));
  assert.deepEqual(found.findings, []);
  assert.deepEqual(found.summary.undecidedBecause || {}, {});
});

test('the names a CD\'s clauses declare are declared, and the program is decided', () => {
  const src = ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. P.', '       DATA DIVISION.', '       COMMUNICATION SECTION.',
    '       CD IN-CD FOR INPUT', '           SYMBOLIC QUEUE IS IN-Q  STATUS KEY IS IN-STAT.', '       PROCEDURE DIVISION.',
    '           MOVE "ORDERS" TO IN-Q', '           DISPLAY IN-STAT WS-INVENTED', '           STOP RUN.', ''].join('\n');
  const r = scanCompile(tree({ 'P.cbl': src }));
  assert.deepEqual(r.findings.filter((f) => f.rule === 'compile-undefined-name').map((f) => f.names), [['WS-INVENTED']]);
  assert.equal(r.summary.programsUndecided, 0);
});

test('a compiler listing kept as a program is not read as one', () => {
  const listing = ['1PP 5655-EC6 IBM Enterprise COBOL for z/OS  6.3.0 P220314       IC102A    Date 06/04/2022  Page 1',
    '   000001         000100 IDENTIFICATION DIVISION.', '   000002         000200 PROGRAM-ID. IC102A.',
    '   000003         000300 PROCEDURE DIVISION.', '   000004         000400     MOVE HEADER TO THE-LINE.', ''].join('\n');
  const r = scanCompile(tree({ 'IC102A.cbl': listing }));
  assert.deepEqual(r.findings, []);
  assert.equal(r.summary.listingsSkipped, 1);
});

test('the rule is a construct defect, never informational', () => {
  const r = COMPILE_RULES['compile-undefined-name'];
  assert.equal(r.sev, 'med');
  assert.equal(r.evidence, 'construct');
  assert.equal(r.cwe, 'CWE-1127');
  assert.equal(r.text, 'A program uses names that nothing it declares or copies defines, so it cannot compile');
  // A construct defect carries what it lets someone do and the standard fix.
  assert.equal(typeof r.impact, 'string');
  assert.equal(typeof r.remedy, 'string');
});
