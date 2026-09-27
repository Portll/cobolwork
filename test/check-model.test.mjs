// What counts as a check on an index (docs/spec/build-gate.md §11e): an earlier operand of the same
// condition, a flag a failed bound sets, the length an INSPECT tallies over, and a sink no route
// reaches, which asserts no defect. Each is credited where it holds on every route and nowhere else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../lib/sets/flow.mjs';
import { classesOf } from '../lib/consequence.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'check-model');
const report = scan(FIXTURES);
const BOUNDS = /-to-(subscript|reference-modification)$/;
const found = (file) => report.findings.filter((f) => f.path === file && BOUNDS.test(f.rule));
const stopped = (file) => report.checked.filter((f) => f.path === file && BOUNDS.test(f.rule));

test('a subscript behind AND is read only once the bound before it held', () => {
  assert.deepEqual(found('ANDGUARD.cbl'), []);
  const [c] = stopped('ANDGUARD.cbl');
  assert.equal(c.rule, 'argv-or-env-to-subscript');
  assert.equal(c.guard.line, 12);
});

test('a subscript behind OR is read only once the tests before it were false', () => {
  assert.deepEqual(found('ORGUARD.cbl'), []);
  assert.equal(stopped('ORGUARD.cbl').length, 1);
});

test('a subscript read before its bound in the same condition is not credited', () => {
  const [f] = found('ANDLATE.cbl');
  assert.equal(f.rule, 'argv-or-env-to-subscript');
  assert.equal(f.sev, 'high');
  assert.equal(f.guard, undefined);
});

// The bound ran before both readings, so each is lowered a step; only the first is bounded by it.
test('an abbreviated relation reads its subject again, and that reading is not bounded', () => {
  const [f] = found('ABBREV.cbl');
  assert.equal(f.sev, 'med');
  assert.equal(f.guardedFrom, 'high');
  assert.deepEqual(stopped('ABBREV.cbl'), []);
});

test('a guarded use in a condition does not hide a later use that is not', () => {
  const f = found('LATERUSE.cbl');
  assert.deepEqual(f.map((x) => [x.line, x.sev, x.guardedFrom]), [[15, 'med', 'high']]);
  assert.deepEqual(stopped('LATERUSE.cbl'), []);
});

test('a bound that sets a flag holds wherever the flag is tested clear', () => {
  assert.deepEqual(found('FLAGSET.cbl'), []);
  const [c] = stopped('FLAGSET.cbl');
  assert.equal(c.guard.line, 16);
});

test('EVALUATE branches that each set the flag bound the index together', () => {
  assert.deepEqual(found('FLAGEVAL.cbl'), []);
  assert.equal(stopped('FLAGEVAL.cbl').length, 1);
});

test('a flag cleared after the bound says nothing about the index', () => {
  const [f] = found('FLAGRESET.cbl');
  assert.equal(f.rule, 'argv-or-env-to-subscript');
  assert.equal(stopped('FLAGRESET.cbl').length, 0);
});

test('an index written after the bound is not covered by the flag', () => {
  const [f] = found('FLAGMOVED.cbl');
  assert.equal(f.rule, 'argv-or-env-to-subscript');
  assert.equal(stopped('FLAGMOVED.cbl').length, 0);
});

test('a count set to zero and tallied over a field is bounded by its length', () => {
  assert.deepEqual(found('TALLY.cbl'), []);
  const [c] = stopped('TALLY.cbl');
  assert.equal(c.rule, 'argv-or-env-to-reference-modification');
  assert.equal(c.guard.line, 13);
});

test('INITIALIZE starts a count at zero, and a reversed field is as long as the field', () => {
  assert.deepEqual(found('TALLYREV.cbl'), []);
  const [c] = stopped('TALLYREV.cbl');
  assert.equal(c.guard.item, 'WS-BLANKS');
  assert.equal(c.guard.line, 15);
});

test('a tally with no known starting value, or one NEXT SENTENCE can skip, is not bounded', () => {
  assert.equal(found('TALLYUNSET.cbl').length, 1);
  assert.equal(found('TALLYNEXT.cbl').length, 1);
});

test('a sink no route reaches is info, says so, and is in no consequence class', () => {
  const [f] = found('DEADPARA.cbl');
  assert.equal(f.sev, 'info');
  assert.equal(f.unreached, true);
  assert.match(f.detail, /no route from the program's entries reaches DEADPARA\.cbl:15/);
  assert.deepEqual(classesOf(f), []);
});

test('a dead first use does not stand for a live later one', () => {
  const f = found('DEADFIRST.cbl');
  assert.deepEqual(f.map((x) => [x.line, x.sev, x.unreached]), [[17, 'high', undefined]]);
});

test('code past EXIT PROGRAM, a SORT input procedure and a NOT AT END phrase is reached', () => {
  for (const file of ['EXITPGM.cbl', 'SORTPROC.cbl', 'NOTATEND.cbl']) {
    const [f] = found(file);
    assert.equal(f.sev, 'high', file);
    assert.equal(f.unreached, undefined, file);
  }
});

test('an XCTL with RESP can come back; one without cannot', () => {
  assert.deepEqual(found('XCTLRESP.cbl').map((f) => [f.rule, f.sev]), [['cics-terminal-to-subscript', 'high']]);
  assert.deepEqual(found('XCTLDONE.cbl').map((f) => [f.rule, f.sev, f.unreached]), [['cics-terminal-to-subscript', 'info', true]]);
});
