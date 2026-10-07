// Builds the next hash-chained evidence record and its canonical line (lib/evidence/record.mjs makeRecord).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRecord } from '../lib/evidence/record.mjs';
import './pin-machine.mjs';

test('creates the first record in a chain with seq 0 and zero prev', () => {
  const { record, line } = makeRecord({
    chain: 'c1',
    prev: null,
    kind: 'genesis',
    fields: { createdAt: '2024-01-01T00:00:00Z' },
    at: '2024-01-01T00:00:00Z',
  });
  assert.equal(record.v, 1);
  assert.equal(record.chain, 'c1');
  assert.equal(record.seq, 0);
  assert.equal(record.at, '2024-01-01T00:00:00Z');
  assert.equal(record.kind, 'genesis');
  assert.equal(record.prev, '0'.repeat(64));
  assert.equal(record.createdAt, '2024-01-01T00:00:00Z');
  assert.match(record.hash, /^[0-9a-f]{64}$/);
  assert.equal(line, '{"at":"2024-01-01T00:00:00Z","chain":"c1","createdAt":"2024-01-01T00:00:00Z","hash":"22e126561353aece6fd0d04d3fba0d7af8d61077ac30878a361b60453871a2cf","kind":"genesis","prev":"0000000000000000000000000000000000000000000000000000000000000000","seq":0,"v":1}\n');
});

test('increments seq and sets prev to the previous hash when a prev is given', () => {
  const prev = { chain: 'c1', seq: 4, hash: 'a'.repeat(64) };
  const { record } = makeRecord({
    chain: 'c1',
    prev,
    kind: 'genesis',
    fields: { createdAt: '2024-01-02T00:00:00Z' },
    at: '2024-01-02T00:00:00Z',
  });
  assert.equal(record.seq, 5);
  assert.equal(record.prev, 'a'.repeat(64));
});

test('drops fields whose value is undefined from the record', () => {
  const { record } = makeRecord({
    chain: 'c1',
    prev: null,
    kind: 'input',
    fields: { root: 0, path: '/a.cbl', sha256: 'b'.repeat(64), bytes: undefined },
    at: '2024-01-01T00:00:00Z',
  });
  assert.equal(record.root, 0);
  assert.equal(record.path, '/a.cbl');
  assert.equal(record.sha256, 'b'.repeat(64));
  assert.equal('bytes' in record, false);
});

test('rejects a kind that is not in the spec', () => {
  assert.throws(
    () => makeRecord({ chain: 'c1', prev: null, kind: 'nope', fields: {}, at: '2024-01-01T00:00:00Z' }),
    /no evidence record kind nope/,
  );
});

test('rejects a field that is not in the kind spec', () => {
  assert.throws(
    () => makeRecord({ chain: 'c1', prev: null, kind: 'genesis', fields: { bogus: 1 }, at: '2024-01-01T00:00:00Z' }),
    /genesis: no field bogus/,
  );
});

test('rejects a required field that is missing', () => {
  assert.throws(
    () => makeRecord({ chain: 'c1', prev: null, kind: 'input', fields: { root: 0, path: '/a.cbl' }, at: '2024-01-01T00:00:00Z' }),
    /input: sha256 is required/,
  );
});

test('rejects a field whose value fails its type check', () => {
  assert.throws(
    () => makeRecord({ chain: 'c1', prev: null, kind: 'input', fields: { root: 0, path: '/a.cbl', sha256: 'xyz' }, at: '2024-01-01T00:00:00Z' }),
    /input: sha256 does not hold what the spec says it holds/,
  );
});

test('rejects a field that is reserved for the writer', () => {
  assert.throws(
    () => makeRecord({ chain: 'c1', prev: null, kind: 'genesis', fields: { createdAt: 'x', v: 99 }, at: '2024-01-01T00:00:00Z' }),
    /genesis: v is set by the writer/,
  );
});

test('rejects a sink record that has marker without reached', () => {
  assert.throws(
    () => makeRecord({
      chain: 'c1',
      prev: null,
      kind: 'sink',
      fields: { sink: 's', file: '/a.cbl', line: 1, marker: 'm' },
      at: '2024-01-01T00:00:00Z',
    }),
    /sink: marker and reached come together/,
  );
});

test('accepts a sink record with marker and reached together', () => {
  const { record } = makeRecord({
    chain: 'c1',
    prev: null,
    kind: 'sink',
    fields: { sink: 's', file: '/a.cbl', line: 1, marker: 'm', reached: true },
    at: '2024-01-01T00:00:00Z',
  });
  assert.equal(record.marker, 'm');
  assert.equal(record.reached, true);
});
