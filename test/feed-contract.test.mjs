import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWitnessFeed, WITNESS_VERSION } from '../lib/exploitability.mjs';
import { loadReachFeed, REACH_VERSION } from '../lib/reach.mjs';
import { loadExecutionFeed } from '../lib/execution.mjs';
import { scanAll } from '../lib/scan.mjs';
import { toSarif } from '../lib/sarif.mjs';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const schema = (name) => JSON.parse(readFileSync(join(HERE, '..', 'schema', `cobolwork-${name}.schema.json`), 'utf8'));

const inTemp = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-feed-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const feedAt = (dir, name, body) => {
  const path = join(dir, name);
  writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body));
  return path;
};

const WITNESS = { witness: 'UAT', recorded: '2026-09-29', results: { abc: { outcome: 'reproduced', by: 'jsmith', on: '2026-09-28', system: 'CICSUAT1', reference: 'CHG1' } } };
const REACH = { extract: 'RACF unload', retrieved: '2026-09-29', transactions: { INQ1: 'open' }, jobs: { PAYJOB: 'restricted' }, privileged: { transactions: ['INQ1'], jobs: [] } };

test('the witness schema describes every key the witness feed is read for', () => {
  const s = schema('witness');
  assert.deepEqual(Object.keys(s.properties).sort(), ['$schema', 'recorded', 'results', 'version', 'witness']);
  assert.deepEqual(Object.keys(s.$defs.result.properties).sort(), ['by', 'evidence', 'on', 'outcome', 'reference', 'system']);
  assert.equal(s.properties.version.maximum, WITNESS_VERSION);
});

test('the reach schema describes every key the reach extract is read for', () => {
  const s = schema('reach');
  assert.deepEqual(Object.keys(s.properties).sort(), ['$schema', 'extract', 'jobs', 'privileged', 'retrieved', 'transactions', 'version']);
  assert.deepEqual(Object.keys(s.properties.privileged.properties).sort(), ['jobs', 'transactions']);
  assert.equal(s.properties.version.maximum, REACH_VERSION);
});

test('a feed with no version, version 0 or version 1 is read with no warning', () => {
  inTemp((dir) => {
    for (const version of [undefined, 0, 1]) {
      const w = loadWitnessFeed(feedAt(dir, 'w.json', { ...WITNESS, version }));
      assert.equal(w.problem, null, `witness ${version}`);
      assert.deepEqual(w.warnings, []);
      assert.equal(w.results.size, 1);
      const r = loadReachFeed(feedAt(dir, 'r.json', { ...REACH, version }));
      assert.equal(r.problem, null, `reach ${version}`);
      assert.deepEqual(r.warnings, []);
      assert.equal(r.transactions.INQ1, 'open');
    }
  });
});

test('a newer feed version is not loaded, and the problem names both versions', () => {
  inTemp((dir) => {
    const w = loadWitnessFeed(feedAt(dir, 'w.json', { ...WITNESS, version: WITNESS_VERSION + 1 }));
    assert.equal(w.problem, `is version ${WITNESS_VERSION + 1}, and this cobolwork reads up to version ${WITNESS_VERSION}; upgrade cobolwork`);
    assert.equal(w.results.size, 0);
    const r = loadReachFeed(feedAt(dir, 'r.json', { ...REACH, version: '1' }));
    assert.match(r.problem, /^has version "1", which is not a whole number from 0$/);
    assert.deepEqual(r.transactions, {});
  });
});

test('a feed that is not a JSON object is not loaded', () => {
  inTemp((dir) => {
    for (const body of ['null', '[]', '7']) {
      assert.equal(loadWitnessFeed(feedAt(dir, 'w.json', body)).problem, 'is not a JSON object', body);
      assert.equal(loadReachFeed(feedAt(dir, 'r.json', body)).problem, 'is not a JSON object', body);
    }
  });
});

test('a key a feed does not hold is warned of and the rest is still read', () => {
  inTemp((dir) => {
    const results = { abc: { ...WITNESS.results.abc, sent: 'x', _note: 'y' }, def: { ...WITNESS.results.abc, sent: 'z' } };
    const w = loadWitnessFeed(feedAt(dir, 'w.json', { ...WITNESS, results, comment: 'x', _from: 'y' }));
    assert.deepEqual(w.warnings, [
      'w.json: "comment" is not a key this cobolwork reads, so it was ignored',
      'w.json results: "sent" is not a key this cobolwork reads, so it was ignored',
    ]);
    assert.equal(w.results.size, 2);
    const r = loadReachFeed(feedAt(dir, 'r.json', { ...REACH, privileged: { ...REACH.privileged, users: [] }, systems: [] }));
    assert.deepEqual(r.warnings, [
      'r.json: "systems" is not a key this cobolwork reads, so it was ignored',
      'r.json privileged: "users" is not a key this cobolwork reads, so it was ignored',
    ]);
    assert.deepEqual(r.privileged.transactions, ['INQ1']);
  });
});

test('a scan reports feed warnings in its summary and as SARIF configuration notifications', () => {
  inTemp((dir) => {
    const tree = join(dir, 'tree');
    const feeds = join(dir, 'feeds');
    mkdirSync(tree);
    mkdirSync(feeds);
    writeFileSync(join(tree, 'A.cbl'), '       IDENTIFICATION DIVISION.\n       PROGRAM-ID. A.\n       PROCEDURE DIVISION.\n           GOBACK.\n');
    const witness = feedAt(feeds, 'w.json', { ...WITNESS, comment: 'x' });
    const reach = feedAt(feeds, 'r.json', { ...REACH, systems: [] });
    const report = scanAll(tree, { witnessFeeds: [witness], reachFeeds: [reach] });
    assert.deepEqual(report.summary.feedWarnings, [
      'r.json: "systems" is not a key this cobolwork reads, so it was ignored',
      'w.json: "comment" is not a key this cobolwork reads, so it was ignored',
    ]);
    const notes = toSarif(report).runs[0].invocations[0].toolConfigurationNotifications;
    assert.deepEqual(notes.filter((n) => n.descriptor.id === 'cobolwork/feed-key-ignored').map((n) => n.message.text), report.summary.feedWarnings);
  });
});

test('the execution schema names the keys an execution report is read for', () => {
  const s = schema('execution');
  const program = s.properties.programs.items;
  assert.deepEqual(program.required, ['program', 'detail']);
  assert.deepEqual(Object.keys(program.properties.detail.items.properties).sort(), ['entered', 'line', 'name']);
  assert.equal(s.additionalProperties, undefined, 'ironwork\'s other keys are allowed');
  inTemp((dir) => {
    const ok = loadExecutionFeed(feedAt(dir, 'c.json', { programs: [{ program: 'A', detail: [{ name: 'MAIN', line: 4, entered: 2 }], statements: [] }], format: 'x' }));
    assert.equal(ok.problem, null);
    assert.deepEqual(ok.programs.get('A'), [{ name: 'MAIN', line: 4, entered: 2 }]);
    const bad = loadExecutionFeed(feedAt(dir, 'd.json', { programs: [{ program: 'A', detail: [{ name: 'MAIN', line: 4, entered: -1 }] }] }));
    assert.match(bad.problem, /not \{ name, line, entered \}/);
  });
});
