// Each document cobolwork writes or reads is checked against its schema in schema/, and each key a
// written document carries at its top level is one the schema describes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { schemaProblems, unreadKeywords } from './schema-check.mjs';
import { capabilities } from '../lib/capabilities.mjs';
import { DEFAULT_POLICY } from '../lib/policy.mjs';
import { scanAll } from '../lib/scan.mjs';
import { explainFinding } from '../lib/explain.mjs';
import { baselineEntries, BASELINE_VERSION } from '../lib/baseline.mjs';
import { witnessFeed } from '../bench/witness.mjs';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMAS = join(HERE, '..', 'schema');
const BIN = join(HERE, '..', 'bin', 'cobolwork.mjs');
const CASE = join(HERE, '..', 'bench', 'cases', '001-argv-reaches-os-command');
const schema = (name) => JSON.parse(readFileSync(join(SCHEMAS, `${name}.schema.json`), 'utf8'));

const conforms = (value, name) => {
  const s = schema(name);
  assert.deepEqual(schemaProblems(value, s), [], name);
  if (s.properties) {
    const undescribed = Object.keys(value).filter((k) => !(k in s.properties) && !Object.keys(s.patternProperties || {}).some((p) => new RegExp(p, 'u').test(k)));
    assert.deepEqual(undescribed, [], `${name}: keys the schema does not describe`);
  }
};

const run = (args) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
  assert.ok(r.status === 0 || r.status === 3, `cobolwork ${args.join(' ')} exited ${r.status}: ${r.stderr}`);
  return r.stdout;
};
const cli = (args) => JSON.parse(run(args));

const inCopy = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-schemas-'));
  try {
    cpSync(CASE, join(dir, 'tree'), { recursive: true });
    return fn(join(dir, 'tree'), dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

test('every schema is valid JSON with an $id naming its file, and uses only what the checker reads', () => {
  const files = readdirSync(SCHEMAS).filter((f) => f.endsWith('.schema.json'));
  assert.ok(files.length >= 12, `${files.length} schemas`);
  for (const f of files) {
    const s = JSON.parse(readFileSync(join(SCHEMAS, f), 'utf8'));
    assert.equal(s.$id, `https://github.com/Portll/cobolwork/schema/${f}`, f);
    assert.deepEqual(unreadKeywords(s), [], f);
  }
});

test('the checker reports what departs from a schema', () => {
  const s = { type: 'object', required: ['a'], properties: { a: { type: 'integer', minimum: 1 }, b: { enum: ['x'] } }, additionalProperties: false };
  assert.deepEqual(schemaProblems({ a: 1, b: 'x' }, s), []);
  assert.deepEqual(schemaProblems({ a: 0, b: 'y', c: 1 }, s), ['$.a: 0 is below 1', '$.b: "y" is not one of x', '$.c: is not allowed']);
  assert.deepEqual(schemaProblems({}, s), ['$: lacks a']);
  assert.throws(() => schemaProblems(1, { not: {} }), /does not read/);
});

test('capabilities conforms to its schema', () => {
  conforms(capabilities(), 'cobolwork-capabilities');
});

test('the default build policy conforms to the policy schema', () => {
  conforms(DEFAULT_POLICY, 'cobolwork.policy');
});

test('a baseline file cobolwork writes conforms to the baseline schema', () => {
  const report = scanAll(CASE);
  const { entries } = baselineEntries(report.findings, [], { reason: 'r', who: 'w', expires: '2099-01-01T00:00:00.000Z', at: '2026-10-04T00:00:00.000Z' });
  assert.ok(entries.length > 0);
  conforms({ _comment: 'c', version: BASELINE_VERSION, entries }, 'cobolwork.baseline');
});

test('an explain packet conforms to its schema', () => {
  const report = scanAll(CASE);
  const packet = explainFinding(report, report.findings[0].fingerprint, { root: CASE });
  conforms(packet, 'cobolwork-explain');
});

test('parse, baseline and evidence output conform to their schemas', () => {
  inCopy((tree, dir) => {
    conforms(cli(['parse', join(tree, 'P1.cbl')]), 'cobolwork-parse');
    const ev = join(dir, 'evidence');
    run(['scan', tree, '--evidence', ev, '--out', join(dir, 'report.json')]);
    conforms(cli(['baseline', tree, '--reason', 'r', '--who', 'w', '--expires', '2099-01-01']), 'cobolwork-baseline');
    conforms(cli(['evidence', 'verify', '--evidence', ev]), 'cobolwork-evidence');
    conforms(cli(['evidence', 'seal', '--evidence', ev]), 'cobolwork-evidence');
  });
});

test('the files and feeds cobolwork reads conform to their schemas in the shapes the docs give', () => {
  conforms({ $schema: 'x', version: 1, productionQualifiers: ['PROD'], systemNames: ['PAYR'], allowUnvalidatedPacks: false, runtimeVersions: { CICS: '6.1', Db2: 13 }, _comment: 'c' }, 'cobolwork.site');
  conforms({ version: 1, witness: 'UAT regression, release 26.4', recorded: '2026-09-29',
    results: { '0123456789abcdef0123456789abcdef': { outcome: 'reproduced', by: 'jsmith', on: '2026-09-28', system: 'CICSUAT1', reference: 'CHG12345', evidence: { dir: 'ev', run: '20261004T000000Z-0123456789abcdef' } } } }, 'cobolwork-witness');
  conforms(witnessFeed({ evidence: '/ev', labels: [{ source: 'execution', label: 'confirmed', fingerprint: '0123456789abcdef0123456789abcdef', run: '20261004T000000Z-0123456789abcdef' }] }), 'cobolwork-witness');
  conforms({ version: 1, extract: 'RACF unload', retrieved: '2026-09-29', transactions: { INQ1: 'open' }, jobs: { PAYJOB: 'restricted' }, privileged: { transactions: ['INQ1'], jobs: [] } }, 'cobolwork-reach');
  assert.deepEqual(schemaProblems({ programs: [{ program: 'A', detail: [{ name: 'MAIN', line: 4, entered: 2 }], statements: [] }], format: 'x' }, schema('cobolwork-execution')), []);
  assert.deepEqual(schemaProblems({ systemNames: 'PAYR' }, schema('cobolwork.site')), ['$.systemNames: is "PAYR", not array']);
  assert.deepEqual(schemaProblems({ witness: 'x', recorded: '2026-09-29', results: { a: { outcome: 'maybe', by: 'b', on: '2026-09-28', system: 's' } } }, schema('cobolwork-witness')), ['$.results.a.outcome: "maybe" is not one of reproduced, not-reproduced']);
});
