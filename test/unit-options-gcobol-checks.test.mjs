// Maps gcobol -fcobol-exceptions flags to required checks, adding missing ones and flagging unimplemented conditions (lib/options.mjs gcobolChecks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gcobolChecks } from '../lib/options.mjs';
import './pin-machine.mjs';

test('adds the missing -fcobol-exceptions flag for a required check not on the command line', () => {
  const result = gcobolChecks([], { required: ['subscript'] });
  assert.deepEqual(result, {
    checks: [{ check: 'subscript', ok: true, added: true, why: 'added as -fcobol-exceptions=EC-BOUND-SUBSCRIPT' }],
    forbidden: [],
    add: ['-fcobol-exceptions=EC-BOUND-SUBSCRIPT'],
  });
});

test('marks a required check as turned on when the command line enables its condition', () => {
  const result = gcobolChecks(['-fcobol-exceptions=EC-BOUND-SUBSCRIPT'], { required: ['subscript'] });
  assert.deepEqual(result, {
    checks: [{ check: 'subscript', ok: true, why: 'turned on by the command line' }],
    forbidden: [],
    add: [],
  });
});

test('marks a required check as failed when the command line disables its condition', () => {
  const result = gcobolChecks(['-fno-cobol-exceptions=EC-BOUND-SUBSCRIPT'], { required: ['subscript'] });
  assert.deepEqual(result, {
    checks: [{ check: 'subscript', ok: false, why: '-fno-cobol-exceptions=EC-BOUND-SUBSCRIPT turns off the subscript check' }],
    forbidden: [],
    add: [],
  });
});

test('fails a required check whose condition gcobol does not implement even if the command line enables it', () => {
  const result = gcobolChecks(['-fcobol-exceptions=EC-DATA-INCOMPATIBLE'], { required: ['numeric-data'] });
  assert.deepEqual(result, {
    checks: [{ check: 'numeric-data', ok: false, why: 'numeric-data needs EC-DATA-INCOMPATIBLE, which gcobol does not implement' }],
    forbidden: [],
    add: [],
  });
});

test('reports a forbidden argument that appears on the command line', () => {
  const result = gcobolChecks(['-fcobol-exceptions=EC-BOUND-SUBSCRIPT'], { required: ['subscript'], forbid: ['-fcobol-exceptions'] });
  assert.deepEqual(result, {
    checks: [{ check: 'subscript', ok: true, why: 'turned on by the command line' }],
    forbidden: ['-fcobol-exceptions=EC-BOUND-SUBSCRIPT is on the command line, and the policy forbids it'],
    add: [],
  });
});

test('treats a parent condition on the command line as covering a more specific required check', () => {
  const result = gcobolChecks(['-fcobol-exceptions=EC-BOUND'], { required: ['subscript'] });
  assert.deepEqual(result, {
    checks: [{ check: 'subscript', ok: true, why: 'turned on by the command line' }],
    forbidden: [],
    add: [],
  });
});

test('does not let a parent disable withdraw a more specific condition that a later flag enables', () => {
  const result = gcobolChecks(['-fno-cobol-exceptions=EC-BOUND', '-fcobol-exceptions=EC-BOUND-SUBSCRIPT'], { required: ['subscript'] });
  assert.deepEqual(result, {
    checks: [{ check: 'subscript', ok: true, why: 'turned on by the command line' }],
    forbidden: [],
    add: [],
  });
});

test('ignores arguments that are not cobol-exceptions flags', () => {
  const result = gcobolChecks(['-O2', '-fcobol-exceptions=EC-BOUND-SUBSCRIPT'], { required: ['subscript'] });
  assert.deepEqual(result, {
    checks: [{ check: 'subscript', ok: true, why: 'turned on by the command line' }],
    forbidden: [],
    add: [],
  });
});
