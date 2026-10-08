// Reasons reported by ironwork for a check result (lib/ironwork.mjs ironworkReasons).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ironworkReasons } from '../lib/ironwork.mjs';
import './pin-machine.mjs';

test('returns an empty array when every result list is empty', () => {
  const result = { failed: [], notModelled: [], unresolved: [], unread: [], unrun: [], programs: 0 };
  assert.deepEqual(ironworkReasons(result), []);
});

test('reports the failed count and the first ten failures with their locations', () => {
  const failed = Array.from({ length: 12 }, (_, i) => ({
    path: `src/p${i}.cbl`,
    line: i + 1,
    col: i + 2,
    member: i % 2 ? `m${i}` : undefined,
    message: `err ${i}`,
  }));
  const result = { failed, notModelled: [], unresolved: [], unread: [], unrun: [], programs: 12 };
  const reasons = ironworkReasons(result);
  assert.equal(reasons[0], 'ironwork check: 12 of 12 program(s) do not compile as Enterprise COBOL');
  assert.equal(reasons.length, 1 + 10);
  assert.equal(reasons[1], 'src/p0.cbl:1:2: err 0');
  assert.equal(reasons[2], 'src/p1.cbl:2:3 (in m1): err 1');
  assert.equal(reasons[10], 'src/p9.cbl:10:11 (in m9): err 9');
});

test('reports a single notModelled program with its location and message', () => {
  const result = {
    failed: [],
    notModelled: [{ path: 'src/x.cbl', line: 5, col: 8, member: 'M', message: 'EIB is not defined' }],
    unresolved: [],
    unread: [],
    unrun: [],
    programs: 1,
  };
  assert.deepEqual(ironworkReasons(result), [
    'ironwork check: 1 program(s) use what ironwork does not model yet, so whether they compile is not decided; the first is src/x.cbl:5:8 (in M): EIB is not defined',
  ]);
});

test('reports unresolved copies without listing individual entries', () => {
  const result = {
    failed: [],
    notModelled: [],
    unresolved: [{ path: 'src/a.cbl' }, { path: 'src/b.cbl' }],
    unread: [],
    unrun: [],
    programs: 2,
  };
  assert.deepEqual(ironworkReasons(result), [
    'ironwork check: 2 program(s) copy a member the copy libraries do not hold; name the estate\'s with --copylib',
  ]);
});

test('reports unrun programs with the first path and reason', () => {
  const result = {
    failed: [],
    notModelled: [],
    unresolved: [],
    unread: [],
    unrun: [
      { path: 'src/skip.cbl', why: 'no compiler' },
      { path: 'src/skip2.cbl', why: 'no compiler' },
    ],
    programs: 2,
  };
  assert.deepEqual(ironworkReasons(result), [
    'ironwork check: 2 program(s) were not checked; the first, src/skip.cbl: no compiler',
  ]);
});

test('omits the line and member suffix when they are absent', () => {
  const result = {
    failed: [{ path: 'src/n.cbl', message: 'boom' }],
    notModelled: [],
    unresolved: [],
    unread: [],
    unrun: [],
    programs: 1,
  };
  assert.deepEqual(ironworkReasons(result), [
    'ironwork check: 1 of 1 program(s) do not compile as Enterprise COBOL',
    'src/n.cbl: boom',
  ]);
});

test('emits one reason per non-empty result section in order', () => {
  const result = {
    failed: [{ path: 'f.cbl', line: 1, col: 1, message: 'm' }],
    notModelled: [{ path: 'n.cbl', line: 2, col: 2, message: 'm' }],
    unresolved: [{ path: 'u.cbl' }],
    unread: [{ path: 'q.cbl', line: 3, col: 8, id: 'IWQ0001', message: 'm' }],
    unrun: [{ path: 'r.cbl', why: 'w' }],
    programs: 5,
  };
  assert.deepEqual(ironworkReasons(result), [
    'ironwork check: 1 of 5 program(s) do not compile as Enterprise COBOL',
    'f.cbl:1:1: m',
    'ironwork check: 1 program(s) use what ironwork does not model yet, so whether they compile is not decided; the first is n.cbl:2:2: m',
    "ironwork check: 1 program(s) copy a member the copy libraries do not hold; name the estate's with --copylib",
    'ironwork check: 1 program(s) stop at a message whose id this cobolwork does not read, so whether they compile is not decided; the first is q.cbl:3:8 IWQ0001: m',
    'ironwork check: 1 program(s) were not checked; the first, r.cbl: w',
  ]);
});
