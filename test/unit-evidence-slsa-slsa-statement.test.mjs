// SLSA provenance statement for a COBOL build (lib/evidence/slsa.mjs slsaStatement).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slsaStatement } from '../lib/evidence/slsa.mjs';
import './pin-machine.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('computes subject with build.json and artifacts under root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'slsaStatement-'));
  try {
    const docBytes = Buffer.from('doc');
    const artPath = join(dir, 'out.cbl');
    writeFileSync(artPath, 'code');
    const provenance = { sources: [], policy: { sha256: 'p', setBy: 'x' }, toolVersion: '1', flowModel: 'f', verdict: 'v', relaxed: false };
    const stmt = slsaStatement({ provenance, docBytes, root: dir, artifacts: [artPath] });
    assert.equal(stmt.subject[0].name, 'build.json');
    assert.equal(stmt.subject[1].name, 'out.cbl');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses basename for artifacts outside root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'slsaStatement-'));
  const otherDir = mkdtempSync(join(tmpdir(), 'slsaStatement-'));
  try {
    const docBytes = Buffer.from('doc');
    const artPath = join(otherDir, 'ext.cbl');
    writeFileSync(artPath, 'ext');
    const provenance = { sources: [], policy: { sha256: 'p', setBy: 'x' }, toolVersion: '1', flowModel: 'f', verdict: 'v', relaxed: false };
    const stmt = slsaStatement({ provenance, docBytes, root: dir, artifacts: [artPath] });
    assert.equal(stmt.subject[1].name, 'ext.cbl');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(otherDir, { recursive: true, force: true });
  }
});

test('throws when artifact cannot be read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'slsaStatement-'));
  try {
    const docBytes = Buffer.from('doc');
    const missing = join(dir, 'nope.cbl');
    const provenance = { sources: [], policy: { sha256: 'p', setBy: 'x' }, toolVersion: '1', flowModel: 'f', verdict: 'v', relaxed: false };
    assert.throws(() => slsaStatement({ provenance, docBytes, root: dir, artifacts: [missing] }), /could not be read/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes compiler in resolvedDependencies with ironwork name', () => {
  const dir = mkdtempSync(join(tmpdir(), 'slsaStatement-'));
  try {
    const docBytes = Buffer.from('doc');
    const compilerPath = join(dir, 'cobc');
    writeFileSync(compilerPath, 'bin');
    const provenance = {
      sources: [],
      compiler: { path: compilerPath, sha256: 'csum', tool: 'ironwork', version: '2.0' },
      policy: { sha256: 'p', setBy: 'x' },
      toolVersion: '1', flowModel: 'f', verdict: 'v', relaxed: false
    };
    const stmt = slsaStatement({ provenance, docBytes, root: dir });
    const deps = stmt.predicate.buildDefinition.resolvedDependencies;
    assert.equal(deps.length, 1);
    assert.equal(deps[0].name, 'ironwork');
    assert.equal(deps[0].uri, 'file:cobc');
    assert.equal(deps[0].digest.sha256, 'csum');
    assert.equal(deps[0].annotations.version, '2.0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('uses basename for non-ironwork compiler', () => {
  const dir = mkdtempSync(join(tmpdir(), 'slsaStatement-'));
  try {
    const docBytes = Buffer.from('doc');
    const compilerPath = join(dir, 'mycobc');
    writeFileSync(compilerPath, 'bin');
    const provenance = {
      sources: [],
      compiler: { path: compilerPath, sha256: 'csum', tool: 'other' },
      policy: { sha256: 'p', setBy: 'x' },
      toolVersion: '1', flowModel: 'f', verdict: 'v', relaxed: false
    };
    const stmt = slsaStatement({ provenance, docBytes, root: dir });
    const deps = stmt.predicate.buildDefinition.resolvedDependencies;
    assert.equal(deps[0].name, 'mycobc');
    assert.equal(deps[0].uri, 'file:mycobc');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('omits compiler when no sha256', () => {
  const dir = mkdtempSync(join(tmpdir(), 'slsaStatement-'));
  try {
    const docBytes = Buffer.from('doc');
    const provenance = {
      sources: [],
      compiler: { path: '/some/path/cobc', tool: 'ironwork' },
      policy: { sha256: 'p', setBy: 'x' },
      toolVersion: '1', flowModel: 'f', verdict: 'v', relaxed: false
    };
    const stmt = slsaStatement({ provenance, docBytes, root: dir });
    assert.equal(stmt.predicate.buildDefinition.resolvedDependencies.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('redacts compiler arguments with equals sign', () => {
  const dir = mkdtempSync(join(tmpdir(), 'slsaStatement-'));
  try {
    const docBytes = Buffer.from('doc');
    const provenance = {
      sources: [],
      compiler: { path: '/cobc', sha256: 'c', argv: ['-I=/include', '-o', 'out.cbl', '-free'] },
      policy: { sha256: 'p', setBy: 'x' },
      toolVersion: '1', flowModel: 'f', verdict: 'v', relaxed: false
    };
    const stmt = slsaStatement({ provenance, docBytes, root: dir });
    const ep = stmt.predicate.buildDefinition.externalParameters;
    assert.deepEqual(ep.compilerArguments, ['-I=<value>', '-o', '<value>', '-free']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('redacts compiler arguments with slash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'slsaStatement-'));
  try {
    const docBytes = Buffer.from('doc');
    const provenance = {
      sources: [],
      compiler: { path: '/cobc', sha256: 'c', argv: ['-I/include', '-o'] },
      policy: { sha256: 'p', setBy: 'x' },
      toolVersion: '1', flowModel: 'f', verdict: 'v', relaxed: false
    };
    const stmt = slsaStatement({ provenance, docBytes, root: dir });
    const ep = stmt.predicate.buildDefinition.externalParameters;
    assert.deepEqual(ep.compilerArguments, ['-I<value>', '-o']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes copylibs and revisions in externalParameters', () => {
  const dir = mkdtempSync(join(tmpdir(), 'slsaStatement-'));
  try {
    const docBytes = Buffer.from('doc');
    const copylib = join(dir, 'lib.cpy');
    writeFileSync(copylib, 'lib');
    const provenance = {
      sources: [{ path: '/src/main.cbl', sha256: 's1' }],
      copylibs: [copylib],
      revisions: { main: 'abc123' },
      policy: { sha256: 'p', setBy: 'x' },
      toolVersion: '1', flowModel: 'f', verdict: 'v', relaxed: false
    };
    const stmt = slsaStatement({ provenance, docBytes, root: dir });
    const ep = stmt.predicate.buildDefinition.externalParameters;
    assert.deepEqual(ep.copylibs, ['lib.cpy']);
    assert.deepEqual(ep.revisions, { main: 'abc123' });
    const deps = stmt.predicate.buildDefinition.resolvedDependencies;
    assert.equal(deps.length, 1);
    assert.equal(deps[0].uri, 'file:/src/main.cbl');
    assert.equal(deps[0].name, '/src/main.cbl');
    assert.equal(deps[0].digest.sha256, 's1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('includes metadata and byproducts when runId and runTip provided', () => {
  const dir = mkdtempSync(join(tmpdir(), 'slsaStatement-'));
  try {
    const docBytes = Buffer.from('doc');
    const provenance = { sources: [], policy: { sha256: 'p', setBy: 'x' }, toolVersion: '1', flowModel: 'f', verdict: 'v', relaxed: false };
    const stmt = slsaStatement({
      provenance, docBytes, root: dir,
      runId: 'run-1', runTip: 'tipsha', builderId: 'custom-builder',
      startedOn: '2024-01-01T00:00:00Z', finishedOn: '2024-01-01T00:01:00Z'
    });
    assert.equal(stmt.predicate.runDetails.builder.id, 'custom-builder');
    assert.equal(stmt.predicate.runDetails.metadata.invocationId, 'run-1');
    assert.equal(stmt.predicate.runDetails.metadata.startedOn, '2024-01-01T00:00:00Z');
    assert.equal(stmt.predicate.runDetails.metadata.finishedOn, '2024-01-01T00:01:00Z');
    assert.equal(stmt.predicate.runDetails.byproducts.length, 1);
    assert.equal(stmt.predicate.runDetails.byproducts[0].name, 'evidence:run:run-1');
    assert.equal(stmt.predicate.runDetails.byproducts[0].digest.sha256, 'tipsha');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
