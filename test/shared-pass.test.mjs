import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drive, driveTogether, loopOver, sharingTree } from '../lib/kernel/shared-pass.mjs';
import './pin-machine.mjs';

const fakeTree = (files) => {
  const calls = { text: 0, parse: 0 };
  return {
    calls,
    tree: sharingTree({
      list: () => [...files],
      text: (p) => { calls.text++; if (p.includes('UNREAD')) throw Object.assign(new Error('no'), { code: 'EACCES' }); return { text: `src ${p}` }; },
      parse: (p, src) => { calls.parse++; if (p.includes('BAD')) throw new Error(`cannot parse ${p}`); return { file: p, src }; },
    }),
  };
};

// A set as the shared pass sees one: it lists its files, yields its loop, and reports what it saw.
function* reader(tree, pick, opts = {}) {
  const seen = [];
  const run = yield loopOver(tree.list().filter(pick), (f, i) => {
    let r;
    try { r = tree.parse(f, tree.text(f).text); } catch (e) { seen.push(`${i}:${f}:${e.code || 'unparsed'}`); return 1; }
    seen.push(`${i}:${r.file}`);
    return 1;
  }, { label: 'reader', ...opts });
  return { seen, run };
}

test('sets that share a pass each see their own files in their own order, and each file is read and parsed once', () => {
  const { tree, calls } = fakeTree(['a.cbl', 'b.cbl', 'c.jcl', 'd.cbl']);
  const [all, programs] = driveTogether([reader(tree, () => true), reader(tree, (p) => p.endsWith('.cbl'))], tree);
  assert.deepEqual(all.seen, ['0:a.cbl', '1:b.cbl', '2:c.jcl', '3:d.cbl']);
  assert.deepEqual(programs.seen, ['0:a.cbl', '1:b.cbl', '2:d.cbl']);
  assert.equal(calls.parse, 4);
  assert.equal(calls.text, 4);
  assert.equal(all.run.processed, 4);
  assert.equal(programs.run.complete, true);
});

test('a set on its own runs its loop as the guarded loop does', () => {
  const { tree, calls } = fakeTree(['a.cbl', 'b.cbl']);
  const r = drive(reader(tree, () => true));
  assert.deepEqual(r.seen, ['0:a.cbl', '1:b.cbl']);
  assert.equal(r.run.processed, 2);
  assert.deepEqual(r.run.skipped, []);
  assert.equal(calls.parse, 2);
});

test('a file that cannot be read or parsed fails the same way for every set, and is tried once', () => {
  const { tree, calls } = fakeTree(['BAD.cbl', 'UNREAD.cbl', 'ok.cbl']);
  const [x, y] = driveTogether([reader(tree, () => true), reader(tree, () => true)], tree);
  assert.deepEqual(x.seen, ['0:BAD.cbl:unparsed', '1:UNREAD.cbl:EACCES', '2:ok.cbl']);
  assert.deepEqual(y.seen, x.seen);
  assert.equal(calls.parse, 2);
  assert.equal(calls.text, 3);
});

test('a set reading bytes and one reading text share one read of each file where the tree decodes its bytes', () => {
  const reads = [];
  const tree = sharingTree({
    list: () => ['a.cbl', 'b.cbl'],
    bytes: (p) => { reads.push(p); return Buffer.from(`src ${p}`, 'latin1'); },
    text: () => { throw new Error('text is read through decode'); },
    decode: (buf) => ({ text: buf.toString('latin1') }),
  });
  function* bytesReader() {
    const seen = [];
    const run = yield loopOver(tree.list(), (f) => { seen.push(tree.bytes(f).length); return 1; });
    return { seen, run };
  }
  function* textReader() {
    const seen = [];
    const run = yield loopOver(tree.list(), (f) => { seen.push(tree.text(f).text); return 1; });
    return { seen, run };
  }
  const [texts, sizes] = driveTogether([textReader(), bytesReader()], tree);
  assert.deepEqual(texts.seen, ['src a.cbl', 'src b.cbl']);
  assert.deepEqual(sizes.seen, [9, 9]);
  assert.deepEqual(reads, ['a.cbl', 'b.cbl']);
});

test('a byte budget stops only the set that set it', () => {
  const { tree } = fakeTree(['a.cbl', 'b.cbl', 'c.cbl']);
  const [small, whole] = driveTogether([reader(tree, () => true, { maxBytes: 1 }), reader(tree, () => true)], tree);
  assert.deepEqual(small.seen, ['0:a.cbl']);
  assert.equal(small.run.stoppedBy, 'byte budget');
  assert.deepEqual(small.run.skipped, ['b.cbl', 'c.cbl']);
  assert.match(small.run.note, /2 of 3 files were not read because the scan reached its source byte budget/);
  assert.equal(whole.run.processed, 3);
});

test('a set that throws in its loop gets the error back where it yielded, and the others finish', () => {
  const { tree } = fakeTree(['a.cbl', 'b.cbl']);
  function* thrower() { yield loopOver(tree.list(), () => { throw new Error('boom'); }); return 'unreached'; }
  function* catcher() {
    try { yield loopOver(tree.list(), () => { throw new Error('caught'); }); } catch (e) { return `caught ${e.message}`; }
    return 'unreached';
  }
  const [a, b, c] = driveTogether([thrower(), reader(tree, () => true), catcher()], tree);
  assert.equal(a.error.message, 'boom');
  assert.deepEqual(b.seen, ['0:a.cbl', '1:b.cbl']);
  assert.equal(c, 'caught caught');
});

test('files out of the tree order run alone, and a set may ask for more than one loop', () => {
  const { tree } = fakeTree(['a.cbl', 'b.cbl', 'c.cbl']);
  function* reversed() {
    const seen = [];
    yield loopOver(['c.cbl', 'a.cbl'], (f) => { seen.push(tree.parse(f).file); });
    yield loopOver(['b.cbl'], (f) => { seen.push(tree.parse(f).file); });
    return seen;
  }
  const [r, plain] = driveTogether([reversed(), reader(tree, () => true)], tree);
  assert.deepEqual(r, ['c.cbl', 'a.cbl', 'b.cbl']);
  assert.deepEqual(plain.seen, ['0:a.cbl', '1:b.cbl', '2:c.cbl']);
});
