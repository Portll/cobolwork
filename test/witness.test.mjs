// A witness result may cite the ironwork run that reproduced the finding (docs/spec/reach.md §9.5).
// The evidence is a real `bench/label.mjs` run over test/fixtures/label/batch, which confirmed the
// marker reaching PGMREAD's dynamic CALL at line 19.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, cpSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanAll } from '../lib/scan.mjs';
import { loadWitnessFeed } from '../lib/exploitability.mjs';
import { witnessFeed } from '../bench/witness.mjs';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BATCH = join(HERE, 'fixtures', 'label', 'batch');
const EVIDENCE = join(HERE, 'fixtures', 'witness', 'evidence');
const RUN = '20261001T030408Z-e285af3a9a9d84dc';
const READ = 'fa76fbe842458e808223b9edc48402ff';
const GATE = 'f5427685ae614b73ad5e0eafe8d5fe71';

function withFeed(results, fn, evidence = EVIDENCE) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-witness-run-'));
  try {
    const feed = join(dir, 'feed.json');
    writeFileSync(feed, JSON.stringify({ witness: 'ironwork execution labels', recorded: '2026-10-01', results: results(evidence, dir) }));
    return fn(feed, dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const reproduced = (evidence) => ({ outcome: 'reproduced', by: 'bench/label.mjs', on: '2026-10-01', system: 'ironwork', evidence });

test('a result citing a verified run confirms the finding at the line its journal names', () => withFeed((ev) => ({ [READ]: reproduced({ dir: ev, run: RUN }) }), (feed) => {
  const r = scanAll(BATCH, { only: ['flow'], witnessFeeds: [feed] });
  const f = r.findings.find((x) => x.fingerprint === READ);
  assert.equal(f.exploitability.verdict, 'confirmed');
  assert.match(f.exploitability.because.at(-1), /verified journal records the marker reaching the dynamic-program-load operation at PGMREAD\.cbl:19$/);
  assert.notEqual(r.findings.find((x) => x.fingerprint === GATE).exploitability.verdict, 'confirmed');
}));

test('a run whose journal places the operation elsewhere confirms nothing', () => withFeed((ev) => ({ [GATE]: reproduced({ dir: ev, run: RUN }) }), (feed) => {
  const r = scanAll(BATCH, { only: ['flow'], witnessFeeds: [feed] });
  assert.notEqual(r.findings.find((x) => x.fingerprint === GATE).exploitability.verdict, 'confirmed');
  assert.deepEqual(r.summary.witnessUnmatched, [GATE]);
}));

test('evidence that does not verify, or a run it does not hold, is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-witness-tampered-'));
  try {
    const copy = join(dir, 'evidence');
    cpSync(EVIDENCE, copy, { recursive: true });
    const journal = join(copy, 'runs', `${RUN}.jsonl`);
    writeFileSync(journal, readFileSync(journal, 'utf8').replace('"reached":true', '"reached":false'));
    withFeed((ev) => ({ [READ]: reproduced({ dir: ev, run: RUN }) }), (feed) => {
      const loaded = loadWitnessFeed(feed);
      assert.equal(loaded.results.size, 0);
      assert.match(loaded.refused[0].why, /does not verify/);
    }, copy);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  withFeed((ev) => ({ [READ]: reproduced({ dir: ev, run: '20261001T000000Z-0000000000000000' }) }), (feed) => {
    assert.match(loadWitnessFeed(feed).refused[0].why, /does not record|does not hold/);
  });
  withFeed(() => ({ [READ]: reproduced({ dir: 'x' }) }), (feed) => {
    assert.match(loadWitnessFeed(feed).refused[0].why, /without a directory and a run/);
  });
});

test('bench/witness.mjs writes a reproduced result per confirmed execution label, citing its run', () => {
  const feed = witnessFeed({ evidence: EVIDENCE, labels: [
    { source: 'execution', rule: 'r', fingerprint: READ, label: 'confirmed', run: RUN, variant: 'records shifted 7' },
    { source: 'execution', rule: 'r', fingerprint: GATE, label: 'unknown' },
  ] }, { recorded: '2026-10-01' });
  assert.deepEqual(Object.keys(feed.results), [READ]);
  assert.deepEqual(feed.results[READ], { outcome: 'reproduced', by: 'bench/label.mjs', on: '2026-10-01', system: 'ironwork', reference: 'records shifted 7', evidence: { dir: EVIDENCE, run: RUN } });
});
