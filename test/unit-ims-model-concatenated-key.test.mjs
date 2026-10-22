// Total bytes of the concatenated key along a segment's physical parent chain (lib/ims/model.mjs concatenatedKey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { concatenatedKey } from '../lib/ims/model.mjs';
import './pin-machine.mjs';

test('returns zero when the segment has no sequence field', () => {
  const dbd = { segments: [{ name: 'A', parent: null, fields: [{ name: 'X', seq: false, bytes: 4 }] }] };
  assert.equal(concatenatedKey(dbd, 'A'), 0);
});

test('returns the sequence field bytes for a root segment', () => {
  const dbd = { segments: [{ name: 'A', parent: null, fields: [{ name: 'X', seq: true, bytes: 8 }] }] };
  assert.equal(concatenatedKey(dbd, 'A'), 8);
});

test('sums sequence field bytes along the parent chain', () => {
  const dbd = {
    segments: [
      { name: 'A', parent: null, fields: [{ name: 'X', seq: true, bytes: 4 }] },
      { name: 'B', parent: 'A', fields: [{ name: 'Y', seq: true, bytes: 6 }] },
    ],
  };
  assert.equal(concatenatedKey(dbd, 'B'), 10);
});

test('returns null when the segment name is not in the dbd', () => {
  const dbd = { segments: [{ name: 'A', parent: null, fields: [] }] };
  assert.equal(concatenatedKey(dbd, 'Z'), null);
});

test('returns null when the parent chain references a missing segment', () => {
  const dbd = { segments: [{ name: 'A', parent: 'MISSING', fields: [] }] };
  assert.equal(concatenatedKey(dbd, 'A'), null);
});

test('returns null when the parent chain contains a cycle', () => {
  const dbd = {
    segments: [
      { name: 'A', parent: 'B', fields: [] },
      { name: 'B', parent: 'A', fields: [] },
    ],
  };
  assert.equal(concatenatedKey(dbd, 'A'), null);
});

test('ignores non-sequence fields when computing the total', () => {
  const dbd = {
    segments: [
      { name: 'A', parent: null, fields: [{ name: 'X', seq: false, bytes: 100 }, { name: 'Y', seq: true, bytes: 2 }] },
    ],
  };
  assert.equal(concatenatedKey(dbd, 'A'), 2);
});

test('returns zero when the parent has no sequence field', () => {
  const dbd = {
    segments: [
      { name: 'A', parent: null, fields: [{ name: 'X', seq: false, bytes: 5 }] },
      { name: 'B', parent: 'A', fields: [{ name: 'Y', seq: true, bytes: 3 }] },
    ],
  };
  assert.equal(concatenatedKey(dbd, 'B'), 3);
});
