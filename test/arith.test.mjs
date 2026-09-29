// Interval arithmetic under the check model (lib/arith.mjs): exact endpoints, one truncation at the store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parser, attempt, candidates, storedRange } from '../lib/arith.mjs';
import './pin-machine.mjs';

const word = (u) => ({ t: 'word', u: u.toUpperCase(), v: u });
const op = (v) => ({ t: 'op', v });
const sep = (v) => ({ t: 'sep', v });
const field = (ranges) => (leaf) => ranges[leaf.tok.u];
const env = { field: (tok) => ({ k: 'field', tok }), sizeOf: () => null };
const range = (toks, ranges, rounded = false) => {
  const p = parser(toks, env);
  const tree = attempt(() => p.expr());
  return candidates(tree, field(ranges)).map((c) => storedRange(c.iv, rounded));
};

test('a quotient is truncated once, at the store, and its lower end is kept', () => {
  const [r] = range([word('n'), op('/'), word('16'), op('+'), word('1')], { N: [{ needs: [], lo: 0n, hi: 255n }] });
  assert.deepEqual(r, { lo: 1n, hi: 16n });
});

test('a quotient by a divisor with another prime factor is widened, and cannot be multiplied again', () => {
  const [r] = range([word('n'), op('/'), word('3'), op('+'), word('1')], { N: [{ needs: [], lo: 0n, hi: 9n }] });
  assert.deepEqual(r, { lo: 0n, hi: 4n });
  assert.deepEqual(range([sep('('), word('n'), op('/'), word('3'), sep(')'), op('*'), word('3')], { N: [{ needs: [], lo: 3n, hi: 9n }] }), []);
});

test('a divisor that can be zero gives no interval', () => {
  assert.deepEqual(range([word('n'), op('/'), word('d')], { N: [{ needs: [], lo: 0n, hi: 9n }], D: [{ needs: [], lo: 0n, hi: 9n }] }), []);
  assert.equal(range([word('n'), op('/'), word('d')], { N: [{ needs: [], lo: 0n, hi: 9n }], D: [{ needs: [], lo: 1n, hi: 9n }] }).length, 1);
});

test('a negative operand gives a negative interval, and rounding widens outward', () => {
  const [r] = range([word('n'), op('/'), word('16')], { N: [{ needs: [], lo: -999n, hi: 999n }] });
  assert.deepEqual(r, { lo: -62n, hi: 62n });
  const [q] = range([word('n'), op('/'), word('4')], { N: [{ needs: [], lo: 1n, hi: 6n }] }, true);
  assert.deepEqual(q, { lo: 0n, hi: 2n });
});

test('FUNCTION MOD by a positive divisor is 0 to one below it, whatever the dividend', () => {
  const [r] = range([word('function'), word('mod'), sep('('), word('n'), word('16'), sep(')'), op('+'), word('1')], { N: [{ needs: [], lo: -5n, hi: 300n }] });
  assert.deepEqual(r, { lo: 1n, hi: 16n });
});

test('facts an operand needs are the facts the result needs', () => {
  const cands = candidates(attempt(() => parser([word('k'), op('+'), word('1')], env).expr()), field({
    K: [{ needs: [], lo: 0n, hi: 1000n }, { needs: [7], lo: 0n, hi: 49n }],
  }));
  assert.deepEqual(cands.map((c) => c.needs), [[], [7]]);
});
