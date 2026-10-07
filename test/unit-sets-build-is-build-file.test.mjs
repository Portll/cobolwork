// Detects conventional build and CI configuration file names (lib/sets/build.mjs isBuildFile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBuildFile } from '../lib/sets/build.mjs';
import './pin-machine.mjs';

test('returns true for Dockerfile and Containerfile with or without extensions', () => {
  assert.equal(isBuildFile('Dockerfile'), true);
  assert.equal(isBuildFile('dockerfile'), true);
  assert.equal(isBuildFile('Dockerfile.dev'), true);
  assert.equal(isBuildFile('Containerfile'), true);
  assert.equal(isBuildFile('containerfile.prod'), true);
});

test('returns true for Makefile, GNUmakefile, and .mk files', () => {
  assert.equal(isBuildFile('Makefile'), true);
  assert.equal(isBuildFile('makefile'), true);
  assert.equal(isBuildFile('GNUmakefile'), true);
  assert.equal(isBuildFile('gnumakefile'), true);
  assert.equal(isBuildFile('rules.mk'), true);
  assert.equal(isBuildFile('RULES.MK'), true);
});

test('returns true for tool version pin files', () => {
  assert.equal(isBuildFile('.tool-versions'), true);
  assert.equal(isBuildFile('.gnucobol-version'), true);
  assert.equal(isBuildFile('.cobc-version'), true);
});

test('returns true for CI pipeline and compose files', () => {
  assert.equal(isBuildFile('Jenkinsfile'), true);
  assert.equal(isBuildFile('jenkinsfile'), true);
  assert.equal(isBuildFile('azure-pipelines.yaml'), true);
  assert.equal(isBuildFile('azure-pipelines.yml'), true);
  assert.equal(isBuildFile('.gitlab-ci.yaml'), true);
  assert.equal(isBuildFile('.gitlab-ci.yml'), true);
  assert.equal(isBuildFile('docker-compose.yaml'), true);
  assert.equal(isBuildFile('docker-compose.yml'), true);
});

test('returns true for GitHub Actions workflow YAML files', () => {
  assert.equal(isBuildFile('repo/.github/workflows/ci.yaml'), true);
  assert.equal(isBuildFile('repo/.github/workflows/ci.yml'), true);
  assert.equal(isBuildFile('repo\\.github\\workflows\\ci.yaml'), true);
  assert.equal(isBuildFile('repo/.github/workflows/ci.txt'), false);
});

test('returns true for shell script files', () => {
  assert.equal(isBuildFile('build.sh'), true);
  assert.equal(isBuildFile('build.bash'), true);
  assert.equal(isBuildFile('BUILD.SH'), true);
});

test('returns true for package manager and build tool files', () => {
  assert.equal(isBuildFile('package.json'), true);
  assert.equal(isBuildFile('pom.xml'), true);
  assert.equal(isBuildFile('build.gradle'), true);
  assert.equal(isBuildFile('build.gradle.kts'), true);
});

test('returns false for non-build files', () => {
  assert.equal(isBuildFile('README.md'), false);
  assert.equal(isBuildFile('main.cob'), false);
  assert.equal(isBuildFile('config.json'), false);
  assert.equal(isBuildFile('script.py'), false);
});
