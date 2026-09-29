// Two ways input from outside decides what a program does with numbers: a decimal operand holding
// bytes that are not digits abends the arithmetic that reads it, and a loop bound walks a counter
// past the table it subscripts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../lib/sets/flow.mjs';
import { parseFile } from '../lib/parser.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'numeric');
const report = scan(FIXTURES);
const of = (file, kind) => report.findings.filter((f) => f.path === file && f.rule.endsWith(`-to-${kind}`));

test('terminal input moved into a zoned field and computed with is reported at the arithmetic', () => {
  const [f, ...rest] = of('ARITH.cbl', 'arithmetic');
  assert.equal(rest.length, 0);
  assert.equal(f.rule, 'cics-terminal-to-arithmetic');
  assert.equal(f.sev, 'med');
  assert.equal(f.cwe, 'CWE-1287');
  assert.equal(f.line, 14);
  assert.match(f.detail, /WS-QTY \(PIC 9\(5\)\) is an operand of COMPUTE/);
});

test('a numeric class test that returns before the arithmetic stops the route', () => {
  assert.deepEqual(of('CHECKED.cbl', 'arithmetic'), []);
  const [c] = report.checked.filter((f) => f.path === 'CHECKED.cbl');
  assert.equal(c.rule, 'cics-terminal-to-arithmetic');
  assert.equal(c.guard.line, 11);
});

test('a number the program computed or counted from the input is not the input', () => {
  assert.deepEqual(of('CONVERT.cbl', 'arithmetic'), []);
  assert.deepEqual(of('TALLY.cbl', 'arithmetic'), []);
});

test('a packed field laid over the input is an operand too, and NUMPROC(PFD) is named', () => {
  const [f] = of('PACKED.cbl', 'arithmetic');
  assert.equal(f.rule, 'cics-terminal-to-arithmetic');
  assert.match(f.detail, /WS-AMOUNT \(PIC S9\(7\)V99 COMP-3\) is an operand of MULTIPLY, compiled NUMPROC\(PFD\)/);
});

test('the parser keeps each counter a PERFORM varies with the condition that stops it', () => {
  const [p] = parseFile(join(FIXTURES, 'LOOPWORDS.cbl')).programs;
  const perform = p.statements.find((s) => s.verb === 'PERFORM');
  assert.deepEqual(perform.loops.map((l) => [l.counter.u, l.until.map((t) => t.v).join(' ')]), [
    ['WS-I', 'WS-I GREATER THAN OR EQUAL TO WS-ROWS-WANTED'],
    ['WS-J', 'WS-J > WS-COLS-WANTED'],
  ]);
});

test('input deciding where a subscripting counter stops is reported at the PERFORM', () => {
  const [f, ...rest] = of('LOOPN.cbl', 'loop-bound');
  assert.equal(rest.length, 0);
  assert.equal(f.rule, 'cics-terminal-to-loop-bound');
  assert.equal(f.sev, 'high');
  assert.equal(f.cwe, 'CWE-129');
  assert.equal(f.line, 15);
  assert.match(f.detail, /WS-COUNT decides where PERFORM VARYING WS-I stops, and WS-I subscripts WS-ROW, a table of 10/);
});

test('a loop that stops at a constant is quiet, whatever was typed', () => {
  assert.deepEqual(of('LOOPMAX.cbl', 'loop-bound'), []);
});

test('every counter of a nested PERFORM is followed, however its relation is spelled', () => {
  const [words, ...more] = of('LOOPWORDS.cbl', 'loop-bound');
  assert.equal(more.length, 0, 'two bounds on one statement are one thing to fix');
  assert.match(words.detail, /WS-(ROWS|COLS)-WANTED decides/);
  const [after] = of('LOOPAFTER.cbl', 'loop-bound');
  assert.match(after.detail, /WS-COLS-WANTED decides where PERFORM VARYING WS-J stops/, 'the AFTER counter has a bound of its own');
});
