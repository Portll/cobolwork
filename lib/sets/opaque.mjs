// SPDX-License-Identifier: AGPL-3.0-or-later
// Constructs that defeat the analysis rather than being defects in themselves.
//
// Every other rule set answers "what is wrong here". This one answers "how much should you trust
// the answer". A program that takes the address of a record, alters a GO TO at run time, calls
// through a procedure pointer or is entered somewhere other than its beginning is a program whose
// data flow the engine has followed less of than it appears to have. Reporting a clean flow result
// over it without saying so would be the same failure as reporting a clean scan over files nobody
// read, which this project refuses everywhere else.
//
// None of these is a vulnerability. They are severity `info` and they exist so that a reviewer
// knows which programs deserve a person, and so that a precision number measured over a corpus can
// say how much of that corpus was analysable at all.
import { inScope, isProgram, relPath } from '../sources.mjs';
import { report } from '../kernel/ruleset.mjs';
import { treeFor, noteUnread, noteUnparsed } from '../kernel/source-tree.mjs';
import { detectFormat, normalize } from '../parser.mjs';
import { eachWithinMemory } from '../kernel/memory.mjs';


export const OPAQUE_RULES = {
  'opaque-pointer-addressing': { sev: 'info', evidence: 'coverage', cwe: 'CWE-119', text: 'A program addresses storage through a pointer, so data flow through it is not followed' },
  'opaque-altered-control-flow': { sev: 'info', evidence: 'coverage', cwe: 'CWE-691', text: 'A program changes where a GO TO goes at run time, so its control flow is not followed' },
  'opaque-procedure-pointer': { sev: 'info', evidence: 'coverage', cwe: 'CWE-470', text: 'A program calls through a procedure pointer, so the callee is not known statically' },
  'opaque-alternate-entry': { sev: 'info', evidence: 'coverage', cwe: 'CWE-1419', text: 'A program declares an alternate entry point, which the flow rules do not start from' },
};

// Matched against normalised source: comments are gone, the sequence and identification areas are
// gone, and continuations are joined. Matching raw text would fire on a commented-out ALTER and on
// the word ENTRY inside a literal.
const PATTERNS = [
  // SET ADDRESS OF makes a linkage item point at arbitrary storage. Whatever that storage holds
  // did not arrive through any statement the engine can see.
  { rule: 'opaque-pointer-addressing', re: /\bSET\s+ADDRESS\s+OF\s+([A-Z0-9-]+)/gi,
    detail: (m) => `SET ADDRESS OF ${m[1]} repoints storage, so what ${m[1]} holds afterwards did not arrive through any statement this engine reads` },
  { rule: 'opaque-pointer-addressing', re: /\bSET\s+([A-Z0-9-]+)\s+TO\s+ADDRESS\s+OF\b/gi,
    detail: (m) => `${m[1]} is set to the address of another item, and an address is followed by nothing here` },
  // ALTER rewrites the target of a GO TO while the program runs. It is obsolete in every standard
  // since 1985 and still present in code that predates them.
  { rule: 'opaque-altered-control-flow', re: /\bALTER\s+([A-Z0-9-]+)\s+TO\b/gi,
    detail: (m) => `ALTER ${m[1]} changes where that paragraph's GO TO leads while the program runs` },
  { rule: 'opaque-altered-control-flow', re: /\bGO\s+TO\b[^.]{0,200}?\bDEPENDING\s+ON\s+([A-Z0-9-]+)/gi,
    detail: (m) => `GO TO ... DEPENDING ON ${m[1]} branches to one of several paragraphs chosen at run time` },
  { rule: 'opaque-procedure-pointer', re: /\bUSAGE\s+(?:IS\s+)?PROCEDURE-POINTER\b/gi,
    detail: () => 'a procedure pointer holds the address of code, and which code is not decided until it runs' },
  { rule: 'opaque-procedure-pointer', re: /\bCALL\s+([A-Z0-9-]+)\s+(?:USING|RETURNING|END-CALL|\.)/gi,
    // Only counts when the operand was declared a procedure pointer, which the caller checks.
    needsPointerOperand: true,
    detail: (m) => `CALL ${m[1]} dispatches through a pointer, so the callee is not known from the source` },
  { rule: 'opaque-alternate-entry', re: /^\s*ENTRY\s+['"]([^'"]+)['"]/gim,
    // An entry name is a program name; anything else in the literal is not repeated.
    detail: (m) => `ENTRY ${/^[A-Z0-9$#@-]{1,30}$/i.test(m[1]) ? `'${m[1]}'` : 'with a literal that is not a program name'} is a second way into this program, and the flow rules start only at its PROCEDURE DIVISION` },
];

export function scanOpaque(root, opts = {}) {
  const tree = treeFor(root, opts);
  const files = tree.list().filter(isProgram).filter(inScope(opts));
  const findings = [];
  const stats = { filesScanned: 0, filesUnreadable: 0, programsOpaque: 0 };

  const run = eachWithinMemory(files, (f) => {
    let src;
    try { src = tree.text(f).text; } catch (e) { noteUnread(stats, tree, f, e); return 0; }
    // Counted before the cheap filter below, because filesScanned is what a report uses to say how
    // much it read, and a file skipped for holding none of these words was still opened and read.
    stats.filesScanned++;
    if (!/\b(?:SET\s+ADDRESS|ADDRESS\s+OF|ALTER|DEPENDING|PROCEDURE-POINTER|ENTRY)\b/i.test(src)) return src.length;

    let norm;
    try { norm = normalize(src, detectFormat(src), new Map()); } catch (e) { noteUnparsed(stats, tree, f, e); return src.length; }
    // normalize returns per-line entries with the comment and sequence areas already removed.
    const lines = norm.entries.map((e) => e.text || '');
    const text = lines.join('\n');
    const path = relPath(root, f);

    // Which names were declared as pointers, so a CALL through one can be told from an ordinary
    // CALL of a variable - which the flow rules already report as a dynamic program load.
    const pointers = new Set();
    for (const m of text.matchAll(/\b(?:\d\d\s+)?([A-Z0-9-]+)\b[^.\n]{0,80}\bUSAGE\s+(?:IS\s+)?(?:PROCEDURE-POINTER|POINTER)\b/gi)) {
      pointers.add(m[1].toUpperCase());
    }

    let hit = false;
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(text)) !== null) {
        if (p.needsPointerOperand && !pointers.has(String(m[1]).toUpperCase())) continue;
        // The line number is the normalised entry's own, so a construct that came from a copybook
        // is reported where the compiler would see it.
        const before = text.slice(0, m.index).split('\n').length - 1;
        const line = norm.entries[before] ? norm.entries[before].line : 1;
        findings.push({ rule: p.rule, path, line, detail: p.detail(m) });
        hit = true;
      }
    }
    if (hit) stats.programsOpaque++;
    return src.length;
  }, { label: 'opaque', maxBytes: opts.maxSourceBytes ?? Infinity });

  return report('opaque', { rules: OPAQUE_RULES, findings, stats, run });
}
