// The advisory feed list, from options or else from COBOLWORK_ADVISORIES (lib/advisories.mjs advisoryFeedPaths).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advisoryFeedPaths } from '../lib/advisories.mjs';
import './pin-machine.mjs';

test('returns the advisoryFeeds array when provided in options', () => {
  const result = advisoryFeedPaths({ advisoryFeeds: ['a', 'b'] });
  assert.deepStrictEqual(result, ['a', 'b']);
});

test('returns an empty array when no options and COBOLWORK_ADVISORIES is unset', () => {
  const original = process.env.COBOLWORK_ADVISORIES;
  delete process.env.COBOLWORK_ADVISORIES;
  try {
    const result = advisoryFeedPaths();
    assert.deepStrictEqual(result, []);
  } finally {
    if (original !== undefined) process.env.COBOLWORK_ADVISORIES = original;
  }
});

test('returns an empty array when no options and COBOLWORK_ADVISORIES is empty string', () => {
  const original = process.env.COBOLWORK_ADVISORIES;
  process.env.COBOLWORK_ADVISORIES = '';
  try {
    const result = advisoryFeedPaths();
    assert.deepStrictEqual(result, []);
  } finally {
    if (original !== undefined) process.env.COBOLWORK_ADVISORIES = original;
  }
});

test('splits a single path in COBOLWORK_ADVISORIES into a one-element array', () => {
  const original = process.env.COBOLWORK_ADVISORIES;
  process.env.COBOLWORK_ADVISORIES = 'singlePath';
  try {
    const result = advisoryFeedPaths();
    assert.deepStrictEqual(result, ['singlePath']);
  } finally {
    if (original !== undefined) process.env.COBOLWORK_ADVISORIES = original;
  }
});

test('splits multiple paths using the platform delimiter and filters out empty entries', () => {
  const original = process.env.COBOLWORK_ADVISORIES;
  const delim = process.platform === 'win32' ? ';' : ':';
  process.env.COBOLWORK_ADVISORIES = `first${delim}${delim}second${delim}third`;
  try {
    const result = advisoryFeedPaths();
    assert.deepStrictEqual(result, ['first', 'second', 'third']);
  } finally {
    if (original !== undefined) process.env.COBOLWORK_ADVISORIES = original;
  }
});

test('returns the advisoryFeeds array even if it is empty', () => {
  const result = advisoryFeedPaths({ advisoryFeeds: [] });
  assert.deepStrictEqual(result, []);
});
