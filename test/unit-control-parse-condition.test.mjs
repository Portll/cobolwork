// A COBOL condition read into a tree of AND, OR and NOT over relations, class, sign and condition-name tests (lib/control.mjs parseCondition).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCondition } from '../lib/control.mjs';
import './pin-machine.mjs';

const w = (u) => ({ t: 'word', u });
const op = (v) => ({ t: 'op', v });
const sep = (v) => ({ t: 'sep', v });
const lit = (u) => ({ t: 'literal', u });

test('simple equality relation', () => {
  const toks = [w('X'), op('='), lit('5')];
  const res = parseCondition(toks, () => null);
  assert.deepEqual(res, {
    k: 'rel',
    left: [w('X')],
    op: '=',
    right: [lit('5')]
  });
});

test('abbreviated relation with AND', () => {
  const toks = [w('X'), op('='), lit('5'), w('AND'), op('<'), lit('10')];
  const res = parseCondition(toks, () => null);
  assert.deepEqual(res, {
    k: 'and',
    a: {
      k: 'rel',
      left: [w('X')],
      op: '=',
      right: [lit('5')]
    },
    b: {
      k: 'rel',
      left: [w('X')],
      op: '<',
      right: [lit('10')]
    }
  });
});

test('class test with IS', () => {
  const toks = [w('X'), w('IS'), w('NUMERIC')];
  const res = parseCondition(toks, () => null);
  assert.deepEqual(res, {
    k: 'class',
    subject: [w('X')],
    cls: 'NUMERIC'
  });
});

test('sign test with NOT', () => {
  const toks = [w('X'), w('NOT'), w('ZERO')];
  const res = parseCondition(toks, () => null);
  assert.deepEqual(res, {
    k: 'not',
    a: {
      k: 'sign',
      subject: [w('X')],
      sign: 'ZERO'
    }
  });
});

test('negated relation with NOT prefix', () => {
  const toks = [w('NOT'), w('X'), op('='), lit('5')];
  const res = parseCondition(toks, () => null);
  assert.deepEqual(res, {
    k: 'not',
    a: {
      k: 'rel',
      left: [w('X')],
      op: '=',
      right: [lit('5')]
    }
  });
});

test('parenthesized OR expression', () => {
  const toks = [
    sep('('),
    w('X'), op('='), lit('5'),
    w('OR'),
    w('Y'), op('='), lit('6'),
    sep(')')
  ];
  const res = parseCondition(toks, () => null);
  assert.deepEqual(res, {
    k: 'or',
    a: {
      k: 'rel',
      left: [w('X')],
      op: '=',
      right: [lit('5')]
    },
    b: {
      k: 'rel',
      left: [w('Y')],
      op: '=',
      right: [lit('6')]
    }
  });
});

test('condition name alone', () => {
  const toks = [w('X')];
  const res = parseCondition(toks, () => null);
  assert.deepEqual(res, {
    k: 'cond',
    subject: [w('X')]
  });
});

test('abbreviated connective with condition name', () => {
  const toks = [w('X'), op('='), lit('5'), w('AND'), w('Y')];
  const res = parseCondition(toks, () => null);
  assert.deepEqual(res, {
    k: 'and',
    a: {
      k: 'rel',
      left: [w('X')],
      op: '=',
      right: [lit('5')]
    },
    b: {
      k: 'rel',
      left: [w('X')],
      op: '=',
      right: [w('Y')]
    }
  });
});

test('extra tokens produce opaque suffix', () => {
  const toks = [w('X'), op('='), lit('5'), w('EXTRA')];
  const res = parseCondition(toks, () => null);
  assert.deepEqual(res, {
    k: 'rel',
    left: [w('X')],
    op: '=',
    right: [lit('5'), w('EXTRA')]
  });
});

test('GREATER THAN OR EQUAL TO relation', () => {
  const toks = [w('X'), w('GREATER'), w('THAN'), w('OR'), w('EQUAL'), w('TO'), lit('10')];
  const res = parseCondition(toks, () => null);
  assert.deepEqual(res, {
    k: 'rel',
    left: [w('X')],
    op: '>=',
    right: [lit('10')]
  });
});
