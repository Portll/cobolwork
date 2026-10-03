// SPDX-License-Identifier: AGPL-3.0-or-later
// Machine instructions, matched against the operand syntax rules/hlasm-instructions.json gives each
// mnemonic: the operand count, and each operand an expression or an address of the written shape.
// One matcher for every format, since IBM's operand syntax already says what each operand is.
import { readFileSync, existsSync } from 'node:fs';
import { HlasmSyntax, splitOperands } from './operands.mjs';
import { parseExpression, parseAddress } from './expr.mjs';

const TABLE = new URL('../../rules/hlasm-instructions.json', import.meta.url);
const rows = existsSync(TABLE) ? JSON.parse(readFileSync(TABLE, 'utf8')).instructions : [];
export const INSTRUCTIONS = new Map(rows.map((r) => [r.mnemonic, r]));

// "R1,D2(X2,B2)[,M3]" as operand shapes: an address names how many parts its parentheses may hold.
const shapes = new Map();
function shapeOf(pattern) {
  if (shapes.has(pattern)) return shapes.get(pattern);
  const out = [];
  let optional = false;
  for (let part of splitOperands(pattern.replace(/\[,?/g, ',[').replace(/\]/g, '').replace(/^,/, ''))) {
    if (part.startsWith('[')) { optional = true; part = part.slice(1); }
    const address = /^(D\d*)\(([^)]*)\)$/.exec(part);
    out.push({ name: part, optional, parts: address ? address[2].split(',').length : 0 });
  }
  shapes.set(pattern, out);
  return out;
}

export const formatFamily = (format) => String(format || '').replace(/-[a-z]$/, '');

export function parseInstruction(st, row) {
  const shape = shapeOf(row.operands || '');
  // An instruction with no operands takes whatever follows it as remarks: SAM24  Back to AMODE 24.
  if (!shape.length) return { kind: 'INSTRUCTION', mnemonic: st.operation, format: row.format, length: row.length, operands: [] };
  const given = splitOperands(st.field || '');
  const required = shape.filter((s) => !s.optional).length;
  if (given.length < required || given.length > shape.length) {
    throw new HlasmSyntax(`${st.operation} takes ${required === shape.length ? required : `${required} to ${shape.length}`} operands (${row.operands}), not ${given.length}`);
  }
  const operands = given.map((text, i) => {
    const s = shape[i];
    if (!text) throw new HlasmSyntax(`operand ${i + 1} of ${st.operation} (${s.name}) is empty`);
    if (!s.parts) return { operand: s.name, e: parseExpression(text) };
    const a = parseAddress(text);
    if (a.parts && a.parts.length > s.parts) throw new HlasmSyntax(`operand ${i + 1} of ${st.operation} (${s.name}) has ${a.parts.length} parts in parentheses, not at most ${s.parts}`);
    return { operand: s.name, ...a };
  });
  return { kind: 'INSTRUCTION', mnemonic: st.operation, format: row.format, length: row.length, operands };
}
