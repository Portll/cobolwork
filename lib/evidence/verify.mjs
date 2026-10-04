// SPDX-License-Identifier: AGPL-3.0-or-later
// Verifies an evidence directory and reports verified, broken, unrecorded, open, anchored, sealed,
// unsealedTail and signatures as separate facts. docs/spec/evidence.md §9.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JOURNAL_KINDS, LEDGER_KINDS, checkLine } from './record.mjs';
import { readLines } from './store.mjs';
import { LEDGER } from './journal.mjs';
import { NAMESPACE, PAYLOAD_TYPE, SEAL_PREDICATE, STATEMENT_TYPE, isAncestor, listWitnessed, pae, readWitnessed, resolveRef, sealFiles, witnessedBlobs } from './seal.mjs';
import { verifySshsig } from './sshsig.mjs';
import { readRequest, readResponse } from './timestamp.mjs';

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

// Every line of one chain file checked against the one before it. After a break the walk goes on
// from the record as read, so one edit is reported once and later breaks are still found.
export function verifyChain(path, label, kinds = LEDGER_KINDS) {
  const out = { records: [], broken: [], torn: false };
  if (!existsSync(path)) return out;
  const { lines, torn } = readLines(path);
  out.torn = torn;
  let prev = null;
  let chain = null;
  lines.forEach((line, i) => {
    if (i === 0) {
      try { chain = JSON.parse(line).chain; } catch { chain = null; }
    }
    const { record, fail } = checkLine(line, prev, { chain, kinds });
    if (fail) out.broken.push({ file: label, line: i + 1, check: fail });
    if (record) { out.records.push(record); prev = record; }
  });
  if (torn) out.broken.push({ file: label, line: lines.length, check: 'torn' });
  return out;
}

function decodeSeal(text) {
  const env = JSON.parse(text);
  if (env.payloadType !== PAYLOAD_TYPE || typeof env.payload !== 'string' || !Array.isArray(env.signatures)) throw new Error('not a DSSE envelope of an in-toto statement');
  const payload = Buffer.from(env.payload, 'base64');
  const st = JSON.parse(payload.toString('utf8'));
  if (st._type !== STATEMENT_TYPE || st.predicateType !== SEAL_PREDICATE) throw new Error('not a cobolwork seal statement');
  const subject = st.subject && st.subject[0];
  const m = subject && /^ledger:([0-9a-f]{32})$/.exec(subject.name || '');
  if (!m || !subject.digest || !/^[0-9a-f]{64}$/.test(subject.digest.sha256 || '')) throw new Error('the seal names no ledger tip');
  const length = st.predicate && st.predicate.ledgerLength;
  if (!Number.isSafeInteger(length) || length < 1) throw new Error('the seal names no ledger length');
  return { envelope: env, payload, chain: m[1], tip: subject.digest.sha256, length, previous: st.predicate.previousSeal ? st.predicate.previousSeal.sha256 : null };
}

// Whether the ledger holds the state a seal names: same chain, and the record at that length has
// that hash.
function agrees(seal, ledger) {
  const rec = ledger[seal.length - 1];
  if (!ledger.length || ledger[0].chain !== seal.chain) return { ok: false, why: `the seal names ledger ${seal.chain}, and this ledger is ${ledger.length ? ledger[0].chain : 'empty'}` };
  if (!rec) return { ok: false, why: `the seal names ${seal.length} records and the ledger holds ${ledger.length}` };
  if (rec.hash !== seal.tip) return { ok: false, why: `record ${seal.length} of the ledger is not the one sealed` };
  return { ok: true };
}

function signaturesOf(seal, allowed) {
  const message = pae(PAYLOAD_TYPE, seal.payload);
  if (!seal.envelope.signatures.length) return [{ keyid: null, valid: null, reason: 'unsigned' }];
  return seal.envelope.signatures.map((s) => {
    if (!allowed) return { keyid: s.keyid || null, valid: null, reason: 'no allowed signers were given' };
    let blob;
    try { blob = Buffer.from(String(s.sig), 'base64'); } catch { return { keyid: s.keyid || null, valid: false, reason: 'the signature is not base64' }; }
    return verifySshsig({ blob, message, namespace: NAMESPACE, allowed });
  });
}

// With a pinned commit, the witness's history since then: the pin must still be an ancestor of the
// ref, and every seal it held must be at the ref unchanged. A rewritten branch or a later commit
// that deletes seals is a contradiction, which a fresh reading of the ref alone cannot see.
function pinProblem(repo, pin, ref, env) {
  const pinned = resolveRef(repo, pin, env);
  if (!pinned) return `the pinned commit ${pin} is not in the witness`;
  const at = resolveRef(repo, ref, env);
  if (!isAncestor(repo, pinned, at, env)) return `the witness was rewritten: the pinned commit ${pinned.slice(0, 12)} is not in the history of ${ref}`;
  const now = witnessedBlobs(repo, at, env);
  for (const [path, blob] of witnessedBlobs(repo, pinned, env)) {
    if (now.get(path) !== blob) return `the witness held ${path} at the pinned commit, and ${now.has(path) ? 'holds another' : 'no longer holds it'} at ${ref}`;
  }
  return null;
}

// A seal a witness vouches for counts when the ledger holds the state it names and an allowed
// signer signed it.
function accepting(recs, allowed) {
  return (ws, name) => {
    const a = agrees(ws, recs);
    if (!a.ok) return { sealed: false, reason: `${name}: ${a.why}` };
    const sigs = signaturesOf(ws, allowed);
    if (sigs.some((x) => x.valid === true)) return { sealed: true, seal: ws };
    if (sigs.every((x) => x.valid === false)) return { sealed: false, unsigned: true, reason: `${name} carries no signature from an allowed signer` };
    return { sealed: null, reason: allowed ? `${name} carries no valid signature` : 'no allowed signers were given' };
  };
}

const firstLine = (text) => String(text || '').trim().split('\n')[0].slice(0, 300);
const BOUNDED = { timeout: 30000, maxBuffer: 1 << 20, windowsHide: true };

// The git witness is the authority for its ledger: every seal it holds is checked, whether or not
// the directory still has its copy, so deleting local seals cannot hide a cut tail.
function gitWitness({ repo, ref, pin, recs, local, accept, allowed, verdict, env }) {
  const witnessCommit = resolveRef(repo, ref, env);
  if (!witnessCommit) return { sealed: null, reason: `${ref} does not resolve in ${repo}` };
  verdict.witnessCommit = witnessCommit;
  const rewritten = pin ? pinProblem(repo, pin, ref, env) : null;
  if (rewritten) return { sealed: false, reason: rewritten };
  const held = listWitnessed(repo, ref, env);
  const chain = recs.length ? recs[0].chain : null;
  const seqs = chain ? held.get(chain) || [] : [];
  const localSeqs = new Set(local.filter((s) => s.chain === chain).map((s) => s.seq));
  let result = null;
  let newest = null;
  if (!seqs.length && held.size) result = { sealed: false, reason: `the witness holds seals for ledger ${[...held.keys()].join(', ')}, and this directory holds ledger ${chain || 'none'}` };
  else if (!seqs.length) result = { sealed: null, reason: `not on ${ref}: the witness holds no seal for ledger ${chain || 'none'}` };
  for (const seq of result ? [] : seqs) {
    const name = `${seq}.dsse.json`;
    let ws;
    try { ws = decodeSeal(readWitnessed(repo, ref, `${chain}/${name}`, env).text); } catch (e) { result = { sealed: false, reason: `the witnessed ${name} is not a seal: ${e.message}` }; break; }
    const r = accept(ws, `witnessed ${name}`);
    if (r.sealed === false && !r.unsigned) { result = r; break; }
    verdict.seals.push({ seal: name, witnessed: true, local: localSeqs.has(seq), length: ws.length, signed: r.sealed === true });
    if (r.sealed === false) { result = r; break; }
    if (r.sealed === true) newest = ws;
  }
  for (const s of local) if (s.chain === chain && !seqs.includes(s.seq)) verdict.seals.push({ seal: s.name, witnessed: false, reason: `not on ${ref}` });
  if (result) return result;
  if (newest) return { sealed: true, seal: newest };
  return { sealed: null, reason: allowed ? 'no witnessed seal carries a valid signature' : 'no allowed signers were given' };
}

// An RFC 3161 response: its imprint names a seal, its nonce is the kept request's, and OpenSSL
// verifies the authority's signature against --tsa-ca.
function tsrWitness({ dir, tsr, ca, local, accept, verdict, env }) {
  let resp;
  try { resp = readResponse(readFileSync(tsr)); } catch (e) { return { sealed: null, reason: `--tsr ${tsr} is not a time-stamp response (${e.message})` }; }
  if (resp.status > 1) return { sealed: null, reason: `the time-stamp authority refused the request (status ${resp.status})` };
  const s = local.find((x) => sha256(x.text) === resp.digest);
  if (!s) return { sealed: false, reason: `the time-stamp response's message imprint ${resp.digest.slice(0, 12)} matches no seal in seals/` };
  verdict.timeStamp = { seal: s.name, genTime: resp.genTime };
  const kept = join(dir, 'seals', `${s.seq}.tsq`);
  if (!existsSync(kept)) return { sealed: null, reason: `seals/${s.seq}.tsq, the request for ${s.name}, is not kept, so the response's nonce cannot be checked` };
  let req;
  try { req = readRequest(readFileSync(kept)); } catch (e) { return { sealed: null, reason: `seals/${s.seq}.tsq is not a time-stamp request (${e.message})` }; }
  if (req.digest !== resp.digest || !resp.nonce || req.nonce !== resp.nonce) return { sealed: false, reason: `the time-stamp response's nonce is not that of the request kept for ${s.name}` };
  if (!ca) return { sealed: null, reason: '--tsr needs --tsa-ca, the certificate the time-stamp authority chains to' };
  const r = spawnSync('openssl', ['ts', '-verify', '-in', tsr, '-data', s.path, '-CAfile', ca], { ...BOUNDED, env });
  if (r.error) return { sealed: null, reason: `OpenSSL could not be run (${r.error.code || r.error.message}), so the authority's signature is unchecked` };
  if (r.status !== 0) return { sealed: false, reason: `OpenSSL does not verify the time-stamp response: ${firstLine(r.stderr) || firstLine(r.stdout)}` };
  return accept(s, `the time-stamped ${s.name}`);
}

// A transparency-log bundle, checked by cosign against each local seal, newest first.
function cosignWitness({ bundle, key, identity, issuer, trustedRoot, ignoreTlog, local, accept, verdict, env }) {
  if (!key && !(identity && issuer)) return { sealed: null, reason: '--cosign-bundle needs --cosign-key, or --certificate-identity with --certificate-oidc-issuer' };
  let last = '';
  for (const s of [...local].reverse()) {
    const who = key ? ['--key', key] : ['--certificate-identity', identity, '--certificate-oidc-issuer', issuer];
    const r = spawnSync('cosign', ['verify-blob', '--bundle', bundle, ...who, ...(trustedRoot ? ['--trusted-root', trustedRoot] : []), ...(ignoreTlog ? ['--insecure-ignore-tlog=true'] : []), s.path], { ...BOUNDED, env });
    if (r.error) return { sealed: null, reason: `cosign could not be run (${r.error.code || r.error.message})` };
    if (r.status === 0) {
      verdict.transparencyLog = { seal: s.name, tlogChecked: !ignoreTlog };
      return accept(s, `the cosign-witnessed ${s.name}`);
    }
    last = firstLine(r.stderr);
  }
  return { sealed: false, reason: `the cosign bundle verifies against no seal in seals/${last ? ` (cosign: ${last})` : ''}` };
}

export function verifyEvidence(dir, { allowed = null, anchorGit = null, anchorRef = null, anchorPin = null, tsr = null, tsaCa = null, cosign = null, maxUnsealed = 0, env = process.env } = {}) {
  const verdict = { verified: true, broken: [], unrecorded: [], open: [], anchored: null, sealed: null, sealedReason: null, unsealedTail: null, signatures: [], seals: [] };
  const ledger = verifyChain(join(dir, LEDGER), LEDGER);
  verdict.broken.push(...ledger.broken);
  const recs = ledger.records;
  if (recs.length && recs[0].kind !== 'genesis') verdict.broken.push({ file: LEDGER, line: 1, check: 'genesis' });

  const named = new Set();
  recs.forEach((rec, i) => {
    if (rec.kind !== 'run') return;
    named.add(rec.run);
    const file = `runs/${rec.run}.jsonl`;
    if (!/^[0-9TZ]+-[0-9a-f]{16}$/.test(rec.run) || !existsSync(join(dir, file))) { verdict.broken.push({ file: LEDGER, line: i + 1, check: 'run-missing' }); return; }
    const run = verifyChain(join(dir, file), file, JOURNAL_KINDS);
    verdict.broken.push(...run.broken);
    const last = run.records[run.records.length - 1];
    if (!run.records.length || run.records[0].kind !== 'open' || run.records[0].chain !== rec.runChain) verdict.broken.push({ file, line: 1, check: 'run-chain' });
    else if (run.records.length !== rec.runLength || last.hash !== rec.runTip) verdict.broken.push({ file, line: run.records.length, check: 'run-tip' });
  });

  const runsDir = join(dir, 'runs');
  for (const n of existsSync(runsDir) ? readdirSync(runsDir).sort() : []) {
    const m = /^(.+)\.jsonl$/.exec(n);
    if (!m) continue;
    let records = [];
    try { ({ records } = verifyChain(join(runsDir, n), `runs/${n}`, JOURNAL_KINDS)); } catch { /* reported below as unreadable only if named */ }
    if (!named.has(m[1])) verdict.unrecorded.push(m[1]);
    if (!records.some((r) => r.kind === 'close')) verdict.open.push(m[1]);
  }

  // The local seal chain: each seal names the digest of the one before it.
  const local = [];
  let prevDigest = null;
  for (const f of sealFiles(dir)) {
    const text = readFileSync(f.path, 'utf8');
    let s;
    try { s = decodeSeal(text); } catch (e) { verdict.broken.push({ file: `seals/${f.name}`, line: 1, check: 'seal', reason: e.message }); prevDigest = sha256(text); continue; }
    if (s.previous !== prevDigest) verdict.broken.push({ file: `seals/${f.name}`, line: 1, check: 'seal-chain' });
    prevDigest = sha256(text);
    local.push({ ...s, seq: f.seq, name: f.name, path: f.path, text });
  }
  if (local.length) {
    const newest = local[local.length - 1];
    const a = agrees(newest, recs);
    verdict.anchored = a.ok;
    if (!a.ok) verdict.anchoredReason = a.why;
  }
  for (const s of local) {
    const sigs = signaturesOf(s, allowed);
    verdict.signatures.push({ seal: s.name, results: sigs });
  }

  const accept = accepting(recs, allowed);
  const results = [];
  if (anchorGit) results.push(gitWitness({ repo: anchorGit, ref: anchorRef || '@{upstream}', pin: anchorPin, recs, local, accept, allowed, verdict, env }));
  if (tsr) results.push(tsrWitness({ dir, tsr, ca: tsaCa, local, accept, verdict, env }));
  if (cosign) results.push(cosignWitness({ ...cosign, local, accept, verdict, env }));
  const contradicted = results.find((r) => r.sealed === false);
  const confirmed = results.filter((r) => r.sealed === true);
  if (contradicted) {
    verdict.sealed = false;
    verdict.sealedReason = contradicted.reason;
  } else if (confirmed.length) {
    verdict.sealed = true;
    verdict.unsealedTail = recs.length - Math.max(...confirmed.map((r) => r.seal.length));
  } else verdict.sealedReason = results.length ? results.map((r) => r.reason).join('; ') : 'no witness was named';

  verdict.verified = verdict.broken.length === 0;
  verdict.exit = !verdict.verified || verdict.sealed === false ? 1
    : verdict.sealed === true && verdict.unsealedTail <= maxUnsealed ? 0 : 3;
  return verdict;
}
