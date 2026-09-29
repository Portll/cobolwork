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

test('an index checked at both ends is bounded, and one checked only above is not', () => {
  assert.deepEqual(found('BOTHENDS.cbl'), []);
  assert.equal(stopped('BOTHENDS.cbl')[0].guard.line, 10);
});

test('a bound an OR can skip has not run, and one whose outcome passes the table bounds nothing', () => {
  const [skipped] = found('CPAREN.cbl');
  assert.equal(skipped.sev, 'high');
  assert.equal(skipped.guard, undefined);
  const [past] = found('CNOTOR.cbl');
  assert.equal(past.sev, 'high');
  assert.equal(past.guard, undefined);
});

// I <= 10 AND T(I) = 'A' OR 'B' groups as (I <= 10 AND T(I) = 'A') OR T(I) = 'B': the second reading runs
// whenever the group is false, I > 10 included, and the bound gives it nothing.
test('an abbreviated relation reads its subject again, and that reading is not bounded', () => {
  const [f] = found('ABBREV.cbl');
  assert.equal(f.sev, 'high');
  assert.equal(f.guardedFrom, undefined);
  assert.deepEqual(stopped('ABBREV.cbl'), []);
});

test('a guarded use in a condition does not hide a later use that is not', () => {
  const f = found('LATERUSE.cbl');
  assert.deepEqual(f.map((x) => [x.line, x.sev, x.guardedFrom]), [[15, 'high', undefined]]);
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

test('a count started at 1 and tallied over fewer bytes than the table has entries is a bound', () => {
  assert.deepEqual(found('TALLY.cbl'), []);
  const [c] = stopped('TALLY.cbl');
  assert.equal(c.rule, 'argv-or-env-to-subscript');
  assert.equal(c.guard.line, 14);
});

test('a tally is no bound where it can be 0 or pass the table or field it indexes', () => {
  for (const file of ['TALCSV.cbl', 'TALZERO.cbl', 'TALLYREV.cbl']) {
    const [f] = found(file);
    assert.equal(f.sev, 'high', file);
    assert.equal(stopped(file).length, 0, file);
  }
});

test('a tally with no known starting value, one NEXT SENTENCE can skip, or one a REDEFINES rewrites, is not bounded', () => {
  for (const file of ['TALLYUNSET.cbl', 'TALLYNEXT.cbl', 'TALREDEF.cbl']) {
    assert.equal(found(file).length, 1, file);
    assert.equal(stopped(file).length, 0, file);
  }
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

// Every way into code the graph once lacked, each found by reading the branch adversarially.
test('code a run can reach is never called unreached', () => {
  const cases = {
    'HANDSECT.cbl': 'a HANDLE CONDITION label falls to the end of a performed section, so the PERFORM returns',
    'HANDTHRU.cbl': 'the same inside a PERFORM THRU range',
    'HANDABND.cbl': 'a HANDLE ABEND label does the same after an EXEC CICS ABEND',
    'DECLSTOP.cbl': 'a run starts after END DECLARATIVES, whatever the declaratives end with',
    'DECLGOBK.cbl': 'the same with no section after the declaratives',
    'ATENDIF.cbl': 'NOT AT END after an IF whose branches both leave',
    'ONEXCP.cbl': 'NOT ON EXCEPTION after an EXEC CICS RETURN',
    'IGNCOND.cbl': 'an XCTL that fails returns once IGNORE CONDITION has run',
    'CEEDMP.cbl': 'CEE3DMP dumps and returns',
    'ALTERED.cbl': 'ALTER sends a GO TO somewhere else',
  };
  for (const [file, why] of Object.entries(cases)) {
    const f = found(file);
    assert.equal(f.length, 1, file);
    assert.equal(f[0].sev, 'high', `${file}: ${why}`);
    assert.equal(f[0].unreached, undefined, `${file}: ${why}`);
  }
});

test('the least-checked use of an arithmetic operand is reported, not the first one reached', () => {
  const f = report.findings.filter((x) => x.path === 'ARITH.cbl');
  assert.deepEqual(f.map((x) => [x.rule, x.line, x.guardedFrom]), [['argv-or-env-to-arithmetic', 19, 'low']]);
  assert.deepEqual(report.checked.filter((x) => x.path === 'ARITH.cbl'), []);
});

test('a flag is no bound where its value is written another way or compares otherwise than it reads', () => {
  const cases = {
    'FLGROUP.cbl': 'the flag is rewritten through an 01 REDEFINES of its record',
    'FLNUMLIT.cbl': "PIC 99 set to 1 holds 01, which is not the literal '1'",
    'FLJUST.cbl': "a JUSTIFIED RIGHT PIC XX set to 'Y' holds ' Y'",
  };
  for (const [file, why] of Object.entries(cases)) {
    assert.equal(found(file).length, 1, `${file}: ${why}`);
    assert.equal(stopped(file).length, 0, `${file}: ${why}`);
  }
});

test('rejecting zero by equality is a lower bound only for an unsigned integer', () => {
  assert.deepEqual(found('ZEROUNS.cbl'), []);
  assert.equal(stopped('ZEROUNS.cbl').length, 1);
  assert.equal(found('ZEROSIGN.cbl').length, 1, 'a signed field may be negative');
  assert.equal(found('ZEROALPHA.cbl').length, 1, "PIC X holds text, and '0' is not a number");
});

test('an error flag set on zero and on a high value bounds the index where it is off', () => {
  assert.deepEqual(found('ZEROFLAG.cbl'), []);
  assert.equal(stopped('ZEROFLAG.cbl').length, 1);
});

// A counter that starts at a constant and steps up is at least that constant in the loop body,
// unless the body writes it or the start is below 1 or the step does not rise.
test('a counter varied from 1 by 1 is bounded at both ends inside its loop', () => {
  assert.deepEqual(found('LOOPFROM.cbl'), []);
  assert.equal(stopped('LOOPFROM.cbl').length, 1);
});

test('a counter the loop body also fills from input is not bounded below', () => {
  assert.equal(found('LOOPMOVE.cbl').length, 1);
});

test('a counter varied from 0, or downwards, is not bounded below', () => {
  assert.equal(found('LOOPZERO.cbl').length, 1);
  assert.equal(found('LOOPBYNEG.cbl').length, 1);
});
