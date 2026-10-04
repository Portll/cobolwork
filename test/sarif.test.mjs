import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { toSarif } from '../lib/sarif.mjs';
import { scanAll } from '../lib/scan.mjs';
import { RULE_SETS } from '../lib/kernel/registry.mjs';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = join(HERE, '..', 'bench', 'cases');
const sarifOf = (report) => toSarif(report, { toolVersion: 'test' }).runs[0];

test('each rule set is a tool component carrying its own rules', () => {
  const run = sarifOf(scanAll(CASES, { repos: null }));
  assert.ok(run.tool.extensions.length > 0, 'the sets that produced findings are components');
  for (const e of run.tool.extensions) {
    assert.match(e.name, /^cobolwork-[a-z]+$/);
    assert.ok(e.rules.length > 0, `${e.name} declares the rules it produced`);
  }
  const names = run.tool.extensions.map((e) => e.name.replace('cobolwork-', ''));
  assert.deepEqual(names, names.filter((n) => RULE_SETS.includes(n)), 'every component is a registered set');
  // Registry order, so two runs of one tree compare line for line.
  assert.deepEqual(names, RULE_SETS.filter((n) => names.includes(n)));
});

test('every result resolves to the component that declares its rule', () => {
  const run = sarifOf(scanAll(CASES, { repos: null }));
  assert.ok(run.results.length > 0);
  for (const r of run.results) {
    assert.ok(r.ruleId, 'ruleId is present for a consumer that reads nothing else');
    if (!r.rule) continue;
    const component = run.tool.extensions[r.rule.toolComponent.index];
    assert.ok(component, `${r.ruleId} points at a component that exists`);
    assert.equal(component.rules[r.rule.index].id, r.ruleId, 'and at the right rule within it');
  }
});

test('every result and every rule it names carries its evidence kind', () => {
  const report = scanAll(CASES, { repos: null });
  const run = sarifOf(report);
  assert.equal(run.results.length, report.findings.length);
  run.results.forEach((r, i) => assert.equal(r.properties?.evidence, report.findings[i].evidence, r.ruleId));
  for (const e of run.tool.extensions) {
    for (const rule of e.rules) assert.equal(rule.properties?.evidence, report.ruleEvidence[rule.id], rule.id);
  }
});

// Reach and effect ride on the result, where the estate declared the facts; a finding without them
// carries neither, so blank never reads as a fact.
test('a result carries reach and effect when they were judged, and nothing when they were not', () => {
  const run = sarifOf({
    findings: [
      { rule: 'argv-or-env-to-os-command', path: 'A.cbl', line: 1, sev: 'crit', evidence: 'path', reach: 'open', effect: 'privileged', detail: 'x' },
      { rule: 'argv-or-env-to-os-command', path: 'B.cbl', line: 1, sev: 'crit', evidence: 'path', detail: 'y' },
    ],
    ruleText: {}, ruleCwe: {}, summary: { nosrc: false },
  });
  assert.equal(run.results[0].properties.reach, 'open');
  assert.equal(run.results[0].properties.effect, 'privileged');
  assert.equal(run.results[1].properties.reach, undefined, 'no fact, no claim');
  assert.equal(run.results[1].properties.effect, undefined);
});

// diff's rules are not produced by a rule set, so they stay on the driver and resolve by ruleId.
test('a rule no set declares stays on the driver', () => {
  const run = sarifOf({
    findings: [{ rule: 'diff-layout-changed', path: 'A.cbl', line: 1, detail: 'x', sev: 'low' }],
    ruleText: {}, ruleCwe: {}, summary: { nosrc: false },
  });
  assert.deepEqual(run.tool.driver.rules.map((r) => r.id), ['diff-layout-changed']);
  assert.equal(run.results[0].rule, undefined, 'no component reference, so ruleId resolves against the driver');
});

// A rule's impact and standard fix ride on its descriptor, the same for every result. `help` is
// where GitHub code scanning shows a recommendation; a rule that declares neither carries neither.
test('a rule carries its impact and remedy on the descriptor, and one without carries nothing', () => {
  const run = sarifOf({
    findings: [
      { rule: 'cics-transfer-to-variable-program', path: 'A.cbl', line: 1, detail: 'x', sev: 'med' },
      { rule: 'bare-rule', path: 'B.cbl', line: 1, detail: 'y', sev: 'low' },
    ],
    ruleText: { 'cics-transfer-to-variable-program': 'CICS transfers control to a program named by a variable', 'bare-rule': 'z' },
    ruleImpact: { 'cics-transfer-to-variable-program': 'Whoever controls the value chooses which program the region runs next' },
    ruleRemedy: { 'cics-transfer-to-variable-program': 'Transfer only to a name chosen from a fixed table of literals' },
    ruleCwe: {}, summary: { nosrc: false },
  });
  const all = [...(run.tool.extensions || []).flatMap((e) => e.rules), ...run.tool.driver.rules];
  const cics = all.find((r) => r.id === 'cics-transfer-to-variable-program');
  assert.match(cics.fullDescription.text, /which program the region runs next/);
  assert.match(cics.help.text, /a fixed table of literals/);
  const bare = all.find((r) => r.id === 'bare-rule');
  assert.equal(bare.fullDescription, undefined, 'no impact declared, none invented');
  assert.equal(bare.help, undefined);
});

// The constraint on this mapping: the verdict must stay where nobody can miss it. Degrading it
// into a property bag consumers skip would lose the thing this tool is measured on.
test('the coverage verdict is first-class, and the detail is namespaced', () => {
  const run = sarifOf(scanAll(CASES, { repos: null }));
  const inv = run.invocations[0];
  assert.equal(typeof inv.executionSuccessful, 'boolean');
  assert.equal(typeof inv.properties.coverageIncomplete, 'boolean', 'the verdict is a flat property too');
  const bag = inv.properties['cobolwork/coverage'];
  assert.ok(bag, 'the detail travels in a namespaced bag');
  assert.equal(bag.coverageIncomplete, inv.properties.coverageIncomplete, 'and the two agree');
  assert.ok(bag.bySet, 'per-set coverage, because sets read different slices of the tree');
});

// A tree holding nothing any set reads, and no cobolwork.site.json: recon has not looked. The memory
// guard samples before each file, so with none it never runs. Scanning bench/cases for this made
// recon read part of that tree on a loaded machine, which is a true result and a different one.
const unconfigured = () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-unconfigured-'));
  writeFileSync(join(dir, 'NOTES.txt'), 'nothing a rule set reads\n');
  return dir;
};

test('a set that could not run is a configuration notification, not an execution one', () => {
  const inv = sarifOf(scanAll(unconfigured())).invocations[0];
  const config = inv.toolConfigurationNotifications || [];
  const recon = config.find((n) => n.properties.set === 'recon');
  assert.ok(recon, 'recon is reported as not having run');
  assert.equal(recon.descriptor.id, 'cobolwork/rule-set-did-not-run');
  assert.match(recon.message.text, /cobolwork\.site\.json/, 'and the message says what to do about it');
});

test('files a set did not read are an execution notification', () => {
  const report = scanAll(CASES, { repos: null });
  // A set that stopped early, stated the way a rule set states it.
  report.summary.bySet.cics = {
    filesScanned: 2, filesUnreadable: 0, filesNotRead: 9,
    stoppedBy: 'memory reserve', notRead: 'cics: 9 of 11 files were not read.',
  };
  const inv = sarifOf(report).invocations[0];
  const exec = inv.toolExecutionNotifications || [];
  const cics = exec.find((n) => n.properties.set === 'cics');
  assert.ok(cics, 'the shortfall is reported where a SARIF consumer looks for it');
  assert.equal(cics.descriptor.id, 'cobolwork/files-not-read');
  assert.equal(cics.message.text, 'cics: 9 of 11 files were not read.', 'verbatim, not paraphrased');
  assert.equal(cics.properties.stoppedBy, 'memory reserve');
});

test('the published schema describes the bag that is actually emitted', () => {
  const schema = JSON.parse(readFileSync(join(HERE, '..', 'schema', 'cobolwork-coverage.schema.json'), 'utf8'));
  const bag = sarifOf(scanAll(CASES, { repos: null })).invocations[0].properties['cobolwork/coverage'];
  const allowed = new Set(Object.keys(schema.properties));
  for (const k of Object.keys(bag)) assert.ok(allowed.has(k), `${k} is described by the schema`);
  for (const k of schema.required) assert.ok(k in bag, `${k} is required and present`);

  const perSet = new Set(Object.keys(schema.$defs.componentCoverage.properties));
  for (const [set, s] of Object.entries(bag.bySet)) {
    for (const k of Object.keys(s)) assert.ok(perSet.has(k), `bySet.${set}.${k} is described by the schema`);
  }

  // no site file in the cases, so recon is always here
  const item = schema.properties.setsIncomplete.items;
  assert.ok(bag.setsIncomplete?.length > 0, 'the cases leave at least one set incomplete, so this is not vacuous');
  for (const s of bag.setsIncomplete) {
    for (const k of Object.keys(s)) assert.ok(k in item.properties, `setsIncomplete.${k} is described by the schema`);
    for (const k of item.required) assert.ok(k in s, `setsIncomplete.${k} is required and present`);
    assert.ok(item.properties.kind.enum.includes(s.kind), `${s.set}: ${s.kind}`);
  }
});

test('an incomplete set says whether it is a configuration gap or a coverage gap, and names why', () => {
  const r = scanAll(unconfigured());
  const recon = r.summary.setsIncomplete.find((s) => s.set === 'recon');
  assert.equal(recon.kind, 'configuration');
  assert.match(recon.why, /cobolwork\.site\.json/);
  const dir = mkdtempSync(join(tmpdir(), 'cw-kind-'));
  try {
    writeFileSync(join(dir, 'J.jcl'), '//J JOB (X)\n//  INCLUDE MEMBER=NOTHERE\n//S EXEC PGM=IEFBR14\n');
    const report = scanAll(dir);
    const jcl = report.summary.setsIncomplete.find((s) => s.set === 'jcl');
    assert.equal(jcl.kind, 'coverage');
    assert.match(jcl.why, /1 JCL file\(s\) were read in part.*INCLUDE MEMBER=NOTHERE/);
    const inv = sarifOf(report).invocations[0];
    assert.ok((inv.toolExecutionNotifications || []).some((n) => n.properties.set === 'jcl' && n.descriptor.id === 'cobolwork/read-in-part'));
    assert.ok(!(inv.toolConfigurationNotifications || []).some((n) => n.properties.set === 'jcl'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('each rule that names a CWE is related to that taxon in the run\'s CWE taxonomy', () => {
  const report = scanAll(CASES, { repos: null });
  const run = sarifOf(report);
  const [cwe] = run.taxonomies;
  assert.equal(run.taxonomies.length, 1);
  assert.equal(cwe.name, 'CWE');
  const taxa = cwe.taxa.map((t) => t.id);
  assert.deepEqual(taxa, [...taxa].sort((a, b) => a - b), 'taxa in numeric order');
  const rules = [...run.tool.driver.rules, ...run.tool.extensions.flatMap((e) => e.rules)];
  const related = new Set();
  for (const rule of rules) {
    const declared = report.ruleCwe[rule.id];
    if (!declared) { assert.equal(rule.relationships, undefined, rule.id); continue; }
    const [{ target }] = rule.relationships;
    assert.equal(`CWE-${target.id}`, declared, rule.id);
    assert.deepEqual(target.toolComponent, { name: 'CWE', index: 0 });
    assert.ok(taxa.includes(target.id), `${rule.id}: CWE-${target.id} is a taxon`);
    related.add(target.id);
  }
  assert.deepEqual([...related].sort((a, b) => a - b), taxa, 'every taxon is one a described rule names');
  for (const t of cwe.taxa) assert.equal(t.helpUri, `https://cwe.mitre.org/data/definitions/${t.id}.html`);
});

test('a run whose rules name no CWE carries no taxonomy', () => {
  const run = sarifOf({ findings: [{ rule: 'x', path: 'A.cbl', line: 1, detail: 'x' }], ruleText: {}, ruleCwe: {}, summary: {} });
  assert.equal(run.taxonomies, undefined);
  assert.equal(run.tool.driver.rules[0].relationships, undefined);
});

test('every location points by index at the one artifact holding its file', () => {
  const run = sarifOf(scanAll(CASES, { repos: null }));
  const uris = run.artifacts.map((a) => a.location.uri);
  assert.equal(new Set(uris).size, uris.length, 'each file is listed once');
  assert.deepEqual(uris, [...uris].sort());
  const named = new Set();
  for (const r of run.results) {
    for (const { physicalLocation: { artifactLocation: a } } of [...r.locations, ...(r.relatedLocations || [])]) {
      assert.equal(run.artifacts[a.index].location.uri, a.uri);
      assert.equal(a.uriBaseId, '%SRCROOT%');
      named.add(a.uri);
    }
  }
  assert.deepEqual([...named].sort(), uris, 'every artifact is named by some location');
});

test('an advisory a finding rests on is not given as a related location', () => {
  const run = sarifOf({
    findings: [{ rule: 'build-pins-vulnerable-compiler', path: 'Dockerfile', line: 2, sev: 'high', evidence: 'advisory', detail: 'x',
      related: [{ id: 'CVE-2019-14468', url: 'https://nvd.nist.gov/vuln/detail/CVE-2019-14468' }, { path: 'A.cbl', line: 3, detail: 'y' }] }],
    ruleText: {}, ruleCwe: {}, summary: {},
  });
  assert.deepEqual(run.artifacts.map((a) => a.location.uri), ['A.cbl', 'Dockerfile']);
  assert.deepEqual(run.results[0].relatedLocations.map((l) => l.physicalLocation.artifactLocation.uri), ['A.cbl']);
});
