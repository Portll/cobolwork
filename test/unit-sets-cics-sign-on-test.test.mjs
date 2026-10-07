// Detects a sign-on password comparison in a condition (lib/sets/cics.mjs signOnTest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signOnTest } from '../lib/sets/cics.mjs';
import './pin-machine.mjs';

test('returns null when the condition is absent', () => {
  assert.equal(signOnTest({}), null);
});

test('returns null when the condition contains a logical operator', () => {
  const toks = [
    { t: 'word', u: 'USER-PWD' },
    { t: 'op', v: '=' },
    { t: 'word', u: 'INPUT-PWD' },
    { t: 'word', u: 'AND' },
    { t: 'word', u: 'FLAG' },
    { t: 'op', v: '=' },
    { t: 'word', u: 'ON' },
  ];
  assert.equal(signOnTest({ cond: toks }), null);
});

test('returns null when the condition contains a literal', () => {
  const toks = [
    { t: 'word', u: 'USER-PWD' },
    { t: 'op', v: '=' },
    { t: 'lit', v: 'SECRET' },
  ];
  assert.equal(signOnTest({ cond: toks }), null);
});

test('returns null when the condition contains a figurative constant', () => {
  const toks = [
    { t: 'word', u: 'USER-PWD' },
    { t: 'op', v: '=' },
    { t: 'word', u: 'SPACES' },
  ];
  assert.equal(signOnTest({ cond: toks }), null);
});

test('returns null when no field name matches the password pattern', () => {
  const toks = [
    { t: 'word', u: 'USER-ID' },
    { t: 'op', v: '=' },
    { t: 'word', u: 'INPUT-ID' },
  ];
  assert.equal(signOnTest({ cond: toks }), null);
});

test('returns a true sign-on marker for an equal password comparison', () => {
  const toks = [
    { t: 'word', u: 'USER-PWD' },
    { t: 'op', v: '=' },
    { t: 'word', u: 'INPUT-PWD' },
  ];
  assert.deepEqual(signOnTest({ cond: toks }), { true: 'SIGNON' });
});

test('returns a false sign-on marker for a not-equal password comparison', () => {
  const toks = [
    { t: 'word', u: 'USER-PWD' },
    { t: 'op', v: '<>' },
    { t: 'word', u: 'INPUT-PWD' },
  ];
  assert.deepEqual(signOnTest({ cond: toks }), { false: 'SIGNON' });
});

test('returns a true sign-on marker for an EQUALS keyword comparison', () => {
  const toks = [
    { t: 'word', u: 'USER-PWD' },
    { t: 'word', u: 'EQUALS' },
    { t: 'word', u: 'INPUT-PWD' },
  ];
  assert.deepEqual(signOnTest({ cond: toks }), { true: 'SIGNON' });
});
