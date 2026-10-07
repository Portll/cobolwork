// SPDX-License-Identifier: AGPL-3.0-or-later
// HLASM source, read and not assembled. The cards fold into statements as the assembler folds them
// (lib/bms.mjs), and each statement's operation is looked up in rules/hlasm-operations.json, the
// operations that matter to a reviewer, each with the IBM document that defines it. Macros are not
// expanded and conditional assembly is not evaluated, so an operation is reported where it is
// written: in a macro definition, or in a branch AIF jumps over, as much as anywhere else.
import { readFileSync } from 'node:fs';
import { foldStatements } from './bms.mjs';
import { parseOperands, splitOperands } from './cards.mjs';
import { keyZeroExtkeys, systemKeyExtkeys } from './hlasm/mvs38.mjs';

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
// which sets only the PSW key; MVS 3.8's names for key zero count when its forms are read.
const STATE_CHANGE = { KEY: ['ZERO'], MODE: ['SUP'], EXTKEY: ['ZERO'] };

const nameList = (field) => splitOperands(field || '').map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z$#@_][A-Z0-9$#@_]*$/.test(s));

function stateChange(field, opts) {
  let ops;
  try { ops = parseOperands(field || ''); } catch { return null; }
  for (const [key, zero] of Object.entries(STATE_CHANGE)) {
    const values = key === 'EXTKEY' ? [...zero, ...keyZeroExtkeys(opts)] : zero;
    const v = ops.keywords.get(key);
    if (v && values.includes(String(v).trim().toUpperCase())) return `${key}=${String(v).trim().toUpperCase()}`;
  }
  return null;
}

// EXTKEY= naming a system key other than zero: z/OS's KEY2, KEY3, KEY4 and KEY7, and MVS 3.8's
// names for keys 1 to 7 when its forms are read. TCB, RBT1 and RBT234 take a key decided at run time.
const SYSTEM_EXTKEYS = [['KEY2', 2], ['KEY3', 3], ['KEY4', 4], ['KEY7', 7]];

function systemKeyChange(field, opts) {
  let ops;
  try { ops = parseOperands(field || ''); } catch { return null; }
  const v = String(ops.keywords.get('EXTKEY') || '').trim().toUpperCase();
  const key = new Map([...SYSTEM_EXTKEYS, ...systemKeyExtkeys(opts)]).get(v);
  return key === undefined ? null : { written: `EXTKEY=${v}`, key };
}

// A disassembler's listing: each line's object code, its characters between asterisks and its offset
// to the right of the source, as in `BR R15   07FF   *..*   00004`.
const DISASSEMBLED = /\s[0-9A-F]{2,16}(?: [0-9A-F]{2,16}){0,2}\s+\*.{1,16}\*\s+[0-9A-F]{5,8}\s*$/;

// English function words, which no statement's name, operation or first operand holds.
const FUNCTION_WORDS = new Set(['THE', 'OF', 'AND', 'TO', 'IS', 'IN', 'FOR', 'THIS', 'THAT', 'WITH', 'ARE', 'BE', 'IT', 'AN', 'WILL', 'CAN',
  'YOU', 'WHICH', 'FROM', 'ON', 'AS', 'BY', 'NOT', 'IF', 'WHEN', 'HAS', 'HAVE', 'WAS', 'ALL', 'ANY', 'ONE', 'MAY', 'YOUR', 'THESE', 'THEY',
  'THERE', 'SHOULD', 'MUST', 'ALSO', 'ONLY']);

// A manual, article or README saved as assembler source: its statements, macro definitions included,
// read as English, and the reader refuses many of those in open code. On the CBT, MVS 3.8j and GitHub
// corpora both thresholds together held for 25 documents and no program.
export function isDocument(statements, open, refused) {
  if (open < 5) return false;
  const english = statements.filter((s) => [s.name, s.operation, (s.field || '').split(/[\s,]/)[0]].some((w) => w && FUNCTION_WORDS.has(w.toUpperCase()))).length;
  return english >= 0.15 * statements.length && refused >= 0.2 * open;
}

// What the file is, and in it: each operation the table names with where it is written; the
// sections and entry points it defines, which a CALL or a job step can name; and the names it
// leaves to the binder.
export function readHlasm(text, opts = {}) {
  const { statements, diags } = foldStatements(text, { batch: true });
  const ops = statements.filter((s) => s.kind === 'statement');
  const has = (set) => ops.some((s) => set.has(s.operation));
  const weak = new Set(ops.filter((s) => WEAK.has(s.operation)).map((s) => s.operation)).size;
  const assembler = !GNU.test(text) && (ops.some(strong) || weak >= 2);
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const listing = ops.length >= 5 && ops.filter((s) => DISASSEMBLED.test(lines[s.line - 1].slice(0, 80))).length * 2 >= ops.length;
  const kind = has(BMS) ? 'bms' : has(IMS) ? 'ims' : !assembler ? 'unrecognised' : listing ? 'listing' : 'hlasm';
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
    if (op.name === 'MODESET') {
      use.stateChange = stateChange(s.field, opts);
      if (!use.stateChange) use.systemKey = systemKeyChange(s.field, opts);
    }
    out.operations.push(use);
  }
  return out;
}
