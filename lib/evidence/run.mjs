// SPDX-License-Identifier: AGPL-3.0-or-later
// What a CLI run records in its journal: the command, the files it read by digest, its findings and
// suppressions by fingerprint, what it wrote by digest, and how it ended. docs/spec/evidence.md §5.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import { directoryTree } from '../kernel/source-tree.mjs';
import { isSource, relPath } from '../sources.mjs';
import { openJournal } from './journal.mjs';
import { evidenceDirFrom } from './store.mjs';

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

// Option values that are names, refs or dates. Anything else (a reason, a path, a person) is
// recorded as present, not as what it said.
const SAFE_VALUE = new Set(['--format', '--only', '--base', '--head', '--target', '--keys', '--action', '--rule', '--expires', '--provenance-format', '--max-unsealed', '--ref']);

export function recordedArgv(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out.push('--', '<compiler argv>'); break; }
    out.push(a.startsWith('-') ? a : i === 0 ? a : '<operand>');
    if (a.startsWith('--') && argv[i + 1] !== undefined && !argv[i + 1].startsWith('-') && VALUED.has(a)) {
      out.push(SAFE_VALUE.has(a) ? String(argv[i + 1]) : '<value>');
      i++;
    }
  }
  return out;
}

const VALUED = new Set(['--format', '--out', '--only', '--base', '--head', '--baseline', '--reason', '--who', '--expires', '--action', '--rule', '--advisories', '--copylib', '--report', '--keys', '--target', '--cobc', '--policy', '--provenance', '--provenance-format', '--ironwork', '--evidence', '--ssh-key', '--signer', '--allowed-signers', '--anchor-git', '--ref', '--max-unsealed', '--artifact', '--equivalence', '--name', '--tsq', '--tsr', '--expect-key']);

// A journal for this run, or null when no evidence directory is named.
export function startEvidence(opts, { command, argv, roots, toolVersion, toolRevision = null, env = process.env }) {
  const dir = evidenceDirFrom(opts, env);
  if (!dir) return null;
  const journal = openJournal(dir, { command, argv: recordedArgv(argv), roots: roots.map((r) => basename(r)), readRoots: roots, toolVersion, toolRevision });
  journal.roots = roots.map((r) => resolve(r));
  return journal;
}

export function recordInputs(journal, rootIndex, root, files = null) {
  if (!journal) return;
  const list = files || directoryTree(root).list().filter(isSource).sort();
  for (const p of list) {
    let bytes;
    try { bytes = readFileSync(p); } catch { continue; }
    journal.append('input', { root: rootIndex, path: relPath(root, p), sha256: sha256(bytes), bytes: bytes.length });
  }
}

// Inputs already hashed by the caller (the build's provenance record): [{ path, sha256 }].
export function recordHashed(journal, rootIndex, hashes) {
  if (!journal) return;
  for (const h of hashes || []) journal.append('input', { root: rootIndex, path: h.path, sha256: h.sha256 });
}

export function recordFindings(journal, report) {
  if (!journal || !report) return;
  for (const f of report.findings || []) {
    if (!f.fingerprint) continue;
    journal.append('finding', { fingerprint: f.fingerprint, rule: f.rule, tier: f.tier || f.sev || undefined, path: f.path || undefined, line: Number.isSafeInteger(f.line) ? f.line : undefined });
  }
  for (const f of report.suppressed || []) {
    if (!f.fingerprint || !f.suppressed) continue;
    const s = f.suppressed;
    journal.append('suppressed', { fingerprint: f.fingerprint, by: 'baseline', who: s.who ?? null, expires: s.expires ?? null, reasonSha256: s.reason ? sha256(String(s.reason)) : null });
  }
}

export function recordOutput(journal, name, text, path = null) {
  if (!journal) return;
  const bytes = Buffer.from(text, 'utf8');
  const rel = path ? relativeName(path, journal.roots) : null;
  journal.append('output', { name, sha256: sha256(bytes), bytes: bytes.length, ...(rel ? { path: rel } : { stdout: true }) });
}

// A written file named relative to the root it sits under, or by its base name.
function relativeName(path, roots = []) {
  const abs = resolve(path);
  for (const r of roots) if (abs === r || abs.startsWith(r + sep)) return relative(r, abs).split(sep).join('/');
  return basename(abs);
}

export function recordVerdict(journal, doc, exit) {
  if (!journal || !doc) return;
  const checks = doc.checks && typeof doc.checks === 'object' ? Object.fromEntries(Object.entries(doc.checks).filter(([, v]) => v === null || typeof v === 'boolean')) : undefined;
  journal.append('verdict', { verdict: String(doc.verdict), checks, relaxed: Array.isArray(doc.relaxed) ? doc.relaxed.map(String) : undefined, exit: Number.isSafeInteger(exit) ? exit : undefined });
}

export function recordBaselineWrite(journal, { before, after, who, expires, reason, path, text }) {
  if (!journal) return;
  const held = new Set(before.map((e) => e.fingerprint));
  const kept = new Set(after.map((e) => e.fingerprint));
  journal.append('baseline-write', {
    added: [...kept].filter((f) => !held.has(f)).sort(),
    removed: [...held].filter((f) => !kept.has(f)).sort(),
    who: who ?? null, expires: expires ?? null, reasonSha256: reason ? sha256(String(reason)) : null,
    path: relativeName(path, journal.roots), sha256: sha256(Buffer.from(text, 'utf8')),
  });
}

// Closes the journal; a ledger that could not be written is said on standard error, and the
// command's own exit status stands.
export function finishEvidence(journal, exit) {
  if (!journal) return null;
  const r = journal.close({ exit: Number.isSafeInteger(exit) ? exit : null });
  if (r.ledger !== 'recorded') process.stderr.write(`cobolwork: evidence run ${journal.id} was not recorded in the ledger: ${r.reason}\n`);
  return r;
}
