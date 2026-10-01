// SPDX-License-Identifier: AGPL-3.0-or-later
// PL/I expressions and references, as the statement parsers consume them. This reading keeps an
// expression's tokens and the references in it without building an operator tree.
import { PliSyntax } from './cursor.mjs';

// A reference: a name, then any mix of (subscripts or arguments), '.' name, and '->' or '=>'
// locator qualification. { t: 'ref', name, path: [names], args: [token arrays], toks }.
export function parseReference(c) {
  const start = c.pos;
  const first = c.word();
  if (!first) c.fail('a reference');
  const path = [first.u];
  const args = [];
  for (;;) {
    if (c.isOp('(')) { args.push(c.items()); continue; }
    if (c.isOp(['.', '->', '=>']) && c.isWord(undefined, 1)) { c.next(); path.push(c.next().u); continue; }
    break;
  }
  return { t: 'ref', name: path[path.length - 1], path, args, toks: c.slice(start) };
}

// An expression up to, not including, the first depth-0 ',' or unmatched ')', or a depth-0 word in
// stopWords or op in stopOps. { t: 'expr', toks, refs: [names read] }.
export function parseExpression(c, { stopWords = [], stopOps = [] } = {}) {
  const toks = [];
  let depth = 0;
  while (!c.done()) {
    const t = c.peek();
    if (t.t === 'op' && t.v === '(') depth++;
    else if (t.t === 'op' && t.v === ')') { if (depth === 0) break; depth--; }
    else if (depth === 0 && t.t === 'op' && (t.v === ',' || stopOps.includes(t.v))) break;
    else if (depth === 0 && t.t === 'word' && stopWords.includes(t.u) && toks.length) break;
    toks.push(c.next());
  }
  if (!toks.length) throw new PliSyntax('expected an expression', c.peek());
  const refs = [];
  toks.forEach((t, k) => { if (t.t === 'word' && !(toks[k - 1] && toks[k - 1].t === 'op' && (toks[k - 1].v === '.' || toks[k - 1].v === '->'))) refs.push(t.u); });
  return { t: 'expr', toks, refs };
}
