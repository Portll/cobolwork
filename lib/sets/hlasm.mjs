// SPDX-License-Identifier: AGPL-3.0-or-later
// Assembler stubs are where a COBOL estate does what COBOL cannot: switch to supervisor state, reach
// another address space, run an instruction whose length or mask is decided at run time. This set
// reads HLASM source as cards and reports those operations where they are written. It does not
// assemble: macros are not expanded and conditional assembly is not evaluated (lib/hlasm.mjs).
//
// It also answers the question the COBOL side cannot: a CALL 'SUBRTN' with no COBOL program of that
// name may be an assembler module, and a CSECT or ENTRY of that name here is where it is.
import { inScope, isAssembler, isProgram, relPath } from '../sources.mjs';
import { report } from '../kernel/ruleset.mjs';
import { treeFor, noteUnread } from '../kernel/source-tree.mjs';
import { eachWithinMemory } from '../kernel/memory.mjs';
import { readHlasm, OPERATIONS } from '../hlasm.mjs';

export const HLASM_RULES = {
  'hlasm-supervisor-state-change': {
    sev: 'crit', evidence: 'construct', cwe: 'CWE-250',
    text: 'Assembler source switches to PSW key zero or supervisor state',
    impact: 'The code after the switch runs with the operating system\'s authority: it can read and change any storage, so a flaw in it is a flaw in the system rather than in one job',
    remedy: 'Keep the authorized code to the instructions that need it, return to the caller\'s key and problem state straight after (MODESET KEY=NZERO, MODE=PROB), and APF-authorize the module only where it has to be',
  },
  'hlasm-executes-built-instruction': {
    sev: 'high', evidence: 'construct', cwe: 'CWE-119',
    text: 'Assembler source runs an instruction whose length or mask comes from a register at run time',
    impact: 'EX and EXRL run their target instruction with its second byte taken from a register, which for a move is its length: a length from input moves past the end of the field it was meant for',
    remedy: 'Bound the register against the target field\'s length before the EX, and keep the target instruction out of the code a caller can reach any other way',
  },
  'hlasm-cross-memory-service': {
    sev: 'high', evidence: 'construct', cwe: 'CWE-668',
    text: 'Assembler source uses a cross-memory instruction, reaching another address space or another authority',
    impact: 'A program call, a program transfer or a change of secondary address space moves execution or data access across address spaces, under the authority the linkage tables grant rather than the caller\'s own',
    remedy: 'Confirm the entry tables and authorization indexes grant only the address spaces and keys the service needs, and that every PC routine validates what its caller passes',
  },
  'hlasm-calls-security-product': { sev: 'info', evidence: 'context', cwe: null, text: 'Assembler source calls the security product directly' },
  'hlasm-provides-called-module': { sev: 'info', evidence: 'context', cwe: null, text: 'An assembler CSECT or ENTRY is a module a COBOL program in this tree CALLs' },
};

const RULE_OF_CLASS = {
  'cross-memory': 'hlasm-cross-memory-service',
  'built-instruction': 'hlasm-executes-built-instruction',
  'security-product': 'hlasm-calls-security-product',
};

const STATE = { KEY: 'PSW key zero', EXTKEY: 'PSW key zero', MODE: 'supervisor state' };

const where = (use) => (use.inMacro ? ' It is in a macro definition, so it is in every program that uses the macro.' : '');

function detail(use) {
  const written = `${use.name}${use.field ? ` ${use.field}` : ''}`;
  if (use.class === 'security-product') {
    const request = /\bREQUEST=([A-Z]+)/i.exec(use.field || '');
    return `${request ? `${use.name} REQUEST=${request[1].toUpperCase()}` : use.name} calls the security product from assembler rather than through a service that checks on the program's behalf.${where(use)}`;
  }
  return `${written}: ${OPERATIONS.get(use.name).summary}${where(use)}`;
}

// A COBOL CALL of a literal name, outside comment lines. A membership question over every program,
// answered with a regular expression as lib/sets/jcl.mjs answers PROGRAM-ID.
const CALL = /\bCALL\s+['"]([A-Z0-9$#@_-]{1,30})['"]/gi;

function cobolCalls(source) {
  const calls = [];
  source.split(/\r?\n/).forEach((text, i) => {
    if (text.length > 6 && '*/'.includes(text[6])) return;
    for (const m of text.matchAll(CALL)) calls.push({ name: m[1].toUpperCase(), line: i + 1 });
  });
  return calls;
}

export function scanHlasm(root, opts = {}) {
  const tree = treeFor(root, opts);
  const all = tree.list().filter(inScope(opts));
  const findings = [];
  const stats = { filesScanned: 0, filesUnreadable: 0, assemblerFiles: 0, bmsFiles: 0, imsFiles: 0, unrecognisedFiles: 0, readNotAssembled: true };
  const defines = new Map();

  const run = eachWithinMemory(all.filter(isAssembler), (f) => {
    let src;
    try { src = tree.text(f).text; } catch (e) { noteUnread(stats, tree, f, e); return 0; }
    stats.filesScanned++;
    const r = readHlasm(src);
    if (r.kind === 'bms') { stats.bmsFiles++; return src.length; }
    if (r.kind === 'ims') { stats.imsFiles++; return src.length; }
    if (r.kind === 'unrecognised') { stats.unrecognisedFiles++; return src.length; }
    stats.assemblerFiles++;
    const path = relPath(root, f);
    for (const d of r.defines) if (!defines.has(d.name)) defines.set(d.name, { ...d, path });
    for (const use of r.operations) {
      if (use.name === 'MODESET') {
        if (use.stateChange) findings.push({ rule: 'hlasm-supervisor-state-change', path, line: use.line, detail: `MODESET ${use.stateChange} switches to ${STATE[use.stateChange.split('=')[0]]}.${where(use)}` });
        continue;
      }
      const rule = RULE_OF_CLASS[use.class];
      if (rule) findings.push({ rule, path, line: use.line, detail: detail(use) });
    }
    return src.length;
  }, { label: 'hlasm', maxBytes: opts.maxSourceBytes ?? Infinity });

  if (defines.size) {
    const callers = new Map();
    const programs = eachWithinMemory(all.filter(isProgram), (f) => {
      let src;
      try { src = tree.text(f).text; } catch (e) { noteUnread(stats, tree, f, e); return 0; }
      for (const c of cobolCalls(src)) {
        if (!defines.has(c.name)) continue;
        if (!callers.has(c.name)) callers.set(c.name, []);
        callers.get(c.name).push({ path: relPath(root, f), line: c.line });
      }
      return src.length;
    }, { label: 'hlasm-callers', maxBytes: opts.maxSourceBytes ?? Infinity });
    if (programs.skipped.length) stats.callersNotRead = programs.skipped.length;
    for (const [name, calls] of callers) {
      const d = defines.get(name);
      const first = calls[0];
      findings.push({ rule: 'hlasm-provides-called-module', path: d.path, line: d.line,
        detail: `${d.how} ${name} is the module CALL '${name}' reaches from ${first.path}:${first.line}${calls.length > 1 ? ` and ${calls.length - 1} other CALL${calls.length > 2 ? 's' : ''}` : ''}` });
    }
  }

  return report('hlasm', { rules: HLASM_RULES, findings, stats, run });
}
