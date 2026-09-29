#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { writeFileSync, readFileSync, lstatSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scanAll, applyEstateFacts, RULE_SETS } from '../lib/scan.mjs';
import { scan as scanFlow } from '../lib/sets/flow.mjs';
import { inventory } from '../lib/inventory.mjs';
import { parseFile } from '../lib/parser.mjs';
import { toSarif } from '../lib/sarif.mjs';
import { diffRefs } from '../lib/diff.mjs';
import { gateRefs, VERDICT_EXIT } from '../lib/gate.mjs';
import { build, buildSarif, buildSummaryLine } from '../lib/build.mjs';
import { capabilities } from '../lib/capabilities.mjs';
import { commitAt, revisionOf, toolRevision } from '../lib/revision.mjs';
import { stampFingerprints } from '../lib/kernel/identity.mjs';
import { loadBaseline, applyBaseline, baselineEntries, BASELINE_FILE, SUPPRESSING } from '../lib/baseline.mjs';
import { readReport } from '../lib/tui/model.mjs';
import { nodeTerminal } from '../lib/tui/terminal.mjs';
import { runTui } from '../lib/tui/run.mjs';
import { explainFinding } from '../lib/explain.mjs';
import { printable } from '../lib/kernel/printable.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const USAGE = `cobolwork ${VERSION} — COBOL, JCL and CICS security analysis, no runtime dependencies

  cobolwork scan <path>        every rule set: data flow, CICS, JCL, hidden content, copybooks, build pins
  cobolwork inventory <path>   what is there and what could not be read (copybooks, dialects)
  cobolwork flow <path>        data-flow findings with the path the data took, as JSON
  cobolwork parse <file>       parse one source file and print a summary
  cobolwork diff <repo> --base <ref> [--head <ref>]
                               what a change reaches: layouts it moves in programs it never
                               edited, new call targets, and findings it adds or removes
  cobolwork baseline <path> --reason <text> --who <name> --expires <date>
                               accept what a scan reports now, until a date, in ${BASELINE_FILE};
                               entries already there are kept as they were
  cobolwork tui [path]         read a scan in the terminal: coverage first, then the findings
  cobolwork explain <path> <fingerprint>
                               one finding with the source line of every hop its trace kept and the
                               declaration of every item on its path; unlike a report, this carries source
  cobolwork gate <repo> --base <ref> [--head <ref>] --target <fingerprint>
                               whether a patch fixed that finding and moved nothing else: pass, fail
                               or undecided, with the reason for each check that did not pass
  cobolwork capabilities [--json]
                               what this cobolwork can do: commands and options, the version of every
                               document it writes, its fingerprint version, the file kinds it reads, and
                               the commit it runs from
  cobolwork build <repo> [--base <ref>] [--policy <file>] [--provenance <file>] [-- <compiler> <arg>...]
                               the build gate: every finding ranked LOW to KNOWN-EXPLOITABLE, the
                               policy's blocking findings and compiler options checked, and the
                               compiler run only on a pass. Exits 0 pass, 1 fail, 3 undecided, 4 the
                               compiler failed after a pass, 2 could not run

Options
  --format json|sarif   output format (default json)
  --out <file>          write to a file instead of stdout
  --repos               treat each immediate subdirectory as its own repository
  --only <sets>         comma-separated subset of ${RULE_SETS.join(',')}
  --rules-path gitleaks print the path of the mainframe credential rules and exit
  --quiet               summary only
  --full-trace          list every hop of a data flow path, not its two ends
  --base <ref>          diff: the git revision to compare against
  --head <ref>          diff: the revision under review (default: the working tree)
  --baseline <file>     judgements to apply; without it, ${BASELINE_FILE} in the scanned tree
  --no-baseline         apply no baseline, the tree's own included
  --reason, --who, --expires <date>, --action accept|false-positive|wont-fix, --rule <ids>
                        baseline: the judgement each new entry records, and which rules it covers
  --advisories <file>[,<file>]  a customer's own advisory extract (JSON), loaded for this scan only;
                        never kept in the tree
  --copylib <dir>[,<dir>]  copy libraries the estate keeps outside the repository, searched after the
                        tree's own copybooks, as COBCPY is; a copybook found there is read, not reported missing
  --report <file>       tui, explain: read a stored scan report instead of scanning
  --keys ispf|modern    tui: F3 and a command line, or Esc and letters (default ispf)
  --target <fingerprint>  gate: the finding the patch is meant to fix, as the base reports it
  --cobc <path>         gate: the COBOL compiler to check the patch with; by default the first cobc on
                        PATH outside the repository, and without one the document says not compiled
  --exit-code           gate: exit 0 on pass, 1 on fail, 3 on undecided rather than 0 whenever it ran
  --target-only         gate: judge only the target and coverage, for a revision others have changed since
  --policy <file>       build: an organisation's floor policy, from outside the repository; the
                        repository's cobolwork.policy.json can tighten it and never loosen it
  --provenance <file>   build: write what was scanned, under which policy, and what was compiled

Exit codes: 0 the command ran, 2 it could not run. A run that examined nothing says so in
summary.filesScanned and summary.nosrc rather than reporting a clean zero.
`;

function parseArgs(argv) {
  const opts = { format: 'json', out: null, repos: false, quiet: false, _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v === '' || v.startsWith('--')) { opts.needsValue ||= a; return undefined; }
      return v;
    };
    const list = () => {
      const items = [...new Set(String(value() ?? '').split(',').map(x => x.trim()).filter(Boolean))];
      if (!items.length) opts.needsValue ||= a;
      return items;
    };
    if (a === '--format') opts.format = value();
    else if (a === '--out') opts.out = value();
    else if (a === '--repos') opts.repos = true;
    else if (a === '--only') opts.only = list();
    else if (a === '--rules-path') opts.rulesPath = argv[++i] || 'gitleaks';
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--full-trace') opts.fullTrace = true;
    else if (a === '--base') opts.base = value();
    else if (a === '--head') opts.head = value();
    else if (a === '--baseline') opts.baseline = value();
    else if (a === '--no-baseline') opts.noBaseline = true;
    else if (a === '--reason') opts.reason = value();
    else if (a === '--who') opts.who = value();
    else if (a === '--expires') opts.expires = value();
    else if (a === '--action') opts.action = value();
    else if (a === '--rule') opts.rule = list();
    else if (a === '--advisories') opts.advisoryFeeds = [...new Set(list().map(x => resolve(x)))];
    else if (a === '--copylib') opts.copylib = [...new Set(list().map(x => resolve(x)))];
    else if (a === '--report') opts.report = value();
    else if (a === '--keys') opts.keys = value();
    else if (a === '--target') opts.target = value();
    else if (a === '--cobc') opts.cobc = value();
    else if (a === '--exit-code') opts.exitCode = true;
    else if (a === '--target-only') opts.targetOnly = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--policy') opts.policy = value();
    else if (a === '--provenance') opts.provenance = value();
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--version' || a === '-v') opts.version = true;
    else if (a.startsWith('-')) { opts.unknown = a; }
    else opts._.push(a);
  }
  return opts;
}

// A consumer that reads logs rather than the report still has to learn that the reading was short.
// Written to stderr, so it lands in the lane log beside whatever else the run said.
function warnCoverage(report) {
  const s = report && report.summary;
  if (!s || !s.coverageIncomplete) return;
  const why = [
    s.copiesMissing ? `${s.copiesMissing} unresolved COPY` : "",
    ((report.inventory && report.inventory.refusedCopies) || []).length ? `${report.inventory.refusedCopies.length} refused COPY` : "",
    s.filesUnreadable ? `${s.filesUnreadable} unreadable file(s)` : "",
    s.filesOverBudget ? `${s.filesOverBudget} file(s) past the source budget` : "",
  ].filter(Boolean).join(", ");
  process.stderr.write(`cobolwork: coverage incomplete${why ? `: ${why}` : ""}\n`);
}

const isLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };

function emit(obj, opts) {
  const text = JSON.stringify(obj, null, opts.quiet ? 0 : 1);
  if (opts.out) { writeFileSync(opts.out, text + '\n'); return; }
  // A pipe drains asynchronously and process.exit discards what has not drained: past 64 KB the
  // reader got a truncated document and exit 0. The process ends on its own once stdout is flushed.
  process.stdout.write(text + '\n');
}

// Everything after `--` is a compiler command for build, never options of ours: -fec would otherwise
// read as an unknown flag.
const argv = process.argv.slice(2);
const dashes = argv.indexOf('--');
const opts = parseArgs(dashes < 0 ? argv : argv.slice(0, dashes));
const compilerArgv = dashes < 0 ? null : argv.slice(dashes + 1);
if (opts.help || (!opts._.length && !opts.version && !opts.rulesPath)) { process.stdout.write(USAGE); process.exit(opts.help ? 0 : 2); }
if (opts.version) { process.stdout.write(`${VERSION}\n`); process.exit(0); }
if (opts.rulesPath) {
  if (opts.rulesPath !== 'gitleaks') { process.stderr.write(`cobolwork: no rules for ${opts.rulesPath}\n`); process.exit(2); }
  process.stdout.write(`${fileURLToPath(new URL('../rules/gitleaks-mainframe.toml', import.meta.url))}\n`);
  process.exit(0);
}
if (opts.unknown) { process.stderr.write(`cobolwork: unknown option ${opts.unknown}\n${USAGE}`); process.exit(2); }
if (opts.needsValue) { process.stderr.write(`cobolwork: ${opts.needsValue} needs a value\n`); process.exit(2); }
// A format nobody implements would print JSON and exit 0, which is the same shape of quiet wrong
// answer as a misspelled rule set. SARIF is a findings document, so the commands that do not
// produce findings say so rather than ignoring the flag.
const FORMATS = ['json', 'sarif'];
if (!FORMATS.includes(opts.format)) { process.stderr.write(`cobolwork: --format takes ${FORMATS.join(',')}; got ${opts.format}\n`); process.exit(2); }
const SARIF_COMMANDS = ['scan', 'diff', 'build'];
if (opts.format === 'sarif' && opts._.length && !SARIF_COMMANDS.includes(opts._[0])) {
  process.stderr.write(`cobolwork: ${opts._[0]} has no SARIF form; ${SARIF_COMMANDS.join(' and ')} do\n`);
  process.exit(2);
}
// A trace only exists where data flow ran, so the commands that never produce one refuse the flag
// rather than accepting it and changing nothing.
const TRACE_COMMANDS = ['scan', 'flow', 'diff'];
if (opts.fullTrace && opts._.length && !TRACE_COMMANDS.includes(opts._[0])) {
  process.stderr.write(`cobolwork: ${opts._[0]} has no data-flow trace; ${TRACE_COMMANDS.join(', ')} do
`);
  process.exit(2);
}
const ADVISORY_COMMANDS = ['scan', 'baseline', 'tui', 'explain', 'build'];
if (opts.advisoryFeeds && opts._.length && !ADVISORY_COMMANDS.includes(opts._[0])) {
  process.stderr.write(`cobolwork: ${opts._[0]} reads no advisories; ${ADVISORY_COMMANDS.join(', ')} do\n`);
  process.exit(2);
}
const gateFlag = ['target', 'cobc', 'exitCode', 'targetOnly'].find((k) => opts[k] !== undefined);
if (gateFlag && opts._.length && opts._[0] !== 'gate') {
  process.stderr.write(`cobolwork: --${gateFlag.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is for gate only\n`);
  process.exit(2);
}
const COPYLIB_COMMANDS = ['scan', 'flow', 'inventory', 'diff', 'build', 'baseline', 'tui', 'explain'];
if (opts.copylib && opts._.length && !COPYLIB_COMMANDS.includes(opts._[0])) {
  process.stderr.write(`cobolwork: ${opts._[0]} reads no copybooks; ${COPYLIB_COMMANDS.join(', ')} do\n`);
  process.exit(2);
}
// A library that is not there would resolve nothing and report every copybook missing as before.
const notDirs = (opts.copylib || []).filter((d) => { try { return !statSync(d).isDirectory(); } catch { return true; } });
if (notDirs.length) { process.stderr.write(`cobolwork: --copylib ${notDirs.join(', ')} is not a directory\n`); process.exit(2); }
const systemDirs = opts.copylib || [];
if (opts.json && opts._.length && opts._[0] !== 'capabilities') {
  process.stderr.write(`cobolwork: --json is for capabilities; every other command writes JSON unless --format says otherwise\n`);
  process.exit(2);
}
const buildFlag = ['policy', 'provenance'].find((k) => opts[k] !== undefined) || (compilerArgv ? '' : null);
if (buildFlag !== null && opts._.length && opts._[0] !== 'build') {
  process.stderr.write(`cobolwork: ${buildFlag ? `--${buildFlag}` : '--'} is for build only\n`);
  process.exit(2);
}
// A misspelled set would run nothing and report a clean zero.
const badSets = (opts.only || []).filter(s => !RULE_SETS.includes(s));
if (badSets.length || (opts.only && !opts.only.length)) { process.stderr.write(`cobolwork: --only takes ${RULE_SETS.join(',')}; got ${badSets.join(',') || 'nothing'}\n`); process.exit(2); }

const [command, target] = opts._;
const root = resolve(target || '.');
const repos = opts.repos ? readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name) : [''];

function storedReport(file) {
  const path = resolve(file);
  let doc;
  try { doc = JSON.parse(readFileSync(path, 'utf8')); } catch (e) {
    throw new Error(`--report ${path}: ${e.code === 'ENOENT' ? 'no such file' : e instanceof SyntaxError ? `not JSON (${e.message})` : e.message}`);
  }
  return readReport(doc);
}

// Which cobolwork wrote a document and which commit it read. Over --repos the root is many
// repositories, and no one commit is what was read.
function stampRevisions(summary, head = null) {
  summary.toolRevision = toolRevision();
  if (!opts.repos) summary.revision = head ? commitAt(root, head) : revisionOf(root);
  return summary;
}

function baselinedScan() {
  const report = scanAll(root, { repos, only: opts.only, advisoryFeeds: opts.advisoryFeeds, systemDirs });
  applyBaseline(report, loadBaseline(root, { explicit: opts.baseline ? resolve(opts.baseline) : null, use: !opts.noBaseline }));
  return report;
}

try {
  if (command === 'capabilities') {
    emit(capabilities(), opts);
  } else if (command === 'scan' || command === 'flow') {
    const flowOpts = { repos, fullTrace: opts.fullTrace === true, systemDirs };
    const report = command === 'flow' ? scanFlow(root, flowOpts) : scanAll(root, { ...flowOpts, only: opts.only, advisoryFeeds: opts.advisoryFeeds });
    if (command === 'flow') {
      report.summary.identity = stampFingerprints(report.findings, { root });
      Object.assign(report.summary, applyEstateFacts(report.findings, report.checked, root));
    }
    applyBaseline(report, loadBaseline(root, { explicit: opts.baseline ? resolve(opts.baseline) : null, use: !opts.noBaseline }));
    stampRevisions(report.summary);
    if (command === 'flow') emit(report, opts);
    else if (opts.format === 'sarif') emit(toSarif(report, { toolVersion: VERSION }), opts);
    else emit(opts.quiet ? { tool: report.tool, schemaVersion: report.schemaVersion, summary: report.summary } : report, opts);
    warnCoverage(report);
  } else if (command === 'diff') {
    if (!opts.base) { process.stderr.write(`cobolwork: diff needs --base <ref>\n`); process.exit(2); }
    const report = diffRefs(root, opts.base, opts.head || null, { only: opts.only, fullTrace: opts.fullTrace === true, systemDirs });
    stampRevisions(report.summary, opts.head || null);
    if (opts.format === 'sarif') emit(toSarif({ ...report, findings: [...report.findings, ...report.introduced] }, { toolVersion: VERSION }), opts);
    else emit(opts.quiet ? { tool: report.tool, schemaVersion: report.schemaVersion, summary: report.summary } : report, opts);
  } else if (command === 'gate') {
    if (!opts.base || !opts.target) { process.stderr.write('cobolwork: gate needs --base <ref> and --target <fingerprint>\n'); process.exit(2); }
    // Every rule set runs on both sides, or a finding the patch adds in a set left out goes unseen.
    if (opts.only || opts.repos) { process.stderr.write('cobolwork: gate judges one repository with every rule set; --only and --repos do not apply\n'); process.exit(2); }
    // A suppression is not a fix, so the gate reads findings as the engine reports them.
    if (opts.baseline || opts.noBaseline) { process.stderr.write('cobolwork: gate applies no baseline; --baseline and --no-baseline do not apply\n'); process.exit(2); }
    const doc = gateRefs(root, opts.base, opts.head || null, opts.target, { cobc: opts.cobc, targetOnly: opts.targetOnly === true });
    stampRevisions(doc.summary, opts.head || null);
    emit(doc, opts);
    if (opts.exitCode) process.exitCode = VERDICT_EXIT[doc.verdict];
  } else if (command === 'build') {
    // A rule set left out is findings not seen, and a waiver file from elsewhere is not the one the
    // change was reviewed against.
    if (opts.only || opts.repos) { process.stderr.write('cobolwork: build judges one repository with every rule set; --only and --repos do not apply\n'); process.exit(2); }
    if (opts.baseline) { process.stderr.write('cobolwork: build reads the baseline the change was written against; --baseline does not apply, --no-baseline does\n'); process.exit(2); }
    if (opts.head && !opts.base) { process.stderr.write('cobolwork: build --head needs --base\n'); process.exit(2); }
    const result = build(root, { base: opts.base || null, head: opts.head || null, policy: opts.policy || null, noBaseline: opts.noBaseline === true, compiler: compilerArgv, advisoryFeeds: opts.advisoryFeeds || null, copylibs: systemDirs });
    stampRevisions(result.doc.summary, opts.head || null);
    Object.assign(result.report.summary, { toolRevision: result.doc.summary.toolRevision, revision: result.doc.summary.revision });
    Object.assign(result.provenance, { toolRevision: result.doc.summary.toolRevision, revision: result.doc.summary.revision });
    if (opts.format === 'sarif') {
      const report = result.report;
      emit(buildSarif(toSarif({ ...report, findings: report.findings }, { toolVersion: VERSION }), result.doc), opts);
    } else emit(result.doc, opts);
    if (opts.provenance) writeFileSync(resolve(opts.provenance), JSON.stringify(result.provenance, null, 1) + '\n');
    process.stderr.write(`${buildSummaryLine(result.doc)}\n`);
    process.exitCode = result.exit;
  } else if (command === 'baseline') {
    // A suppression nobody dated is never looked at again, so every part of the judgement is asked for.
    const missing = ['reason', 'who', 'expires'].filter((k) => !opts[k]);
    if (missing.length) { process.stderr.write(`cobolwork: baseline needs ${missing.map((k) => `--${k}`).join(', ')}\n`); process.exit(2); }
    const at = new Date().toISOString();
    const expires = new Date(opts.expires);
    if (Number.isNaN(expires.getTime()) || expires.toISOString() <= at) { process.stderr.write(`cobolwork: --expires must be a date in the future; got ${opts.expires}\n`); process.exit(2); }
    const action = opts.action || 'accept';
    if (!['accept', 'false-positive', 'wont-fix'].includes(action)) { process.stderr.write(`cobolwork: --action takes accept, false-positive or wont-fix; got ${action}\n`); process.exit(2); }
    const path = opts.out ? resolve(opts.out) : resolve(root, BASELINE_FILE);
    // The file in the tree is the tree's, and a link there would aim this write anywhere on disk.
    if (!opts.out && isLink(path)) { process.stderr.write(`cobolwork: ${path} is a symbolic link, which is not written through; name the file with --out\n`); process.exit(2); }
    const held = loadBaseline(root, { explicit: path, mayBeAbsent: true });
    if (held.problems.length) { process.stderr.write(`cobolwork: ${path} holds entries that do not validate, so it is left as it is:\n  ${held.problems.join('\n  ')}\n`); process.exit(2); }
    const report = scanAll(root, { repos, only: opts.only, advisoryFeeds: opts.advisoryFeeds, systemDirs });
    const { entries, added } = baselineEntries(report.findings, held.entries, { action, reason: opts.reason, who: opts.who, expires: expires.toISOString(), at, rules: opts.rule || null });
    writeFileSync(path, JSON.stringify({ _comment: 'Judgements over cobolwork findings, matched by fingerprint. A suppression lapses at its expires date and the finding comes back.', entries }, null, 1) + '\n');
    process.stdout.write(`${JSON.stringify({ tool: 'cobolwork-baseline', path, added, entries: entries.length })}\n`);
  } else if (command === 'tui') {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      process.stderr.write('cobolwork: tui needs a terminal on standard input and output; cobolwork scan writes the same report without one\n');
      process.exit(2);
    }
    if (opts.keys && !['ispf', 'modern'].includes(opts.keys)) { process.stderr.write(`cobolwork: --keys takes ispf or modern; got ${opts.keys}\n`); process.exit(2); }
    const report = opts.report ? storedReport(opts.report) : baselinedScan();
    const terminal = nodeTerminal();
    process.once('exit', () => terminal.stop());
    await runTui({ report, terminal, keymap: opts.keys || 'ispf', color: !process.env.NO_COLOR });
  } else if (command === 'explain') {
    const fingerprint = opts._[2];
    if (!fingerprint) { process.stderr.write('cobolwork: explain needs <path> <fingerprint>\n'); process.exit(2); }
    const report = opts.report ? storedReport(opts.report) : baselinedScan();
    const packet = explainFinding({ ...report, findings: [...report.findings, ...(report.suppressed || [])] }, fingerprint, { root });
    if (!packet) { process.stderr.write(`cobolwork: no finding with fingerprint ${fingerprint} in this report\n`); process.exit(2); }
    emit(packet, opts);
  } else if (command === 'inventory') {
    const inv = inventory(root, { systemDirs });
    emit(inv, opts);
    warnCoverage(inv);
  } else if (command === 'parse') {
    const r = parseFile(root, { format: 'auto' });
    emit({
      tool: 'cobolwork-parse', file: r.file, format: r.format, finalFormat: r.finalFormat,
      programs: r.programs.map(p => ({ id: p.id, items: p.items.length, labels: p.labels.length, calls: p.calls.length, execs: p.execs.length, diagnostics: p.diags.length })),
      copies: r.copies.map(c => ({ name: c.name, status: c.status })),
      diagnostics: r.diags.length,
    }, opts);
  } else {
    process.stderr.write(`cobolwork: unknown command ${command}\n${USAGE}`);
    process.exit(2);
  }
} catch (e) {
  process.stderr.write(`cobolwork: ${printable(e && e.message ? e.message : e)}\n`);
  process.exit(2);
}
