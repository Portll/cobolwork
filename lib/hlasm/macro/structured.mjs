// SPDX-License-Identifier: AGPL-3.0-or-later
// Parsers for the HLASM Toolkit structured programming macros (IF, DO, SELECT, etc.).
import { HlasmSyntax, NAME, splitOperands } from '../operands.mjs';

const CC_MNEMONICS = new Set(['H', 'L', 'E', 'Z', 'O', 'M', 'P', 'NH', 'NL', 'NE', 'NZ', 'NO', 'NM', 'NP', 'EQ', 'GT', 'LT', 'GE', 'LE',
  'HE', 'LE', 'NHE', 'NLE']);
const CONNECTORS = new Set(['AND', 'OR', 'ANDIF', 'ORIF']);

// (Z) or (8): a condition-code mnemonic or a mask; (CLI,0(R1),EQ,C'A') or (LTR,R15,R15,NZ): an
// instruction and its operands with the condition among them.
function parseCondition(text) {
  const t = text.trim();
  if (!t.startsWith('(') || !t.endsWith(')')) {
    if (CC_MNEMONICS.has(t.toUpperCase())) return t;
    throw new HlasmSyntax(`unrecognised condition: ${t}`);
  }
  const parts = splitOperands(t.slice(1, -1)).map((x) => x.trim());
  if (parts.length === 1) {
    if (CC_MNEMONICS.has(parts[0].toUpperCase()) || /^(?:CC=)?(?:[1-9]|1[0-4])$/i.test(parts[0])) return t;
    throw new HlasmSyntax(`unrecognised condition: ${t}`);
  }
  if (!NAME.test(parts[0])) throw new HlasmSyntax(`condition ${t} does not start with an instruction`);
  if (!parts.slice(1).some((x) => CC_MNEMONICS.has(x.toUpperCase()))) throw new HlasmSyntax(`unrecognised condition: ${t} names no condition mnemonic`);
  return t;
}

// Conditions joined by AND, OR, ANDIF and ORIF, each operand of the macro one condition or joiner.
function parsePredicate(positional) {
  const items = positional.map((x) => x.trim()).filter(Boolean);
  if (!items.length) throw new HlasmSyntax('requires a predicate');
  const conditions = [];
  const joins = [];
  items.forEach((x, i) => {
    if (i % 2) {
      if (!CONNECTORS.has(x.toUpperCase())) throw new HlasmSyntax(`expected AND, OR, ANDIF or ORIF, not ${x}`);
      joins.push(x.toUpperCase());
    } else conditions.push(parseCondition(x));
  });
  if (joins.length === conditions.length) throw new HlasmSyntax('a predicate cannot end with a joiner');
  return { conditions, joins };
}

function parseIF(st, ops) {
  const { conditions, joins } = parsePredicate(ops.positional);
  return { kind: 'IF', conditions, joins, keywords: Object.fromEntries(ops.keywords) };
}

function parseELSEIF(st, ops) {
  const { conditions, joins } = parsePredicate(ops.positional);
  return { kind: 'ELSEIF', conditions, joins, keywords: Object.fromEntries(ops.keywords) };
}

function parseDO(st, ops) {
  const pos = ops.positional[0] || '';
  const kw = ops.keywords;
  let form = 'SIMPLE';
  if (pos) {
    const upper = pos.toUpperCase();
    if (upper === 'ONCE') form = 'ONCE';
    else if (upper === 'INF') form = 'INF';
    else if (upper === 'BXH' || upper === 'BXLE' || upper === 'BCT' || upper === 'BCTR') form = 'COUNT';
    else if (pos.startsWith('(')) form = 'COUNT';
    else if (upper === 'WHILE' || upper === 'UNTIL') {
      if (kw.has(upper)) form = upper;
      else throw new HlasmSyntax(`unknown DO positional operand: ${pos}`);
    }
    else throw new HlasmSyntax(`unknown DO positional operand: ${pos}`);
  }
  if (kw.has('FROM')) form = 'FROM';
  else if (kw.has('WHILE')) form = 'WHILE';
  else if (kw.has('UNTIL')) form = 'UNTIL';
  return { kind: 'DO', form, keywords: Object.fromEntries(kw) };
}

function parseDOEXIT(st, ops) {
  const pos = ops.positional[0] || '';
  if (pos) {
    parseCondition(pos);
  }
  return { kind: 'DOEXIT', operands: [pos], keywords: Object.fromEntries(ops.keywords) };
}

function parseITERATE(st, ops) {
  const pos = ops.positional[0] || '';
  if (pos) {
    if (!NAME.test(pos)) throw new HlasmSyntax(`ITERATE operand must be a label: ${pos}`);
  }
  return { kind: 'ITERATE', operands: [pos], keywords: Object.fromEntries(ops.keywords) };
}

function parseASMLEAVE(st, ops) {
  const pos = ops.positional[0] || '';
  if (pos && !NAME.test(pos)) throw new HlasmSyntax(`ASMLEAVE operand must be a label: ${pos}`);
  return { kind: 'ASMLEAVE', operands: [pos], keywords: Object.fromEntries(ops.keywords) };
}

// SELECT alone, or SELECT instruction,operand,condition: CLI,0(R6),EQ compares each WHEN's values.
function parseSELECT(st, ops) {
  const parts = ops.positional.map((x) => x.trim()).filter(Boolean);
  if (parts.length && (parts.length < 3 || !CC_MNEMONICS.has(parts[2].toUpperCase()))) throw new HlasmSyntax(`SELECT ${parts.join(',')} is not instruction,operand,condition`);
  return { kind: 'SELECT', operands: [parts.join(',')].filter(Boolean), keywords: Object.fromEntries(ops.keywords) };
}

// WHEN takes a condition, or after a comparing SELECT a parenthesised list of values: (X'20'), (1,5,13).
function parseWHEN(st, ops) {
  const parts = ops.positional.map((x) => x.trim()).filter(Boolean);
  if (!parts.length) throw new HlasmSyntax('WHEN needs a condition or values');
  for (const p of parts) if (!(p.startsWith('(') && p.endsWith(')')) && !CONNECTORS.has(p.toUpperCase())) throw new HlasmSyntax(`WHEN operand ${p} is not in parentheses`);
  return { kind: 'WHEN', operands: parts, keywords: Object.fromEntries(ops.keywords) };
}

function parseNoOperand(st, ops) {
  if (ops.positional.some((p) => p.trim() !== '')) throw new HlasmSyntax(`${st.operation} does not accept positional operands`);
  return { kind: st.operation, keywords: Object.fromEntries(ops.keywords) };
}

export const parsers = {
  IF: parseIF,
  ELSEIF: parseELSEIF,
  ELSE: parseNoOperand,
  ENDIF: parseNoOperand,
  DO: parseDO,
  ENDDO: parseNoOperand,
  DOEXIT: parseDOEXIT,
  ITERATE: parseITERATE,
  ASMLEAVE: parseASMLEAVE,
  SELECT: parseSELECT,
  WHEN: parseWHEN,
  OTHRWISE: parseNoOperand,
  ENDSEL: parseNoOperand
};
