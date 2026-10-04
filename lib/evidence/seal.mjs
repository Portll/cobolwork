// SPDX-License-Identifier: AGPL-3.0-or-later
// Seals: an in-toto statement over the ledger's tip, in a DSSE envelope, signed by ssh-keygen or a
// program that signs as it does, kept in seals/ and handed to witnesses. docs/spec/evidence.md §7-8.
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical } from './record.mjs';
import { dearmor, fingerprint, parseSshsig, verifySshsig } from './sshsig.mjs';
import { EvidenceRefusal, createExclusive, prepareDir, syncClose, takeLock, writeAll } from './store.mjs';
import { LEDGER, LOCK } from './journal.mjs';
import { verifyChain } from './verify.mjs';

export const NAMESPACE = 'cobolwork-evidence';
export const PAYLOAD_TYPE = 'application/vnd.in-toto+json';
export const STATEMENT_TYPE = 'https://in-toto.io/Statement/v1';
export const SEAL_PREDICATE = 'https://github.com/Portll/cobolwork/blob/main/docs/spec/evidence.md#seal-v1';

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

// DSSE pre-authentication encoding.
export function pae(type, body) {
  const t = Buffer.from(type, 'utf8');
  return Buffer.concat([Buffer.from(`DSSEv1 ${t.length} `), t, Buffer.from(` ${body.length} `), body]);
}

export function sealFiles(dir) {
  const d = join(dir, 'seals');
  if (!existsSync(d)) return [];
  if (lstatSync(d).isSymbolicLink()) throw new EvidenceRefusal(`${d} is a symbolic link, which evidence is not read through`);
  return readdirSync(d).map((n) => /^(\d+)\.dsse\.json$/.exec(n)).filter(Boolean)
    .map((m) => ({ seq: Number(m[1]), name: m[0], path: join(d, m[0]) })).sort((a, b) => a.seq - b.seq);
}

const BOUNDED = { timeout: 30000, maxBuffer: 1 << 20, windowsHide: true };

function sign(bytes, { sshKey, signer, env, expectKeyid }) {
  const r = sshKey
    ? spawnSync('ssh-keygen', ['-Y', 'sign', '-f', sshKey, '-n', NAMESPACE], { ...BOUNDED, input: bytes, env })
    : spawnSync(signer, [NAMESPACE], { ...BOUNDED, input: bytes, env });
  if (r.error) throw new EvidenceRefusal(`the signer could not be run: ${r.error.message}`);
  if (r.status !== 0) throw new EvidenceRefusal(`the signer exited ${r.status}: ${String(r.stderr).trim().slice(0, 300)}`);
  const blob = dearmor(r.stdout);
  const sig = parseSshsig(blob);
  const self = verifySshsig({ blob, message: bytes, namespace: NAMESPACE, allowed: [{ principals: ['signer'], keyBlob: sig.publicKey, certAuthority: false, namespaces: null }] });
  if (self.valid === false) throw new EvidenceRefusal(`the signer's signature does not verify over what was sealed: ${self.reason}`);
  const keyid = fingerprint(sig.publicKey);
  if (expectKeyid && keyid !== expectKeyid) throw new EvidenceRefusal(`the signer signed with ${keyid}, not the expected ${expectKeyid}`);
  return { keyid, sig: blob.toString('base64') };
}

// A DSSE envelope over any in-toto statement, signed as seals are.
export function envelopeFor(payload, { sshKey = null, signer = null, expectKeyid = null, env = process.env } = {}) {
  if (!sshKey && !signer) throw new EvidenceRefusal('signing needs --ssh-key or --signer');
  return { payloadType: PAYLOAD_TYPE, payload: payload.toString('base64'), signatures: [sign(pae(PAYLOAD_TYPE, payload), { sshKey, signer, env, expectKeyid })] };
}

// Seals the ledger at its tip. Refuses a ledger that does not verify: a seal over a broken chain
// would attest the break.
export function seal(dir, { sshKey = null, signer = null, expectKeyid = null, toolVersion, now = () => new Date().toISOString(), env = process.env } = {}) {
  const real = prepareDir(dir);
  const held = takeLock(join(real, LOCK));
  if (!held) throw new EvidenceRefusal('the ledger lock could not be had');
  try {
    const ledger = verifyChain(join(real, LEDGER), 'ledger');
    if (ledger.broken.length) throw new EvidenceRefusal(`the ledger does not verify (${ledger.broken[0].check} at line ${ledger.broken[0].line}); nothing is sealed`);
    if (!ledger.records.length) throw new EvidenceRefusal('the ledger is empty; nothing is sealed');
    const tip = ledger.records[ledger.records.length - 1];
    const seals = sealFiles(real);
    const last = seals[seals.length - 1];
    if (last) {
      try {
        const prior = JSON.parse(readFileSync(last.path, 'utf8'));
        if (prior.payloadType !== PAYLOAD_TYPE || typeof prior.payload !== 'string') throw new Error('not a DSSE envelope');
      } catch (e) { throw new EvidenceRefusal(`seals/${last.name} is not a seal (${e.message}); verify the directory before sealing again`); }
    }
    const statement = {
      _type: STATEMENT_TYPE,
      subject: [{ name: `ledger:${tip.chain}`, digest: { sha256: tip.hash } }],
      predicateType: SEAL_PREDICATE,
      predicate: {
        ledgerLength: ledger.records.length,
        sealedAt: now(),
        previousSeal: last ? { sha256: sha256(readFileSync(last.path)) } : null,
        tool: { name: 'cobolwork', version: toolVersion },
      },
    };
    const payload = Buffer.from(canonical(statement), 'utf8');
    const signatures = sshKey || signer ? [sign(pae(PAYLOAD_TYPE, payload), { sshKey, signer, env, expectKeyid })] : [];
    const envelope = { payloadType: PAYLOAD_TYPE, payload: payload.toString('base64'), signatures };
    const seq = last ? last.seq + 1 : 0;
    const path = join(real, 'seals', `${seq}.dsse.json`);
    const fd = createExclusive(path);
    const text = `${canonical(envelope)}\n`;
    try { writeAll(fd, text); } finally { syncClose(fd); }
    return { seq, path, statement, envelope, digest: sha256(text), signed: signatures.length > 0 };
  } finally { held.release(); }
}

const git = (repo, args, env) => spawnSync('git', ['-C', repo, ...args], { ...BOUNDED, env: cleanGitEnv(env) });

// A git that reads this repository and no other: no inherited GIT_DIR, index or object redirection.
export function cleanGitEnv(env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!/^GIT_/.test(k)) out[k] = v;
  return { ...out, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };
}

// Copies a seal into the anchor repository and commits it there; pushes with `push`.
export function anchorGit(sealPath, { repo, chain, seq, push = false, env = process.env }) {
  if (!/^[0-9a-f]{32}$/.test(String(chain)) || !Number.isSafeInteger(seq) || seq < 0) throw new EvidenceRefusal(`a seal is anchored under a 32-hex ledger chain and a whole-number sequence, not ${chain}/${seq}`);
  const rel = `${chain}/${seq}.dsse.json`;
  const dir = join(repo, chain);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const target = join(repo, rel);
  if (existsSync(target)) {
    if (!readFileSync(target).equals(readFileSync(sealPath))) throw new EvidenceRefusal(`${rel} already holds a different seal in the anchor repository`);
  } else {
    const fd = createExclusive(target);
    try { writeAll(fd, readFileSync(sealPath, 'utf8')); } finally { syncClose(fd); }
  }
  const steps = [['add', '--', rel], ['-c', 'core.hooksPath=/dev/null', 'commit', '-q', '--no-verify', '-m', `evidence seal ${rel}`, '--', rel]];
  for (const args of steps) {
    const r = git(repo, args, env);
    if (r.status !== 0 && !(args.includes('commit') && /nothing to commit|no changes added/.test(String(r.stdout) + String(r.stderr)))) {
      throw new EvidenceRefusal(`git ${args.includes('commit') ? 'commit' : args[0]} in the anchor repository: ${String(r.stderr).trim().slice(0, 300)}`);
    }
  }
  const head = String(git(repo, ['rev-parse', 'HEAD'], env).stdout).trim();
  if (!push) return { committed: head, pushed: false, path: rel };
  const p = git(repo, ['-c', 'core.hooksPath=/dev/null', 'push', '-q', '--no-verify'], env);
  return { committed: head, pushed: p.status === 0, path: rel, ...(p.status === 0 ? {} : { reason: p.error ? p.error.message : String(p.stderr).trim().slice(0, 300) || `exit ${p.status}` }) };
}

// A seal as the witness holds it, or a reason it cannot be read.
export function readWitnessed(repo, ref, rel, env = process.env) {
  const r = git(repo, ['cat-file', 'blob', `${ref}:${rel}`], env);
  if (r.status !== 0) return { text: null, reason: `not on ${ref}` };
  return { text: String(r.stdout) };
}

// Every seal the witness holds at `ref`, by ledger chain: Map(chain -> [seq ascending]).
export function listWitnessed(repo, ref, env = process.env) {
  const r = git(repo, ['ls-tree', '-r', '--name-only', ref], env);
  const out = new Map();
  if (r.status !== 0) return out;
  for (const line of String(r.stdout).split('\n')) {
    const m = /^([0-9a-f]{32})\/(\d+)\.dsse\.json$/.exec(line.trim());
    if (!m) continue;
    if (!out.has(m[1])) out.set(m[1], []);
    out.get(m[1]).push(Number(m[2]));
  }
  for (const seqs of out.values()) seqs.sort((a, b) => a - b);
  return out;
}

export function resolveRef(repo, ref, env = process.env) {
  const r = git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], env);
  return r.status === 0 ? String(r.stdout).trim() : null;
}

// Whether commit `older` is in the history of `newer`.
export function isAncestor(repo, older, newer, env = process.env) {
  return git(repo, ['merge-base', '--is-ancestor', older, newer], env).status === 0;
}

// The blob of every seal the witness holds at `ref`, by its path: Map(`<chain>/<seq>.dsse.json` -> blob id).
export function witnessedBlobs(repo, ref, env = process.env) {
  const r = git(repo, ['ls-tree', '-r', ref], env);
  const out = new Map();
  if (r.status !== 0) return out;
  for (const line of String(r.stdout).split('\n')) {
    const m = /^\d+ blob ([0-9a-f]+)\t([0-9a-f]{32}\/\d+\.dsse\.json)$/.exec(line.trim());
    if (m) out.set(m[2], m[1]);
  }
  return out;
}

// A DER TimeStampReq (RFC 3161) over SHA-256 of `bytes`, with a random nonce and certReq true.
export function timeStampRequest(bytes) {
  const der = (tag, body) => {
    const len = body.length < 128 ? Buffer.from([body.length]) : (() => { const b = []; let n = body.length; while (n) { b.unshift(n & 0xff); n >>= 8; } return Buffer.from([0x80 | b.length, ...b]); })();
    return Buffer.concat([Buffer.from([tag]), len, body]);
  };
  const oidSha256 = Buffer.from([0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]);
  const algorithm = der(0x30, Buffer.concat([oidSha256, Buffer.from([0x05, 0x00])]));
  const digest = createHash('sha256').update(bytes).digest();
  const imprint = der(0x30, Buffer.concat([algorithm, der(0x04, digest)]));
  let nonce = randomBytes(8);
  nonce[0] &= 0x7f;
  if (nonce[0] === 0) nonce[0] = 1;
  const body = Buffer.concat([Buffer.from([0x02, 0x01, 0x01]), imprint, der(0x02, nonce), Buffer.from([0x01, 0x01, 0xff])]);
  return { der: der(0x30, body), digest: digest.toString('hex'), nonce: nonce.toString('hex') };
}
