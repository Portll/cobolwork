// SPDX-License-Identifier: AGPL-3.0-or-later
// PL/I CALL, FETCH and RELEASE statements.

import { cursor } from '../cursor.mjs';
import { parseExpression, parseReference } from '../expr.mjs';

function parseCall(c, stmt, ctx) {
  c.expectWord('CALL');
  const callee = parseReference(c);
  const args = callee.args.length ? callee.args[callee.args.length - 1] : [];
  const options = [];

  while (!c.done()) {
    if (c.isWord('TASK')) {
      c.next();
      const inner = c.group();
      const s = cursor(inner);
      const e = parseExpression(s);
      if (!s.done()) s.fail('the end of the argument');
      options.push({ name: 'TASK', args: [e] });
    } else if (c.isWord('EVENT')) {
      c.next();
      const inner = c.group();
      const s = cursor(inner);
      const e = parseExpression(s);
      if (!s.done()) s.fail('the end of the argument');
      options.push({ name: 'EVENT', args: [e] });
    } else if (c.isWord('PRIORITY')) {
      c.next();
      const inner = c.group();
      const s = cursor(inner);
      const e = parseExpression(s);
      if (!s.done()) s.fail('the end of the argument');
      options.push({ name: 'PRIORITY', args: [e] });
    } else {
      c.fail('end of statement or TASK, EVENT, or PRIORITY');
    }
  }

  return { kind: 'CALL', callee, name: callee.path.join('.'), args, options };
}

function parseFetch(c, stmt, ctx) {
  c.expectWord('FETCH');
  const entries = [];

  while (true) {
    const name = c.expectWord(undefined).u;
    let set = null;
    let title = null;

    // SET and TITLE may both appear, in either order.
    while (c.isWord(['SET', 'TITLE']) && c.isOp('(', 1)) {
      const option = c.next().u;
      const s = cursor(c.group());
      if (option === 'SET') set = parseReference(s);
      else title = parseExpression(s);
      if (!s.done()) s.fail('the end of the argument');
    }

    entries.push({ name, set, title });

    if (c.isOp(',')) {
      c.next();
    } else {
      break;
    }
  }

  if (!c.done()) c.fail('end of statement');

  return { kind: 'FETCH', entries };
}

function parseRelease(c, stmt, ctx) {
  c.expectWord('RELEASE');
  const entries = [];

  if (c.isOp('*')) {
    c.next();
    entries.push('*');
  } else {
    while (true) {
      const name = c.expectWord(undefined).u;
      entries.push(name);

      if (c.isOp(',')) {
        c.next();
      } else {
        break;
      }
    }
  }

  if (!c.done()) c.fail('end of statement');

  return { kind: 'RELEASE', entries };
}

export const parsers = {
  CALL: parseCall,
  FETCH: parseFetch,
  RELEASE: parseRelease,
};
