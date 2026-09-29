// SPDX-License-Identifier: AGPL-3.0-or-later
// What every rule set does with a finding once it has one: put it in order, stamp it with the
// severity its rule declares, and count it.
//
// These were twelve copies of a comparator, thirteen sort sites in five variants and eight tally
// loops. The variants were not deliberate. One set sorted without the rule in the key, so two
// findings at the same place came back in whichever order they were pushed; another dropped the
// line entirely. Neither was wrong on purpose, and neither would ever have been noticed, because a
// report that is stably sorted the wrong way looks exactly like a report that is sorted.
//
// The severity stamping mattered more. It did not live in a rule set at all: lib/scan.mjs imputed
// it while merging, defaulting to 'med' for anything it did not recognise. So a set called on its
// own returned findings with no severity, and a rule id with a typo in it became a medium finding
// nobody had written. toSarif maps an absent severity to 'warning', which meant a crit credential
// finding could leave the tool as a warning.

export const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Rule, then path, then line. A finding carrying no line sorts as line 0 rather than NaN, which is
// what `undefined - undefined` produces and what silently makes a sort do nothing at all.
export const compareFindings = (a, b) =>
  byText(a.rule, b.rule) || byText(a.path, b.path) || (a.line || 0) - (b.line || 0);

// Sorts in place and returns the same array, so it reads as the last step of building one.
export const sortFindings = (findings) => findings.sort(compareFindings);

export function tally(findings) {
  const byRule = {};
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  return byRule;
}

// What kind of claim a finding makes. `coverage` and `context` are not defects.
export const EVIDENCE = Object.freeze({
  path: 'untrusted input was traced to a sensitive operation, and the route it took is recorded',
  construct: 'the construct is a defect wherever it appears; no input has to reach it',
  tampering: 'the source is arranged so a reader or a resolver sees something other than what runs',
  advisory: 'a component version matches a published advisory against it',
  exposure: 'information about the estate is written into the source',
  change: 'a change moves an interface or adds a call target, which a reviewer has to look at',
  coverage: 'the analysis stopped following here; a limit of the tool, not a defect in the code',
  context: 'describes the estate - an entry point, a product in use - and asserts no defect',
});

// Whether an attacker can use a path finding, most urgent first. lib/exploitability.mjs decides it.
export const EXPLOITABILITY = Object.freeze({
  confirmed: 'the estate reproduced it on a system it owns and brought the result as a witness feed',
  exploitable: 'input an attacker supplies reaches the operation with no check on every route, and the estate declares an entry that carries it open to any user',
  'attacker-driven': 'input whoever runs an entry supplies reaches the operation with no check on every route; the estate has not declared who may run that entry',
  restricted: 'input reaches the operation with no check on every route, and every entry that carries it is behind a control the estate named',
  mitigated: 'input reaches the operation, but a check runs first on every route, or SSRANGE turns an overrun into an abend',
  upstream: 'the value comes from a file record or a database row, so whoever can write that data drives it',
  refuted: 'no harmful value arrives: a check leaves only values the operation can take, or no route reaches it',
});

export const WHO_ACTS = Object.freeze({
  path: "the program's owner",
  construct: 'the owner, or whoever can rotate a credential',
  tampering: 'a reviewer, before merge',
  advisory: 'whoever owns the build',
  exposure: 'the owner',
  change: 'the reviewer of that change',
  coverage: "nobody's code: read more, or accept the limit",
  context: 'nobody: it asserts no defect',
});

// Severity, CWE and evidence come from the table that declares the rule, and from nowhere else.
//
// A finding that already carries any of them keeps it: a vendor pack rule brings its own severity,
// and the copybook set demotes a shadowing that is latent rather than live. Anything else is stamped
// from the table.
//
// A rule id the table does not declare is refused rather than defaulted. The id is almost always a
// typo, and the alternative is publishing a finding whose severity nobody chose.
export function withMeta(rules, findings, set = 'rule set') {
  for (const f of findings) {
    const meta = rules[f.rule];
    if (!meta) {
      throw Object.assign(
        new Error(`${set}: a finding names rule '${f.rule}', which this rule set does not declare`),
        { code: 'ERULEID', rule: f.rule, set },
      );
    }
    if (f.sev === undefined || f.sev === null) f.sev = meta.sev;
    if (f.cwe === undefined) f.cwe = meta.cwe ?? null;
    if (f.evidence === undefined) f.evidence = meta.evidence;
    if (!Object.hasOwn(EVIDENCE, f.evidence)) {
      throw Object.assign(
        new Error(`${set}: rule '${f.rule}' declares evidence '${f.evidence}', which is not one of ${Object.keys(EVIDENCE).join(', ')}`),
        { code: 'EEVIDENCE', rule: f.rule, set },
      );
    }
  }
  return findings;
}

export const evidenceMap = (rules) =>
  Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, v.evidence]));

// The three steps in the order every rule set takes them.
export function finish(rules, findings, set) {
  withMeta(rules, findings, set);
  sortFindings(findings);
  return { findings, byRule: tally(findings) };
}
