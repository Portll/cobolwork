// SPDX-License-Identifier: AGPL-3.0-or-later
// A cursor over one statement's tokens, shared by every PL/I statement parser so they read tokens
// the same way and report a failure the same way.

export class PliSyntax extends Error {
  constructor(message, tok) {
    super(message);
    this.name = 'PliSyntax';
    this.line = tok ? tok.line : null;
    this.col = tok ? tok.col : null;
  }
}

const isOpen = (t) => t && t.t === 'op' && t.v === '(';
const isClose = (t) => t && t.t === 'op' && t.v === ')';

export function cursor(toks) {
  let i = 0;
  const c = {
    get pos() { return i; },
    set pos(v) { i = v; },
    peek: (k = 0) => toks[i + k] || null,
    next: () => toks[i++] || null,
    done: () => i >= toks.length,
    rest: () => toks.slice(i),
    isWord: (u, k = 0) => { const t = toks[i + k]; return !!t && t.t === 'word' && (u === undefined || (Array.isArray(u) ? u.includes(t.u) : t.u === u)); },
    isOp: (v, k = 0) => { const t = toks[i + k]; return !!t && t.t === 'op' && (Array.isArray(v) ? v.includes(t.v) : t.v === v); },
    word(u) { return c.isWord(u) ? toks[i++] : null; },
    op(v) { return c.isOp(v) ? toks[i++] : null; },
    expectWord(u) { const t = c.word(u); if (!t) c.fail(u === undefined ? 'a name' : Array.isArray(u) ? u.join(' or ') : u); return t; },
    expectOp(v) { const t = c.op(v); if (!t) c.fail(`'${v}'`); return t; },
    fail(what) { const t = toks[i]; throw new PliSyntax(`expected ${what}${t ? ` at '${t.v ?? t.t}'` : ' at end of statement'}`, t || toks[toks.length - 1]); },
    // The tokens between a '(' at the cursor and its closing ')', the cursor left after the ')'.
    group() {
      if (!isOpen(toks[i])) c.fail("'('");
      const start = i;
      let depth = 0;
      for (; i < toks.length; i++) {
        if (isOpen(toks[i])) depth++;
        else if (isClose(toks[i]) && --depth === 0) { i++; return toks.slice(start + 1, i - 1); }
      }
      i = start;
      c.fail("')'");
    },
    // A parenthesised list as its comma-separated members, each a token array.
    items() { return split(c.group(), ','); },
    // Tokens up to, not including, the first at depth 0 that `stop` accepts.
    until(stop) {
      const start = i;
      let depth = 0;
      for (; i < toks.length; i++) {
        const t = toks[i];
        if (depth === 0 && stop(t)) break;
        if (isOpen(t)) depth++;
        else if (isClose(t)) depth--;
      }
      return toks.slice(start, i);
    },
  };
  return c;
}

// Token arrays split at depth-0 tokens of op `sep`.
export function split(toks, sep) {
  const parts = [[]];
  let depth = 0;
  for (const t of toks) {
    if (isOpen(t)) depth++;
    else if (isClose(t)) depth--;
    if (depth === 0 && t.t === 'op' && t.v === sep) { parts.push([]); continue; }
    parts[parts.length - 1].push(t);
  }
  return parts.length === 1 && !parts[0].length ? [] : parts;
}
