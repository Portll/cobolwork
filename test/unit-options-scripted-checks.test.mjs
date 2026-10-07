// Computes per-check pass/fail results and forbidden-argument findings for a compiler's argument vector, treating unrequested checks as missing (lib/options.mjs scriptedChecks).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scriptedChecks } from '../lib/options.mjs';
import './pin-machine.mjs';

test('returns ok false with not given reason for required checks not turned on', () => {
  const result = scriptedChecks('gnucobol', [], { required: ['subscript'] });
  assert.deepEqual(result, {
    checks: [
      {
        check: 'subscript',
        ok: false,
        why: 'subscript needs -fec=EC-BOUND-SUBSCRIPT or -debug, and the command gives neither',
      },
    ],
    forbidden: [],
  });
});

test('returns ok true with turned on reason for checks enabled by -fec', () => {
  const result = scriptedChecks('gnucobol', ['-fec=EC-BOUND-SUBSCRIPT'], { required: ['subscript'] });
  assert.deepEqual(result, {
    checks: [
      {
        check: 'subscript',
        ok: true,
        why: 'turned on by the command line',
      },
    ],
    forbidden: [],
  });
});

test('returns ok false with turned off reason for checks disabled by -fno-ec', () => {
  const result = scriptedChecks('gnucobol', ['-fno-ec=EC-BOUND-SUBSCRIPT'], { required: ['subscript'] });
  assert.deepEqual(result, {
    checks: [
      {
        check: 'subscript',
        ok: false,
        why: '-fno-ec=EC-BOUND-SUBSCRIPT turns off the subscript check',
      },
    ],
    forbidden: [],
  });
});

test('returns ok true for checks enabled by -debug', () => {
  const result = scriptedChecks('gnucobol', ['-debug'], { required: ['subscript'] });
  assert.deepEqual(result, {
    checks: [
      {
        check: 'subscript',
        ok: true,
        why: 'turned on by the command line',
      },
    ],
    forbidden: [],
  });
});

test('returns ok false with not given reason for gcobol checks not turned on', () => {
  const result = scriptedChecks('gcobol', [], { required: ['subscript'] });
  assert.deepEqual(result, {
    checks: [
      {
        check: 'subscript',
        ok: false,
        why: 'subscript needs -fcobol-exceptions=EC-BOUND-SUBSCRIPT, and the command does not give it',
      },
    ],
    forbidden: [],
  });
});

test('returns ok true for gcobol checks enabled by -fcobol-exceptions', () => {
  const result = scriptedChecks('gcobol', ['-fcobol-exceptions=EC-BOUND-SUBSCRIPT'], { required: ['subscript'] });
  assert.deepEqual(result, {
    checks: [
      {
        check: 'subscript',
        ok: true,
        why: 'turned on by the command line',
      },
    ],
    forbidden: [],
  });
});

test('returns ok false with turned off reason for gcobol checks disabled by -fno-cobol-exceptions', () => {
  const result = scriptedChecks('gcobol', ['-fno-cobol-exceptions=EC-BOUND-SUBSCRIPT'], { required: ['subscript'] });
  assert.deepEqual(result, {
    checks: [
      {
        check: 'subscript',
        ok: false,
        why: '-fno-cobol-exceptions=EC-BOUND-SUBSCRIPT turns off the subscript check',
      },
    ],
    forbidden: [],
  });
});

test('returns forbidden options when they appear in args', () => {
  const result = scriptedChecks('gnucobol', ['-O2'], { required: ['subscript'], forbid: ['-O2'] });
  assert.deepEqual(result.forbidden, ['-O2 is on the command line, and the policy forbids it']);
});

test('returns empty forbidden when no forbidden options appear in args', () => {
  const result = scriptedChecks('gnucobol', ['-fec=EC-BOUND-SUBSCRIPT'], { required: ['subscript'], forbid: ['-O2'] });
  assert.deepEqual(result.forbidden, []);
});
