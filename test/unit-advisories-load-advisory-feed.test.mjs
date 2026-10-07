// Loads a customer advisory extract, refusing files inside the scanned tree and validating each row (lib/advisories.mjs loadAdvisoryFeed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadAdvisoryFeed } from '../lib/advisories.mjs';
import './pin-machine.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns a feed with a problem when the path cannot be resolved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAdvisoryFeed-'));
  try {
    const missing = join(dir, 'no-such-file.json');
    const feed = loadAdvisoryFeed(missing);
    assert.equal(feed.file, 'no-such-file.json');
    assert.equal(feed.extract, null);
    assert.equal(feed.retrieved, null);
    assert.deepEqual(feed.coverage, {});
    assert.deepEqual(feed.advisories, []);
    assert.deepEqual(feed.refused, []);
    assert.match(feed.problem, /^could not be read \(/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses a feed that is inside the scanned tree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAdvisoryFeed-'));
  try {
    const tree = join(dir, 'tree');
    mkdirSync(tree, { recursive: true });
    const feedPath = join(tree, 'feed.json');
    writeFileSync(feedPath, JSON.stringify({
      extract: 'ibm-z-2024-01',
      retrieved: '2024-01-15',
      coverage: { 'ibm-z': 'full' },
      advisories: []
    }));
    const feed = loadAdvisoryFeed(feedPath, { root: tree });
    assert.equal(feed.file, 'feed.json');
    assert.equal(feed.extract, null);
    assert.equal(feed.retrieved, null);
    assert.deepEqual(feed.coverage, {});
    assert.deepEqual(feed.advisories, []);
    assert.deepEqual(feed.refused, []);
    assert.equal(feed.problem, 'is inside the tree being scanned, where anyone who can read the repository can read it, so it was not loaded');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses a feed that is the scanned tree itself', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAdvisoryFeed-'));
  try {
    const tree = join(dir, 'tree');
    mkdirSync(tree, { recursive: true });
    const feedPath = join(tree, 'feed.json');
    writeFileSync(feedPath, JSON.stringify({
      extract: 'ibm-z-2024-01',
      retrieved: '2024-01-15',
      coverage: { 'ibm-z': 'full' },
      advisories: []
    }));
    const feed = loadAdvisoryFeed(tree, { root: tree });
    assert.equal(feed.file, 'tree');
    assert.equal(feed.extract, null);
    assert.equal(feed.retrieved, null);
    assert.deepEqual(feed.coverage, {});
    assert.deepEqual(feed.advisories, []);
    assert.deepEqual(feed.refused, []);
    assert.equal(feed.problem, 'is inside the tree being scanned, where anyone who can read the repository can read it, so it was not loaded');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a feed with a problem when the file is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAdvisoryFeed-'));
  try {
    const feedPath = join(dir, 'bad.json');
    writeFileSync(feedPath, 'not json at all');
    const feed = loadAdvisoryFeed(feedPath);
    assert.equal(feed.file, 'bad.json');
    assert.equal(feed.extract, null);
    assert.equal(feed.retrieved, null);
    assert.deepEqual(feed.coverage, {});
    assert.deepEqual(feed.advisories, []);
    assert.deepEqual(feed.refused, []);
    assert.match(feed.problem, /^is not JSON \(/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a feed with a problem when extract is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAdvisoryFeed-'));
  try {
    const feedPath = join(dir, 'feed.json');
    writeFileSync(feedPath, JSON.stringify({
      retrieved: '2024-01-15',
      coverage: { 'ibm-z': 'full' },
      advisories: []
    }));
    const feed = loadAdvisoryFeed(feedPath);
    assert.equal(feed.file, 'feed.json');
    assert.equal(feed.extract, null);
    assert.equal(feed.retrieved, null);
    assert.deepEqual(feed.coverage, {});
    assert.deepEqual(feed.advisories, []);
    assert.deepEqual(feed.refused, []);
    assert.equal(feed.problem, 'does not say which extract it is');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a feed with a problem when retrieved is not an ISO date', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAdvisoryFeed-'));
  try {
    const feedPath = join(dir, 'feed.json');
    writeFileSync(feedPath, JSON.stringify({
      extract: 'ibm-z-2024-01',
      retrieved: '2024-01-15T00:00:00Z',
      coverage: { 'ibm-z': 'full' },
      advisories: []
    }));
    const feed = loadAdvisoryFeed(feedPath);
    assert.equal(feed.file, 'feed.json');
    assert.equal(feed.extract, null);
    assert.equal(feed.retrieved, null);
    assert.deepEqual(feed.coverage, {});
    assert.deepEqual(feed.advisories, []);
    assert.deepEqual(feed.refused, []);
    assert.equal(feed.problem, 'does not say when it was retrieved');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns a feed with a problem when advisories is not an array', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAdvisoryFeed-'));
  try {
    const feedPath = join(dir, 'feed.json');
    writeFileSync(feedPath, JSON.stringify({
      extract: 'ibm-z-2024-01',
      retrieved: '2024-01-15',
      coverage: { 'ibm-z': 'full' },
      advisories: 'not an array'
    }));
    const feed = loadAdvisoryFeed(feedPath);
    assert.equal(feed.file, 'feed.json');
    assert.equal(feed.extract, null);
    assert.equal(feed.retrieved, null);
    assert.deepEqual(feed.coverage, {});
    assert.deepEqual(feed.advisories, []);
    assert.deepEqual(feed.refused, []);
    assert.equal(feed.problem, 'holds no advisories');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loads a valid feed with one advisory and no refusals', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAdvisoryFeed-'));
  try {
    const feedPath = join(dir, 'feed.json');
    writeFileSync(feedPath, JSON.stringify({
      extract: 'ibm-z-2024-01',
      retrieved: '2024-01-15',
      coverage: { 'ibm-z': 'full' },
      advisories: [
        {
          id: 'CVE-2024-0001',
          product: 'ibm-z',
          affected: '>= 2.4.0',
          fixedIn: '2.4.1',
          severity: 'high',
          summary: 'Buffer overflow in z/OS',
          source: { doc: 'Z-2024-001' }
        }
      ]
    }));
    const feed = loadAdvisoryFeed(feedPath);
    assert.equal(feed.file, 'feed.json');
    assert.equal(feed.extract, 'ibm-z-2024-01');
    assert.equal(feed.retrieved, '2024-01-15');
    assert.deepEqual(feed.coverage, { 'ibm-z': 'full' });
    assert.equal(feed.advisories.length, 1);
    assert.equal(feed.advisories[0].id, 'CVE-2024-0001');
    assert.equal(feed.advisories[0].product, 'ibm-z');
    assert.equal(feed.advisories[0].affected, '>= 2.4.0');
    assert.equal(feed.advisories[0].fixedIn, '2.4.1');
    assert.equal(feed.advisories[0].severity, 'high');
    assert.equal(feed.advisories[0].summary, 'Buffer overflow in z/OS');
    assert.equal(feed.advisories[0].source.doc, 'Z-2024-001');
    assert.deepEqual(feed.advisories[0].feed, { extract: 'ibm-z-2024-01', retrieved: '2024-01-15' });
    assert.deepEqual(feed.refused, []);
    assert.equal(feed.problem, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses rows with missing or invalid fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAdvisoryFeed-'));
  try {
    const feedPath = join(dir, 'feed.json');
    writeFileSync(feedPath, JSON.stringify({
      extract: 'ibm-z-2024-01',
      retrieved: '2024-01-15',
      coverage: { 'ibm-z': 'full' },
      advisories: [
        {
          product: 'ibm-z',
          affected: '>= 2.4.0',
          fixedIn: '2.4.1',
          severity: 'high',
          summary: 'Missing id'
        },
        {
          id: 'CVE-2024-0002',
          product: 'ibm-z',
          affected: 'not a version range',
          fixedIn: '2.4.1',
          severity: 'high',
          summary: 'Bad affected'
        },
        {
          id: 'CVE-2024-0003',
          product: 'ibm-z',
          affected: '>= 2.4.0',
          fixedIn: '2.4.1',
          severity: 'unknown-sev',
          summary: 'Bad severity'
        },
        {
          id: 'CVE-2024-0004',
          product: 'ibm-z',
          affected: '>= 2.4.0',
          fixedIn: '2.4.1',
          severity: 'high',
          summary: 'Missing source'
        },
        {
          id: 'CVE-2024-0005',
          product: 'ibm-z',
          affected: '>= 2.4.0',
          fixedIn: '2.4.1',
          severity: 'high',
          summary: ''
        }
      ]
    }));
    const feed = loadAdvisoryFeed(feedPath);
    assert.equal(feed.file, 'feed.json');
    assert.equal(feed.extract, 'ibm-z-2024-01');
    assert.equal(feed.retrieved, '2024-01-15');
    assert.deepEqual(feed.coverage, { 'ibm-z': 'full' });
    assert.equal(feed.advisories.length, 0);
    assert.equal(feed.refused.length, 5);
    assert.equal(feed.refused[0].id, null);
    assert.ok(feed.refused[0].problems.includes('id: missing'));
    assert.equal(feed.refused[1].id, 'CVE-2024-0002');
    assert.ok(feed.refused[1].problems.some((p) => p.startsWith("affected: 'not a version range'")));
    assert.equal(feed.refused[2].id, 'CVE-2024-0003');
    assert.ok(feed.refused[2].problems.includes('severity: unknown'));
    assert.equal(feed.refused[3].id, 'CVE-2024-0004');
    assert.ok(feed.refused[3].problems.includes('source.doc: missing'));
    assert.equal(feed.refused[4].id, 'CVE-2024-0005');
    assert.ok(feed.refused[4].problems.includes('summary: missing'));
    assert.equal(feed.problem, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses non-object rows and accepts valid ones in the same feed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadAdvisoryFeed-'));
  try {
    const feedPath = join(dir, 'feed.json');
    writeFileSync(feedPath, JSON.stringify({
      extract: 'ibm-z-2024-01',
      retrieved: '2024-01-15',
      coverage: { 'ibm-z': 'full' },
      advisories: [
        'just a string',
        null,
        {
          id: 'CVE-2024-0010',
          product: 'ibm-z',
          affected: '>= 2.4.0',
          fixedIn: null,
          severity: 'info',
          summary: 'Valid row',
          source: { doc: 'Z-2024-010' }
        }
      ]
    }));
    const feed = loadAdvisoryFeed(feedPath);
    assert.equal(feed.file, 'feed.json');
    assert.equal(feed.extract, 'ibm-z-2024-01');
    assert.equal(feed.retrieved, '2024-01-15');
    assert.deepEqual(feed.coverage, { 'ibm-z': 'full' });
    assert.equal(feed.advisories.length, 1);
    assert.equal(feed.advisories[0].id, 'CVE-2024-0010');
    assert.equal(feed.advisories[0].fixedIn, null);
    assert.equal(feed.advisories[0].severity, 'info');
    assert.equal(feed.advisories[0].summary, 'Valid row');
    assert.equal(feed.advisories[0].source.doc, 'Z-2024-010');
    assert.deepEqual(feed.advisories[0].feed, { extract: 'ibm-z-2024-01', retrieved: '2024-01-15' });
    assert.equal(feed.refused.length, 2);
    assert.deepEqual(feed.refused[0], { id: null, problems: ['row: not an object'] });
    assert.deepEqual(feed.refused[1], { id: null, problems: ['row: not an object'] });
    assert.equal(feed.problem, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
