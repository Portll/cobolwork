// Resolves the list of feed paths from opts or the COBOLWORK_REACH environment variable (lib/reach.mjs reachFeedPaths).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reachFeedPaths } from '../lib/reach.mjs';
import './pin-machine.mjs';

test('returns the provided reachFeeds array when present', () => {
  const feeds = ['/a', '/b'];
  assert.deepEqual(reachFeedPaths({ reachFeeds: feeds }), feeds);
});

test('returns an empty array when reachFeeds is an empty array', () => {
  assert.deepEqual(reachFeedPaths({ reachFeeds: [] }), []);
});

test('returns an empty array when reachFeeds is null', () => {
  assert.deepEqual(reachFeedPaths({ reachFeeds: null }), []);
});

test('returns an empty array when reachFeeds is undefined and COBOLWORK_REACH is unset', () => {
  const old = process.env.COBOLWORK_REACH;
  delete process.env.COBOLWORK_REACH;
  try {
    assert.deepEqual(reachFeedPaths({}), []);
  } finally {
    if (old !== undefined) process.env.COBOLWORK_REACH = old;
  }
});

test('splits COBOLWORK_REACH by the path delimiter when reachFeeds is absent', () => {
  const old = process.env.COBOLWORK_REACH;
  const delim = process.platform === 'win32' ? ';' : ':';
  process.env.COBOLWORK_REACH = '/x' + delim + '/y';
  try {
    const result = reachFeedPaths({});
    assert.equal(result.length, 2);
    assert.equal(result[0], '/x');
    assert.equal(result[1], '/y');
  } finally {
    if (old !== undefined) process.env.COBOLWORK_REACH = old;
    else delete process.env.COBOLWORK_REACH;
  }
});

test('filters out empty strings from COBOLWORK_REACH splits', () => {
  const old = process.env.COBOLWORK_REACH;
  const delim = process.platform === 'win32' ? ';' : ':';
  process.env.COBOLWORK_REACH = '/a' + delim + '' + delim + '/b';
  try {
    assert.deepEqual(reachFeedPaths({}), ['/a', '/b']);
  } finally {
    if (old !== undefined) process.env.COBOLWORK_REACH = old;
    else delete process.env.COBOLWORK_REACH;
  }
});

test('returns an empty array when COBOLWORK_REACH is an empty string', () => {
  const old = process.env.COBOLWORK_REACH;
  process.env.COBOLWORK_REACH = '';
  try {
    assert.deepEqual(reachFeedPaths({}), []);
  } finally {
    if (old !== undefined) process.env.COBOLWORK_REACH = old;
    else delete process.env.COBOLWORK_REACH;
  }
});

test('prefers reachFeeds over COBOLWORK_REACH when both are set', () => {
  const old = process.env.COBOLWORK_REACH;
  process.env.COBOLWORK_REACH = '/env-feed';
  try {
    const feeds = ['/opt-feed'];
    assert.deepEqual(reachFeedPaths({ reachFeeds: feeds }), feeds);
  } finally {
    if (old !== undefined) process.env.COBOLWORK_REACH = old;
    else delete process.env.COBOLWORK_REACH;
  }
});
