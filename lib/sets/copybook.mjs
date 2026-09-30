// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { basename, dirname, extname } from 'node:path';
import { detectFormat, parseSource } from '../parser.mjs';
import { inScope, isCopybook, isProgram, relPath } from '../sources.mjs';
import { finish } from '../kernel/findings.mjs';
import { report } from '../kernel/ruleset.mjs';
import { treeFor, noteUnread, noteUnparsed } from '../kernel/source-tree.mjs';
import { eachWithinMemory } from '../kernel/memory.mjs';
import { cobolCard } from '../card.mjs';

// A copybook is resolved by name along a search path: the program's own directory first, then the
// include directories, then the system library. Two files answering to one name mean the record
// layout a program compiles against depends on where the program sits, and a copybook named like a
// system one is found before the system's own. Both are how a single added file changes the layout
// of every program that COPYs the name without touching any of them.

export const COPYBOOK_RULES = {
  'copybook-shadows-system': {
    sev: 'med', evidence: 'tampering', cwe: 'CWE-427',
    text: 'A copybook in the repository has the name of a system copybook, and is found before it',
    impact: "A repository copybook answers to the name of a system copybook (SQLCA, DFHAID, ...), so the search path finds it before the system's own and a program compiles against the wrong layout",
    remedy: 'Rename or remove the repository copy; let the system copybook resolve from its own library',
  },
  'copybook-shadowed': {
    sev: 'med', evidence: 'tampering', cwe: 'CWE-427',
    text: 'Two copybooks with different contents answer to the same name, and programs resolve it to different files',
    impact: 'Two copybooks answer to one name with different layouts, so which one a program gets depends on its search path, not its source',
    remedy: "Give the two copybooks distinct names, or make every program's search path resolve the intended one unambiguously",
  },
};

const SYSTEM_NAME = /^(DFHAID|DFHBMSCA|DFHEIBLK|DFHCOMMAREA|DFHRESP|SQLCA|SQLDA|DSNHLI|CEEIGZCT|CMQV|CMQODV|CMQMDV|CMQPMOV|CMQGMOV|EZACICSO)$/i;

// Layout text, not bytes. In fixed format the sequence and identification areas are not part of the
// layout, and two copies differing only in change tags are the same copybook. In free format they
// are ordinary text, and cutting at column 72 hid a PIC clause that sat past it.
function layout(src) {
  const fixed = detectFormat(src) === 'fixed';
  return src.split(/\r?\n/)
    .map(l => { const c = cobolCard(l, fixed ? 'fixed' : 'free'); return (c.indicator + c.text).trimEnd(); })
    .filter(l => l.trim() && !/^[*/]/.test(l.trimStart()))
    .join('\n')
    .toUpperCase();
}

const nameOf = (p) => basename(p, extname(p)).toUpperCase();

const SYSTEM_LAYOUTS = JSON.parse(readFileSync(new URL('../../rules/system-layouts.json', import.meta.url), 'utf8'));

// Where a repository copy of a system copybook first departs from the system's layout, compared
// field by elementary field; null when every field sits where the system puts it. Undefined when no
// layout is held for the name or the copy does not parse.
export function systemLayoutDeparture(name, text) {
  const want = SYSTEM_LAYOUTS[String(name).toUpperCase()];
  if (!want || !want.fields) return undefined;
  let items;
  try {
    const wrapped = ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. LAYOUT.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.', text, '       PROCEDURE DIVISION.', '           GOBACK.'].join('\n');
    items = parseSource(wrapped, `${name}.cpy`, { format: 'auto' }).programs[0]?.items;
  } catch { return undefined; }
  if (!items || !items.length) return undefined;
  const byName = new Map(items.map((it) => [String(it.name).toUpperCase(), it]));
  for (const [field, offset, size, occurs] of want.fields) {
    const it = byName.get(field);
    if (!it) return `${field} is missing`;
    if (it.offset !== offset || it.size !== size || (it.occurs || 1) !== occurs) return `${field} is ${it.size} byte(s) at offset ${it.offset}${(it.occurs || 1) > 1 ? ` times ${it.occurs}` : ''}, where the system's is ${size} at ${offset}${occurs > 1 ? ` times ${occurs}` : ''}`;
  }
  const top = items.find((it) => it.level === 1);
  if (top && top.size !== want.length) return `the record is ${top.size} bytes, where the system's is ${want.length}`;
  return null;
}

export function scanCopybooks(root, opts = {}) {
  const tree = treeFor(root, opts);
  const all = tree.list().filter(inScope(opts));
  const findings = [];
  const stats = { filesScanned: 0, copybookFiles: 0, namesShadowed: 0, filesUnreadable: 0 };

  const copies = new Map();
  for (const p of all) {
    if (!isCopybook(p)) continue;
    stats.copybookFiles++;
    stats.filesScanned++;
    const n = nameOf(p);
    if (!copies.has(n)) copies.set(n, []);
    copies.get(n).push(p);
  }

  // Reading the COPY statements out of the text found only what a program names directly, counted a
  // commented-out line as a use, and never saw a copybook reached through another copybook. The
  // parser resolves all of that, so the parse is the answer — paid for once, and only when this
  // tree holds something worth asking about.
  const candidates = new Set([...copies].filter(([n, f]) => f.length > 1 || SYSTEM_NAME.test(n)).map(([n]) => n));
  const referrers = new Map();
  const resolved = new Map();
  // This is the expensive half: it parses every program in the tree, and a parse tree is the kind
  // of structure a byte budget does not bound. Only what each parse yields is kept - a name, a
  // referrer, a resolved path - and the tree is released, so the working set stays flat. The guard
  // is what stops the reading before the heap does.
  let run = { skipped: [], stoppedBy: null, peakHeapBytes: 0, note: null };
  if (candidates.size) {
    run = eachWithinMemory(all.filter(isProgram), (p) => {
      let src;
      try { src = tree.text(p).text; } catch (e) { noteUnread(stats, tree, p, e); return 0; }
      let r;
      try {
        r = tree.parse(p, src);
      } catch (e) { noteUnparsed(stats, tree, p, e); return src.length; }
      stats.filesScanned++;
      for (const c of r.copies) {
        const n = nameOf(c.name);
        if (!candidates.has(n)) continue;
        if (!referrers.has(n)) referrers.set(n, new Set());
        referrers.get(n).add(p);
        if (c.path) {
          if (!resolved.has(n)) resolved.set(n, new Map());
          resolved.get(n).set(p, c.path);
        }
      }
      r = null;                     // the tree is not needed past this point
      return src.length;
    }, { label: 'copybook', maxBytes: opts.maxSourceBytes ?? Infinity });
  }

  for (const [n, files] of copies) {
    if (SYSTEM_NAME.test(n)) {
      for (const f of files) {
        const users = [...(referrers.get(n) || [])].map(p => relPath(root, p));
        let departure;
        try { departure = systemLayoutDeparture(n, tree.text(f).text); } catch (e) { noteUnread(stats, tree, f, e); }
        const layout = departure === null ? `; its layout is the system's, field for field`
          : departure ? `; its layout departs from the system's: ${departure}` : '';
        findings.push({ rule: 'copybook-shadows-system', path: relPath(root, f), line: 1, name: n, users: users.length,
          ...(departure === null ? { layoutMatchesSystem: true } : {}),
          detail: `${n} is a system copybook name; this file is found before the system library by ${users.length} program(s)${users.length ? `: ${users.slice(0, 5).join(', ')}${users.length > 5 ? ', …' : ''}` : ''}${layout}` });
      }
    }
    if (files.length < 2) continue;
    const layouts = new Map();
    for (const f of files) {
      let text;
      try { text = layout(tree.text(f).text); } catch (e) { noteUnread(stats, tree, f, e); continue; }
      if (!layouts.has(text)) layouts.set(text, []);
      layouts.get(text).push(f);
    }
    if (layouts.size < 2) continue;

    const resolvedBy = resolved.get(n) || new Map();
    const targets = new Set(resolvedBy.values());
    stats.namesShadowed++;
    // Differing copies that every program resolves to one file are a latent trap, not a live one:
    // reported, but the detail says which. Programs split across files are the live case.
    const split = targets.size > 1;
    const perFile = files.map(f => `${relPath(root, f)} (${[...resolvedBy.values()].filter(v => v === f).length} program(s))`);
    findings.push({ rule: 'copybook-shadowed', path: relPath(root, files[0]), line: 1, name: n, split,
      detail: `${files.length} files named ${n} with ${layouts.size} different layouts; ${split ? 'programs resolve it to different files' : 'every program that COPYs it resolves to the same file today'}: ${perFile.join(', ')}`,
      related: files.slice(1).map(f => ({ path: relPath(root, f), line: 1, detail: `another copybook named ${n}` })) });
  }

  // This set decides one severity for itself, so it sets it before the shared stamping runs, which
  // fills only what a finding does not already carry.
  //
  // Vendoring DFHAID or SQLCA so a program compiles off the mainframe is common and legitimate;
  // measured on the 200-repository corpus, every system-named copy found was one. The finding
  // stays, because the vendored copy is what those programs are built against, but it is not high.
  for (const f of findings) {
    const latent = (f.rule === 'copybook-shadowed' && !f.split) || (f.rule === 'copybook-shadows-system' && (!f.users || f.layoutMatchesSystem));
    if (latent) f.sev = 'low';
  }
  const { byRule } = finish(COPYBOOK_RULES, findings, 'copybook');
  // A program the scan never parsed is a program whose COPY statements nobody read, so a name
  // that looks unshadowed may only look that way.
  return report('copybook', { rules: COPYBOOK_RULES, findings, stats, run });
}
