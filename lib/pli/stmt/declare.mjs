// SPDX-License-Identifier: AGPL-3.0-or-later
// PL/I DECLARE statements.
import { cursor, split, PliSyntax } from '../cursor.mjs';
import { parseExpression, parseReference } from '../expr.mjs';

const ABBREV = new Map([
  ['CHAR', 'CHARACTER'], ['BIN', 'BINARY'], ['DEC', 'DECIMAL'], ['PIC', 'PICTURE'],
  ['PTR', 'POINTER'], ['VAR', 'VARYING'], ['VARZ', 'VARYINGZ'], ['NONVAR', 'NONVARYING'],
  ['INIT', 'INITIAL'], ['EXT', 'EXTERNAL'], ['INT', 'INTERNAL'], ['AUTO', 'AUTOMATIC'],
  ['CTL', 'CONTROLLED'], ['DEF', 'DEFINED'], ['POS', 'POSITION'], ['ENV', 'ENVIRONMENT'],
  ['WCHAR', 'WIDECHAR'], ['COND', 'CONDITION'], ['PARM', 'PARAMETER'],
]);

const KNOWN = new Set([
  'CHARACTER', 'BIT', 'GRAPHIC', 'WIDECHAR', 'VARYING', 'VARYINGZ', 'NONVARYING',
  'FIXED', 'FLOAT', 'BINARY', 'DECIMAL', 'PRECISION', 'SIGNED', 'UNSIGNED', 'REAL',
  'COMPLEX', 'PICTURE', 'POINTER', 'OFFSET', 'HANDLE', 'AREA', 'ENTRY', 'RETURNS',
  'OPTIONS', 'FILE', 'STREAM', 'RECORD', 'INPUT', 'OUTPUT', 'UPDATE', 'SEQUENTIAL',
  'DIRECT', 'KEYED', 'ENVIRONMENT', 'PRINT', 'LABEL', 'FORMAT', 'CONDITION', 'BUILTIN',
  'GENERIC', 'EXTERNAL', 'INTERNAL', 'STATIC', 'AUTOMATIC', 'BASED', 'CONTROLLED',
  'DEFINED', 'POSITION', 'PARAMETER', 'ALIGNED', 'UNALIGNED', 'INITIAL', 'VALUE',
  'LIKE', 'UNION', 'CONNECTED', 'NONCONNECTED', 'ASSIGNABLE', 'NONASSIGNABLE',
  'NORMAL', 'ABNORMAL', 'BYADDR', 'BYVALUE', 'OPTIONAL', 'ORDINAL', 'TYPE', 'DIMACROSS',
  'BIGENDIAN', 'LITTLEENDIAN', 'HEXADEC', 'IEEE', 'NATIVE', 'NONNATIVE', 'LIMITED',
  'VARIABLE', 'IRREDUCIBLE', 'REDUCIBLE', 'RESERVED', 'INONLY', 'OUTONLY', 'INOUT',
  'TASK', 'EVENT', 'BACKWARDS', 'BUFFERED', 'UNBUFFERED', 'TRANSIENT', 'EXCLUSIVE',
]);

function expandAttr(u) {
  return ABBREV.get(u) || u;
}

function parseAttribute(c, unknown) {
  const w = c.peek();
  if (!w || w.t !== 'word') c.fail('an attribute');
  c.next();
  const name = expandAttr(w.u);
  let args = null;
  let picture;
  if (name === 'PICTURE' && c.peek() && c.peek().t === 'lit') return { name, args, picture: c.next().v };
  if (c.isOp('(')) {
    const inner = c.group();
    if (name === 'PICTURE' && inner.length === 1 && inner[0].t === 'lit') {
      picture = inner[0].v;
    } else {
      args = inner;
    }
  }
  if (!KNOWN.has(name)) unknown.push(name);
  return { name, args, picture };
}

function parseDims(c) {
  const dims = [];
  while (c.isOp('(')) {
    dims.push(...c.items());
  }
  return dims;
}

function parseItem(c, unknown, line) {
  let level = null;
  if (c.peek() && c.peek().t === 'num' && /^\d+$/.test(c.peek().v)) {
    level = parseInt(c.next().v, 10);
  }

  let name = null;
  let factored = null;
  let dims = [];

  if (c.isOp('(')) {
    const inner = c.group();
    const parts = split(inner, ',');
    factored = [];
    for (const p of parts) {
      const sc = cursor(p);
      const sub = parseItem(sc, unknown, line);
      if (!sc.done()) sc.fail('end of factored member');
      factored.push(sub);
    }
  } else if (c.isOp('*')) {
    c.next();
    name = '*';
  } else {
    const w = c.peek();
    if (!w || w.t !== 'word') c.fail('a name');
    c.next();
    name = w.u;
    dims = parseDims(c);
  }

  const attributes = [];
  while (!c.done()) {
    const t = c.peek();
    if (t.t === 'word') {
      attributes.push(parseAttribute(c, unknown));
    } else {
      break;
    }
  }

  return { level, name, factored, dims, attributes, line };
}

// A factored list gives one item per member, each with its own attributes and the shared ones.
function flatten(item, names) {
  if (!item.factored) return [{ ...item, factored: names }];
  const all = item.factored.flatMap((m) => (m.factored ? m.factored.map((x) => x.name) : [m.name]));
  return item.factored.flatMap((m) => flatten({ ...m, level: m.level ?? item.level, attributes: [...m.attributes, ...item.attributes] }, all));
}

function parseItems(c, unknown, line) {
  const items = [];
  for (const p of split(c.drain(), ',')) {
    const sc = cursor(p);
    const item = parseItem(sc, unknown, line);
    if (!sc.done()) sc.fail('end of item');
    items.push(...flatten(item, null));
  }
  return items;
}

function parseDeclare(c, stmt, ctx) {
  c.word(['DECLARE', 'DCL']);
  const unknown = [];
  const items = parseItems(c, unknown, stmt.line);
  return { kind: 'DECLARE', items, unknownAttributes: unknown };
}

function parseDeclareFragment(c, stmt, ctx) {
  const unknown = [];
  const items = parseItems(c, unknown, stmt.line);
  return { kind: 'DECLARE_FRAGMENT', items, unknownAttributes: unknown };
}

export const parsers = {
  DECLARE: parseDeclare,
  DECLARE_FRAGMENT: parseDeclareFragment,
};
