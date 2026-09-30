// SPDX-License-Identifier: AGPL-3.0-or-later
// The build's change-assurance check (docs/spec/evidence.md §12): an ironwork equivalence
// statement for each program the change edits, matched to the base and head bytes by digest,
// verdict equivalent, coverage measured, and signed by an allowed signer where signers are named.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { directoryTree } from './kernel/source-tree.mjs';
import { parseSource } from './parser.mjs';
import { isProgram, readSource, relPath } from './sources.mjs';
import { NAMESPACE, PAYLOAD_TYPE, cleanGitEnv, pae } from './evidence/seal.mjs';
import { verifySshsig } from './evidence/sshsig.mjs';

export const EQUIVALENCE_PREDICATE = 'https://github.com/Portll/ironwork/blob/main/docs/evidence.md#equivalence-v1';
const PASSING = new Set(['equivalent', 'equivalent-as-declared']);
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

// { statement, signed, signer, reason } for one file holding a statement or a DSSE envelope of one.
export function readStatement(path, allowed = null) {
  let doc;
  try { doc = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { return { statement: null, reason: `${basename(path)} is not JSON (${e.message})` }; }
  if (doc && doc.payloadType === PAYLOAD_TYPE && typeof doc.payload === 'string') {
    const payload = Buffer.from(doc.payload, 'base64');
    let statement;
    try { statement = JSON.parse(payload.toString('utf8')); } catch { return { statement: null, reason: `${basename(path)} carries no statement` }; }
    const checks = (doc.signatures || []).map((s) => (allowed ? verifySshsig({ blob: Buffer.from(String(s.sig), 'base64'), message: pae(PAYLOAD_TYPE, payload), namespace: NAMESPACE, allowed }) : { valid: null }));
    const good = checks.find((c) => c.valid === true);
    return { statement, signed: Boolean(good), signer: good ? good.principals : null, reason: good ? null : allowed ? 'no signature from an allowed signer' : 'no allowed signers were given' };
  }
  return { statement: doc, signed: false, signer: null, reason: 'the statement is not signed' };
}

const subjectDigest = (st, side) => {
  const s = (st.subject || []).find((x) => String(x.name || '').startsWith(`${side}:`));
  return s && s.digest ? s.digest.sha256 : null;
};

// The copybooks a program resolves, by path relative to its tree and digest.
function closure(root, file, idx, systemDirs) {
  let res;
  try {
    res = parseSource(readSource(file).text, file, { format: 'auto', includeDirs: idx.copyDirs, fileIndex: idx.index, mainDir: dirname(file), copyFormat: 'auto', systemDirs });
  } catch { return null; }
  const out = new Map();
  for (const c of res.copies) {
    if (c.status !== 'resolved' || !c.path) continue;
    try { out.set(relPath(root, c.path), sha256(readFileSync(c.path))); } catch { out.set(relPath(root, c.path), null); }
  }
  return out;
}

// Programs the change edits or adds, or whose copybooks it edits: [{ path, base, head, via }] with
// each side's source digest and the copybooks that changed under an unchanged program.
export function changedPrograms(baseDir, headDir, allow = null, systemDirs = []) {
  const out = [];
  const headTree = directoryTree(headDir);
  const baseIdx = directoryTree(baseDir).index;
  for (const head of headTree.list().filter((p) => isProgram(p) && (!allow || allow.has(p))).sort()) {
    const path = relPath(headDir, head);
    const h = sha256(readFileSync(head));
    const baseFile = join(baseDir, path);
    const b = existsSync(baseFile) ? sha256(readFileSync(baseFile)) : null;
    if (b !== h) { out.push({ path, base: b, head: h }); continue; }
    const after = closure(headDir, head, headTree.index, systemDirs);
    const before = closure(baseDir, baseFile, baseIdx, systemDirs);
    if (!after || !before) continue;
    const via = [...new Set([...after.keys(), ...before.keys()])].filter((k) => after.get(k) !== before.get(k)).sort();
    if (via.length) out.push({ path, base: b, head: h, via, viaDigests: via.map((k) => after.get(k)).filter(Boolean) });
  }
  return out;
}

// Whether a commit in base..head reads as authored by a tool, from its identities and trailers.
const TOOL = /\[bot\]|(^|[^a-z])bot@|copilot|claude|anthropic|openai|codex|devin|cursor|gemini|aider|sweep-ai|dependabot|renovate/i;
export function machineAuthored(repo, base, head, env = process.env) {
  const r = spawnSync('git', ['-C', repo, 'rev-list', '--format=%x1e%an%x00%ae%x00%cn%x00%ce%x00%B', `${base}..${head}`], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 << 20, env: cleanGitEnv(env) });
  if (r.status !== 0) return { known: false, commits: [] };
  const commits = [];
  for (const chunk of r.stdout.split('\x1e').slice(1)) {
    const [an, ae, cn, ce, body = ''] = chunk.split('\x00');
    const trailers = body.split('\n').filter((l) => /^(co-authored-by|generated-by|assisted-by):/i.test(l.trim()));
    const signals = [an, ae, cn, ce, ...trailers, ...(/generated with/i.test(body) ? ['generated with'] : [])].filter((x) => x && TOOL.test(x));
    if (signals.length) commits.push({ signals: [...new Set(signals.map((s) => s.trim().slice(0, 80)))] });
  }
  return { known: true, commits };
}

// The equivalence check for one build: which changed programs a statement covers, and whether the
// policy's requirement is met. `required` is true, false, or null when machine authorship is unknown.
export function checkEquivalence({ baseDir, headDir, allow, files = [], allowed = null, mode = 'never', repo = null, base = null, head = null, systemDirs = [], env = process.env }) {
  const changed = changedPrograms(baseDir, headDir, allow, systemDirs);
  const statements = files.map((f) => ({ file: basename(f), ...readStatement(f, allowed) }));
  const problems = [];
  for (const s of statements) {
    if (!s.statement) { problems.push(s.reason); continue; }
    if (s.statement.predicateType !== EQUIVALENCE_PREDICATE) { problems.push(`${s.file} is not an ironwork equivalence statement`); continue; }
    const h = subjectDigest(s.statement, 'head');
    const b = subjectDigest(s.statement, 'base');
    if (!changed.some((c) => c.head === h && (c.base === b || (c.base === null && b === null)))) {
      problems.push(`${s.file} names head ${h ? h.slice(0, 12) : 'nothing'} and base ${b ? b.slice(0, 12) : 'nothing'}, which match no program this change edits`);
    }
  }
  const programs = changed.map((c) => {
    const s = statements.find((x) => x.statement && subjectDigest(x.statement, 'head') === c.head && subjectDigest(x.statement, 'base') === c.base);
    const via = c.via ? { via: c.via } : {};
    if (!s) return { path: c.path, ...via, statement: null, ok: false, because: c.via ? `no equivalence statement names this program, whose copybook${c.via.length > 1 ? 's' : ''} ${c.via.join(', ')} the change edits` : 'no equivalence statement names this change' };
    const p = s.statement.predicate || {};
    const verdict = p.verdict || null;
    const covered = p.coverage !== null && p.coverage !== undefined;
    const ranOn = new Set(((p.closure && p.closure.head) || []).map((x) => x.sha256));
    const missing = (c.viaDigests || []).filter((d) => !ranOn.has(d));
    const because = !PASSING.has(verdict) ? `the statement's verdict is ${verdict}${Array.isArray(p.inconclusive) && p.inconclusive.length ? ` (${p.inconclusive.join('; ')})` : ''}`
      : missing.length ? `the statement does not show the head run read the edited copybook${c.via.length > 1 ? 's' : ''} ${c.via.join(', ')}`
      : !covered ? 'the statement measured no coverage of the changed paragraphs, so it is inconclusive'
        : allowed && !s.signed ? `the statement is ${s.reason}`
          : null;
    const unreached = covered && Array.isArray(p.coverage.unreached) ? p.coverage.unreached : [];
    return { path: c.path, ...via, statement: s.file, verdict, signed: s.signed, signer: s.signer, coverage: covered, ...(unreached.length ? { unreached } : {}), ok: because === null && !unreached.length, ...(because || unreached.length ? { because: because || `the inputs never reached ${unreached.join(', ')}` } : {}) };
  });
  const authorship = mode === 'machineAuthored' && repo && base ? machineAuthored(repo, base, head || 'HEAD', env) : null;
  const required = mode === 'always' ? true : mode === 'machineAuthored' ? (authorship && authorship.known ? authorship.commits.length > 0 : null) : false;
  return { mode, required, ...(authorship ? { machineAuthored: authorship } : {}), programs, problems };
}
