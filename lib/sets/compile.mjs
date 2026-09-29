// SPDX-License-Identifier: AGPL-3.0-or-later
// Whether a program in the tree is one a compiler would accept: every name it uses is declared by
// the program, by a copybook it includes, or by the compiler or a translator. Enterprise COBOL stops
// a program that uses anything else with IGYPS2121-S. Source that cannot compile is not the source
// of anything that runs, and a change carrying it was merged without a build, which is the mark of
// generated "modernisation" code nobody compiled.
//
// A name is only undefined when everything the program copies was found. With a copybook missing
// the name is most likely declared in it, so the program is counted as undecided rather than
// reported: the missing member is the thing to act on, and the inventory already names it. The
// same holds wherever the parse is not the whole program, and the count says why for each.
import { basename, extname } from 'node:path';
import { inScope, isProgram, relPath, readSource } from '../sources.mjs';
import { report } from '../kernel/ruleset.mjs';
import { treeFor, noteUnread, noteUnparsed } from '../kernel/source-tree.mjs';
import { eachWithinMemory } from '../kernel/memory.mjs';

// construct: no input has to reach it. med: certain once every copybook is found, and it means the
// tree does not hold what runs, but it is not exploitable in itself. CWE-1127: MITRE discourages
// mapping to CWE-710, a pillar, and of its children this is the build that lets errors through, of
// which source nobody compiled is the limit. CWE-1164 is code that runs to no effect; this cannot run.
export const COMPILE_RULES = {
  'compile-undefined-name': {
    sev: 'med', evidence: 'construct', cwe: 'CWE-1127',
    text: 'A program uses names that nothing it declares or copies defines, so it cannot compile',
    impact: 'The program uses a name nothing it declares or copies defines, so Enterprise COBOL stops it with IGYPS2121-S: the source in the tree is not the source of anything that runs',
    remedy: 'Define the missing name, or add the copybook that declares it, so the program compiles; if it is generated code, compile it before relying on it',
  },
};

// These declare only DFH names or the SQLCA's own, which the parser already takes as supplied.
const COVERED_SYSTEM = /^(DFHAID|DFHBMSCA|DFHEIBLK|SQLCA)$/i;
const PARSE_TROUBLE = new Set(['unterminated-exec', 'unterminated-literal', 'copy-without-period']);
// An Enterprise COBOL listing kept under a program's extension, whose page headers read as code.
const LISTING = /^[01 -]?PP \d{4}-[A-Z0-9]{3} IBM /m;
const SHOWN = 5;

const nameOf = (p) => basename(p, extname(p)).toUpperCase();

function whyUndecided(r, src) {
  if (r.copies.some((c) => c.status === 'expansion-limit')) return 'its COPY or REPLACE statements expand past what one parse reads';
  if (r.copies.some((c) => c.status !== 'resolved' && !(c.status === 'system' && COVERED_SYSTEM.test(c.name)))) return 'a copybook it includes is not in the tree';
  // Panvalet's ++INCLUDE and Librarian's -INC, which a library manager expands before the compiler
  // runs, and an INCLUDE or COPY somewhere the parser does not read one as a statement.
  if (/^.{0,6}(?:-INC|\+\+INCLUDE)\s/im.test(src) || r.programs.some((p) => p.refs.some((x) => x.tok.u === 'INCLUDE' || x.tok.u === 'COPY'))) return 'it includes source the parser does not expand';
  if (r.diags.some((d) => PARSE_TROUBLE.has(d.kind))) return 'the parse did not read it cleanly';
  // A communication description declares its queue and status names in clauses the parser skips.
  if (r.programs.some((p) => p.diags.some((d) => d.kind === 'unrecognised-data-sentence') || (p.fds || []).some((fd) => fd.kind === 'CD'))) return 'the parse did not recognise all of its data division';
  return null;
}

// Where a text declares a name: after a level number, FD, SD, RD, CD, SELECT, INDEXED BY or a
// directive's CONSTANT, or as a paragraph or section header in Area A. And the words of a COPY
// REPLACING or a REPLACE, which is where a name comes from when the parser did not replace.
const DECLARATION = /(?:^|[\s.])(?:0?[1-9]|[1-4][0-9]|66|77|78|88|FD|SD|RD|CD|SELECT(?:\s+OPTIONAL)?|INDEXED\s+BY|CONSTANT)\s+([A-Za-z0-9$#@_][A-Za-z0-9$#@_-]*)/gim;
const HEADER = /^(?:.{0,6}[ \t]{1,4}|[ \t]{0,4})([A-Za-z0-9][A-Za-z0-9-]*)(?:[ \t]+SECTION(?:[ \t]+\d+)?)?[ \t]*\.[ \t]*\r?$/gm;
const COPY_STATEMENT = /\bCOPY\b([\s\S]*?)(?:\.\s|\.$)/gim;
const REPLACE_STATEMENT = /\bREPLACE\b([\s\S]*?)(?:\.\s|\.$)/gim;

// A header declares a paragraph only where the sentence before it has ended: after a line of code
// ending in a period, or with no code before it. Without the period the name is read as part of the
// statement before, and the compiler reports it undefined.
function sentenceEndsBefore(text, at) {
  const lines = text.slice(0, at).split(/\r?\n/);
  lines.pop();
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (/^.{6}[*/]/.test(l) || /^\s*\*>/.test(l)) continue;
    const code = l.slice(0, 72).replace(/\*>.*$/, '').replace(/^[0-9 ]{6}(?=[ \-D])/, '').trim();
    if (code) return code.endsWith('.');
  }
  return true;
}

function declaredIn(text, names, into) {
  const note = (w) => { const u = w.toUpperCase(); if (names.has(u)) into.add(u); };
  for (const re of [DECLARATION, HEADER]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) if (re !== HEADER || sentenceEndsBefore(text, m.index)) note(m[1]);
  }
  for (const re of [COPY_STATEMENT, REPLACE_STATEMENT]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      if (re === COPY_STATEMENT && !/\bREPLACING\b/i.test(m[1])) continue;
      for (const w of m[1].match(/[A-Za-z0-9][A-Za-z0-9-]*/g) || []) note(w);
    }
  }
  return into;
}

// A reference cut at column 72 names a word the source does not hold.
function truncated(ref, lines) {
  const line = (lines.get(ref.file) || [])[ref.line - 1] || '';
  const re = new RegExp(`(?<![A-Za-z0-9-])${ref.name.replace(/[$#@]/g, '\\$&')}`, 'gi');
  let whole = false;
  let any = false;
  let m;
  while ((m = re.exec(line))) { any = true; if (!/[A-Za-z0-9-]/.test(line[m.index + ref.name.length] || '')) whole = true; }
  return any && !whole;
}

export function scanCompile(root, opts = {}) {
  const tree = treeFor(root, opts);
  const files = tree.list().filter(isProgram).filter(inScope(opts));
  const findings = [];
  const stats = { filesScanned: 0, filesUnreadable: 0, programsChecked: 0, programsUndecided: 0 };
  const because = {};
  const undecided = [];
  const undecide = (f, id, why, refs) => {
    stats.programsUndecided++;
    because[why] = (because[why] || 0) + 1;
    undecided.push(`${tree.rel(f)} (${id}): ${why}: ${[...new Set(refs.map((x) => x.name))].slice(0, SHOWN).join(', ')}`);
  };
  const textOf = (p) => (tree.contains(p) ? tree.text(p) : readSource(p)).text;
  const candidates = [];

  const run = eachWithinMemory(files, (f) => {
    let src;
    try { src = tree.text(f).text; } catch (e) { noteUnread(stats, tree, f, e); return 0; }
    if (LISTING.test(src)) { stats.filesScanned++; stats.listingsSkipped = (stats.listingsSkipped || 0) + 1; return src.length; }
    let r;
    try { r = tree.parse(f, src); } catch (e) { noteUnparsed(stats, tree, f, e); return src.length; }
    stats.filesScanned++;
    const blocked = whyUndecided(r, src);
    const copied = [...new Set(r.copies.filter((c) => c.path).map((c) => c.path))];
    for (const p of r.programs) {
      // A class or a method has no PROGRAM-ID, and the data its methods use belongs to no program here.
      if (!p.id || p.diags.some((d) => d.kind === 'no-procedure-division')) continue;
      stats.programsChecked++;
      if (!p.unresolvedRefs.length) continue;
      if (blocked) { undecide(f, p.id, blocked, p.unresolvedRefs); continue; }
      const names = new Set(p.unresolvedRefs.map((x) => x.name));
      const texts = new Map([[f, src]]);
      for (const q of copied) { try { texts.set(q, textOf(q)); } catch { /* the parse read it once; a second failure changes nothing */ } }
      const seen = new Set();
      for (const text of texts.values()) declaredIn(text, names, seen);
      const lines = new Map([...texts].map(([q, t]) => [q, t.split(/\r?\n/)]));
      const left = p.unresolvedRefs.filter((x) => !seen.has(x.name) && !truncated(x, lines));
      if (!left.length) { undecide(f, p.id, 'the parse missed a declaration the text holds', p.unresolvedRefs); continue; }
      candidates.push({ file: f, id: p.id, line: p.line, refs: left, copied: new Set(r.copies.map((c) => nameOf(c.name))) });
    }
    r = null;
    return src.length;
  }, { label: 'compile', maxBytes: opts.maxSourceBytes ?? Infinity });

  // Another file answering to a name the program copies may be the one its build finds.
  const wanted = new Set(candidates.flatMap((c) => [...c.copied]));
  const answering = new Map();
  if (wanted.size) {
    for (const p of tree.list()) {
      const n = nameOf(p);
      if (!wanted.has(n)) continue;
      if (!answering.has(n)) answering.set(n, []);
      answering.get(n).push(p);
    }
  }
  for (const c of candidates) {
    const names = new Set(c.refs.map((x) => x.name));
    const seen = new Set();
    for (const n of c.copied) for (const p of answering.get(n) || []) { try { declaredIn(tree.text(p).text, names, seen); } catch { /* unread declares nothing */ } }
    const left = c.refs.filter((x) => !seen.has(x.name));
    if (!left.length) { undecide(c.file, c.id, 'another copybook of a name it copies declares them', c.refs); continue; }
    const firsts = new Map();
    for (const x of left) if (!firsts.has(x.name)) firsts.set(x.name, x);
    const own = left.find((x) => x.file === c.file);
    const at = (x) => (x.file === c.file ? `line ${x.line}` : `${relPath(root, x.file)}:${x.line}`);
    const shown = [...firsts.values()].slice(0, SHOWN).map((x) => `${x.name} (${at(x)})`).join(', ');
    const more = firsts.size > SHOWN ? `, and ${firsts.size - SHOWN} more` : '';
    findings.push({
      rule: 'compile-undefined-name', path: relPath(root, c.file), line: own ? own.line : c.line || 1, program: c.id,
      names: [...firsts.keys()],
      detail: `${c.id} uses ${firsts.size} name(s) that nothing it declares or copies defines, so it cannot compile: ${shown}${more}`,
      related: [...firsts.values()].map((x) => ({ path: relPath(root, x.file), line: x.line, detail: `${x.name} is used here and declared nowhere the program can reach` })),
    });
  }

  if (stats.programsUndecided) {
    stats.undecidedBecause = because;
    stats.undecided = undecided;
    stats.coverageIncomplete = true;
    stats.readInPart = `${stats.programsUndecided} program(s) use names no declaration the parse read defines, and the names may be declared where it did not reach: ${Object.entries(because).map(([k, v]) => `${v} because ${k}`).join('; ')}`;
  }
  if (stats.filesUnparsed) stats.coverageIncomplete = true;
  return report('compile', { rules: COMPILE_RULES, findings, stats, run });
}
