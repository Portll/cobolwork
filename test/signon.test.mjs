// A program that checks a password sends a successful sign-on somewhere; another route to the same
// place that does not pass the check is a way in without the password.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanCics } from '../lib/sets/cics.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'signon');
const report = scanCics(FIXTURES);
const bypass = (file) => report.findings.filter((f) => f.path === file && f.rule === 'cics-signon-bypassed');

test('a menu reached only past the password comparison is not a bypass', () => {
  assert.deepEqual(bypass('SIGNOK.cbl'), []);
});

test('a PF key that transfers to the menu the sign-on grants is one', () => {
  const [f, ...rest] = bypass('SIGNPF5.cbl');
  assert.equal(rest.length, 0);
  assert.equal(f.line, 17);
  assert.equal(f.sev, 'high');
  assert.equal(f.cwe, 'CWE-288');
  assert.match(f.detail, /XCTL to MENUPGM on a route that does not pass its password check/);
  assert.match(f.detail, /dispatches on EIBAID/);
});

test('a sign-on that only sets a flag is not followed, so it is not said to be bypassed', () => {
  assert.deepEqual(bypass('SIGNFLAG.cbl'), []);
});
