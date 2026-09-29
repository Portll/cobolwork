// SPDX-License-Identifier: AGPL-3.0-or-later
// Interval arithmetic for the check model: what an arithmetic statement can leave in an integer
// field, given what its operands can hold. Endpoints are exact rationals, so a quotient's lower end
// is not lost to rounding, and every interval is closed.
//
// An expression is parsed once into a tree whose leaves name fields; `candidates` then reads it
// against the facts the caller can offer for each field. Each candidate is an interval together with
// the facts it needs to hold, so the caller can tie the result to the same facts.

const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a; };
export const q = (n, d = 1n) => {
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d) || 1n;
  return { n: n / g, d: d / g };
};
const cmp = (a, b) => { const x = a.n * b.d - b.n * a.d; return x < 0n ? -1 : x > 0n ? 1 : 0; };
const qAdd = (a, b) => q(a.n * b.d + b.n * a.d, a.d * b.d);
const qSub = (a, b) => q(a.n * b.d - b.n * a.d, a.d * b.d);
const qMul = (a, b) => q(a.n * b.n, a.d * b.d);
const qDiv = (a, b) => q(a.n * b.d, a.d * b.n);
const qMin = (list) => list.reduce((m, x) => (cmp(x, m) < 0 ? x : m));
const qMax = (list) => list.reduce((m, x) => (cmp(x, m) > 0 ? x : m));
export const floorQ = (a) => { const t = a.n / a.d; return a.n % a.d !== 0n && a.n < 0n ? t - 1n : t; };
export const ceilQ = (a) => { const t = a.n / a.d; return a.n % a.d !== 0n && a.n > 0n ? t + 1n : t; };
const truncQ = (a) => a.n / a.d;

// A division is exact when its divisor is a whole number with no prime factor but 2 and 5, which the
// decimal arithmetic of every compiler carries to the end; any other quotient is cut short of its
// last digit, in either direction, and the interval says so.
const terminating = (b) => {
  if (b.d !== 1n) return false;
  let n = b.n < 0n ? -b.n : b.n;
  for (const p of [2n, 5n]) while (n % p === 0n) n /= p;
  return n === 1n;
};
const EPSILON = q(1n, 10n ** 30n);

const iv = (lo, hi, inexact = false) => ({ lo, hi, inexact });
const ivAdd = (a, b) => iv(qAdd(a.lo, b.lo), qAdd(a.hi, b.hi), a.inexact || b.inexact);
const ivSub = (a, b) => iv(qSub(a.lo, b.hi), qSub(a.hi, b.lo), a.inexact || b.inexact);
function ivMul(a, b) {
  if (a.inexact || b.inexact) return null;
  const p = [qMul(a.lo, b.lo), qMul(a.lo, b.hi), qMul(a.hi, b.lo), qMul(a.hi, b.hi)];
  return iv(qMin(p), qMax(p));
}
function ivDiv(a, b) {
  if (a.inexact || b.inexact) return null;
  if (!(cmp(b.lo, q(0n)) > 0 || cmp(b.hi, q(0n)) < 0)) return null;
  const p = [qDiv(a.lo, b.lo), qDiv(a.lo, b.hi), qDiv(a.hi, b.lo), qDiv(a.hi, b.hi)];
  const point = cmp(b.lo, b.hi) === 0;
  return iv(qMin(p), qMax(p), !(point && terminating(b.lo)));
}
const ivNeg = (a) => iv(qSub(q(0n), a.hi), qSub(q(0n), a.lo), a.inexact);
// FUNCTION MOD takes the sign of its divisor, so a positive divisor leaves 0 up to one below it.
function ivMod(a, b) {
  if (a.inexact || b.inexact || b.lo.d !== 1n || b.hi.d !== 1n || cmp(b.lo, q(1n)) < 0) return null;
  return iv(q(0n), qSub(b.hi, q(1n)));
}

// What lands in an integer field: a truncated value moves toward zero, a rounded one to either
// neighbour, whatever the rounding mode.
export function storedRange(r, rounded) {
  let { lo, hi } = r;
  if (r.inexact) { lo = qSub(lo, EPSILON); hi = qAdd(hi, EPSILON); }
  return rounded ? { lo: floorQ(lo), hi: ceilQ(hi) } : { lo: truncQ(lo), hi: truncQ(hi) };
}

// ---- parsing ----------------------------------------------------------------------------------

const isWord = (t, u) => t && t.t === 'word' && t.u === u;
const isSep = (t, v) => t && t.t === 'sep' && t.v === v;
const isOp = (t, v) => t && t.t === 'op' && t.v === v;
const decimal = (s) => {
  const m = /^(\d*)(?:\.(\d+))?$/.exec(s);
  if (!m || (!m[1] && !m[2])) return null;
  const frac = m[2] || '';
  return q(BigInt((m[1] || '0') + frac), 10n ** BigInt(frac.length));
};
const TRIMS = new Set(['TRIM', 'UPPER-CASE', 'LOWER-CASE', 'REVERSE']);

// The token after a balanced pair of parentheses that opens at `i`, or -1.
function closeOf(toks, i) {
  let depth = 0;
  for (let j = i; j < toks.length; j++) {
    if (isSep(toks[j], '(')) depth++;
    else if (isSep(toks[j], ')') && --depth === 0) return j;
  }
  return -1;
}

// `env.field(tok, subscripted)` gives a leaf for an integer field or null; `env.sizeOf(tokens)` the
// most bytes an item, subscripted or not, can be, or null.
export function parser(toks, env) {
  let i = 0;
  const fail = () => { throw parser; };
  function lengthArg(inner) {
    if (inner.length === 1 && inner[0].t === 'lit') return { k: 'range', lo: q(BigInt(String(inner[0].v).length)), hi: q(BigInt(String(inner[0].v).length)) };
    let span = inner;
    if (isWord(span[0], 'FUNCTION') && span[1] && TRIMS.has(span[1].u) && isSep(span[2], '(') && closeOf(span, 2) === span.length - 1) {
      span = span.slice(3, -1).filter((t) => !isWord(t, 'LEADING') && !isWord(t, 'TRAILING'));
    }
    const size = span.length && span[0].t === 'word' ? env.sizeOf(span) : null;
    return size == null ? fail() : { k: 'range', lo: q(0n), hi: q(BigInt(size)) };
  }
  function primary() {
    const t = toks[i];
    if (!t) fail();
    if (isOp(t, '-') || isOp(t, '+')) { i++; const a = primary(); return t.v === '-' ? { k: 'neg', a } : a; }
    if (isSep(t, '(')) {
      i++;
      const a = expr();
      if (!isSep(toks[i], ')')) fail();
      i++;
      return a;
    }
    if (t.t === 'num') { const v = decimal(t.v); if (!v) fail(); i++; return { k: 'const', v }; }
    if (t.t !== 'word') fail();
    if (/^\d+$/.test(t.v)) { i++; return { k: 'const', v: q(BigInt(t.v)) }; }
    if (t.u === 'LENGTH' && isWord(toks[i + 1], 'OF') && toks[i + 2] && toks[i + 2].t === 'word') {
      const size = env.sizeOf([toks[i + 2]]);
      if (size == null) fail();
      i += 3;
      return { k: 'range', lo: q(BigInt(size)), hi: q(BigInt(size)) };
    }
    if (t.u === 'FUNCTION') {
      const name = toks[i + 1] && toks[i + 1].u;
      if (!name || !isSep(toks[i + 2], '(')) fail();
      const close = closeOf(toks, i + 2);
      if (close < 0) fail();
      const inner = toks.slice(i + 3, close);
      let node;
      if (name === 'LENGTH') node = lengthArg(inner);
      else if (name === 'ORD') node = { k: 'range', lo: q(1n), hi: q(256n) };
      else if (name === 'MOD') {
        const sub = parser(inner, env);
        const a = sub.expr();
        const b = sub.expr();
        if (!sub.done()) fail();
        node = { k: 'mod', a, b };
      } else fail();
      i = close + 1;
      return node;
    }
    // An identifier, with the subscripts of a table element; a qualified name or a reference
    // modification is not read.
    if (isWord(toks[i + 1], 'OF') || isWord(toks[i + 1], 'IN')) fail();
    let subscripted = false;
    let end = i + 1;
    if (isSep(toks[end], '(')) {
      const close = closeOf(toks, end);
      if (close < 0 || toks.slice(end, close).some((x) => isOp(x, ':'))) fail();
      subscripted = true;
      end = close + 1;
    }
    const leaf = env.field(t, subscripted);
    if (!leaf) fail();
    i = end;
    return leaf;
  }
  function term() {
    let a = primary();
    while (isOp(toks[i], '*') || isOp(toks[i], '/')) { const op = toks[i++].v; a = { k: 'bin', op, a, b: primary() }; }
    return a;
  }
  function expr() {
    let a = term();
    while (isOp(toks[i], '+') || isOp(toks[i], '-')) { const op = toks[i++].v; a = { k: 'bin', op, a, b: term() }; }
    return a;
  }
  return { expr, primary, done: () => i >= toks.length, at: () => i };
}

// Runs a parse, giving null where the tokens are not something the model reads.
export function attempt(fn) {
  try { return fn(); } catch (e) { if (e === parser) return null; throw e; }
}

// ---- reading a tree against facts ---------------------------------------------------------------

const union = (a, b) => [...new Set([...a, ...b])].sort((x, y) => x - y);
const within = (a, b) => cmp(b.lo, a.lo) <= 0 && cmp(a.hi, b.hi) <= 0;

// Drops what another candidate does at least as well: fewer facts needed and an interval inside.
function prune(list, cap) {
  const kept = [];
  for (const c of list) {
    if (kept.some((k) => k.needs.every((x) => c.needs.includes(x)) && within(k.iv, c.iv) && (!k.iv.inexact || c.iv.inexact))) continue;
    for (let j = kept.length - 1; j >= 0; j--) {
      const k = kept[j];
      if (c.needs.every((x) => k.needs.includes(x)) && within(c.iv, k.iv) && (!c.iv.inexact || k.iv.inexact)) kept.splice(j, 1);
    }
    kept.push(c);
  }
  if (kept.length <= cap) return kept;
  const plain = kept.filter((c) => !c.needs.length);
  const rest = kept.filter((c) => c.needs.length).sort((a, b) => cmp(qSub(a.iv.hi, a.iv.lo), qSub(b.iv.hi, b.iv.lo)) || a.needs.length - b.needs.length);
  return [...plain, ...rest].slice(0, cap);
}

// Every interval the tree can take, with the facts each needs. `field(leaf)` gives a leaf's own
// candidates as { needs, lo, hi } with BigInt ends, the widest of them needing nothing.
export function candidates(tree, field, cap = 64) {
  const both = (a, b, fn) => {
    const out = [];
    for (const x of a) {
      for (const y of b) {
        const r = fn(x.iv, y.iv);
        if (r) out.push({ needs: union(x.needs, y.needs), iv: r });
      }
    }
    return prune(out, cap);
  };
  const walk = (t) => {
    switch (t.k) {
      case 'const': return [{ needs: [], iv: iv(t.v, t.v) }];
      case 'range': return [{ needs: [], iv: iv(t.lo, t.hi) }];
      case 'field': return prune((field(t) || []).map((c) => ({ needs: c.needs, iv: iv(q(c.lo), q(c.hi)) })), cap);
      case 'neg': return walk(t.a).map((c) => ({ needs: c.needs, iv: ivNeg(c.iv) }));
      case 'mod': return both(walk(t.a), walk(t.b), (a, b) => ivMod(a, b));
      case 'bin': {
        const fn = t.op === '+' ? ivAdd : t.op === '-' ? ivSub : t.op === '*' ? ivMul : ivDiv;
        return both(walk(t.a), walk(t.b), fn);
      }
      default: return [];
    }
  };
  return walk(tree);
}

// The fields a tree reads.
export function leaves(tree, out = []) {
  if (tree.k === 'field') out.push(tree);
  else if (tree.a) { leaves(tree.a, out); if (tree.b) leaves(tree.b, out); }
  return out;
}
