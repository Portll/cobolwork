// SPDX-License-Identifier: AGPL-3.0-or-later
// IMS database and program definitions: what a PSB lets a program change, SENSEGs that name segments
// their DBD does not define, and what DBDGEN, PSBGEN or ACBGEN refuses (lib/ims/rules.mjs). DBDs and
// PSBs are assembler macros and are often named .asm, so assembler files are read too, and kept only
// where they hold a DBD or PSB.
import { inScope, isAssembler, isIms, relPath } from '../sources.mjs';
import { report } from '../kernel/ruleset.mjs';
import { treeFor, noteUnread } from '../kernel/source-tree.mjs';
import { eachWithinMemory } from '../kernel/memory.mjs';
import { modelOf } from '../ims/model.mjs';
import { IMS_RULES, checkModels } from '../ims/rules.mjs';

export { IMS_RULES };

export function scanIms(root, opts = {}) {
  const tree = treeFor(root, opts);
  const files = tree.list().filter(inScope(opts)).filter((f) => isIms(f) || isAssembler(f));
  const stats = { filesScanned: 0, filesUnreadable: 0, dbdFiles: 0, psbFiles: 0 };
  const models = [];
  const unread = {};
  const run = eachWithinMemory(files, (f) => {
    let src;
    try { src = tree.text(f).text; } catch (e) { noteUnread(stats, tree, f, e); return 0; }
    const model = modelOf(src);
    if (!model) return src.length;
    stats.filesScanned++;
    stats[model.kind === 'DBD' ? 'dbdFiles' : 'psbFiles']++;
    const path = relPath(root, f);
    for (const u of model.unread) (unread[u.operation || 'UNREADABLE'] ||= { count: 0, first: `${path}:${u.line}` }).count++;
    models.push({ path, model });
    return src.length;
  }, { label: 'ims', maxBytes: opts.maxSourceBytes ?? Infinity });

  // A statement the reader refused may hold a segment, a field or a PCB the rules never saw.
  if (Object.keys(unread).length) { stats.statementsNotRead = unread; stats.coverageIncomplete = true; }
  return report('ims', { rules: IMS_RULES, findings: checkModels(models), stats, run });
}
