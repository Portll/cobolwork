// SPDX-License-Identifier: AGPL-3.0-or-later
// HLASM source, read and not assembled. The cards fold into statements as the assembler folds them
// (lib/bms.mjs), and each statement's operation is looked up in rules/hlasm-operations.json, the
// operations that matter to a reviewer, each with the IBM document that defines it. Macros are not
// expanded and conditional assembly is not evaluated, so an operation is reported where it is
// written: in a macro definition, or in a branch AIF jumps over, as much as anywhere else.
import { readFileSync } from 'node:fs';
import { foldStatements } from './bms.mjs';
import { parseOperands, splitOperands } from './cards.mjs';

const TABLE = JSON.parse(readFileSync(new URL('../rules/hlasm-operations.json', import.meta.url), 'utf8'));
export const OPERATIONS = new Map(TABLE.operations.map((o) => [o.name, o]));

// Operations only assembler source holds: sections, base registers, the instructions every
// program's linkage uses, and macro definitions. x86 or 6502 source written in a .asm file has none.
// The weak ones are words another assembler's source can hold (a 6502 `zproc start`), so it takes
// two different ones to count. USING counts only with the comma between its base and register: a
// comment line written `C  Using a ...`, as GMP's are, reads as label C and operation USING.
const ASSEMBLER = new Set(['CSECT', 'DSECT', 'RSECT', 'USING', 'BALR', 'BASR', 'STM', 'STMG', 'LM', 'LMG', 'MVC',
  'MACRO', 'MEND', 'AMODE', 'RMODE', 'LTORG', 'CNOP']);
const WEAK = new Set(['START', 'DC', 'DS', 'BAL', 'BAS', 'DROP']);
const strong = (s) => ASSEMBLER.has(s.operation) && (s.operation !== 'USING' || s.field.includes(','));

// GNU assembler source, run through m4 as GMP's is, holds s390 instructions too, and is not HLASM.
const GNU = /^dnl\b|^\s*\.(?:text|globl|global|section|align|file)\b|\b(?:PROLOGUE|EPILOGUE|ASM_START)\(/m;

// The macros that make a file a BMS map or an IMS database or program definition, which their own
// readers take.
const BMS = new Set(['DFHMSD', 'DFHMDI', 'DFHMDF']);
const IMS = new Set(['DBD', 'DBDGEN', 'SEGM', 'PSBGEN', 'PCB', 'SENSEG']);

// MODESET changes the PSW key or the state; these operand values make it key zero or supervisor
// state, and the opposite values (KEY=NZERO, MODE=PROB) return from it. EXTKEY is the inline form,
// which sets only the PSW key.
const STATE_CHANGE = { KEY: ['ZERO'], MODE: ['SUP'], EXTKEY: ['ZERO'] };

const nameList = (field) => splitOperands(field || '').map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z$#@_][A-Z0-9$#@_]*$/.test(s));

function stateChange(field) {
  let ops;
  try { ops = parseOperands(field || ''); } catch { return null; }
  for (const [key, values] of Object.entries(STATE_CHANGE)) {
    const v = ops.keywords.get(key);
    if (v && values.includes(String(v).trim().toUpperCase())) return `${key}=${String(v).trim().toUpperCase()}`;
  }
  return null;
}

// What the file is, and in it: each operation the table names with where it is written; the
// sections and entry points it defines, which a CALL or a job step can name; and the names it
// leaves to the binder.
export function readHlasm(text) {
  const { statements, diags } = foldStatements(text);
  const ops = statements.filter((s) => s.kind === 'statement');
  const has = (set) => ops.some((s) => set.has(s.operation));
  const weak = new Set(ops.filter((s) => WEAK.has(s.operation)).map((s) => s.operation)).size;
  const assembler = !GNU.test(text) && (ops.some(strong) || weak >= 2);
  const kind = has(BMS) ? 'bms' : has(IMS) ? 'ims' : assembler ? 'hlasm' : 'unrecognised';
  const out = { kind, statements: ops.length, operations: [], defines: [], external: [], diags };
  if (kind !== 'hlasm') return out;

  let macroDepth = 0;
  for (const s of ops) {
    if (s.operation === 'MACRO') { macroDepth++; continue; }
    if (s.operation === 'MEND') { macroDepth = Math.max(0, macroDepth - 1); continue; }
    const inMacro = macroDepth > 0;
    if (!inMacro && ['CSECT', 'RSECT', 'START'].includes(s.operation) && s.name && !s.name.startsWith('&')) {
      out.defines.push({ name: s.name.toUpperCase(), how: s.operation, line: s.line });
    }
    if (!inMacro && s.operation === 'ENTRY') for (const name of nameList(s.field)) out.defines.push({ name, how: 'ENTRY', line: s.line });
    if (!inMacro && (s.operation === 'EXTRN' || s.operation === 'WXTRN')) for (const name of nameList(s.field)) out.external.push({ name, how: s.operation, line: s.line });
    const op = OPERATIONS.get(s.operation);
    if (!op || op.class === 'section' || op.class === 'linkage') continue;
    const use = { name: op.name, class: op.class, line: s.line, inMacro, field: s.field };
    if (op.name === 'MODESET') use.stateChange = stateChange(s.field);
    out.operations.push(use);
  }
  return out;
}
