// The credential rules are a gitleaks configuration, so gitleaks runs them. When it is absent the
// test records a skip naming what to install: a skipped check is not a passing one.
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG = join(HERE, '..', 'rules', 'gitleaks-mainframe.toml');
const POSITIVE = join(HERE, 'fixtures', 'credentials', 'positive');
const NEGATIVE = join(HERE, 'fixtures', 'credentials', 'negative');
const have = spawnSync('gitleaks', ['version'], { encoding: 'utf8' }).status === 0;

function run(dir) {
  const tmp = mkdtempSync(join(tmpdir(), 'cobolwork-creds-'));
  const out = join(tmp, 'r.json');
  spawnSync('gitleaks', ['detect', '--no-git', '--no-banner', '--source', dir, '--config', CONFIG, '--report-format', 'json', '--report-path', out], { encoding: 'utf8' });
  const findings = JSON.parse(readFileSync(out, 'utf8') || '[]');
  rmSync(tmp, { recursive: true, force: true });
  return findings;
}

test('planted mainframe credentials are all found', { skip: have ? false : 'gitleaks is not installed' }, () => {
  const rules = run(POSITIVE).map(f => f.RuleID).sort();
  assert.deepEqual([...new Set(rules)].sort(), [
    'cics-signon-password', 'cobol-value-credential', 'embedded-sql-connect-password',
    'jcl-racf-password', 'racf-command-password', 'tso-logon-password',
  ]);
});

test('placeholders, symbolic parameters, comments and host variables are not credentials', { skip: have ? false : 'gitleaks is not installed' }, () => {
  const findings = run(NEGATIVE);
  assert.deepEqual(findings.map(f => `${f.RuleID}:${f.StartLine}`), []);
});

test('the rules file declares every rule the tests expect', () => {
  const toml = readFileSync(CONFIG, 'utf8');
  for (const id of ['jcl-racf-password', 'tso-logon-password', 'racf-command-password', 'cobol-value-credential', 'embedded-sql-connect-password', 'cics-signon-password']) {
    assert.ok(toml.includes(`id = "${id}"`), `${id} missing from the rules file`);
  }
  assert.ok(!/\(\?[=!]/.test(toml), 'gitleaks uses Go RE2, which has no lookahead');
});
