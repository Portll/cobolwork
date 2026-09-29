// SPDX-License-Identifier: AGPL-3.0-or-later
// Verbs that belong to a product rather than to the platform, from packs the estate has asked for.
//
// Nothing here loads unless cobolwork.site.json names the pack, so a shop that does not run the
// product sees no rules for it. That is the feature: the commonest complaint about enterprise
// static analysis is noise from things the shop does not have.
import { inScope, isJcl, relPath } from '../sources.mjs';
import { report } from '../kernel/ruleset.mjs';
import { treeFor, noteUnread, noteUnparsed } from '../kernel/source-tree.mjs';
import { parseJcl } from '../jcl.mjs';
import { eachWithinMemory } from '../kernel/memory.mjs';
import { loadPacks, compilePack, availablePacks } from '../packs.mjs';
import { loadSite } from '../site.mjs';


export const VENDOR_RULES = {
  'vendor-privileged-command': {
    sev: 'high', evidence: 'construct', cwe: 'CWE-284',
    text: 'A job issues a vendor product command that creates, grants or alters authority',
    impact: "An in-stream command or step invokes a vendor product's privileged function (ACF2/Top Secret, Control-M, Connect:Direct), so anyone who can edit the job exercises that authority when it runs",
    remedy: "Move the privileged product command out of the application job into the product's controlled administration path, or restrict who may submit the job",
  },
};

// An info pack rule says a product is in use, not that anything is wrong.
const evidenceOf = (r) => (r.severity === 'info' ? { evidence: 'context' } : {});

export function scanVendor(root, opts = {}) {
  const site = loadSite(root, opts.site || null);
  const wanted = opts.packs || site.vendorPacks || [];
  const { loaded, refused, problems, caveats } = loadPacks(wanted, {
    allowUnvalidated: !!(opts.allowUnvalidatedPacks ?? site.allowUnvalidatedPacks),
    ...(opts.packDir ? { packDir: opts.packDir } : {}),
  });
  const rules = loaded.flatMap(compilePack);

  const stats = {
    filesScanned: 0, filesUnreadable: 0,
    packsRequested: wanted, packsLoaded: loaded.map((p) => p.name),
    packsRefused: refused, packsAvailable: availablePacks(), problems,
    // A pack that loaded on partial validation says which half it is missing, every time.
    packCaveats: caveats,
    rulesLoaded: rules.length,
    // A pack asked for and not loaded means this rule set ran less than the caller believes. It
    // is a configuration gap rather than an unread file, so it is reported as one.
    setIncomplete: refused.length > 0 || problems.length > 0 || caveats.length > 0,
  };

  // No pack loaded means no rule can fire, but the shape of what is returned does not change:
  // a consumer reading this report should not have to know why it is empty to read it.
  if (!rules.length) return report('vendor', { rules: VENDOR_RULES, findings: [], stats, run: null });

  const tree = treeFor(root, opts);
  const files = tree.list().filter(inScope(opts)).filter(isJcl);
  const findings = [];

  // A job that fails to parse has still been read, so its bytes count against the budget even
  // though nothing came of them. Only a file that could not be opened at all costs nothing.
  const run = eachWithinMemory(files, (f) => {
    let src;
    try { src = tree.text(f).text; } catch (e) { noteUnread(stats, tree, f, e); return 0; }
    let job;
    try { job = parseJcl(src, f); } catch (e) { noteUnparsed(stats, tree, f, e); return src.length; }
    stats.filesScanned++;
    const path = relPath(root, f);

    // A pack rule matches either the program a step runs or a line of in-stream data. Both are
    // needed: the utility that reaches the product is named on the EXEC statement, and what it is
    // told to do is in the stream below it. A rule scoped only to the stream can never match a
    // program name, which is a rule that never fires at all.
    for (const step of job.steps) {
      if (!step.pgm) continue;
      for (const r of rules) {
        if (!r.appliesTo.includes('jcl-step')) continue;
        if (!r.re.test(step.pgm)) continue;
        findings.push({
          rule: 'vendor-privileged-command', path, line: step.line, step: step.name,
          sev: r.severity, ...evidenceOf(r),
          detail: `${r.vendor} ${r.product}: step ${step.name || '(unnamed)'} runs ${step.pgm}, which ${r.risk}`,
          pack: r.pack, packRule: r.id,
        });
        break;
      }
    }

    for (const dd of job.dds) {
      if (!dd.inStream) continue;
      // Some of these command languages are mode-based: ACF2's SET LID puts the session into
      // logonid maintenance, and the INSERT statements that follow mean something different from
      // an INSERT anywhere else. Without that context the rule matched SQL INSERT INTO in DB2
      // create scripts - 322 times across a 125-repository corpus, which is how it was found.
      const context = new Set();
      for (const line of dd.inStream) {
        for (const r of rules) {
          if (r.setsContext && r.setsContextRe.test(line.text)) context.add(r.setsContext);
        }
        for (const r of rules) {
          if (!r.appliesTo.includes('jcl-instream')) continue;
          if (r.requiresContext && !context.has(r.requiresContext)) continue;
          if (!r.re.test(line.text)) continue;
          findings.push({
            rule: 'vendor-privileged-command', path, line: line.line, step: dd.step,
            sev: r.severity, ...evidenceOf(r),
            detail: `${r.vendor} ${r.product}: ${r.verb} ${r.risk}, from step ${dd.step || '(none)'} in //${dd.name || 'a DD'}`,
            pack: r.pack, packRule: r.id,
          });
          break;                         // one line is one finding, as elsewhere
        }
      }
    }
    return src.length;
  }, { label: 'vendor', maxBytes: opts.maxSourceBytes ?? Infinity });

  // setIncomplete above means a pack was asked for and not loaded, a different shortfall from
  // jobs the scan never opened. Both travel, and they call for different actions.
  return report('vendor', { rules: VENDOR_RULES, findings, stats, run });
}
