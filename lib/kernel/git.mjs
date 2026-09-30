// SPDX-License-Identifier: AGPL-3.0-or-later
// Reading a revision out of a repository with git plumbing only.
import { spawnSync } from 'node:child_process';

// A reviewed repository's .git/config can name commands; with fsmonitor off and plumbing only, git runs none.
const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
export const git = (repo, args, opts = {}) => spawnSync('git', ['-c', 'core.fsmonitor=false', '-C', repo, ...args], { env: GIT_ENV, maxBuffer: 256 * 1024 * 1024, ...opts });
export const refused = (what, ref, why) => Object.assign(new Error(`${what} ${ref} failed: ${why}`), { code: 'EDIFFREF' });
const BATCH_BYTES = 64 * 1024 * 1024;

export function treeOf(repo, ref) {
  if (!ref || String(ref).startsWith('-')) throw refused('git rev-parse', ref, 'a revision cannot be empty or start with "-"');
  const r = git(repo, ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{tree}`], { encoding: 'utf8' });
  const oid = String(r.stdout || '').trim();
  if (r.status !== 0 || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(oid)) throw refused('git rev-parse', ref, String(r.stderr || '').trim() || 'not a revision');
  return oid;
}

// The parts of a tree path, or null if a part is empty, climbs, names a drive or stream, or is .git.
export function treePathParts(path) {
  const parts = path.split('/');
  return parts.some((p) => !p || p === '.' || p === '..' || /[\\:\0]/.test(p) || p.toLowerCase() === '.git') ? null : parts;
}

// Every file in the tree `oid` as committed, as [{ path, bytes }] in tree order: blobs as stored,
// with no filter or line-ending conversion. Links and submodules are left out and counted.
export function revisionBlobs(repo, oid, ref = oid) {
  const listed = git(repo, ['ls-tree', '-r', '-z', '-l', '--full-tree', oid]);
  if (listed.status !== 0) throw refused('git ls-tree', ref, String(listed.stderr || '').trim() || `exit ${listed.status}`);
  const blobs = [];
  let links = 0;
  for (const entry of listed.stdout.toString('utf8').split('\0')) {
    const m = /^(\d{6}) blob ([0-9a-f]+) +(\d+)\t(.+)$/s.exec(entry);
    if (!m) continue;
    if (m[1] === '120000') { links++; continue; }
    blobs.push({ oid: m[2], size: Number(m[3]), path: m[4] });
  }
  // Batched by bytes as well as count, and each batch's buffer sized to hold it, so one large blob
  // cannot overflow a buffer sized for the others.
  const batches = [];
  for (const b of blobs) {
    const last = batches[batches.length - 1];
    if (!last || last.length >= 500 || last.bytes + b.size > BATCH_BYTES) batches.push(Object.assign([b], { bytes: b.size }));
    else { last.push(b); last.bytes += b.size; }
  }
  for (const batch of batches) {
    const r = git(repo, ['cat-file', '--batch'], { input: batch.map((b) => b.oid).join('\n') + '\n', maxBuffer: batch.bytes + batch.length * 128 + 4096 });
    if (r.status !== 0) throw refused('git cat-file', ref, String(r.stderr || '').trim() || (r.error ? r.error.code || r.error.message : `exit ${r.status}`));
    let at = 0;
    for (const b of batch) {
      const nl = r.stdout.indexOf(0x0a, at);
      const head = r.stdout.toString('utf8', at, nl).split(' ');
      if (head[1] !== 'blob') throw refused('git cat-file', ref, `${b.oid} is ${head[1] || 'missing'}`);
      const size = Number(head[2]);
      b.bytes = r.stdout.subarray(nl + 1, nl + 1 + size);
      at = nl + 1 + size + 1;
    }
  }
  return { blobs, links };
}
