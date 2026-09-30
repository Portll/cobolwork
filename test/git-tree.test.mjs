import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { gitTree, memoryTree, validateTree } from '../lib/kernel/source-tree.mjs';
import { scanAll } from '../lib/scan.mjs';
import { diffRefs } from '../lib/diff.mjs';
import './pin-machine.mjs';

const tmp = (t) => mkdtempSync(join(tmpdir(), `cw-gittree-${t}-`));
const posix = process.platform === 'win32';
const program = (id, ws, body) => ['       IDENTIFICATION DIVISION.', `       PROGRAM-ID. ${id}.`, '       DATA DIVISION.',
  '       WORKING-STORAGE SECTION.', ws, '       PROCEDURE DIVISION.', body, '           GOBACK.', ''].join('\n');
const git = (dir, args, input) => {
  const r = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', input });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
function repo(files) {
  const dir = tmp('repo');
  git(dir, ['init', '-q']);
  for (const [k, v] of [['user.email', 't@example.com'], ['user.name', 't'], ['core.autocrlf', 'false']]) git(dir, ['config', k, v]);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);
  return dir;
}

test('a git tree answers to the whole shape, holds the revision, and reads nothing from the working tree', () => {
  const dir = repo({ 'src/P.cbl': program('P', '       COPY A.', '           DISPLAY A'), 'cpy/A.cpy': '       01 A PIC X(3).\n' });
  try {
    writeFileSync(join(dir, 'cpy', 'A.cpy'), '       01 A PIC X(9).\n');
    writeFileSync(join(dir, 'src', 'NEW.cbl'), program('NEW', '', ''));
    const tree = validateTree(gitTree(dir, 'HEAD'));
    assert.deepEqual(tree.list().map(tree.rel), ['cpy/A.cpy', 'src/P.cbl']);
    const r = tree.parse(resolve(tree.root, 'src/P.cbl'));
    assert.equal(r.copies[0].status, 'resolved');
    assert.equal(r.programs[0].items.find((i) => i.name === 'A').size, 3, 'the committed copybook, not the edited one');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('COPY cannot leave a git tree: absolute and climbing names are refused, and COBCPY is a declared library', () => {
  const dir = tmp('confine');
  const saved = process.env.COBCPY;
  try {
    mkdirSync(join(dir, 'lib'));
    writeFileSync(join(dir, 'lib', 'SHARED.cpy'), '       01 SH PIC X(4).\n');
    writeFileSync(join(dir, 'outside.cpy'), '       01 O PIC X.\n');
    const r = repo({ 'C.cbl': program('C', '       COPY "/etc/hosts".\n       COPY "../outside".\n       COPY SHARED.', '           DISPLAY SH') });
    try {
      const tree = gitTree(r, 'HEAD');
      const parse = () => tree.parse(resolve(tree.root, 'C.cbl')).copies.map((c) => c.status);
      delete process.env.COBCPY;
      assert.deepEqual(parse(), ['refused-absolute', 'refused-outside', 'missing']);
      process.env.COBCPY = join(dir, 'lib');
      assert.deepEqual(parse(), ['refused-absolute', 'refused-outside', 'resolved']);
    } finally { rmSync(r, { recursive: true, force: true }); }
  } finally {
    if (saved === undefined) delete process.env.COBCPY; else process.env.COBCPY = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a git tree resolves a COPY that climbs to a sibling inside it, and a path-shaped COPY to its own path only', () => {
  const dir = repo({
    'src/P.cbl': program('P', '       COPY "../copybooks/KUNDER.cpy".\n       COPY "../cpy/LIB/X".\n       COPY "../cpy/NOPE/X".', '           DISPLAY K'),
    'copybooks/KUNDER.cpy': '       01 K PIC X(4).\n',
    'cpy/LIB/X.cpy': '       01 LX PIC X(4).\n',
    'other/X.cpy': '       01 OX PIC X(4).\n',
  });
  try {
    const tree = gitTree(dir, 'HEAD');
    const r = tree.parse(resolve(tree.root, 'src/P.cbl'));
    assert.deepEqual(r.copies.map((c) => c.status), ['resolved', 'resolved', 'missing']);
    assert.equal(tree.rel(r.copies[1].path), 'cpy/LIB/X.cpy');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('links in a revision are not read, whether they point inside the tree or out of it', { skip: posix }, () => {
  const dir = tmp('links');
  try {
    mkdirSync(join(dir, 'outside'));
    writeFileSync(join(dir, 'outside', 'SECRET.cpy'), '       01 S PIC X.\n');
    const r = repo({ 'shared/A.cpy': '       01 A PIC X.\n', 'P.cbl': program('P', '       COPY SECRET.', '') });
    try {
      symlinkSync(join(dir, 'outside'), join(r, 'out'));
      symlinkSync('shared', join(r, 'lib'));
      git(r, ['add', '-A']);
      git(r, ['commit', '-qm', 'links']);
      const tree = gitTree(r, 'HEAD');
      assert.deepEqual(tree.list().map(tree.rel), ['P.cbl', 'shared/A.cpy']);
      assert.equal(tree.index.symlinks.notRead, 2);
      assert.equal(tree.parse(resolve(tree.root, 'P.cbl')).copies[0].status, 'missing');
    } finally { rmSync(r, { recursive: true, force: true }); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a file on disk where the git tree\'s root would be is never read in its place', () => {
  const dir = repo({ 'P.cbl': program('P', '       COPY GHOST.', '') });
  try {
    const tree = gitTree(dir, 'HEAD');
    mkdirSync(tree.root, { recursive: true });
    writeFileSync(join(tree.root, 'GHOST.cpy'), '       01 G PIC X.\n');
    try {
      assert.equal(tree.parse(resolve(tree.root, 'P.cbl')).copies[0].status, 'missing');
      assert.equal(tree.contains(join(tree.root, 'GHOST.cpy')), false);
    } finally { rmSync(tree.root, { recursive: true, force: true }); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A case-insensitive filesystem holds one of two names that differ only in case, so writing the
// revision to disk loses a file. The tree holds both.
test('two files whose names differ only in case stay two files', () => {
  const dir = repo({ 'README': 'x\n' });
  try {
    const add = (path, text) => {
      const oid = git(dir, ['hash-object', '-w', '--stdin'], text);
      git(dir, ['update-index', '--add', '--cacheinfo', `100644,${oid},${path}`]);
    };
    add('src/AB.cbl', program('UPPER', '       01 U PIC X(2).', ''));
    add('src/ab.cbl', program('LOWER', '       01 L PIC X(7).', ''));
    git(dir, ['commit', '-qm', 'two names']);
    const tree = gitTree(dir, 'HEAD');
    const ids = ['src/AB.cbl', 'src/ab.cbl'].map((p) => tree.parse(resolve(tree.root, p)).programs[0].id);
    assert.deepEqual(ids, ['UPPER', 'LOWER']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a scan of a git tree finds and fingerprints what a scan of the same files on disk does', () => {
  const files = {
    'src/P.cbl': program('P', '       01 WS-CMD PIC X(80).\n       COPY A.', '           ACCEPT WS-CMD FROM COMMAND-LINE\n           CALL "SYSTEM" USING WS-CMD'),
    'cpy/A.cpy': '       01 A PIC X(3).\n',
  };
  const dir = repo(files);
  try {
    const tree = gitTree(dir, 'HEAD');
    const fromGit = scanAll(tree.root, { tree });
    const fromDisk = scanAll(dir);
    const key = (r) => r.findings.map((f) => [f.rule, f.path, f.line, f.fingerprint].join('|')).sort();
    assert.ok(fromDisk.findings.length > 0);
    assert.deepEqual(key(fromGit), key(fromDisk));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('diff between two revisions writes nothing to disk and reports a copybook edit in the program it reaches', () => {
  const dir = repo({ 'src/P.cbl': program('P', '       COPY A.', '           DISPLAY A'), 'cpy/A.cpy': '       01 A PIC X(3).\n' });
  try {
    writeFileSync(join(dir, 'cpy', 'A.cpy'), '       01 A PIC X(9).\n');
    git(dir, ['commit', '-qam', 'wider']);
    // A temporary directory of this test's own: other test files write revisions to the shared one at the same time.
    const own = mkdtempSync(join(tmpdir(), 'cobolwork-git-tree-'));
    const saved = process.env.TMPDIR;
    process.env.TMPDIR = own;
    let res;
    try { res = diffRefs(dir, 'HEAD~1', 'HEAD'); } finally { if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved; }
    assert.deepEqual(readdirSync(own), [], 'no revision was written out');
    rmSync(own, { recursive: true, force: true });
    assert.deepEqual(res.findings.map((f) => [f.rule, f.path]), [['diff-layout-changed-unedited-program', 'src/P.cbl']]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A PDS member has no extension and is classified by its contents, which a git tree holds and the disk does not.
test('a member with no extension is a program in a git tree, as it is on disk', () => {
  const dir = repo({ 'members/PAYCALC': program('PAYCALC', '       COPY A.', '           DISPLAY A'), 'cpy/A.cpy': '       01 A PIC X(3).\n' });
  try {
    writeFileSync(join(dir, 'cpy', 'A.cpy'), '       01 A PIC X(9).\n');
    git(dir, ['commit', '-qam', 'wider']);
    const res = diffRefs(dir, 'HEAD~1', 'HEAD');
    assert.equal(res.summary.programsCompared, 1);
    assert.deepEqual(res.findings.map((f) => [f.rule, f.path]), [['diff-layout-changed-unedited-program', 'members/PAYCALC']]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a memory tree parses, and a COPY it does not hold is missing even where a file of that name sits on disk', () => {
  const dir = tmp('memory');
  try {
    writeFileSync(join(dir, 'GHOST.cpy'), '       01 G PIC X.\n');
    const tree = memoryTree({
      [join(dir, 'P.cbl')]: program('P', '       COPY A.\n       COPY GHOST.', ''),
      [join(dir, 'A.cpy')]: '       01 A PIC X(3).\n',
    }, { root: dir });
    const r = tree.parse(join(dir, 'P.cbl'));
    assert.deepEqual(r.copies.map((c) => c.status), ['resolved', 'missing']);
    assert.equal(r.programs[0].items.find((i) => i.name === 'A').size, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
