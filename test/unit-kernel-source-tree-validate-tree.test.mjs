// Validates that a source tree object exists and exposes the required adapter methods (lib/kernel/source-tree.mjs validateTree).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTree } from '../lib/kernel/source-tree.mjs';
import './pin-machine.mjs';

test('returns the same object when all required methods are present', () => {
  const tree = {
    list: () => {},
    bytes: () => {},
    text: () => {},
    contains: () => {},
    parse: () => {},
    rel: () => {},
  };
  const result = validateTree(tree);
  assert.strictEqual(result, tree);
});

test('throws ETREE when the input is null', () => {
  assert.throws(() => validateTree(null), (err) => {
    assert.strictEqual(err.code, 'ETREE');
    assert.match(err.message, /a source tree is required/);
    return true;
  });
});

test('throws ETREE when the input is undefined', () => {
  assert.throws(() => validateTree(undefined), (err) => {
    assert.strictEqual(err.code, 'ETREE');
    assert.match(err.message, /a source tree is required/);
    return true;
  });
});

test('throws ETREE when the input is a string', () => {
  assert.throws(() => validateTree('not an object'), (err) => {
    assert.strictEqual(err.code, 'ETREE');
    assert.match(err.message, /a source tree is required/);
    return true;
  });
});

test('throws ETREE when the input is a number', () => {
  assert.throws(() => validateTree(42), (err) => {
    assert.strictEqual(err.code, 'ETREE');
    assert.match(err.message, /a source tree is required/);
    return true;
  });
});

test('throws ETREE listing missing methods when some are absent', () => {
  const tree = {
    list: () => {},
    bytes: () => {},
  };
  assert.throws(() => validateTree(tree), (err) => {
    assert.strictEqual(err.code, 'ETREE');
    assert.deepStrictEqual(err.missing, ['text', 'contains', 'parse', 'rel']);
    assert.match(err.message, /source tree is missing: text, contains, parse, rel/);
    return true;
  });
});

test('throws ETREE listing all methods when the object is empty', () => {
  const tree = {};
  assert.throws(() => validateTree(tree), (err) => {
    assert.strictEqual(err.code, 'ETREE');
    assert.deepStrictEqual(err.missing, ['list', 'bytes', 'text', 'contains', 'parse', 'rel']);
    assert.match(err.message, /source tree is missing: list, bytes, text, contains, parse, rel/);
    return true;
  });
});

test('throws ETREE when a method property is not a function', () => {
  const tree = {
    list: () => {},
    bytes: 'not a function',
    text: () => {},
    contains: () => {},
    parse: () => {},
    rel: () => {},
  };
  assert.throws(() => validateTree(tree), (err) => {
    assert.strictEqual(err.code, 'ETREE');
    assert.deepStrictEqual(err.missing, ['bytes']);
    assert.match(err.message, /source tree is missing: bytes/);
    return true;
  });
});
