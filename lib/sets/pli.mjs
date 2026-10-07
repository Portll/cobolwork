// SPDX-License-Identifier: AGPL-3.0-or-later
// PL/I programs read statement by statement (lib/pli): where they address storage through a pointer,
// call through an entry variable or use the preprocessor, which a static reading cannot follow, and
// ON units that swallow their condition. Data flow through PL/I is the flow set's; this set reports
// what the program text itself shows, and counts every statement the reader could not parse.
import { inScope, isPli, relPath } from '../sources.mjs';
import { report } from '../kernel/ruleset.mjs';
import { treeFor, noteUnread } from '../kernel/source-tree.mjs';
import { eachWithinMemory } from '../kernel/memory.mjs';
import { readPli } from '../pli/lex.mjs';
import { parseStatement } from '../pli/statements.mjs';
import { PLI_RULES, checkProgram } from '../pli/rules/index.mjs';

export { PLI_RULES };

export function scanPli(root, opts = {}) {
  const tree = treeFor(root, opts);
  const files = tree.list().filter(inScope(opts)).filter(isPli);
  const stats = { filesScanned: 0, filesUnreadable: 0, statements: 0, statementsParsed: 0 };
  const notParsed = {};
  const findings = [];
  const run = eachWithinMemory(files, (f) => {
    let src;
    try { src = tree.text(f).text; } catch (e) { noteUnread(stats, tree, f, e); return 0; }
    const path = relPath(root, f);
    const statements = readPli(src, { file: path }).statements.map((st) => ({ ...st, parsed: parseStatement(st) }));
    stats.filesScanned++;
    for (const st of statements) {
      stats.statements++;
      if (st.parsed.status === 'parsed') { stats.statementsParsed++; continue; }
      (notParsed[st.parsed.kind || 'UNKNOWN'] ||= { count: 0, first: `${path}:${st.line}` }).count++;
    }
    findings.push(...checkProgram({ path, statements }));
    return src.length;
  }, { label: 'pli', maxBytes: opts.maxSourceBytes ?? Infinity });

  // A statement the reader could not parse may hold a pointer, an entry call or an ON unit.
  if (Object.keys(notParsed).length) { stats.statementsNotParsed = notParsed; stats.coverageIncomplete = true; }
  return report('pli', { rules: PLI_RULES, findings, stats, run });
}
