// SPDX-License-Identifier: AGPL-3.0-or-later
// The assembler instructions that define symbols and move or read the location counter: EQU, ORG,
// CNOP, LTORG, USING, DROP, OPSYN, END, PUSH and POP.
// https://www.ibm.com/docs/en/hla-and-tf/1.6.0?topic=instructions-equ-instruction
import { HlasmSyntax, NAME, splitOperands } from '../operands.mjs';
import { parseExpression } from '../expr.mjs';

const ASSEMBLER_TYPES = new Set(['AR', 'CR', 'CR32', 'CR64', 'FPR', 'GR', 'GR32', 'GR64', 'VR']);
const STACKED = new Set(['PRINT', 'USING', 'ACONTROL', 'NOPRINT']);
const optional = (text) => (text ? parseExpression(text) : null);

function equ(st) {
  if (!st.name) throw new HlasmSyntax('EQU needs a name');
  const ops = splitOperands(st.field || '');
  if (!ops.length || !ops[0]) throw new HlasmSyntax('EQU needs a value');
  if (ops.length > 5) throw new HlasmSyntax(`EQU takes at most five operands, not ${ops.length}`);
  const assemblerType = ops[4] ? ops[4].toUpperCase() : null;
  if (assemblerType && !ASSEMBLER_TYPES.has(assemblerType)) throw new HlasmSyntax(`${ops[4]} is not an assembler type`);
  return { kind: 'EQU', name: st.name, value: parseExpression(ops[0]), length: optional(ops[1]), type: optional(ops[2]), programType: optional(ops[3]), assemblerType };
}

function org(st) {
  const ops = splitOperands(st.field || '');
  if (!ops.length) return { kind: 'ORG', value: null, boundary: null, offset: null };
  if (ops.length > 3) throw new HlasmSyntax(`ORG takes at most three operands, not ${ops.length}`);
  const boundary = ops[1] ? Number(ops[1]) : null;
  if (ops[1] && !(Number.isInteger(boundary) && boundary >= 2 && boundary <= 4096 && (boundary & (boundary - 1)) === 0)) throw new HlasmSyntax(`ORG boundary ${ops[1]} is not a power of 2 from 2 to 4096`);
  return { kind: 'ORG', value: ops[0] ? parseExpression(ops[0]) : null, boundary, offset: optional(ops[2]) };
}

function using(st) {
  const ops = splitOperands(st.field || '');
  if (ops.length < 2) throw new HlasmSyntax('USING needs a base and a register or address');
  const range = /^\(([\s\S]*)\)$/.exec(ops[0]);
  const parts = range ? splitOperands(range[1]) : null;
  if (parts && parts.length !== 2) throw new HlasmSyntax(`USING range ${ops[0]} needs a base and an end`);
  return {
    kind: 'USING', label: st.name || null,
    base: parseExpression(parts ? parts[0] : ops[0]), end: parts ? parseExpression(parts[1]) : null,
    registers: ops.slice(1).map((o) => parseExpression(o)),
  };
}

function names(kind, allowed) {
  return (st) => {
    const ops = splitOperands(st.field || '').map((o) => o.toUpperCase());
    for (const o of ops) if (!allowed.has(o)) throw new HlasmSyntax(`${kind} does not take ${o}`);
    if (!ops.length) throw new HlasmSyntax(`${kind} needs an operand`);
    return { kind, what: ops };
  };
}

export const parsers = {
  EQU: equ,
  ORG: org,
  USING: using,
  DROP: (st) => ({ kind: 'DROP', operands: splitOperands(st.field || '').map((o) => parseExpression(o)) }),
  LTORG: (st) => { if (st.field) throw new HlasmSyntax('LTORG takes no operand'); return { kind: 'LTORG', name: st.name || null }; },
  CNOP: (st) => {
    const ops = splitOperands(st.field || '');
    if (ops.length !== 2) throw new HlasmSyntax(`CNOP takes two operands, not ${ops.length}`);
    return { kind: 'CNOP', byte: parseExpression(ops[0]), boundary: parseExpression(ops[1]) };
  },
  OPSYN: (st) => {
    if (!st.name) throw new HlasmSyntax('OPSYN needs a name');
    const ops = splitOperands(st.field || '');
    if (ops.length > 1 || (ops[0] && !NAME.test(ops[0]))) throw new HlasmSyntax(`OPSYN takes one operation name, not ${st.field}`);
    return { kind: 'OPSYN', name: st.name, operation: ops[0] ? ops[0].toUpperCase() : null };
  },
  // The second operand names the language translator, in parentheses; it is kept as written.
  END: (st) => {
    const ops = splitOperands(st.field || '');
    if (ops.length > 2) throw new HlasmSyntax(`END takes at most two operands, not ${ops.length}`);
    return { kind: 'END', entry: ops[0] ? parseExpression(ops[0]) : null, language: ops[1] || null };
  },
  PUSH: names('PUSH', STACKED),
  POP: names('POP', STACKED),
};
