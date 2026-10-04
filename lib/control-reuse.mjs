// SPDX-License-Identifier: AGPL-3.0-or-later
// A program's control analysis, kept so that a byte-identical copy of it elsewhere in the repository
// is not analysed again.
//
// The analysis refers to objects of the program's parse: statements, items, tokens. Kept, each such
// reference is the object's position in a walk of the parse that visits it in one fixed order, so the
// copy's parse, walked the same way, supplies the copy's own objects. A string equal to one of the
// program's file paths is kept as that file's place in the program's list of files, and becomes the
// copy's path. Anything else the analysis holds is copied as it is. A path inside a longer string, or
// a value that is not plain data, makes the analysis not kept at all: the copy is analysed afresh.

const FAIL = Symbol('not kept');

// The objects reachable from root, breadth first: array elements, Map keys and values, Set values and
// own enumerable properties, in their order. Typed arrays are not entered.
export function parseOrder(root) {
  const order = [root];
  const seen = new Set(order);
  for (let i = 0; i < order.length; i++) {
    const o = order[i];
    const visit = (v) => { if (v !== null && typeof v === 'object' && !seen.has(v)) { seen.add(v); order.push(v); } };
    if (ArrayBuffer.isView(o)) continue;
    if (Array.isArray(o)) for (const v of o) visit(v);
    else if (o instanceof Map) for (const [k, v] of o) { visit(k); visit(v); }
    else if (o instanceof Set) for (const v of o) visit(v);
    else for (const k of Object.keys(o)) visit(o[k]);
  }
  return order;
}

const plain = (o) => {
  const proto = Object.getPrototypeOf(o);
  return (proto === Object.prototype || proto === null)
    && Object.getOwnPropertySymbols(o).length === 0
    && Object.getOwnPropertyNames(o).length === Object.keys(o).length;
};

// `files` lists the program's file and its resolved copybooks, in the parse's order.
export function keep(value, order, files) {
  const at = new Map(order.map((o, i) => [o, i]));
  const fileAt = new Map(files.map((f, i) => [f, i]));
  const table = [];
  const index = new Map();
  const enc = (v) => {
    if (typeof v === 'string') {
      if (fileAt.has(v)) return { f: fileAt.get(v) };
      for (const f of files) if (f && v.includes(f)) throw FAIL;
      return v;
    }
    if (v === null || typeof v !== 'object') {
      if (typeof v === 'function' || typeof v === 'symbol') throw FAIL;
      return v;
    }
    if (at.has(v)) return { p: at.get(v) };
    if (index.has(v)) return { r: index.get(v) };
    const i = table.length;
    index.set(v, i);
    const entry = {};
    table.push(entry);
    if (ArrayBuffer.isView(v)) { entry.t = v; return { r: i }; }
    if (Array.isArray(v)) {
      if (Object.keys(v).length !== v.length || !plainArray(v)) throw FAIL;
      entry.a = v.map(enc);
    } else if (v instanceof Map) entry.m = [...v].map(([k, x]) => [enc(k), enc(x)]);
    else if (v instanceof Set) entry.s = [...v].map(enc);
    else {
      if (!plain(v)) throw FAIL;
      entry.o = Object.keys(v).map((k) => [k, enc(v[k])]);
      if (Object.getPrototypeOf(v) === null) entry.n = true;
    }
    return { r: i };
  };
  try { return { root: enc(value), table }; } catch (e) { if (e === FAIL) return null; throw e; }
}

const plainArray = (a) => Object.getPrototypeOf(a) === Array.prototype && Object.getOwnPropertySymbols(a).length === 0;

export function restore(kept, order, files) {
  const made = kept.table.map((e) => (e.t ? e.t : e.a ? [] : e.m ? new Map() : e.s ? new Set() : e.n ? Object.create(null) : {}));
  const dec = (x) => {
    if (x === null || typeof x !== 'object') return x;
    if ('p' in x) return order[x.p];
    if ('f' in x) return files[x.f];
    return made[x.r];
  };
  kept.table.forEach((e, i) => {
    const o = made[i];
    if (e.a) for (const x of e.a) o.push(dec(x));
    else if (e.m) for (const [k, x] of e.m) o.set(dec(k), dec(x));
    else if (e.s) for (const x of e.s) o.add(dec(x));
    else if (e.o) for (const [k, x] of e.o) o[k] = dec(x);
  });
  return dec(kept.root);
}

// Whether two analyses are the same, objects of the parse compared as themselves.
export function sameAnalysis(a, b, parse) {
  const pairs = new Map();
  const eq = (x, y) => {
    if (x === y) return true;
    if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object') return Object.is(x, y);
    if (parse.has(x) || parse.has(y)) return false;
    if (pairs.has(x)) return pairs.get(x) === y;
    pairs.set(x, y);
    if (Object.getPrototypeOf(x) !== Object.getPrototypeOf(y)) return false;
    if (ArrayBuffer.isView(x)) return x.length === y.length && x.every((v, i) => v === y[i]);
    if (x instanceof Map) { if (x.size !== y.size) return false; const ys = [...y]; return [...x].every(([k, v], i) => eq(k, ys[i][0]) && eq(v, ys[i][1])); }
    if (x instanceof Set) { if (x.size !== y.size) return false; const ys = [...y]; return [...x].every((v, i) => eq(v, ys[i])); }
    const kx = Object.keys(x), ky = Object.keys(y);
    return kx.length === ky.length && kx.every((k, i) => k === ky[i] && eq(x[k], y[k]));
  };
  return eq(a, b);
}
