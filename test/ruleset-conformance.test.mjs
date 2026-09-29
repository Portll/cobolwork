import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { REGISTRY } from '../lib/kernel/registry.mjs';
import { report, toolName } from '../lib/kernel/ruleset.mjs';
import { directoryTree } from '../lib/kernel/source-tree.mjs';
import './pin-machine.mjs';

const CASES = join(dirname(fileURLToPath(import.meta.url)), '..', 'bench', 'cases');

// One table over every registered set, rather than a per-set assertion somebody has to remember to
// write. The invariants below are the ones docs/spec/ruleset-contract.md names, and each was
// violated by at least one set when it was written down: severity that belonged to the caller, four
// summaries with no byRule, a sort that omitted the rule from its key, coverage a set could report
// or not as it pleased.
//
// A tenth set added to the registry is asserted against all of this without anyone doing anything.

// Scanned once. These are read-only assertions over the result, and nine scans of the same tree is
// most of this file's runtime.
const results = REGISTRY.map((set) => {
  const tree = directoryTree(CASES);
  return { name: set.name, rules: set.rules, out: set.scan(CASES, { tree }) };
});

test('every set reports under its own tool name', () => {
  for (const { name, out } of results) assert.equal(out.tool, toolName(name), `${name}`);
});

test('every set returns findings and a summary', () => {
  for (const { name, out } of results) {
    assert.ok(Array.isArray(out.findings), `${name} returns an array of findings`);
    assert.ok(out.summary && typeof out.summary === 'object', `${name} returns a summary`);
  }
});

// I3. Four sets used to return a bare stats object, so a consumer reading one set's report got a
// different shape depending which set it asked.
test('every summary carries the same keys', () => {
  for (const { name, out } of results) {
    for (const key of ['findings', 'byRule', 'filesScanned', 'nosrc', 'coverageIncomplete']) {
      assert.ok(key in out.summary, `${name}.summary is missing ${key}`);
    }
    assert.equal(out.summary.findings, out.findings.length, `${name} counts its own findings`);
  }
});

// I1. Severity used to be imputed by scanAll while merging, so a set called directly returned
// findings carrying nothing, and toSarif maps an absent severity to 'warning'.
test('every finding carries the severity and CWE its rule declares', () => {
  for (const { name, rules, out } of results) {
    for (const f of out.findings) {
      assert.ok(f.sev, `${name}: ${f.rule} has no severity`);
      assert.ok('cwe' in f, `${name}: ${f.rule} has no cwe key`);
      // A set may set its own severity - a vendor pack rule brings one, and copybook demotes a
      // latent shadowing - so this asserts the value is declared somewhere, not that it matches.
      assert.ok(rules[f.rule], `${name}: ${f.rule} is not declared by this set`);
    }
  }
});

// I2. A rule id no table declares used to become a medium finding nobody had written.
test('every finding names a rule its own set declares', () => {
  for (const { name, rules, out } of results) {
    for (const f of out.findings) {
      assert.ok(f.rule in rules, `${name} reported ${f.rule}, which it does not declare`);
    }
  }
});

// I5. One order. The vendor set sorted without the rule in its key, so two findings at one place
// came back in whichever order they happened to be pushed.
test('every set returns its findings in the canonical order', () => {
  for (const { name, out } of results) {
    const keys = out.findings.map((f) => [f.rule, f.path, f.line || 0]);
    const sorted = [...keys].sort((a, b) =>
      (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) || a[2] - b[2]);
    assert.deepEqual(keys, sorted, `${name} is not in rule, path, line order`);
  }
});

// I4 again, proved where the fixture cannot reach it. No set in this tree fails to parse anything
// in the conformance fixture, so the loop below never enters its branch and cannot fail on the
// defect it names - dropping filesUnparsed from the kernel leaves it green. This pins the kernel
// directly instead.
test('a file opened and not understood is a file that did not contribute', () => {
  const mk = (stats) => report('cics', { rules: {}, findings: [], stats, run: { skipped: [], stoppedBy: null } }).summary;
  assert.equal(mk({ filesScanned: 100, filesUnparsed: 40 }).coverageIncomplete, true,
    '40 files read and not understood is not complete coverage');
  assert.equal(mk({ filesScanned: 100, filesUnreadable: 3 }).coverageIncomplete, true);
  assert.equal(mk({ filesScanned: 100 }).coverageIncomplete, false,
    'and a set that read everything still says so');
});

// I4, and the one SECURITY.md treats as a security property rather than a defect: a file the tool
// failed to read while still reporting coverageIncomplete: false.
test('a set that did not read everything says so', () => {
  for (const { name, out } of results) {
    const s = out.summary;
    // A file opened and not understood counts here too. It was read and yielded nothing, so the
    // set cannot say there were no findings in it, and for nine of the ten sets that case used to
    // pass straight through as complete coverage.
    const short = (s.filesNotRead || 0) + (s.filesUnreadable || 0) + (s.filesUnparsed || 0);
    if (short > 0) {
      assert.equal(s.coverageIncomplete, true, `${name} left ${short} file(s) and reported complete coverage`);
    }
    assert.equal(typeof s.coverageIncomplete, 'boolean', `${name} states coverage either way`);
  }
});

test('every finding is located by a path and a line a reader can open', () => {
  for (const { name, out } of results) {
    for (const f of out.findings) {
      assert.ok(typeof f.path === 'string' && f.path.length, `${name}: ${f.rule} has no path`);
      assert.ok(!f.path.includes('\\'), `${name}: ${f.rule} has a native separator in its path`);
      assert.ok(Number.isInteger(f.line) && f.line > 0, `${name}: ${f.rule} has no usable line`);
      assert.ok(typeof f.detail === 'string' && f.detail.length, `${name}: ${f.rule} has no detail`);
    }
  }
});

// report() is what makes the above true by construction rather than by nine sets remembering.
test('report ORs the coverage claim rather than overwriting it', () => {
  const rules = { r: { sev: 'low', cwe: null, text: 'x' } };
  const complete = { skipped: [], stoppedBy: null, peakHeapBytes: 0, note: null };

  // A set that already knows its reading was short for its own reason keeps that claim.
  const own = report('t', { rules, findings: [], stats: { filesScanned: 3, coverageIncomplete: true }, run: complete });
  assert.equal(own.summary.coverageIncomplete, true, 'a set\'s own claim survives');

  // And a set with nothing to declare takes the loop's answer.
  const stopped = report('t', { rules, findings: [], stats: { filesScanned: 3 }, run: { ...complete, skipped: ['a', 'b'], stoppedBy: 'memory reserve', note: 'n' } });
  assert.equal(stopped.summary.coverageIncomplete, true);
  assert.equal(stopped.summary.filesNotRead, 2);
  assert.equal(stopped.summary.stoppedBy, 'memory reserve');
  assert.equal(stopped.summary.notRead, 'n');
});

test('report states nosrc from what was actually read', () => {
  const rules = { r: { sev: 'low', cwe: null, text: 'x' } };
  assert.equal(report('t', { rules, findings: [], stats: { filesScanned: 0 } }).summary.nosrc, true);
  assert.equal(report('t', { rules, findings: [], stats: { filesScanned: 1 } }).summary.nosrc, false);
  // A set that never traversed still reports in the same shape as one that did.
  assert.equal(report('t', { rules, findings: [], stats: {}, run: null }).summary.coverageIncomplete, false);
});
