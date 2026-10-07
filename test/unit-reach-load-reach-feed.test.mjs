// Loads a customer reachability extract, refusing it if it sits inside the scanned tree (lib/reach.mjs loadReachFeed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadReachFeed } from '../lib/reach.mjs';
import './pin-machine.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns a problem when the path cannot be resolved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadReachFeed-'));
  try {
    const feed = loadReachFeed(join(dir, 'missing.json'));
    assert.equal(feed.file, 'missing.json');
    assert.equal(feed.extract, null);
    assert.equal(feed.retrieved, null);
    assert.deepEqual(feed.transactions, {});
    assert.deepEqual(feed.jobs, {});
    assert.deepEqual(feed.privileged, { transactions: [], jobs: [] });
    assert.deepEqual(feed.refused, []);
    assert.match(feed.problem, /^could not be read \(/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses a feed directly inside the root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadReachFeed-'));
  try {
    const feedPath = join(dir, 'feed.json');
    writeFileSync(feedPath, JSON.stringify({ extract: 'x', retrieved: '2024-01-01' }));
    const feed = loadReachFeed(feedPath, { root: dir });
    assert.equal(feed.problem, 'is inside the tree being scanned, where anyone who can read the repository can read it, so it was not loaded');
    assert.equal(feed.extract, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses a feed that is inside the root tree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadReachFeed-'));
  try {
    const sub = join(dir, 'sub');
    mkdirSync(sub, { recursive: true });
    const feedPath = join(sub, 'feed.json');
    writeFileSync(feedPath, JSON.stringify({ extract: 'x', retrieved: '2024-01-01' }));
    const feed = loadReachFeed(feedPath, { root: dir });
    assert.equal(feed.problem, 'is inside the tree being scanned, where anyone who can read the repository can read it, so it was not loaded');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts a feed outside the root tree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadReachFeed-'));
  const other = mkdtempSync(join(tmpdir(), 'loadReachFeed-'));
  try {
    const feedPath = join(other, 'feed.json');
    writeFileSync(feedPath, JSON.stringify({ extract: 'x', retrieved: '2024-01-01' }));
    const feed = loadReachFeed(feedPath, { root: dir });
    assert.equal(feed.problem, null);
    assert.equal(feed.extract, 'x');
    assert.equal(feed.retrieved, '2024-01-01');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test('reports a problem when the file is not JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadReachFeed-'));
  try {
    const feedPath = join(dir, 'feed.json');
    writeFileSync(feedPath, 'not json');
    const feed = loadReachFeed(feedPath);
    assert.match(feed.problem, /^is not JSON \(/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a problem when extract is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadReachFeed-'));
  try {
    const feedPath = join(dir, 'feed.json');
    writeFileSync(feedPath, JSON.stringify({ retrieved: '2024-01-01' }));
    const feed = loadReachFeed(feedPath);
    assert.equal(feed.problem, 'does not say which extract it is');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports a problem when retrieved is not an ISO date', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadReachFeed-'));
  try {
    const feedPath = join(dir, 'feed.json');
    writeFileSync(feedPath, JSON.stringify({ extract: 'x', retrieved: '2024-1-1' }));
    const feed = loadReachFeed(feedPath);
    assert.equal(feed.problem, 'does not say when it was retrieved');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uppercases names and records refused entries with invalid access', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadReachFeed-'));
  try {
    const feedPath = join(dir, 'feed.json');
    writeFileSync(feedPath, JSON.stringify({
      extract: 'x',
      retrieved: '2024-01-01',
      transactions: { 'TX1': 'open', 'TX2': 'restricted', 'TX3': 'public' },
      jobs: { 'JOB1': 'open', 'JOB2': 'weird' }
    }));
    const feed = loadReachFeed(feedPath);
    assert.equal(feed.problem, null);
    assert.equal(feed.extract, 'x');
    assert.equal(feed.retrieved, '2024-01-01');
    assert.deepEqual(feed.transactions, { TX1: 'open', TX2: 'restricted' });
    assert.deepEqual(feed.jobs, { JOB1: 'open' });
    assert.deepEqual(feed.refused, [
      { name: 'TX3', why: 'transaction TX3 says access "public", not "open" or "restricted"' },
      { name: 'JOB2', why: 'job JOB2 says access "weird", not "open" or "restricted"' }
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('filters privileged arrays to uppercase strings only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadReachFeed-'));
  try {
    const feedPath = join(dir, 'feed.json');
    writeFileSync(feedPath, JSON.stringify({
      extract: 'x',
      retrieved: '2024-01-01',
      privileged: { transactions: ['tx1', 42, 'tx2'], jobs: ['job1', null, 'job2'] }
    }));
    const feed = loadReachFeed(feedPath);
    assert.deepEqual(feed.privileged, { transactions: ['TX1', 'TX2'], jobs: ['JOB1', 'JOB2'] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
