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

// The first program's paragraphs, by name, each as its own statements read with every position
// left out, so a paragraph that only moved is the same paragraph (as ironwork compare reads them).
function paragraphPrints(file) {
  let program;
  try { program = parseSource(readSource(file).text, file, { format: 'auto', mainDir: dirname(file) }).programs[0]; } catch { return null; }
  if (!program) return null;
  const positionFree = (x) => (Array.isArray(x) ? x.map(positionFree)
    : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).filter(([k]) => !['line', 'file', 'at', 'end', 'col', 'fmt'].includes(k)).map(([k, v]) => [k, positionFree(v)]))
      : x);
  const labels = [...program.labels].sort((a, b) => a.at - b.at);
  const prints = new Map();
  labels.forEach((label, i) => {
    if (label.kind !== 'P') return;
    const end = i + 1 < labels.length ? labels[i + 1].at : Infinity;
    const body = program.statements.filter((s) => s.at > label.at && s.at < end).map(positionFree);
    prints.set(label.name, [...(prints.get(label.name) || []), JSON.stringify(body)]);
  });
  return prints;
}

// The head's paragraphs whose own statements the change edits or adds.
function editedParagraphs(baseFile, headFile) {
  const before = paragraphPrints(baseFile);
  const after = paragraphPrints(headFile);
  if (!before || !after) return [];
  return [...after].filter(([name, prints]) => String(before.get(name)) !== String(prints)).map(([name]) => name).sort();
}

// Programs the change edits, adds or deletes, or whose copybooks it edits: [{ path, base, head, via }]
// with each side's source digest (head null for a deleted program) and the copybooks that changed
// under an unchanged program.
export function changedPrograms(baseDir, headDir, allow = null, systemDirs = []) {
  const out = [];
  const headTree = directoryTree(headDir);
  const baseTree = directoryTree(baseDir);
  const baseIdx = baseTree.index;
  for (const base of baseTree.list().filter(isProgram).sort()) {
    const path = relPath(baseDir, base);
    if (!existsSync(join(headDir, path))) out.push({ path, base: sha256(readFileSync(base)), head: null, deleted: true });
  }
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
  // NUL ends every field and every commit (-z), and a commit message cannot hold one.
  const r = spawnSync('git', ['-C', repo, 'log', '-z', '--format=%an%x00%ae%x00%cn%x00%ce%x00%B', `${base}..${head}`], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 << 20, env: cleanGitEnv(env) });
  if (r.status !== 0) return { known: false, commits: [] };
  const fields = r.stdout.split('\x00');
  if (fields.at(-1) === '') fields.pop();
  if (fields.length % 5 !== 0) return { known: false, commits: [] };
  const commits = [];
  for (let i = 0; i < fields.length; i += 5) {
    const [an, ae, cn, ce, body = ''] = fields.slice(i, i + 5);
    // Control characters are dropped first, so one placed before a trailer does not hide it.
    const trailers = body.split('\n').map((l) => l.replace(/[\x00-\x1f\x7f]/g, '').trim()).filter((l) => /^(co-authored-by|generated-by|assisted-by):/i.test(l));
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
  const authorship = mode === 'machineAuthored' && repo && base ? machineAuthored(repo, base, head || 'HEAD', env) : null;
  const required = mode === 'always' ? true : mode === 'machineAuthored' ? (authorship && authorship.known ? authorship.commits.length > 0 : null) : false;
  // Every statement that names a program is judged, and the program passes only if each does.
  // Where equivalence may be required, a statement no allowed signer signed could have been written
  // by anyone who can commit.
  const programs = changed.map((c) => {
    if (c.deleted) return { path: c.path, deleted: true, statement: null, ok: false, because: 'the change deletes this program, and no equivalence statement can show what its callers do now' };
    const matching = statements.filter((x) => x.statement && subjectDigest(x.statement, 'head') === c.head && subjectDigest(x.statement, 'base') === c.base);
    const via = c.via ? { via: c.via } : {};
    if (!matching.length) return { path: c.path, ...via, statement: null, ok: false, because: c.via ? `no equivalence statement names this program, whose copybook${c.via.length > 1 ? 's' : ''} ${c.via.join(', ')} the change edits` : 'no equivalence statement names this change' };
    const judged = matching.map((s) => judge(c, s));
    const failed = judged.find((j) => !j.ok);
    if (failed) return failed;
    if (!allowed && required !== false) return { ...judged[0], ok: false, because: 'no --allowed-signers were given, so nothing shows who wrote the statement' };
    return judged[0];
  });
  function judge(c, s) {
    const via = c.via ? { via: c.via } : {};
    const p = s.statement.predicate || {};
    const verdict = p.verdict || null;
    const covered = !!p.coverage && typeof p.coverage === 'object' && Array.isArray(p.coverage.unreached) && p.coverage.unreached.every((u) => typeof u === 'string');
    const ranOn = new Set(((p.closure && p.closure.head) || []).map((x) => x.sha256));
    const missing = (c.viaDigests || []).filter((d) => !ranOn.has(d));
    // ironwork decides which paragraphs changed; a paragraph whose statements this diff shows
    // edited and the statement does not list as changed was never held to coverage.
    const claimed = covered && Array.isArray(p.coverage.changed) ? new Set(p.coverage.changed.map((n) => String(n).toUpperCase())) : null;
    const edited = covered && c.base ? editedParagraphs(join(baseDir, c.path), join(headDir, c.path)) : [];
    const unclaimed = edited.filter((n) => !claimed || !claimed.has(n));
    const because = !PASSING.has(verdict) ? `the statement's verdict is ${verdict}${Array.isArray(p.inconclusive) && p.inconclusive.length ? ` (${p.inconclusive.join('; ')})` : ''}`
      : missing.length ? `the statement does not show the head run read the edited copybook${c.via.length > 1 ? 's' : ''} ${c.via.join(', ')}`
      : !covered ? 'the statement measured no coverage of the changed paragraphs, so it is inconclusive'
        : unclaimed.length ? `the statement's coverage does not list ${unclaimed.join(', ')} as changed, and the change edits ${unclaimed.length > 1 ? 'them' : 'it'}`
          : allowed && !s.signed ? `the statement is ${s.reason}`
            : null;
    const unreached = covered ? p.coverage.unreached : [];
    return { path: c.path, ...via, statement: s.file, verdict, signed: s.signed, signer: s.signer, coverage: covered, ...(unreached.length ? { unreached } : {}), ok: because === null && !unreached.length, ...(because || unreached.length ? { because: because || `the inputs never reached ${unreached.join(', ')}` } : {}) };
  }
  return { mode, required, ...(authorship ? { machineAuthored: authorship } : {}), programs, problems };
}
