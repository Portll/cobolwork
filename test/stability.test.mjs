import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capabilities } from '../lib/capabilities.mjs';
import { SITE_VERSION } from '../lib/site.mjs';
import { BASELINE_VERSION } from '../lib/baseline.mjs';
import { WITNESS_VERSION } from '../lib/exploitability.mjs';
import { REACH_VERSION } from '../lib/reach.mjs';
import { BUILD_EXIT } from '../lib/build.mjs';
import { VERDICT_EXIT } from '../lib/gate.mjs';
import { EXIT } from '../lib/exit.mjs';
import { FINGERPRINT_VERSION } from '../lib/kernel/identity.mjs';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STABILITY = readFileSync(join(HERE, '..', 'STABILITY.md'), 'utf8');
const rowNaming = (name) => STABILITY.split('\n').find((l) => l.startsWith('|') && l.includes(name));
const cells = (row) => row.split('|').slice(1, -1).map((c) => c.trim());

test('each document STABILITY.md lists carries the version capabilities gives it', () => {
  const { documents } = capabilities();
  for (const name of ['cobolwork', 'cobolwork-flow', 'cobolwork-inventory', 'cobolwork-diff', 'cobolwork-gate',
    'cobolwork-build', 'cobolwork-build-provenance', 'cobolwork-capabilities', 'cobolwork-explain', 'cobolwork-parse',
    'cobolwork-baseline', 'cobolwork-evidence']) {
    const row = rowNaming(`\`${name}\``);
    assert.ok(row, `${name} has a row`);
    assert.equal(cells(row)[1], String(documents[name]), name);
  }
  assert.equal(cells(rowNaming('SARIF'))[1], documents.sarif);
  assert.equal(cells(rowNaming('CycloneDX'))[1], documents.cyclonedx);
});

test('the files cobolwork reads are listed at the versions it reads', () => {
  assert.equal(cells(rowNaming('`cobolwork.site.json`'))[1], `\`version\`: ${SITE_VERSION}`);
  assert.equal(cells(rowNaming('`cobolwork.baseline.json`'))[1], `\`version\`: ${BASELINE_VERSION}`);
  assert.equal(cells(rowNaming('`COBOLWORK_WITNESS`'))[1], `\`version\`: ${WITNESS_VERSION}`);
  assert.equal(cells(rowNaming('`COBOLWORK_REACH`'))[1], `\`version\`: ${REACH_VERSION}`);
  assert.equal(cells(rowNaming('Build policy'))[1], `\`policyVersion\`: ${capabilities().build.defaultPolicy.policyVersion}`);
});

test('the exit statuses STABILITY.md gives are the ones build, gate and evidence verify use', () => {
  assert.equal(cells(rowNaming('| Every command'))[1], `${EXIT.pass} done; ${EXIT.couldNotRun} a usage error, or the command could not run`);
  assert.equal(cells(rowNaming('| `build`'))[1],
    `${BUILD_EXIT.pass} pass, ${BUILD_EXIT.fail} fail, ${BUILD_EXIT.undecided} undecided, ${BUILD_EXIT.compilerFailed} the compiler failed after a pass, ${EXIT.couldNotRun} could not run`);
  assert.equal(cells(rowNaming('| `gate --exit-code`'))[1], `${VERDICT_EXIT.pass} pass, ${VERDICT_EXIT.fail} fail, ${VERDICT_EXIT.undecided} undecided, ${EXIT.couldNotRun} could not run`);
  assert.equal(cells(rowNaming('| `evidence verify`'))[1], `${EXIT.pass} verified and sealed, ${EXIT.fail} broken or not sealed, ${EXIT.undecided} undetermined, ${EXIT.couldNotRun} could not run`);
  assert.deepEqual(capabilities().build.exit, { ...BUILD_EXIT, couldNotRun: EXIT.couldNotRun });
  assert.deepEqual(capabilities().gate.exit, { ...VERDICT_EXIT, couldNotRun: EXIT.couldNotRun });
});

test('the table cobolwork shares with ironwork gives each status cobolwork uses one meaning', () => {
  const at = STABILITY.indexOf('## Exit statuses');
  const section = STABILITY.slice(at, STABILITY.indexOf('\n## ', at));
  const meaning = Object.fromEntries(section.split('\n').filter((l) => /^\| \d+ \|/.test(l)).map((l) => cells(l)).map(([s, m]) => [Number(s), m]));
  assert.deepEqual(Object.keys(meaning).map(Number), Object.values(EXIT).sort((a, b) => a - b));
  assert.match(meaning[EXIT.pass], /answered yes/);
  assert.match(meaning[EXIT.fail], /the verdict is no/);
  assert.match(meaning[EXIT.couldNotRun], /^It could not run/);
  assert.match(meaning[EXIT.undecided], /^Undecided/);
  assert.match(meaning[EXIT.compilerFailed], /^The compiler refused a program/);
});

test('STABILITY.md names every schema in schema/', () => {
  const missing = readdirSync(join(HERE, '..', 'schema')).filter((f) => f.endsWith('.schema.json') && !STABILITY.includes(`schema/${f}`));
  assert.deepEqual(missing, []);
});

test('STABILITY.md names the fingerprint version in force', () => {
  assert.ok(STABILITY.includes(`\`${FINGERPRINT_VERSION}\``));
});
