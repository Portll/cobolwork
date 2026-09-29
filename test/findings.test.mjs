import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byText, compareFindings, sortFindings, tally, withMeta, finish, EVIDENCE, WHO_ACTS } from '../lib/kernel/findings.mjs';
import { scanJcl, JCL_RULES } from '../lib/sets/jcl.mjs';
import { scanBuild } from '../lib/sets/build.mjs';
import { scanRecon } from '../lib/sets/recon.mjs';
import { scanVendor } from '../lib/sets/vendor.mjs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import './pin-machine.mjs';

const CASES = join(dirname(fileURLToPath(import.meta.url)), '..', 'bench', 'cases');
const CREDENTIAL_CASE = join(CASES, '027-instream-grants-authority-with-a-password');

// The defect this module was written for. Severity did not belong to a rule set at all: scanAll
// imputed it while merging, so a set called directly returned findings carrying nothing, and
// toSarif maps a missing severity to 'warning'. A crit credential finding left the tool as a
// warning if anything but scanAll asked for it.
test('a rule set called directly stamps its own severity and CWE', () => {
  const r = scanJcl(CREDENTIAL_CASE, {});
  const cred = r.findings.find((f) => f.rule === 'jcl-instream-credential');
  assert.ok(cred, 'the planted credential is found');
  assert.equal(cred.sev, 'crit', 'and it is critical without scanAll having to say so');
  assert.equal(cred.cwe, 'CWE-798');
  for (const f of r.findings) {
    assert.ok(f.sev, `every finding carries a severity: ${f.rule}`);
    assert.equal(f.sev, JCL_RULES[f.rule].sev);
  }
});

// The four sets that returned a bare stats object. A consumer reading one set's report got a
// different shape depending on which set it asked.
test('every rule set reports the same summary shape', () => {
  for (const [name, scan] of [['jcl', scanJcl], ['build', scanBuild], ['recon', scanRecon], ['vendor', scanVendor]]) {
    const s = scan(CREDENTIAL_CASE, {}).summary;
    for (const key of ['findings', 'byRule', 'filesScanned', 'filesUnreadable', 'nosrc']) {
      assert.ok(key in s, `${name}.summary carries ${key}`);
    }
  }
});

// A rule id that no table declares used to become a medium finding nobody had written.
test('a finding naming an undeclared rule is refused, not defaulted', () => {
  const rules = { 'real-rule': { sev: 'high', evidence: 'construct', cwe: 'CWE-1', text: 'x' } };
  assert.throws(
    () => withMeta(rules, [{ rule: 'real-rule' }, { rule: 'typo-rule' }], 'test'),
    (e) => e.code === 'ERULEID' && /typo-rule/.test(e.message) && /test/.test(e.message),
  );
});

test('evidence is stamped from the table, and a finding that carries its own keeps it', () => {
  const rules = { r: { sev: 'high', evidence: 'construct', cwe: 'CWE-1', text: 'x' } };
  const findings = [{ rule: 'r', evidence: 'context' }, { rule: 'r' }];
  withMeta(rules, findings, 'test');
  assert.equal(findings[0].evidence, 'context', 'a pack rule at info keeps the kind it was given');
  assert.equal(findings[1].evidence, 'construct');
});

test('an evidence kind outside the vocabulary, or none at all, is refused', () => {
  assert.throws(
    () => withMeta({ r: { sev: 'high', evidence: 'exploitable', text: 'x' } }, [{ rule: 'r' }], 'test'),
    (e) => e.code === 'EEVIDENCE' && /exploitable/.test(e.message),
  );
  assert.throws(
    () => withMeta({ r: { sev: 'high', text: 'x' } }, [{ rule: 'r' }], 'test'),
    (e) => e.code === 'EEVIDENCE',
  );
});

test('a finding that already carries a severity keeps it', () => {
  const rules = { r: { sev: 'high', evidence: 'construct', cwe: 'CWE-1', text: 'x' } };
  const findings = [{ rule: 'r', sev: 'low' }, { rule: 'r' }];
  withMeta(rules, findings, 'test');
  assert.equal(findings[0].sev, 'low', 'a pack rule or a demotion survives the stamping');
  assert.equal(findings[1].sev, 'high', 'and anything unset is filled from the table');
});

// One order, everywhere. The vendor set used to sort without the rule in its key, so two findings
// at one place came back in whichever order they happened to be pushed.
test('findings order by rule, then path, then line', () => {
  const findings = [
    { rule: 'b', path: 'a.cbl', line: 1 },
    { rule: 'a', path: 'b.cbl', line: 1 },
    { rule: 'a', path: 'a.cbl', line: 9 },
    { rule: 'a', path: 'a.cbl', line: 2 },
  ];
  sortFindings(findings);
  assert.deepEqual(findings.map((f) => `${f.rule}:${f.path}:${f.line}`),
    ['a:a.cbl:2', 'a:a.cbl:9', 'a:b.cbl:1', 'b:a.cbl:1']);
});

test('a finding with no line sorts as line 0, never as NaN', () => {
  // undefined - undefined is NaN, and a comparator returning NaN leaves the array untouched, so
  // this reads as sorted and is not.
  const a = { rule: 'r', path: 'p' };
  const b = { rule: 'r', path: 'p', line: 3 };
  assert.equal(compareFindings(a, b), -3);
  assert.ok(!Number.isNaN(compareFindings(a, a)));
});

test('byText orders text and reports equality as zero', () => {
  assert.equal(byText('a', 'b'), -1);
  assert.equal(byText('b', 'a'), 1);
  assert.equal(byText('a', 'a'), 0);
});

test('tally counts each rule once per finding', () => {
  assert.deepEqual(tally([{ rule: 'a' }, { rule: 'b' }, { rule: 'a' }]), { a: 2, b: 1 });
});

test('finish stamps, sorts and counts in one pass', () => {
  const rules = { z: { sev: 'low', evidence: 'exposure', cwe: null, text: 'x' }, a: { sev: 'crit', evidence: 'path', cwe: 'CWE-9', text: 'y' } };
  const findings = [{ rule: 'z', path: 'p', line: 1 }, { rule: 'a', path: 'p', line: 1 }];
  const { byRule } = finish(rules, findings, 'test');
  assert.equal(findings[0].rule, 'a', 'sorted');
  assert.equal(findings[0].sev, 'crit', 'stamped');
  assert.equal(findings[0].cwe, 'CWE-9');
  assert.equal(findings[1].cwe, null, 'a rule with no CWE records null rather than undefined');
  assert.deepEqual(byRule, { a: 1, z: 1 }, 'counted');
});

test('every evidence kind says who acts on it, and no other kind does', () => {
  assert.deepEqual(Object.keys(WHO_ACTS).sort(), Object.keys(EVIDENCE).sort());
  for (const [kind, who] of Object.entries(WHO_ACTS)) assert.ok(typeof who === 'string' && who.trim(), kind);
});
