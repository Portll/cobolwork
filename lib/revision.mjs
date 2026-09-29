// SPDX-License-Identifier: AGPL-3.0-or-later
// Which commit a report was made by, and which commit it read: summary.toolRevision and
// summary.revision, each { commit, dirty }. A scanned repository is untrusted, and its .git/config
// can name commands that porcelain runs - `git status` runs clean filters and fsmonitor - so only
// plumbing that lists objects and files runs here, and whether the tree differs from HEAD is decided
// by hashing its files in process.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
const git = (dir, args) => spawnSync('git', ['-c', 'core.fsmonitor=false', '-C', dir, ...args], { env: GIT_ENV, maxBuffer: 256 << 20 });
// Past this many tracked files the comparison is not made, and dirty is null rather than a guess.
const MAX_TRACKED = 50000;

const nulSplit = (buf) => buf.toString('utf8').split('\0').filter(Boolean);

// The object id git would give these bytes as a blob.
const blobId = (bytes, format) => createHash(format).update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

// { commit, dirty } for the repository `dir` is in, over `paths` under it when given, or null
// outside a repository. dirty is true when a tracked file under `dir` differs from HEAD or is gone,
// or a file git does not ignore is untracked; null when there were too many files to compare. A
// checkout that converts line endings reads as dirty, which errs the safe way.
export function revisionOf(dir, { paths = [] } = {}) {
  const head = git(dir, ['rev-parse', '--verify', '-q', 'HEAD']);
  if (head.status !== 0) return null;
  const commit = head.stdout.toString().trim();
  const fmt = git(dir, ['rev-parse', '--show-object-format']);
  const format = fmt.status === 0 && fmt.stdout.toString().trim() === 'sha256' ? 'sha256' : 'sha1';
  const scope = paths.length ? ['--', ...paths] : [];
  const listed = git(dir, ['ls-tree', '-r', '-z', 'HEAD', ...scope]);
  if (listed.status !== 0) return { commit, dirty: null };
  const entries = nulSplit(listed.stdout);
  if (entries.length > MAX_TRACKED) return { commit, dirty: null };
  for (const entry of entries) {
    const tab = entry.indexOf('\t');
    const [mode, type, id] = entry.slice(0, tab).split(' ');
    const rel = entry.slice(tab + 1);
    if (type !== 'blob') continue;
    const file = join(dir, rel);
    let st;
    try { st = lstatSync(file); } catch { return { commit, dirty: true }; }
    const bytes = mode === '120000'
      ? (st.isSymbolicLink() ? Buffer.from(readlinkSync(file)) : null)
      : (st.isFile() ? readFileSync(file) : null);
    if (!bytes || blobId(bytes, format) !== id) return { commit, dirty: true };
  }
  const untracked = git(dir, ['ls-files', '-z', '--others', '--exclude-standard', ...scope]);
  if (untracked.status !== 0) return { commit, dirty: null };
  return { commit, dirty: nulSplit(untracked.stdout).length > 0 };
}

// { commit, dirty: false } for a named revision, which is a commit and nothing on disk; null if it
// does not resolve.
export function commitAt(dir, ref) {
  if (!ref || String(ref).startsWith('-')) return null;
  const r = git(dir, ['rev-parse', '--verify', '-q', `${ref}^{commit}`]);
  return r.status === 0 ? { commit: r.stdout.toString().trim(), dirty: false } : null;
}

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
// What decides a report: the code, the rules it loads and the schemas it names.
export const SHIPPED = ['bin', 'lib', 'rules', 'schema', 'package.json'];
export const PACKED_REVISION = join(PACKAGE_ROOT, 'lib', 'revision.json');

// Whether this cobolwork is its own checkout, not a package installed somewhere inside another
// repository, whose HEAD would say nothing about this code.
function isOwnCheckout() {
  const top = git(PACKAGE_ROOT, ['rev-parse', '--show-toplevel']);
  if (top.status !== 0) return false;
  try { return realpathSync(top.stdout.toString().trim()) === realpathSync(PACKAGE_ROOT); } catch { return false; }
}

// The revision this cobolwork runs from: read from the checkout it runs in, over the files that
// decide what it reports, or stamped into a packed release by diag/stamp-revision.mjs.
export function toolRevision() {
  if (isOwnCheckout()) {
    const r = revisionOf(PACKAGE_ROOT, { paths: SHIPPED });
    return r ? { ...r, from: 'checkout' } : null;
  }
  if (!existsSync(PACKED_REVISION)) return null;
  try {
    const r = JSON.parse(readFileSync(PACKED_REVISION, 'utf8'));
    return { commit: r.commit, dirty: false, ...(r.tag ? { tag: r.tag } : {}), from: 'release' };
  } catch { return null; }
}
