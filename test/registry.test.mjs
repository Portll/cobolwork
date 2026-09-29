import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { REGISTRY, RULE_SETS, ALL_RULES, reportKey, toolName, duplicateRuleIds } from '../lib/kernel/registry.mjs';
import { scanAll } from '../lib/scan.mjs';
import { CATALOGUE } from '../feed/catalogue.mjs';
import { EVIDENCE } from '../lib/kernel/findings.mjs';
import { DIFF_RULES } from '../lib/diff.mjs';
import './pin-machine.mjs';

const SETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'sets');
const CASES = join(dirname(fileURLToPath(import.meta.url)), '..', 'bench', 'cases');

// Adding a rule set cost nine edits across four files, eight of which were the same fact written
// down again. This asserts the eight are gone: everything derives from the one list.
test('every registered set brings a name, a scan and a rule table', () => {
  assert.ok(REGISTRY.length >= 9);
  for (const s of REGISTRY) {
    assert.match(s.name, /^[a-z]+$/, 'a report key is a plain word');
    assert.equal(typeof s.scan, 'function', `${s.name} has a scan function`);
    assert.ok(s.rules && Object.keys(s.rules).length > 0, `${s.name} declares at least one rule`);
  }
  assert.deepEqual(RULE_SETS, REGISTRY.map((s) => s.name));
});

// A rules module nobody registered is a rule set that silently never runs, which is the same shape
// of quiet wrong answer as a misspelled --only.
test('every module in lib/sets is registered, and every registered set has a module', () => {
  // lib/sets/<name>.mjs is the convention, and <name> is the report key. Nothing else lives there.
  const modules = readdirSync(SETS)
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => f.slice(0, -'.mjs'.length));
  const registered = new Set(RULE_SETS);

  assert.deepEqual(modules.filter((m) => !registered.has(m)), [],
    'a set module nobody registered never runs, and reports no zero on its own behalf either');
  assert.deepEqual(RULE_SETS.filter((n) => !modules.includes(n)), [],
    'and a registered set with no module would fail at import rather than here');
  // Guards against the assertion above passing because the directory was moved and nothing matched.
  assert.ok(modules.length >= 9, `expected the nine sets, found ${modules.length}`);
});

test('a tool name is derived from the report key, so the two cannot drift', () => {
  for (const s of REGISTRY) assert.equal(reportKey(toolName(s.name)), s.name);
});

// The bug the ESETNAME throw was written for: the flow set was renamed while the map was not, and
// its counts went out under the literal key `undefined` for several commits.
test('an unregistered tool name is refused rather than filed under undefined', () => {
  assert.throws(() => reportKey('cobolwork-nonesuch'), (e) => e.code === 'ESETNAME');
  assert.throws(() => reportKey(undefined), (e) => e.code === 'ESETNAME');
});

// ALL_RULES is one flat object, so a duplicate id would take the last definition silently and a
// finding would carry another set's severity.
test('no two rule sets declare the same rule id', () => {
  assert.deepEqual(duplicateRuleIds(), []);
  const declared = REGISTRY.reduce((n, s) => n + Object.keys(s.rules).length, 0);
  assert.equal(Object.keys(ALL_RULES).length, declared, 'nothing was lost to a collision');
});

// commitwork relies on both directions.
test('every rule declares an evidence kind, and info is exactly the kinds that are not defects', () => {
  const notDefects = new Set(['coverage', 'context']);
  for (const [id, r] of Object.entries({ ...ALL_RULES, ...DIFF_RULES })) {
    assert.ok(Object.hasOwn(EVIDENCE, r.evidence), `${id} declares evidence '${r.evidence}'`);
    assert.equal(r.sev === 'info', notDefects.has(r.evidence), `${id} is ${r.sev} and ${r.evidence}`);
  }
});

test('a report says what kind of claim each finding makes', () => {
  const r = scanAll(CASES, { repos: null });
  assert.ok(r.findings.length > 0, 'the cases produce findings, so the assertions below are not vacuous');
  for (const f of r.findings) assert.ok(Object.hasOwn(EVIDENCE, f.evidence), `${f.rule} at ${f.path}:${f.line}`);
  const counted = Object.values(r.summary.byEvidence).reduce((a, b) => a + b, 0);
  assert.equal(counted, r.findings.length, 'byEvidence accounts for every finding');
  assert.deepEqual(Object.keys(r.ruleEvidence).sort(), Object.keys(ALL_RULES).sort());
  assert.deepEqual(Object.keys(r.evidence).sort(), Object.keys(EVIDENCE).sort(), 'and carries what each kind means');
  assert.equal(r.schemaVersion, 3);
});

test('the feed catalogue covers every registered set', () => {
  const sets = new Set([...CATALOGUE.values()].map((r) => r.set));
  for (const name of RULE_SETS) assert.ok(sets.has(name), `${name} appears in the catalogue`);
});

test('a scan reports one entry per registered set, plus inventory', () => {
  const bySet = scanAll(CASES, { repos: null }).summary.bySet;
  assert.deepEqual(Object.keys(bySet).sort(), [...RULE_SETS, 'inventory'].sort());
});

test('--only names are exactly the registered ones', () => {
  const r = scanAll(CASES, { repos: null, only: ['jcl'] });
  assert.deepEqual(r.summary.ruleSets, ['jcl']);
  assert.deepEqual(Object.keys(r.summary.bySet).sort(), ['inventory', 'jcl']);
});

// Nothing outside the registry should reach for a rule set by name. Three tools did, and each had
// drifted a different way: diag/measure-rules.mjs listed eight and never measured the opaque set,
// bench/run.mjs listed eight and never scored the copybook set against a benchmark case, and
// diag/memory-probe.mjs listed seven and so never measured the memory of the two newest.
//
// None of that failed anything. A tool that enumerates the sets it knows about cannot report the
// one it does not, so the gap is invisible from its output - which is the whole argument for
// deriving the list instead of writing it down.
test('no tool outside the registry enumerates the rule sets by hand', () => {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const offenders = [];
  for (const dir of ['diag', 'bench', 'feed', 'bin']) {
    const here = join(ROOT, dir);
    for (const f of readdirSync(here).filter((n) => n.endsWith('.mjs'))) {
      const src = readFileSync(join(here, f), 'utf8');
      const named = [...src.matchAll(/from '[^']*\/sets\/([a-z]+)\.mjs'/g)].map((m) => m[1]);
      // One is a tool that legitimately works on a single named set. Two or more is a list.
      if (named.length > 1) offenders.push(`${dir}/${f} imports ${named.length} sets directly: ${named.join(', ')}`);
    }
  }
  assert.deepEqual(offenders, [], `these will silently stop covering a set the day one is added:\n  ${offenders.join('\n  ')}`);
});
