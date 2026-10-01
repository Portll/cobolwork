// Abends ironwork's fuzzing kept, read as findings (docs/spec/evidence.md §13.6). The s0c7 run is a
// real `ironwork run --evidence` of the fixture program on a record of asterisks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanAbend, abendRule, ABEND_RULES } from '../lib/sets/abend.mjs';
import { ALL_RULES, RULE_SETS } from '../lib/kernel/registry.mjs';
import { classesOfRule } from '../lib/consequence.mjs';
import './pin-machine.mjs';

const HERE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'abend');
const REPO = join(HERE, 'repo');
const scan = (...runs) => scanAbend(REPO, { abendRuns: runs.map((r) => join(HERE, 'runs', r)) });

test('the abend set is registered, and its rules are execution evidence', () => {
  assert.ok(RULE_SETS.includes('abend'));
  for (const id of Object.keys(ABEND_RULES)) {
    assert.ok(ALL_RULES[id], id);
    assert.equal(ALL_RULES[id].evidence, 'execution', id);
    assert.notEqual(classesOfRule(id), undefined, id);
  }
});

test('no fuzz run named, no finding and nothing short', () => {
  const r = scanAbend(REPO, { abendRuns: [] });
  assert.deepEqual(r.findings, []);
  assert.equal(r.summary.setIncomplete, false);
});

test('a verified run whose journal records the abend is a finding at the line, with the input', () => {
  const r = scan('s0c7');
  assert.equal(r.findings.length, 1);
  const [f] = r.findings;
  assert.equal(f.rule, 'input-causes-abend-s0c7');
  assert.equal(f.sev, 'med');
  assert.equal(f.path, 'ABEND7.cbl');
  assert.equal(f.line, 17);
  assert.deepEqual(f.input, [{ kind: 'dd', name: 'INDD', bytes: 'KioqKiogICAgIAo=', minimized: true }]);
  assert.equal(f.run.journal, '20260930T165601Z-b79adc04b1a0b792');
  assert.deepEqual(r.summary.abendRuns[0].counts, { runs: 12, clean: 11, abend: 1, timeout: 0, refused: 0 });
});

test('an SSRANGE failure ironwork ends with U4038 and an IGZ message is a subscript-range finding', () => {
  const [f, ...rest] = scan('range').findings;
  assert.deepEqual(rest, []);
  assert.equal(f.rule, 'input-causes-abend-subscript-range');
  assert.equal(f.sev, 'high');
  assert.equal(f.path, 'RANGE1.cbl');
  assert.equal(f.line, 13);
  assert.equal(f.abend.code, 'U4038');
});

test('a manifest that puts the abend somewhere its journal does not is not believed', () => {
  const r = scan('moved');
  assert.deepEqual(r.findings, []);
  assert.match(r.summary.abendRunProblems[0], /records the abend at RANGE1\.cbl:13/);
});

test('a journal that does not verify, or does not record the abend claimed, gives no finding', () => {
  for (const run of ['tampered', 'mismatch']) {
    const r = scan(run);
    assert.deepEqual(r.findings, [], run);
    assert.equal(r.summary.setIncomplete, true, run);
    assert.equal(r.summary.abendRunProblems.length, 1, run);
  }
  assert.match(scan('tampered').summary.abendRunProblems[0], /does not verify/);
  assert.match(scan('mismatch').summary.abendRunProblems[0], /does not record the abend S0C4/);
});

test('an abend ironwork raises for what it does not run is counted, never a finding', () => {
  const r = scan('notmodelled');
  assert.deepEqual(r.findings, []);
  assert.equal(r.summary.abendRuns[0].notModelled, 1);
  assert.equal(r.summary.setIncomplete, false);
});

test('a program outside the tree is refused, and one the scanned tree does not hold is set aside', () => {
  assert.match(scan('outside').summary.abendRunProblems[0], /outside the scanned tree/);
  const r = scan('elsewhere');
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.summary.abendRunsElsewhere, ['elsewhere: OTHER.cbl']);
});

test('the abend code and IBM message id choose the rule', () => {
  assert.equal(abendRule({ code: 'S0C7' }), 'input-causes-abend-s0c7');
  assert.equal(abendRule({ code: 'S0C4' }), 'input-causes-abend-s0c4');
  assert.equal(abendRule({ code: 'U4038', message: 'IGZ0006S The reference to table WS-E by verb number 01 was out of range' }), 'input-causes-abend-subscript-range');
  assert.equal(abendRule({ code: 'U4038', message: 'IGZ0072S A reference modification start position was out of range' }), 'input-causes-abend-subscript-range');
  assert.equal(abendRule({ code: 'U4038', message: 'IGZ0073S A reference modification length value of 0 was out of range' }), 'input-causes-abend-subscript-range');
  assert.equal(abendRule({ code: 'U4038', message: 'IGZ0074S A reference modification start position value of 9 and length value of 4 was out of range' }), 'input-causes-abend-subscript-range');
  assert.equal(abendRule({ code: 'U4038', message: 'IGZ0007S The length of group WS-T exceeded its maximum' }), 'input-causes-abend-subscript-range');
  assert.equal(abendRule({ code: 'U4038', message: 'subscript out of range (SSRANGE)' }), 'input-causes-abend');
  assert.equal(abendRule({ code: 'S0CB' }), 'input-causes-abend');
});
