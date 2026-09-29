// SPDX-License-Identifier: AGPL-3.0-or-later
// What a rule set says about itself once it has finished looking.
//
// Eight sets wrote the same closing five lines: take the guarded loop's account of what it did not
// reach, stamp the findings, tally them, and assemble a summary. The assembly varied, and none of
// the variation was a decision - one set set coverageIncomplete inside its stats, another passed it
// in the returned object, a third ORed it with a flag from the JCL parser, and one had a second
// return site that skipped the whole thing and shipped a different shape.
//
// That last one matters more than tidiness. SECURITY.md treats a report that overstates coverage as
// a security bug rather than a defect: a file the tool failed to read while still reporting
// coverageIncomplete: false is the failure this project exists to prevent. Eight hand-written
// copies of the code that makes that claim is eight places for it to be wrong, and the one that was
// wrong was found by a test rather than by reading.
//
// WHAT THIS IS NOT. The specification proposed a `defineRuleSet({ perFile, finish })` harness that
// would own each set's control flow and refuse a perFile that returned a parse tree. That is not
// what this is, and the difference is deliberate. By the time this was written the traversal, the
// reading, the parse configuration, the sort, the severity stamping and the tally had all moved
// into lib/kernel/ on their own - so the inversion would have restructured nine working sets to
// take ownership of what it already had. The ETREELEAK guard went with it: it only guards a
// perFile that does not exist, and a set that accumulates parse trees in its own closure is
// something no harness can prevent. What remains is the closing assembly, which is the part that
// was still duplicated and the part that makes a security claim.
import { finish } from './findings.mjs';

// A set's tool name is its report key with the tool's name in front. It lives here rather than in
// the registry because the registry imports every rule set, and every rule set imports this: taking
// the name from there would close the loop, and the error a circular import gives - "cannot access
// X_RULES before initialization" - names the rule table rather than the cycle that broke it.
export const toolName = (name) => `cobolwork-${name}`;

// `run` is what eachWithinMemory returned, or null for a set that did not traverse - a set refusing
// to run for want of configuration still has to report in the same shape as one that ran.
export function report(name, { rules, findings, stats = {}, run = null }) {
  const skipped = run ? run.skipped.length : 0;

  // The guarded loop's account of what it did not get to. Written here so every set says it the
  // same way, which is the same reason lib/memory.mjs composes the sentence rather than each
  // caller writing its own.
  if (run) {
    if (skipped) stats.filesNotRead = skipped;
    if (run.stoppedBy) stats.stoppedBy = run.stoppedBy;
    if (run.peakHeapBytes) stats.peakHeapBytes = run.peakHeapBytes;
    if (run.note) stats.notRead = run.note;
  }

  const { byRule } = finish(rules, findings, name);

  return {
    tool: toolName(name),
    summary: {
      findings: findings.length,
      byRule,
      ...stats,
      // ORed, never overwritten. A set may already know its reading was short for a reason the
      // loop knows nothing about - the JCL parser reporting an INCLUDE it could not resolve, for
      // one - and that claim must survive being combined with this one.
      //
      // A file opened and not understood is a file that did not contribute, exactly like one the
      // loop never reached: the set has no findings from it and cannot say there were none. Only
      // the compile set had joined those up, by hand, and the other nine reported complete coverage
      // over source they could not parse - which is the I4 failure SECURITY.md calls a security bug
      // rather than a defect. lib/sarif.mjs already counted all three as a shortfall, so the two
      // halves of the tool disagreed about what a clean result means.
      coverageIncomplete: stats.coverageIncomplete === true || skipped > 0
        || (stats.filesUnparsed || 0) > 0 || (stats.filesUnreadable || 0) > 0,
      nosrc: (stats.filesScanned || 0) === 0,
    },
    findings,
  };
}
