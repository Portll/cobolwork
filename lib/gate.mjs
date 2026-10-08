// SPDX-License-Identifier: AGPL-3.0-or-later
// Whether a patch fixed one finding and moved nothing else: the deterministic half of remediation,
// specified in docs/spec/remediation-gate.md. A finding can leave a report without being fixed, so a
// disappearance passes only where the engine itself says why.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';
import { withRefs, diffTrees, DIFF_RULES, WORKING_TREE } from './diff.mjs';
import { pairingKeys, codeLines } from './kernel/identity.mjs';
import { printable } from './kernel/printable.mjs';
import { SOURCE_KINDS, SINK_KINDS } from './dataflow.mjs';
import { detectFormat } from './parser.mjs';
import { ALL_RULES } from './kernel/registry.mjs';
import { parseMessages } from './ironwork.mjs';
import { FLOW_MODEL, SCHEMA_VERSION, TOOL_VERSION } from './version.mjs';

const SEV = { info: 0, low: 1, med: 2, high: 3, crit: 4 };
const MAX_REASONS = 20;
const MAX_EDIT = 2000;
const MAX_LINES = 200000;
const MAX_COMPILES = 50;
const COMPILE_BUDGET_MS = 10 * 60 * 1000;
// A fix keeps the program's statements and stops the route: deleting the flagged statement or the
// source statement removes what the program did, and fails.
const PASSING = new Set(['cleared-by-check', 'no-longer-fires']);
const UNDECIDED = new Set(['lowered-by-check', 'gone-unexplained']);

const pathText = (p) => printable(String(p ?? ''), 120);
const where = (f) => `${pathText(f.path)}:${Number(f.line) || 0}`;
const ruleText = (rule) => (ALL_RULES[rule] || DIFF_RULES[rule] || {}).text || rule;

// The one source kind and sink kind a path rule's id spells, or null.
export function kindsOf(rule) {
  for (const source of Object.keys(SOURCE_KINDS)) {
    if (!rule.startsWith(`${source}-to-`)) continue;
    const sink = rule.slice(source.length + 4);
    if (Object.hasOwn(SINK_KINDS, sink)) return { source, sink };
  }
  return null;
}

// Myers' diff over two lists of lines, after common ends are set aside. Returns the 1-based lines
// deleted from `a` and inserted in `b`, or null past `maxEdit` edits or MAX_LINES lines.
export function lineDiff(a, b, maxEdit = MAX_EDIT) {
  if (a.length + b.length > MAX_LINES) return null;
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
  const A = a.slice(s, ea), B = b.slice(s, eb);
  const n = A.length, m = B.length;
  const deleted = new Set(), inserted = new Set();
  if (!n || !m) {
    for (let i = 0; i < n; i++) deleted.add(s + i + 1);
    for (let j = 0; j < m; j++) inserted.add(s + j + 1);
    return n + m > maxEdit ? null : { deleted, inserted };
  }
  const off = n + m + 1;
  const v = new Int32Array(2 * off + 1);
  // v before each step d, kept only over the diagonals -d..d that step can read back.
  const trace = [];
  let found = -1;
  for (let d = 0; d <= Math.min(maxEdit, n + m) && found < 0; d++) {
    trace.push(v.slice(off - d, off + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) { x++; y++; }
      v[off + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
  }
  if (found < 0) return null;
  let x = n, y = m;
  for (let d = found; d > 0; d--) {
    const w = trace[d];
    const at = (k) => w[k + d];
    const k = x - y;
    const prevK = (k === -d || (k !== d && at(k - 1) < at(k + 1))) ? k + 1 : k - 1;
    const px = at(prevK), py = px - prevK;
    while (x > px && y > py) { x--; y--; }
    if (x === px) inserted.add(s + py + 1);
    else deleted.add(s + px + 1);
    x = px; y = py;
  }
  return { deleted, inserted };
}

// A program to run, as an absolute file outside the reviewed tree: a name with a directory in it is
// taken as a path, and a bare name is the first match on PATH, skipping relative entries and every
// entry inside the tree. A bare name is looked for in the working directory first on Windows.
export function findExecutable(command, { repo, env = process.env, platform = process.platform } = {}) {
  const inside = (p) => {
    let real;
    try { real = realpathSync(p); } catch { return false; }
    const top = (() => { try { return realpathSync(repo); } catch { return resolve(repo); } })();
    return real === top || real.startsWith(top + sep);
  };
  const usable = (p) => { try { return statSync(p).isFile() && !inside(p); } catch { return false; } };
  const name = String(command);
  if (isAbsolute(name) || /[\\/]/.test(name)) {
    const p = resolve(name);
    return usable(p) ? { path: p } : { path: null, why: `${pathText(p)} is not a file outside the repository` };
  }
  const names = platform === 'win32' && !/\.[a-z]+$/i.test(name) ? [`${name}.exe`, `${name}.com`] : [name];
  const pathVar = env.PATH ?? env.Path ?? '';
  for (const dir of String(pathVar).split(delimiter)) {
    if (!dir || !isAbsolute(dir) || inside(dir)) continue;
    for (const n of names) if (usable(join(dir, n))) return { path: join(dir, n) };
  }
  return { path: null, why: `no ${printable(name, 60)} on PATH outside the repository` };
}

export function findCobc({ explicit = null, repo, env = process.env, platform = process.platform } = {}) {
  if (!explicit) return findExecutable('cobc', { repo, env, platform });
  const found = findExecutable(resolve(explicit), { repo, env, platform });
  return found.path ? found : { path: null, why: `--cobc ${pathText(resolve(explicit))} is not a file outside the repository` };
}

// A compiler run as `cobc -fsyntax-only`, from outside the tree, for a bounded time. Its error lines
// are kept so a drafter whose patch stopped a program compiling is told where.
export function cobcCompiler(cobc) {
  return (file, { includeDirs = [], free = false } = {}) => {
    const r = spawnSync(cobc, ['-fsyntax-only', ...(free ? ['-free'] : []), ...includeDirs.flatMap((d) => ['-I', d]), file],
      { cwd: tmpdir(), timeout: 60000, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'latin1', maxBuffer: 1 << 20 });
    return { ok: r.status === 0, messages: String(r.stderr || '').split(/\r?\n/).filter((l) => /: error: /.test(l)) };
  };
}

// `ironwork check` with the same contract: it compiles at return code 0 or 4, and its E, S and U
// messages are the error lines, written `path:line: IWC0001-S text` with literals redacted.
export function ironworkCompiler(ironwork) {
  return (file, { includeDirs = [] } = {}) => {
    const r = spawnSync(ironwork, ['check', file, ...includeDirs.flatMap((d) => ['-I', d])],
      { cwd: tmpdir(), timeout: 60000, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', maxBuffer: 1 << 20 });
    const top = parse(resolve(file)).root;
    const errors = parseMessages(r.stderr, { root: top, program: file }).filter((m) => ['E', 'S', 'U'].includes(m.severity));
    return { ok: r.status === 0 || r.status === 4, messages: errors.map((m) => `${join(top, m.path)}${m.line ? `:${m.line}` : ''}: ${m.id}-${m.severity} ${m.text}`) };
  };
}

// The gate's compiler: --ironwork, then --cobc, then ironwork on PATH, then cobc on PATH. `label`
// names the one that runs, and why it is cobc where it is.
export function gateCompiler({ ironwork = null, cobc = null, repo, env = process.env, platform = process.platform } = {}) {
  if (ironwork) {
    const found = findExecutable(resolve(ironwork), { repo, env, platform });
    return found.path ? { run: ironworkCompiler(found.path), label: 'ironwork check' } : { why: `--ironwork ${pathText(resolve(ironwork))} is not a file outside the repository` };
  }
  if (cobc) {
    const found = findCobc({ explicit: cobc, repo, env, platform });
    return found.path ? { run: cobcCompiler(found.path), label: 'cobc -fsyntax-only, named by --cobc' } : { why: found.why };
  }
  const iw = findExecutable('ironwork', { repo, env, platform });
  if (iw.path) return { run: ironworkCompiler(iw.path), label: 'ironwork check' };
  const found = findCobc({ repo, env, platform });
  return found.path ? { run: cobcCompiler(found.path), label: `cobc -fsyntax-only, since there is ${iw.why}` } : { why: `${iw.why}, and ${found.why}` };
}

const MAX_COMPILER_LINES = 3;

// Level 1 matches across both lists first; each looser level pairs only what the level above left.
export function pairLists(base, head, baseKeys, headKeys) {
  const headOf = new Array(base.length).fill(-1);
  const baseOf = new Array(head.length).fill(-1);
  const level = new Array(base.length).fill(null);
  const levels = [
    ['fingerprint', (i) => base[i].fingerprint, (j) => head[j].fingerprint],
    ['scope', (i) => baseKeys[i].scope, (j) => headKeys[j].scope],
    ['route', (i) => baseKeys[i].route, (j) => headKeys[j].route],
  ];
  for (const [name, keyB, keyH] of levels) {
    const open = new Map();
    for (let i = 0; i < base.length; i++) {
      if (headOf[i] >= 0) continue;
      const k = keyB(i);
      if (!k) continue;
      if (!open.has(k)) open.set(k, []);
      open.get(k).push(i);
    }
    for (let j = 0; j < head.length; j++) {
      if (baseOf[j] >= 0) continue;
      const k = keyH(j);
      const q = k && open.get(k);
      if (!q || !q.length) continue;
      const i = q.shift();
      headOf[i] = j; baseOf[j] = i; level[i] = name;
    }
  }
  return { headOf, baseOf, level };
}

// Changed lines of one file between the trees, cached; null when the pair is too large to attribute.
function changes(baseRoot, headRoot, cache) {
  return (path) => {
    if (!path) return null;
    if (cache.has(path)) return cache.get(path);
    const raw = (root) => { try { return readFileSync(join(root, path)); } catch { return null; } };
    const was = raw(baseRoot), now = raw(headRoot);
    if (was && now && was.equals(now)) { const same = { deleted: new Set(), inserted: new Set() }; cache.set(path, same); return same; }
    const a = codeLines(baseRoot, path) || [];
    const b = codeLines(headRoot, path) || [];
    const d = lineDiff(a, b);
    cache.set(path, d);
    return d;
  };
}

function targetOutcome(ctx) {
  const { t, ti, pairs, after, afterKeysChecked, baseKeys, changed, headProgs, headRoot, allow, listed } = ctx;
  const j = pairs.headOf[ti];
  if (j >= 0) {
    const h = after.findings[j];
    if (SEV[h.sev] >= SEV[t.sev]) return { outcome: 'still-reported', pairedBy: pairs.level[ti], head: h };
    const g = h.guard;
    const d = g ? changed(g.file) : null;
    if (g && (!d || d.inserted.has(Number(g.line)))) return { outcome: 'lowered-by-check', pairedBy: pairs.level[ti], head: h, guard: g };
    return { outcome: 'still-reported', pairedBy: pairs.level[ti], head: h };
  }
  const inHead = (p) => existsSync(join(headRoot, p)) && (!allow || allow.has(resolve(headRoot, p)));
  const programGone = t.program && ctx.baseProgs.has(`${t.path}#${t.program}`) && !headProgs.has(`${t.path}#${t.program}`);
  if (!inHead(t.path) || programGone) return { outcome: 'program-removed' };
  const checked = after.checked || [];
  for (let k = 0; k < checked.length; k++) {
    const c = checked[k];
    if (c.rule !== t.rule || !c.guard || !c.guard.stops) continue;
    if (c.fingerprint === t.fingerprint || afterKeysChecked[k].scope === baseKeys[ti].scope || (baseKeys[ti].route && afterKeysChecked[k].route === baseKeys[ti].route)) {
      return { outcome: 'cleared-by-check', guard: c.guard };
    }
  }
  if (t.evidence === 'path') {
    const kinds = kindsOf(t.rule);
    if (!kinds) return { outcome: 'gone-unexplained' };
    const writtenBack = (list, kind, program) => list.some((x) => x.kind === kind && x.program === program && (() => {
      const d = changed(x.file);
      return !d || d.inserted.has(Number(x.line));
    })());
    const d = changed(t.path);
    if (d && d.deleted.has(Number(t.line)) && !writtenBack(listed.sinks, kinds.sink, t.program)) return { outcome: 'statement-removed' };
    const src = t.related && t.related[0];
    const srcProgram = (t.trace && t.trace[0] && t.trace[0].program) || t.program;
    const ds = src ? changed(src.path) : null;
    if (ds && ds.deleted.has(Number(src.line)) && !writtenBack(listed.sources, kinds.source, srcProgram)) return { outcome: 'source-removed' };
    return { outcome: 'gone-unexplained' };
  }
  const d = changed(t.path);
  if (d && (d.deleted.size || d.inserted.size)) return { outcome: 'no-longer-fires' };
  return { outcome: 'gone-unexplained' };
}

function targetReason(t, r) {
  const at = `${t.rule} at ${where(t)}`;
  switch (r.outcome) {
    case 'still-reported':
      return `the target, ${at}, is still reported at ${r.head.sev}${r.pairedBy === 'fingerprint' ? '' : ' after its line was edited or moved'}: ${ruleText(t.rule)}`;
    case 'lowered-by-check':
      return `the target is still reported, lowered from ${t.sev} to ${r.head.sev} by a check this patch added at ${where({ path: r.guard.file, line: r.guard.line })}; a check that lowers rather than stops may not turn away everything it should, so a person decides`;
    case 'program-removed':
      return `the patch removes ${pathText(t.path)}${t.program ? ` or its program ${printable(t.program, 40)}` : ''}, which held the target; removing the program is not a fix the gate accepts`;
    case 'statement-removed':
      return `the patch deletes the target's statement at ${where(t)}; a fix keeps the statement and stops the route to it, so deleting it is not a fix the gate accepts`;
    case 'source-removed':
      return `the patch deletes the statement the target's input comes from; a fix keeps it and stops the route from it, so deleting it is not a fix the gate accepts`;
    case 'gone-unexplained':
      return `the target, ${at}, is gone, but the patch neither removed its statement or its source nor added a check that stops its route; the route may be cut between its ends, or sent through something the engine does not follow, and a person decides`;
    default:
      return null;
  }
}

// The compile check: every program the patch changed, or whose resolved COPYs it changed, must
// still compile if it compiled before.
function compileCheck({ compiler, baseRoot, headRoot, baseProgs, headProgs, changedFiles }) {
  if (!compiler.run) return { ok: null, compiled: `not compiled: ${compiler.why}`, reasons: [] };
  const files = new Set();
  for (const p of headProgs.values()) {
    if (changedFiles.has(p.file) || [...p.copied].some((c) => changedFiles.has(c))) files.add(p.file);
  }
  if (!files.size) return { ok: true, compiled: 'nothing to compile: the patch changed no program or anything one copies', reasons: [] };
  if (files.size > MAX_COMPILES) return { ok: null, compiled: `not compiled: ${files.size} programs, past the ${MAX_COMPILES} the gate compiles`, reasons: [] };
  const optsFor = (root, progs, file) => {
    const dirs = new Set([dirname(join(root, file))]);
    for (const p of progs.values()) if (p.file === file) for (const c of p.copied) dirs.add(dirname(join(root, c)));
    let free = false;
    try { free = detectFormat(readFileSync(join(root, file), 'latin1')) === 'free'; } catch { /* unreadable: compiled as fixed */ }
    return { includeDirs: [...dirs].sort(), free };
  };
  // A compiler answers true or false, or { ok, messages }.
  const compile = (root, progs, file) => {
    const r = compiler.run(join(root, file), optsFor(root, progs, file));
    return r && typeof r === 'object' ? { ok: !!r.ok, messages: r.messages || [] } : { ok: !!r, messages: [] };
  };
  const regressed = [], neverCompiled = [];
  const deadline = Date.now() + (compiler.budgetMs ?? COMPILE_BUDGET_MS);
  for (const file of [...files].sort()) {
    if (Date.now() > deadline) return { ok: null, compiled: `not compiled: the compiler ran past the gate's ${Math.round((compiler.budgetMs ?? COMPILE_BUDGET_MS) / 60000)}-minute budget`, reasons: [] };
    const now = compile(headRoot, headProgs, file);
    if (now.ok) continue;
    const had = existsSync(join(baseRoot, file)) && compile(baseRoot, baseProgs, file).ok;
    if (had) regressed.push({ file, messages: now.messages });
    else neverCompiled.push(file);
  }
  // The compiler names the file by where the head was written; the reader knows it by its path.
  const asInRepo = (m) => m.split(join(headRoot, sep)).join('');
  const by = compiler.label ? ` under ${compiler.label}` : '';
  if (regressed.length) {
    return { ok: false, compiled: `${regressed.length} program(s) compiled before the patch and do not after${by}`, reasons: regressed.flatMap(({ file, messages }) => [
      `${pathText(file)} compiled before the patch and does not after`,
      ...messages.slice(0, MAX_COMPILER_LINES).map((m) => `the compiler: ${asInRepo(m).trim()}`),
    ]) };
  }
  if (neverCompiled.length) return { ok: null, compiled: `${neverCompiled.length} program(s) do not compile before or after the patch${by}, or are new and do not compile, which the gate cannot tell from a missing copy library`, reasons: [] };
  return { ok: true, compiled: `${files.size} program(s) compile${by}`, reasons: [] };
}

// Judges two trees already on disk. `compiler` is { run(file, opts) -> boolean, label } or { why }.
export function gateTrees(baseRoot, headRoot, fingerprint, opts = {}) {
  const d = diffTrees(baseRoot, headRoot, { ...opts, keepScans: true, listSinks: true, listSources: true });
  const { before, after, base: baseProgs, head: headProgs } = d.scans;
  const ti = before.findings.findIndex((f) => f.fingerprint === fingerprint);
  if (ti < 0) {
    const short = before.summary.coverageIncomplete ? '; the base scan was incomplete, so it may not have reached that finding' : '';
    throw Object.assign(new Error(`no finding with fingerprint ${printable(fingerprint, 80)} in the base${short}`), { code: 'EGATETARGET' });
  }
  const t = before.findings[ti];
  const baseKeys = pairingKeys(before.findings, { root: baseRoot });
  const headKeys = pairingKeys(after.findings, { root: headRoot });
  const pairs = pairLists(before.findings, after.findings, baseKeys, headKeys);
  // Every base finding sharing the target's fingerprint is the target; one still paired keeps it reported.
  const sameTarget = before.findings.map((f, i) => (f.fingerprint === fingerprint ? i : -1)).filter((i) => i >= 0);
  const stillPaired = sameTarget.find((i) => pairs.headOf[i] >= 0);
  const cache = new Map();
  const changed = changes(baseRoot, headRoot, cache);
  const listed = (after.listed) || { sinks: [], sources: [] };
  const r = targetOutcome({
    t, ti: stillPaired ?? ti, pairs, after, baseKeys, changed, baseProgs, headProgs, headRoot, allow: opts.allow || null, listed,
    afterKeysChecked: pairingKeys(after.checked || [], { root: headRoot }),
  });
  const reasons = [];
  const checks = {};
  checks.target = PASSING.has(r.outcome) ? true : UNDECIDED.has(r.outcome) ? null : false;
  const tr = targetReason(t, r);
  if (tr) reasons.push(tr);

  const summary = d.summary;
  const fullGate = !opts.targetOnly;
  if (fullGate) {
    const targetHead = stillPaired !== undefined ? pairs.headOf[stillPaired] : -1;
    const added = after.findings.filter((h, j) => {
      if (j === targetHead) return false;
      const i = pairs.baseOf[j];
      return i < 0 || SEV[h.sev] > SEV[before.findings[i].sev];
    });
    checks.added = added.length === 0;
    for (const h of added) reasons.push(`the patch adds ${h.rule} (${h.sev}) at ${where(h)}: ${ruleText(h.rule)}`);

    const layout = d.findings.filter((f) => f.rule === 'diff-interface-layout-changed' || f.rule === 'diff-layout-changed-unedited-program');
    checks.layout = layout.length === 0;
    for (const f of layout) reasons.push(`the patch moves fields in ${printable(f.program, 40)} (${pathText(f.path)}): ${ruleText(f.rule)}`);

    const calls = d.findings.filter((f) => f.rule === 'diff-new-call-target' || f.rule === 'diff-new-dynamic-call');
    checks.calls = calls.length === 0;
    for (const f of calls) reasons.push(`the patch changes what ${printable(f.program, 40)} (${pathText(f.path)}) calls: ${ruleText(f.rule)}`);

    const config = summary.configurationChanged || [];
    checks.configuration = config.length === 0;
    for (const c of config) reasons.push(`the patch changes ${c.file}, which decides which rules run and which findings are accepted; a fix may not`);
  }

  const setKey = (s) => `${s.set}|${s.kind}`;
  const had = new Set((before.summary.setsIncomplete || []).map(setKey));
  const newlyShort = (after.summary.setsIncomplete || []).filter((s) => !had.has(setKey(s)));
  const incomplete = summary.coverageIncomplete || newlyShort.length > 0;
  checks.coverage = incomplete ? null : true;
  if (incomplete) {
    const sets = [...new Set([...(before.summary.setsIncomplete || []).filter((s) => s.kind === 'coverage'), ...(after.summary.setsIncomplete || []).filter((s) => s.kind === 'coverage'), ...newlyShort].map((s) => `${s.set} (${s.kind})`))].sort();
    reasons.push(`coverage is incomplete${sets.length ? ` in ${sets.join(', ')}` : ''}, so what the patch removed cannot be told from what was not read`);
  }

  // Whether a file changed is a byte comparison; only the target's own files need the line diff.
  const changedFiles = new Set();
  const bytes = (root, p) => { try { return readFileSync(join(root, p)); } catch { return null; } };
  const programs = [...baseProgs.values(), ...headProgs.values()];
  for (const p of new Set([...programs.map((x) => x.file), ...programs.flatMap((x) => [...x.copied])])) {
    const was = bytes(baseRoot, p), now = bytes(headRoot, p);
    if (!was || !now || !was.equals(now)) changedFiles.add(p);
  }
  let compiled = null;
  if (fullGate) {
    const cc = compileCheck({ compiler: opts.compiler || { why: 'no compiler given' }, baseRoot, headRoot, baseProgs, headProgs, changedFiles });
    checks.compile = cc.ok;
    compiled = cc.compiled;
    reasons.push(...cc.reasons);
  }

  const values = Object.entries(checks);
  const verdict = values.some(([, v]) => v === false) ? 'fail'
    : values.some(([k, v]) => v === null && k !== 'compile') ? 'undecided' : 'pass';
  return {
    tool: 'cobolwork-gate',
    schemaVersion: SCHEMA_VERSION,
    verdict,
    target: { fingerprint: t.fingerprint, rule: t.rule, sev: t.sev, evidence: t.evidence, path: pathText(t.path), line: Number(t.line) || 0, ...(t.program ? { program: printable(t.program, 40) } : {}) },
    outcome: r.outcome,
    ...(r.pairedBy ? { pairedBy: r.pairedBy } : {}),
    checks,
    ...(compiled !== null ? { compiled } : {}),
    reasons: reasons.slice(0, MAX_REASONS).map((x) => printable(x, 400)),
    ...(reasons.length > MAX_REASONS ? { reasonsNotShown: reasons.length - MAX_REASONS } : {}),
    repositoryText: ['target.path', 'target.program', 'reasons'],
    summary: {
      mode: fullGate ? 'gate' : 'target-only',
      flowModel: FLOW_MODEL,
      toolVersion: TOOL_VERSION,
      introduced: summary.introduced,
      resolved: summary.resolved,
      changedFiles: changedFiles.size,
      coverageIncomplete: !!incomplete,
    },
  };
}

// Materialises the revisions as diff does, and judges the patch between them.
export function gateRefs(repo, baseRef, headRef, fingerprint, opts = {}) {
  const compiler = opts.compiler || gateCompiler({ ironwork: opts.ironwork || null, cobc: opts.cobc || null, repo });
  return withRefs(repo, baseRef, headRef || null, {}, (baseDir, headDir, scoped) => {
    const res = gateTrees(baseDir, headDir, fingerprint, { ...scoped, compiler, targetOnly: opts.targetOnly === true });
    res.summary.base = baseRef;
    res.summary.head = headRef || WORKING_TREE;
    return res;
  });
}

// --exit-code: the verdict as the process's status.
export const VERDICT_EXIT = { pass: 0, fail: 1, undecided: 3 };
