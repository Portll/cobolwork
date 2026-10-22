// Caches per-file bytes, text, and parse results for the focused file (lib/kernel/shared-pass.mjs sharingTree).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sharingTree } from '../lib/kernel/shared-pass.mjs';
import './pin-machine.mjs';

test('returns base bytes when path is not the focus', () => {
  const base = {
    bytes: (p) => Buffer.from('b:' + p),
    text: (p) => ({ text: 't:' + p }),
    parse: (p, s) => ({ parsed: p, src: s }),
  };
  const tree = sharingTree(base);
  tree.focusOn('a');
  assert.deepEqual(tree.bytes('other'), Buffer.from('b:other'));
});

test('returns base text when path is not the focus', () => {
  const base = {
    bytes: (p) => Buffer.from('b:' + p),
    text: (p) => ({ text: 't:' + p }),
    parse: (p, s) => ({ parsed: p, src: s }),
  };
  const tree = sharingTree(base);
  tree.focusOn('a');
  assert.deepEqual(tree.text('other'), { text: 't:other' });
});

test('returns base parse when path is not the focus', () => {
  const base = {
    bytes: (p) => Buffer.from('b:' + p),
    text: (p) => ({ text: 't:' + p }),
    parse: (p, s) => ({ parsed: p, src: s }),
  };
  const tree = sharingTree(base);
  tree.focusOn('a');
  assert.deepEqual(tree.parse('other', 'src'), { parsed: 'other', src: 'src' });
});

test('caches bytes for the focused file across calls', () => {
  let calls = 0;
  const base = {
    bytes: (p) => { calls++; return Buffer.from('data' + p); },
    text: (p) => ({ text: 't' + p }),
    parse: (p, s) => ({ parsed: p, src: s }),
  };
  const tree = sharingTree(base);
  tree.focusOn('f');
  const b1 = tree.bytes('f');
  const b2 = tree.bytes('f');
  assert.equal(calls, 1);
  assert.deepEqual(b1, Buffer.from('dataf'));
  assert.deepEqual(b2, Buffer.from('dataf'));
  assert.equal(b1, b2);
});

test('caches text for the focused file when base has no decode', () => {
  let calls = 0;
  const base = {
    bytes: (p) => Buffer.from('raw' + p),
    text: (p) => { calls++; return { text: 'txt' + p }; },
    parse: (p, s) => ({ parsed: p, src: s }),
  };
  const tree = sharingTree(base);
  tree.focusOn('f');
  const t1 = tree.text('f');
  const t2 = tree.text('f');
  assert.equal(calls, 1);
  assert.deepEqual(t1, { text: 'txtf' });
  assert.deepEqual(t2, { text: 'txtf' });
  assert.equal(t1, t2);
});

test('uses decode to build text from bytes for the focused file', () => {
  let byteCalls = 0;
  const base = {
    bytes: (p) => { byteCalls++; return Buffer.from('raw' + p); },
    decode: (buf) => ({ text: buf.toString() }),
    parse: (p, s) => ({ parsed: p, src: s }),
  };
  const tree = sharingTree(base);
  tree.focusOn('f');
  const t1 = tree.text('f');
  const t2 = tree.text('f');
  assert.equal(byteCalls, 1);
  assert.deepEqual(t1, { text: 'rawf' });
  assert.deepEqual(t2, { text: 'rawf' });
  assert.equal(t1, t2);
});

test('caches parse result for the focused file with same source', () => {
  let calls = 0;
  const base = {
    bytes: (p) => Buffer.from('raw' + p),
    text: (p) => ({ text: 'txt' + p }),
    parse: (p, s) => { calls++; return { parsed: p, src: s }; },
  };
  const tree = sharingTree(base);
  tree.focusOn('f');
  const r1 = tree.parse('f');
  const r2 = tree.parse('f');
  assert.equal(calls, 1);
  assert.deepEqual(r1, { parsed: 'f', src: 'txtf' });
  assert.deepEqual(r2, { parsed: 'f', src: 'txtf' });
  assert.equal(r1, r2);
});

test('re-parses when source text changes for the focused file', () => {
  let calls = 0;
  const base = {
    bytes: (p) => Buffer.from('raw' + p),
    text: (p) => ({ text: 'txt' + p }),
    parse: (p, s) => { calls++; return { parsed: p, src: s }; },
  };
  const tree = sharingTree(base);
  tree.focusOn('f');
  const r1 = tree.parse('f');
  const r2 = tree.parse('f', 'different');
  assert.equal(calls, 2);
  assert.deepEqual(r1, { parsed: 'f', src: 'txtf' });
  assert.deepEqual(r2, { parsed: 'f', src: 'different' });
  assert.notEqual(r1, r2);
});

test('throws the same error when bytes fails for the focused file', () => {
  const err = new Error('boom');
  const base = {
    bytes: (p) => { throw err; },
    text: (p) => ({ text: 't' + p }),
    parse: (p, s) => ({ parsed: p, src: s }),
  };
  const tree = sharingTree(base);
  tree.focusOn('f');
  assert.throws(() => tree.bytes('f'), err);
  assert.throws(() => tree.bytes('f'), err);
});

test('throws the same error when parse fails for the focused file', () => {
  const err = new Error('parse fail');
  const base = {
    bytes: (p) => Buffer.from('raw' + p),
    text: (p) => ({ text: 'txt' + p }),
    parse: (p, s) => { throw err; },
  };
  const tree = sharingTree(base);
  tree.focusOn('f');
  assert.throws(() => tree.parse('f'), err);
  assert.throws(() => tree.parse('f'), err);
});
