// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadReachFeed, reachResolver, stampReach, stampEffect, reachFeedPaths } from '../lib/reach.mjs';
import { scanAll } from '../lib/scan.mjs';
import { setMemoryReaders } from '../lib/kernel/memory.mjs';
import './pin-machine.mjs';

const MB = 1024 * 1024;
const CASE = join(dirname(fileURLToPath(import.meta.url)), '..', 'bench', 'cases', '037-a-job-parameter-reaches-an-os-command');
const pinned = (fn) => { setMemoryReaders({ heap: () => ({ used_heap_size: 64 * MB, heap_size_limit: 4096 * MB }), free: () => 4096 * MB }); try { return fn(); } finally { setMemoryReaders(); } };

const feedFile = (doc) => {
  const p = join(mkdtempSync(join(tmpdir(), 'cw-reach-')), 'reach.json');
  writeFileSync(p, typeof doc === 'string' ? doc : JSON.stringify(doc));
  return p;
};

test('the site keys resolve a transaction and a job, and declared is true', () => {
  const r = reachResolver({ site: { openTransactions: ['cr00'], restrictedTransactions: ['CADM'], openJobs: ['NIGHTLY'] } });
  assert.equal(r.declared, true);
  assert.equal(r.accessOf('transaction', 'CR00'), 'open');
  assert.equal(r.accessOf('transaction', 'CADM'), 'restricted');
  assert.equal(r.accessOf('job', 'nightly'), 'open');
  assert.equal(r.accessOf('transaction', 'UNKN'), null);
});

test('nothing declared means nobody said, not that nothing is reachable', () => {
  const r = reachResolver({});
  assert.equal(r.declared, false);
  assert.equal(r.accessOf('transaction', 'CR00'), null);
});

test('a brought feed is authoritative over the site keys', () => {
  const feed = loadReachFeed(feedFile({ extract: 'RACF unload estate A', retrieved: '2026-09-01', transactions: { CR00: 'restricted' } }));
  assert.equal(feed.problem, null);
  const r = reachResolver({ feeds: [feed], site: { openTransactions: ['CR00'] } });
  assert.equal(r.accessOf('transaction', 'CR00'), 'restricted', 'the feed wins over the fallback');
});

test('a feed is refused from inside the scanned tree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-reach-tree-'));
  const p = join(dir, 'reach.json');
  writeFileSync(p, JSON.stringify({ extract: 'x', retrieved: '2026-09-01', transactions: {} }));
  assert.match(loadReachFeed(p, { root: dir }).problem, /inside the tree being scanned/);
});

test('a feed with no extract or date, and a bad access, are reported', () => {
  assert.match(loadReachFeed(feedFile({ retrieved: '2026-09-01', transactions: {} })).problem, /which extract/);
  assert.match(loadReachFeed(feedFile({ extract: 'x', transactions: {} })).problem, /when it was retrieved/);
  const f = loadReachFeed(feedFile({ extract: 'x', retrieved: '2026-09-01', transactions: { CR00: 'maybe' } }));
  assert.equal(f.problem, null);
  assert.equal(f.refused.length, 1);
  assert.match(f.refused[0].why, /not "open" or "restricted"/);
});

test('stampReach: open if any entry is open, restricted if all resolved are restricted, else undeclared', () => {
  const r = reachResolver({ site: { openTransactions: ['CR00'], restrictedTransactions: ['CADM'] } });
  const findings = [
    { rule: 'a', startedBy: [{ transaction: 'CADM' }, { transaction: 'CR00' }] },
    { rule: 'b', startedBy: [{ transaction: 'CADM' }] },
    { rule: 'c', startedBy: [{ transaction: 'UNKN' }] },
    { rule: 'd' },
  ];
  const by = stampReach(findings, r);
  assert.equal(findings[0].reach, 'open', 'one open entry makes the finding open');
  assert.equal(findings[1].reach, 'restricted');
  assert.equal(findings[2].reach, 'undeclared');
  assert.equal(findings[3].reach, undefined, 'a finding no entry reaches carries no reach');
  assert.deepEqual(by, { open: 1, restricted: 1, undeclared: 1 });
});

test('stampEffect: an elevated entry makes a finding privileged, and only the positive is claimed', () => {
  const r = reachResolver({ site: { privilegedJobs: ['RUNJOB'], openTransactions: ['CR00'] } });
  assert.equal(r.effectDeclared, true);
  const findings = [
    { rule: 'a', startedBy: [{ job: 'RUNJOB', step: 'S1' }] },
    { rule: 'b', startedBy: [{ transaction: 'CR00' }] },
    { rule: 'c' },
  ];
  const by = stampEffect(findings, r);
  assert.equal(findings[0].effect, 'privileged');
  assert.equal(findings[1].effect, undefined, 'an entry no privileged fact names is unknown, not called safe');
  assert.equal(findings[2].effect, undefined);
  assert.deepEqual(by, { privileged: 1 });
  assert.equal(reachResolver({ site: { openTransactions: ['CR00'] } }).effectDeclared, false, 'access facts alone do not declare authority');
});

test('a reach feed can carry the privileged entries too', () => {
  const feed = loadReachFeed(feedFile({ extract: 'x', retrieved: '2026-09-01', privileged: { jobs: ['RUNJOB'] } }));
  assert.equal(feed.problem, null);
  assert.deepEqual(feed.privileged.jobs, ['RUNJOB']);
  assert.equal(reachResolver({ feeds: [feed] }).privilegedOf('job', 'runjob'), true);
});

test('a scan stamps effect from a privileged fact, and says so when none is declared', () => pinned(() => {
  const bare = scanAll(CASE, { repos: null });
  assert.equal(bare.summary.byEffect, undefined);
  assert.match(bare.summary.effectNote, /no authority facts declared/);

  const sited = scanAll(CASE, { repos: null, site: feedFile({ privilegedJobs: ['RUNJOB'] }) });
  assert.equal(sited.summary.effectNote, undefined);
  assert.deepEqual(sited.summary.byEffect, { privileged: 1 });
  assert.equal(sited.findings.find((f) => f.effect)?.effect, 'privileged');
}));

test('a scan stamps reach from a site file, and says so when none is declared', () => pinned(() => {
  const bare = scanAll(CASE, { repos: null });
  assert.equal(bare.summary.byReach, undefined, 'nothing declared, nothing counted');
  assert.match(bare.summary.reachNote, /no reachability facts declared/);
  assert.ok(bare.findings.filter((f) => f.startedBy).every((f) => f.reach === undefined), 'no reach without a fact');

  const sited = scanAll(CASE, { repos: null, site: feedFile({ openJobs: ['RUNJOB'] }) });
  assert.equal(sited.summary.reachNote, undefined, 'a declared fact needs no note');
  assert.deepEqual(sited.summary.byReach, { open: 1, restricted: 0, undeclared: 0 });
  const open = sited.findings.filter((f) => f.reach === 'open');
  assert.equal(open.length, 1, 'the RUNJOB finding is now judged reachable');
  assert.ok(open[0].startedBy.some((e) => e.job === 'RUNJOB'));
}));

test('a scan names a brought reachability feed, and refuses one inside the tree', () => pinned(() => {
  const feed = feedFile({ extract: 'RACF unload estate A', retrieved: '2026-09-01', jobs: { RUNJOB: 'restricted' } });
  const r = scanAll(CASE, { repos: null, reachFeeds: [feed] });
  assert.deepEqual(r.summary.reachFeeds, [{ file: 'reach.json', extract: 'RACF unload estate A', retrieved: '2026-09-01' }]);
  assert.equal(r.findings.find((f) => f.reach)?.reach, 'restricted', 'the feed decides');
}));

test('reachFeedPaths reads opts, then the environment', () => {
  assert.deepEqual(reachFeedPaths({ reachFeeds: ['/a', '/b'] }), ['/a', '/b']);
  const before = process.env.COBOLWORK_REACH;
  process.env.COBOLWORK_REACH = '/x';
  try { assert.deepEqual(reachFeedPaths({}), ['/x']); } finally { if (before === undefined) delete process.env.COBOLWORK_REACH; else process.env.COBOLWORK_REACH = before; }
});
