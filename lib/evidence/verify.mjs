// SPDX-License-Identifier: AGPL-3.0-or-later
// Verifies an evidence directory and reports verified, broken, unrecorded, open, anchored, sealed,
// unsealedTail and signatures as separate facts. docs/spec/evidence.md §9.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JOURNAL_KINDS, LEDGER_KINDS, checkLine } from './record.mjs';
import { readLines } from './store.mjs';
import { LEDGER } from './journal.mjs';
import { NAMESPACE, PAYLOAD_TYPE, SEAL_PREDICATE, STATEMENT_TYPE, listWitnessed, pae, readWitnessed, resolveRef, sealFiles } from './seal.mjs';
import { verifySshsig } from './sshsig.mjs';

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

export function verifyEvidence(dir, { allowed = null, anchorGit = null, anchorRef = null, maxUnsealed = 0, env = process.env } = {}) {
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
    local.push({ ...s, seq: f.seq, name: f.name, text });
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

  if (anchorGit) {
    const ref = anchorRef || '@{upstream}';
    if (!resolveRef(anchorGit, ref, env)) {
      verdict.sealedReason = `${ref} does not resolve in ${anchorGit}`;
    } else {
      // The witness is the authority: every seal it holds for this ledger is checked, whether or
      // not the directory still has its copy, so deleting local seals cannot hide a cut tail.
      const held = listWitnessed(anchorGit, ref, env);
      const chain = recs.length ? recs[0].chain : null;
      const seqs = chain ? held.get(chain) || [] : [];
      const localSeqs = new Set(local.filter((s) => s.chain === chain).map((s) => s.seq));
      let newestOk = null;
      if (!seqs.length && held.size) {
        verdict.sealed = false;
        verdict.sealedReason = `the witness holds seals for ledger ${[...held.keys()].join(', ')}, and this directory holds ledger ${chain || 'none'}`;
      } else if (!seqs.length) verdict.sealedReason = `not on ${ref}: the witness holds no seal for ledger ${chain || 'none'}`;
      for (const seq of verdict.sealed === false ? [] : seqs) {
        const name = `${seq}.dsse.json`;
        const w = readWitnessed(anchorGit, ref, `${chain}/${name}`, env);
        let ws;
        try { ws = decodeSeal(w.text); } catch (e) { verdict.sealed = false; verdict.sealedReason = `the witnessed ${name} is not a seal: ${e.message}`; break; }
        const a = agrees(ws, recs);
        if (!a.ok) { verdict.sealed = false; verdict.sealedReason = `witnessed ${name}: ${a.why}`; break; }
        const sigs = signaturesOf(ws, allowed);
        const good = sigs.some((x) => x.valid === true);
        const bad = sigs.every((x) => x.valid === false);
        verdict.seals.push({ seal: name, witnessed: true, local: localSeqs.has(seq), length: ws.length, signed: good });
        if (bad) { verdict.sealed = false; verdict.sealedReason = `witnessed ${name} carries no signature from an allowed signer`; break; }
        if (good) newestOk = ws;
      }
      for (const s of local) if (s.chain === chain && !seqs.includes(s.seq)) verdict.seals.push({ seal: s.name, witnessed: false, reason: `not on ${ref}` });
      if (verdict.sealed !== false) {
        if (newestOk) {
          verdict.sealed = true;
          verdict.unsealedTail = recs.length - newestOk.length;
        } else if (!verdict.sealedReason) verdict.sealedReason = allowed ? 'no witnessed seal carries a valid signature' : 'no allowed signers were given';
      }
    }
  } else verdict.sealedReason = 'no witness was named';

  verdict.verified = verdict.broken.length === 0;
  verdict.exit = !verdict.verified || verdict.sealed === false ? 1
    : verdict.sealed === true && verdict.unsealedTail <= maxUnsealed ? 0 : 3;
  return verdict;
}
