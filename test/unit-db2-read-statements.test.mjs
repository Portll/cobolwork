// splits token stream into statements (lib/db2/read.mjs statements).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statements } from '../lib/db2/read.mjs';
import './pin-machine.mjs';

const w = (u, line) => ({ t: 'word', u, line });
const e = (v, line) => ({ t: 'end', v, line });

test('splits a simple terminated statement', () => {
  const toks = [w('SELECT', 1), w('*', 1), e(';', 1)];
  const out = statements(toks);
  assert.deepStrictEqual(out, [
    {
      toks: [w('SELECT', 1), w('*', 1)],
      line: 1,
      endLine: 1,
    },
  ]);
});

test('produces an unterminated statement when no terminator is present', () => {
  const toks = [w('INSERT', 1), w('INTO', 1)];
  const out = statements(toks);
  assert.deepStrictEqual(out, [
    {
      toks: [w('INSERT', 1), w('INTO', 1)],
      line: 1,
      endLine: 1,
      unterminated: true,
    },
  ]);
});

test('handles BEGIN/END depth inside a routine and closes at the terminator', () => {
  const toks = [
    w('CREATE', 1),
    w('PROCEDURE', 1),
    w('P1', 1),
    w('BEGIN', 1),
    w('SELECT', 1),
    w('END', 1),
    e(';', 2),
  ];
  const out = statements(toks);
  assert.deepStrictEqual(out, [
    {
      toks: [
        w('CREATE', 1),
        w('PROCEDURE', 1),
        w('P1', 1),
        w('BEGIN', 1),
        w('SELECT', 1),
        w('END', 1),
      ],
      line: 1,
      endLine: 2,
    },
  ]);
});

test('does not decrement depth when END is followed by a NON_OPENING_END token (IF)', () => {
  const toks = [
    w('CREATE', 1),
    w('PROCEDURE', 1),
    w('P2', 1),
    w('BEGIN', 1),
    w('SELECT', 1),
    w('END', 1),
    w('IF', 1),
    e(';', 2),
  ];
  const out = statements(toks);
  assert.deepStrictEqual(out, [
    {
      toks: [
        w('CREATE', 1),
        w('PROCEDURE', 1),
        w('P2', 1),
        w('BEGIN', 1),
        w('SELECT', 1),
        w('END', 1),
        w('IF', 1),
        { t: 'op', v: ';', line: 2 },
      ],
      line: 1,
      endLine: 2,
      unterminated: true,
    },
  ]);
});

test('CASE after END does not open a new depth level and leaves statement unterminated', () => {
  const toks = [
    w('CREATE', 1),
    w('PROCEDURE', 1),
    w('P3', 1),
    w('BEGIN', 1),
    w('CASE', 1),
    w('WHEN', 1),
    w('END', 1),
    w('CASE', 1),
    e(';', 2),
  ];
  const out = statements(toks);
  assert.deepStrictEqual(out, [
    {
      toks: [
        w('CREATE', 1),
        w('PROCEDURE', 1),
        w('P3', 1),
        w('BEGIN', 1),
        w('CASE', 1),
        w('WHEN', 1),
        w('END', 1),
        w('CASE', 1),
        { t: 'op', v: ';', line: 2 },
      ],
      line: 1,
      endLine: 2,
      unterminated: true,
    },
  ]);
});

test('BEGIN followed by END closes depth and statement terminates normally', () => {
  const toks = [w('BEGIN', 1), w('END', 1), e(';', 1)];
  const out = statements(toks);
  assert.deepStrictEqual(out, [
    {
      toks: [w('BEGIN', 1), w('END', 1)],
      line: 1,
      endLine: 1,
    },
  ]);
});
