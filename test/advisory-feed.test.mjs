import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADVISORIES, COVERAGE, advisoryProblems, versionRangeProblems, loadAdvisoryFeed } from '../lib/advisories.mjs';
import { validate } from '../feed/schema.mjs';
import { scanBuild } from '../lib/sets/build.mjs';
import './pin-machine.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-feed-'));
  for (const [name, text] of Object.entries(files)) {
    const p = join(root, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, typeof text === 'string' ? text : JSON.stringify(text));
  }
  return root;
};
// Every feed here is written at test time, outside the repository: a customer extract is never a
// file this repository holds, fixtures included.
const EXTRACT = 'IBM Z Security Portal export, estate A';
const row = (over = {}) => ({ kind: 'advisory', product: 'cics-ts', id: 'PORTAL-0001', affected: '[5.5,5.6]', fixedIn: '6.1', severity: 'high', summary: 'A crafted request to a CICS region corrupts storage.', source: { doc: 'bulletin 0001' }, ...over });
const feed = (rows, over = {}) => ({ schemaVersion: 1, extract: EXTRACT, retrieved: '2026-09-01', coverage: { 'cics-ts': 'every bulletin the portal lists for CICS TS 5' }, advisories: rows, ...over });
const estate = () => tree({ 'cobolwork.site.json': { runtimeVersions: { 'cics-ts': '5.6' } } });
const feedFile = (doc) => join(tree({ 'feed.json': doc }), 'feed.json');
const portal = (r) => r.findings.filter((f) => /PORTAL-/.test(f.detail));

test('a customer feed adds its advisories to one scan, and the report says it was used', () => {
  const root = estate();
  const r = scanBuild(root, { advisoryFeeds: [feedFile(feed([row()]))] });
  const [f] = portal(r);
  assert.equal(f.rule, 'site-declares-vulnerable-runtime');
  assert.match(f.detail, /which has an advisory: PORTAL-0001; PORTAL-0001 is from the customer feed IBM Z Security Portal export, estate A, retrieved 2026-09-01$/);
  assert.deepEqual(f.related, [{ id: 'PORTAL-0001', feed: EXTRACT }], 'no URL is claimed for a bulletin nobody else can open');
  assert.deepEqual(r.summary.advisoryFeeds, [{ file: 'feed.json', extract: EXTRACT, retrieved: '2026-09-01', loaded: 1, refused: 0 }]);
  assert.match(r.summary.advisoryCoverage['cics-ts'], /; customer feed IBM Z Security Portal export, estate A, retrieved 2026-09-01: every bulletin the portal lists for CICS TS 5$/);

  const without = scanBuild(root);
  assert.equal(portal(without).length, 0);
  assert.equal(without.summary.advisoryFeeds, undefined, 'a scan with no feed cannot be mistaken for one with');
  assert.doesNotMatch(without.summary.advisoryCoverage['cics-ts'], /customer feed/);
});

test('a feed inside the tree being scanned is not loaded, and the set says it did not check it', () => {
  const root = tree({ 'cobolwork.site.json': { runtimeVersions: { 'cics-ts': '5.6' } }, 'private/feed.json': feed([row()]) });
  const r = scanBuild(root, { advisoryFeeds: [join(root, 'private', 'feed.json')] });
  assert.equal(portal(r).length, 0);
  assert.equal(r.summary.setIncomplete, true);
  assert.match(r.summary.notLooked[0], /^the advisory feed feed\.json is inside the tree being scanned, where anyone who can read the repository can read it/);
  assert.equal(r.summary.advisoryFeeds[0].loaded, 0);
});

test('a row the advisory gate refuses is named, and the rest of the feed loads', () => {
  const r = scanBuild(estate(), { advisoryFeeds: [feedFile(feed([row(), row({ id: 'PORTAL-0002', affected: 'every 5.x', summary: '' })]))] });
  assert.equal(portal(r).length, 1);
  assert.equal(r.summary.advisoryFeeds[0].refused, 1);
  assert.equal(r.summary.setIncomplete, true);
  assert.match(r.summary.notLooked[0], /had 1 of 2 rows refused by the advisory gate, the first PORTAL-0002: summary: missing/);

  const unnamed = loadAdvisoryFeed(feedFile(feed([row()], { extract: '' })));
  assert.equal(unnamed.problem, 'does not say which extract it is');
  assert.equal(unnamed.advisories.length, 0, 'a feed that cannot say where it came from loads nothing');
  assert.equal(loadAdvisoryFeed(feedFile(feed([row({ source: {} })]))).refused[0].problems[0], 'source.doc: missing');
});

test('COBOLWORK_ADVISORIES names the feeds when the caller does not, read when the scan runs', () => {
  const path = feedFile(feed([row()]));
  const before = process.env.COBOLWORK_ADVISORIES;
  process.env.COBOLWORK_ADVISORIES = path;
  try {
    assert.equal(portal(scanBuild(estate())).length, 1);
  } finally {
    if (before === undefined) delete process.env.COBOLWORK_ADVISORIES; else process.env.COBOLWORK_ADVISORIES = before;
  }
});

// Every file, whatever it is called: a portal download is as likely to be extract.txt as .json, and
// the harm is the file being in the repository, not the loader reading it.
test('no customer extract is kept in this repository, under rules/ or anywhere else', () => {
  const found = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '.claude') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && statSync(p).size < 4e6) {
        const text = readFileSync(p, 'latin1');
        if (/"extract"\s*:/.test(text) && /"advisories"\s*:/.test(text)) found.push(p.slice(REPO.length + 1));
      }
    }
  };
  walk(REPO);
  assert.deepEqual(found, []);
});

test('a public row and a customer row are held to one shape', () => {
  for (const a of ADVISORIES.advisories) {
    assert.deepEqual([...advisoryProblems(a), ...versionRangeProblems(a.affected)], [], `${a.id} would load from a customer feed`);
  }
  const bad = { kind: 'advisory', product: 'gnucobol', id: '', affected: '2.2', fixedIn: 3, severity: 'grave', summary: 'x', source: { doc: 'nvd', url: 'u', retrieved: '2026-01-01', quote: 'q'.repeat(40) } };
  const publicProblems = validate(bad);
  for (const p of advisoryProblems(bad)) assert.ok(publicProblems.includes(p), `the public gate reports "${p}" too`);
});

test('a whole scan and its SARIF say which feed was used', async () => {
  const { scanAll } = await import('../lib/scan.mjs');
  const { toSarif } = await import('../lib/sarif.mjs');
  const r = scanAll(estate(), { advisoryFeeds: [feedFile(feed([row()]))], only: ['build'] });
  assert.equal(r.summary.advisoryFeeds[0].extract, EXTRACT);
  assert.equal(toSarif(r).runs[0].invocations[0].properties['cobolwork/advisoryFeeds'][0].loaded, 1);
  const plain = scanAll(estate(), { only: ['build'] });
  assert.equal(plain.summary.advisoryFeeds, undefined);
  assert.equal(toSarif(plain).runs[0].invocations[0].properties['cobolwork/advisoryFeeds'], undefined);
});

// A scan with no advisory finding has to say which products that silence covers, or a product
// nobody searched reads the same as one searched and found clean.
test('a whole scan and its SARIF say which products the advisory rules searched', async () => {
  const { scanAll } = await import('../lib/scan.mjs');
  const { toSarif } = await import('../lib/sarif.mjs');
  const plain = scanAll(estate(), { only: ['build'] });
  assert.deepEqual(plain.summary.advisoryCoverage, COVERAGE);
  assert.deepEqual(toSarif(plain).runs[0].invocations[0].properties['cobolwork/advisoryCoverage'], COVERAGE);
  const fed = scanAll(estate(), { advisoryFeeds: [feedFile(feed([row()]))], only: ['build'] });
  assert.ok(Object.values(fed.summary.advisoryCoverage).some((v) => v.includes(`customer feed ${EXTRACT}`)), 'a feed adds what it covers');
});
