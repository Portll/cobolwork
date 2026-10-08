// SPDX-License-Identifier: AGPL-3.0-or-later
// The report as SARIF 2.1.0.
//
// SARIF already models nearly everything this project invented separately, and this file used to
// translate rather than project. Three corrections:
//
//   a rule set is a toolComponent. SARIF has first-class support for a tool made of several
//   components - `tool.driver` plus `tool.extensions[]` - each with its own rules and its own
//   notifications. That is exactly what a cobolwork rule set is, and modelling it means a consumer
//   can tell which analysis produced a result without parsing its id.
//
//   files nobody read are notifications. `invocations[].toolExecutionNotifications` is the
//   standard place for "the tool could not read these", and it is where the sentence lib/memory.mjs
//   composes belongs. It used to go into a property bag no SARIF consumer reads.
//
//   a set that could not run is a configuration notification. `toolConfigurationNotifications`
//   says the tool was not told enough, which is a different claim from having read less than it
//   meant to, and the two call for different actions from different people.
//
// What SARIF cannot say is coverage as a ratio with a denominator: "read 8,000 of 12,000, stopped
// on a memory reserve". That quadruple travels in a namespaced property bag. It does NOT travel
// there alone: `coverageIncomplete` is this project's distinguishing promise - a finding count over
// source nobody read is not a clean result - so the verdict stays where nobody can miss it, in
// `executionSuccessful` and as a flat property, and the property bag carries the detail.
import { REGISTRY, ALL_RULES } from './kernel/registry.mjs';
import { stoppedBecause } from './kernel/memory.mjs';
import { FINGERPRINT_VERSION } from './kernel/identity.mjs';
import { DIFF_RULES } from './diff.mjs';

export const LEVEL = { crit: 'error', high: 'error', med: 'warning', low: 'note', info: 'note' };

// Locations are URI references: each segment is encoded, lone surrogates from Windows names replaced first.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export const uriOf = (p) => String(p).split('/').map((seg) => encodeURIComponent(seg.replace(LONE_SURROGATE, '\uFFFD'))).join('/');
// Square brackets in a SARIF message are link syntax, and a finding's text can quote the tree. A
// backslash escapes the character after it, so one before a bracket or a backslash is escaped too.
export const textOf = (s) => (typeof s === 'string' ? s.replace(/\\(?=[\\[\]])|[[\]]/g, '\\$&') : s);
// SARIF's three levels fold critical into high and info into low, so the severity also travels as
// the number GitHub code scanning ranks by. Info is coverage and context, which rank as nothing.
export const SECURITY_SEVERITY = { crit: '9.5', high: '8.0', med: '5.5', low: '3.0' };
const DECLARED = new Map([...Object.entries(ALL_RULES), ...Object.entries(DIFF_RULES)].map(([id, r]) => [id, r.sev]));

// Which rule set declares each rule. Rules with no set - diff's, and the credential pack's - stay
// on the driver, because they are not produced by a rule set.
const SET_OF = new Map();
for (const s of REGISTRY) for (const id of Object.keys(s.rules)) SET_OF.set(id, s.name);

// A related entry without a path is an advisory the finding rests on, not a place in the tree.
const located = (f) => (f.related || []).filter((r) => r.path);

const cweTaxon = (cwe) => /^CWE-(\d+)$/.exec(cwe || '')?.[1] ?? null;

// The CWE taxonomy is run.taxonomies[0] whenever any rule names a CWE.
const CWE_COMPONENT = { name: 'CWE', index: 0 };

// SARIF's level cannot say what kind of claim a result is, so evidence rides in the property bags.
const descriptorFor = (report) => (id) => {
  const properties = {
    ...(report.ruleCwe?.[id] ? { cwe: report.ruleCwe[id] } : {}),
    ...(report.ruleEvidence?.[id] ? { evidence: report.ruleEvidence[id] } : {}),
    ...(report.ruleCompliance?.[id] ? { compliance: report.ruleCompliance[id] } : {}),
    ...(SECURITY_SEVERITY[DECLARED.get(id)] ? { 'security-severity': SECURITY_SEVERITY[DECLARED.get(id)] } : {}),
  };
  const taxon = cweTaxon(report.ruleCwe?.[id]);
  return {
    id,
    shortDescription: { text: report.ruleText?.[id] || id },
    // What the construct lets someone do, and the standard fix - the same for every result of the
    // rule. `help` is where GitHub code scanning shows a recommendation.
    ...(report.ruleImpact?.[id] ? { fullDescription: { text: textOf(report.ruleImpact[id]) } } : {}),
    ...(report.ruleRemedy?.[id] ? { help: { text: textOf(report.ruleRemedy[id]) } } : {}),
    ...(taxon ? { relationships: [{ target: { id: taxon, toolComponent: CWE_COMPONENT } }] } : {}),
    ...(Object.keys(properties).length ? { properties } : {}),
  };
};

function cweTaxonomy(report, ruleIds) {
  const taxa = [...new Set(ruleIds.map((id) => cweTaxon(report.ruleCwe?.[id])).filter(Boolean))].sort((a, b) => a - b);
  if (!taxa.length) return [];
  return [{
    name: CWE_COMPONENT.name,
    organization: 'MITRE',
    shortDescription: { text: 'Common Weakness Enumeration' },
    informationUri: 'https://cwe.mitre.org/',
    taxa: taxa.map((id) => ({ id, helpUri: `https://cwe.mitre.org/data/definitions/${id}.html` })),
  }];
}

function notifications(report) {
  const bySet = report.summary?.bySet || {};
  const execution = [];
  const configuration = [];

  for (const [set, s] of Object.entries(bySet)) {
    const shortfall = (s.filesNotRead || 0) + (s.filesUnreadable || 0) + (s.filesUnparsed || 0);
    if (!shortfall) continue;
    execution.push({
      descriptor: { id: 'cobolwork/files-not-read' },
      level: 'warning',
      message: {
        text: s.notRead
          || `${set}: ${shortfall} file(s) did not contribute to this run`
            + (s.stoppedBy ? `, because ${stoppedBecause(s.stoppedBy)}` : ''),
      },
      properties: {
        set,
        ...(s.filesNotRead ? { filesNotRead: s.filesNotRead } : {}),
        ...(s.filesUnreadable ? { filesUnreadable: s.filesUnreadable } : {}),
        ...(s.filesUnparsed ? { filesUnparsed: s.filesUnparsed } : {}),
        ...(s.stoppedBy ? { stoppedBy: s.stoppedBy } : {}),
        ...(s.unreadable?.length ? { unreadable: s.unreadable } : {}),
        ...(s.unparsed?.length ? { unparsed: s.unparsed } : {}),
      },
    });
  }

  // A set that could not run at all, as distinct from one that ran and read less than the tree.
  const named = new Set(execution.map((n) => n.properties.set));
  for (const { set, kind, why } of report.summary?.setsIncomplete || []) {
    if (named.has(set)) continue;
    if (kind === 'coverage') {
      execution.push({
        descriptor: { id: 'cobolwork/read-in-part' },
        level: 'warning',
        message: { text: textOf(`${set}: ${why}`) },
        properties: { set },
      });
      continue;
    }
    configuration.push({
      descriptor: { id: 'cobolwork/rule-set-did-not-run' },
      level: 'warning',
      message: { text: textOf(`${set}: ${why}`) },
      properties: { set },
    });
  }
  for (const [id, warnings] of [['cobolwork/site-key-ignored', report.summary?.siteWarnings], ['cobolwork/feed-key-ignored', report.summary?.feedWarnings]]) {
    for (const w of warnings || []) configuration.push({ descriptor: { id }, level: 'warning', message: { text: textOf(w) } });
  }
  // A diff whose two sides were scanned under different configuration.
  for (const { file, change } of report.summary?.configurationChanged || []) {
    configuration.push({
      descriptor: { id: 'cobolwork/configuration-changed' },
      level: 'warning',
      message: { text: textOf(`${file} ${change}`) },
      properties: { file },
    });
  }
  return { execution, configuration };
}

export function toSarif(report, { toolVersion = '0.1.0' } = {}) {
  const describe = descriptorFor(report);
  // A suppressed finding is still a result, marked as one a person judged, so its rule is described.
  const suppressed = report.suppressed || [];
  const present = [...new Set([...report.findings, ...suppressed].map((f) => f.rule))].sort();

  // One component per rule set that produced anything, in registry order so two runs of the same
  // tree compare.
  const sets = REGISTRY.map((s) => s.name).filter((name) => present.some((id) => SET_OF.get(id) === name));
  const extensions = sets.map((name) => ({
    name: `cobolwork-${name}`,
    version: toolVersion,
    rules: present.filter((id) => SET_OF.get(id) === name).map(describe),
  }));
  const indexOfSet = new Map(sets.map((name, i) => [name, i]));

  // Anything no rule set declares belongs to the driver: diff's rules, and the credential pack's.
  const driverRules = present.filter((id) => !SET_OF.has(id)).map(describe);

  const { execution, configuration } = notifications(report);
  const s = report.summary || {};
  const taxonomies = cweTaxonomy(report, present);

  // Every file a result or related location names, each listed once; locations point at it by index.
  const results = [...report.findings, ...suppressed];
  const uris = [...new Set(results.flatMap((f) => [f.path, ...located(f).map((r) => r.path)]).map(uriOf))].sort();
  const artifactIndex = new Map(uris.map((uri, i) => [uri, i]));
  const artifactLocation = (path) => {
    const uri = uriOf(path);
    return { uri, uriBaseId: '%SRCROOT%', index: artifactIndex.get(uri) };
  };

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'cobolwork',
          version: toolVersion,
          informationUri: 'https://github.com/Portll/cobolwork',
          rules: driverRules,
        },
        ...(extensions.length ? { extensions } : {}),
      },
      ...(taxonomies.length ? { taxonomies } : {}),
      invocations: [{
        // The verdict, where a consumer that reads nothing else will still see it.
        executionSuccessful: s.nosrc !== true,
        exitCode: 0,
        ...(execution.length ? { toolExecutionNotifications: execution } : {}),
        ...(configuration.length ? { toolConfigurationNotifications: configuration } : {}),
        properties: {
          ...(s.filesScanned === undefined ? {} : { filesScanned: s.filesScanned }),
          ...(s.coverageIncomplete === undefined ? {} : { coverageIncomplete: s.coverageIncomplete }),
          ...(s.copiesMissing ? { copiesMissing: s.copiesMissing } : {}),
          ...(s.filesUnreadable ? { filesUnreadable: s.filesUnreadable } : {}),
          ...(s.advisoryFeeds ? { 'cobolwork/advisoryFeeds': s.advisoryFeeds } : {}),
          ...(s.advisoryCoverage ? { 'cobolwork/advisoryCoverage': s.advisoryCoverage } : {}),
          ...(s.toolRevision !== undefined ? { 'cobolwork/toolRevision': s.toolRevision } : {}),
          ...(s.revision !== undefined ? { 'cobolwork/revision': s.revision } : {}),
          // The part SARIF has no vocabulary for. Namespaced so it cannot be mistaken for
          // standard fields, and documented in schema/cobolwork-coverage.schema.json.
          'cobolwork/coverage': {
            coverageIncomplete: s.coverageIncomplete === true,
            filesScanned: s.filesScanned ?? null,
            ...(s.bySet ? { bySet: s.bySet } : {}),
            ...(s.setsIncomplete?.length ? { setsIncomplete: s.setsIncomplete } : {}),
          },
        },
      }],
      ...(uris.length ? { artifacts: uris.map((uri) => ({ location: { uri, uriBaseId: '%SRCROOT%' } })) } : {}),
      results: results.map((f) => {
        const set = SET_OF.get(f.rule);
        const component = set !== undefined ? indexOfSet.get(set) : undefined;
        const within = component === undefined ? null : extensions[component].rules.findIndex((r) => r.id === f.rule);
        return {
          ruleId: f.rule,
          // Which component declares this rule. A consumer that resolves ruleId against the driver
          // still works; one that follows the reference learns which analysis produced the result.
          ...(within != null && within >= 0
            ? { rule: { id: f.rule, index: within, toolComponent: { index: component } } }
            : {}),
          level: LEVEL[f.sev] || 'warning',
          message: { text: textOf(f.detail) },
          // The whole identity, computed by the tool, so it is both the fingerprint and the one
          // partial fingerprint a result-management system needs to track it.
          ...(f.fingerprint ? {
            fingerprints: { [FINGERPRINT_VERSION]: f.fingerprint },
            partialFingerprints: { [FINGERPRINT_VERSION]: f.fingerprint },
          } : {}),
          // Per result: an info pack rule is context under a rule id that is a construct, and a
          // checked path is a step below what its rule declares.
          ...(f.evidence || f.sev ? { properties: {
            ...(f.evidence ? { evidence: f.evidence } : {}),
            ...(f.sev ? { severity: f.sev } : {}),
            ...(SECURITY_SEVERITY[f.sev] ? { 'security-severity': SECURITY_SEVERITY[f.sev] } : {}),
            ...(f.guard ? { guard: f.guard, guardedFrom: f.guardedFrom } : {}),
            // Who can drive the finding and what it runs as, when the estate declared the facts.
            ...(f.reach ? { reach: f.reach } : {}),
            ...(f.effect ? { effect: f.effect } : {}),
            ...(f.exploitability ? { exploitability: f.exploitability } : {}),
            // How an abend's input reached the program: through its own entry, or as arguments to
            // a subprogram no caller run is shown to pass.
            ...(f.abend?.inputFrom ? { inputFrom: f.abend.inputFrom } : {}),
          } } : {}),
          locations: [{ physicalLocation: { artifactLocation: artifactLocation(f.path), region: { startLine: f.line || 1 } } }],
          ...(located(f).length ? { relatedLocations: located(f).map((r) => ({ physicalLocation: { artifactLocation: artifactLocation(r.path), region: { startLine: r.line || 1 } }, message: { text: textOf(r.detail) } })) } : {}),
          ...(f.suppressed ? { suppressions: [{ kind: 'external', status: 'accepted', justification: `${f.suppressed.action} by ${f.suppressed.who} until ${f.suppressed.expires}: ${f.suppressed.reason}` }] } : {}),
        };
      }),
    }],
  };
}
