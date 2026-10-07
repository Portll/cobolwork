// SPDX-License-Identifier: AGPL-3.0-or-later
// Assembler stubs are where a COBOL estate does what COBOL cannot: switch to supervisor state, reach
// another address space, run an instruction whose length or mask is decided at run time. This set
// reads HLASM source as cards and reports those operations where they are written. It does not
// assemble: macros are not expanded and conditional assembly is not evaluated (lib/hlasm.mjs).
//
// It also answers the question the COBOL side cannot: a CALL 'SUBRTN' with no COBOL program of that
// name may be an assembler module, and a CSECT or ENTRY of that name here is where it is.
import { basename, extname } from 'node:path';
import { inScope, isAssembler, isJcl, isProgram, relPath, HLASM_EXT, COPY_EXT } from '../sources.mjs';
import { parseJcl } from '../jcl.mjs';
import { optableIn, processOptions } from '../hlasm/optable.mjs';
import { report } from '../kernel/ruleset.mjs';
import { treeFor, noteUnread } from '../kernel/source-tree.mjs';
import { eachWithinMemory } from '../kernel/memory.mjs';
import { readHlasm, OPERATIONS, isDocument } from '../hlasm.mjs';
import { readHlasmStatements, parseHlasmStatement, NAMED_MACROS } from '../hlasm/read.mjs';
import { macroOperands, splitOperands } from '../hlasm/operands.mjs';

export const HLASM_RULES = {
  'hlasm-supervisor-state-change': {
    sev: 'crit', evidence: 'construct', cwe: 'CWE-250',
    text: 'Assembler source switches to PSW key zero, another system key, or supervisor state',
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
  'hlasm-runtime-module-name': {
    sev: 'med', evidence: 'construct', cwe: 'CWE-470',
    text: 'Assembler source loads or calls a module whose name it reads from storage at run time',
    impact: 'EPLOC= and DE= give LINK, XCTL, LOAD and ATTACH the address of the name rather than the name, so whatever writes that storage chooses the program that runs, with the caller\'s authority',
    remedy: 'Name the module with EP= where it is fixed; where it must vary, check the name against a list of the modules the program may run before the call',
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

// EX and EXRL name their target instruction; when it is labelled in the same file, the finding says
// which instruction runs with the register's length or mask.
function executed(use, labels) {
  if (use.class !== 'built-instruction') return '';
  const target = (splitOperands(use.field || '')[1] || '').trim().toUpperCase();
  const t = /^[A-Z$#@_][A-Z0-9$#@_]*$/.test(target) ? labels.get(target) : null;
  return t ? ` runs ${t.operation}${t.field ? ` ${t.field}` : ''}` : '';
}

function detail(use, labels) {
  const written = `${use.name}${use.field ? ` ${use.field}` : ''}${executed(use, labels)}`;
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

// The repository's own definitions of macros the reader knows by name (IF, LINK, SAVE, ...): a
// member so named whose first statement is MACRO. Only those names are read, so the cost is a few
// files at most.
function repositoryMacros(tree, files) {
  const found = new Set();
  for (const f of files) {
    const name = basename(f, extname(f)).toUpperCase();
    if (!NAMED_MACROS.has(name) || found.has(name)) continue;
    let text;
    try { text = tree.text(f).text; } catch { continue; }
    const first = readHlasmStatements(text).statements.find((s) => s.kind === 'statement');
    if (first?.operation === 'MACRO') found.add(name);
  }
  return found;
}

// The OPTABLE the estate's assembly steps give in PARM (ASMA90, the old IEV90, or a procedure such as
// ASMACL), with where each was written. One level is the estate's; several leave each file to its own.
function jclOptables(root, tree, files) {
  const levels = new Map();
  for (const f of files) {
    let job;
    try { job = parseJcl(tree.text(f).text, f); } catch { continue; }
    for (const step of job.steps) {
      if (!/^(?:ASMA90|IEV90)$/i.test(step.pgm || '') && !/^(?:ASMA|HLASM|IEV)/i.test(step.proc || '')) continue;
      for (const [k, v] of step.keywords) {
        const found = /^PARM(?:\.|$)/.test(k) ? optableIn(v) : null;
        if (found && !levels.has(found.level)) levels.set(found.level, `${relPath(root, f)}:${step.line}`);
      }
    }
  }
  return levels;
}

export function scanHlasm(root, opts = {}) {
  const tree = treeFor(root, opts);
  const all = tree.list().filter(inScope(opts));
  const findings = [];
  const stats = { filesScanned: 0, filesUnreadable: 0, assemblerFiles: 0, bmsFiles: 0, imsFiles: 0, unrecognisedFiles: 0, readNotAssembled: true };
  const members = new Set(all.filter((f) => [...HLASM_EXT, ...COPY_EXT].some((e) => f.toLowerCase().endsWith(e))).map((f) => basename(f, extname(f)).toUpperCase()));
  const libraryMacros = repositoryMacros(tree, all.filter(isAssembler));
  const forms = { mvs38: opts.mvs38Forms !== false };
  const fromJcl = opts.hlasmOptable ? new Map() : jclOptables(root, tree, all.filter(isJcl));
  const estateOptable = opts.hlasmOptable ?? (fromJcl.size === 1 ? [...fromJcl.keys()][0] : null);
  if (opts.hlasmOptable) stats.hlasmOptable = { level: opts.hlasmOptable, from: 'option' };
  else if (fromJcl.size === 1) stats.hlasmOptable = { level: estateOptable, from: [...fromJcl.values()][0] };
  else if (fromJcl.size > 1) stats.hlasmOptableConflict = Object.fromEntries(fromJcl);
  // The table a file is assembled with: the option given to the scan, then a *PROCESS OVERRIDE in
  // the file, the estate's PARM, and the file's own *PROCESS, as HLASM ranks them.
  const optableOf = (src) => {
    if (opts.hlasmOptable) return opts.hlasmOptable;
    const own = optableIn(processOptions(src));
    return own?.override ? own.level : estateOptable ?? own?.level ?? null;
  };
  const refused = {};
  const macroCalls = new Map();
  const copyNotFound = new Set();
  // Reads a file's statements: its labels, what the reader refused, and the macros and COPY members it
  // uses, which count toward the coverage report unless the file is a document.
  function readStatements(src, path) {
    const labels = new Map();
    const read = readHlasmStatements(src, { libraryMacros }).statements;
    const statements = read.filter((st) => !st.inMacro);
    const fileForms = { ...forms, optable: optableOf(src) };
    const results = statements.map((st) => parseHlasmStatement(st, fileForms));
    const refusals = results.filter((res) => res.status === 'unparsed' || res.status === 'unknown').length;
    if (isDocument(read.filter((st) => st.kind === 'statement'), statements.length, refusals)) return null;
    statements.forEach((st, i) => {
      const res = results[i];
      if (st.kind === 'statement' && st.name && !st.name.startsWith('&') && !st.name.startsWith('.')) labels.set(st.name.toUpperCase(), st);
      if (res.node?.mvs38) stats.mvs38Forms = (stats.mvs38Forms || 0) + 1;
      if (res.status === 'unparsed' || res.status === 'unknown') (refused[res.kind] ||= { count: 0, first: `${path}:${st.line}` }).count++;
      const name = res.kind === 'MACRO CALL' ? st.operation : NAMED_MACROS.has(res.kind) ? res.kind : null;
      if (name) {
        const m = macroCalls.get(name) || { name, calls: 0, definedInTree: members.has(name) };
        m.calls++;
        macroCalls.set(name, m);
      }
      if (res.kind === 'COPY') {
        const member = String(res.status === 'parsed' ? res.node.member : (/^\s*([A-Z$#@][A-Z0-9$#@_]*)/i.exec(st.field || '') || [])[1] || '').toUpperCase();
        if (member && !members.has(member)) copyNotFound.add(member);
      }
    });
    return labels;
  }
  const defines = new Map();

  const run = eachWithinMemory(all.filter(isAssembler), (f) => {
    let src;
    try { src = tree.text(f).text; } catch (e) { noteUnread(stats, tree, f, e); return 0; }
    stats.filesScanned++;
    const r = readHlasm(src, forms);
    if (r.kind === 'bms') { stats.bmsFiles++; return src.length; }
    if (r.kind === 'ims') { stats.imsFiles++; return src.length; }
    if (r.kind === 'unrecognised') { stats.unrecognisedFiles++; return src.length; }
    if (r.kind === 'listing') { stats.listingFiles = (stats.listingFiles || 0) + 1; return src.length; }
    const path = relPath(root, f);
    const labels = readStatements(src, path);
    if (!labels) { stats.documentFiles = (stats.documentFiles || 0) + 1; return src.length; }
    stats.assemblerFiles++;
    for (const d of r.defines) if (!defines.has(d.name)) defines.set(d.name, { ...d, path });
    for (const use of r.operations) {
      if (use.class === 'module-load') {
        const { keywords } = macroOperands(use.field || '');
        const at = keywords.has('EPLOC') ? 'EPLOC' : keywords.has('DE') ? 'DE' : null;
        if (at) findings.push({ rule: 'hlasm-runtime-module-name', path, line: use.line, detail: `${use.name} ${at}=${keywords.get(at)} names the module by the address of its name, so the program that runs is whatever name that storage holds.${where(use)}` });
        continue;
      }
      if (use.name === 'MODESET') {
        if (use.stateChange) findings.push({ rule: 'hlasm-supervisor-state-change', path, line: use.line, detail: `MODESET ${use.stateChange} switches to ${STATE[use.stateChange.split('=')[0]]}.${where(use)}` });
        // A system key writes storage problem-state keys cannot, short of key zero's reach.
        else if (use.systemKey) findings.push({ rule: 'hlasm-supervisor-state-change', sev: 'high', path, line: use.line, detail: `MODESET ${use.systemKey.written} switches to PSW key ${use.systemKey.key}, a system key.${where(use)}` });
        continue;
      }
      const rule = RULE_OF_CLASS[use.class];
      if (rule) findings.push({ rule, path, line: use.line, detail: detail(use, labels) });
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

  // Each statement the reader refused, each macro whose expansion was not read and each COPY member
  // the tree does not hold is named: an operation inside any of them is one this set did not see.
  if (Object.keys(refused).length) { stats.statementsNotRead = refused; stats.coverageIncomplete = true; }
  if (copyNotFound.size) { stats.copyNotFound = [...copyNotFound].sort(); stats.coverageIncomplete = true; }
  if (macroCalls.size) stats.macrosNotExpanded = [...macroCalls.values()].sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name)).slice(0, 50);
  return report('hlasm', { rules: HLASM_RULES, findings, stats, run });
}
