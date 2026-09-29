// SPDX-License-Identifier: AGPL-3.0-or-later
// Where a rule set gets its source from, as a thing that can be handed to it rather than a path it
// goes and reads for itself.
//
// Three reasons, in the order they matter:
//
//   cost          Every rule set called buildFileIndex(root) for itself, so one scan walked the
//                 tree ten times - readdirSync and realpathSync over every entry, ten times over.
//                 A tree is built once and passed.
//
//   one parse     The options object handed to parseSource existed in five copies, and they had
//                 drifted: lib/diff.mjs passed systemDirs: [] where every other caller passed
//                 opts.systemDirs, so diff could not resolve a system copybook that scan could.
//                 Nobody decided that. It is what copied code does.
//
//   testability   A rule set that takes a tree can be given one that was never on disk.
//
// CONTAINMENT. Read this before writing another adapter.
//
// SECURITY.md names reading outside the tree as its first in-scope vulnerability class: reaching
// outside is refused by design, so a way around that refusal is a vulnerability rather than a bug.
// Today that refusal is a filesystem fact - lib/parser.mjs:322 anchors on realpathSync(root), :345
// refuses a symlink whose realpath leaves the tree, and :448 refuses a COPY that resolves outside
// it. The directory tree below does not reimplement any of that; it delegates to the same
// buildFileIndex, so the guarantee is the one the tests already pin.
//
// An adapter that does not have a filesystem underneath it has to make that decision itself, and
// `contains` is where it makes it. For a tree held in memory it is key membership. For a git
// revision it is membership of the tree object, which cannot name a path outside itself. Anything
// cleverer than those two deserves the six containment tests pointed at it before it ships:
// test/sources.test.mjs:44, :63, :88, :101, :144 and test/review.test.mjs:114.
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { buildFileIndex, parseSource } from '../parser.mjs';
import { readSource, relPath } from '../sources.mjs';

// The shape every adapter answers to. Checked rather than documented, because an adapter missing a
// method fails at the first rule set that happens to call it rather than at the boundary.
export const TREE_METHODS = ['list', 'bytes', 'text', 'contains', 'parse', 'rel'];

export function validateTree(tree) {
  if (!tree || typeof tree !== 'object') {
    throw Object.assign(new Error('a source tree is required'), { code: 'ETREE' });
  }
  const missing = TREE_METHODS.filter((m) => typeof tree[m] !== 'function');
  if (missing.length) {
    throw Object.assign(new Error(`source tree is missing: ${missing.join(', ')}`), { code: 'ETREE', missing });
  }
  return tree;
}

// Whether a path is still under root once every link in it is followed.
export function resolvesInside(root, p) {
  try {
    const top = realpathSync(root);
    const real = realpathSync(p);
    return real === top || real.startsWith(top + sep);
  } catch { return false; }
}

// A directory on disk. Behaviour is identical to what every rule set did for itself; the only
// difference is that the walk happens once.
export function directoryTree(root, opts = {}) {
  const idx = buildFileIndex(root);
  const systemDirs = opts.systemDirs || [];
  const top = resolve(root);

  return {
    kind: 'directory',
    root,
    // The index itself, for the two callers that need more than a list: the copybook set reads
    // copyDirs, and the inventory reports on unreadable directories and symlinks.
    index: idx,
    list: () => [...idx.index.values()].sort(),
    bytes: (p) => readFileSync(p),
    text: (p) => readSource(p),
    rel: (p) => relPath(root, p),
    // The same prefix test buildFileIndex applies while walking. It is not the containment
    // mechanism - the walk is, and it resolves symlinks before testing - it is the answer to
    // "is this path one of mine" for a caller holding a path from somewhere else.
    contains: (p) => { const r = resolve(p); return r === top || r.startsWith(top + sep); },
    // One parse configuration, in one place. `text` is optional: a caller that has already read
    // the source passes it rather than reading twice.
    parse: (file, text) => parseSource(text ?? readSource(file).text, file, {
      format: 'auto',
      includeDirs: idx.copyDirs,
      fileIndex: idx.index,
      mainDir: dirname(file),
      copyFormat: 'auto',
      systemDirs,
    }),
  };
}

// A tree that was never on disk, for tests. `files` maps a path to its contents, as a string or a
// Buffer. Paths are used exactly as given, so a test reads the way it writes.
//
// It cannot parse. parseSource resolves COPY statements against real directories and reads them
// with readSource, so a program with copybooks needs a filesystem underneath it. A rule set that
// only reads text - hidden, recon, vendor, jcl, build - works against this; one that parses does
// not, and says so rather than parsing something unexpected.
export function memoryTree(files, { root = '/memory' } = {}) {
  const store = new Map(Object.entries(files).map(([p, v]) => [p, Buffer.isBuffer(v) ? v : Buffer.from(v, 'latin1')]));
  return {
    kind: 'memory',
    root,
    index: { index: store, copyDirs: [], unreadableDirs: [], symlinks: { followed: 0, outside: 0, broken: 0 } },
    list: () => [...store.keys()].sort(),
    bytes: (p) => {
      const b = store.get(p);
      if (!b) throw Object.assign(new Error(`no such file in this tree: ${p}`), { code: 'ENOENT' });
      return b;
    },
    text: (p) => {
      const b = store.get(p);
      if (!b) throw Object.assign(new Error(`no such file in this tree: ${p}`), { code: 'ENOENT' });
      return { text: b.toString('latin1'), encoding: 'latin1' };
    },
    rel: (p) => String(p).replace(/\\/g, '/').replace(new RegExp('^' + root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/?'), ''),
    // Containment by construction: a path this tree does not hold is a path outside it.
    contains: (p) => store.has(p),
    parse: () => {
      throw Object.assign(
        new Error('a memory tree cannot parse: COPY resolution reads directories from disk'),
        { code: 'ETREEPARSE' },
      );
    },
  };
}

// What a rule set calls. Given a tree it uses it; given none it builds the directory one, so every
// existing caller keeps working unchanged.
export const treeFor = (root, opts = {}) => (opts.tree ? validateTree(opts.tree) : directoryTree(root, opts));

// Why a file did not contribute what it should have.
//
// Eighteen catch sites discarded the error object entirely and incremented a counter. "3 files
// unreadable" over a hundred thousand names nothing to go and look at, and it flattens four
// different situations into one number: a permission denied, a file deleted mid-scan, a program
// the parser could not make sense of, and this code being wrong.
//
// The last one is not hypothetical. Routing reads through the source tree left one helper without
// a tree in scope; its `catch { continue }` swallowed the ReferenceError, the rule set returned an
// empty program list, and four tests failed with nothing on record to say why. The error had a
// name the whole time and nobody kept it.
const reasonOf = (e) => (e && (e.code || e.name)) || 'unknown';

// Read failed: the bytes never arrived.
export function noteUnread(stats, tree, file, err) {
  stats.filesUnreadable = (stats.filesUnreadable || 0) + 1;
  (stats.unreadable ||= []).push(`${tree.rel(file)}: ${reasonOf(err)}`);
}

// Read succeeded and the parse did not. A different thing, and counted as one: the file was read,
// so it is not unreadable, and a scan that says otherwise understates what it managed to look at.
export function noteUnparsed(stats, tree, file, err) {
  stats.filesUnparsed = (stats.filesUnparsed || 0) + 1;
  (stats.unparsed ||= []).push(`${tree.rel(file)}: ${reasonOf(err)}`);
}
