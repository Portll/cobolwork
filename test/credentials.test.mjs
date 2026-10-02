// The credential rules are a gitleaks configuration, so gitleaks runs them. When it is absent the
// test records a skip naming what to install: a skipped check is not a passing one.
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
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
  const found = run(POSITIVE).map(f => `${basename(f.File)}:${f.StartLine}:${f.RuleID}`).sort();
  assert.deepEqual(found, [
    'auth.cpy:1:cobol-value-credential', 'auth.cpy:2:cobol-value-credential',
    'login.cbl:10:cics-signon-password', 'login.cbl:12:embedded-sql-connect-password',
    'login.cbl:5:cobol-value-credential', 'login.cbl:6:cobol-value-credential',
    'login.cbl:8:embedded-sql-connect-password', 'login.cbl:9:cics-signon-password',
    'payroll.jcl:1:jcl-racf-password', 'payroll.jcl:4:tso-logon-password',
    'payroll.jcl:5:racf-command-password', 'payroll.jcl:7:jcl-racf-password',
    'payroll.jcl:8:jcl-racf-new-password', 'payroll.jcl:8:jcl-racf-password',
  ]);
});

test('placeholders, symbolic parameters, comments and host variables are not credentials', { skip: have ? false : 'gitleaks is not installed' }, () => {
  const findings = run(NEGATIVE);
  assert.deepEqual(findings.map(f => `${f.RuleID}:${f.StartLine}`), []);
});

test('the rules file declares every rule the tests expect', () => {
  const toml = readFileSync(CONFIG, 'utf8');
  for (const id of ['jcl-racf-password', 'jcl-racf-new-password', 'tso-logon-password', 'racf-command-password', 'cobol-value-credential', 'embedded-sql-connect-password', 'cics-signon-password']) {
    assert.ok(toml.includes(`id = "${id}"`), `${id} missing from the rules file`);
  }
  assert.ok(!/\(\?[=!]/.test(toml), 'gitleaks uses Go RE2, which has no lookahead');
});
