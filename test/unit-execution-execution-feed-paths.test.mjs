// The execution feed list, from options or else from COBOLWORK_EXECUTION (lib/execution.mjs executionFeedPaths).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executionFeedPaths } from '../lib/execution.mjs';
import './pin-machine.mjs';

const delimiter = process.platform === 'win32' ? ';' : ':';

test('returns opts.executionFeeds when provided', () => {
  const feeds = ['feed1', 'feed2'];
  assert.deepStrictEqual(executionFeedPaths({ executionFeeds: feeds }), feeds);
});

test('returns empty array when opts.executionFeeds is not provided and COBOLWORK_EXECUTION is undefined', () => {
  const original = process.env.COBOLWORK_EXECUTION;
  delete process.env.COBOLWORK_EXECUTION;
  try {
    assert.deepStrictEqual(executionFeedPaths(), []);
  } finally {
    process.env.COBOLWORK_EXECUTION = original;
  }
});

test('returns empty array when COBOLWORK_EXECUTION is an empty string', () => {
  const original = process.env.COBOLWORK_EXECUTION;
  process.env.COBOLWORK_EXECUTION = '';
  try {
    assert.deepStrictEqual(executionFeedPaths(), []);
  } finally {
    process.env.COBOLWORK_EXECUTION = original;
  }
});

test('splits COBOLWORK_EXECUTION env var into paths when no opts', () => {
  const original = process.env.COBOLWORK_EXECUTION;
  process.env.COBOLWORK_EXECUTION = `a${delimiter}b`;
  try {
    assert.deepStrictEqual(executionFeedPaths(), ['a', 'b']);
  } finally {
    process.env.COBOLWORK_EXECUTION = original;
  }
});

test('filters out empty segments from COBOLWORK_EXECUTION', () => {
  const original = process.env.COBOLWORK_EXECUTION;
  process.env.COBOLWORK_EXECUTION = `a${delimiter}${delimiter}b`;
  try {
    assert.deepStrictEqual(executionFeedPaths(), ['a', 'b']);
  } finally {
    process.env.COBOLWORK_EXECUTION = original;
  }
});

test('handles leading and trailing delimiters in COBOLWORK_EXECUTION', () => {
  const original = process.env.COBOLWORK_EXECUTION;
  process.env.COBOLWORK_EXECUTION = `${delimiter}a${delimiter}b${delimiter}`;
  try {
    assert.deepStrictEqual(executionFeedPaths(), ['a', 'b']);
  } finally {
    process.env.COBOLWORK_EXECUTION = original;
  }
});

test('returns single path when COBOLWORK_EXECUTION contains one entry', () => {
  const original = process.env.COBOLWORK_EXECUTION;
  process.env.COBOLWORK_EXECUTION = 'singlePath';
  try {
    assert.deepStrictEqual(executionFeedPaths(), ['singlePath']);
  } finally {
    process.env.COBOLWORK_EXECUTION = original;
  }
});
