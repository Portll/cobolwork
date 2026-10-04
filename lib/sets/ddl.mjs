// SPDX-License-Identifier: AGPL-3.0-or-later
// Db2 for z/OS DDL: what a GRANT opens to PUBLIC or lets a grantee pass on, system and database
// authorities granted, and the exit routines and external load modules that run inside Db2
// (lib/db2/rules.mjs). A statement in another dialect is refused by the reader and counted as not
// read, never matched as if it were Db2.
import { inScope, isDb2, relPath } from '../sources.mjs';
import { report } from '../kernel/ruleset.mjs';
import { treeFor, noteUnread } from '../kernel/source-tree.mjs';
import { eachWithinMemory } from '../kernel/memory.mjs';
import { readDb2, parseDb2Statement } from '../db2/read.mjs';
import { DB2_RULES, statementFindings } from '../db2/rules.mjs';

export { DB2_RULES };

export function scanDb2(root, opts = {}) {
  const tree = treeFor(root, opts);
  const files = tree.list().filter(inScope(opts)).filter(isDb2);
  const stats = { filesScanned: 0, filesUnreadable: 0, statementsRead: 0 };
  const findings = [];
  const unread = {};
  const run = eachWithinMemory(files, (f) => {
    let src;
    try { src = tree.text(f).text; } catch (e) { noteUnread(stats, tree, f, e); return 0; }
    stats.filesScanned++;
    const path = relPath(root, f);
    for (const st of readDb2(src).statements) {
      const r = parseDb2Statement(st);
      if (r.status === 'parsed') { stats.statementsRead++; findings.push(...statementFindings(path, st, r)); }
      else (unread[r.kind] ||= { count: 0, first: `${path}:${st.line}` }).count++;
    }
    return src.length;
  }, { label: 'ddl', maxBytes: opts.maxSourceBytes ?? Infinity });

  if (Object.keys(unread).length) { stats.statementsNotRead = unread; stats.coverageIncomplete = true; }
  return report('ddl', { rules: DB2_RULES, findings, stats, run });
}
