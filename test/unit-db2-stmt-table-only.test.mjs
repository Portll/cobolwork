// Extracts the token from the cursor after expecting a specific word (lib/db2/stmt/table.mjs only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { only } from '../lib/db2/stmt/table.mjs';
import './pin-machine.mjs';

test('returns the token when the cursor word matches the expected word', () => {
  const token = { u: 'value' };
  const c = {
    expectWord: (words) => {
      assert.deepEqual(words, ['ONLY']);
      return token;
    }
  };
  const result = only(c, ['ONLY']);
  assert.equal(result, 'value');
});

test('returns the token when the cursor word matches one of multiple expected words', () => {
  const token = { u: 'data' };
  const c = {
    expectWord: (words) => {
      assert.deepEqual(words, ['ONLY', 'SINGLE']);
      return token;
    }
  };
  const result = only(c, ['ONLY', 'SINGLE']);
  assert.equal(result, 'data');
});

test('returns the token u property for a complex token object', () => {
  const token = { u: 'complex', other: 'property' };
  const c = {
    expectWord: (words) => {
      assert.deepEqual(words, ['ONLY']);
      return token;
    }
  };
  const result = only(c, ['ONLY']);
  assert.equal(result, 'complex');
});

test('passes the words array to expectWord as is', () => {
  const token = { u: 'test' };
  const words = ['A', 'B', 'C'];
  const c = {
    expectWord: (w) => {
      assert.equal(w, words);
      return token;
    }
  };
  const result = only(c, words);
  assert.equal(result, 'test');
});

