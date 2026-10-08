// SPDX-License-Identifier: AGPL-3.0-or-later
// The build gate, specified in docs/spec/build-gate.md: scan, apply the policy and the baseline,
// hold the compiler's options to the policy, and run the compiler only on a pass. Every check is the
// engine's reading of the tree; nothing here asks a model anything.
import { checkEquivalence } from './equivalence.mjs';
import { optionChanges } from './option-diff.mjs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { parseAllowedSigners } from './evidence/sshsig.mjs';
import { scanAll } from './scan.mjs';
import { withRefs, configurationChanges, WORKING_TREE } from './diff.mjs';
import { pairLists, findExecutable } from './gate.mjs';
import { pairingKeys } from './kernel/identity.mjs';
import { directoryTree, pdsExportTree, resolvesInside } from './kernel/source-tree.mjs';
import { printable } from './kernel/printable.mjs';
import { ALL_RULES } from './kernel/registry.mjs';
import { loadBaseline, applyBaseline, SUPPRESSING } from './baseline.mjs';
import { loadSite, SITE_FILE } from './site.mjs';
import { isProgram, isJcl, isSource, relPath } from './sources.mjs';
import { parseJcl } from './jcl.mjs';
import { POLICY_FILE, treePolicy, floorPolicy, combinePolicies, canonical, policyHash } from './policy.mjs';
import { classesOf, tierOf, TIERS, TIER_RANK } from './consequence.mjs';
import { optionCards, enterpriseChecks, compilerChecks, scriptedChecks, compilerInvocations, compilerTasks, compileStepOptions, compilerOf, olderThan } from './options.mjs';
import { isBuildFile, pinsIn } from './sets/build.mjs';
import { FLOW_MODEL, TOOL_VERSION } from './version.mjs';
import { checkWithIronwork, ironworkVerdict, ironworkReasons, ironworkVersion, listed } from './ironwork.mjs';
import { buildFileIndex } from './parser.mjs';
import { precompileCheck } from './precompile-check.mjs';
import { EXIT } from './exit.mjs';

export const BUILD_SCHEMA_VERSION = 1;
export const BUILD_EXIT = { pass: EXIT.pass, fail: EXIT.fail, undecided: EXIT.undecided, compilerFailed: EXIT.compilerFailed };
const MAX_REASONS = 20;
const MAX_PROGRAM_REASONS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const where = (f) => `${printable(String(f.path ?? ''), 120)}:${Number(f.line) || 0}`;
const ruleText = (rule) => (ALL_RULES[rule] || {}).text || rule;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const refusal = (message) => Object.assign(new Error(message), { code: 'EBUILD' });

// Entries written with an expiry further off than the policy allows cover nothing.
function boundBaseline(baseline, maxDays) {
  if (!baseline) return { baseline: null, overlong: [] };
  const entries = [];
  const overlong = [];
  for (const e of baseline.entries) {
    if (SUPPRESSING.includes(e.action) && Date.parse(e.expires) - Date.parse(e.at) > maxDays * DAY_MS) overlong.push(e);
    else entries.push(e);
  }
  return { baseline: { ...baseline, entries }, overlong };
}

// Findings in the head the base did not hold at the same severity or higher, by gate's pairing.
function introducedIn(before, after, baseRoot, headRoot) {
  const pairs = pairLists(before.findings, after.findings, pairingKeys(before.findings, { root: baseRoot }), pairingKeys(after.findings, { root: headRoot }));
  const rank = (f) => TIER_RANK[tierOf(f)] ?? 0;
  return new Set(after.findings.filter((f, j) => {
    const i = pairs.baseOf[j];
    return i < 0 || rank(f) > rank(before.findings[i]);
  }));
}

// Why a finding blocks, or null. `renewed` is a finding whose waiver expired or ran past maxDays: in
// ratchet mode it is judged as new, because the promise that carried it has lapsed.
export function blockingReason(f, { policy, ratchet, introduced, renewed }) {
  if (f.abend?.inputFrom === 'interface' && policy.interface !== 'tier') return null;
  const setting = policy.rules[f.rule];
  if (setting === 'warn') return null;
  // A rule whose firing rate the corpus has not recorded blocks only where the policy names it.
  if (ALL_RULES[f.rule]?.measured === false) return setting === 'block' ? 'rule' : null;
  const tier = tierOf(f);
  if (ratchet && TIER_RANK[tier] >= TIER_RANK[policy.always]) return 'tier';
  if (ratchet && !introduced.has(f) && !renewed.has(f.fingerprint)) return null;
  if (TIER_RANK[tier] >= TIER_RANK[policy.block]) return 'tier';
  if (classesOf(f).some((c) => policy.classes.includes(c))) return 'class';
  return setting === 'block' ? 'rule' : null;
}

// Build scripts that can run cobc or gcobol: a Makefile, a shell or batch script, a CI workflow, a
// Dockerfile, an editor's task file, or a small script with no extension.
const BUILD_SCRIPT = /(^|\/)(makefile|gnumakefile|dockerfile|[^/]*\.(mk|sh|bash|bat|cmd|ps1|ya?ml))$/i;
const EDITOR_TASKS = /(^|\/)\.vscode\/tasks\.json$/i;
const MAX_SCRIPT_BYTES = 1 << 20;
const MAX_BARE_SCRIPT_BYTES = 64 << 10;

const kindOf = (rel) => (/(^|\/)(gnu)?makefile$|\.mk$/i.test(rel) ? 'make' : /(^|\/)dockerfile$/i.test(rel) ? 'docker'
  : /\.(bat|cmd)$/i.test(rel) ? 'batch' : /\.ps1$/i.test(rel) ? 'powershell' : /\.ya?ml$/i.test(rel) ? 'yaml' : 'sh');

function scriptInvocations(tree, file, rel) {
  if (EDITOR_TASKS.test(rel)) return compilerTasks(tree.text(file).text);
  const size = tree.kind === 'directory' ? statSync(file).size : tree.bytes(file).length;
  if (BUILD_SCRIPT.test(rel) && size <= MAX_SCRIPT_BYTES) return compilerInvocations(tree.text(file).text, { kind: kindOf(rel) });
  if (!extname(file) && size <= MAX_BARE_SCRIPT_BYTES) {
    const bytes = tree.bytes(file);
    return bytes.includes(0) ? [] : compilerInvocations(bytes.toString('latin1'), { kind: 'sh' });
  }
  return [];
}

// How the repository says it compiles its programs: the cobc and gcobol commands its build scripts
// run, and the Enterprise COBOL compile steps its JCL holds.
function declaredCompiles(tree, files) {
  const invocations = [];
  const parsedJcl = [];
  for (const f of files) {
    const rel = tree.rel(f);
    try {
      if (isJcl(f)) parsedJcl.push({ ...parseJcl(tree.text(f).text, f), file: rel });
      else if (!isProgram(f)) for (const inv of scriptInvocations(tree, f, rel)) invocations.push({ ...inv, file: rel });
    } catch { /* unreadable: the scan counts it, and it declares nothing here */ }
  }
  const steps = new Map();
  for (const s of compileStepOptions(parsedJcl)) {
    if (!steps.has(s.member)) steps.set(s.member, []);
    steps.get(s.member).push(s);
  }
  return { invocations, steps };
}

const memberName = (file) => basename(file).replace(/\.[^.]*$/, '').toUpperCase();

// The GnuCOBOL version the repository's build files pin, the oldest where they pin several.
function pinnedGnucobol(tree, files) {
  let oldest = null;
  for (const file of files.filter(isBuildFile)) {
    let text;
    try { text = tree.text(file).text; } catch { continue; }
    for (const p of pinsIn(text)) {
      if (p.product === 'gnucobol' && (!oldest || olderThan(p.version, oldest.version))) oldest = { version: p.version, where: tree.rel(file) };
    }
  }
  return oldest;
}

// The options every program in the tree is compiled with, held to the policy. A program's options
// come from the estate's declared defaults, the JCL step that compiles it and its own option cards;
// where it has none of those, from the cobc and gcobol commands the repository's build scripts run.
// `ok` is false where a required check is not generated and null where no one can tell; `forbidden`
// counts options the policy's forbid list names. `generated` maps each program and build script to
// the checks it generates, for telling a change that removes one.
function optionsCheck({ root, tree: given = null, allow, site, policy, compiler }) {
  const required = policy.checks;
  const kind = compiler && compilerOf(compiler[0]);
  if (compiler && !kind) {
    return { ok: null, forbidden: 0, reasons: [`the gate reads the options of cobc, of gcobol and of Enterprise COBOL option cards; for ${printable(compiler[0], 60)} it cannot tell what reaches the compiler`], add: [], generated: new Map() };
  }
  const tree = given || directoryTree(root);
  const files = [...new Set(tree.list())].filter((p) => !allow || allow.has(p)).sort();
  const pinned = pinnedGnucobol(tree, files);
  if (compiler) {
    const r = compilerChecks(kind, compiler.slice(1), { required, forbid: policy.forbid[kind], pinned });
    const missing = r.checks.filter((c) => c.ok === false).map((c) => c.why);
    return { ok: missing.length || r.forbidden.length ? false : true, forbidden: r.forbidden.length, reasons: [...r.forbidden, ...missing], add: r.forbidden.length ? [] : r.add, compiler: kind, generated: new Map() };
  }
  const programs = files.filter(isProgram);
  const declared = declaredCompiles(tree, files);
  let ok = true;
  let forbidden = 0;
  const reasons = [];
  const generated = new Map();
  const fail = (why) => { ok = false; reasons.push(printable(why, 300)); };
  const open = () => { if (ok !== false) ok = null; };
  // A script generates a check only if every compiler command in it does.
  const record = (key, checks) => {
    const was = generated.get(key) || new Map();
    for (const c of checks) was.set(c.check, was.has(c.check) ? was.get(c.check) && c.ok : c.ok);
    generated.set(key, was);
  };

  for (const inv of declared.invocations) {
    const r = scriptedChecks(inv.compiler, inv.args, { required, forbid: policy.forbid[inv.compiler], pinned });
    record(inv.file, r.checks);
    forbidden += r.forbidden.length;
    for (const why of [...r.checks.filter((c) => c.ok === false).map((c) => c.why), ...r.forbidden]) fail(`${inv.file}:${inv.line}: ${why}`);
  }
  let unknown = 0;
  for (const file of programs) {
    let text;
    try { text = tree.text(file).text; } catch { open(); reasons.push(`${printable(tree.rel(file), 120)} could not be read, so its options are not known`); continue; }
    const cards = optionCards(text);
    const steps = declared.steps.get(memberName(file)) || [];
    const siteOptions = site.compilerOptions || [];
    if (!cards.length && !steps.length && !siteOptions.length) {
      if (!declared.invocations.length) { unknown++; open(); }
      continue;
    }
    const r = enterpriseChecks({ required, site: siteOptions, steps, cards, forbid: policy.forbid.enterprise });
    record(tree.rel(file), r.checks);
    forbidden += r.forbidden.length;
    const failed = r.checks.filter((c) => c.ok === false).map((c) => c.why);
    for (const why of [...failed, ...r.forbidden]) fail(`${tree.rel(file)}: ${why}`);
    if (!failed.length && !r.forbidden.length && r.checks.some((c) => c.ok === null)) { unknown++; open(); }
  }
  if (unknown) reasons.push(`${unknown} program(s) have no option this gate can read for ${required.join(', ')}: no compile step or build script names them; declare the estate's defaults as compilerOptions in cobolwork.site.json`);
  return {
    ok, forbidden, generated, reasons: reasons.slice(0, MAX_PROGRAM_REASONS), add: [],
    compiler: declared.invocations.length ? [...new Set(declared.invocations.map((i) => i.compiler))].sort().join(',') : 'enterprise',
    programs: programs.length, sources: { compilerCommands: declared.invocations.length, compileSteps: [...declared.steps.values()].flat().length },
  };
}

// The checks the base's build generated that the head's no longer does, program by program and
// script by script.
function optionsRemoved(before, after) {
  const removed = [];
  for (const [key, checks] of after.generated) {
    const was = before.generated.get(key);
    if (!was) continue;
    for (const [check, now] of checks) if (was.get(check) === true && now === false) removed.push(`${key}: the ${check} check was generated before the change and is not after it`);
  }
  return removed;
}

// The files a scan of `root`, or of a PDS export's tree, reads, hashed, for the provenance record.
function sourceHashes(root, allow, given = null) {
  const tree = given || directoryTree(root);
  return [...new Set(tree.list())].filter((p) => isSource(p) && (!allow || allow.has(p))).sort()
    .map((p) => ({ path: tree.rel(p), sha256: sha256(tree.bytes(p)) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// A PDS export's members written out as DATA.SET/MEMBER for ironwork, which reads files: the
// programs to check, and each copy library's directory. `fn` gets the layout's root and those.
function withLayout(tree, allow, fn) {
  const root = mkdtempSync(join(tmpdir(), 'cobolwork-pds-layout-'));
  try {
    const programs = [];
    for (const p of tree.list()) {
      const file = join(root, ...tree.rel(p).split('/'));
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, tree.text(p).text, 'latin1');
      if (isProgram(p) && (!allow || allow.has(p))) programs.push(file);
    }
    return fn(root, programs.sort(), tree.index.copyDirs.map((d) => join(root, ...tree.rel(d).split('/'))));
  } finally { rmSync(root, { recursive: true, force: true }); }
}

// ironwork checks the head tree, which in ratchet mode exists only while judge runs, so it runs
// here rather than after the verdict the way a caller's compiler does.
function ironworkCompile(path, { root, tree = null, allow, copylibs, env }) {
  if (tree) return withLayout(tree, allow, (layout, programs, copyDirs) => ironworkChecked(path, { root: layout, programs, copyDirs, copylibs, env }));
  return ironworkChecked(path, { root, allow, copylibs, env });
}

function ironworkChecked(path, { root, allow = null, programs = null, copyDirs = null, copylibs, env }) {
  const result = checkWithIronwork(path, root, { allow, programs, copyDirs, copylibs, env });
  const check = ironworkVerdict(result);
  const libraries = [...(copyDirs || buildFileIndex(root).copyDirs).map((d) => relPath(root, d) || '.'), ...copylibs];
  return {
    check,
    reasons: ironworkReasons(result),
    compiled: {
      tool: 'ironwork', path, version: ironworkVersion(path, { env }),
      argv: ['check', '<program>', ...libraries.flatMap((d) => ['-I', d])],
      status: check === true ? 0 : check === false ? 12 : null,
      ...listed(result),
    },
  };
}

// The members of a PDS export whose files `allow` holds: an archive's members by the archive's file.
function membersAllowed(tree, allow) {
  return new Set(tree.list().filter((p) => allow.has(resolve(tree.dir, tree.origin(p).replace(/\([^)]*\)$/, '')))));
}

function judge({ baseDir, headDir, allow: given, policyRoot, floor, noBaseline, compiler, compilerPath, ironworkPath, env, now, advisoryFeeds, copylibs, equivalenceFiles = [], allowed = null, refs = null, pdsExport = false }) {
  const repoPolicy = treePolicy(policyRoot);
  if (repoPolicy && repoPolicy.problems.length) throw refusal(`the repository policy does not validate: ${repoPolicy.problems.join('; ')}`);
  const { policy, setBy, ignored } = combinePolicies({ floor: floor ? floor.raw : null, repository: repoPolicy ? repoPolicy.raw : null });
  const ratchet = baseDir !== null;
  // A PDS export is judged as its members, each side read as scan --pds-export reads it; the policy,
  // site file and baseline stay files beside the members.
  const trees = pdsExport ? { base: ratchet ? pdsExportTree(baseDir, { systemDirs: copylibs }) : null, head: pdsExportTree(headDir, { systemDirs: copylibs }) } : null;
  const allow = trees && given ? membersAllowed(trees.head, given) : given;
  // In ratchet mode the change is judged by its base's site file, not by one it wrote itself.
  const siteFile = ratchet ? join(baseDir, SITE_FILE) : trees && existsSync(join(headDir, SITE_FILE)) ? join(headDir, SITE_FILE) : null;
  const scanOpts = { ...(siteFile ? { site: siteFile } : {}), ...(advisoryFeeds ? { advisoryFeeds } : {}), systemDirs: copylibs };
  const scanOf = (dir, tree, extra = {}) => (tree ? scanAll(tree.root, { ...scanOpts, ...extra, tree, feedRoot: dir }) : scanAll(dir, { ...scanOpts, ...extra }));
  const before = ratchet ? scanOf(baseDir, trees?.base) : null;
  const after = scanOf(headDir, trees?.head, { allow });
  const introduced = ratchet ? introducedIn(before, after, trees ? trees.base.root : baseDir, trees ? trees.head.root : headDir) : new Set();

  const bounded = boundBaseline(noBaseline ? null : loadBaseline(policyRoot), policy.waivers.maxDays);
  applyBaseline(after, bounded.baseline, { now });
  const expired = after.baselineExpired || [];
  const overlong = bounded.overlong.map((e) => ({ fingerprint: e.fingerprint, rule: e.rule, who: e.who, at: e.at, expires: e.expires }));
  const renewed = new Set([...expired, ...overlong].map((e) => e.fingerprint));

  const findings = after.findings.map((f) => {
    const because = blockingReason(f, { policy, ratchet, introduced, renewed });
    return {
      fingerprint: f.fingerprint, rule: f.rule, tier: tierOf(f), sev: f.sev, classes: classesOf(f).filter((c) => policy.classes.includes(c)),
      path: f.path, line: Number(f.line) || 0, ...(f.exploitability ? { exploitability: f.exploitability.verdict } : {}),
      ...(ratchet ? { introduced: introduced.has(f) } : {}),
      blocking: because !== null, ...(because ? { because } : {}),
    };
  });
  const blocking = findings.filter((f) => f.blocking);
  const waived = (after.suppressed || []).map((f) => ({ fingerprint: f.fingerprint, rule: f.rule, tier: tierOf(f), who: f.suppressed.who, reason: f.suppressed.reason, expires: f.suppressed.expires }));

  const reasons = blocking.map((f) => `${f.rule} (${f.tier}${f.classes.length ? `; ${f.classes.join(', ')}` : ''}) at ${where(f)}${f.introduced ? ', introduced by the change' : ''}: ${ruleText(f.rule)}`);
  for (const e of overlong) reasons.push(`the waiver for ${e.rule} (${e.fingerprint}) runs past the policy's ${policy.waivers.maxDays} days, so it covers nothing`);

  const incomplete = !!(after.summary.coverageIncomplete || (before && before.summary.coverageIncomplete));
  if (incomplete) {
    const sets = [...new Set([...(after.summary.setsIncomplete || []), ...((before && before.summary.setsIncomplete) || [])].map((s) => `${s.set} (${s.kind})`))].sort();
    reasons.push(`coverage is incomplete${sets.length ? ` in ${sets.join(', ')}` : ''}${policy.coverage === 'block' ? ', and the policy says block, so what was not read cannot be told from what is clean' : '; the policy says warn'}`);
  }
  const site = loadSite(policyRoot);
  const options = optionsCheck({ root: headDir, tree: trees?.head, allow, site, policy, compiler });
  reasons.push(...options.reasons);
  // A missing run-time check is a weaker build, not a defect: warn passes it relaxed. What the
  // policy forbids by name, and a check the change itself removed, still fail.
  const removed = ratchet && !compiler ? optionsRemoved(optionsCheck({ root: baseDir, tree: trees?.base, allow: null, site, policy, compiler }), options) : [];
  reasons.push(...removed.slice(0, MAX_PROGRAM_REASONS));
  const optionsChanged = ratchet ? programOptionChanges(baseDir, headDir, allow, trees) : [];
  for (const c of optionsChanged.slice(0, MAX_PROGRAM_REASONS)) reasons.push(`${c.path}:${c.line} changes ${c.option} from ${c.base} to ${c.head}, which changes what the program's statements do without changing a statement`);
  const wantsEquivalence = ratchet && (equivalenceFiles.length || policy.requireEquivalence !== 'never');
  const equivalence = wantsEquivalence && !trees
    ? checkEquivalence({ baseDir, headDir, allow, files: equivalenceFiles, allowed, mode: policy.requireEquivalence, ...(refs || {}), systemDirs: copylibs, env })
    : wantsEquivalence ? { problems: [], required: null, programs: [], mode: policy.requireEquivalence, notRun: 'equivalence is not run over a PDS export' } : null;
  if (equivalence) {
    reasons.push(...equivalence.problems);
    if (equivalence.notRun) reasons.push(`${equivalence.notRun}, and the policy or --equivalence asks for it`);
    else if (equivalence.required === null) reasons.push('the policy requires equivalence for machine-authored changes, and whether this one is could not be read from the commits');
    if (equivalence.required) for (const p of equivalence.programs.filter((x) => !x.ok).slice(0, MAX_PROGRAM_REASONS)) reasons.push(`${p.path}: ${p.because}, and the policy requires equivalence${equivalence.mode === 'machineAuthored' ? ' for a machine-authored change' : ''}`);
  }
  const relaxOptions = policy.options === 'warn' && options.ok !== true && !options.forbidden && !removed.length;
  if (relaxOptions) reasons.push(options.ok === null ? 'the options of some programs are unknown, and the policy says warn' : 'some programs are built without a check the policy names, and the policy says warn');

  const checks = {
    findings: blocking.length === 0,
    coverage: incomplete && policy.coverage === 'block' ? null : true,
    options: options.forbidden || removed.length ? false : relaxOptions ? true : options.ok,
    compile: null,
    ...(equivalence ? { equivalence: equivalence.problems.length ? false : equivalence.required === null ? null : equivalence.required ? equivalence.programs.every((p) => p.ok) : true } : {}),
  };
  const relaxed = [...(incomplete && policy.coverage === 'warn' ? ['coverage'] : []), ...(relaxOptions ? ['options'] : [])];
  const decided = [checks.findings, checks.coverage, checks.options, ...('equivalence' in checks ? [checks.equivalence] : [])];
  const verdict = decided.includes(false) ? 'fail' : decided.includes(null) ? 'undecided' : 'pass';
  let compiled = null;
  if (ironworkPath && verdict === 'pass') {
    const iw = ironworkCompile(ironworkPath, { root: headDir, tree: trees?.head, allow, copylibs, env });
    compiled = iw.compiled;
    checks.compile = iw.check;
    reasons.push(...iw.reasons);
    if (iw.check === null && policy.coverage === 'warn') relaxed.push('compile');
  }

  const configurationChanged = ratchet ? [
    ...configurationChanges(baseDir, headDir).map((c) => c.file),
    ...(policyChanged(baseDir, headDir) ? [POLICY_FILE] : []),
  ] : [];

  const byTier = Object.fromEntries(TIERS.map((t) => [t, 0]));
  for (const f of findings) byTier[f.tier]++;
  const doc = {
    tool: 'cobolwork-build',
    schemaVersion: BUILD_SCHEMA_VERSION,
    verdict,
    relaxed,
    mode: ratchet ? 'ratchet' : 'absolute',
    checks,
    blocking,
    findings,
    waived,
    expired: expired.map((e) => ({ fingerprint: e.fingerprint, rule: e.rule, who: e.who, expired: e.expired })),
    overlong,
    optionsAdded: options.add,
    optionsChanged,
    ...(equivalence ? { equivalence } : {}),
    configurationChanged,
    policy: { sha256: policyHash(policy), setBy, ignored, applied: policy },
    compiled,
    reasons: reasons.slice(0, MAX_REASONS).map((x) => printable(x, 400)),
    ...(reasons.length > MAX_REASONS ? { reasonsNotShown: reasons.length - MAX_REASONS } : {}),
    repositoryText: ['blocking[].path', 'findings[].path', 'waived[].who', 'waived[].reason', 'expired[].who', 'overlong[].who', 'reasons',
      ...(compiled ? ['compiled.failed[]', 'compiled.notModelled[]', 'compiled.unresolved[]', 'compiled.unrun[]'] : [])],
    summary: {
      flowModel: FLOW_MODEL,
      toolVersion: TOOL_VERSION,
      findings: findings.length,
      blocking: blocking.length,
      waived: waived.length,
      byTier,
      coverageIncomplete: incomplete,
      ...(after.summary.baseline && after.summary.baseline.problems ? { baselineProblems: after.summary.baseline.problems } : {}),
      ...(trees ? { pdsExport: { ...(trees.base ? { base: trees.base.export } : {}), head: trees.head.export } } : {}),
    },
  };
  const hashes = sourceHashes(headDir, allow, trees?.head);
  return { doc, report: after, policy, setBy, hashes, add: options.add, compilerPath };
}

// The watched options in force changed by the change, per program present on both sides.
function programOptionChanges(baseDir, headDir, allow, trees = null) {
  const out = [];
  const headTree = trees ? trees.head : directoryTree(headDir);
  const baseTree = trees ? trees.base : directoryTree(baseDir);
  const files = headTree.list().filter((p) => isProgram(p) && (!allow || allow.has(p))).sort();
  for (const head of files) {
    const path = headTree.rel(head);
    const base = resolve(baseTree.root, ...path.split('/'));
    if (!(trees ? baseTree.contains(base) : existsSync(base))) continue;
    let before;
    let after;
    try { before = baseTree.text(base).text; after = headTree.text(head).text; } catch { continue; }
    for (const c of optionChanges(before, after)) out.push({ path, ...c });
  }
  return out;
}

function policyChanged(baseDir, headDir) {
  const bytes = (root) => { const p = join(root, POLICY_FILE); return existsSync(p) ? readFileSync(p) : null; };
  const was = bytes(baseDir);
  const now = bytes(headDir);
  return !(was === null && now === null) && !(was && now && was.equals(now));
}

// Runs the gate over `repo`. `compiler` is the argument vector after `--`, or null. Returns
// { doc, report, provenance, exit }; throws with code EBUILD when it could not run.
export function build(repo, { base = null, head = null, policy = null, noBaseline = false, compiler = null, ironwork = null, advisoryFeeds = null, copylibs = [], equivalence = [], allowed: given = null, allowedSigners = null, now = new Date().toISOString(), env = process.env, pdsExport = false, precompile = false } = {}) {
  const floor = policy ? floorPolicy(policy, repo) : null;
  if (floor && floor.problems.length) throw refusal(floor.problems.join('; '));
  let allowed = given;
  if (allowedSigners) {
    const path = resolve(allowedSigners);
    if (resolvesInside(repo, path)) throw refusal(`--allowed-signers ${path} is inside the repository; signers the change can edit vouch for nothing`);
    allowed = parseAllowedSigners(readFileSync(path, 'utf8'));
  }
  if (compiler && ironwork) throw refusal('one compiler per build: -- names one and --ironwork another');
  if (precompile && !compiler) throw refusal('--precompile translates the programs a compiler command names, so it needs -- and the compiler');
  if (precompile && !compilerOf(compiler[0])) throw refusal(`--precompile checks a translation with cobc or gcobol -fsyntax-only; for ${printable(compiler[0], 60)} it cannot`);
  if (pdsExport && compiler) throw refusal('a PDS export is checked with --ironwork; the compiler after -- reads the files of a repository, not the members of an export');
  let compilerPath = null;
  if (compiler) {
    if (!compiler.length) throw refusal('nothing follows --, so there is no compiler to run');
    const found = findExecutable(compiler[0], { repo, env });
    if (!found.path) throw refusal(`the compiler: ${found.why}`);
    compilerPath = found.path;
  }
  let ironworkPath = null;
  if (ironwork) {
    const found = findExecutable(ironwork, { repo, env });
    if (!found.path) throw refusal(`--ironwork: ${found.why}`);
    ironworkPath = found.path;
  }
  const run = (baseDir, headDir, allow, policyRoot) => judge({ baseDir, headDir, allow, policyRoot, floor, noBaseline, compiler, compilerPath, ironworkPath, env, now, advisoryFeeds, copylibs, equivalenceFiles: equivalence, allowed, refs: base ? { repo, base, head: head || 'HEAD' } : null, pdsExport });
  const judged = base
    ? withRefs(repo, base, head, {}, (baseDir, headDir, scoped) => {
      const r = run(baseDir, headDir, scoped.allow || null, baseDir);
      r.doc.summary.base = base;
      r.doc.summary.head = head || WORKING_TREE;
      return r;
    })
    : run(null, repo, null, repo);

  const { doc } = judged;
  let exit = BUILD_EXIT[doc.verdict];
  // A program ironwork could not decide leaves the build undecided, as unread source does, unless the
  // policy says warn for coverage; judge has then marked compile relaxed.
  if (ironwork && doc.verdict === 'pass') {
    if (doc.checks.compile === false) exit = BUILD_EXIT.compilerFailed;
    else if (doc.checks.compile === null && !doc.relaxed.includes('compile')) exit = BUILD_EXIT.undecided;
  }
  // A program the compiler refuses once its EXEC SQL and CICS are translated stops the build before
  // the caller's compiler runs, as a fail stops it.
  if (precompile && doc.verdict === 'pass') {
    const checked = precompileCheck({ compilerPath, argv: compiler.slice(1), repo, copylibs, env });
    doc.precompiled = checked;
    const refused = checked.programs.filter((p) => !p.ok);
    doc.checks.precompile = refused.length === 0;
    if (refused.length) {
      exit = BUILD_EXIT.compilerFailed;
      doc.reasons.push(`${refused.length} of ${checked.programs.length} program(s) holding EXEC SQL or CICS do not compile once precompiled`);
      for (const p of refused.slice(0, MAX_PROGRAM_REASONS)) doc.reasons.push(`${p.path}: ${(p.errors || [])[0] || 'the compiler exited non-zero'}`);
    }
  }
  if (compiler && doc.verdict === 'pass' && doc.checks.precompile !== false) {
    const argv = [...compiler.slice(1), ...judged.add];
    // The compiler's own output goes to standard error: standard output carries the document.
    const r = spawnSync(compilerPath, argv, { stdio: ['ignore', 2, 2], env, windowsHide: true });
    const status = r.error ? null : r.status;
    doc.compiled = { path: compilerPath, argv, status, ...(r.error ? { error: printable(r.error.message, 200) } : {}), ...(r.signal ? { signal: r.signal } : {}) };
    doc.checks.compile = status === 0;
    if (status !== 0) {
      exit = BUILD_EXIT.compilerFailed;
      doc.reasons.push(printable(`the compiler exited ${status === null ? `without a status${r.signal ? ` (${r.signal})` : ''}` : status}`, 400));
    }
  }
  return { doc, report: judged.report, provenance: provenanceRecord(judged, { base, head, env, copylibs }), exit };
}

function provenanceRecord({ doc, policy, setBy, hashes }, { base, head, env, copylibs }) {
  const epoch = env.SOURCE_DATE_EPOCH;
  const builtAt = epoch && /^\d+$/.test(epoch) ? new Date(Number(epoch) * 1000).toISOString() : null;
  let compiler = null;
  if (doc.compiled) {
    let digest = null;
    try { digest = sha256(readFileSync(doc.compiled.path)); } catch { /* unreadable binary: recorded as null */ }
    compiler = { path: doc.compiled.path, sha256: digest, argv: doc.compiled.argv, status: doc.compiled.status };
    if (doc.compiled.tool === 'ironwork') Object.assign(compiler, { tool: 'ironwork', version: doc.compiled.version, programs: doc.compiled.programs, counts: doc.compiled.counts });
  }
  return {
    tool: 'cobolwork-build-provenance',
    schemaVersion: BUILD_SCHEMA_VERSION,
    toolVersion: TOOL_VERSION,
    flowModel: FLOW_MODEL,
    ...(builtAt ? { builtAt } : {}),
    revisions: { base: base || null, head: base ? head || WORKING_TREE : WORKING_TREE },
    policy: { canonical: canonical(policy), sha256: policyHash(policy), setBy },
    sources: hashes,
    ...(copylibs.length ? { copylibs } : {}),
    waivers: doc.waived.map((w) => ({ fingerprint: w.fingerprint, rule: w.rule, who: w.who, reason: w.reason, expires: w.expires })),
    compiler,
    verdict: doc.verdict,
    relaxed: doc.relaxed,
  };
}

// One line for a CI log: the verdict, what blocked it, and what is advisory. INFO is context and
// coverage, which assert no defect, so it is counted in the document and not here.
export function buildSummaryLine(doc) {
  const count = (list) => {
    const by = {};
    for (const f of list) by[f.tier] = (by[f.tier] || 0) + 1;
    return [...TIERS].reverse().filter((t) => by[t]).map((t) => `${by[t]} ${t.toUpperCase()}`).join(', ');
  };
  const advisory = doc.findings.filter((f) => !f.blocking && f.tier !== 'info');
  const relaxed = doc.relaxed && doc.relaxed.length ? doc.relaxed.join(', ') : '';
  const parts = [`cobolwork build: ${doc.verdict}${relaxed && doc.verdict === 'pass' ? ` (relaxed: ${relaxed})` : ''}`];
  if (relaxed && doc.verdict !== 'pass') parts.push(`relaxed: ${relaxed}`);
  if (doc.blocking.length) parts.push(`blocking ${count(doc.blocking)}`);
  if (advisory.length) parts.push(`advisory ${count(advisory)}`);
  if (doc.checks.coverage === null) parts.push('coverage incomplete');
  if (doc.checks.options !== true) parts.push(`options ${doc.checks.options === false ? 'refused' : 'unknown'}`);
  if (doc.compiled && doc.compiled.tool === 'ironwork') {
    const c = doc.compiled.counts;
    if (c.failed) parts.push(`ironwork: ${c.failed} of ${doc.compiled.programs} programs do not compile`);
    const open = c.notModelled + c.unresolved + c.unrun;
    if (open) parts.push(`ironwork: ${open} program${open === 1 ? '' : 's'} not decided`);
  } else if (doc.compiled && doc.compiled.status !== 0) parts.push(`compiler exited ${doc.compiled.status}`);
  return parts.join('; ');
}

// The scan's SARIF, with a blocking finding at error and every other one no higher than warning.
export function buildSarif(sarif, doc) {
  const blocking = new Set(doc.blocking.map((f) => f.fingerprint));
  const byPrint = new Map(doc.findings.map((f) => [f.fingerprint, f]));
  for (const run of sarif.runs || []) {
    for (const r of run.results || []) {
      const fp = r.fingerprints && Object.values(r.fingerprints)[0];
      const f = byPrint.get(fp);
      if (blocking.has(fp)) r.level = 'error';
      else if (r.level === 'error') r.level = 'warning';
      if (f) r.properties = { ...(r.properties || {}), tier: f.tier, classes: f.classes, blocking: f.blocking };
    }
    run.invocations = (run.invocations || []).map((inv) => ({ ...inv, properties: { ...(inv.properties || {}), 'cobolwork/build': { verdict: doc.verdict, relaxed: doc.relaxed, checks: doc.checks, policy: doc.policy.sha256 } } }));
  }
  return sarif;
}
