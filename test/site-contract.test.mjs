import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSite, SITE_FILE, SITE_VERSION } from '../lib/site.mjs';
import { scanAll } from '../lib/scan.mjs';
import { toSarif } from '../lib/sarif.mjs';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(readFileSync(join(HERE, '..', 'schema', 'cobolwork.site.schema.json'), 'utf8'));

const withSite = (body, fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-site-'));
  try {
    writeFileSync(join(dir, SITE_FILE), typeof body === 'string' ? body : JSON.stringify(body));
    return fn(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
};

const READ_KEYS = Object.keys(loadSite(tmpdir() + '/cw-no-such-dir')).filter((k) => !['present', 'path', 'problems', 'warnings'].includes(k)).sort();

test('the schema describes every key the site file is read for, and no other', () => {
  const described = Object.keys(SCHEMA.properties).filter((k) => !['$schema', 'version'].includes(k)).sort();
  assert.deepEqual(described, READ_KEYS);
  assert.equal(SCHEMA.properties.version.maximum, SITE_VERSION);
  assert.equal(SCHEMA.additionalProperties, false);
});

test('a file with every key the schema describes is read without a warning', () => {
  const body = { $schema: 'x', version: SITE_VERSION, allowUnvalidatedPacks: false, runtimeVersions: { CICS: '6.1' }, flowWalk: { walkEdges: 1000, totalEdges: 100000, minWalkEdges: 10 } };
  for (const k of READ_KEYS) if (!(k in body)) body[k] = ['PROD'];
  withSite(body, (dir) => {
    const site = loadSite(dir);
    assert.deepEqual(site.warnings, []);
    assert.deepEqual(site.problems, []);
  });
});

test('flowWalk takes whole numbers of edges and names anything else', () => {
  withSite({ systemNames: ['PAYR'], flowWalk: { walkEdges: 5000, totalEdges: 2.5, minWalkEdges: 0, edges: 1 } }, (dir) => {
    const site = loadSite(dir);
    assert.deepEqual(site.flowWalk, { walkEdges: 5000 });
    assert.deepEqual(site.problems, [
      'flowWalk.totalEdges: expected a whole number of edges, 1 or more',
      'flowWalk.minWalkEdges: expected a whole number of edges, 1 or more',
      'flowWalk.edges: not a key this cobolwork reads',
    ]);
  });
  withSite({ systemNames: ['PAYR'], flowWalk: [1] }, (dir) => {
    assert.deepEqual(loadSite(dir).problems, ['flowWalk: expected an object']);
  });
});

test('a key the site file does not hold is warned of and the rest is still read', () => {
  withSite({ productionQualifer: ['PROD'], systemNames: ['PAYR'], _comment: 'drafted', _from: {} }, (dir) => {
    const site = loadSite(dir);
    assert.deepEqual(site.warnings, [`${SITE_FILE}: "productionQualifer" is not a key this cobolwork reads, so it was ignored`]);
    assert.deepEqual(site.systemNames, ['PAYR']);
    assert.deepEqual(site.problems, []);
  });
});

test('a file without a version is read as version 0, and version 1 the same way', () => {
  for (const body of [{ systemNames: ['PAYR'] }, { version: 0, systemNames: ['PAYR'] }, { version: 1, systemNames: ['PAYR'] }]) {
    withSite(body, (dir) => {
      const site = loadSite(dir);
      assert.equal(site.present, true, JSON.stringify(body));
      assert.deepEqual(site.systemNames, ['PAYR']);
      assert.deepEqual(site.warnings, []);
    });
  }
});

test('a newer version is not read, and the problem names both versions', () => {
  withSite({ version: SITE_VERSION + 1, systemNames: ['PAYR'] }, (dir) => {
    const site = loadSite(dir);
    assert.equal(site.present, false);
    assert.deepEqual(site.systemNames, []);
    assert.deepEqual(site.problems, [`${SITE_FILE} is version ${SITE_VERSION + 1}, and this cobolwork reads up to version ${SITE_VERSION}; upgrade cobolwork, so it was not read`]);
  });
});

test('a version that is not a whole number from 0 is not read', () => {
  for (const version of ['1', -1, 1.5, null]) {
    withSite({ version, systemNames: ['PAYR'] }, (dir) => {
      const site = loadSite(dir);
      assert.equal(site.present, false, JSON.stringify(version));
      assert.match(site.problems[0], /is not a whole number from 0, so it was not read$/);
    });
  }
});

test('a scan reports the ignored key in its summary and as a SARIF configuration notification', () => {
  withSite({ productionQualifer: ['PROD'] }, (dir) => {
    writeFileSync(join(dir, 'A.cbl'), '       IDENTIFICATION DIVISION.\n       PROGRAM-ID. A.\n       PROCEDURE DIVISION.\n           GOBACK.\n');
    const report = scanAll(dir);
    assert.deepEqual(report.summary.siteWarnings, [`${SITE_FILE}: "productionQualifer" is not a key this cobolwork reads, so it was ignored`]);
    const notes = toSarif(report).runs[0].invocations[0].toolConfigurationNotifications;
    const ignored = notes.filter((n) => n.descriptor.id === 'cobolwork/site-key-ignored');
    assert.deepEqual(ignored.map((n) => n.message.text), report.summary.siteWarnings);
  });
});

test('a scan of a site file with no unknown key carries no siteWarnings', () => {
  withSite({ productionQualifiers: ['PROD'] }, (dir) => {
    writeFileSync(join(dir, 'A.cbl'), '       IDENTIFICATION DIVISION.\n       PROGRAM-ID. A.\n       PROCEDURE DIVISION.\n           GOBACK.\n');
    assert.equal(scanAll(dir).summary.siteWarnings, undefined);
  });
});
