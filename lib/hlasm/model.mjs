// SPDX-License-Identifier: AGPL-3.0-or-later
// Macro prototypes, model statements and open-code statements that hold variable symbols. A model
// statement is read as the statement it is: each variable symbol in its operands stands in for an
// ordinary symbol, or for the letter X inside a quoted string, and the result goes to the parser for
// its operation. An operation that is itself a variable symbol is decided at expansion and refused.
import { HlasmSyntax, NAME, splitOperands } from './operands.mjs';
import { parseHlasmStatement } from './read.mjs';

const VARIABLE = /^&[A-Z$#@_][A-Z0-9$#@_]*$/i;
// System variable symbols whose value has a fixed length, which is all a constant's length needs.
// https://www.ibm.com/docs/en/hla-and-tf/1.6.0?topic=symbols-sysdate-system-variable-symbol
const FIXED_LENGTH = { '&SYSDATE': 8, '&SYSDATC': 8, '&SYSTIME': 5 };

// &NAME, with an optional subscript (&A(1), &A(&I+1)) and an optional period that joins it to what
// follows. && is one ampersand, not a variable symbol. Inside a quoted string a variable becomes as
// many X as its value has characters when that is fixed, and one X otherwise, counted as unsized.
function substitute(text) {
  let out = '';
  let quoted = false;
  let n = 0;
  let unsized = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'") { quoted = !quoted; out += c; continue; }
    if (c !== '&') { out += c; continue; }
    if (text[i + 1] === '&') { out += '&&'; i++; continue; }
    const m = /^&[A-Z$#@_][A-Z0-9$#@_]*/i.exec(text.slice(i));
    if (!m) { out += c; continue; }
    i += m[0].length;
    if (text[i] === '(') {
      let depth = 0;
      for (; i < text.length; i++) { if (text[i] === '(') depth++; else if (text[i] === ')' && --depth === 0) { i++; break; } }
    }
    if (text[i] === '.') i++;
    i--;
    const fixed = FIXED_LENGTH[m[0].toUpperCase()];
    if (quoted && !fixed) unsized++;
    out += quoted ? 'X'.repeat(fixed || 1) : `VAR${++n}`;
  }
  return { text: out, unsized };
}

function read(kind, st) {
  if (/&[A-Z$#@_]/i.test(st.operation)) throw new HlasmSyntax(`the operation ${st.operation} is decided when the macro is expanded`);
  const name = st.name && !st.name.startsWith('&') && !st.name.startsWith('.') ? st.name : null;
  const { text, unsized } = substitute(st.field || '');
  const res = parseHlasmStatement({ ...st, name, field: text, inMacro: false, prototype: false });
  // exact: no quoted string holds a variable of unknown length, so the node's lengths are the source's.
  if (res.status === 'parsed') return { kind, as: res.kind, node: res.node, exact: unsized === 0 };
  if (res.status === 'unbuilt') throw new HlasmSyntax(`no parser yet for ${res.kind}`);
  throw new HlasmSyntax(res.reason || `${res.kind} ${res.status}`);
}

function prototype(st) {
  if (st.name && !VARIABLE.test(st.name)) throw new HlasmSyntax(`a prototype's name field is a variable symbol or empty, not ${st.name}`);
  if (!NAME.test(st.operation)) throw new HlasmSyntax(`${st.operation} is not a macro name`);
  const positional = [];
  const keywords = {};
  for (const part of splitOperands(st.field || '')) {
    const m = /^(&[A-Z$#@_][A-Z0-9$#@_]*)=([\s\S]*)$/i.exec(part);
    if (m) keywords[m[1].toUpperCase()] = m[2];
    else if (VARIABLE.test(part)) positional.push(part.toUpperCase());
    else if (part !== '') throw new HlasmSyntax(`prototype operand ${part} is not a variable symbol`);
  }
  return { kind: 'PROTOTYPE', macro: st.operation, label: st.name || null, positional, keywords };
}

export const parsers = {
  PROTOTYPE: prototype,
  MODEL: (st) => read('MODEL', st),
  SUBSTITUTED: (st) => read('SUBSTITUTED', st),
};
