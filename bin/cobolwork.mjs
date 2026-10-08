#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { writeFileSync, readFileSync, lstatSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scanAll, applyEstateFacts, RULE_SETS } from '../lib/scan.mjs';
import { scan as scanFlow } from '../lib/sets/flow.mjs';
import { inventory } from '../lib/inventory.mjs';
import { sbom } from '../lib/sbom.mjs';
import { parseFile } from '../lib/parser.mjs';
import { toSarif } from '../lib/sarif.mjs';
import { diffRefs } from '../lib/diff.mjs';
import { gateRefs, VERDICT_EXIT } from '../lib/gate.mjs';
import { build, buildSarif, buildSummaryLine } from '../lib/build.mjs';
import { capabilities } from '../lib/capabilities.mjs';
import { PARSE_SCHEMA_VERSION, BASELINE_RESULT_SCHEMA_VERSION } from '../lib/version.mjs';
import { commitAt, revisionOf, toolRevision } from '../lib/revision.mjs';
import { stampFingerprints } from '../lib/kernel/identity.mjs';
import { pdsExportTree } from '../lib/kernel/source-tree.mjs';
import { SITE_FILE } from '../lib/site.mjs';
import { tally } from '../lib/kernel/findings.mjs';
import { loadBaseline, applyBaseline, baselineEntries, BASELINE_FILE, BASELINE_VERSION, SUPPRESSING } from '../lib/baseline.mjs';
import { readReport } from '../lib/tui/model.mjs';
import { nodeTerminal } from '../lib/tui/terminal.mjs';
import { runTui } from '../lib/tui/run.mjs';
import { explainFinding } from '../lib/explain.mjs';
import { advise } from '../lib/advice.mjs';
import { printable } from '../lib/kernel/printable.mjs';
import { startEvidence, recordInputs, recordHashed, recordFindings, recordOutput, recordVerdict, recordBaselineWrite, finishEvidence } from '../lib/evidence/run.mjs';
import { evidenceCommand } from '../lib/evidence/cli.mjs';
import { slsaStatement } from '../lib/evidence/slsa.mjs';
import { optableLevel } from '../lib/hlasm/optable.mjs';

const STARTED = new Date().toISOString();

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const USAGE = `cobolwork ${VERSION} — COBOL, JCL and CICS security analysis, no runtime dependencies

  cobolwork scan <path>        every rule set: data flow, CICS, JCL, hidden content, copybooks, build pins
  cobolwork inventory <path>   what is there and what could not be read (copybooks, dialects)
  cobolwork sbom <path> [--name <estate>]
                               a CycloneDX 1.6 bill of materials: every source by SHA-256, what each
                               program copies and calls, what each job runs, and the platforms used
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
  cobolwork advise <path> [--ironwork <path>]
                               every remediation and best practice for the repository in one document:
                               each item names the rule, practice or compiler message it rests on, with
                               the catalogue they point into and what could not be measured
  cobolwork gate <repo> --base <ref> [--head <ref>] --target <fingerprint>
                               whether a patch fixed that finding and moved nothing else: pass, fail
                               or undecided, with the reason for each check that did not pass
  cobolwork capabilities [--json]
                               what this cobolwork can do: commands and options, the version of every
                               document it writes, its fingerprint version, the file kinds it reads, and
                               the commit it runs from
  cobolwork build <repo> [--base <ref>] [--policy <file>] [--provenance <file>] [--ironwork <path> | [--precompile] -- <compiler> <arg>...]
                               the build gate: every finding ranked LOW to KNOWN-EXPLOITABLE, the
                               policy's blocking findings and compiler options checked, and the
                               compiler run only on a pass. Exits 0 pass, 1 fail, 3 undecided, 4 the
                               compiler failed after a pass, 2 could not run
  cobolwork evidence verify|seal|anchor --evidence <dir>
                               the evidence a run records: verify its chains, seals and witnesses;
                               seal the ledger (--ssh-key <file> or --signer <program>); anchor a seal
                               in a git witness (--anchor-git <repo> [--push]) or write an RFC 3161
                               request (--tsq <file>). verify exits 0 sealed, 1 broken or contradicted,
                               3 undetermined

Options
  --format json|sarif   output format (default json)
  --out <file>          write to a file instead of stdout
  --repos               treat each immediate subdirectory as its own repository
  --only <sets>         comma-separated subset of ${RULE_SETS.join(',')}
  --rules-path gitleaks print the path of the mainframe credential rules and exit
  --quiet               summary only
  --full-trace          list every hop of a data flow path, not its two ends
  --all-routes          give each data flow finding every statement on any route from its sources (scan, flow)
  --base <ref>          diff: the git revision to compare against
  --head <ref>          diff: the revision under review (default: the working tree)
  --baseline <file>     judgements to apply; without it, ${BASELINE_FILE} in the scanned tree
  --no-baseline         apply no baseline, the tree's own included
  --reason, --who, --expires <date>, --action accept|false-positive|wont-fix, --rule <ids>
                        baseline: the judgement each new entry records, and which rules it covers
  --advisories <file>[,<file>]  a customer's own advisory extract (JSON), loaded for this scan only;
                        never kept in the tree
  --pds-export          scan: the directory holds partitioned data sets' members as files, as
                        zowe zos-files download all-members writes them (hlq/llq/member.txt) or in a
                        directory named for each data set; findings name DATA.SET/MEMBER
  --mvs38-forms, --no-mvs38-forms  scan: read (the default) or refuse the operands MVS 3.8's system
                        macros take and z/OS 3.1's documentation does not list, such as MODESET
                        EXTKEY=SUPR (key zero), GETMAIN P and ATTACH HIARCHY=
  --hlasm-optable <table>  scan: read assembler source with this HLASM operation code table (UNI,
                        DOS, 370, XA, ESA, ZOP, YOP, Z9 ... Z17, or a MACHINE name such as S390): a
                        mnemonic outside it is a macro call. Without it the estate's assembly JCL
                        PARM or a file's *PROCESS decides, and UNI otherwise
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
  --provenance-format cobolwork|slsa  build: the record as written today, or an in-toto statement with
                        the SLSA Provenance v1 predicate (unsigned; the pipeline signs it)
  --artifact <path>[,<path>]  build: what the compiler produced, named as subjects of the SLSA statement
  --equivalence <file>[,<file>]  build --base: ironwork equivalence statements for the programs the
                        change edits, each signed by one of --allowed-signers. The policy's
                        requireEquivalence (never, machineAuthored, always) says when one is required;
                        where one may be, a build with no --allowed-signers fails the check
  --ironwork <path>     build: after a pass, run ironwork check on every program, for an estate that
                        compiles with IBM Enterprise COBOL; a program ironwork rejects exits 4, one it
                        does not model yet leaves the build undecided
  --precompile          build -- <compiler>: after a pass, translate each program the compiler command
                        names that holds EXEC SQL or EXEC CICS and run the compiler on it with
                        -fsyntax-only; one it refuses exits 4 and the command after -- does not run
  --evidence <dir>      scan, flow, diff, gate, build, baseline, inventory: record this run in a
                        hash-chained journal and ledger there (or COBOLWORK_EVIDENCE); never inside
                        the tree being read
  --allowed-signers <file>  evidence verify and build: OpenSSH allowed_signers for namespace
                        cobolwork-evidence; build refuses one inside the repository
  --anchor-git <repo>, --ref <ref>, --push, --max-unsealed <n>
                        evidence: the git witness, the ref that counts (default @{upstream}), whether
                        anchor pushes, and how many ledger records may follow the newest seal
  --anchor-pin <commit>  evidence verify: the witness commit an earlier verify reported as
                        witnessCommit; the witness must still hold every seal it held
  --tsq <file>, --tsr <file>, --tsa-ca <file>
                        evidence anchor writes an RFC 3161 request (and keeps it beside the seal);
                        verify reads the response, checking imprint and nonce, and has OpenSSL check
                        the authority's signature against the CA certificate
  --cosign-bundle <file> with --cosign-key <file> or --certificate-identity <id> and
  --certificate-oidc-issuer <url>, [--trusted-root <file>] [--insecure-ignore-tlog]
                        evidence verify: a transparency-log bundle over a seal, checked by cosign

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
    else if (a === '--all-routes') opts.allRoutes = true;
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
    else if (a === '--pds-export') opts.pdsExport = true;
    else if (a === '--mvs38-forms') opts.mvs38Forms = true;
    else if (a === '--no-mvs38-forms') opts.mvs38Forms = false;
    else if (a === '--hlasm-optable') opts.hlasmOptable = value();
    else if (a === '--precompile') opts.precompile = true;
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
    else if (a === '--provenance-format') opts.provenanceFormat = value();
    else if (a === '--equivalence') opts.equivalence = [...(opts.equivalence || []), ...list().map((x) => resolve(x))];
    else if (a === '--artifact') opts.artifact = [...(opts.artifact || []), ...list().map((x) => resolve(x))];
    else if (a === '--ironwork') opts.ironwork = value();
    else if (a === '--evidence') opts.evidence = value();
    else if (a === '--name') opts.name = value();
    else if (a === '--ssh-key') opts.sshKey = value();
    else if (a === '--signer') opts.signer = value();
    else if (a === '--allowed-signers') opts.allowedSigners = value();
    else if (a === '--anchor-git') opts.anchorGit = value();
    else if (a === '--ref') opts.ref = value();
    else if (a === '--push') opts.push = true;
    else if (a === '--max-unsealed') opts.maxUnsealed = value();
    else if (a === '--tsq') opts.tsq = value();
    else if (a === '--anchor-pin') opts.anchorPin = value();
    else if (a === '--tsr') opts.tsr = value();
    else if (a === '--tsa-ca') opts.tsaCa = value();
    else if (a === '--cosign-bundle') opts.cosignBundle = value();
    else if (a === '--certificate-identity') opts.certificateIdentity = value();
    else if (a === '--certificate-oidc-issuer') opts.certificateOidcIssuer = value();
    else if (a === '--cosign-key') opts.cosignKey = value();
    else if (a === '--trusted-root') opts.trustedRoot = value();
    else if (a === '--insecure-ignore-tlog') opts.insecureIgnoreTlog = true;
    else if (a === '--expect-key') opts.expectKey = value();
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
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

let journal = null;

function emit(obj, opts) {
  const text = JSON.stringify(obj, null, opts.quiet ? 0 : 1);
  recordOutput(journal, 'report', text + '\n', opts.out || null);
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
if (opts.allRoutes && opts._.length && !['scan', 'flow'].includes(opts._[0])) {
  process.stderr.write(`cobolwork: --all-routes is for scan and flow\n`);
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
const COPYLIB_COMMANDS = ['scan', 'flow', 'inventory', 'diff', 'build', 'baseline', 'tui', 'explain', 'sbom', 'advise'];
if (opts.copylib && opts._.length && !COPYLIB_COMMANDS.includes(opts._[0])) {
  process.stderr.write(`cobolwork: ${opts._[0]} reads no copybooks; ${COPYLIB_COMMANDS.join(', ')} do\n`);
  process.exit(2);
}
// A library that is not there would resolve nothing and report every copybook missing as before.
const notDirs = (opts.copylib || []).filter((d) => { try { return !statSync(d).isDirectory(); } catch { return true; } });
if (notDirs.length) { process.stderr.write(`cobolwork: --copylib ${notDirs.join(', ')} is not a directory\n`); process.exit(2); }
const systemDirs = opts.copylib || [];
if (opts.pdsExport && opts._.length && !['scan', 'diff', 'build'].includes(opts._[0])) { process.stderr.write('cobolwork: --pds-export is for scan, diff and build\n'); process.exit(2); }
if (opts.hlasmOptable !== undefined) {
  const level = optableLevel(opts.hlasmOptable) ?? optableLevel(opts.hlasmOptable, { machine: true });
  if (!level) { process.stderr.write(`cobolwork: --hlasm-optable ${opts.hlasmOptable} names no HLASM operation code table\n`); process.exit(2); }
  if (opts._.length && opts._[0] !== 'scan') { process.stderr.write('cobolwork: --hlasm-optable is for scan\n'); process.exit(2); }
  opts.hlasmOptable = level;
}
if (opts.mvs38Forms !== undefined && opts._.length && opts._[0] !== 'scan') { process.stderr.write('cobolwork: --mvs38-forms and --no-mvs38-forms are for scan\n'); process.exit(2); }
if (opts.pdsExport && opts.repos) { process.stderr.write('cobolwork: --pds-export reads one export; --repos does not apply\n'); process.exit(2); }
if (opts.json && opts._.length && opts._[0] !== 'capabilities') {
  process.stderr.write(`cobolwork: --json is for capabilities; every other command writes JSON unless --format says otherwise\n`);
  process.exit(2);
}
const buildFlag = ['policy', 'provenance', 'provenanceFormat', 'artifact', 'equivalence', 'ironwork'].find((k) => opts[k] !== undefined) || (compilerArgv ? '' : null);
if (opts.provenanceFormat !== undefined && !['cobolwork', 'slsa'].includes(opts.provenanceFormat)) { process.stderr.write(`cobolwork: --provenance-format takes cobolwork or slsa; got ${opts.provenanceFormat}\n`); process.exit(2); }
if ((opts.provenanceFormat !== undefined || opts.artifact) && !opts.provenance) { process.stderr.write('cobolwork: --provenance-format and --artifact describe the --provenance file; name it\n'); process.exit(2); }
if (buildFlag !== null && opts._.length && opts._[0] !== 'build') {
  process.stderr.write(`cobolwork: ${buildFlag ? `--${buildFlag}` : '--'} is for build only\n`);
  process.exit(2);
}
// A misspelled set would run nothing and report a clean zero.
const badSets = (opts.only || []).filter(s => !RULE_SETS.includes(s));
if (badSets.length || (opts.only && !opts.only.length)) { process.stderr.write(`cobolwork: --only takes ${RULE_SETS.join(',')}; got ${badSets.join(',') || 'nothing'}\n`); process.exit(2); }
const JOURNALED = ['scan', 'flow', 'diff', 'gate', 'build', 'baseline', 'inventory', 'sbom'];
if (opts.name !== undefined && opts._.length && opts._[0] !== 'sbom') { process.stderr.write('cobolwork: --name is for sbom only\n'); process.exit(2); }
if (opts.evidence !== undefined && opts._.length && ![...JOURNALED, 'evidence'].includes(opts._[0])) {
  process.stderr.write(`cobolwork: ${opts._[0]} records no evidence; ${JOURNALED.join(', ')} and evidence do\n`);
  process.exit(2);
}
const evidenceFlag = ['sshKey', 'signer', 'allowedSigners', 'anchorGit', 'ref', 'push', 'maxUnsealed', 'tsq', 'expectKey', 'anchorPin', 'tsr', 'tsaCa', 'cosignBundle', 'certificateIdentity', 'certificateOidcIssuer', 'cosignKey', 'trustedRoot', 'insecureIgnoreTlog'].find((k) => opts[k] !== undefined);
if (opts.equivalence && !opts.base) { process.stderr.write('cobolwork: --equivalence judges a change; it needs --base\n'); process.exit(2); }
if (evidenceFlag && opts._.length && opts._[0] !== 'evidence' && !(evidenceFlag === 'allowedSigners' && opts._[0] === 'build')) {
  process.stderr.write(`cobolwork: --${evidenceFlag.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is for evidence only\n`);
  process.exit(2);
}

const [command, target] = opts._;
const root = resolve(target || '.');
const repos = opts.repos ? readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name) : [''];

if (JOURNALED.includes(command)) {
  try {
    journal = startEvidence(opts, { command, argv, roots: [root], toolVersion: VERSION });
  } catch (e) {
    process.stderr.write(`cobolwork: ${printable(e && e.message ? e.message : e)}\n`);
    process.exit(2);
  }
}

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
  } else if (command === 'evidence') {
    process.exitCode = evidenceCommand(target, opts, { toolVersion: VERSION, write: (s) => process.stdout.write(s) });
  } else if (command === 'scan' || command === 'flow') {
    const flowOpts = { repos, fullTrace: opts.fullTrace === true, allRoutes: opts.allRoutes === true, systemDirs, mvs38Forms: opts.mvs38Forms !== false, hlasmOptable: opts.hlasmOptable ?? null };
    // The site file sits beside the members and is not one of them, so it is named rather than found.
    const site = resolve(root, SITE_FILE);
    const pds = opts.pdsExport ? pdsExportTree(root, { systemDirs }) : null;
    const report = command === 'flow' ? scanFlow(root, flowOpts)
      : pds ? scanAll(pds.root, { ...flowOpts, only: opts.only, advisoryFeeds: opts.advisoryFeeds, tree: pds, feedRoot: root, site: isFile(site) && !isLink(site) ? site : null })
      : scanAll(root, { ...flowOpts, only: opts.only, advisoryFeeds: opts.advisoryFeeds });
    if (pds) report.summary.pdsExport = pds.export;
    if (command === 'flow') {
      report.summary.identity = stampFingerprints(report.findings, { root });
      stampFingerprints(report.checked, { root });
      Object.assign(report.summary, applyEstateFacts(report.findings, report.checked, root));
      // A route the estate reproduced moves from checked back to findings.
      Object.assign(report.summary, { findings: report.findings.length, byRule: tally(report.findings), checked: report.checked.length });
    }
    applyBaseline(report, loadBaseline(root, { explicit: opts.baseline ? resolve(opts.baseline) : null, use: !opts.noBaseline }));
    stampRevisions(report.summary);
    recordInputs(journal, 0, root);
    recordFindings(journal, report);
    if (command === 'flow') emit(report, opts);
    else if (opts.format === 'sarif') emit(toSarif(report, { toolVersion: VERSION }), opts);
    else emit(opts.quiet ? { tool: report.tool, schemaVersion: report.schemaVersion, summary: report.summary } : report, opts);
    warnCoverage(report);
  } else if (command === 'diff') {
    if (!opts.base) { process.stderr.write(`cobolwork: diff needs --base <ref>\n`); process.exit(2); }
    const report = diffRefs(root, opts.base, opts.head || null, { only: opts.only, fullTrace: opts.fullTrace === true, systemDirs, pdsExport: opts.pdsExport === true });
    stampRevisions(report.summary, opts.head || null);
    recordFindings(journal, { findings: [...report.findings, ...(report.introduced || [])] });
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
    recordVerdict(journal, doc, process.exitCode ?? 0);
  } else if (command === 'build') {
    // A rule set left out is findings not seen, and a waiver file from elsewhere is not the one the
    // change was reviewed against.
    if (opts.only || opts.repos) { process.stderr.write('cobolwork: build judges one repository with every rule set; --only and --repos do not apply\n'); process.exit(2); }
    if (opts.baseline) { process.stderr.write('cobolwork: build reads the baseline the change was written against; --baseline does not apply, --no-baseline does\n'); process.exit(2); }
    if (opts.head && !opts.base) { process.stderr.write('cobolwork: build --head needs --base\n'); process.exit(2); }
    const result = build(root, { base: opts.base || null, head: opts.head || null, policy: opts.policy || null, noBaseline: opts.noBaseline === true, compiler: compilerArgv, ironwork: opts.ironwork || null, advisoryFeeds: opts.advisoryFeeds || null, copylibs: systemDirs, equivalence: opts.equivalence || [], allowedSigners: opts.allowedSigners || null, pdsExport: opts.pdsExport === true, precompile: opts.precompile === true });
    stampRevisions(result.doc.summary, opts.head || null);
    Object.assign(result.report.summary, { toolRevision: result.doc.summary.toolRevision, revision: result.doc.summary.revision });
    Object.assign(result.provenance, { toolRevision: result.doc.summary.toolRevision, revision: result.doc.summary.revision });
    if (opts.format === 'sarif') {
      const report = result.report;
      emit(buildSarif(toSarif({ ...report, findings: report.findings }, { toolVersion: VERSION }), result.doc), opts);
    } else emit(result.doc, opts);
    recordHashed(journal, 0, result.provenance.sources);
    recordFindings(journal, result.report);
    if (opts.provenance) {
      const record = opts.provenanceFormat === 'slsa'
        ? slsaStatement({
          provenance: result.provenance, root, artifacts: opts.artifact || [],
          docBytes: Buffer.from(JSON.stringify(result.doc, null, opts.quiet ? 0 : 1) + '\n'),
          runId: journal ? journal.id : null, runTip: journal && journal.tip ? journal.tip.hash : null,
          builderId: process.env.COBOLWORK_BUILDER_ID || null,
          ...(process.env.SOURCE_DATE_EPOCH ? {} : { startedOn: STARTED, finishedOn: new Date().toISOString() }),
        })
        : result.provenance;
      const text = JSON.stringify(record, null, 1) + '\n';
      writeFileSync(resolve(opts.provenance), text);
      recordOutput(journal, 'provenance', text, resolve(opts.provenance));
    }
    process.stderr.write(`${buildSummaryLine(result.doc)}\n`);
    process.exitCode = result.exit;
    recordVerdict(journal, result.doc, result.exit);
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
    const written = JSON.stringify({ _comment: 'Judgements over cobolwork findings, matched by fingerprint. A suppression lapses at its expires date and the finding comes back.', version: BASELINE_VERSION, entries }, null, 1) + '\n';
    writeFileSync(path, written);
    recordInputs(journal, 0, root);
    recordFindings(journal, report);
    recordBaselineWrite(journal, { before: held.entries, after: entries, who: opts.who, expires: expires.toISOString(), reason: opts.reason, path, text: written });
    const line = `${JSON.stringify({ tool: 'cobolwork-baseline', schemaVersion: BASELINE_RESULT_SCHEMA_VERSION, path, added, entries: entries.length })}\n`;
    recordOutput(journal, 'baseline', line);
    process.stdout.write(line);
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
  } else if (command === 'advise') {
    const doc = advise(root, { systemDirs, ironwork: opts.ironwork || null, baseline: opts.baseline, noBaseline: opts.noBaseline === true });
    recordInputs(journal, 0, root);
    emit(doc, opts);
    if (doc.unmeasured.length) process.stderr.write(`cobolwork: ${doc.unmeasured.length} part(s) unmeasured: ${doc.unmeasured[0]}\n`);
  } else if (command === 'explain') {
    const fingerprint = opts._[2];
    if (!fingerprint) { process.stderr.write('cobolwork: explain needs <path> <fingerprint>\n'); process.exit(2); }
    const report = opts.report ? storedReport(opts.report) : baselinedScan();
    const packet = explainFinding({ ...report, findings: [...report.findings, ...(report.suppressed || [])] }, fingerprint, { root });
    if (!packet) { process.stderr.write(`cobolwork: no finding with fingerprint ${fingerprint} in this report\n`); process.exit(2); }
    emit(packet, opts);
  } else if (command === 'sbom') {
    const bom = sbom(root, { systemDirs, name: opts.name });
    recordInputs(journal, 0, root);
    const text = JSON.stringify(bom, null, opts.quiet ? 0 : 1) + '\n';
    recordOutput(journal, 'sbom', text, opts.out || null);
    if (opts.out) writeFileSync(opts.out, text); else process.stdout.write(text);
  } else if (command === 'inventory') {
    const inv = inventory(root, { systemDirs });
    recordInputs(journal, 0, root);
    emit(inv, opts);
    warnCoverage(inv);
  } else if (command === 'parse') {
    const r = parseFile(root, { format: 'auto' });
    emit({
      tool: 'cobolwork-parse', schemaVersion: PARSE_SCHEMA_VERSION, file: r.file, format: r.format, finalFormat: r.finalFormat,
      programs: r.programs.map(p => ({ id: p.id, items: p.items.length, labels: p.labels.length, calls: p.calls.length, execs: p.execs.length, diagnostics: p.diags.length })),
      copies: r.copies.map(c => ({ name: c.name, status: c.status })),
      diagnostics: r.diags.length,
    }, opts);
  } else {
    process.stderr.write(`cobolwork: unknown command ${command}\n${USAGE}`);
    process.exit(2);
  }
  finishEvidence(journal, process.exitCode ?? 0);
} catch (e) {
  process.stderr.write(`cobolwork: ${printable(e && e.message ? e.message : e)}\n`);
  finishEvidence(journal, 2);
  process.exit(2);
}
