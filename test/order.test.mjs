// A check counts where it has run before the value is used, on every route there, and it stops a
// route - rather than lowering it - where what it leaves is safe for the sink. Before statement
// order was read, a check was credited wherever its field was used, and could never clear anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../lib/sets/flow.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'order');
const report = scan(FIXTURES);
const found = (file) => report.findings.filter((f) => f.path === file);
const stopped = (file) => report.checked.filter((f) => f.path === file);

test('a check performed before the paragraph that uses the value runs first, and lowers it', () => {
  const [f] = found('PERFORMED.cbl');
  assert.equal(f.rule, 'argv-or-env-to-os-command');
  assert.equal(f.sev, 'high', 'letters alone can still spell a command, so it is lowered, not stopped');
  assert.equal(f.guard.line, 16);
});

test('the same check performed after the use is not credited, and the finding says where it is', () => {
  const [f] = found('LATE.cbl');
  assert.equal(f.sev, 'crit');
  assert.equal(f.guard, undefined);
  assert.deepEqual(f.checkElsewhere, { program: 'LATE', item: 'WS-IN', file: 'LATE.cbl', line: 15 });
});

test('a buffer tested for one prompt and used for another is used unchecked', () => {
  const [f] = found('PROMPTS.cbl');
  assert.equal(f.sev, 'crit');
  assert.equal(f.guard, undefined);
  assert.equal(f.checkElsewhere.line, 15);
});

test('an EVALUATE that lets two names through and ends the run on the rest stops the route', () => {
  assert.deepEqual(found('ALLOWED.cbl'), []);
  const [c] = stopped('ALLOWED.cbl');
  assert.equal(c.rule, 'argv-or-env-to-os-command');
  assert.equal(c.guard.stops, true);
  assert.equal(c.guard.line, 11);
});

test('the same EVALUATE choosing what else to do is not a check at all', () => {
  const [f] = found('DISPATCH.cbl');
  assert.equal(f.sev, 'crit');
  assert.equal(f.guard, undefined);
  assert.equal(f.checkElsewhere, undefined, 'equality chose a branch; nothing tested the value');
});

test('a check that only sets a flag ran first, and is not read as stopping the value', () => {
  const [f] = found('FLAGGED.cbl');
  assert.equal(f.sev, 'high');
  assert.equal(f.guard.line, 13);
  assert.equal(f.guard.stops, undefined);
});

test('a value asked for until it is numeric is numeric when the loop ends', () => {
  assert.deepEqual(found('RETRY.cbl'), []);
  const [c] = stopped('RETRY.cbl');
  assert.equal(c.rule, 'argv-or-env-to-arithmetic');
  assert.equal(c.sources, 2, 'both ACCEPTs, before the loop and in it');
});

test('a range left by GO TO for its exit returns with the index bounded', () => {
  assert.deepEqual(found('GOEXIT.cbl'), []);
  const [c] = stopped('GOEXIT.cbl');
  assert.equal(c.rule, 'argv-or-env-to-subscript');
  assert.equal(c.guard.line, 18);
});

test('stopped routes are counted apart from findings', () => {
  assert.equal(report.summary.checked, report.checked.length);
  assert.ok(report.checked.every((c) => c.evidence === 'path' && c.guard && c.guard.stops));
});

test('a field refilled with a literal before the use holds the literal, whatever reached it before', () => {
  assert.deepEqual(found('OVERWRITE.cbl'), []);
  const [c] = stopped('OVERWRITE.cbl');
  assert.equal(c.rule, 'argv-or-env-to-os-command');
  assert.equal(c.guard.line, 13, 'the MOVE of the literal is what stops it');
});

test('a length clamped to the field it measures is bounded on every route', () => {
  assert.deepEqual(found('CLAMP.cbl'), []);
  const [c] = stopped('CLAMP.cbl');
  assert.equal(c.rule, 'argv-or-env-to-reference-modification');
});
