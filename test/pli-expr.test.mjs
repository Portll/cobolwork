import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize } from '../lib/pli/lex.mjs';
import { cursor, PliSyntax } from '../lib/pli/cursor.mjs';
import { parseExpression, parseReference } from '../lib/pli/expr.mjs';
import './pin-machine.mjs';

const cur = (s) => cursor(tokenize(s, { margins: { left: 1, right: Infinity } }).tokens);
const shape = (n) => {
  if (n.t === 'ref') return n.args.length ? `${n.path.join('.')}(${n.args.map((l) => l.map((a) => (a.t === 'star' ? '*' : shape(a.tree))).join(',')).join(')(')})` : n.path.join('.');
  if (n.t === 'num') return n.tok.v;
  if (n.t === 'lit') return `${n.factor ? `(${shape(n.factor.tree)})` : ''}'${n.tok.v}'${n.tok.suffix}`;
  if (n.t === 'paren') return shape(n.expr.tree);
  return n.args.length === 1 ? `(${n.op.replace('prefix', '')}${shape(n.args[0])})` : `(${shape(n.args[0])} ${n.op} ${shape(n.args[1])})`;
};
const tree = (s) => shape(parseExpression(cur(s)).tree);

test('operators group by PL/I precedence', () => {
  assert.equal(tree('A + B * C'), '(A + (B * C))');
  assert.equal(tree('A || B = C & D | E'), '((((A || B) = C) & D) | E)');
  assert.equal(tree('A - B - C'), '((A - B) - C)');
  assert.equal(tree('A < B & C ¬= D'), '((A < B) & (C ¬= D))');
});

test('** is right-associative and a prefix operator applies to the whole ** chain', () => {
  assert.equal(tree('A ** B ** C'), '(A ** (B ** C))');
  assert.equal(tree('-A ** 2'), '(-(A ** 2))');
  assert.equal(tree('A ** -B'), '(A ** (-B))');
  assert.equal(tree('¬EOF & X'), '((¬EOF) & X)');
});

test('references carry subscripts, qualification, locators and nested calls', () => {
  assert.equal(tree('P->X.Y(I + 1)'), 'P.X.Y((I + 1))');
  assert.equal(tree('SUBSTR(TRIM(S), 1, LENGTH(T))'), 'SUBSTR(TRIM(S),1,LENGTH(T))');
  assert.equal(tree('F()'), 'F()');
  assert.equal(tree('HBOUND(A(*), 1)'), 'HBOUND(A(*),1)');
  const r = parseReference(cur('P->X.Y'));
  assert.deepEqual([r.path, r.locators, r.name], [['P', 'X', 'Y'], [1], 'Y']);
});

test('a parenthesised factor before a literal repeats it', () => {
  assert.equal(tree("(3)'AB'"), "(3)'AB'");
  assert.equal(tree("(N)'0'B"), "(N)'0'B");
  assert.equal(tree("(A + B)"), '(A + B)');
});

test('the expression stops before a comma, a closing parenthesis, a word, an assignment or a stop op', () => {
  for (const [src, rest] of [['A + B, C', ','], ['A ) B', ')'], ['A = B THEN X = 1', 'THEN'], ['X += 1', '+='], ['A = 1 %THEN', '%']]) {
    const c = cur(src);
    parseExpression(c, { stopOps: ['%'] });
    assert.equal(c.peek().v, rest, src);
  }
});

test('an op in stopOps ends the expression even where it could be an operator', () => {
  const c = cur('A = B');
  parseExpression(c, { stopOps: ['='] });
  assert.equal(c.peek().v, '=');
});

test('refs are the references read, locators and arguments included, without repeats', () => {
  assert.deepEqual(parseExpression(cur('A + P->X.Y(I) + A + F(B, C.D)')).refs, ['A', 'P', 'P.X.Y', 'I', 'F', 'B', 'C.D']);
});

test('a missing operand is a syntax error', () => {
  assert.throws(() => parseExpression(cur('A +')), PliSyntax);
  assert.throws(() => parseExpression(cur(', A')), PliSyntax);
  assert.throws(() => parseExpression(cur('F(A B)')), PliSyntax);
});
