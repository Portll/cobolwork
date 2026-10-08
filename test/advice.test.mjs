// The advice document: its shape, its order, what it rests on and what it says it did not measure
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { advise, catalogue, INVENTORY_PRACTICES } from '../lib/advice.mjs';
import { ALL_RULES } from '../lib/kernel/registry.mjs';
import { schemaProblems } from './schema-check.mjs';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASE = join(HERE, '..', 'bench', 'cases', '001-argv-reaches-os-command');
const BIN = join(HERE, '..', 'bin', 'cobolwork.mjs');
const SCHEMAS = join(HERE, '..', 'schema');
const load = (file) => JSON.parse(readFileSync(join(SCHEMAS, file), 'utf8'));
const schema = load('cobolwork-advice.schema.json');

const doc = advise(CASE);

test('the document conforms to its schema and names itself', () => {
  assert.deepEqual(schemaProblems(doc, schema, schema, '$', load), []);
  assert.equal(doc.tool, 'cobolwork-advice');
  assert.equal(doc.schemaVersion, 1);
  assert.equal(doc.repository.name, '001-argv-reaches-os-command');
});

test('every rule the registry declares is in the catalogue with its set and compliance clauses', () => {
  const ids = new Set(doc.catalogue.rules.map((r) => r.id));
  for (const id of Object.keys(ALL_RULES)) assert.ok(ids.has(id), id);
  const r = doc.catalogue.rules.find((x) => x.id === 'argv-or-env-to-os-command');
  assert.equal(r.set, 'flow');
  assert.ok(r.remedy && r.impact);
  assert.ok(Object.keys(r.compliance).length >= 1, 'compliance clauses');
  assert.ok(Array.isArray(r.references) && Array.isArray(r.steps));
  assert.ok(doc.catalogue.rules.some((x) => x.set.startsWith('pack:')), 'vendor pack rules are catalogued');
  for (const id of Object.keys(INVENTORY_PRACTICES)) assert.ok(doc.catalogue.practices.some((p) => p.id === id), id);
});

test('a finding becomes an item with its fingerprint, verdict, typed fix location and gate target', () => {
  const item = doc.items.find((i) => i.kind === 'finding' && i.ref === 'argv-or-env-to-os-command');
  assert.ok(item, 'the bench case finding');
  assert.match(item.fingerprint, /^[0-9a-f]{32}$/);
  assert.equal(item.id, `finding:argv-or-env-to-os-command:${item.fingerprint}`);
  assert.equal(typeof item.remediation.text, 'string');
  assert.equal(item.remediation.gate.target, item.fingerprint);
  if (item.remediation.fixAt) {
    assert.equal(typeof item.remediation.fixAt.path, 'string');
    assert.equal(typeof item.remediation.fixAt.line, 'number');
    assert.ok('test' in item.remediation.fixAt);
  }
  assert.ok(item.compliance.some((c) => c.framework && c.clause));
  assert.equal(item.source, 'cobolwork');
});

test('items are ordered by severity, verdict, kind, place and id, and the summary lists that order', () => {
  const rank = { crit: 5, high: 4, med: 3, low: 2, info: 1 };
  for (let i = 1; i < doc.items.length; i++) assert.ok(rank[doc.items[i - 1].sev] >= rank[doc.items[i].sev], `${doc.items[i - 1].id} before ${doc.items[i].id}`);
  assert.deepEqual(doc.summary.ordered, doc.items.map((i) => i.id));
  assert.equal(doc.summary.items, doc.items.length);
  assert.equal(Object.values(doc.summary.byKind).reduce((a, b) => a + b, 0), doc.items.length);
});

test('without a compiler the compiler parts are null and unmeasured says so', () => {
  assert.equal(doc.estate.compiler, null);
  assert.equal(doc.estate.programs, null);
  assert.equal(doc.estate.dialect, null);
  assert.ok(doc.unmeasured.some((u) => /--ironwork/.test(u)), doc.unmeasured.join(' | '));
  assert.ok(!doc.items.some((i) => i.kind === 'compile'));
});

test('the estate counts files by kind and reads the option cards and the policy', () => {
  assert.ok(doc.estate.files.programs >= 1);
  assert.ok('SSRANGE' in doc.estate.options.observed);
  assert.deepEqual(doc.estate.options.policy.checks, ['subscript', 'reference-modification']);
});

test('two runs over one tree write one byte sequence', () => {
  assert.equal(JSON.stringify(advise(CASE)), JSON.stringify(doc));
});

test('the catalogue alone is a complete, sorted document part', () => {
  const c = catalogue([{ id: 'IWC0055', severity: 'W', text: 'no STOP RUN' }]);
  assert.deepEqual(c.rules.map((r) => r.id), [...c.rules.map((r) => r.id)].sort((a, b) => a.localeCompare(b)));
  assert.equal(c.compiler[0].id, 'IWC0055');
});

test('the CLI writes the document and reports what it did not measure', () => {
  const r = spawnSync(process.execPath, [BIN, 'advise', CASE], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.tool, 'cobolwork-advice');
  assert.match(r.stderr, /unmeasured/);
});
