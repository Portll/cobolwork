// cobcChecks: -fec parsing, required-check resolution, forbidden flags, and version pinning (lib/options.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cobcChecks } from '../lib/options.mjs';
import './pin-machine.mjs';

test('a required check not on the command line is added as a -fec flag', () => {
  const r = cobcChecks([], { required: ['subscript'] });
  assert.deepEqual(r, {
    checks: [{ check: 'subscript', ok: true, added: true, why: 'added as -fec=EC-BOUND-SUBSCRIPT' }],
    forbidden: [],
    add: ['-fec=EC-BOUND-SUBSCRIPT'],
  });
});

test('a check turned on by -fec is reported as turned on by the command line', () => {
  const r = cobcChecks(['-fec=EC-BOUND-SUBSCRIPT'], { required: ['subscript'] });
  assert.deepEqual(r, {
    checks: [{ check: 'subscript', ok: true, why: 'turned on by the command line' }],
    forbidden: [],
    add: [],
  });
});

test('a check turned on by -debug is reported as turned on by the command line', () => {
  const r = cobcChecks(['-debug'], { required: ['subscript'] });
  assert.deepEqual(r, {
    checks: [{ check: 'subscript', ok: true, why: 'turned on by the command line' }],
    forbidden: [],
    add: [],
  });
});

test('a check turned off by -fno-ec is a failed check', () => {
  const r = cobcChecks(['-fno-ec=EC-BOUND-SUBSCRIPT'], { required: ['subscript'] });
  assert.deepEqual(r, {
    checks: [{ check: 'subscript', ok: false, why: '-fno-ec=EC-BOUND-SUBSCRIPT turns off the subscript check' }],
    forbidden: [],
    add: [],
  });
});

test('a check turned off by -fno-ec with a separate value argument is a failed check', () => {
  const r = cobcChecks(['-fno-ec', 'EC-BOUND-SUBSCRIPT'], { required: ['subscript'] });
  assert.deepEqual(r, {
    checks: [{ check: 'subscript', ok: false, why: '-fno-ec EC-BOUND-SUBSCRIPT turns off the subscript check' }],
    forbidden: [],
    add: [],
  });
});

test('a condition that covers a required check turns it on', () => {
  const r = cobcChecks(['-fec=EC-BOUND'], { required: ['subscript'] });
  assert.deepEqual(r, {
    checks: [{ check: 'subscript', ok: true, why: 'turned on by the command line' }],
    forbidden: [],
    add: [],
  });
});

test('a forbidden flag on the command line is reported', () => {
  const r = cobcChecks(['-O2'], { required: [], forbid: ['-O2'] });
  assert.deepEqual(r, {
    checks: [],
    forbidden: ['-O2 is on the command line, and the policy forbids it'],
    add: [],
  });
});

test('a forbidden flag with an equals value on the command line is reported', () => {
  const r = cobcChecks(['-O2=fast'], { required: [], forbid: ['-O2'] });
  assert.deepEqual(r, {
    checks: [],
    forbidden: ['-O2=fast is on the command line, and the policy forbids it'],
    add: [],
  });
});

test('a pinned version older than the condition is a failed check', () => {
  const r = cobcChecks(['-fec=EC-PROGRAM-ARG-MISMATCH'], {
    required: ['argument-length'],
    pinned: { version: '3.1', where: 'the toolchain' },
  });
  assert.deepEqual(r, {
    checks: [
      {
        check: 'argument-length',
        ok: false,
        why: 'argument-length needs EC-PROGRAM-ARG-MISMATCH, which is in GnuCOBOL 3.2 and later; the toolchain pins 3.1',
      },
    ],
    forbidden: [],
    add: [],
  });
});

test('a pinned version older than -fec is a failed check for a check not turned on by -debug', () => {
  const r = cobcChecks([], {
    required: ['subscript'],
    pinned: { version: '3.0', where: 'the toolchain' },
  });
  assert.deepEqual(r, {
    checks: [
      {
        check: 'subscript',
        ok: false,
        why: 'subscript needs -fec, which is in GnuCOBOL 3.1 and later; the toolchain pins 3.0',
      },
    ],
    forbidden: [],
    add: [],
  });
});
