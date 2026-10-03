// SPDX-License-Identifier: AGPL-3.0-or-later
// What every HLASM statement parser shares: the refusal it throws, and the split of an operand field
// into operands at the commas outside parentheses and quotes.

export class HlasmSyntax extends Error {
  constructor(message) { super(message); this.name = 'HlasmSyntax'; }
}

export const NAME = /^[A-Z$#@_][A-Z0-9$#@_]{0,62}$/i;
export const ATTRIBUTES = 'LTSIKNDO';

// A quote after an attribute letter that stands alone, before a name, a variable symbol, * or a
// literal, is an attribute reference (L'FIELD), not the start of a string. The card reader
// (lib/bms.mjs) folds continuations by the same rule.
export const isAttributeQuote = (text, i) => i > 0 && ATTRIBUTES.includes(text[i - 1].toUpperCase())
  && !/[A-Z0-9$#@_&]/i.test(text[i - 2] || '') && /[A-Z$#@_&*=]/i.test(text[i + 1] || '');

export function splitOperands(field) {
  const out = [];
  let depth = 0, quoted = false, start = 0;
  for (let i = 0; i < field.length; i++) {
    const c = field[i];
    if (quoted) {
      if (c === "'") { if (field[i + 1] === "'") i++; else quoted = false; }
      continue;
    }
    if (c === "'") { if (!isAttributeQuote(field, i)) quoted = true; }
    else if (c === '(') depth++;
    else if (c === ')') { if (--depth < 0) throw new HlasmSyntax(`a closing parenthesis has no opening one at column ${i + 1} of the operands`); }
    else if (c === ',' && depth === 0) { out.push(field.slice(start, i)); start = i + 1; }
  }
  if (quoted) throw new HlasmSyntax('a quoted string in the operands is not closed');
  if (depth) throw new HlasmSyntax('a parenthesis in the operands is not closed');
  out.push(field.slice(start));
  return field === '' ? [] : out;
}

// Positional operands until the first KEY=VALUE, as a macro call is written. A literal (=F'1') is a
// positional operand, not a keyword with an empty name.
export function macroOperands(field) {
  const positional = [];
  const keywords = new Map();
  for (const part of splitOperands(field)) {
    const m = /^([A-Z$#@_][A-Z0-9$#@_]*)=([\s\S]*)$/i.exec(part);
    if (m) keywords.set(m[1].toUpperCase(), m[2]);
    else positional.push(part);
  }
  return { positional, keywords };
}
