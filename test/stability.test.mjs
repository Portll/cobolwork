import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capabilities } from '../lib/capabilities.mjs';
import { SITE_VERSION } from '../lib/site.mjs';
import { BASELINE_VERSION } from '../lib/baseline.mjs';
import { BUILD_EXIT } from '../lib/build.mjs';
import { VERDICT_EXIT } from '../lib/gate.mjs';
import { FINGERPRINT_VERSION } from '../lib/kernel/identity.mjs';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STABILITY = readFileSync(join(HERE, '..', 'STABILITY.md'), 'utf8');
const rowNaming = (name) => STABILITY.split('\n').find((l) => l.startsWith('|') && l.includes(name));
const cells = (row) => row.split('|').slice(1, -1).map((c) => c.trim());

test('each document STABILITY.md lists carries the version capabilities gives it', () => {
  const { documents } = capabilities();
  for (const name of ['cobolwork', 'cobolwork-flow', 'cobolwork-inventory', 'cobolwork-diff', 'cobolwork-gate',
    'cobolwork-build', 'cobolwork-build-provenance', 'cobolwork-capabilities', 'cobolwork-explain', 'cobolwork-parse']) {
    const row = rowNaming(`\`${name}\``);
    assert.ok(row, `${name} has a row`);
    assert.equal(cells(row)[1], documents[name] === null ? 'none yet' : String(documents[name]), name);
  }
  assert.equal(cells(rowNaming('SARIF'))[1], documents.sarif);
  assert.equal(cells(rowNaming('CycloneDX'))[1], documents.cyclonedx);
});

test('the files cobolwork reads are listed at the versions it reads', () => {
  assert.equal(cells(rowNaming('`cobolwork.site.json`'))[1], `\`version\`: ${SITE_VERSION}`);
  assert.equal(cells(rowNaming('`cobolwork.baseline.json`'))[1], `\`version\`: ${BASELINE_VERSION}`);
  assert.equal(cells(rowNaming('Build policy'))[1], `\`policyVersion\`: ${capabilities().build.defaultPolicy.policyVersion}`);
});

test('the exit statuses STABILITY.md gives are the ones build and gate use', () => {
  assert.equal(cells(rowNaming('| `build`'))[1],
    `${BUILD_EXIT.pass} pass, ${BUILD_EXIT.fail} fail, ${BUILD_EXIT.undecided} undecided, ${BUILD_EXIT.compilerFailed} the compiler failed after a pass, 2 could not run`);
  assert.equal(cells(rowNaming('| `gate --exit-code`'))[1], `${VERDICT_EXIT.pass} pass, ${VERDICT_EXIT.fail} fail, ${VERDICT_EXIT.undecided} undecided, 2 could not run`);
});

test('STABILITY.md names the fingerprint version in force', () => {
  assert.ok(STABILITY.includes(`\`${FINGERPRINT_VERSION}\``));
});
