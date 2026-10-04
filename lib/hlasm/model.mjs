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
// Outside one it becomes what `standIn` gives for the nth such variable.
function substitute(text, standIn = (n) => `VAR${n}`) {
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
    out += quoted ? 'X'.repeat(fixed || 1) : standIn(++n);
  }
  return { text: out, unsized, variables: n };
}

// A variable outside quotes stands in for a symbol. When no statement reads that way, one variable
// at a time stands in for a quoted string (DC C&MSG, LA &R,=C&LIST) or a number (DC &T.F'0'), as a
// caller's value may be, and then all of them do; past eight variables only the uniform readings
// are tried.
const SYMBOL = (n) => `VAR${n}`;
const VALUES = ["'X'", '1'];
function* standIns(variables) {
  yield SYMBOL;
  if (variables <= 8) {
    for (let j = 1; j <= variables; j++) for (const value of VALUES) yield (n) => (n === j ? value : SYMBOL(n));
  }
  for (const value of VALUES) yield () => value;
}

function read(kind, st) {
  if (/&[A-Z$#@_]/i.test(st.operation)) throw new HlasmSyntax(`the operation ${st.operation} is decided when the macro is expanded`);
  // A name built from variable symbols (&NAME, KFBR&SYSNDX) stands in as an ordinary symbol, as the
  // operands do; one still holding an ampersand would send the statement back here.
  const named = st.name && !st.name.startsWith('.') ? substitute(st.name).text : null;
  const name = named && !named.includes('&') ? named : null;
  const { variables } = substitute(st.field || '');
  let first = null;
  for (const standIn of standIns(variables)) {
    const { text, unsized } = substitute(st.field || '', standIn);
    const res = parseHlasmStatement({ ...st, name, field: text, inMacro: false, prototype: false });
    // exact: the symbol reading, with no quoted string holding a variable of unknown length, so the
    // node's lengths are the source's.
    if (res.status === 'parsed') return { kind, as: res.kind, node: res.node, exact: standIn === SYMBOL && unsized === 0 };
    first ||= res;
    if (!variables) break;
  }
  if (first.status === 'unbuilt') throw new HlasmSyntax(`no parser yet for ${first.kind}`);
  throw new HlasmSyntax(first.reason || `${first.kind} ${first.status}`);
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
