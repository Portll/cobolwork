// SPDX-License-Identifier: AGPL-3.0-or-later
// Parser for PL/I preprocessor statements (kind PREPROCESSOR), which begin with the op '%'.
import { cursor } from '../cursor.mjs';
import { parseExpression, parseReference } from '../expr.mjs';

export const parsers = {
  PREPROCESSOR: (c, stmt, ctx) => {
    const node = { kind: 'PREPROCESSOR', units: [] };
    if (!c.isOp('%')) c.fail("'%'");
    c.next();

    const labelTok = c.peek();
    if (labelTok && labelTok.t === 'word' && c.isOp(':', 1)) {
      c.next();
      c.next();
      node.label = labelTok.u;
    }

    if (c.done()) { node.directive = 'NULL'; return node; }
    const dirTok = c.peek();
    if (!dirTok || dirTok.t !== 'word') c.fail('a directive word');
    // %X = expression assigns a preprocessor variable.
    if (c.isOp('=', 1)) {
      c.next();
      c.next();
      return { ...node, directive: 'ASSIGN', names: [dirTok.u], value: parseExpression(c) };
    }
    c.next();
    node.directive = dirTok.u;

    switch (node.directive) {
      case 'INCLUDE':
      case 'XINCLUDE': {
        // A member is a name, a quoted name, or ddname(member) naming the library it is read from.
        node.members = [];
        for (;;) {
          const t = c.next();
          if (t && t.t === 'lit') node.members.push({ name: t.v, library: null });
          else if (t && t.t === 'word' && c.isOp('(')) {
            const s2 = cursor(c.group());
            const m = s2.next();
            if (!m || (m.t !== 'word' && m.t !== 'lit') || !s2.done()) c.fail('a member name in the library reference');
            node.members.push({ name: m.u ?? m.v, library: t.u });
          } else if (t && t.t === 'word') node.members.push({ name: t.u, library: null });
          else c.fail('a member name');
          if (!c.op(',')) break;
        }
        break;
      }
      case 'DCL':
      case 'DECLARE': {
        node.names = [];
        while (!c.done()) {
          if (c.isOp(',')) c.next();
          const nameTok = c.expectWord(undefined);
          node.names.push(nameTok.u);
          while (!c.done()) {
            const t = c.peek();
            if (t.t === 'word') {
              c.next();
            } else if (t.t === 'op' && t.v === '(') {
              c.group();
            } else if (t.t === 'op' && t.v === ',') {
              break;
            } else {
              break;
            }
          }
        }
        break;
      }
      case 'IF': {
        const expr = parseExpression(c, { stopOps: ['%'] });
        node.value = expr;
        if (c.isOp('%') && c.isWord('THEN', 1)) {
          c.next();
          c.next();
          const unitToks = c.drain();
          if (unitToks.length) {
            const sub = ctx.subStatement(stmt, unitToks);
            const res = ctx.parseStatement(sub);
            node.units.push(res);
          }
        } else {
          c.fail('%THEN');
        }
        break;
      }
      case 'ELSE': {
        const unitToks = c.drain();
        if (unitToks.length) {
          const sub = ctx.subStatement(stmt, unitToks);
          const res = ctx.parseStatement(sub);
          node.units.push(res);
        }
        break;
      }
      case 'DO':
      case 'END':
      case 'PAGE':
      case 'NOPRINT':
      case 'PUSH':
      case 'POP':
      case 'PRINT':
      case 'ITERATE':
      case 'LEAVE':
      case 'INSCAN':
      case 'XINSCAN':
      case 'PROCESS': {
        if (node.directive === 'PROCESS') {
          while (!c.done()) c.next();
        }
        break;
      }
      case 'SKIP': {
        if (c.isOp('(')) {
          c.group();
        }
        break;
      }
      case 'NOTE': {
        if (c.isOp('(')) {
          c.group();
        }
        break;
      }
      case 'ACTIVATE':
      case 'ACT':
      case 'DEACTIVATE':
      case 'DEACT': {
        node.names = [];
        while (!c.done()) {
          if (c.isWord()) {
            const t = c.next();
            if (t.u === 'RESCAN' || t.u === 'NORESCAN') {
              node.rescan = t.u === 'RESCAN';
            } else {
              node.names.push(t.u);
            }
          } else if (c.isOp(',')) {
            c.next();
          } else {
            c.fail('a name or RESCAN/NORESCAN');
          }
        }
        break;
      }
      case 'GO':
      case 'GOTO': {
        if (c.isWord('TO')) c.next();
        const label = c.expectWord(undefined);
        node.label = label.u;
        break;
      }
      case 'RETURN': {
        if (c.isOp('(')) {
          const inner = c.group();
          const s = cursor(inner);
          node.value = parseExpression(s);
          if (!s.done()) s.fail('the end of the argument');
        }
        break;
      }
      case 'REPLACE': {
        const name = c.expectWord(undefined);
        node.names = [name.u];
        if (!c.isWord('BY')) c.fail('BY');
        c.next();
        node.value = parseExpression(c);
        break;
      }
      case 'PROCEDURE':
      case 'PROC': {
        if (c.isOp('(')) {
          const params = c.items();
          node.params = params.map(p => {
            const s = cursor(p);
            const ref = parseReference(s);
            if (!s.done()) s.fail('the end of the parameter');
            return ref;
          });
        }
        while (!c.done()) {
          const t = c.peek();
          if (t.t === 'word') {
            if (t.u === 'STATEMENT') {
              c.next();
              node.statement = true;
            } else if (t.u === 'RETURNS') {
              c.next();
              c.expectOp('(');
              const retTok = c.expectWord(undefined);
              c.expectOp(')');
              node.returns = retTok.u;
            } else {
              c.next();
            }
          } else if (t.t === 'op' && t.v === '(') {
            c.group();
          } else {
            c.fail('STATEMENT or RETURNS');
          }
        }
        break;
      }
      case 'SELECT':
      case 'WHEN':
      case 'OTHERWISE': {
        if (node.directive === 'WHEN') {
          if (c.isOp('(')) {
            const inner = c.group();
            const s = cursor(inner);
            node.value = parseExpression(s);
            if (!s.done()) s.fail('the end of the condition');
          }
          const unitToks = c.drain();
          if (unitToks.length) {
            const sub = ctx.subStatement(stmt, unitToks);
            const res = ctx.parseStatement(sub);
            node.units.push(res);
          }
        } else if (node.directive === 'OTHERWISE') {
          const unitToks = c.drain();
          if (unitToks.length) {
            const sub = ctx.subStatement(stmt, unitToks);
            const res = ctx.parseStatement(sub);
            node.units.push(res);
          }
        }
        break;
      }
      default: {
        const rest = c.drain();
        node.toks = rest;
        break;
      }
    }

    if (!c.done()) c.fail('the end of the statement');
    return node;
  }
};
