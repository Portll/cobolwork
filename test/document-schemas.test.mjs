// Each document cobolwork writes or reads is checked against its schema in schema/, and each key a
// written document carries at its top level is one the schema describes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, cpSync, rmSync, writeFileSync } from 'node:fs';
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

const load = (file) => JSON.parse(readFileSync(join(SCHEMAS, file), 'utf8'));
const undescribed = (value, s) => Object.keys(value).filter((k) => !(k in (s.properties || {})) && !Object.keys(s.patternProperties || {}).some((p) => new RegExp(p, 'u').test(k)));

const conforms = (value, name) => {
  const s = schema(name);
  assert.deepEqual(schemaProblems(value, s, s, '$', load), [], name);
  if (s.properties) assert.deepEqual(undescribed(value, s), [], `${name}: keys the schema does not describe`);
};

// A report's summary and findings, as well as its top level, hold only keys their schemas describe.
const reportConforms = (report, name) => {
  conforms(report, name);
  const s = schema(name);
  assert.deepEqual(undescribed(report.summary, s.properties.summary), [], `${name}: summary keys the schema does not describe`);
  const finding = schema('cobolwork-finding');
  const keys = new Set([...(report.findings || []), ...(report.checked || []), ...(report.suppressed || [])].flatMap((f) => undescribed(f, finding)));
  assert.deepEqual([...keys], [], `${name}: finding keys the schema does not describe`);
};

const run = (args, statuses = [0, 3]) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
  assert.ok(statuses.includes(r.status), `cobolwork ${args.join(' ')} exited ${r.status}: ${r.stderr}`);
  return r.stdout;
};
const cli = (args, statuses) => JSON.parse(run(args, statuses));

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

test('scan reports conform to the report schema, alone, over several repositories and with a baseline and feeds', () => {
  const report = scanAll(join(HERE, '..', 'bench', 'cases'), { repos: null, allRoutes: true });
  assert.ok(report.findings.length > 50 && report.checked?.length > 0, 'the cases give findings and checked routes');
  reportConforms(report, 'cobolwork-report');
  const cases = readdirSync(join(HERE, '..', 'bench', 'cases')).slice(0, 4);
  reportConforms(scanAll(join(HERE, '..', 'bench', 'cases'), { repos: cases }), 'cobolwork-report');
  inCopy((tree, dir) => {
    run(['baseline', tree, '--reason', 'r', '--who', 'w', '--expires', '2099-01-01']);
    const out = join(dir, 'r.json');
    run(['scan', tree, '--out', out]);
    const baselined = JSON.parse(readFileSync(out, 'utf8'));
    assert.ok(baselined.suppressed.length > 0 && baselined.summary.baseline);
    reportConforms(baselined, 'cobolwork-report');
    const feed = (name, body) => { const path = join(dir, name); writeFileSync(path, JSON.stringify(body)); return path; };
    const witnessFeeds = [feed('w.json', { version: 1, witness: 'UAT', recorded: '2026-09-29', comment: 'x',
      results: { [baselined.suppressed[0].fingerprint]: { outcome: 'reproduced', by: 'jsmith', on: '2026-09-28', system: 'CICSUAT1' } } })];
    const reachFeeds = [feed('r.json', { extract: 'RACF', retrieved: '2026-09-29', jobs: { NIGHTLY: 'open' }, systems: [] })];
    const executionFeeds = [feed('c.json', { programs: [{ program: 'P2', detail: [{ name: 'MAIN', line: 8, entered: 1 }] }] })];
    const fed = scanAll(tree, { witnessFeeds, reachFeeds, executionFeeds, feedRoot: tree });
    assert.ok(fed.summary.feedWarnings && fed.summary.witnessFeeds && fed.summary.reachFeeds, 'the feeds were read');
    reportConforms(fed, 'cobolwork-report');
  });
});

const git = (dir, ...args) => {
  const r = spawnSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
};

test('flow, inventory, diff, gate, build and provenance documents conform to their schemas', () => {
  inCopy((tree, dir) => {
    git(tree, 'init', '-q');
    git(tree, 'add', '-A');
    git(tree, 'commit', '-qm', 'base');
    const report = JSON.parse(run(['scan', tree]));
    const absolute = cli(['build', tree], [1]);
    assert.ok(absolute.blocking.length > 0, 'an absolute build blocks on what the tree holds');
    conforms(absolute, 'cobolwork-build');
    const p1 = join(tree, 'P1.cbl');
    writeFileSync(p1, readFileSync(p1, 'utf8').replace('MOVE WS-IN TO WS-CMD', 'MOVE "LS" TO WS-CMD'));
    git(tree, 'commit', '-qam', 'head');

    reportConforms(cli(['flow', tree, '--all-routes']), 'cobolwork-flow');
    conforms(cli(['inventory', tree]), 'cobolwork-inventory');
    const diff = cli(['diff', tree, '--base', 'HEAD~1']);
    assert.ok(diff.resolved.length > 0, 'the change resolves a finding');
    reportConforms(diff, 'cobolwork-diff');
    conforms(cli(['gate', tree, '--base', 'HEAD~1', '--target', report.findings[0].fingerprint]), 'cobolwork-gate');
    const provenance = join(dir, 'provenance.json');
    const build = cli(['build', tree, '--base', 'HEAD~1', '--provenance', provenance]);
    conforms(build, 'cobolwork-build');
    conforms(JSON.parse(readFileSync(provenance, 'utf8')), 'cobolwork-build-provenance');
  });
});

test('the flow report describes the estate summary keys as the scan report does', () => {
  const scan = schema('cobolwork-report').properties.summary.properties;
  const flow = schema('cobolwork-flow').properties.summary.properties;
  for (const k of ['siteWarnings', 'feedWarnings', 'byReach', 'reachFeeds', 'witnessFeeds', 'executionFeeds', 'baseline', 'identity', 'toolRevision', 'revision']) {
    assert.deepEqual(flow[k], scan[k], k);
  }
});
