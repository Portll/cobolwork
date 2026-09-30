// SPDX-License-Identifier: AGPL-3.0-or-later
// The evidence directory on disk: where it may be, how its files are opened (never through a
// symbolic link, owner-only), the ledger lock, and reading a chain file back line by line.
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

const { O_WRONLY, O_CREAT, O_EXCL, O_APPEND, O_NOFOLLOW } = constants;

export class EvidenceRefusal extends Error {
  constructor(message) { super(message); this.code = 'EEVIDENCE'; }
}

const isLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };

// The directory named by --evidence or COBOLWORK_EVIDENCE, or null when neither is set.
export function evidenceDirFrom(opts, env = process.env) {
  const named = opts.evidence || env.COBOLWORK_EVIDENCE || null;
  return named ? resolve(named) : null;
}

// Creates the directory (0700) and its runs/ and seals/, and refuses a link anywhere on that
// path or a directory inside a tree this run reads.
export function prepareDir(dir, roots = []) {
  // Checked before anything is created: a refused run leaves nothing inside the tree.
  let existing = resolve(dir);
  const rest = [];
  while (!existsSync(existing)) {
    rest.unshift(basename(existing));
    const up = dirname(existing);
    if (up === existing) break;
    existing = up;
  }
  const intended = join(realpathSync(existing), ...rest);
  for (const root of roots) {
    let r;
    try { r = realpathSync(root); } catch { continue; }
    if (intended === r || intended.startsWith(r.endsWith(sep) ? r : r + sep)) {
      throw new EvidenceRefusal(`the evidence directory ${dir} is inside ${root}, which this run reads; a tree under review must not supply its own evidence`);
    }
  }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const p of [dir, join(dir, 'runs'), join(dir, 'seals')]) {
    if (isLink(p)) throw new EvidenceRefusal(`${p} is a symbolic link, which evidence is not written through`);
    if (!existsSync(p)) mkdirSync(p, { mode: 0o700 });
    else if (!statSync(p).isDirectory()) throw new EvidenceRefusal(`${p} is not a directory`);
  }
  return realpathSync(dir);
}

// O_NOFOLLOW guards the last component only, so the two directories above an evidence file
// (runs/ or seals/, and the evidence directory) are checked immediately before each open. Where
// the platform has no O_NOFOLLOW (Windows), the file itself is checked the same way.
function parentsNotLinked(path) {
  const dir = dirname(path);
  const inside = [dir, ...(/^(runs|seals)$/.test(basename(dir)) ? [dirname(dir)] : []), ...(O_NOFOLLOW ? [] : [path])];
  for (const p of inside) {
    if (isLink(p)) throw new EvidenceRefusal(`${p} is a symbolic link, which evidence is not written or read through`);
  }
}

const refuseLink = (path, e) => {
  if (e.code === 'ELOOP' || (e.code === 'EEXIST' && isLink(path))) throw new EvidenceRefusal(`${path} is a symbolic link, which evidence is not written or read through`);
  throw e;
};

export function createExclusive(path) {
  parentsNotLinked(path);
  try { return openSync(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600); } catch (e) { return refuseLink(path, e); }
}

export function openAppend(path) {
  parentsNotLinked(path);
  try { return openSync(path, O_WRONLY | O_APPEND | O_CREAT | O_NOFOLLOW, 0o600); } catch (e) { return refuseLink(path, e); }
}

function openRead(path) {
  parentsNotLinked(path);
  try { return openSync(path, constants.O_RDONLY | O_NOFOLLOW); } catch (e) { return refuseLink(path, e); }
}

// Everything the descriptor holds, sized from the descriptor, so the path is resolved once.
function readAll(fd) {
  const size = fstatSync(fd).size;
  const buf = Buffer.alloc(size);
  let off = 0;
  while (off < size) {
    const n = readSync(fd, buf, off, size - off, off);
    if (n === 0) break;
    off += n;
  }
  return buf.subarray(0, off);
}

export function writeAll(fd, text) {
  const buf = Buffer.from(text, 'utf8');
  let off = 0;
  while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
}

export function syncClose(fd) {
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

// Lines of a chain file, each without its newline, and whether the last one was cut short.
export function readLines(path) {
  const fd = openRead(path);
  let text;
  try { text = readAll(fd).toString('utf8'); } finally { closeSync(fd); }
  if (!text) return { lines: [], torn: false };
  const torn = !text.endsWith('\n');
  const lines = text.split('\n');
  if (!torn) lines.pop();
  return { lines, torn };
}

// The last complete line of a chain file, read from its tail, or null for an empty file.
export function lastLine(path) {
  if (!existsSync(path)) return { line: null, torn: false };
  const fd = openRead(path);
  try {
    const size = fstatSync(fd).size;
    if (!size) return { line: null, torn: false };
    let window = Math.min(size, 65536);
    for (;;) {
      const buf = Buffer.alloc(window);
      const n = readSync(fd, buf, 0, window, size - window);
      if (n !== window) throw new EvidenceRefusal(`${path} changed while it was read`);
      const text = buf.toString('utf8');
      const torn = !text.endsWith('\n');
      const body = torn ? text : text.slice(0, -1);
      const nl = body.lastIndexOf('\n');
      if (nl >= 0 || window === size) return { line: nl >= 0 ? body.slice(nl + 1) : body, torn };
      window = Math.min(size, window * 4);
    }
  } finally { closeSync(fd); }
}

const pidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Takes ledger.lock, breaking one that is older than staleMs and whose holder is gone. Returns
// { release, broken } or null when the lock could not be had within waitMs.
export function takeLock(path, { waitMs = 5000, staleMs = 60000, now = Date.now } = {}) {
  const deadline = now() + waitMs;
  let broken = null;
  for (;;) {
    try {
      const fd = createExclusive(path);
      writeAll(fd, `${process.pid} ${now()}\n`);
      closeSync(fd);
      return { release: () => { try { unlinkSync(path); } catch { /* already gone */ } }, broken };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    let pid = null;
    let since = null;
    try {
      const [p, t] = readFileSync(path, 'utf8').trim().split(/\s+/).map(Number);
      pid = Number.isSafeInteger(p) ? p : null;
      since = Number.isSafeInteger(t) ? t : null;
    } catch { /* removed between the open and the read */ }
    const age = since === null ? null : now() - since;
    if (pid !== null && age !== null && age > staleMs && !pidAlive(pid)) {
      try { unlinkSync(path); broken = { holderPid: pid, ageMs: Math.max(0, Math.trunc(age)) }; } catch { /* a peer broke it first */ }
      continue;
    }
    if (now() >= deadline) return null;
    sleep(25);
  }
}
