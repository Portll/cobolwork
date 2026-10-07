// The production qualifier a dataset name falls under, matched as whole leading components (lib/site.mjs productionQualifierOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionQualifierOf } from '../lib/site.mjs';
import './pin-machine.mjs';

test('returns the qualifier when the dataset name matches it exactly', () => {
  assert.equal(productionQualifierOf('PROD.DATA', ['PROD', 'TEST']), 'PROD');
});

test('returns the qualifier when the dataset name starts with the qualifier followed by a dot', () => {
  assert.equal(productionQualifierOf('PROD.DATA.SET', ['PROD', 'TEST']), 'PROD');
});

test('returns null when the dataset name is a prefix of a qualifier but not followed by a dot', () => {
  assert.equal(productionQualifierOf('PROD', ['PRODUCER']), null);
});

test('returns null when the dataset name matches a qualifier only as a substring without a dot boundary', () => {
  assert.equal(productionQualifierOf('PRODUCER.DATA', ['PROD']), null);
});

test('returns the first matching qualifier when multiple qualifiers match', () => {
  assert.equal(productionQualifierOf('PROD.DATA', ['TEST', 'PROD']), 'PROD');
});

test('returns null when no qualifier matches the dataset name', () => {
  assert.equal(productionQualifierOf('DEV.DATA', ['PROD', 'TEST']), null);
});

test('strips parenthetical suffixes from the dataset name before matching', () => {
  assert.equal(productionQualifierOf('PROD.DATA(01)', ['PROD']), 'PROD');
});

test('uppercases the dataset name before matching against qualifiers', () => {
  assert.equal(productionQualifierOf('prod.data', ['PROD']), 'PROD');
});

test('returns null when the dataset name is empty', () => {
  assert.equal(productionQualifierOf('', ['PROD']), null);
});

test('returns null when the qualifiers list is empty', () => {
  assert.equal(productionQualifierOf('PROD.DATA', []), null);
});
