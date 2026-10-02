// SPDX-License-Identifier: AGPL-3.0-or-later
// PL/I ALLOCATE and FREE: each names one or more controlled or based variables, an ALLOCATE with
// the area it takes storage IN, the locator it SETs and any attributes it gives a controlled one.

import { parseReference } from '../expr.mjs';

const ALLOCATE_ATTRIBUTES = new Set(['CHARACTER', 'CHAR', 'BIT', 'GRAPHIC', 'WIDECHAR', 'AREA', 'INITIAL', 'INIT', 'DIMENSION', 'DIM']);

function readParenthesised(c, read) {
  c.expectOp('(');
  const value = read(c);
  c.expectOp(')');
  return value;
}

function readAllocateItem(c) {
  const level = c.peek() && c.peek().t === 'num' ? Number(c.next().v) : null;
  const item = { level, variable: parseReference(c), in: null, set: null, attributes: [] };
  while (!c.done() && !c.isOp(',')) {
    if (c.isWord('IN')) { c.next(); item.in = readParenthesised(c, parseReference); }
    else if (c.isWord('SET')) { c.next(); item.set = readParenthesised(c, parseReference); }
    else if (c.isWord([...ALLOCATE_ATTRIBUTES])) {
      const name = c.next().u;
      item.attributes.push({ name, args: c.isOp('(') ? c.group() : null });
    } else c.fail('IN, SET, an attribute or a comma');
  }
  return item;
}

function readFreeItem(c) {
  const item = { variable: parseReference(c), in: null };
  if (c.isWord('IN')) { c.next(); item.in = readParenthesised(c, parseReference); }
  return item;
}

function readList(c, read) {
  const items = [read(c)];
  while (c.isOp(',')) { c.next(); items.push(read(c)); }
  return items;
}

export const parsers = {
  ALLOCATE: (c) => { c.expectWord(['ALLOCATE', 'ALLOC']); return { kind: 'ALLOCATE', items: readList(c, readAllocateItem) }; },
  FREE: (c) => { c.expectWord('FREE'); return { kind: 'FREE', items: readList(c, readFreeItem) }; },
};
