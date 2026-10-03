// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseListing } from '../diag/hlasm-oracle.mjs';
import './pin-machine.mjs';

// z390 1.8.4.4 with `xref printall`, on a program written for this test: a SAVE macro call, a COPY
// member, a continued DC, an addressing error and a DSECT.
const PRN = `AZ390I options = sysmac(+/tmp/z390/z390_1.8.4.4/mac+/tmp/hlo-test/lib) ..  syscpy(+/tmp/z390/z390_1.8.4.4/mac+/tmp/hlo-test/lib) xref printall
External Symbol Definitions
 ESD=0001 LOC=00000000 LEN=00001018 TYPE=CST NAME=TESTP
Assembler Listing
000000                                        (1/1)1 TESTP    CSECT
000000                                        (1/2)2          USING TESTP,12
LISTUSE TESTP    ESD=0001 LOC=00000000 LEN=01000 REG=C OFF=00000 LAB=
000000                                        (1/3)3          SAVE  (14,12)
000000 90ECD00C                              (3/63)4+         STM   14,12,12+4*(14-14)(13)
000004                         001014         (1/4)6          LA    1,FAR
AZ390E error 144         (1/4)6            LA    1,FAR
AZ390I no base register found
000008                                        (1/5)7          COPY  INCL
000008                                        (2/1)8=INCL     DS    CL4
00000C D6D5C540E3E6D6                         (1/7)9 TEXT     DC    C'ONE ',C'TWO'
000013                                       (1/8)10          DS    XL4096
001014                                       (1/9)11 FAR      DS    F
000000                                      (1/10)12 WORK     DSECT
000000                                      (1/11)13 W1       DS    H
000002                                      (1/12)14          END
.Symbol Table Listing.
 SYM=FAR      LOC=00001014 LEN=00000004 ESD=0001 TYPE=REL  XREF=11 6
 SYM=INCL     LOC=00000008 LEN=00000004 ESD=0001 TYPE=REL  XREF=8
 SYM=TESTP    LOC=00000000 LEN=00001018 ESD=0001 TYPE=CST  XREF=1 2
 SYM=TEXT     LOC=0000000C LEN=00000004 ESD=0001 TYPE=REL  XREF=9
 SYM=W1       LOC=00000000 LEN=00000002 ESD=0002 TYPE=REL  XREF=13
 SYM=WORK     LOC=00000000 LEN=00000008 ESD=0002 TYPE=DST  XREF=12
.Literal Table Listing.

AZ390I FID=  1 ERR=   1 /private/tmp/hlo-test/T.MLC
AZ390I total az390 errors   = 1
`;

test('reads the ESD', () => {
  assert.deepEqual(parseListing(PRN).esd, [{ id: 1, loc: 0, len: 0x1018, type: 'CST', name: 'TESTP' }]);
});

test('reads each listed statement with its position, and marks macro and copy lines generated', () => {
  const { statements } = parseListing(PRN);
  assert.equal(statements.length, 13);
  assert.deepEqual(statements[2], { stmt: 3, loc: 0, obj: '', file: 1, line: 3, generated: false, source: '         SAVE  (14,12)' });
  assert.deepEqual(statements[3], { stmt: 4, loc: 0, obj: '90ECD00C', file: 3, line: 63, generated: true, source: '         STM   14,12,12+4*(14-14)(13)' });
  const copied = statements.find((s) => s.stmt === 8);
  assert.equal(copied.file, 2);
  assert.equal(copied.generated, true);
  assert.equal(copied.source, 'INCL     DS    CL4');
  const text = statements.find((s) => s.stmt === 9);
  assert.equal(text.line, 7, 'a continued statement is listed at its last card');
  assert.equal(text.obj, 'D6D5C540E3E6D6');
  assert.equal(statements.find((s) => s.stmt === 6).obj, '', 'an address column is not object code');
  assert.equal(statements.find((s) => s.stmt === 12).line, 10);
});

test('reads the symbol table, the defining statement first in XREF', () => {
  const { symbols } = parseListing(PRN);
  assert.equal(symbols.length, 6);
  assert.deepEqual(symbols[0], { name: 'FAR', loc: 0x1014, len: 4, esd: 1, type: 'REL', xref: [11, 6] });
  assert.deepEqual(symbols.find((s) => s.name === 'WORK'), { name: 'WORK', loc: 0, len: 8, esd: 2, type: 'DST', xref: [12] });
});

test('takes an error\'s text from the AZ390I line after it', () => {
  assert.deepEqual(parseListing(PRN).errors, [{ tool: 'AZ', number: 144, file: 1, line: 4, stmt: 6, text: 'no base register found' }]);
});

test('reads macro-phase errors from console output, and a listing without END as unfinished', () => {
  const console = `MZ390E error 101         (1/7)7 missing copy  = NOPE
AZ390E error  29       (1/11)14            MISSING A=1
AZ390I ERRSUM missing macro = MISSING
AZ390E ERRSUM total missing   macro  files =1`;
  const { errors, end } = parseListing(console);
  assert.deepEqual(errors, [
    { tool: 'MZ', number: 101, file: 1, line: 7, stmt: 7, text: 'missing copy  = NOPE' },
    { tool: 'AZ', number: 29, file: 1, line: 11, stmt: 14, text: 'MISSING A=1' },
  ]);
  assert.equal(end, false);
  assert.equal(parseListing(PRN).end, true);
  assert.equal(parseListing(PRN.slice(0, PRN.indexOf('000002 '))).end, false);
});

test('tells a finished listing from one cut short by an abort', () => {
  assert.equal(parseListing(PRN).finished, true);
  assert.equal(parseListing(PRN).aborted, false);
  assert.equal(parseListing(PRN.slice(0, PRN.indexOf('.Symbol Table'))).finished, false);
  const cut = parseListing(`AZ390E abort 49 on line 102          DC    A(NOSYM100)
AZ390I max errors exceeded`);
  assert.equal(cut.aborted, true);
  assert.deepEqual(cut.errors, [{ tool: 'AZ', number: 49, file: null, line: null, stmt: null, text: 'abort: on line 102          DC    A(NOSYM100)' }]);
  const truncated = parseListing(`000000                                        (2/1)5+* MZ390E abort 134 file=2 line=1 unbalanced macro mend in BROKEN
AZ390E error 165         (2/1)5   * MZ390E abort 134 file=2 line=1 unbalanced macro mend in BROKEN
AZ390I input truncated due to mz390 abort
.Symbol Table Listing.`);
  assert.equal(truncated.finished, true);
  assert.equal(truncated.aborted, true);
  assert.deepEqual(truncated.errors, [{ tool: 'AZ', number: 165, file: 2, line: 1, stmt: 5, text: 'input truncated due to mz390 abort' }]);
});
