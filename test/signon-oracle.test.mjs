// SPDX-License-Identifier: AGPL-3.0-or-later
// A sign-on that answers a bad user and a bad password differently.
//
// The corpus carries both forms, which is why this rule could be written at all: 19 programs in 18
// repositories say "User not found" and "Wrong Password" separately, and 6 in 6 answer both with
// one message. The second group is the fix, and it is the negative case here.
//
// The design called this the lowest-confidence rule in the set and asked for the false-positive
// rate first. The rate is what made it buildable: keyed on failure messages alone the corpus has
// 2,361 files, and the discriminator is not that a program has an error message but that it has
// two different ones for the two halves of the same decision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanCics, CICS_RULES, tellsWhichHalfFailed } from '../lib/sets/cics.mjs';
import { ALL_RULES } from '../lib/scan.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'signon-oracle');
const report = scanCics(FIXTURES);
const of = (file) => report.findings.filter((f) => f.path === file).map((f) => [f.rule, f.line]).sort();

test('a sign-on with a message for each failure is reported, at the message', () => {
  // Both fixtures compare a password read back from the user file, which is a finding of its own.
  assert.deepEqual(of('SIGNTELL.cbl'), [['cics-signon-says-which-half-failed', 14], ['program-checks-stored-password', 16]]);
  const f = report.findings.find((x) => x.path === 'SIGNTELL.cbl');
  assert.match(f.detail, /answers a bad user with 'User not found/);
  assert.match(f.detail, /a bad password with 'Wrong Password/);
  assert.equal(f.sev, 'med');
});

test('the same sign-on answering both with one message is the fix, not a finding', () => {
  assert.deepEqual(of('SIGNSAME.cbl'), [['program-checks-stored-password', 16]]);
});

test('a program with no password is not a sign-on, whatever its messages say', () => {
  // LOOKUP says "User not found" too. Without a password-named field there is no second failure
  // to distinguish it from, and nothing an attacker learns that the screen did not already offer.
  assert.deepEqual(of('LOOKUP.cbl'), []);
});

test('the discriminator is two different messages, not the presence of one', () => {
  assert.equal(tellsWhichHalfFailed(['Error: Incorrect username or password.']), null);
  assert.equal(tellsWhichHalfFailed(['Welcome', 'Press PF3 to exit']), null);
  assert.equal(tellsWhichHalfFailed(['Account not found']), null, 'one half named is not two');
  const both = tellsWhichHalfFailed(['User not found. Try again ...', 'Wrong Password. Try again ...']);
  assert.equal(both.user, 'User not found. Try again ...');
  assert.equal(both.password, 'Wrong Password. Try again ...');
});

test('the words are read without a regex escape, because one became a control character', () => {
  // A word-boundary escape written into lib/sets/cics.mjs became a literal backspace byte, and the
  // regex then matched nothing while every test still passed. The words are split and compared.
  assert.ok(tellsWhichHalfFailed(['USERID INVALID', 'PASSWORD INVALID']), 'upper case, no punctuation');
  assert.equal(tellsWhichHalfFailed(['Superuser invalid', 'Password invalid']), null,
    'superuser is not the word user, which a substring match would have missed');
});

test('the rule is declared with its impact and remedy, and is in the catalogue', () => {
  const r = CICS_RULES['cics-signon-says-which-half-failed'];
  assert.equal(r.cwe, 'CWE-204');
  assert.ok(r.impact.length > 40 && r.remedy.length > 40);
  assert.ok(ALL_RULES['cics-signon-says-which-half-failed']);
});
