// SPDX-License-Identifier: AGPL-3.0-or-later
// Which clause of which framework makes a finding someone's obligation.
//
// A scanner's output is a list of defects. An audit exhibit is a list of obligations with evidence
// against each. The difference between them is this file, and it is the difference between a
// tooling budget and a compliance budget.
//
// DORA, NIST SP 800-53 and the FFIEC IT Examination Handbook ship with quotes because their
// instruments may be reproduced: one is EU law, the other two US Government works. COBIT 2019 ships
// as identifiers with this project's own rationale and no ISACA text. PCI DSS may not be
// redistributed and is not mapped.
//
// A framework may decline to cover a rule. Neither NIST nor FFIEC has a control that genuinely
// covers committing an LPAR name to a repository, and that is recorded as an unmapped rule with a
// reason rather than mapped to the nearest thing that reads plausibly.
import { readFileSync, existsSync } from 'node:fs';

const FRAMEWORKS = [
  { id: 'dora', file: '../rules/compliance-dora.json' },
  { id: 'nist-800-53r5', file: '../rules/compliance-nist80053.json' },
  { id: 'ffiec', file: '../rules/compliance-ffiec.json' },
  { id: 'cobit-2019', file: '../rules/compliance-cobit2019.json' },
];

// A framework that will not parse is a framework this scan cannot map against, which is the same
// claim as one that is absent, and is recorded the same way. It is not a reason for the tool to
// stop: these three files are generated, they are committed, and a half-written one used to take
// `--help` down with a raw SyntaxError before it printed a line.
//
// The readers are arguments so this is testable without truncating a committed file, which on a
// tree several people share is a worse idea than the bug.
export function readFrameworks(entries, read = (u) => readFileSync(u, 'utf8'), exists = existsSync) {
  const ok = [];
  const bad = [];
  for (const f of entries) {
    const url = new URL(f.file, import.meta.url);
    if (!exists(url)) { bad.push({ id: f.id, why: 'the file is not present' }); continue; }
    try {
      ok.push(JSON.parse(read(url)));
    } catch (e) {
      bad.push({ id: f.id, why: `the file did not parse: ${e.message}` });
    }
  }
  return { loaded: ok, unloaded: bad };
}

const { loaded, unloaded } = readFrameworks(FRAMEWORKS);
// Which of the three this scan could not map against. A compliance matrix produced with one of
// them missing is not a matrix with nothing to say about it; it is a matrix nobody could build.
export const FRAMEWORKS_UNLOADED = unloaded;

export const FRAMEWORKS_LOADED = loaded.map((d) => ({
  framework: d.framework, instrument: d.instrument, retrieved: d.retrieved,
  // What the mapping does not claim travels with it. A matrix that does not say where it stops
  // invites a reader to assume it stops nowhere.
  coverage: d.coverage, verified: d.verified, appliesToTool: d.appliesToTool || [],
  unmapped: d.unmapped || [],
}));

// Rules a framework deliberately does not cover, so a reader can tell "no obligation" from
// "nobody looked".
export const unmappedBy = Object.fromEntries(loaded.map((d) => [d.framework, (d.unmapped || []).map((u) => u.ruleId)]));

const byRule = new Map();
for (const d of loaded) {
  for (const r of d.rows) {
    if (!byRule.has(r.ruleId)) byRule.set(r.ruleId, []);
    byRule.get(r.ruleId).push({ framework: r.framework, clause: r.clause, ...(r.title ? { title: r.title } : {}) });
  }
}

export const clausesFor = (ruleId) => byRule.get(ruleId) || [];

// The whole map, in the shape the report's other rule maps use.
export function complianceMap(ruleIds) {
  const out = {};
  for (const id of ruleIds) {
    const c = clausesFor(id);
    if (c.length) out[id] = c;
  }
  return out;
}
