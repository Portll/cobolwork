// What the generated code does that the source does not say. Each rule reads an option the program
// is compiled with, so the fixtures differ by a CBL card, and the near-miss beside each positive is
// the same statement under the option that makes it safe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSemantics, SEMANTICS_RULES, placesOf } from '../lib/sets/semantics.mjs';
import { ebcdicByte } from '../lib/sources.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'semantics');
const report = scanSemantics(FIXTURES);
const of = (file) => report.findings.filter((f) => f.path === file).map((f) => [f.rule, f.line]).sort();

test('a narrowing store into a binary field under TRUNC(OPT) is reported, and a native or wide one is not', () => {
  assert.deepEqual(of('TRUNCMOVE.cbl'), [
    ['binary-store-exceeds-picture-under-trunc-opt', 12],
    ['binary-store-exceeds-picture-under-trunc-opt', 15],
  ]);
  const f = report.findings.find((x) => x.path === 'TRUNCMOVE.cbl' && x.line === 12);
  assert.match(f.detail, /WS-COUNT \(S9\(4\) COMP, 4 integer digits\) a value with up to 9 integer digits/);
  assert.match(f.detail, /TRUNC\(OPT\) set by the CBL statement at line 1/);
  assert.match(f.detail, /assumption C2/);
});

test('the same store under TRUNC(STD), or where no level says TRUNC, is not reported', () => {
  assert.deepEqual(of('TRUNCSTD.cbl'), []);
  assert.deepEqual(of('TRUNCNONE.cbl'), []);
  assert.equal(report.summary.truncOptPrograms, 2);
});

test('an increment is not a value the field grows past; an operand or product wider than it is', () => {
  // ADD 1 TO a counter carries a digit in IBM's intermediate, and reporting that would report every
  // counter in batch COBOL. ON SIZE ERROR is the program saying what happens when it does not fit.
  assert.deepEqual(of('TRUNCARITH.cbl'), [
    ['binary-store-exceeds-picture-under-trunc-opt', 12],
    ['binary-store-exceeds-picture-under-trunc-opt', 16],
  ]);
});

test('an intermediate wider than ARITH(COMPAT) carries is reported, and ARITH(EXTEND) carries it', () => {
  assert.deepEqual(of('INTCOMPAT.cbl'), [['intermediate-result-loses-high-order-digits', 12]]);
  const f = report.findings.find((x) => x.path === 'INTCOMPAT.cbl');
  assert.match(f.detail, /a product in this COMPUTE has 29 integer and 4 decimal places/);
  assert.match(f.detail, /carries 30 digits and keeps 28 integer places/);
  assert.match(f.detail, /IBM's default: no level this set reads sets ARITH/);
  assert.match(f.detail, /assumption C1/);
  assert.deepEqual(of('INTEXTEND.cbl'), []);
});

test('an item wider than 18 digits implies ARITH(EXTEND); one wider than 31 is not Enterprise COBOL', () => {
  assert.deepEqual(of('INTWIDE.cbl'), [['intermediate-result-loses-high-order-digits', 12]]);
  assert.match(report.findings.find((x) => x.path === 'INTWIDE.cbl').detail, /ARITH\(EXTEND\) \(which its 31-digit item needs/);
  assert.deepEqual(of('INTGNU.cbl'), []);
  assert.equal(report.summary.beyondEnterprisePrograms, 1);
});

test('a COMPUTE with a function, or in a program Enterprise COBOL would refuse, is counted as unread', () => {
  assert.equal(report.summary.computesUnread, 3);
});

test('a range reversed between EBCDIC and ASCII is reported where it is written; one in order in both is not', () => {
  assert.deepEqual(of('RANGES.cbl'), [
    ['character-range-reverses-in-ascii', 11],
    ['character-range-reverses-in-ascii', 6],
  ].sort());
  const f = report.findings.find((x) => x.path === 'RANGES.cbl' && x.line === 6);
  assert.match(f.detail, /88 CODE-ALNUM 'A' THRU '9' is in order in EBCDIC and reversed in ASCII, so it is empty under an ASCII collating sequence/);
});

test('a program that names its own collating sequence is left to it', () => {
  assert.deepEqual(of('COLLSEQ.cbl'), []);
  assert.equal(report.summary.collatingDeclaredPrograms, 1);
});

test('PICTURE places count P scaling, and anything but a fixed-point number is not one', () => {
  assert.deepEqual(placesOf('S9(15)V99'), { int: 15, dec: 2 });
  assert.deepEqual(placesOf('9(3)PP'), { int: 5, dec: 0 });
  assert.deepEqual(placesOf('VPP99'), { int: 0, dec: 4 });
  assert.equal(placesOf('X(4)'), null);
  assert.equal(placesOf('ZZ9.99'), null);
});

test('EBCDIC positions come from the code page table, and a character the pages disagree on has none', () => {
  assert.equal(ebcdicByte('A'), 0xC1);
  assert.equal(ebcdicByte('a'), 0x81);
  assert.equal(ebcdicByte('0'), 0xF0);
  assert.equal(ebcdicByte(' '), 0x40);
  assert.equal(ebcdicByte('['), null);
});

test('every rule carries a CWE and says what it rests on', () => {
  assert.equal(SEMANTICS_RULES['binary-store-exceeds-picture-under-trunc-opt'].cwe, 'CWE-758');
  assert.equal(SEMANTICS_RULES['intermediate-result-loses-high-order-digits'].cwe, 'CWE-197');
  assert.equal(SEMANTICS_RULES['character-range-reverses-in-ascii'].cwe, 'CWE-474');
  assert.match(SEMANTICS_RULES['intermediate-result-loses-high-order-digits'].impact, /ironwork's model/);
});
