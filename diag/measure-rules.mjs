// Runs the rule sets over a corpus one repository at a time and reports prevalence, so a single
// generated repository cannot stand in for the population. Findings are candidates until read.
//   node diag/measure-rules.mjs <corpus-root> [--out file] [--generated <substring>] [--packs a,b]
//                                [--skip a,b] [--exclude-paths a,b] [--max-source-bytes n]
//                                [--only a,b] [--list <rule>] [--baseline <an earlier --out file>]
//
// --packs force-loads vendor packs for measurement, bypassing the validation gate: measuring is
// how a pack becomes validated, so refusing to measure an unvalidated one would be circular. The
// per-pack-rule counts are what fills `validation.corpus` in the pack file. A rule that fires on
// a large share of repositories is over-broad, whatever its rationale says.
//
// --only runs the named rule sets and no others, so one set can be measured without paying for
// the rest. --out records, beside the counts, whether each set read each repository completely
// and every finding by its fingerprint. --baseline compares this run with an earlier --out file,
// rule by rule, over the repositories both runs read completely. --list prints every finding of
// one rule with its trace, once per file content.
import { readdirSync, readFileSync, existsSync, openSync, readSync, writeSync, closeSync, renameSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { REGISTRY, RULE_SETS } from '../lib/kernel/registry.mjs';
import { directoryTree } from '../lib/kernel/source-tree.mjs';
import { byText } from '../lib/kernel/findings.mjs';
import { stampFingerprints, FINGERPRINT_VERSION } from '../lib/kernel/identity.mjs';
import { stoppedBecause } from '../lib/kernel/memory.mjs';
import { FLOW_MODEL, TOOL_VERSION } from '../lib/version.mjs';

const fail = (why) => { process.stderr.write(`measure-rules: ${why}\n`); process.exit(2); };

// Calls fn with each line of a file, holding one megabyte of it at a time. Returning false stops.
function eachLine(path, fn) {
  const fd = openSync(path, 'r');
  const buf = Buffer.alloc(1 << 20);
  const utf8 = new StringDecoder('utf8');
  let rest = '';
  try {
    for (let n; (n = readSync(fd, buf, 0, buf.length, null)) > 0;) {
      const lines = (rest + utf8.write(buf.subarray(0, n))).split('\n');
      rest = lines.pop();
      for (const l of lines) if (fn(l.replace(/\r$/, '')) === false) return;
    }
    rest += utf8.end();
    if (rest) fn(rest.replace(/\r$/, ''));
  } finally { closeSync(fd); }
}

function lineWriter(path) {
  const fd = openSync(path, 'w');
  let held = [];
  let bytes = 0;
  const flush = () => { if (held.length) writeSync(fd, `${held.join('\n')}\n`); held = []; bytes = 0; };
  return {
    put(line) { held.push(line); bytes += line.length; if (bytes > 1 << 20) flush(); },
    close() { flush(); closeSync(fd); },
  };
}

// An --out file is one JSON document with its findings last, one to a line, so an earlier run can
// be read back a finding at a time: a corpus run records hundreds of thousands of them.
const FINDINGS_OPEN = ' "findings": [';
const FINDINGS_CLOSE = ' ]';

function writeRun(path, head, foundPath) {
  const partial = `${path}.partial`;
  const w = lineWriter(partial);
  w.put(`${JSON.stringify(head, null, 1).slice(0, -2)},`);
  w.put(FINDINGS_OPEN);
  let prev = null;
  eachLine(foundPath, (l) => { if (!l) return; if (prev !== null) w.put(`${prev},`); prev = l; });
  if (prev !== null) w.put(prev);
  w.put(FINDINGS_CLOSE);
  w.put('}');
  w.close();
  renameSync(partial, path);
}

function readHeader(path) {
  if (!existsSync(path)) fail(`--baseline: ${path} does not exist`);
  const lines = [];
  let found = false;
  eachLine(path, (l) => { if (l === FINDINGS_OPEN) { found = true; return false; } lines.push(l); });
  if (!found) fail(`--baseline: ${path} records no findings, so there is nothing to compare by fingerprint; it predates --baseline or was not written by this script`);
  let head;
  try { head = JSON.parse(`${lines.join('\n').replace(/,\s*$/, '')}\n}`); } catch (e) { fail(`--baseline: ${path} is not an --out file of this script: ${e.message}`); }
  if (head.engine?.fingerprint !== FINGERPRINT_VERSION) {
    fail(`--baseline: ${path} identifies findings by ${head.engine?.fingerprint || 'nothing'} and this run by ${FINGERPRINT_VERSION}, so the two cannot be compared`);
  }
  if (!head.repos || !head.settings) fail(`--baseline: ${path} does not say which repositories it read completely`);
  return head;
}

function eachRecorded(path, fn) {
  let inside = false;
  eachLine(path, (l) => {
    if (!inside) inside = l === FINDINGS_OPEN;
    else if (l === FINDINGS_CLOSE) return false;
    else if (l) fn(JSON.parse(l.endsWith(',') ? l.slice(0, -1) : l));
    return true;
  });
}

const args = process.argv.slice(2);
const VALUED = ['--out', '--generated', '--packs', '--skip', '--exclude-paths', '--max-source-bytes', '--only', '--list', '--baseline'];
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const optList = (name) => (opt(name) || '').split(',').map(x => x.trim()).filter(Boolean);
const ROOT = args.find((a, i) => !a.startsWith('--') && !VALUED.includes(args[i - 1]));
if (!ROOT || !existsSync(ROOT)) fail('usage: node diag/measure-rules.mjs <corpus-root> [options]; the options are listed at the top of the script');
const OUT = opt('--out');
const GENERATED = opt('--generated');
const PACKS = optList('--packs');
// The flow engine builds a node graph per program, so one very large repository can exhaust the
// heap and take the whole run with it. The engine already has a budget for this; a corpus run is
// exactly the caller that needs to set it. Files past it are counted as unread, never dropped.
const MAX_SRC = args.includes('--max-source-bytes') ? Number(opt('--max-source-bytes')) : 64 * 1024 * 1024;
// Repositories to leave out entirely, by substring. --generated puts them in their own stratum,
// which is the right answer when you want their numbers separately; this is for when you do not
// want to spend the run computing them at all. Skipped repositories are named in the output, so a
// corpus that was not fully read never reads as one that was.
// Paths that are not code anybody runs. A repository holding the NIST conformance suite fires
// SET ADDRESS OF thousands of times because that is what those files are for, and counting them
// measures conformance suites rather than COBOL. Repository-level --skip cannot reach these:
// they sit inside otherwise ordinary repositories.
//
// Measured on this corpus: excluding these drops opaque-pointer-addressing by most of what is
// left once the generated volume repository is out, and moves almost nothing else.
const EXCLUDE_PATHS = optList('--exclude-paths');
const SKIP = optList('--skip');
// A misspelled set would run nothing and report a clean zero.
const ONLY = args.includes('--only') ? optList('--only') : null;
if (ONLY && (!ONLY.length || ONLY.some(s => !RULE_SETS.includes(s)))) fail(`--only takes ${RULE_SETS.join(',')}; got ${opt('--only') || 'nothing'}`);
// Every registered set unless --only says otherwise, so one added to lib/kernel/registry.mjs is
// measured without anyone remembering to add it here. This tool hand-listed eight and went on
// measuring eight after the ninth shipped - a rule set nobody measures is a rule set whose
// prevalence nobody knows, which is the one thing this file exists to report.
//
// The vendor set only runs when packs were named, and force-loads them past the validation gate,
// because measuring is how a pack becomes validated and refusing to measure an unvalidated one
// would be circular.
const SETS = REGISTRY.filter(s => (!ONLY || ONLY.includes(s.name)) && (s.name !== 'vendor' || PACKS.length));
if (!SETS.length) fail('nothing to run: the vendor set runs only when --packs names a pack');
const LIST = opt('--list');
const listedBy = LIST && REGISTRY.find(s => Object.hasOwn(s.rules, LIST));
if (LIST && !listedBy) fail(`--list: no rule set declares ${LIST}`);
if (LIST && !SETS.includes(listedBy)) fail(`--list: ${LIST} belongs to the ${listedBy.name} set, which this run does not run`);
const BASELINE = opt('--baseline');
// Both checked before the scan, so a wrong path costs nothing rather than a corpus run.
if (OUT && !existsSync(dirname(resolve(OUT)))) fail(`--out: ${dirname(resolve(OUT))} does not exist`);
const earlier = BASELINE ? readHeader(BASELINE) : null;

const flowOpts = { maxSourceBytes: MAX_SRC };
const repos = readdirSync(ROOT, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name).sort();

const strata = {};
const stratumOf = (repo) => (GENERATED && repo.includes(GENERATED) ? 'generated' : 'real');

// A finding in a file some other repository also holds, byte for byte, is one finding seen twice.
// A skip list cannot reach that: one AWS sample program is in 12 of 126 corpus repositories, and
// one generated directory holds 300 of a rule's 340 findings. Counting by content catches copies
// whatever they are called; the top-repository share catches concentration that is not a copy.
const contentKey = new Map();
function keyOf(root, path) {
  const abs = join(root, path);
  let k = contentKey.get(abs);
  if (k === undefined) {
    try { k = createHash('sha1').update(readFileSync(abs)).digest('hex'); } catch { k = `unread:${abs}`; }
    contentKey.set(abs, k);
  }
  return k;
}

// Why a set did not read a repository completely, in the set's own words. Findings over part of a
// repository differ between two runs for that reason before any other.
function shortfall(s) {
  if (!s.coverageIncomplete) return null;
  const notReached = s.filesNotReached || s.filesNotRead || 0;
  const why = [
    s.stoppedBy && `${notReached ? `${notReached} file(s) not reached: ` : ''}${stoppedBecause(s.stoppedBy)}`,
    !s.stoppedBy && notReached && `${notReached} file(s) not reached`,
    s.filesOverBudget && `${s.filesOverBudget} file(s) past the source budget`,
    s.unreadable?.length && `${s.unreadable.length} file(s) unreadable, the first ${s.unreadable[0]}`,
    s.unparsed?.length && `${s.unparsed.length} file(s) did not parse, the first ${s.unparsed[0]}`,
    s.readInPart,
    s.programsUnread?.length && `${s.programsUnread.length} program(s) could not be read`,
  ].filter(Boolean);
  return {
    ...(s.stoppedBy ? { stoppedBy: s.stoppedBy } : {}),
    ...(notReached ? { filesNotReached: notReached } : {}),
    ...(s.filesOverBudget ? { filesOverBudget: s.filesOverBudget } : {}),
    ...(s.unreadable?.length ? { unreadable: s.unreadable.length } : {}),
    why: why.join('; ') || 'the set says its coverage is incomplete',
  };
}

const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// A trace's two ends are where the value came from and what it reached; the middle is what makes
// one long.
function ends(trace, hops = trace.length) {
  const hop = ({ program, item, file, via }) => ({ program, item, file, via });
  if (trace.length <= 2) return trace.map(hop);
  return [hop(trace[0]), { elided: hops - 2 }, hop(trace[trace.length - 1])];
}

// Findings are kept only when something reads them back, and on disk: the memory guard measures
// this process, so findings held in it would stop scans that would otherwise finish, and two runs
// compared would differ by that.
const scratch = OUT || BASELINE || LIST ? mkdtempSync(join(tmpdir(), 'measure-rules-')) : null;
const FOUND = scratch && join(scratch, 'findings.jsonl');
const found = FOUND && lineWriter(FOUND);
if (scratch) {
  process.on('exit', () => rmSync(scratch, { recursive: true, force: true }));
  process.once('SIGINT', () => process.exit(130));
}
const eachFound = (fn) => eachLine(FOUND, (l) => { if (l) fn(JSON.parse(l)); });

function keep(set, repo, root, findings) {
  // stampFingerprints holds every file it reads until it returns, so it is given one at a time.
  const byPath = new Map();
  for (const f of findings) {
    const k = f.path || '';
    if (!byPath.has(k)) byPath.set(k, []);
    byPath.get(k).push(f);
  }
  for (const group of byPath.values()) stampFingerprints(group, { root });
  for (const f of findings) {
    found.put(JSON.stringify({
      set, rule: f.rule, repo, fingerprint: f.fingerprint, path: f.path ?? null, line: f.line ?? null,
      content: f.path ? keyOf(root, f.path) : null, sev: f.sev ?? null, detail: clip(f.detail, 400),
      ...(f.guard ? { guard: `${f.guard.file}:${f.guard.line}` } : {}),
      ...(f.trace?.length ? { trace: ends(f.trace, f.hops) } : {}),
    }));
  }
}

const started = Date.now();

// A value that names a repository skips that one alone; any other is a substring, as --skip volume
// is. Matching every value as a substring skipped Karpa78_MortgageSample2 along with
// Karpa78_Mortgage, and a corpus of 3,184 repositories has 32 names that contain another.
const repoNames = new Set(repos);
const skipped = repos.filter(r => SKIP.some(k => (repoNames.has(k) ? r === k : r.includes(k))));
const toScan = repos.filter(r => !skipped.includes(r));
if (skipped.length) process.stderr.write(`skipping ${skipped.length}: ${skipped.join(', ')}
`);

const readRepos = {};
let seen = 0;
for (const repo of toScan) {
  const root = join(ROOT, repo);
  seen++;
  process.stderr.write(`[${String(seen).padStart(4)}/${toScan.length}] ${repo}
`);
  const s = (strata[stratumOf(repo)] ||= { repos: 0, reposComplete: 0, reposWithFindings: new Set(), byRule: {}, reposByRule: {}, distinctByRule: {}, byRuleRepo: {}, filesScanned: 0, cicsPrograms: 0, commareaRead: 0, flowFindings: 0, crossProgram: 0, examples: {}, byPackRule: {}, reposByPackRule: {}, reposWithJcl: new Set(), filesOverBudget: 0, secs: 0 });
  s.repos++;
  const t0 = Date.now();
  // One tree per repository rather than one per set: the sets all read the same directory, and
  // walking it nine times was nine resolutions of every symlink in it.
  const tree = directoryTree(root);
  const parts = {};
  const short = {};
  for (const set of SETS) {
    // The recon rules read the repository's own site file if it has one; over a public corpus there
    // is none, so only the address rule can fire. That is stated rather than looking like a result.
    const deny = EXCLUDE_PATHS.length ? { deny: EXCLUDE_PATHS } : {};
    const setOpts = set.name === 'flow' ? { ...flowOpts, tree, ...deny }
      : set.name === 'vendor' ? { packs: PACKS, allowUnvalidatedPacks: true, tree, ...deny }
        : { tree, ...deny };
    try {
      parts[set.name] = set.scan(root, setOpts);
    } catch (e) {
      const k = `error:${set.name}:${e.code || e.name}`;
      s.byRule[k] = (s.byRule[k] || 0) + 1;
      short[set.name] = { threw: e.code || e.name, why: `the set threw ${e.code || e.name}` };
    }
  }
  for (const [name, r] of Object.entries(parts)) {
    const why = shortfall(r.summary);
    if (why) short[name] = why;
  }
  const complete = !Object.keys(short).length;
  readRepos[repo] = { stratum: stratumOf(repo), complete, ...(complete ? {} : { short }) };
  if (complete) s.reposComplete++;
  const { cics, flow, jcl } = parts;
  s.secs += (Date.now() - t0) / 1000;
  const took = (Date.now() - t0) / 1000;
  if (took > 20) process.stderr.write(`        ^ took ${took.toFixed(0)}s
`);
  if (flow && flow.summary.filesOverBudget) process.stderr.write(`        ^ ${flow.summary.filesOverBudget} files past the source budget, counted as unread
`);
  if (!complete) process.stderr.write(`        ^ read in part: ${Object.entries(short).map(([k, v]) => `${k}: ${v.why}`).join('; ')}
`);
  for (const [name, r] of Object.entries(parts)) {
    // The copybook set counts copybooks and programs both, so adding its total to the others
    // would count the same file twice.
    if (name !== 'copybook') s.filesScanned += r.summary.filesScanned || 0;
    for (const f of r.findings) {
      s.byRule[f.rule] = (s.byRule[f.rule] || 0) + 1;
      (s.reposByRule[f.rule] ||= new Set()).add(repo);
      (s.distinctByRule[f.rule] ||= new Set()).add(f.path ? `${keyOf(root, f.path)}:${f.line}` : `${repo}:${f.line}`);
      const perRepo = (s.byRuleRepo[f.rule] ||= {});
      perRepo[repo] = (perRepo[repo] || 0) + 1;
      s.reposWithFindings.add(repo);
      const ex = (s.examples[f.rule] ||= []);
      if (ex.length < 5) ex.push({ repo, path: f.path, line: f.line, detail: (f.detail || '').slice(0, 160) });
      // A vendor finding is attributed to the pack rule that made it, which is the granularity a
      // pack's corpus validation needs: "this pack is quiet" is not a claim about each of its rules.
      if (f.packRule) {
        const k = `${f.pack}:${f.packRule}`;
        s.byPackRule[k] = (s.byPackRule[k] || 0) + 1;
        (s.reposByPackRule[k] ||= new Set()).add(repo);
      }
    }
    if (found) keep(name, repo, root, r.findings);
  }
  if (cics) { s.cicsPrograms += cics.summary.cicsPrograms; s.commareaRead += cics.summary.commareaRead; }
  if (flow) { s.flowFindings += flow.summary.findings; s.crossProgram += flow.summary.crossProgram; }
  if (jcl && jcl.summary.filesScanned > 0) s.reposWithJcl.add(repo);
  if (flow) s.filesOverBudget += flow.summary.filesOverBudget || 0;
}
if (found) found.close();

const settings = { ruleSets: SETS.map(set => set.name), packs: PACKS, maxSourceBytes: MAX_SRC, excludedPaths: EXCLUDE_PATHS };

// Rule by rule, the findings one run has and the other does not, counted only in repositories both
// runs read completely with the set that reports the rule. A finding is known by its repository and
// fingerprint, so code moving within a file is not a change; a fingerprint two findings share
// counts twice, as lib/diff.mjs counts it.
function compare(head, path) {
  const then = head.settings.ruleSets || [];
  const now = settings.ruleSets;
  const notCompared = [
    ...now.filter(n => !then.includes(n)).map(n => `${n}: ran in this run only`),
    ...then.filter(n => !now.includes(n)).map(n => `${n}: ran in the earlier run only`),
  ];
  const settingsDiffer = {};
  for (const k of ['packs', 'maxSourceBytes', 'excludedPaths']) {
    if (JSON.stringify(head.settings[k]) !== JSON.stringify(settings[k])) settingsDiffer[k] = { earlier: head.settings[k], now: settings[k] };
  }
  const names = [...new Set([...Object.keys(head.repos), ...Object.keys(readRepos)])].sort();
  const sets = {};
  const inScope = new Set();
  for (const set of now.filter(n => then.includes(n))) {
    const excluded = {};
    let compared = 0;
    for (const repo of names) {
      const a = head.repos[repo];
      const b = readRepos[repo];
      const why = [
        !a && 'not in the earlier run',
        !b && 'not in this run',
        a?.short?.[set] && `earlier run: ${a.short[set].why}`,
        b?.short?.[set] && `this run: ${b.short[set].why}`,
      ].filter(Boolean);
      if (why.length) excluded[repo] = why.join('; ');
      else { compared++; inScope.add(`${set}\u0000${repo}`); }
    }
    sets[set] = { compared, excluded };
  }
  const count = (m, f) => {
    if (!inScope.has(`${f.set}\u0000${f.repo}`)) return;
    let r = m.get(f.rule);
    if (!r) m.set(f.rule, (r = new Map()));
    const k = `${f.repo}\u0000${f.fingerprint}`;
    r.set(k, (r.get(k) || 0) + 1);
  };
  const before = new Map();
  const after = new Map();
  eachRecorded(path, (f) => count(before, f));
  eachFound((f) => count(after, f));
  const byRule = {};
  const owed = { added: new Map(), removed: new Map() };
  for (const rule of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const b = before.get(rule) || new Map();
    const a = after.get(rule) || new Map();
    const r = (byRule[rule] = { before: 0, after: 0 });
    for (const [k, n] of b) { r.before += n; if (n > (a.get(k) || 0)) owed.removed.set(`${rule}\u0000${k}`, n - (a.get(k) || 0)); }
    for (const [k, n] of a) { r.after += n; if (n > (b.get(k) || 0)) owed.added.set(`${rule}\u0000${k}`, n - (b.get(k) || 0)); }
  }
  // A second pass for the findings behind each difference, so only those are held.
  const collect = (which) => (f) => {
    const k = `${f.rule}\u0000${f.repo}\u0000${f.fingerprint}`;
    const n = owed[which].get(k);
    if (!n) return;
    owed[which].set(k, n - 1);
    (byRule[f.rule][which] ||= []).push({ repo: f.repo, fingerprint: f.fingerprint, path: f.path, line: f.line, detail: clip(f.detail, 200) });
  };
  eachRecorded(path, collect('removed'));
  eachFound(collect('added'));
  return {
    file: path, engine: head.engine,
    ...(Object.keys(settingsDiffer).length ? { settingsDiffer } : {}),
    ...(notCompared.length ? { notCompared } : {}),
    sets, byRule,
  };
}
const comparison = earlier ? compare(earlier, BASELINE) : null;

const out = {
  root: ROOT, secs: Math.round((Date.now() - started) / 1000), skipped, settings,
  // Two runs can be compared only if they know a finding by the same identity.
  engine: { toolVersion: TOOL_VERSION, flowModel: FLOW_MODEL, fingerprint: FINGERPRINT_VERSION },
  repos: readRepos,
  ...(comparison ? { baseline: comparison } : {}),
  strata: {},
};
for (const [k, s] of Object.entries(strata)) {
  out.strata[k] = {
    repos: s.repos, reposComplete: s.reposComplete, reposWithFindings: s.reposWithFindings.size, filesScanned: s.filesScanned,
    cicsPrograms: s.cicsPrograms, commareaRead: s.commareaRead, flowFindings: s.flowFindings, crossProgram: s.crossProgram,
    secs: Math.round(s.secs), reposWithJcl: settings.ruleSets.includes('jcl') ? s.reposWithJcl.size : null,
    maxSourceBytes: MAX_SRC, filesOverBudget: s.filesOverBudget, excludedPaths: EXCLUDE_PATHS,
    byRule: s.byRule,
    byPackRule: s.byPackRule,
    reposByPackRule: Object.fromEntries(Object.entries(s.reposByPackRule).map(([r, set]) => [r, set.size])),
    reposByRule: Object.fromEntries(Object.entries(s.reposByRule).map(([r, set]) => [r, set.size])),
    // Findings once each file content is counted once, and the one repository contributing most.
    distinctByRule: Object.fromEntries(Object.entries(s.distinctByRule).map(([r, set]) => [r, set.size])),
    topRepoByRule: Object.fromEntries(Object.entries(s.byRuleRepo).map(([r, per]) => {
      const [repo, n] = Object.entries(per).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
      return [r, { repo, findings: n, share: Number((n / s.byRule[r]).toFixed(3)) }];
    })),
    examples: s.examples,
  };
}
if (OUT) writeRun(OUT, out, FOUND);
for (const [k, s] of Object.entries(out.strata)) {
  console.log(`\n${k}: ${s.repos} repositories, ${s.filesScanned} files read, ${s.secs}s`);
  if (s.reposWithJcl !== null) console.log(`  (${s.reposWithJcl} of ${s.repos} repositories contain any JCL at all)`);
  console.log(`  (${s.reposComplete} of ${s.repos} read completely by every set that ran)`);
  // The share is printed rather than judged, for the reason the pack rules below give. A rule whose
  // distinct count is far below its raw count, or whose top repository holds most of it, is
  // describing a copy or a generator before it describes COBOL.
  for (const [rule, n] of Object.entries(s.byRule).sort((a, b) => b[1] - a[1])) {
    const top = s.topRepoByRule[rule];
    console.log(`  ${String(n).padStart(6)}  ${rule}  (${s.reposByRule[rule] || 0} repos, ${s.distinctByRule[rule] ?? n} distinct, top ${top.repo} ${(top.share * 100).toFixed(0)}%)`);
  }
  if (Object.keys(s.byPackRule).length) {
    console.log(`
  pack rules, for validation.corpus:`);
    for (const [rule, n] of Object.entries(s.byPackRule).sort((a, b) => b[1] - a[1])) {
      const repos = s.reposByPackRule[rule] || 0;
      const share = s.repos ? ((repos / s.repos) * 100).toFixed(1) : '0.0';
      // A rule firing across a large share of a public corpus is over-broad. The threshold is a
      // judgement, so the share is printed rather than a verdict.
      console.log(`  ${String(n).padStart(6)}  ${rule}  (${repos} repos, ${share}%)`);
    }
  }
}

const SHOWN = 25;
if (comparison) {
  const c = comparison;
  console.log(`\ncompared with ${c.file}, counting only repositories both runs read completely:`);
  for (const [k, v] of Object.entries(c.settingsDiffer || {})) console.log(`  ${k} differs: ${JSON.stringify(v.earlier)} then, ${JSON.stringify(v.now)} now`);
  for (const n of c.notCompared || []) console.log(`  not compared, ${n}`);
  for (const [set, s] of Object.entries(c.sets)) {
    const left = Object.entries(s.excluded);
    console.log(`  ${set}: ${s.compared} of ${s.compared + left.length} repositories compared${left.length ? ', left out:' : ''}`);
    for (const [repo, why] of left) console.log(`    ${repo}: ${why}`);
  }
  const rules = Object.entries(c.byRule);
  const moved = rules.filter(([, r]) => r.added || r.removed);
  if (moved.length) console.log('\n   before    after   added  removed');
  for (const [rule, r] of moved) {
    const pad = (x, n) => String(x).padStart(n);
    console.log(`  ${pad(r.before, 7)}  ${pad(r.after, 7)}  ${pad(`+${r.added?.length || 0}`, 6)}  ${pad(`-${r.removed?.length || 0}`, 7)}  ${rule}`);
    for (const [sign, list] of [['+', r.added || []], ['-', r.removed || []]]) {
      for (const f of list.slice(0, SHOWN)) console.log(`      ${sign} ${f.repo}/${f.path}:${f.line}  ${f.fingerprint}  ${f.detail}`);
      if (list.length > SHOWN) console.log(`      ${sign} and ${list.length - SHOWN} more, ${OUT ? `under baseline.byRule in ${OUT}` : 'which --out records'}`);
    }
  }
  console.log(`  ${rules.length - moved.length} rule(s) with findings in the compared repositories did not change`);
}

// Every finding of one rule, once per file content. Reading findings is how a wrong conclusion is
// caught, and a program copied into twelve repositories read twelve times is how a copy passes for
// a population.
if (LIST) {
  const all = [];
  eachFound((f) => { if (f.rule === LIST) all.push(f); });
  all.sort((a, b) => byText(a.repo, b.repo) || byText(a.path || '', b.path || '') || (a.line || 0) - (b.line || 0));
  const groups = new Map();
  for (const f of all) {
    const k = f.content ? `${f.content}:${f.line}` : `${f.repo}:${f.path}:${f.line}`;
    const at = `${f.repo}/${f.path}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { at, shown: [], copies: new Set() }));
    if (at === g.at) g.shown.push(f);
    else g.copies.add(`${at}:${f.line}`);
  }
  console.log(`\n${LIST}: ${all.length} finding(s) in ${new Set(all.map(f => f.repo)).size} repositories, ${groups.size} distinct by file content`);
  for (const g of groups.values()) {
    for (const f of g.shown) {
      console.log(`\n  ${f.repo}/${f.path}:${f.line}  ${f.sev}  ${f.fingerprint}`);
      console.log(`    ${f.detail}`);
      if (f.guard) console.log(`    lowered for a check at ${f.guard}`);
      for (const h of f.trace || []) console.log(h.elided ? `      ... ${h.elided} hop(s) not listed` : `      ${h.program} ${h.item}  ${h.file}  ${h.via}`);
    }
    const copies = [...g.copies];
    if (copies.length) console.log(`    the same file, byte for byte, also at ${copies.slice(0, 5).join(', ')}${copies.length > 5 ? ` and ${copies.length - 5} more` : ''}`);
  }
}
