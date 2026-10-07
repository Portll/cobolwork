import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytesOf, parseIbmListing, sourceText, unexpandedCopies } from '../diag/ibm-listing.mjs';
import './pin-machine.mjs';

const LISTING_6 = [
  '1PP 5655-EC6 IBM Enterprise COBOL for z/OS  6.4.0 P231130            Date 10/07/2026  Time 09:00:00   Page     1',
  '0Options in effect:',
  '    ARCH(10)',
  '    ARITH(COMPAT)',
  '  NOCICS',
  '0',
  '1PP 5655-EC6 IBM Enterprise COBOL for z/OS  6.4.0 P231130  DECK      Date 10/07/2026  Time 09:00:00   Page     2',
  '0  LineID  PL SL  ----+-*A-1-B--+----2----+----3----+----4----+----5----+----6----+----7-|--+----8 Map and Cross Reference',
  '   000001         000100 IDENTIFICATION DIVISION.                                        00000100',
  "   000002         000200 PROGRAM-ID. 'DECK'.                                             00000200",
  '   000003         000300 DATA DIVISION.                                                  00000300',
  '   000004         000400 WORKING-STORAGE SECTION.                                        00000400',
  '   000005         000500 01  REC.                                                        00000500',
  '   000006         000600     COPY RECBODY REPLACING ==:P:== BY ==R==.                    00000600',
  '   000007C        000010     05  R-NAME  PIC X(8).                                       00000010',
  '   000008C        000020     05  R-COUNT PIC S9(4) COMP.                                 00000020',
  '   000009         000700 PROCEDURE DIVISION.                                             00000700',
  '   000010         000800     GOBACK.                                                     00000800',
  '==000008==> IGYPS2121-S "R-COUNT" was not defined as a data-name.',
  '0Data Division Map',
  '0Source   Hierarchy and                                    Base      Displacement  Asmblr Data                      Data Def',
  ' LineID   Data Name                                        Locator     Structure   Definition        Data Type      Attributes',
  '      2  PROGRAM-ID DECK--------------------------------------------------------------------------------------------------*',
  '      5   1  REC . . . . . . . . . . . . . . . . . . . . .             000000000   DS 0CL10          Group',
  '      7     2  R-NAME. . . . . . . . . . . . . . . . . . .             000000000   DS 8C             Display',
  '      8     2  R-COUNT . . . . . . . . . . . . . . . . . .             000000008   DS 2C             Binary         G',
  '      9     88 R-SET . . . . . . . . . . . . . . . . . . .',
  ' End of Data Division Map',
  '0LineID  Message code  Message text',
  '',
  '      8  IGYPS2121-S   "R-COUNT" was not defined as a data-name.  The',
  '                       statement was discarded.',
  '-Messages    Total    Informational    Warning    Error    Severe    Terminating',
  '0Printed:       1                                              1',
  '0End of compilation 1,  program DECK,  highest severity 12.',
  '0Return code 12',
  '',
].join('\n');

const LISTING_4 = [
  'PP 5655-S71 IBM Enterprise COBOL for z/OS  4.2.0               Date 03/29/2019  Time 08:18:27   Page     1',
  '  LineID  PL SL  ----+-*A-1-B--+----2----+----3----+----4----+----5----+----6----+----7-|--+----8 Map and Cross Reference',
  '  000001         000010 IDENTIFICATION DIVISION.',
  '  000002         000020 PROGRAM-ID. MAT510.',
  'Data Division Map',
  'Source   Hierarchy and                                    Base       Hex-Displacement  Asmblr Data                    Data Def',
  'LineID   Data Name                                        Locator    Blk   Structure   Definition      Data Type      Attributes',
  '     2  PROGRAM-ID MAT510------------------------------------------------------------------------------------------------------*',
  '     6   1  TMAT5110. . . . . . . . . . . . . . . . . . . BLW=00000  000               DS 8C           Display',
  '    18   1  MAT511-AREA . . . . . . . . . . . . . . . . . BLW=00000  010               DS 0CL30        Group',
  '    19     2  FILLER. . . . . . . . . . . . . . . . . . . BLW=00000  010   0 000 000   DS 8C           Display',
  '    20     2  MAT511-DATA-LENGTH. . . . . . . . . . . . . BLW=00000  018   0 000 008   DS 4C           Binary',
  '    28       3  MAT511-SUM. . . . . . . . . . . . . . . . BLW=00000  024   0 000 014   DS 10C          Disp-Num',
  'End of Data Division Map',
  'End of compilation 1,  program MAT510,  no statements flagged.',
  'Return code 0',
].join('\n');

test('a 6.x listing yields the compiler, options, source, map, and diagnostics once each', () => {
  const r = parseIbmListing(LISTING_6);
  assert.equal(r.compiler, 'IBM Enterprise COBOL for z/OS 6.4.0 P231130');
  assert.deepEqual(r.options, ['ARCH(10)', 'ARITH(COMPAT)', 'NOCICS']);
  assert.equal(r.returnCode, 12);
  assert.equal(r.units.length, 1);
  const u = r.units[0];
  assert.equal(u.name, 'DECK');
  assert.equal(u.highestSeverity, 'highest severity 12');
  assert.equal(u.source.length, 10);
  assert.deepEqual(u.source.filter((s) => s.copied).map((s) => s.line), [7, 8]);
  assert.equal(u.source[1].card.slice(7, 26), "PROGRAM-ID. 'DECK'.");
  assert.deepEqual(u.map.map((m) => [m.level, m.name, m.displacement, m.bytes, m.type, m.attrs]), [
    [1, 'REC', 0, 10, 'Group', ''],
    [2, 'R-NAME', 0, 8, 'Display', ''],
    [2, 'R-COUNT', 8, 2, 'Binary', 'G'],
    [88, 'R-SET', null, null, null, ''],
  ]);
  assert.deepEqual(u.diagnostics, [{ line: 8, id: 'IGYPS2121-S', severity: 'S', text: '"R-COUNT" was not defined as a data-name.  The statement was discarded.', inline: false }]);
});

test('the source text keeps the expansion and comments out the COPY statement it replaced', () => {
  const text = sourceText(parseIbmListing(LISTING_6).units[0]);
  const lines = text.split('\n');
  assert.equal(lines[5].slice(6, 7), '*');
  assert.match(lines[5], /COPY RECBODY/);
  assert.match(lines[6], /05  R-NAME  PIC X\(8\)\./);
  assert.ok(!/COPY/.test(lines.filter((l) => l[6] !== '*').join('\n')));
});

test('an EXEC SQL INCLUDE expansion comments out the statement and nothing before it', () => {
  const listing = [
    '   LineID  PL SL  ----+-*A-1-B--+----2----+----3----+----4----+----5----+----6----+----7-|--+----8',
    '   000001         000100 IDENTIFICATION DIVISION.',
    '   000002         000200 PROGRAM-ID. SQL1.',
    '   000003         000300 DATA DIVISION.',
    '   000004         000400 WORKING-STORAGE SECTION.',
    '   000005         000500     EXEC SQL',
    '   000006         000600         INCLUDE SQLCA',
    '   000007         000700     END-EXEC.',
    '   000008C        000010 01  SQLCA GLOBAL VOLATILE.',
    '   000009C        000020     05  SQLCAID PIC X(8).',
    '   000010         000800 PROCEDURE DIVISION.',
    'End of compilation 1,  program SQL1,  no statements flagged.',
  ].join('\n');
  const lines = sourceText(parseIbmListing(listing).units[0]).split('\n');
  assert.deepEqual(lines.map((l) => l[6]), [' ', ' ', ' ', ' ', '*', '*', '*', ' ', ' ', ' ', undefined]);
});

test('a page header spliced onto a source line by a form feed does not take the line with it', () => {
  const listing = [
    '   LineID  PL SL  ----+-*A-1-B--+----2----+----3----+----4----+----5----+----6----+----7-|--+----8',
    '   000001         000100 IDENTIFICATION DIVISION.',
    '   000002         000200 PROGRAM-ID. SPLICED.',
    '   000003         000300 DATA DIVISION.',
    '   000004         000400 WORKING-STORAGE SECTION.',
    '   000005         000500 01  EM-TIME PIC X(6).                                              \f1PP 5655-EC6 IBM Enterprise COBOL for z/OS  6.4.0 P231130  SPLICED   Date 10/07/2026  Time 09:00:00   Page     2',
    '   LineID  PL SL  ----+-*A-1-B--+----2----+----3----+----4----+----5----+----6----+----7-|--+----8',
    '   000006         000600 PROCEDURE DIVISION.',
    'End of compilation 1,  program SPLICED,  no statements flagged.',
  ].join('\n');
  for (const text of [listing, listing.replace('\f', '^L')]) {
    const r = parseIbmListing(text);
    assert.equal(r.compiler, 'IBM Enterprise COBOL for z/OS 6.4.0 P231130');
    assert.deepEqual(r.units[0].source.map((s) => s.line), [1, 2, 3, 4, 5, 6]);
    assert.match(r.units[0].source[4].card, /01  EM-TIME PIC X\(6\)\./);
  }
});

test('a COPY or INCLUDE with no expansion after it names an unexpanded member', () => {
  const line = (n, code, copied = false) => '   ' + String(n).padStart(6, '0') + (copied ? 'C' : ' ') + '        ' + String(n * 100).padStart(6, '0') + code;
  const listing = [
    '   LineID  PL SL  ----+-*A-1-B--+----2----+----3----+----4----+----5----+----6----+----7-|--+----8',
    line(1, ' IDENTIFICATION DIVISION.'),
    line(2, ' PROGRAM-ID. GAPS.'),
    line(3, ' DATA DIVISION.'),
    line(4, ' WORKING-STORAGE SECTION.'),
    line(5, '     COPY SHOWN.'),
    line(6, ' 01  A PIC X.', true),
    line(7, '     COPY HIDDEN SUPPRESS.'),
    line(8, '     EXEC SQL'),
    line(9, '         INCLUDE SQLCA'),
    line(10, '     END-EXEC.'),
    line(11, ' 01  SQLCA.', true),
    line(12, '     EXEC SQL INCLUDE LGCMAREA END-EXEC.'),
    line(13, ' PROCEDURE DIVISION.'),
    line(14, '     DISPLAY \x27COPY ME\x27.'),
    'End of compilation 1,  program GAPS,  no statements flagged.',
  ].join('\n');
  assert.deepEqual(unexpandedCopies(parseIbmListing(listing).units[0]), ['HIDDEN', 'LGCMAREA']);
});

test('a 4.2 map gives displacements within the record from the block displacement', () => {
  const u = parseIbmListing(LISTING_4).units[0];
  assert.equal(u.name, 'MAT510');
  assert.deepEqual(u.map.map((m) => [m.level, m.name, m.displacement, m.bytes, m.base]), [
    [1, 'TMAT5110', 0, 8, 'BLW=00000'],
    [1, 'MAT511-AREA', 0, 30, 'BLW=00000'],
    [2, 'FILLER', 0, 8, 'BLW=00000'],
    [2, 'MAT511-DATA-LENGTH', 8, 4, 'BLW=00000'],
    [3, 'MAT511-SUM', 20, 10, 'BLW=00000'],
  ]);
});

test('assembler definitions give byte lengths', () => {
  assert.equal(bytesOf('0CL8194'), 8194);
  assert.equal(bytesOf('255C'), 255);
  assert.equal(bytesOf('5P'), 5);
  assert.equal(bytesOf('1D'), 8);
  assert.equal(bytesOf('2H'), 4);
  assert.equal(bytesOf('X'), null);
});
