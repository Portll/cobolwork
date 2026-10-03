// SPDX-License-Identifier: AGPL-3.0-or-later
// HLASM expressions, read and not evaluated: terms (symbols, *, self-defining terms, literals,
// attribute references, variable symbols) joined by + - * / with the usual precedence. An address
// operand is an expression with an optional parenthesised index or length and base after it.
// https://www.ibm.com/docs/en/hla-and-tf/1.6.0?topic=structure-terms-literals-expressions
import { HlasmSyntax, ATTRIBUTES } from './operands.mjs';
import { readDataOperand } from './asm/data.mjs';

const NAME_START = /[A-Z$#@_]/i;
const NAME_CHAR = /[A-Z0-9$#@_]/i;
const SELF_DEFINING = new Set(['X', 'B', 'C', 'CA', 'CE', 'CU', 'G']);

class Cursor {
  constructor(text, pos = 0) { this.text = text; this.pos = pos; }
  peek(n = 0) { return this.text[this.pos + n]; }
  fail(what) { throw new HlasmSyntax(`${what} at column ${this.pos + 1} of '${this.text}'`); }
  name() {
    const start = this.pos;
    if (!NAME_START.test(this.peek() || '')) return null;
    while (NAME_CHAR.test(this.peek() || '')) this.pos++;
    if (this.pos - start > 63) this.fail('a name longer than 63 characters');
    return this.text.slice(start, this.pos).toUpperCase();
  }
  quoted() {
    if (this.peek() !== "'") this.fail('expected a quote');
    let out = '';
    for (this.pos++; this.pos < this.text.length; this.pos++) {
      const c = this.text[this.pos];
      if (c === "'") {
        if (this.peek(1) === "'") { out += "'"; this.pos++; continue; }
        this.pos++;
        return out;
      }
      if (c === '&' && this.peek(1) === '&') this.pos++;
      out += c;
    }
    return this.fail('a quoted string is not closed');
  }
}

function variable(c) {
  const start = c.pos;
  c.pos++;
  if (!c.name()) c.fail('expected a variable symbol name after &');
  if (c.peek() === '(') {
    c.pos++;
    expression(c);
    while (c.peek() === ',') { c.pos++; expression(c); }
    if (c.peek() !== ')') c.fail('expected ) after a variable symbol subscript');
    c.pos++;
  }
  return { t: 'var', text: c.text.slice(start, c.pos).toUpperCase() };
}

function term(c) {
  const ch = c.peek();
  if (ch === undefined) c.fail('expected a term');
  if (ch === '(') {
    c.pos++;
    const inner = expression(c);
    if (c.peek() !== ')') c.fail('expected )');
    c.pos++;
    return { t: 'paren', e: inner };
  }
  if (ch === '*') { c.pos++; return { t: 'loc' }; }
  if (ch === '=') {
    const { operand, end } = readDataOperand(c.text, c.pos + 1, { literal: true });
    c.pos = end;
    return { t: 'lit', dc: operand };
  }
  if (ch === '&') return variable(c);
  if (/[0-9]/.test(ch)) {
    const start = c.pos;
    while (/[0-9]/.test(c.peek() || '')) c.pos++;
    return { t: 'num', v: Number(c.text.slice(start, c.pos)) };
  }
  const start = c.pos;
  const name = c.name();
  if (!name) c.fail(`unexpected '${ch}'`);
  if (c.peek() === "'") {
    if (name.length === 1 && ATTRIBUTES.includes(name) && /[A-Z$#@_&*=]/i.test(c.peek(1) || '')) {
      c.pos++;
      const of = c.peek() === '*' ? (c.pos++, { t: 'loc' }) : c.peek() === '&' ? variable(c) : c.peek() === '=' ? term(c) : { t: 'sym', name: c.name() };
      return { t: 'attr', attr: name, of };
    }
    if (SELF_DEFINING.has(name)) return { t: 'sdt', type: name, text: c.quoted() };
    c.pos = start;
    c.fail(`'${name}' followed by a quote is neither a self-defining term nor an attribute reference`);
  }
  if (c.peek() === '.' && NAME_START.test(c.peek(1) || '')) {
    c.pos++;
    return { t: 'sym', qualifier: name, name: c.name() };
  }
  return { t: 'sym', name };
}

function unary(c) {
  if (c.peek() === '+' || c.peek() === '-') {
    const op = c.text[c.pos++];
    return { t: 'unary', op, e: unary(c) };
  }
  return term(c);
}

function product(c) {
  let left = unary(c);
  while (c.peek() === '*' || c.peek() === '/') {
    const op = c.text[c.pos++];
    left = { t: 'bin', op, l: left, r: unary(c) };
  }
  return left;
}

function expression(c) {
  let left = product(c);
  while (c.peek() === '+' || c.peek() === '-') {
    const op = c.text[c.pos++];
    left = { t: 'bin', op, l: left, r: product(c) };
  }
  return left;
}

// An expression starting at pos: the tree, and where it ended.
export function readExpression(text, pos = 0) {
  const c = new Cursor(text, pos);
  const e = expression(c);
  return { e, end: c.pos };
}

export function parseExpression(text) {
  const { e, end } = readExpression(text);
  if (end !== text.length) throw new HlasmSyntax(`unexpected '${text.slice(end)}' after an expression in '${text}'`);
  return e;
}

// D(X,B), D(,B), D(X), D(L,B) or an implicit address: the displacement or address expression, and
// the parenthesised parts written after it, an omitted one as null.
export function parseAddress(text) {
  const { e, end } = readExpression(text);
  if (end === text.length) return { disp: e, parts: null };
  if (text[end] !== '(' || !text.endsWith(')')) throw new HlasmSyntax(`unexpected '${text.slice(end)}' in the address '${text}'`);
  const inner = text.slice(end + 1, -1);
  const parts = [];
  let at = 0;
  for (;;) {
    if (inner[at] === ',' || at === inner.length) parts.push(null);
    else {
      const r = readExpression(inner, at);
      parts.push(r.e);
      at = r.end;
    }
    if (at === inner.length) break;
    if (inner[at] !== ',') throw new HlasmSyntax(`unexpected '${inner.slice(at)}' in the address '${text}'`);
    at++;
  }
  return { disp: e, parts };
}

// The symbols an expression names, unqualified, for the locator and the rules.
export function symbolsOf(e, out = []) {
  if (!e) return out;
  if (e.t === 'sym') out.push(e.name);
  else if (e.t === 'attr') symbolsOf(e.of, out);
  else if (e.t === 'paren' || e.t === 'unary') symbolsOf(e.e, out);
  else if (e.t === 'bin') { symbolsOf(e.l, out); symbolsOf(e.r, out); }
  return out;
}
