// Credentials in COBOL source, found with the shapes rules/gitleaks-mainframe.toml gives gitleaks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanSecrets, jsRegex, SHAPE_RULES } from '../lib/sets/secrets.mjs';
import { blockingReason } from '../lib/build.mjs';
import { DEFAULT_POLICY } from '../lib/policy.mjs';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG = join(HERE, '..', 'rules', 'gitleaks-mainframe.toml');
const POSITIVE = join(HERE, 'fixtures', 'credentials', 'positive');
const NEGATIVE = join(HERE, 'fixtures', 'credentials', 'negative');
const SHAPES = SHAPE_RULES.map((s) => s.id);
const shapeOf = (f) => /\(([a-z-]+)\)$/.exec(f.detail)[1];
const found = (dir) => scanSecrets(dir).findings.map((f) => `${basename(f.path)}:${f.line}:${shapeOf(f)}`).sort();

test('the COBOL shapes are read from the gitleaks rules file', () => {
  assert.deepEqual(SHAPES, ['cobol-value-credential', 'embedded-sql-connect-password', 'cics-signon-password', 'cics-new-password']);
});

test('each planted credential in a program or copybook is found, at its line', () => {
  assert.deepEqual(found(POSITIVE), [
    'auth.cpy:1:cobol-value-credential', 'auth.cpy:2:cobol-value-credential',
    'auth.cpy:4:cobol-value-credential', 'auth.cpy:5:cobol-value-credential',
    'login.cbl:10:cics-new-password', 'login.cbl:10:cics-signon-password',
    'login.cbl:12:embedded-sql-connect-password',
    'login.cbl:5:cobol-value-credential', 'login.cbl:6:cobol-value-credential',
    'login.cbl:8:embedded-sql-connect-password', 'login.cbl:9:cics-signon-password',
  ]);
});

test('placeholders, prompts, condition names, comments, fill values and host variables are not credentials', () => {
  assert.deepEqual(found(NEGATIVE), []);
});

test('a finding names the item or statement and never the credential', () => {
  const r = scanSecrets(POSITIVE);
  assert.equal(r.findings[0].rule, 'credential-in-source');
  assert.equal(r.findings[0].sev, 'high');
  assert.equal(r.findings[0].cwe, 'CWE-798');
  const text = JSON.stringify(r.findings);
  for (const secret of ['q8Lm2Zp7Rt4Vw9YsKx3N', 'pK7sQ2mZ9xL4vR8tY3nW6cB1', 'Tr0ub4dor3xQz9', 'ghx8Kq2LmPz7Rt4Vw9Ys', 'Pa55w0rdZ9q', 'S3CR3T01', 'OLDPW001', 'NEWPW002', 'T1ger7Q2', 'D7C1E2E2E6D6D9C4', 'r7Kp2Lx9Qm4Tz8Wn3Vb6Y']) {
    assert.ok(!text.includes(secret), `${secret} is in a finding`);
  }
  assert.ok(r.findings.some((f) => f.detail.startsWith('WS-REFRESH-TOKEN has a literal VALUE')));
  assert.ok(r.findings.some((f) => f.detail.startsWith('EXEC CICS CHANGE gives a literal PASSWORD')));
  assert.ok(r.findings.some((f) => f.detail.startsWith('EXEC CICS CHANGE gives a literal NEWPASSWORD')));
  assert.ok(r.findings.some((f) => f.detail.startsWith('WS-API-KEY has a literal VALUE')));
});

test('a Go regex construct JavaScript reads differently is refused, not translated', () => {
  assert.equal(jsRegex('(?im)^A$', 'g').flags, 'gim');
  assert.throws(() => jsRegex('A(?i)B'), /no JavaScript equivalent/);
  assert.throws(() => jsRegex('(?P<x>A)'), /no JavaScript equivalent/);
  assert.throws(() => jsRegex('A\\z'), /no JavaScript equivalent/);
});

test('the rule warns until it is measured, and blocks where the policy names it', () => {
  const f = { rule: 'credential-in-source', sev: 'high', fingerprint: 'x' };
  const at = (rules) => blockingReason(f, { policy: { ...DEFAULT_POLICY, rules }, ratchet: false, introduced: new Set([f]), renewed: new Set() });
  assert.equal(at({}), null);
  assert.equal(at({ 'credential-in-source': 'block' }), 'rule');
});

// gitleaks reads .gitleaksignore from its working directory, and this repository's ignores the fixtures.
const gitleaks = spawnSync('gitleaks', ['version'], { encoding: 'utf8' }).status === 0;
test('gitleaks finds the same COBOL credentials with the same rules file', { skip: gitleaks ? false : 'gitleaks is not installed' }, () => {
  const tmp = mkdtempSync(join(tmpdir(), 'cw-secrets-'));
  const out = join(tmp, 'r.json');
  spawnSync('gitleaks', ['detect', '--no-git', '--no-banner', '--source', POSITIVE, '--config', CONFIG, '--report-format', 'json', '--report-path', out], { cwd: tmp, encoding: 'utf8' });
  const theirs = JSON.parse(readFileSync(out, 'utf8') || '[]')
    .filter((f) => SHAPES.includes(f.RuleID))
    .map((f) => `${basename(f.File)}:${f.StartLine}:${f.RuleID}`).sort();
  rmSync(tmp, { recursive: true, force: true });
  assert.deepEqual(found(POSITIVE), theirs);
});
