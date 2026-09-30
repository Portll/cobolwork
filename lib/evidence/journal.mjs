// SPDX-License-Identifier: AGPL-3.0-or-later
// A run journal (runs/<runId>.jsonl) and the ledger (ledger.jsonl) that chains the runs' tips.
// docs/spec/evidence.md §5-6.
import { randomBytes } from 'node:crypto';
import { closeSync } from 'node:fs';
import { join } from 'node:path';
import { makeRecord, newChain, recordHash } from './record.mjs';
import { EvidenceRefusal, createExclusive, lastLine, openAppend, prepareDir, syncClose, takeLock, writeAll } from './store.mjs';

export const LEDGER = 'ledger.jsonl';
export const LOCK = 'ledger.lock';

const isoNow = () => new Date().toISOString();
const runStamp = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

// The record the next ledger line extends: one whose chain, seq and hash hold.
function ledgerTip(line, path) {
  let r = null;
  try { r = JSON.parse(line); } catch { /* refused below */ }
  const ok = r && typeof r === 'object' && /^[0-9a-f]{32}$/.test(r.chain) && Number.isInteger(r.seq) && r.seq >= 0 && typeof r.hash === 'string' && recordHash(r) === r.hash;
  if (!ok) throw new EvidenceRefusal(`${path} ends in a line that is no ledger record; verify it before anything is appended`);
  return r;
}

// Appends to the ledger; the caller holds the lock. A torn ledger is refused rather than extended.
function appendLedger(dir, entries, now) {
  const path = join(dir, LEDGER);
  const { line, torn } = lastLine(path);
  if (torn) throw new EvidenceRefusal(`${path} ends in a partial line; verify it before anything is appended`);
  let prev = line ? ledgerTip(line, path) : null;
  const fd = openAppend(path);
  try {
    const out = [];
    if (!prev) entries = [{ kind: 'genesis', fields: { createdAt: now() } }, ...entries];
    const chain = prev ? prev.chain : newChain();
    for (const { kind, fields } of entries) {
      const { record, line: text } = makeRecord({ chain, prev, kind, fields, at: now() });
      writeAll(fd, text);
      out.push(record);
      prev = record;
    }
    return out;
  } finally { syncClose(fd); }
}

// `roots` is what the journal records; `readRoots` are the trees the run reads, which the evidence
// directory must not be inside.
export function openJournal(dir, { command, argv = [], roots = [], readRoots = [], toolVersion, toolRevision = null, now = isoNow, lock = {} }) {
  const real = prepareDir(dir, readRoots);
  const started = Date.now();
  const openedAt = now();
  const id = `${runStamp(openedAt)}-${randomBytes(8).toString('hex')}`;
  const path = join(real, 'runs', `${id}.jsonl`);
  const fd = createExclusive(path);
  const chain = newChain();
  const counts = {};
  let prev = null;
  let closed = false;

  const append = (kind, fields) => {
    if (closed) throw new EvidenceRefusal(`run ${id} is closed`);
    const { record, line } = makeRecord({ chain, prev, kind, fields, at: prev ? now() : openedAt });
    writeAll(fd, line);
    prev = record;
    counts[kind] = (counts[kind] || 0) + 1;
    return record;
  };

  append('open', { tool: 'cobolwork', toolVersion, toolRevision, command, argv, roots, node: process.version, platform: process.platform });

  // Writes close, then the ledger record carrying this journal's tip. Returns the ledger outcome.
  const close = ({ exit }) => {
    const held = takeLock(join(real, LOCK), lock);
    const ledger = held ? 'recorded' : 'unrecorded';
    try {
      append('close', { exit, counts: { ...counts }, durationMs: Math.max(0, Date.now() - started), ledger });
      closed = true;
      syncClose(fd);
      if (!held) return { ledger, reason: 'the ledger lock could not be had' };
      const entries = [];
      if (held.broken) entries.push({ kind: 'lock-broken', fields: held.broken });
      entries.push({ kind: 'run', fields: { run: id, runChain: chain, runLength: prev.seq + 1, runTip: prev.hash } });
      appendLedger(real, entries, now);
      return { ledger };
    } catch (e) {
      if (!closed) { closed = true; try { closeSync(fd); } catch { /* already closed */ } }
      return { ledger: 'unrecorded', reason: e.message };
    } finally {
      if (held) held.release();
    }
  };

  return { id, path, dir: real, chain, append, close, get tip() { return prev; } };
}
