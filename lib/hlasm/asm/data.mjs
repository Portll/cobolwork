// SPDX-License-Identifier: AGPL-3.0-or-later
// DC and DS operands, and literals, which are DC operands after an equals sign: duplication factor,
// type and type extension, program type, length, scale and exponent modifiers, and nominal value.
// https://www.ibm.com/docs/en/hla-and-tf/1.6.0?topic=statements-dc-instruction
import { HlasmSyntax, splitOperands } from '../operands.mjs';
import { readExpression } from '../expr.mjs';

const EXTENSIONS = {
  C: 'AEU', G: '', X: '', B: '', F: 'D', H: '', E: 'HBD', D: 'HBD', L: 'HBDQ', P: '', Z: '',
  A: 'D', Y: '', S: 'Y', V: 'D', Q: 'DY', J: 'D', R: 'D',
};
const ADDRESS_TYPES = new Set(['A', 'Y', 'S', 'V', 'Q', 'J', 'R']);

// A parenthesised expression or a decimal number, as a duplication factor or a modifier is written.
function amount(text, pos) {
  if (text[pos] === '(') {
    const { e, end } = readExpression(text, pos + 1);
    if (text[end] !== ')') throw new HlasmSyntax(`expected ) at column ${end + 1} of '${text}'`);
    return { value: { t: 'paren', e }, end: end + 1 };
  }
  const m = /^\d+/.exec(text.slice(pos));
  if (!m) return null;
  return { value: { t: 'num', v: Number(m[0]) }, end: pos + m[0].length };
}

function quotedNominal(text, pos) {
  let out = '';
  for (let i = pos + 1; i < text.length; i++) {
    if (text[i] === "'") {
      if (text[i + 1] === "'") { out += "'"; i++; continue; }
      return { value: out, end: i + 1 };
    }
    if (text[i] === '&' && text[i + 1] === '&') i++;
    out += text[i];
  }
  throw new HlasmSyntax(`a nominal value is not closed in '${text}'`);
}

function addressNominal(text, pos) {
  const items = [];
  let at = pos + 1;
  for (;;) {
    const { e, end } = readExpression(text, at);
    at = end;
    if (text[at] === '(') {
      const close = text.indexOf(')', at);
      if (close < 0) throw new HlasmSyntax(`a base register is not closed in '${text}'`);
      items.push({ t: 'address', disp: e, base: text.slice(at + 1, close) });
      at = close + 1;
    } else items.push(e);
    if (text[at] === ',') { at++; continue; }
    if (text[at] === ')') return { value: items, end: at + 1 };
    throw new HlasmSyntax(`expected , or ) at column ${at + 1} of '${text}'`);
  }
}

// One DC operand starting at pos: the operand, and where it ended. A literal needs a nominal value
// and a duplication factor that is not zero.
export function readDataOperand(text, pos = 0, { literal = false, nominalRequired = literal } = {}) {
  const operand = { dup: null, type: null, ext: null, program: null, length: null, bitLength: false, scale: null, exponent: null, nominal: null };
  let at = pos;
  const dup = amount(text, at);
  if (dup) { operand.dup = dup.value; at = dup.end; }
  const type = (text[at] || '').toUpperCase();
  if (!(type in EXTENSIONS)) throw new HlasmSyntax(`'${text.slice(pos)}' has no constant type a DC operand can have`);
  operand.type = type;
  at++;
  const ext = (text[at] || '').toUpperCase();
  if (ext && EXTENSIONS[type].includes(ext)) { operand.ext = ext; at++; }
  if ((text[at] || '').toUpperCase() === 'P' && text[at + 1] === '(') {
    const p = amount(text, at + 1);
    operand.program = p.value;
    at = p.end;
  }
  for (const [letter, key] of [['L', 'length'], ['S', 'scale'], ['E', 'exponent']]) {
    if ((text[at] || '').toUpperCase() !== letter) continue;
    let from = at + 1;
    if (key === 'length' && text[from] === '.') { operand.bitLength = true; from++; }
    const sign = key !== 'length' && (text[from] === '-' || text[from] === '+') ? text[from++] : '';
    const m = amount(text, from);
    if (!m) throw new HlasmSyntax(`the ${key} modifier in '${text}' has no value`);
    operand[key] = sign === '-' ? { t: 'unary', op: '-', e: m.value } : m.value;
    at = m.end;
  }
  if (text[at] === "'") {
    if (ADDRESS_TYPES.has(type)) throw new HlasmSyntax(`a ${type}-type constant takes its value in parentheses, not quotes, in '${text}'`);
    const n = quotedNominal(text, at);
    operand.nominal = { quoted: n.value };
    at = n.end;
  } else if (text[at] === '(') {
    if (!ADDRESS_TYPES.has(type)) throw new HlasmSyntax(`a ${type}-type constant takes its value in quotes, not parentheses, in '${text}'`);
    const n = addressNominal(text, at);
    operand.nominal = { expressions: n.value };
    at = n.end;
  }
  // A DC operand may omit its nominal value only when its duplication factor is zero.
  const zeroDup = operand.dup && operand.dup.t === 'num' && operand.dup.v === 0;
  if (nominalRequired && !operand.nominal && !(zeroDup && !literal)) throw new HlasmSyntax(`'${text.slice(pos, at)}' has no nominal value`);
  if (literal && operand.dup && operand.dup.t === 'num' && operand.dup.v === 0) throw new HlasmSyntax('a literal cannot have a duplication factor of zero');
  return { operand, end: at };
}

function operands(st, nominalRequired) {
  const list = splitOperands(st.field || '');
  if (!list.length) throw new HlasmSyntax(`${st.operation} has no operand`);
  return list.map((text) => {
    const { operand, end } = readDataOperand(text, 0, { nominalRequired });
    if (end !== text.length) throw new HlasmSyntax(`unexpected '${text.slice(end)}' after the operand '${text.slice(0, end)}'`);
    return operand;
  });
}

export const parsers = {
  DC: (st) => ({ kind: 'DC', operands: operands(st, true) }),
  DS: (st) => ({ kind: 'DS', operands: operands(st, false) }),
};
