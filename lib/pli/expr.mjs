// SPDX-License-Identifier: AGPL-3.0-or-later
// PL/I expressions and references, as the statement parsers consume them: an operator tree by
// PL/I precedence, every token consumed, and the references the expression reads.
import { cursor } from './cursor.mjs';

// Higher binds tighter. Infix ¬ is exclusive-or, at the level of |.
const PREC = {
  '**': 7, '*': 6, '/': 6, '+': 5, '-': 5, '||': 4,
  '=': 3, '¬=': 3, '<': 3, '>': 3, '<=': 3, '>=': 3, '¬<': 3, '¬>': 3, '<>': 3,
  '&': 2, '|': 1, '¬': 1,
};
const PREFIX = new Set(['+', '-', '¬']);

// A reference: a name, then any mix of (arguments), '.' name, and '->' or '=>' locator
// qualification. args holds one list per parenthesised group, each argument an expression or
// { t: 'star' } for '*'.
export function parseReference(c) {
  const start = c.pos;
  const first = c.word();
  if (!first) c.fail('a reference');
  const path = [first.u];
  const locators = [];
  const args = [];
  for (;;) {
    if (c.isOp('(')) { args.push(c.items().map(argument)); continue; }
    if (c.isOp('.') && c.isWord(undefined, 1)) { c.next(); path.push(c.next().u); continue; }
    if (c.isOp(['->', '=>']) && c.isWord(undefined, 1)) { c.next(); locators.push(path.length); path.push(c.next().u); continue; }
    break;
  }
  return { t: 'ref', name: path[path.length - 1], path, locators, args, toks: c.slice(start) };
}

function argument(toks) {
  if (toks.length === 1 && toks[0].t === 'op' && toks[0].v === '*') return { t: 'star', toks };
  const s = cursor(toks);
  const e = parseExpression(s);
  if (!s.done()) s.fail('the end of the argument');
  return e;
}

function primary(c) {
  const t = c.peek();
  if (!t) c.fail('an operand');
  if (t.t === 'num') return { t: 'num', tok: c.next() };
  if (t.t === 'lit') return { t: 'lit', tok: c.next() };
  if (t.t === 'word') return parseReference(c);
  if (t.t === 'op' && t.v === '(') {
    c.next();
    const inner = parseExpression(c);
    c.expectOp(')');
    // (3)'AB' and (N)'0'B repeat the literal: a parenthesis is never otherwise followed by one.
    if (c.peek() && c.peek().t === 'lit') return { t: 'lit', tok: c.next(), factor: inner };
    return { t: 'paren', expr: inner };
  }
  return c.fail('an operand');
}

// A prefix operator applies to its operand's ** chain: -A**2 is -(A**2).
function unary(c) {
  const t = c.peek();
  if (t && t.t === 'op' && PREFIX.has(t.v)) {
    c.next();
    return { op: `prefix${t.v}`, args: [binary(c, 7)] };
  }
  return primary(c);
}

function binary(c, min, stopOps = []) {
  let left = unary(c);
  for (;;) {
    const t = c.peek();
    if (!t || t.t !== 'op' || !(t.v in PREC) || stopOps.includes(t.v)) return left;
    const p = PREC[t.v];
    if (p < min) return left;
    c.next();
    const right = binary(c, t.v === '**' ? p : p + 1, stopOps);
    left = { op: t.v, args: [left, right] };
  }
}

function collect(node, out) {
  if (!node) return;
  if (node.t === 'ref') {
    for (const at of node.locators) out.push(node.path.slice(0, at).join('.'));
    out.push(node.path.join('.'));
    for (const list of node.args) for (const a of list) collect(a.tree ?? a, out);
  } else if (node.t === 'paren') collect(node.expr.tree, out);
  else if (node.t === 'lit' && node.factor) collect(node.factor.tree, out);
  else if (node.args) for (const a of node.args) collect(a, out);
}

// An expression, stopping before the first token that cannot continue it: ',' or ')', a word after a
// complete operand (so a caller's stopWords need no test), an assignment operator, or an op in
// stopOps. { t: 'expr', tree, toks, refs }.
export function parseExpression(c, { stopOps = [] } = {}) {
  const start = c.pos;
  const tree = binary(c, 1, stopOps);
  const refs = [];
  collect(tree, refs);
  return { t: 'expr', tree, toks: c.slice(start), refs: [...new Set(refs)] };
}
