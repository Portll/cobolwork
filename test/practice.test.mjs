// The practice set: dead code, unused records, option checks and obsolete elements over fixtures,
// the rule-set invariants for a set outside the registry, and its items in the advice document
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRACTICE_RULES, scanPractice } from '../lib/sets/practice.mjs';
import { toolName } from '../lib/kernel/ruleset.mjs';
import { advise } from '../lib/advice.mjs';
import { schemaProblems } from './schema-check.mjs';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, 'fixtures', 'practice');
const SCHEMAS = join(HERE, '..', 'schema');
const load = (file) => JSON.parse(readFileSync(join(SCHEMAS, file), 'utf8'));

const out = scanPractice(ROOT);
const of = (rule, file) => out.findings.filter((f) => f.rule === rule && (!file || f.path.endsWith(file)));
const items = (rule, file) => of(rule, file).map((f) => f.item).sort();

test('dead code: paragraphs nothing reaches, and not the ones a PERFORM, GO TO, THRU or fall-through reaches', () => {
  assert.deepEqual(items('dead-code-paragraph', 'REACH.cbl'), ['DEAD-SECTION', 'NOBODY-CALLS', 'SKIPPED-OVER']);
  assert.deepEqual(items('dead-code-paragraph', 'STOPRUN.cbl'), ['LAST-PARA']);
  assert.deepEqual(items('dead-code-paragraph', 'ENTRYPT.cbl'), [], 'a paragraph after GOBACK reached through ENTRY is live');
  assert.deepEqual(items('dead-code-paragraph', 'ALTER.cbl'), [], 'ALTER targets are reached');
});

test('dead code: statements after an unconditional STOP RUN in the same paragraph', () => {
  const [f] = of('dead-code-statements', 'STOPRUN.cbl');
  assert.equal(f.line, 11);
  assert.match(f.detail, /2 statements in paragraph MAIN-PARA \(DISPLAY, MOVE\) follow the STOP RUN at line 10/);
  assert.equal(of('dead-code-statements').length, 1);
});

test('unused data: one record nothing names; EXEC SQL host variables, 88 levels, REDEFINES, ODO, FILLER, copybooks and LINKAGE are not reported', () => {
  assert.deepEqual(items('unused-data-record'), ['WS-NEVER']);
  assert.match(of('unused-data-record')[0].detail, /01 WS-NEVER in WORKING-STORAGE and the 2 items under it/);
});

test('options: a program without SSRANGE is told for subscript and reference modification, and a PROCESS card satisfies both', () => {
  assert.deepEqual(items('options-check-off', 'NOCARD.cbl'), ['reference-modification', 'subscript']);
  assert.deepEqual(items('options-check-off', 'CARDSSR.cbl'), []);
  assert.equal(of('options-undeclared', 'NOCARD.cbl').length, 1);
  assert.equal(of('options-undeclared', 'CARDSSR.cbl').length, 0);
  const site = scanPractice(join(ROOT, 'site'));
  assert.deepEqual(site.findings.filter((f) => f.rule.startsWith('options-')), [], 'declared site compilerOptions satisfy the checks');
});

test('obsolete: each documented element once, at its line', () => {
  const rules = Object.keys(PRACTICE_RULES).filter((r) => r.startsWith('obsolete-') && r !== 'obsolete-go-to-without-name');
  for (const r of rules) assert.ok(of(r).length >= 1, r);
  assert.equal(of('obsolete-identification-paragraph').length, 5);
  assert.deepEqual(items('obsolete-debugging-declarative'), ['DEBUG-ITEM', 'USE FOR DEBUGGING']);
  assert.equal(of('obsolete-segment-number')[0].line, 37);
  assert.equal(of('obsolete-alter')[0].path, 'ALTER.cbl');
  assert.deepEqual(items('obsolete-go-to-without-name'), [], 'a GO TO that names its target is not reported');
});

test('the set keeps the rule-set invariants outside the registry', () => {
  assert.equal(out.tool, toolName('practice'));
  for (const key of ['findings', 'byRule', 'filesScanned', 'nosrc', 'coverageIncomplete']) assert.ok(key in out.summary, key);
  assert.equal(out.summary.findings, out.findings.length);
  for (const f of out.findings) {
    assert.ok(f.rule in PRACTICE_RULES, f.rule);
    assert.equal(f.sev, PRACTICE_RULES[f.rule].sev, f.rule);
    assert.equal(f.cwe, PRACTICE_RULES[f.rule].cwe, f.rule);
    assert.ok(f.path && typeof f.detail === 'string' && 'line' in f, f.rule);
  }
  const keys = out.findings.map((f) => `${f.rule}|${f.path}|${String(f.line || 0).padStart(8, '0')}`);
  assert.deepEqual(keys, [...keys].sort());
  for (const [id, r] of Object.entries(PRACTICE_RULES)) {
    assert.ok(r.class && r.sev && r.evidence && r.text && r.why && r.how, id);
    assert.ok(Array.isArray(r.steps) && Array.isArray(r.references), id);
  }
});

test('the advice document carries the practice items, catalogued and conforming', () => {
  const doc = advise(ROOT);
  const schema = load('cobolwork-advice.schema.json');
  assert.deepEqual(schemaProblems(doc, schema, schema, '$', load), []);
  const practice = doc.items.filter((i) => i.kind === 'practice');
  assert.equal(practice.length, out.findings.length);
  const dead = practice.find((i) => i.ref === 'dead-code-paragraph');
  assert.equal(dead.remediation.text, PRACTICE_RULES['dead-code-paragraph'].how);
  assert.equal(dead.remediation.steps.length, 3);
  assert.ok(doc.catalogue.practices.some((p) => p.id === 'obsolete-alter' && p.references[0].title.includes('Obsolete')));
  assert.equal(doc.summary.byKind.practice, practice.length);
});
