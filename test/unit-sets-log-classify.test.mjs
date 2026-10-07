// Classifies a COBOL field name as credential, personal, or null based on its hyphen-separated components (lib/sets/log.mjs classify).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../lib/sets/log.mjs';
import './pin-machine.mjs';

test('returns null when a component is in the SAFE set', () => {
  assert.equal(classify('USER-PASSWORD-MASKED'), null);
  assert.equal(classify('CARD-NUM-HASHED'), null);
  assert.equal(classify('SSN-ENCRYPTED'), null);
});

test('returns credential when a component is in SECRET and none are in ABOUT', () => {
  assert.equal(classify('USER-PASSWORD'), 'credential');
  assert.equal(classify('APIKEY'), 'credential');
  assert.equal(classify('TOKEN'), 'credential');
  assert.equal(classify('CREDENTIALS'), 'credential');
});

test('returns null when a component is in SECRET and another is in ABOUT', () => {
  assert.equal(classify('PASSWORD-MSG'), null);
  assert.equal(classify('TOKEN-ERROR'), null);
  assert.equal(classify('CREDENTIAL-VALID'), null);
  assert.equal(classify('PASSWORD-FLAG'), null);
});

test('returns personal when a component is in PERSONAL', () => {
  assert.equal(classify('EMPLOYEE-SSN'), 'personal');
  assert.equal(classify('CUSTOMER-DOB'), 'personal');
  assert.equal(classify('CARD-CVV'), 'personal');
  assert.equal(classify('TAXID'), 'personal');
});

test('returns personal when all words of a PAIR are present as components', () => {
  assert.equal(classify('CARD-NUM'), 'personal');
  assert.equal(classify('CARD-NUMBER'), 'personal');
  assert.equal(classify('SOC-SEC'), 'personal');
  assert.equal(classify('SOCIAL-SECURITY'), 'personal');
  assert.equal(classify('BIRTH-DATE'), 'personal');
  assert.equal(classify('BIRTH-DT'), 'personal');
  assert.equal(classify('SORT-CODE'), 'personal');
  assert.equal(classify('TAX-ID'), 'personal');
});

test('returns null when only one word of a PAIR is present', () => {
  assert.equal(classify('CARD'), null);
  assert.equal(classify('NUM'), null);
  assert.equal(classify('SOC'), null);
  assert.equal(classify('SEC'), null);
  assert.equal(classify('BIRTH'), null);
  assert.equal(classify('DATE'), null);
  assert.equal(classify('SORT'), null);
  assert.equal(classify('CODE'), null);
  assert.equal(classify('TAX'), null);
  assert.equal(classify('ID'), null);
});

test('returns null for names with no matching components', () => {
  assert.equal(classify('EMPLOYEE-NAME'), null);
  assert.equal(classify('ORDER-TOTAL'), null);
  assert.equal(classify('ADDRESS'), null);
});

test('handles case-insensitivity by uppercasing the input', () => {
  assert.equal(classify('user-password'), 'credential');
  assert.equal(classify('employee-ssn'), 'personal');
  assert.equal(classify('card-num'), 'personal');
  assert.equal(classify('password-msg'), null);
});

test('ignores empty strings from splitting on hyphens', () => {
  assert.equal(classify('-PASSWORD-'), 'credential');
  assert.equal(classify('--SSN--'), 'personal');
  assert.equal(classify('-CARD--NUM-'), 'personal');
});

test('returns null for empty string input', () => {
  assert.equal(classify(''), null);
});
