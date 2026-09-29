// SPDX-License-Identifier: AGPL-3.0-or-later
import { dirname } from 'node:path';
import { parseSource, buildFileIndex, detectFormat } from './parser.mjs';
import { inScope, isCopybook, isJcl, isProgram, readSource, relPath } from './sources.mjs';
import { SCHEMA_VERSION, TOOL_VERSION } from './version.mjs';
import { treeFor } from './kernel/source-tree.mjs';

const SYSTEM_COPY = /^(?:(?:DFH|DSN|CEE|IGZ|EZA|BPX|CSQ|CMQ|DLI)[A-Z0-9$#@]{0,5}|SQLCA|SQLDA|ATTRIB)$/i;

// What the repository contains and, as importantly, what could not be read: a scan over a tree
// whose copybooks are missing has not examined what it appears to have examined.
export function inventory(root, opts = {}) {
  const tree = treeFor(root, opts);
  const idx = tree.index;
  const files = tree.list().filter(inScope(opts));
  const out = {
    tool: 'cobolwork-inventory',
    schemaVersion: SCHEMA_VERSION,
    summary: {
      toolVersion: TOOL_VERSION,
      filesScanned: 0, programs: 0, programFiles: 0, copybookFiles: 0, jclFiles: 0,
      copiesResolved: 0, copiesMissing: 0, copiesSystem: 0, copiesRefused: 0, copiesRecursive: 0, filesUnreadable: 0, filesEbcdic: 0,
      notPrograms: 0, dirsUnreadable: idx.unreadableDirs.length, symlinks: idx.symlinks,
      withEmbeddedSql: 0, withCics: 0, withDli: 0, formats: {}, nosrc: false,
    },
    missingCopybooks: {},
    refusedCopies: [],
    unreadable: idx.unreadableDirs.map(d => `${relPath(root, d) || '.'}/: directory not readable`),
    ebcdic: [],
    recursiveCopybooks: {},
  };
  for (const f of files) {
    if (isCopybook(f)) out.summary.copybookFiles++;
    if (isJcl(f)) out.summary.jclFiles++;
    if (!isProgram(f)) continue;
    out.summary.programFiles++;
    let src;
    try {
      const s = readSource(f);
      src = s.text;
      if (s.encoding === 'ebcdic') { out.summary.filesEbcdic++; out.ebcdic.push(relPath(root, f)); }
    } catch (e) { out.summary.filesUnreadable++; out.unreadable.push(`${relPath(root, f)}: ${e.code || e.name}`); continue; }
    // A file with a program extension and no program in it is usually a copybook named .cbl; it is
    // counted so the difference between program files and programs read is accounted for.
    if (!/PROCEDURE\s+DIVISION|PROGRAM-ID/i.test(src)) { out.summary.notPrograms++; continue; }
    let res;
    try {
      res = parseSource(src, f, { format: 'auto', includeDirs: idx.copyDirs, fileIndex: idx.index, mainDir: dirname(f), copyFormat: 'auto', systemDirs: opts.systemDirs || [] });
    } catch (e) {
      out.summary.filesUnreadable++;
      out.unreadable.push(`${relPath(root, f)}: ${e.code || e.name}`);
      continue;
    }
    out.summary.filesScanned++;
    out.summary.programs += res.programs.length;
    const fmt = detectFormat(src);
    out.summary.formats[fmt] = (out.summary.formats[fmt] || 0) + 1;
    if (/EXEC\s+SQL/i.test(src)) out.summary.withEmbeddedSql++;
    if (/EXEC\s+CICS/i.test(src)) out.summary.withCics++;
    if (/EXEC\s+DLI/i.test(src)) out.summary.withDli++;
    for (const c of res.copies) {
      if (c.status === 'resolved') out.summary.copiesResolved++;
      else if (String(c.status).startsWith('refused')) { out.summary.copiesRefused++; out.refusedCopies.push({ name: c.name, from: relPath(root, c.file), line: c.line, why: c.status }); }
      // Before the system names, which a copybook in the tree is free to take.
      else if (c.status === 'expansion-limit') out.summary.copiesOverLimit = (out.summary.copiesOverLimit || 0) + 1;
      else if (c.status === 'system' || SYSTEM_COPY.test(c.name)) out.summary.copiesSystem++;
      // The copybook exists and includes itself: a loop to break, not a file to go and find.
      else if (c.status === 'recursive') { out.summary.copiesRecursive++; const k = c.name.toUpperCase(); out.recursiveCopybooks[k] = (out.recursiveCopybooks[k] || 0) + 1; }
      else {
        out.summary.copiesMissing++;
        const k = c.name.toUpperCase();
        out.missingCopybooks[k] = (out.missingCopybooks[k] || 0) + 1;
      }
    }
  }
  out.summary.nosrc = out.summary.filesScanned === 0;
  out.summary.coverageIncomplete = out.summary.copiesMissing > 0 || out.summary.copiesRecursive > 0 || (out.summary.copiesOverLimit || 0) > 0 || out.summary.filesUnreadable > 0 || out.summary.copiesRefused > 0 || out.summary.dirsUnreadable > 0 || out.summary.symlinks.outside > 0;
  return out;
}
