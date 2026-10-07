// Extracts the base64-decoded payload from an SSH SIGNATURE armour block (lib/evidence/sshsig.mjs dearmor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dearmor } from '../lib/evidence/sshsig.mjs';
import './pin-machine.mjs';

test('returns the decoded buffer for a valid canonical SSH SIGNATURE armour', () => {
  const payload = Buffer.from('hello world');
  const b64 = payload.toString('base64');
  const text = `-----BEGIN SSH SIGNATURE-----\n${b64}\n-----END SSH SIGNATURE-----`;
  const result = dearmor(text);
  assert.ok(Buffer.isBuffer(result));
  assert.equal(result.toString('utf8'), 'hello world');
});

test('throws an error when the input does not contain an SSH SIGNATURE armour block', () => {
  assert.throws(() => dearmor('no armour here'), /no SSH SIGNATURE armour/);
});

test('throws an error when the base64 content is not canonical due to non-alphabet characters', () => {
  const text = '-----BEGIN SSH SIGNATURE-----\nabc!def\n-----END SSH SIGNATURE-----';
  assert.throws(() => dearmor(text), /not canonical base64/);
});

test('throws an error when the base64 content is not canonical due to incorrect padding', () => {
  const text = '-----BEGIN SSH SIGNATURE-----\nabc\n-----END SSH SIGNATURE-----';
  assert.throws(() => dearmor(text), /not canonical base64/);
});

test('strips whitespace from the base64 content before decoding', () => {
  const payload = Buffer.from('test data');
  const b64 = payload.toString('base64');
  const spaced = b64.slice(0, 4) + '\n' + b64.slice(4, 8) + ' ' + b64.slice(8);
  const text = `-----BEGIN SSH SIGNATURE-----\n${spaced}\n-----END SSH SIGNATURE-----`;
  const result = dearmor(text);
  assert.equal(result.toString('utf8'), 'test data');
});

test('handles empty base64 content by returning an empty buffer', () => {
  const text = '-----BEGIN SSH SIGNATURE-----\n\n-----END SSH SIGNATURE-----';
  const result = dearmor(text);
  assert.ok(Buffer.isBuffer(result));
  assert.equal(result.length, 0);
});

test('throws an error when the input is not a string', () => {
  assert.throws(() => dearmor(12345), /no SSH SIGNATURE armour/);
});

test('throws an error when the armour markers are missing the END tag', () => {
  const text = '-----BEGIN SSH SIGNATURE-----\nabc\n';
  assert.throws(() => dearmor(text), /no SSH SIGNATURE armour/);
});
