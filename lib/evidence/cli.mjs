// SPDX-License-Identifier: AGPL-3.0-or-later
// `cobolwork evidence verify|seal|anchor`: the command half of docs/spec/evidence.md §7-9. Returns
// the exit status; writes one JSON document through `write`.
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { anchorGit, envelopeFor, seal, sealFiles, timeStampRequest } from './seal.mjs';
import { parseAllowedSigners } from './sshsig.mjs';
import { EvidenceRefusal, createExclusive, evidenceDirFrom, syncClose, writeAll } from './store.mjs';
import { verifyEvidence } from './verify.mjs';
import { EVIDENCE_RESULT_SCHEMA_VERSION } from '../version.mjs';
import { evidenceClausesFor } from '../compliance.mjs';

const VERBS = ['verify', 'seal', 'anchor', 'sign'];

// The clauses a verified directory's evidence answers: a run journal's records, and the chain once
// it verifies.
function complianceOf(dir, verdict) {
  const runs = join(dir, 'runs');
  const journals = existsSync(runs) && readdirSync(runs).some((n) => n.endsWith('.jsonl'));
  const present = journals ? ['journal-records', ...(verdict.verified ? ['journal-chain'] : [])] : [];
  return present.flatMap((evidenceId) => evidenceClausesFor(evidenceId).map((c) => ({ evidenceId, ...c })));
}

function anchorNewest(dir, opts) {
  const seals = sealFiles(dir);
  if (!seals.length) throw new EvidenceRefusal('there is no seal to anchor; run evidence seal first');
  const newest = seals[seals.length - 1];
  const text = readFileSync(newest.path, 'utf8');
  const payload = JSON.parse(Buffer.from(JSON.parse(text).payload, 'base64').toString('utf8'));
  const chain = /^ledger:([0-9a-f]{32})$/.exec(payload.subject[0].name)[1];
  const out = { seal: newest.name };
  if (opts.anchorGit) out.git = anchorGit(newest.path, { repo: resolve(opts.anchorGit), chain, seq: newest.seq, push: opts.push === true });
  if (opts.tsq) {
    const req = timeStampRequest(Buffer.from(text, 'utf8'));
    writeFileSync(resolve(opts.tsq), req.der);
    // The request is kept beside its seal, so verify can check the response's nonce against it.
    const kept = join(dir, 'seals', `${newest.seq}.tsq`);
    if (existsSync(kept)) unlinkSync(kept);
    const fd = createExclusive(kept);
    try { writeAll(fd, req.der); } finally { syncClose(fd); }
    out.tsq = { path: resolve(opts.tsq), sha256: req.digest, nonce: req.nonce, kept: `seals/${newest.seq}.tsq` };
  }
  return out;
}

export function evidenceCommand(verb, opts, { toolVersion, write, env = process.env }) {
  if (!VERBS.includes(verb)) throw new EvidenceRefusal(`evidence takes ${VERBS.join(', ')}; got ${verb || 'nothing'}`);
  if (verb === 'sign') {
    const file = opts._[2];
    if (!file) throw new EvidenceRefusal('evidence sign needs the statement file to sign');
    const payload = readFileSync(resolve(file));
    JSON.parse(payload.toString('utf8'));
    const env2 = envelopeFor(payload, { sshKey: opts.sshKey ? resolve(opts.sshKey) : null, signer: opts.signer ? resolve(opts.signer) : null, expectKeyid: opts.expectKey || null, env });
    const text = `${JSON.stringify(env2)}\n`;
    if (opts.out) writeFileSync(resolve(opts.out), text); else write(text);
    return 0;
  }
  const dir = evidenceDirFrom(opts, env);
  if (!dir) throw new EvidenceRefusal('evidence needs --evidence <dir> or COBOLWORK_EVIDENCE');
  const emit = (doc) => write(`${JSON.stringify({ tool: 'cobolwork-evidence', schemaVersion: EVIDENCE_RESULT_SCHEMA_VERSION, verb, ...doc }, null, opts.quiet ? 0 : 1)}\n`);

  if (verb === 'verify') {
    const allowed = opts.allowedSigners ? parseAllowedSigners(readFileSync(resolve(opts.allowedSigners), 'utf8')) : null;
    const max = opts.maxUnsealed === undefined ? 0 : Number(opts.maxUnsealed);
    if (!Number.isSafeInteger(max) || max < 0) throw new EvidenceRefusal(`--max-unsealed takes a whole number; got ${opts.maxUnsealed}`);
    if (opts.anchorPin && !opts.anchorGit) throw new EvidenceRefusal('--anchor-pin names a commit of the --anchor-git witness');
    const file = (x) => (x ? resolve(x) : null);
    const cosign = opts.cosignBundle ? { bundle: file(opts.cosignBundle), key: file(opts.cosignKey), identity: opts.certificateIdentity || null, issuer: opts.certificateOidcIssuer || null, trustedRoot: file(opts.trustedRoot), ignoreTlog: opts.insecureIgnoreTlog === true } : null;
    const verdict = verifyEvidence(dir, { allowed, anchorGit: file(opts.anchorGit), anchorRef: opts.ref || null, anchorPin: opts.anchorPin || null, tsr: file(opts.tsr), tsaCa: file(opts.tsaCa), cosign, maxUnsealed: max, env });
    emit({ ...verdict, compliance: complianceOf(dir, verdict) });
    return verdict.exit;
  }
  if (verb === 'seal') {
    if (opts.sshKey && opts.signer) throw new EvidenceRefusal('one signer per seal: --ssh-key or --signer');
    const s = seal(dir, { sshKey: opts.sshKey ? resolve(opts.sshKey) : null, signer: opts.signer ? resolve(opts.signer) : null, expectKeyid: opts.expectKey || null, toolVersion, env });
    const out = { seq: s.seq, path: s.path, sha256: s.digest, signed: s.signed, ledgerLength: s.statement.predicate.ledgerLength, tip: s.statement.subject[0].digest.sha256 };
    if (opts.anchorGit || opts.tsq) out.anchor = anchorNewest(dir, opts);
    emit(out);
    return 0;
  }
  if (!opts.anchorGit && !opts.tsq) throw new EvidenceRefusal('anchor needs --anchor-git <repo> or --tsq <file>');
  emit(anchorNewest(dir, opts));
  return 0;
}
