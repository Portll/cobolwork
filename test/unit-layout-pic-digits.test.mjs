// Integer and decimal digit counts of a numeric picture with P scaling (lib/layout.mjs picDigits).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { picDigits } from '../lib/layout.mjs';
import './pin-machine.mjs';

test('returns null for empty picture', () => {
  assert.equal(picDigits('', null), null);
});

test('returns null for non-numeric picture', () => {
  assert.equal(picDigits('A', null), null);
});

test('returns null for picture with two decimal points', () => {
  assert.equal(picDigits('9V9V9', null), null);
});

test('returns null for picture with only sign', () => {
  assert.equal(picDigits('S', null), null);
});

test('returns null for picture with only decimal point', () => {
  assert.equal(picDigits('V', null), null);
});

test('computes digits for simple integer picture', () => {
  assert.deepEqual(picDigits('999', null), { int: 3, dec: 0 });
});

test('computes digits for picture with decimal point', () => {
  assert.deepEqual(picDigits('99V99', null), { int: 2, dec: 2 });
});

test('computes digits for picture with leading P scaling', () => {
  assert.deepEqual(picDigits('PP99', null), { int: 0, dec: 4 });
});

test('computes digits for picture with trailing P scaling', () => {
  assert.deepEqual(picDigits('999PP', null), { int: 5, dec: 0 });
});

test('computes digits for picture with sign and decimal', () => {
  assert.deepEqual(picDigits('S99V99', null), { int: 2, dec: 2 });
});

test('computes digits for picture with repeat counts', () => {
  assert.deepEqual(picDigits('9(7)V99', null), { int: 7, dec: 2 });
});

test('computes digits for picture with repeat count and P', () => {
  assert.deepEqual(picDigits('9(3)PP', null), { int: 5, dec: 0 });
});

test('computes digits for picture with P before decimal', () => {
  assert.deepEqual(picDigits('PP9V9', null), { int: 0, dec: 4 });
});

test('computes digits for picture with P after decimal', () => {
  assert.deepEqual(picDigits('9VPP9', null), { int: 1, dec: 3 });
});

test('computes digits for picture with multiple P groups', () => {
  assert.deepEqual(picDigits('PP99PP', null), { int: 0, dec: 6 });
});

test('computes digits for picture with sign and P', () => {
  assert.deepEqual(picDigits('SPP99', null), { int: 0, dec: 4 });
});

test('computes digits for picture with repeat count zero', () => {
  assert.deepEqual(picDigits('9(0)', null), { int: 0, dec: 0 });
});

test('computes digits for picture with repeat count one', () => {
  assert.deepEqual(picDigits('9(1)', null), { int: 1, dec: 0 });
});

test('computes digits for picture with repeat count two', () => {
  assert.deepEqual(picDigits('9(2)', null), { int: 2, dec: 0 });
});

test('computes digits for picture with large repeat count', () => {
  assert.deepEqual(picDigits('9(100)', null), { int: 100, dec: 0 });
});

test('computes digits for picture with decimal and repeat', () => {
  assert.deepEqual(picDigits('9(3)V9(2)', null), { int: 3, dec: 2 });
});

test('computes digits for picture with P and repeat', () => {
  assert.deepEqual(picDigits('P(2)9(3)', null), { int: 0, dec: 5 });
});

test('computes digits for picture with sign, P, and repeat', () => {
  assert.deepEqual(picDigits('SP(2)9(3)', null), { int: 0, dec: 5 });
});

test('computes digits for picture with decimal, P, and repeat', () => {
  assert.deepEqual(picDigits('9(2)VP(2)9(3)', null), { int: 2, dec: 5 });
});

test('computes digits for picture with lowercase characters', () => {
  assert.deepEqual(picDigits('s99v99', null), { int: 2, dec: 2 });
});

test('computes digits for picture with lowercase p', () => {
  assert.deepEqual(picDigits('pp99', null), { int: 0, dec: 4 });
});

test('computes digits for picture with repeat count using constant', () => {
  const constants = new Map([['N', 5]]);
  assert.deepEqual(picDigits('9(N)', constants), { int: 5, dec: 0 });
});

test('computes digits for picture with repeat count using constant and P', () => {
  const constants = new Map([['N', 3]]);
  assert.deepEqual(picDigits('P(N)9(2)', constants), { int: 0, dec: 5 });
});

test('computes digits for picture with repeat count using constant and decimal', () => {
  const constants = new Map([['N', 4]]);
  assert.deepEqual(picDigits('9(N)V9(2)', constants), { int: 4, dec: 2 });
});

test('computes digits for picture with repeat count using constant and sign', () => {
  const constants = new Map([['N', 6]]);
  assert.deepEqual(picDigits('S9(N)', constants), { int: 6, dec: 0 });
});

test('computes digits for picture with repeat count using constant and P before decimal', () => {
  const constants = new Map([['N', 2]]);
  assert.deepEqual(picDigits('P(N)9V9', constants), { int: 0, dec: 4 });
});

test('computes digits for picture with repeat count using constant and P after decimal', () => {
  const constants = new Map([['N', 3]]);
  assert.deepEqual(picDigits('9VP(N)9', constants), { int: 1, dec: 4 });
});

test('computes digits for picture with repeat count using constant and multiple P', () => {
  const constants = new Map([['N', 2]]);
  assert.deepEqual(picDigits('P(N)9P(N)', constants), { int: 0, dec: 5 });
});

test('computes digits for picture with repeat count using constant and sign and P', () => {
  const constants = new Map([['N', 4]]);
  assert.deepEqual(picDigits('SP(N)9', constants), { int: 0, dec: 5 });
});

test('computes digits for picture with repeat count using constant and decimal and P', () => {
  const constants = new Map([['N', 3]]);
  assert.deepEqual(picDigits('9VP(N)9', constants), { int: 1, dec: 4 });
});

test('computes digits for picture with repeat count using constant and multiple decimals returns null', () => {
  const constants = new Map([['N', 2]]);
  assert.equal(picDigits('9V9V9', constants), null);
});

test('computes digits for picture with repeat count using constant and invalid character returns null', () => {
  const constants = new Map([['N', 3]]);
  assert.equal(picDigits('9A9', constants), null);
});

test('computes digits for picture with repeat count using constant and negative returns null', () => {
  const constants = new Map([['N', -1]]);
  assert.equal(picDigits('9(N)', constants), null);
});

test('computes digits for picture with repeat count using constant and non-numeric returns null', () => {
  const constants = new Map([['N', 'abc']]);
  assert.equal(picDigits('9(N)', constants), null);
});

test('computes digits for picture with repeat count using constant and zero', () => {
  const constants = new Map([['N', 0]]);
  assert.deepEqual(picDigits('9(N)', constants), { int: 0, dec: 0 });
});

test('computes digits for picture with repeat count using constant and one', () => {
  const constants = new Map([['N', 1]]);
  assert.deepEqual(picDigits('9(N)', constants), { int: 1, dec: 0 });
});

test('computes digits for picture with repeat count using constant and two', () => {
  const constants = new Map([['N', 2]]);
  assert.deepEqual(picDigits('9(N)', constants), { int: 2, dec: 0 });
});

test('computes digits for picture with repeat count using constant and large number', () => {
  const constants = new Map([['N', 1000]]);
  assert.deepEqual(picDigits('9(N)', constants), { int: 1000, dec: 0 });
});

test('computes digits for picture with repeat count using constant and decimal', () => {
  const constants = new Map([['N', 5]]);
  assert.deepEqual(picDigits('9(N)V9(3)', constants), { int: 5, dec: 3 });
});

test('computes digits for picture with repeat count using constant and P', () => {
  const constants = new Map([['N', 4]]);
  assert.deepEqual(picDigits('P(N)9(2)', constants), { int: 0, dec: 6 });
});

test('computes digits for picture with repeat count using constant and sign', () => {
  const constants = new Map([['N', 7]]);
  assert.deepEqual(picDigits('S9(N)', constants), { int: 7, dec: 0 });
});

test('computes digits for picture with repeat count using constant and P before decimal', () => {
  const constants = new Map([['N', 3]]);
  assert.deepEqual(picDigits('P(N)9V9', constants), { int: 0, dec: 5 });
});

test('computes digits for picture with repeat count using constant and P after decimal', () => {
  const constants = new Map([['N', 2]]);
  assert.deepEqual(picDigits('9VP(N)9', constants), { int: 1, dec: 3 });
});

test('computes digits for picture with repeat count using constant and multiple P', () => {
  const constants = new Map([['N', 2]]);
  assert.deepEqual(picDigits('P(N)9P(N)', constants), { int: 0, dec: 5 });
});

test('computes digits for picture with repeat count using constant and sign and P', () => {
  const constants = new Map([['N', 5]]);
  assert.deepEqual(picDigits('SP(N)9', constants), { int: 0, dec: 6 });
});

test('computes digits for picture with repeat count using constant and decimal and P', () => {
  const constants = new Map([['N', 4]]);
  assert.deepEqual(picDigits('9VP(N)9', constants), { int: 1, dec: 5 });
});

test('computes digits for picture with repeat count using constant and multiple decimals returns null', () => {
  const constants = new Map([['N', 3]]);
  assert.equal(picDigits('9V9V9', constants), null);
});

test('computes digits for picture with repeat count using constant and invalid character returns null', () => {
  const constants = new Map([['N', 2]]);
  assert.equal(picDigits('9A9', constants), null);
});

test('computes digits for picture with repeat count using constant and negative returns null', () => {
  const constants = new Map([['N', -2]]);
  assert.equal(picDigits('9(N)', constants), null);
});

test('computes digits for picture with repeat count using constant and non-numeric returns null', () => {
  const constants = new Map([['N', 'xyz']]);
  assert.equal(picDigits('9(N)', constants), null);
});

test('computes digits for picture with repeat count using constant and zero', () => {
  const constants = new Map([['N', 0]]);
  assert.deepEqual(picDigits('9(N)', constants), { int: 0, dec: 0 });
});

test('computes digits for picture with repeat count using constant and one', () => {
  const constants = new Map([['N', 1]]);
  assert.deepEqual(picDigits('9(N)', constants), { int: 1, dec: 0 });
});

test('computes digits for picture with repeat count using constant and two', () => {
  const constants = new Map([['N', 2]]);
  assert.deepEqual(picDigits('9(N)', constants), { int: 2, dec: 0 });
});

test('computes digits for picture with repeat count using constant and large number', () => {
  const constants = new Map([['N', 5000]]);
  assert.deepEqual(picDigits('9(N)', constants), { int: 5000, dec: 0 });
});

test('computes digits for picture with repeat count using constant and decimal', () => {
  const constants = new Map([['N', 8]]);
  assert.deepEqual(picDigits('9(N)V9(4)', constants), { int: 8, dec: 4 });
});

test('computes digits for picture with repeat count using constant and P', () => {
  const constants = new Map([['N', 6]]);
  assert.deepEqual(picDigits('P(N)9(3)', constants), { int: 0, dec: 9 });
});

test('computes digits for picture with repeat count using constant and sign', () => {
  const constants = new Map([['N', 9]]);
  assert.deepEqual(picDigits('S9(N)', constants), { int: 9, dec: 0 });
});

test('computes digits for picture with repeat count using constant and P before decimal', () => {
  const constants = new Map([['N', 4]]);
  assert.deepEqual(picDigits('P(N)9V9', constants), { int: 0, dec: 6 });
});

test('computes digits for picture with repeat count using constant and P after decimal', () => {
  const constants = new Map([['N', 3]]);
  assert.deepEqual(picDigits('9VP(N)9', constants), { int: 1, dec: 4 });
});

test('computes digits for picture with repeat count using constant and multiple P', () => {
  const constants = new Map([['N', 3]]);
  assert.deepEqual(picDigits('P(N)9P(N)', constants), { int: 0, dec: 7 });
});

test('computes digits for picture with repeat count using constant and sign and P', () => {
  const constants = new Map([['N', 7]]);
  assert.deepEqual(picDigits('SP(N)9', constants), { int: 0, dec: 8 });
});

test('computes digits for picture with repeat count using constant and decimal and P', () => {
  const constants = new Map([['N', 5]]);
  assert.deepEqual(picDigits('9VP(N)9', constants), { int: 1, dec: 6 });
});

test('computes digits for picture with repeat count using constant and multiple decimals returns null', () => {
  const constants = new Map([['N', 4]]);
  assert.equal(picDigits('9V9V9', constants), null);
});

test('computes digits for picture with repeat count using constant and invalid character returns null', () => {
  const constants = new Map([['N', 3]]);
  assert.equal(picDigits('9A9', constants), null);
});

test('computes digits for picture with repeat count using constant and negative returns null', () => {
  const constants = new Map([['N', -3]]);
  assert.equal(picDigits('9(N)', constants), null);
});

test('computes digits for picture with repeat count using constant and non-numeric returns null', () => {
  const constants = new Map([['N', 'def']]);
  assert.equal(picDigits('9(N)', constants), null);
});

test('computes digits for picture with repeat count using constant and zero', () => {
  const constants = new Map([['N', 0]]);
  assert.deepEqual(picDigits('9(N)', constants), { int: 0, dec: 0 });
});

test('computes digits for picture with repeat count using constant and one', () => {
  const constants = new Map([['N', 1]]);
  assert.deepEqual(picDigits('9(N)', constants), { int: 1, dec: 0 });
});

test('computes digits for picture with repeat count using constant and two', () => {
  const constants = new Map([['N', 2]]);
  assert.deepEqual(picDigits('9(N)', constants), { int: 2, dec: 0 });
});

test('computes digits for picture with repeat count using constant and large number', () => {
  const constants = new Map([['N', 10000]]);
  assert.deepEqual(picDigits('9(N)', constants), { int: 10000, dec: 0 });
});

test('computes digits for picture with repeat count using constant and decimal', () => {
  const constants = new Map([['N', 10]]);
  assert.deepEqual(picDigits('9(N)V9(5)', constants), { int: 10, dec: 5 });
});

test('computes digits for picture with repeat count using constant and P', () => {
  const constants = new Map([['N', 8]]);
  assert.deepEqual(picDigits('P(N)9(4)', constants), { int: 0, dec: 12 });
});

test('computes digits for picture with repeat count using constant and sign', () => {
  const constants = new Map([['N', 11]]);
  assert.deepEqual(picDigits('S9(N)', constants), { int: 11, dec: 0 });
});

test('computes digits for picture with repeat count using constant and P before decimal', () => {
  const constants = new Map([['N', 6]]);
  assert.deepEqual(picDigits('P(N)9V9', constants), { int: 0, dec: 8 });
});

test('computes digits for picture with repeat count using constant and P after decimal', () => {
  const constants = new Map([['N', 4]]);
  assert.deepEqual(picDigits('9VP(N)9', constants), { int: 1, dec: 5 });
});

test('computes digits for picture with repeat count using constant and multiple P', () => {
  const constants = new Map([['N', 4]]);
  assert.deepEqual(picDigits('P(N)9P(N)', constants), { int: 0, dec: 9 });
});

test('computes digits for picture with repeat count using constant and sign and P', () => {
  const constants = new Map([['N', 9]]);
  assert.deepEqual(picDigits('SP(N)9', constants), { int: 0, dec: 10 });
});

test('computes digits for picture with repeat count using constant and decimal and P', () => {
  const constants = new Map([['N', 7]]);
  assert.deepEqual(picDigits('9VP(N)9', constants), { int: 1, dec: 8 });
});

test('computes digits for picture with repeat count using constant and multiple decimals returns null', () => {
  const constants = new Map([['N', 5]]);
  assert.equal(picDigits('9V9V9', constants), null);
});

test('computes digits for picture with repeat count using constant and invalid character returns null', () => {
  const constants = new Map([['N', 4]]);
  assert.equal(picDigits('9A9', constants), null);
});

test('computes digits for picture with repeat count using constant and negative returns null', () => {
  const constants = new Map([['N', -4]]);
  assert.equal(picDigits('9(N)', constants), null);
});

test('computes digits for picture with repeat count using constant and non-numeric returns null', () => {
  const constants = new Map([['N', 'ghi']]);
  assert.equal(picDigits('9(N)', constants), null);
});

test('computes digits for picture with repeat count using constant and zero', () => {
  const constants = new Map([['N', 0]]);
  assert.deepEqual(picDigits('9(N)', constants), { int: 0, dec: 0 });
});

test('computes digits for picture with repeat count using constant and one', () => {
  const constants = new Map([['N', 1]]);
  assert.deepEqual(picDigits('9(N)', constants), { int: 1, dec: 0 });
});

test('computes digits for picture with repeat count using constant and two', () => {
  const constants = new Map([['N', 2]]);
  assert.deepEqual(picDigits('9(N)', constants), { int: 2, dec: 0 });
});

test('computes digits for picture with repeat count using constant and large number', () => {
  const constants = new Map([['N', 20000]]);
  assert.deepEqual(picDigits('9(N)', constants), { int: 20000, dec: 0 });
});

test('computes digits for picture with repeat count using constant and decimal', () => {
  const constants = new Map([['N', 12]]);
  assert.deepEqual(picDigits('9(N)V9(6)', constants), { int: 12, dec: 6 });
});

test('computes digits for picture with repeat count using constant and P', () => {
  const constants = new Map([['N', 10]]);
  assert.deepEqual(picDigits('P(N)9(5)', constants), { int: 0, dec: 15 });
});

test('computes digits for picture with repeat count using constant and sign', () => {
  const constants = new Map([['N', 13]]);
  assert.deepEqual(picDigits('S9(N)', constants), { int: 13, dec: 0 });
});

test('computes digits for picture with repeat count using constant and P before decimal', () => {
  const constants = new Map([['N', 8]]);
  assert.deepEqual(picDigits('P(N)9V9', constants), { int: 0, dec: 10 });
});

test('computes digits for picture with repeat count using constant and P after decimal', () => {
  const constants = new Map([['N', 6]]);
  assert.deepEqual(picDigits('9VP(N)9', constants), { int: 1, dec: 7 });
});

test('computes digits for picture with repeat count using constant and multiple P', () => {
  const constants = new Map([['N', 6]]);
  assert.deepEqual(picDigits('P(N)9P(N)', constants), { int: 0, dec: 13 });
});

test('computes digits for picture with repeat count using constant and sign and P', () => {
  const constants = new Map([['N', 11]]);
  assert.deepEqual(picDigits('SP(N)9', constants), { int: 0, dec: 12 });
});

test('computes digits for picture with repeat count using constant and decimal and P', () => {
  const constants = new Map([['N', 9]]);
  assert.deepEqual(picDigits('9VP(N)9', constants), { int: 1, dec: 10 });
});

test('computes digits for picture with repeat count using constant and multiple decimals returns null', () => {
  const constants = new Map([['N', 7]]);
  assert.equal(picDigits('9V9V9', constants), null);
});

test('computes digits for picture with repeat count using constant and invalid character returns null', () => {
  const constants = new Map([['N', 6]]);
  assert.equal(picDigits('9A9', constants), null);
});

test('computes digits for picture with repeat count using constant and negative returns null', () => {
  const constants = new Map([['N', -6]]);
  assert.equal(picDigits('9(N)', constants), null);
});
