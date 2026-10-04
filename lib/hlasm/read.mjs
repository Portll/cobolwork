// SPDX-License-Identifier: AGPL-3.0-or-later
// HLASM source read statement by statement: the cards fold as the assembler folds them (lib/bms.mjs),
// and each statement goes to the parser for what its operation is. A machine instruction is matched
// against IBM's operand syntax, an assembler instruction and a system macro each have their own
// parser, and any other macro call is split into its operands. Conditional assembly and macro
// definitions are counted and not evaluated: nothing here expands a macro.
import { foldStatements } from '../bms.mjs';
import { HlasmSyntax, NAME, macroOperands } from './operands.mjs';
import { INSTRUCTIONS, parseInstruction, formatFamily } from './instr.mjs';
import { parsers as data } from './asm/data.mjs';
import { parsers as sections } from './asm/sections.mjs';
import { parsers as symbols } from './asm/symbols.mjs';
import { parsers as listing } from './asm/listing.mjs';
import { parsers as output } from './asm/output.mjs';
import { parsers as program } from './macro/program.mjs';
import { parsers as linkage } from './macro/linkage.mjs';
import { parsers as storage } from './macro/storage.mjs';
import { parsers as authorization } from './macro/authorization.mjs';
import { parsers as operator } from './macro/operator.mjs';
import { parsers as datasets } from './macro/datasets.mjs';
import { parsers as io } from './macro/io.mjs';
import { parsers as recovery } from './macro/recovery.mjs';
import { parsers as le } from './macro/le.mjs';
import { parsers as structured } from './macro/structured.mjs';
import { parsers as exec } from './exec.mjs';
import { parsers as model } from './model.mjs';

// The assembler instructions of HLASM V1R6 (Language Reference SC26-4940-09, chapters 5 and 9).
export const ASSEMBLER = new Set(['ACONTROL', 'ADATA', 'AINSERT', 'ALIAS', 'AMODE', 'CATTR', 'CCW', 'CCW0', 'CCW1',
  'CEJECT', 'CNOP', 'COM', 'COPY', 'CSECT', 'CXD', 'DC', 'DROP', 'DS', 'DSECT', 'DXD', 'EJECT', 'END', 'ENTRY', 'EQU',
  'EXITCTL', 'EXTRN', 'ICTL', 'ISEQ', 'LOCTR', 'LTORG', 'MNOTE', 'OPSYN', 'ORG', 'POP', 'PRINT', 'PUNCH', 'PUSH',
  'REPRO', 'RMODE', 'RSECT', 'SPACE', 'START', 'TITLE', 'USING', 'WXTRN', 'XATTR']);
export const CONDITIONAL = new Set(['ACTR', 'AEJECT', 'AGO', 'AGOB', 'AIF', 'AIFB', 'ANOP', 'AREAD', 'ASPACE',
  'GBLA', 'GBLB', 'GBLC', 'LCLA', 'LCLB', 'LCLC', 'MEXIT', 'MHELP', 'SETA', 'SETAF', 'SETB', 'SETC', 'SETCF']);
// The z/OS macros the rules read, each parsed against the keywords IBM lists for it.
export const SYSTEM_MACROS = new Set(['LINK', 'XCTL', 'LOAD', 'ATTACH', 'CALL', 'SAVE', 'RETURN', 'MODESET',
  'STORAGE', 'GETMAIN', 'FREEMAIN', 'RACROUTE', 'TESTAUTH', 'WTO', 'WTOR', 'OPEN', 'CLOSE', 'DCB', 'GET', 'PUT',
  'READ', 'WRITE', 'ESTAE', 'ESPIE', 'ABEND', 'SNAP']);
// Language Environment's prolog, epilog and mapping macros, and the HLASM Toolkit's structured
// programming macros, each with its own parser.
export const LE_MACROS = new Set(['CEEENTRY', 'CEETERM', 'CEEPPA', 'CEECAA', 'CEEDSA']);
export const TOOLKIT_MACROS = new Set(['IF', 'ELSE', 'ELSEIF', 'ENDIF', 'DO', 'ENDDO', 'DOEXIT', 'ASMLEAVE', 'ITERATE',
  'SELECT', 'WHEN', 'NEXTWHEN', 'OTHRWISE', 'ENDSEL', 'STRTSRCH', 'EXITIF', 'ORELSE', 'ENDLOOP', 'ENDSRCH',
  'CASENTRY', 'CASE', 'ENDCASE', 'ASMMREL']);
export const NAMED_MACROS = new Set([...SYSTEM_MACROS, ...LE_MACROS, ...TOOLKIT_MACROS]);

const NO_OPERANDS = new Set(['CSECT', 'DSECT', 'RSECT', 'COM', 'LOCTR', 'LTORG', 'EJECT', 'REPRO', 'CXD']);

export const PARSERS = Object.freeze({ ...data, ...sections, ...symbols, ...listing, ...output });
export const MACRO_PARSERS = Object.freeze({ ...program, ...linkage, ...storage, ...authorization, ...operator, ...datasets, ...io, ...recovery, ...le, ...structured });

// Statements other than comments, each marked inMacro when it is part of a macro definition, the
// prototype (the statement after MACRO) marked as such, and sourceMacro when its operation names a
// macro the file has already defined: a source macro with the name of an instruction or a library
// macro overrides it (https://www.ibm.com/docs/en/hla-and-tf/1.6.0?topic=definitions-macro-instruction-prototype).
// EXEC CICS and EXEC SQL are written for their translators, with blanks between the words: their
// field is the cards' text after EXEC, columns 16 to 71 of each continuation, not the operands up
// to the first blank as an assembler statement's are.
function execField(phys, st) {
  return st.lines.map((n, i) => (i === 0 ? phys[n - 1].slice(0, 71).replace(/^\S*\s+EXEC\b/i, '') : phys[n - 1].slice(15, 71))).join(' ').replace(/\s+/g, ' ').trim();
}

export function readHlasmStatements(text) {
  const { statements, diags } = foldStatements(text);
  const phys = String(text).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let depth = 0;
  let prototypeNext = false;
  const defined = new Set();
  for (const s of statements) {
    if (s.kind === 'comment') continue;
    const st = { ...s, inMacro: depth > 0, prototype: false };
    if (s.kind === 'statement' && s.operation === 'EXEC') st.field = execField(phys, s);
    if (s.kind === 'statement') {
      if (s.operation === 'MACRO') { depth++; prototypeNext = true; st.inMacro = true; }
      else if (prototypeNext) { st.prototype = true; prototypeNext = false; if (s.operation) defined.add(s.operation.toUpperCase()); }
      else if (s.operation && defined.has(s.operation.toUpperCase())) st.sourceMacro = true;
      if (s.operation === 'MEND') depth = Math.max(0, depth - 1);
    }
    out.push(st);
  }
  return { statements: out, diags };
}

function run(kind, parser, st, ...args) {
  if (!parser) return { kind, status: 'unbuilt' };
  try {
    return { kind, status: 'parsed', node: parser(st, ...args) };
  } catch (e) {
    if (e instanceof HlasmSyntax) return { kind, status: 'unparsed', reason: e.message };
    return { kind, status: 'unparsed', reason: `parser error: ${e && e.message}`, crash: true };
  }
}

// { kind, status, node?, reason?, crash? }: parsed, unbuilt (no parser for the kind yet), unparsed
// (the parser refused it) or unknown (not an operation HLASM has).
export function parseHlasmStatement(st) {
  if (st.kind !== 'statement') return { kind: 'UNREADABLE', status: 'unknown', reason: 'no operation field' };
  const op = st.operation;
  if (op === 'MACRO' || op === 'MEND') return { kind: 'MACRO DEFINITION', status: 'parsed', node: { kind: op } };
  if (CONDITIONAL.has(op)) return { kind: 'CONDITIONAL', status: 'unbuilt' };
  if (st.prototype) return run('PROTOTYPE', model.PROTOTYPE, st);
  if (st.inMacro) return run('MODEL', model.MODEL, st);
  if (/&[A-Z$#@_]/i.test(`${st.name || ''} ${op} ${st.field || ''}`.replace(/&&/g, ''))) return run('SUBSTITUTED', model.SUBSTITUTED, st);
  if (st.sourceMacro) return run('MACRO CALL', (s) => ({ kind: 'MACRO CALL', macro: op, source: true, ...macroOperands(s.field || '') }), st);
  // A lone comma is the convention for no operands with remarks after it (CSECT , remark); an
  // instruction that takes no operands reads whatever follows it as remarks.
  if (ASSEMBLER.has(op)) return run(op, PARSERS[op], st.field === ',' || NO_OPERANDS.has(op) ? { ...st, field: '' } : st);
  const row = INSTRUCTIONS.get(op);
  if (row) return run(formatFamily(row.format), parseInstruction, st, row);
  if (op === 'EXEC') {
    const kind = `EXEC ${(/^\S+/.exec(st.field || '') || ['?'])[0].toUpperCase()}`;
    return run(kind, exec[kind], st);
  }
  if (!NAME.test(op)) return { kind: 'UNKNOWN', status: 'unknown', reason: `${op} is not an operation name` };
  if (NAMED_MACROS.has(op)) {
    const parser = MACRO_PARSERS[op];
    return run(op, parser && ((s) => parser(s, macroOperands(s.field === ',' ? '' : s.field || ''))), st);
  }
  return run('MACRO CALL', (s) => ({ kind: 'MACRO CALL', macro: op, ...macroOperands(s.field || '') }), st);
}
