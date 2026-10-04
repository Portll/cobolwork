// SPDX-License-Identifier: AGPL-3.0-or-later
import { join, resolve } from 'node:path';
import { sortFindings, tally, evidenceMap, EVIDENCE, EXPLOITABILITY } from './kernel/findings.mjs';
import { directoryTree } from './kernel/source-tree.mjs';
import { REGISTRY, RULE_SETS, ALL_RULES, reportKey } from './kernel/registry.mjs';
import { inventorySteps } from './inventory.mjs';
import { driveTogether, sharingTree } from './kernel/shared-pass.mjs';
import { stoppedBecause } from './kernel/memory.mjs';
import { complianceMap, FRAMEWORKS_LOADED, FRAMEWORKS_UNLOADED } from './compliance.mjs';
import { stampFingerprints, FINGERPRINT_VERSION } from './kernel/identity.mjs';
import { report } from './kernel/ruleset.mjs';
import { printable } from './kernel/printable.mjs';
import { rollup } from './sets/flow.mjs';
import { loadSite } from './site.mjs';
import { reachFeedPaths, loadReachFeed, reachResolver, stampReach, stampEffect } from './reach.mjs';
import { stampExploitability, byVerdict, HANDLING, witnessFeedPaths, loadWitnessFeed, applyWitness } from './exploitability.mjs';
import { executionFeedPaths, loadExecutionFeed, applyExecution } from './execution.mjs';

import { FLOW_MODEL, SCHEMA_VERSION, TOOL_VERSION } from './version.mjs';

export { SCHEMA_VERSION };

export { ALL_RULES, RULE_SETS };

// One report for every rule set, in the shape a consumer can read without knowing which set a
// finding came from. filesScanned and coverageIncomplete travel with it: a scan of a tree whose
// copybooks are missing has read less than it appears to have read, and must say so.
// With several repositories, each is scanned on its own and the reports are merged: program and
// copybook names are only unique within a repository, so one graph over all of them would link a
// CALL in one to a same-named program in another and report copybooks in different repositories as
// shadowing each other.
// The repository prefix is joined the same way every other report path is built: with a forward
// slash. path.join would use the platform separator here and rewrite the separators already in the
// path, so one file would print two ways depending on whether --repos was passed.
const underRepo = (repo, p) => (repo ? `${repo}/${p}` : p);

// Frameworks that did not load; a reason can quote the unparsed file.
const COMPLIANCE_UNLOADED = FRAMEWORKS_UNLOADED.map((f) => ({ id: f.id, why: printable(f.why) }));

// The estate facts of several repositories' reports as one summary: counts add, feeds are the same
// for every repository so the first names them, and a note says which repositories it covers.
function mergeEstate(reports) {
  const all = reports.map(({ repo, r }) => ({ repo, s: r.summary }));
  const addUp = (k) => {
    const have = all.filter((x) => x.s[k]);
    if (!have.length) return null;
    const out = {};
    for (const { s } of have) for (const [f, n] of Object.entries(s[k])) out[f] = (out[f] || 0) + n;
    return out;
  };
  const union = (k) => [...new Set(all.flatMap((x) => x.s[k] || []))];
  const first = (k) => all.find((x) => x.s[k])?.s[k];
  const without = (k) => all.filter((x) => x.s[k]).map((x) => x.repo);
  const of = (names) => `${names.length} of ${all.length} repositories (${names.join(', ')})`;
  const reachless = without('reachNote');
  const effectless = without('effectNote');
  const driven = all.filter((x) => x.s.reachNote).reduce((n, x) => n + (x.s.byExploitability?.['attacker-driven'] || 0), 0);
  // A result is unmatched only where no repository's finding carries it.
  const unmatchedIn = all.map((x) => new Set(x.s.witnessUnmatched || []));
  const unmatched = first('witnessFeeds') ? [...unmatchedIn[0]].filter((fp) => unmatchedIn.every((u) => u.has(fp))) : [];
  const overruled = all.flatMap((x) => (x.s.witnessOverruled || []).map((o) => ({ ...o, path: underRepo(x.repo, o.path) })));
  const merged = {
    byReach: addUp('byReach'), byEffect: addUp('byEffect'),
    reachFeeds: first('reachFeeds'), reachFeedProblems: union('reachFeedProblems'),
    reachNote: reachless.length ? `no reachability facts declared in ${of(reachless)}, so no finding there was judged reachable${driven ? `, and the ${driven} an attacker drives are labelled attacker-driven rather than exploitable` : ''}: name open/restricted transactions and jobs in each repository's cobolwork.site.json, or bring a COBOLWORK_REACH extract` : null,
    effectNote: effectless.length ? `no authority facts declared in ${of(effectless)}, so no finding there was judged to run privileged: name privilegedTransactions/privilegedJobs in each repository's cobolwork.site.json, or bring them in the COBOLWORK_REACH extract` : null,
    witnessFeeds: first('witnessFeeds'), byWitness: addUp('byWitness'), witnessFeedProblems: union('witnessFeedProblems'),
    witnessUnmatched: unmatched, witnessOverruled: overruled,
    siteWarnings: all.flatMap((x) => (x.s.siteWarnings || []).map((w) => `${x.repo}/${w}`)),
    feedWarnings: union('feedWarnings'),
  };
  return Object.fromEntries(Object.entries(merged).filter(([, v]) => (Array.isArray(v) ? v.length : v)));
}

function scanEach(root, opts) {
  // A feed is refused anywhere inside the scanned root, not only inside the repository being read.
  const reports = opts.repos.map(repo => ({ repo, r: scanAll(join(root, repo), { ...opts, repos: null, repoName: repo, feedRoot: opts.feedRoot || root }) }));
  const findings = [];
  const checked = [];
  const fixedAt = (repo, x) => (x?.fixAt ? { exploitability: { ...x, fixAt: { ...x.fixAt, path: underRepo(repo, x.fixAt.path),
    ...(x.fixAt.builtInto ? { builtInto: { ...x.fixAt.builtInto, path: underRepo(repo, x.fixAt.builtInto.path) } } : {}) } } } : {});
  const prefixed = (repo, f) => ({ ...f, path: underRepo(repo, f.path), ...(f.related ? { related: f.related.map(x => ({ ...x, path: underRepo(repo, x.path) })) } : {}), ...fixedAt(repo, f.exploitability) });
  for (const { repo, r } of reports) {
    for (const f of r.findings) findings.push(prefixed(repo, f));
    for (const f of r.checked || []) checked.push(prefixed(repo, f));
  }
  sortFindings(findings);
  const shared = reports.reduce((n, { r }) => n + (r.summary.identity?.shared || 0), 0);
  const sum = (k) => reports.reduce((n, { r }) => n + (r.summary[k] || 0), 0);
  const byRule = tally(findings);
  const bySeverity = {};
  for (const f of findings) bySeverity[f.sev] = (bySeverity[f.sev] || 0) + 1;
  const byEvidence = {};
  for (const f of findings) byEvidence[f.evidence] = (byEvidence[f.evidence] || 0) + 1;
  const byExploitability = byVerdict(findings);
  const perRepo = Object.fromEntries(reports.map(({ repo, r }) => [repo, { findings: r.summary.findings, filesScanned: r.summary.filesScanned, coverageIncomplete: r.summary.coverageIncomplete, nosrc: r.summary.nosrc,
    ...(r.summary.byExploitability ? { byExploitability: r.summary.byExploitability } : {}) }]));
  const filesScanned = sum('filesScanned');
  return {
    tool: 'cobolwork',
    schemaVersion: SCHEMA_VERSION,
    summary: {
      findings: findings.length, byRule, bySeverity, byEvidence, repos: reports.length, perRepo,
      filesScanned, programs: sum('programs'), programFiles: sum('programFiles'), copybookFiles: sum('copybookFiles'),
      jclFiles: sum('jclFiles'), copiesMissing: sum('copiesMissing'), filesUnreadable: sum('filesUnreadable'),
      filesEbcdic: sum('filesEbcdic'), filesOverBudget: sum('filesOverBudget'), crossProgram: sum('crossProgram'),
      ruleSets: opts.only || RULE_SETS, nosrc: filesScanned === 0,
      coverageIncomplete: reports.some(({ r }) => r.summary.coverageIncomplete),
      identity: { version: FINGERPRINT_VERSION, shared },
      ...(reports[0]?.r.summary.advisoryFeeds ? { advisoryFeeds: reports[0].r.summary.advisoryFeeds } : {}),
      ...(reports[0]?.r.summary.advisoryCoverage ? { advisoryCoverage: reports[0].r.summary.advisoryCoverage } : {}),
      // The schema has no repository field for a set, so the repository leads the reason.
      setsIncomplete: reports.flatMap(({ repo, r }) => (r.summary.setsIncomplete || []).map((x) => ({ ...x, why: `${repo}: ${x.why}` }))),
      ...mergeEstate(reports),
      ...(byExploitability ? { byExploitability } : {}),
      ...(byExploitability?.exploitable || byExploitability?.confirmed ? { handling: HANDLING } : {}),
    },
    findings,
    ...(checked.length ? { checked } : {}),
    ruleText: Object.fromEntries(Object.entries(ALL_RULES).map(([k, v]) => [k, v.text])),
    ruleCwe: Object.fromEntries(Object.entries(ALL_RULES).filter(([, v]) => v.cwe).map(([k, v]) => [k, v.cwe])),
    ruleEvidence: evidenceMap(ALL_RULES),
    ruleImpact: Object.fromEntries(Object.entries(ALL_RULES).filter(([, v]) => v.impact).map(([k, v]) => [k, v.impact])),
    ruleRemedy: Object.fromEntries(Object.entries(ALL_RULES).filter(([, v]) => v.remedy).map(([k, v]) => [k, v.remedy])),
    evidence: EVIDENCE,
    exploitabilityVerdicts: EXPLOITABILITY,
    // Which clause each rule bears on, and what the mapping does not claim. A reader who takes
    // this to an auditor needs both halves.
    ruleCompliance: complianceMap(Object.keys(ALL_RULES)),
    compliance: FRAMEWORKS_LOADED,
    ...(COMPLIANCE_UNLOADED.length ? { complianceUnloaded: COMPLIANCE_UNLOADED } : {}),
  };
}

// Who can reach each finding and what it runs as, from the estate's own facts - a brought
// COBOLWORK_REACH extract, or the keys in cobolwork.site.json - never from the source, and the
// exploitability verdict those join into with the route. Returns the summary keys that report them.
// Reach and effect annotate rather than re-rank; where no fact is declared, a note says so rather
// than the report reading as a clean bill.
export function applyEstateFacts(findings, checked, root, opts = {}) {
  const site = loadSite(root, opts.site || null, opts.tree);
  const feedRoot = opts.feedRoot || root;
  const reachFeeds = reachFeedPaths(opts).map((p) => loadReachFeed(p, { root: feedRoot }));
  const reach = reachResolver({ feeds: reachFeeds, site });
  const withEntries = findings.some((f) => (f.startedBy || []).length);
  const byReach = reach.declared ? stampReach(findings, reach) : null;
  const byEffect = reach.effectDeclared ? stampEffect(findings, reach) : null;
  // A rule that escalates only under elevated authority takes its higher severity where the estate
  // says the entry that reaches it runs privileged.
  for (const f of findings) {
    const raise = ALL_RULES[f.rule]?.whenPrivileged;
    if (raise && f.effect === 'privileged') f.sev = raise;
  }
  stampExploitability(findings, reach, checked);
  const witnessFeeds = witnessFeedPaths(opts).map((p) => loadWitnessFeed(p, { root: feedRoot }));
  const witnessed = applyWitness(findings, checked, witnessFeeds);
  if (witnessed.overruled.length) sortFindings(findings);
  const byExploitability = byVerdict(findings);
  const executionFeeds = executionFeedPaths(opts).map((p) => loadExecutionFeed(p));
  const { byExecution } = applyExecution(findings, root, executionFeeds);
  const driven = byExploitability ? byExploitability['attacker-driven'] : 0;
  const loaded = witnessFeeds.filter((f) => !f.problem);
  const feedWarnings = [...reachFeeds, ...witnessFeeds].flatMap((f) => f.warnings).sort();
  return {
    ...(site.warnings.length ? { siteWarnings: site.warnings } : {}),
    ...(feedWarnings.length ? { feedWarnings } : {}),
    ...(byReach ? { byReach } : {}),
    ...(byEffect ? { byEffect } : {}),
    ...(reachFeeds.some(f => !f.problem) ? { reachFeeds: reachFeeds.filter(f => !f.problem).map(f => ({ file: f.file, extract: f.extract, retrieved: f.retrieved })) } : {}),
    ...(reachFeeds.some(f => f.problem) ? { reachFeedProblems: reachFeeds.filter(f => f.problem).map(f => `${f.file}: ${f.problem}`) } : {}),
    ...(!reach.declared && withEntries ? { reachNote: `no reachability facts declared, so no finding was judged reachable${driven ? `, and the ${driven} an attacker drives are labelled attacker-driven rather than exploitable` : ''}: name open/restricted transactions and jobs in cobolwork.site.json, or bring a COBOLWORK_REACH extract` } : {}),
    ...(!reach.effectDeclared && withEntries ? { effectNote: 'no authority facts declared, so no finding was judged to run privileged: name privilegedTransactions/privilegedJobs in cobolwork.site.json, or bring them in the COBOLWORK_REACH extract' } : {}),
    ...(byExploitability ? { byExploitability } : {}),
    ...(byExploitability?.exploitable || byExploitability?.confirmed ? { handling: HANDLING } : {}),
    ...(loaded.length ? { witnessFeeds: loaded.map((f) => ({ file: f.file, witness: f.witness, recorded: f.recorded })), byWitness: witnessed.byWitness } : {}),
    ...(witnessFeeds.some((f) => f.problem || f.refused.length) ? { witnessFeedProblems: witnessFeeds.flatMap((f) => (f.problem ? [`${f.file}: ${f.problem}`] : f.refused.map((r) => `${f.file}: ${r.why}`))) } : {}),
    ...(byExecution ? { executionFeeds: executionFeeds.filter((f) => !f.problem).map((f) => ({ file: f.file, programs: f.programs.size })), byExecution } : {}),
    ...(executionFeeds.some((f) => f.problem) ? { executionFeedProblems: executionFeeds.filter((f) => f.problem).map((f) => `${f.file}: ${f.problem}`) } : {}),
    // A result no path finding carries: the code changed since the test, or the route is gone.
    ...(witnessed.unmatched.length ? { witnessUnmatched: witnessed.unmatched } : {}),
    // Routes the reading refuted that the estate reproduced: the check model was wrong about them.
    ...(witnessed.overruled.length ? { witnessOverruled: witnessed.overruled } : {}),
  };
}

// A set that throws is reported as not having run, and the other sets' findings stand.
const notRun = (set, e) => report(set.name, { rules: set.rules, findings: [], stats: {
  coverageIncomplete: true,
  notRead: `the rule set stopped on an error and reported nothing: ${printable(e?.message ?? e)}`,
} });
function runSet(set, root, o) {
  try { return set.scan(root, o); } catch (e) { return notRun(set, e); }
}

export function scanAll(root, opts = {}) {
  if (opts.repos && opts.repos.length > 1) return scanEach(root, opts);
  const only = opts.only || RULE_SETS;
  // One walk of the tree for the whole scan. Every rule set used to call buildFileIndex(root) for
  // itself, so a scan read every directory entry and resolved every symlink nine times over, and
  // added a tenth walk each time a rule set was added.
  const tree = sharingTree(opts.tree || directoryTree(root, opts));
  const o = { ...opts, tree };
  // One loop over the registry, in its order. A set that is not registered cannot run, and
  // cannot report a silent zero on its own behalf either. The inventory and the sets that read
  // programs share one pass, so each program is read and parsed once.
  const chosen = REGISTRY.filter((set) => only.includes(set.name));
  const stepped = chosen.filter((set) => set.steps);
  const [invResult, ...stepResults] = driveTogether([inventorySteps(root, o), ...stepped.map((set) => set.steps(root, o))], tree);
  if (invResult && invResult.error) throw invResult.error;
  const inv = invResult;
  const byName = new Map(stepped.map((set, k) => [set.name, stepResults[k]]));
  const parts = chosen.map((set) => {
    if (!byName.has(set.name)) return runSet(set, root, o);
    const r = byName.get(set.name);
    return r && r.error ? notRun(set, r.error) : r;
  });

  const flowPart = parts.find(p => p.tool === 'cobolwork-flow');
  const overBudget = flowPart ? flowPart.summary.filesOverBudget || 0 : 0;
  // Each rule set reads a different slice of the tree: the hidden-content rules read JCL and
  // copybooks that no program-based set does. The count that decides whether anything was examined
  // is the widest of them, so a JCL-only tree is scanned rather than reported as holding nothing.
  const bySet = { inventory: { filesScanned: inv.summary.filesScanned, filesUnreadable: inv.summary.filesUnreadable } };
  // A rule set's own tool name is what keys its counts. When one was renamed and this map was not,
  // that set's counts landed under the key `undefined` in every report. Refusing a name with no key
  // means the next rename fails a test instead of shipping.
  for (const p of parts) {
    const name = reportKey(p.tool);
    const s = p.summary;
    // What each set read, and what it did not. The projection used to copy three keys, so the
    // sentence lib/memory.mjs composes when a scan stops early - which files, and why - was written
    // and then discarded here. A report that says coverage is incomplete without saying where is a
    // report that cannot be acted on.
    bySet[name] = {
      filesScanned: s.filesScanned || 0,
      filesUnreadable: s.filesUnreadable || 0,
      ...(s.filesBinary ? { filesBinary: s.filesBinary } : {}),
      ...(s.filesNotRead ? { filesNotRead: s.filesNotRead } : {}),
      ...(s.filesUnparsed ? { filesUnparsed: s.filesUnparsed } : {}),
      ...(s.stoppedBy ? { stoppedBy: s.stoppedBy } : {}),
      ...(s.unreadable?.length ? { unreadable: s.unreadable } : {}),
      ...(s.unparsed?.length ? { unparsed: s.unparsed } : {}),
      ...(s.notRead ? { notRead: s.notRead } : {}),
    };
  }
  const filesRead = Math.max(...Object.values(bySet).map(x => x.filesScanned));
  const unreadInSomeSet = Object.values(bySet).some(x => x.filesUnreadable > 0);
  // Severity and CWE arrive already on the finding, stamped by the set whose table declares the
  // rule. This used to impute both here, defaulting an unrecognised rule id to 'med', which meant
  // a set called on its own returned findings with no severity at all and a typo became a medium
  // finding nobody had written.
  const findings = [];
  // A finding any set places in a program is reached by whatever starts that program, which only
  // the flow set knows.
  const startedBy = parts.find((p) => p.tool === 'cobolwork-flow')?.startedBy || {};
  for (const p of parts) for (const f of p.findings) findings.push(!f.startedBy && f.program && startedBy[f.program] ? { ...f, startedBy: startedBy[f.program] } : { ...f });
  sortFindings(findings);
  // A tree held in memory is read for the fingerprint's line text as it was for the finding.
  const read = tree.kind === 'directory' ? null : (path) => tree.text(resolve(tree.root, path)).text;
  const identity = stampFingerprints(findings, { root, repo: opts.repoName || '', read });
  // Routes a check stops keep their identity too, so a finding a fix clears can be found again here.
  const checked = parts.find((p) => p.tool === 'cobolwork-flow')?.checked || [];
  stampFingerprints(checked, { root, repo: opts.repoName || '', read });

  const estate = applyEstateFacts(findings, checked, root, opts);

  const byRule = tally(findings);
  const bySeverity = {};
  for (const f of findings) bySeverity[f.sev] = (bySeverity[f.sev] || 0) + 1;
  const byEvidence = {};
  for (const f of findings) byEvidence[f.evidence] = (byEvidence[f.evidence] || 0) + 1;

  const report = {
    tool: 'cobolwork',
    schemaVersion: SCHEMA_VERSION,
    summary: {
      findings: findings.length,
      byRule,
      bySeverity,
      byEvidence,
      filesScanned: filesRead,
      bySet,
      programs: inv.summary.programs,
      programFiles: inv.summary.programFiles,
      copybookFiles: inv.summary.copybookFiles,
      jclFiles: inv.summary.jclFiles,
      copiesMissing: inv.summary.copiesMissing,
      filesUnreadable: inv.summary.filesUnreadable,
      cicsPrograms: parts.find(p => p.tool === 'cobolwork-cics')?.summary.cicsPrograms ?? null,
      // A customer's own advisory extract changes what a clean advisory result means, so a scan
      // that used one says which.
      ...(parts.find(p => p.tool === 'cobolwork-build')?.summary.advisoryFeeds ? { advisoryFeeds: parts.find(p => p.tool === 'cobolwork-build').summary.advisoryFeeds } : {}),
      // Which products the advisory rules searched, so a scan with no advisory finding says which
      // products that silence covers.
      ...(parts.find(p => p.tool === 'cobolwork-build')?.summary.advisoryCoverage ? { advisoryCoverage: parts.find(p => p.tool === 'cobolwork-build').summary.advisoryCoverage } : {}),
      crossProgram: parts.find(p => p.tool === 'cobolwork-flow')?.summary.crossProgram ?? 0,
      ...(parts.find(p => p.tool === 'cobolwork-flow')?.summary.entryPoints?.roots ? rollup(findings) : {}),
      ...estate,
      ruleSets: only,
      // Which flow model produced these rows, and which cobolwork. A finding that appears or
      // disappears between two reports is attributable to the model rather than to the code scanned.
      flowModel: FLOW_MODEL,
      toolVersion: TOOL_VERSION,
      // How a finding is known across runs, and how many shared an identity with another.
      identity,
      filesEbcdic: inv.summary.filesEbcdic,
      nosrc: filesRead === 0,
      // Files past the data-flow memory budget were not read by the flow rules. Named, and counted
      // as incomplete coverage, so a partial scan of a very large repository never reads as whole.
      filesOverBudget: overBudget,
      coverageIncomplete: inv.summary.coverageIncomplete || overBudget > 0 || unreadInSomeSet ||
        parts.some(p => p.summary.coverageIncomplete),
      // A rule set that could not run for want of configuration, as distinct from content that
      // could not be read. Named per set, because "recon did not run" and "a copybook is missing"
      // call for different actions from different people.
      // Keyed off both flags. setIncomplete means a set could not run for want of configuration;
      // coverageIncomplete means it ran and did not reach everything. Keying off the first alone
      // meant a set that stopped on the memory reserve set the report's coverage flag and then
      // appeared nowhere in the list of which sets fell short. `kind` says which of the two it is.
      setsIncomplete: parts.filter(p => p.summary.setIncomplete || p.summary.coverageIncomplete)
        .map(p => {
          const s = p.summary;
          const kind = s.coverageIncomplete ? 'coverage' : 'configuration';
          const coverageWhy = s.notRead || s.readInPart
            || (s.filesNotRead ? `${s.filesNotRead} file(s) were not read` : null)
            || (s.filesUnreadable ? `${s.filesUnreadable} file(s) could not be read` : null)
            || (s.programsUnread?.length ? `${s.programsUnread.length} program(s) could not be read, so a step running one reads as unresolved` : null)
            // flow can stop after reading every file, with nothing unread to count
            || (s.stoppedBy ? `${s.filesScanned || 0} file(s) were read, and the analysis stopped because ${stoppedBecause(s.stoppedBy)}` : null);
          const configurationWhy = s.notLooked?.[0] || s.packsRefused?.[0]?.why || s.packCaveats?.[0] || s.problems?.[0];
          return {
            set: reportKey(p.tool),
            kind,
            why: (kind === 'coverage' ? coverageWhy || configurationWhy : configurationWhy || coverageWhy)
              || 'the rule set did not fully run',
          };
        }),
    },
    inventory: {
      formats: inv.summary.formats, missingCopybooks: inv.missingCopybooks, unreadable: inv.unreadable,
      refusedCopies: inv.refusedCopies, ebcdic: inv.ebcdic, symlinks: inv.summary.symlinks, dirsUnreadable: inv.summary.dirsUnreadable,
    },
    findings,
    ...(checked.length ? { checked } : {}),
    ruleText: Object.fromEntries(Object.entries(ALL_RULES).map(([k, v]) => [k, v.text])),
    ruleCwe: Object.fromEntries(Object.entries(ALL_RULES).filter(([, v]) => v.cwe).map(([k, v]) => [k, v.cwe])),
    ruleEvidence: evidenceMap(ALL_RULES),
    ruleImpact: Object.fromEntries(Object.entries(ALL_RULES).filter(([, v]) => v.impact).map(([k, v]) => [k, v.impact])),
    ruleRemedy: Object.fromEntries(Object.entries(ALL_RULES).filter(([, v]) => v.remedy).map(([k, v]) => [k, v.remedy])),
    evidence: EVIDENCE,
    exploitabilityVerdicts: EXPLOITABILITY,
    // Which clause each rule bears on, and what the mapping does not claim. A reader who takes
    // this to an auditor needs both halves.
    ruleCompliance: complianceMap(Object.keys(ALL_RULES)),
    compliance: FRAMEWORKS_LOADED,
    ...(COMPLIANCE_UNLOADED.length ? { complianceUnloaded: COMPLIANCE_UNLOADED } : {}),
  };
  const listed = flowPart?.listed;
  if (listed) Object.defineProperty(report, 'listed', { value: listed, enumerable: false });
  return report;
}
