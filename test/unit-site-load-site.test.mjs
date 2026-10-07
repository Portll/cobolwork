// Reads and validates the cobolwork.site.json configuration file (lib/site.mjs loadSite).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSite } from '../lib/site.mjs';
import './pin-machine.mjs';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('returns empty config when site file is absent on disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadSite-'));
  try {
    const result = loadSite(dir);
    assert.equal(result.present, false);
    assert.equal(result.path, join(dir, 'cobolwork.site.json'));
    assert.deepEqual(result.productionQualifiers, []);
    assert.deepEqual(result.problems, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('returns empty config when explicit path does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadSite-'));
  try {
    const missing = join(dir, 'nonexistent.json');
    const result = loadSite(dir, missing);
    assert.equal(result.present, false);
    assert.equal(result.path, missing);
    assert.deepEqual(result.problems, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('parses valid site file with production qualifiers uppercased', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadSite-'));
  try {
    const sitePath = join(dir, 'cobolwork.site.json');
    writeFileSync(sitePath, JSON.stringify({
      productionQualifiers: ['prod', 'test'],
      systemNames: ['sys1', 'sys2'],
      runtimeVersions: { cics: '6.2', db2: '12' }
    }));
    const result = loadSite(dir);
    assert.equal(result.present, true);
    assert.equal(result.path, sitePath);
    assert.deepEqual(result.productionQualifiers, ['PROD', 'TEST']);
    assert.deepEqual(result.systemNames, ['SYS1', 'SYS2']);
    assert.deepEqual(result.runtimeVersions, { cics: '6.2', db2: '12' });
    assert.deepEqual(result.problems, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports problem when site file is not valid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadSite-'));
  try {
    const sitePath = join(dir, 'cobolwork.site.json');
    writeFileSync(sitePath, '{ invalid json');
    const result = loadSite(dir);
    assert.equal(result.present, false);
    assert.equal(result.path, sitePath);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /cobolwork\.site\.json is not readable as JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports problem when site file is not a JSON object', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadSite-'));
  try {
    const sitePath = join(dir, 'cobolwork.site.json');
    writeFileSync(sitePath, JSON.stringify(['array', 'not', 'object']));
    const result = loadSite(dir);
    assert.equal(result.present, false);
    assert.equal(result.path, sitePath);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /cobolwork\.site\.json is not a JSON object/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports problem when list field contains non-string values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadSite-'));
  try {
    const sitePath = join(dir, 'cobolwork.site.json');
    writeFileSync(sitePath, JSON.stringify({
      productionQualifiers: ['prod', 123],
      systemNames: ['sys1']
    }));
    const result = loadSite(dir);
    assert.equal(result.present, true);
    assert.deepEqual(result.productionQualifiers, []);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /productionQualifiers: expected an array of strings/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports problem when runtimeVersions is not an object of strings or numbers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadSite-'));
  try {
    const sitePath = join(dir, 'cobolwork.site.json');
    writeFileSync(sitePath, JSON.stringify({
      productionQualifiers: ['prod'],
      systemNames: ['sys1'],
      runtimeVersions: { cics: { version: '6.2' } }
    }));
    const result = loadSite(dir);
    assert.equal(result.present, true);
    assert.deepEqual(result.runtimeVersions, {});
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /runtimeVersions: expected an object of product to version/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports problem when file names neither production qualifier nor system name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadSite-'));
  try {
    const sitePath = join(dir, 'cobolwork.site.json');
    writeFileSync(sitePath, JSON.stringify({
      vendorPacks: ['pack1']
    }));
    const result = loadSite(dir);
    assert.equal(result.present, true);
    assert.deepEqual(result.productionQualifiers, []);
    assert.deepEqual(result.systemNames, []);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /the file names neither a production qualifier nor a system name/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uppercases all string list fields in site configuration', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadSite-'));
  try {
    const sitePath = join(dir, 'cobolwork.site.json');
    writeFileSync(sitePath, JSON.stringify({
      productionQualifiers: ['prod'],
      systemNames: ['sys1'],
      internalReaderDds: ['dd1', 'dd2'],
      internalReaderQueues: ['q1'],
      compilerOptions: ['opt1'],
      apfLibraries: ['lib1'],
      restrictedDatasets: ['ds1'],
      surrogateUsers: ['user1'],
      superuserIds: ['id1'],
      openTransactions: ['txn1'],
      restrictedTransactions: ['txn2'],
      openJobs: ['job1'],
      restrictedJobs: ['job2'],
      privilegedTransactions: ['txn3'],
      privilegedJobs: ['job3']
    }));
    const result = loadSite(dir);
    assert.equal(result.present, true);
    assert.deepEqual(result.internalReaderDds, ['DD1', 'DD2']);
    assert.deepEqual(result.internalReaderQueues, ['Q1']);
    assert.deepEqual(result.compilerOptions, ['OPT1']);
    assert.deepEqual(result.apfLibraries, ['LIB1']);
    assert.deepEqual(result.restrictedDatasets, ['DS1']);
    assert.deepEqual(result.surrogateUsers, ['USER1']);
    assert.deepEqual(result.superuserIds, ['ID1']);
    assert.deepEqual(result.openTransactions, ['TXN1']);
    assert.deepEqual(result.restrictedTransactions, ['TXN2']);
    assert.deepEqual(result.openJobs, ['JOB1']);
    assert.deepEqual(result.restrictedJobs, ['JOB2']);
    assert.deepEqual(result.privilegedTransactions, ['TXN3']);
    assert.deepEqual(result.privilegedJobs, ['JOB3']);
    assert.deepEqual(result.problems, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sets allowUnvalidatedPacks to true only when explicitly true in file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'loadSite-'));
  try {
    const sitePath = join(dir, 'cobolwork.site.json');
    writeFileSync(sitePath, JSON.stringify({
      productionQualifiers: ['prod'],
      systemNames: ['sys1'],
      allowUnvalidatedPacks: true
    }));
    const result = loadSite(dir);
    assert.equal(result.present, true);
    assert.equal(result.allowUnvalidatedPacks, true);
    assert.deepEqual(result.problems, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
