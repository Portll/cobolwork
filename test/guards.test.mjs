// A condition that restricts an item on a path is a check. Where it runs before the use on every
// route, the finding says where it is and is lowered one step; where what it leaves is safe for the
// sink, the route is not a finding at all. Every way the check could be credited without covering
// the path keeps full severity: a check on another field, a route around the checked field, and a
// second input that was never checked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../lib/sets/flow.mjs';
import { toSarif } from '../lib/sarif.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'guards');
const report = scan(FIXTURES);
const at = (file) => {
  const f = report.findings.filter(x => x.rule === 'argv-or-env-to-os-command' && x.path === file);
  assert.equal(f.length, 1, `one finding in ${file}`);
  return f[0];
};

test('a path through a checked item is lowered one step and names the check', () => {
  const f = at('GUARDED.cbl');
  assert.equal(f.sev, 'high');
  assert.equal(f.guardedFrom, 'crit');
  assert.equal(f.evidence, 'path', 'a checked path is still a path');
  assert.deepEqual(f.guard, { program: 'GUARDED', item: 'WS-IN', file: 'GUARDED.cbl', line: 9 });
});

test('a check on a different field is not a check on the path', () => {
  const f = at('ELSEWHERE.cbl');
  assert.equal(f.sev, 'crit');
  assert.equal(f.guard, undefined);
});

test('a route around the checked field keeps full severity', () => {
  const f = at('AROUND.cbl');
  assert.equal(f.sev, 'crit');
  assert.equal(f.guard, undefined);
});

test('a sink reached by a checked input and an unchecked one keeps full severity', () => {
  const f = at('TWOWAYS.cbl');
  assert.equal(f.sources, 2);
  assert.equal(f.sev, 'crit');
  assert.equal(f.guard, undefined);
  assert.equal(f.guardedFrom, undefined);
});

test('a test that the input is merely present is not a check', () => {
  const f = at('PRESENCE.cbl');
  assert.equal(f.sev, 'crit');
  assert.equal(f.guard, undefined);
});

test('comparing the input with a value to choose a branch is not a check', () => {
  const f = at('ROUTED.cbl');
  assert.equal(f.sev, 'crit');
  assert.equal(f.guard, undefined);
});

// A condition-name that lists every value the field may take, rejecting the rest before the use,
// leaves a command that can only be one of those literals: the route is stopped, not lowered.
test('a condition-name that turns away everything else stops the route', () => {
  assert.equal(report.findings.filter(x => x.path === 'CONDNAME.cbl').length, 0);
  const [c] = report.checked.filter(x => x.path === 'CONDNAME.cbl');
  assert.equal(c.rule, 'argv-or-env-to-os-command');
  assert.deepEqual(c.guard, { program: 'CONDNAME', item: 'WS-OPT', file: 'CONDNAME.cbl', line: 11, stops: true });
});

test('a bound written as EVALUATE branches, with the rest turned away, stops an index', () => {
  assert.equal(report.findings.filter(x => x.path === 'WHENBOUND.cbl' && x.rule === 'argv-or-env-to-subscript').length, 0);
  const [c] = report.checked.filter(x => x.path === 'WHENBOUND.cbl');
  assert.equal(c.guard.line, 12);
  assert.equal(c.guard.stops, true);
});

test('SARIF carries the check beside the evidence kind', () => {
  const sarif = toSarif(report);
  const r = sarif.runs[0].results.find(x => x.ruleId === 'argv-or-env-to-os-command' && x.locations[0].physicalLocation.artifactLocation.uri === 'GUARDED.cbl');
  assert.equal(r.level, 'error');
  assert.equal(r.properties.guardedFrom, 'crit');
  assert.equal(r.properties.guard.line, 9);
});
