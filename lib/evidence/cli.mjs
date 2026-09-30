// SPDX-License-Identifier: AGPL-3.0-or-later
// `cobolwork evidence verify|seal|anchor`: the command half of docs/spec/evidence.md §7-9. Returns
// the exit status; writes one JSON document through `write`.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { anchorGit, seal, sealFiles, timeStampRequest } from './seal.mjs';
import { parseAllowedSigners } from './sshsig.mjs';
import { EvidenceRefusal, evidenceDirFrom } from './store.mjs';
import { verifyEvidence } from './verify.mjs';

const VERBS = ['verify', 'seal', 'anchor'];

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
    out.tsq = { path: resolve(opts.tsq), sha256: req.digest, nonce: req.nonce };
  }
  return out;
}

export function evidenceCommand(verb, opts, { toolVersion, write, env = process.env }) {
  if (!VERBS.includes(verb)) throw new EvidenceRefusal(`evidence takes ${VERBS.join(', ')}; got ${verb || 'nothing'}`);
  const dir = evidenceDirFrom(opts, env);
  if (!dir) throw new EvidenceRefusal('evidence needs --evidence <dir> or COBOLWORK_EVIDENCE');
  const emit = (doc) => write(`${JSON.stringify({ tool: 'cobolwork-evidence', verb, ...doc }, null, opts.quiet ? 0 : 1)}\n`);

  if (verb === 'verify') {
    const allowed = opts.allowedSigners ? parseAllowedSigners(readFileSync(resolve(opts.allowedSigners), 'utf8')) : null;
    const max = opts.maxUnsealed === undefined ? 0 : Number(opts.maxUnsealed);
    if (!Number.isSafeInteger(max) || max < 0) throw new EvidenceRefusal(`--max-unsealed takes a whole number; got ${opts.maxUnsealed}`);
    const verdict = verifyEvidence(dir, { allowed, anchorGit: opts.anchorGit ? resolve(opts.anchorGit) : null, anchorRef: opts.ref || null, maxUnsealed: max, env });
    emit(verdict);
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
