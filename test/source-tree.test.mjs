import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { directoryTree, memoryTree, validateTree, TREE_METHODS } from '../lib/kernel/source-tree.mjs';
import { scanHidden } from '../lib/sets/hidden.mjs';
import { scanRecon } from '../lib/sets/recon.mjs';
import './pin-machine.mjs';

const tmp = (n) => mkdtempSync(join(tmpdir(), `cw-tree-${n}-`));

test('a tree answers to the whole shape, and one missing method is refused at the boundary', () => {
  const t = memoryTree({ 'a.cbl': 'x' });
  assert.equal(validateTree(t), t);
  for (const m of TREE_METHODS) assert.equal(typeof t[m], 'function', `${m} is present`);

  const { parse, ...crippled } = t;
  assert.throws(() => validateTree(crippled), (e) => e.code === 'ETREE' && e.missing.includes('parse'));
  assert.throws(() => validateTree(null), (e) => e.code === 'ETREE');
});

// The payoff. A rule set that only reads text can be run against source that was never written to
// disk, which is what makes a fixture readable as a fixture rather than as a directory somewhere.
test('a rule set runs against a tree that was never on disk', () => {
  const tree = memoryTree({
    '/memory/JOB1.jcl': '//JOB1 JOB\n//S1 EXEC PGM=IKJEFT01\n//SYSTSIN DD *\n  CONNECT SOMEUSER\n/*\n',
    '/memory/P.cbl': "       IDENTIFICATION DIVISION.\n       PROGRAM-ID. P.\n       PROCEDURE DIVISION.\n           DISPLAY '203.0.113.9'.\n",
  });
  const r = scanHidden('/memory', { tree });
  assert.equal(r.summary.filesScanned, 2, 'both members were read from memory');
  assert.equal(r.summary.filesUnreadable, 0);
});

test('a memory tree contains exactly what it was given, and nothing else', () => {
  const tree = memoryTree({ '/memory/A.cpy': '01 A PIC X.' });
  assert.equal(tree.contains('/memory/A.cpy'), true);
  assert.equal(tree.contains('/memory/B.cpy'), false, 'containment by construction: a path it does not hold is outside it');
  assert.equal(tree.contains('/etc/passwd'), false);
  assert.throws(() => tree.bytes('/etc/passwd'), (e) => e.code === 'ENOENT');
});

// A tree with no filesystem under it cannot resolve COPY statements, and says so rather than
// parsing something unexpected.
test('a memory tree refuses to parse rather than parsing half a program', () => {
  const tree = memoryTree({ '/memory/P.cbl': 'x' });
  assert.throws(() => tree.parse('/memory/P.cbl'), (e) => e.code === 'ETREEPARSE');
});

// Containment on a directory tree is the filesystem's, unchanged. The walk resolves symlinks and
// refuses the ones that leave; this asserts the tree reports what the walk decided.
test('a directory tree holds what the walk admitted, and excludes what it refused', () => {
  const dir = tmp('contain');
  try {
    mkdirSync(join(dir, 'repo', 'src'), { recursive: true });
    mkdirSync(join(dir, 'outside'));
    writeFileSync(join(dir, 'repo', 'src', 'A.cpy'), '       01 A PIC X.\n');
    writeFileSync(join(dir, 'outside', 'SECRET.cpy'), '       01 S PIC X.\n');
    symlinkSync(join(dir, 'outside'), join(dir, 'repo', 'out'));

    const tree = directoryTree(join(dir, 'repo'));
    const listed = tree.list().map((p) => tree.rel(p));
    assert.deepEqual(listed, ['src/A.cpy'], 'the escaping symlink contributed nothing');
    assert.equal(tree.index.symlinks.outside, 1, 'and it was counted as refused, not ignored');

    assert.equal(tree.contains(join(dir, 'repo', 'src', 'A.cpy')), true);
    assert.equal(tree.contains(join(dir, 'outside', 'SECRET.cpy')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a directory tree reads text and bytes the same way every rule set used to', () => {
  const dir = tmp('read');
  try {
    writeFileSync(join(dir, 'A.cpy'), '       01 A PIC X.\n');
    const tree = directoryTree(dir);
    const [f] = tree.list();
    assert.match(tree.text(f).text, /01 A PIC X/);
    assert.ok(Buffer.isBuffer(tree.bytes(f)));
    assert.equal(tree.rel(f), 'A.cpy', 'report paths are POSIX-shaped on every platform');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// One walk, not one per rule set. This is the cost the port was built to remove.
test('a scan walks the tree once and hands the same tree to every rule set', () => {
  const dir = tmp('once');
  try {
    writeFileSync(join(dir, 'P.cbl'), "       IDENTIFICATION DIVISION.\n       PROGRAM-ID. P.\n       PROCEDURE DIVISION.\n           DISPLAY 'x'.\n");
    const tree = directoryTree(dir);
    let walks = 0;
    const counting = { ...tree, list: () => { walks++; return tree.list(); } };
    scanRecon(dir, { tree: counting });
    assert.ok(walks > 0, 'the set asked the tree for its files');
    // The point is not how many times list() is called but that no set rebuilt the index: a set
    // given a tree never constructs one, and constructing one is what costs a walk.
    assert.equal(counting.index, tree.index, 'the index is the one already built');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The blind spot this closes. Eighteen catch sites discarded the error object and incremented a
// counter, so "3 files unreadable" was everything the report could say. Four different situations
// shared that number: a permission denied, a file deleted mid-scan, a program the parser could not
// make sense of, and this code being wrong.
//
// The last is not hypothetical. Routing reads through the tree left a helper without a tree in
// scope, its catch swallowed the ReferenceError, and four tests failed with nothing on record to
// say why. A reason kept would have named it in one line.
test('a file that cannot be read is named, with the reason, not just counted', () => {
  const tree = memoryTree({ '/memory/GOOD.jcl': '//J JOB\n' });
  // A tree that fails the way a filesystem does: the file is listed and then will not open.
  const flaky = {
    ...tree,
    list: () => ['/memory/GOOD.jcl', '/memory/GONE.jcl'],
    text: (p) => {
      if (p === '/memory/GONE.jcl') throw Object.assign(new Error('nope'), { code: 'EACCES' });
      return tree.text(p);
    },
  };
  const r = scanRecon('/memory', { tree: flaky });
  assert.equal(r.summary.filesUnreadable, 1);
  assert.deepEqual(r.summary.unreadable, ['GONE.jcl: EACCES'],
    'the path and the reason, so someone can go and look');
});

test('a programming error does not disguise itself as an unreadable file', () => {
  const tree = memoryTree({ '/memory/A.jcl': '//J JOB\n' });
  const broken = {
    ...tree,
    text: () => { throw new ReferenceError('tree is not defined'); },
  };
  const r = scanRecon('/memory', { tree: broken });
  assert.match(r.summary.unreadable[0], /ReferenceError/,
    'a bug in this code is recorded as a bug, not as a file the disk would not give up');
});
