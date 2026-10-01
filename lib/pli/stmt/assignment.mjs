// SPDX-License-Identifier: AGPL-3.0-or-later
// PL/I assignment statements.

import { parseExpression, parseReference } from '../expr.mjs';

const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '|=', '&=', '||=', '**=']);

function parseAssignment(c, stmt, ctx) {
  const targets = [];
  for (;;) {
    const ref = parseReference(c);
    targets.push(ref);
    if (!c.isOp(',')) break;
    c.next();
  }

  const opTok = c.peek();
  if (!opTok || opTok.t !== 'op' || !ASSIGN_OPS.has(opTok.v)) {
    c.fail('an assignment operator');
  }
  const op = c.next().v;

  const value = parseExpression(c);

  let byName = false;
  if (c.isOp(',')) {
    c.next();
    if (c.isWord('BY')) {
      c.next();
      if (c.isWord('NAME')) {
        c.next();
        byName = true;
      } else {
        c.fail("'NAME'");
      }
    } else {
      c.fail("'BY'");
    }
  }

  if (!c.done()) {
    c.fail('the end of the statement');
  }

  return {
    kind: 'ASSIGNMENT',
    targets,
    op,
    value,
    byName,
  };
}

export const parsers = {
  ASSIGNMENT: parseAssignment,
};
