import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { keep, parseOrder, restore, sameAnalysis } from '../lib/control-reuse.mjs';
import { scan } from '../lib/sets/flow.mjs';
import './pin-machine.mjs';

const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-reuse-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
};

const CALLER = ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. P1.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
  '       01 WS-IN            PIC X(80).', '       01 WS-CMD           PIC X(80).', '       PROCEDURE DIVISION.',
  '           ACCEPT WS-IN FROM COMMAND-LINE', '           IF WS-IN = SPACES', '               GOBACK', '           END-IF',
  '           MOVE WS-IN TO WS-CMD', "           CALL 'P2' USING WS-CMD", '           GOBACK.', ''].join('\n');
const callee = (body) => ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. P2.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
  '       01 WS-LOCAL         PIC X(120).', '       LINKAGE SECTION.', '       01 LK-CMD           PIC X(80).',
  '       PROCEDURE DIVISION USING LK-CMD.', '           MOVE LK-CMD TO WS-LOCAL', body, '           GOBACK.', ''].join('\n');
const RUNS = callee("           CALL 'SYSTEM' USING WS-LOCAL");
const SHOWS = callee('           DISPLAY WS-LOCAL');

const withVerify = (fn) => {
  const was = process.env.COBOLWORK_VERIFY_REUSE;
  process.env.COBOLWORK_VERIFY_REUSE = '1';
  try { return fn(); } finally { if (was === undefined) delete process.env.COBOLWORK_VERIFY_REUSE; else process.env.COBOLWORK_VERIFY_REUSE = was; }
};
const commands = (r) => r.findings.filter((f) => f.rule === 'argv-or-env-to-os-command').map((f) => f.path).sort();

test('a kept analysis comes back with the copy\'s own objects, its shared parts shared, and its paths mapped', () => {
  const parseA = { items: [{ name: 'A' }, { name: 'B' }], file: '/x/a.cbl' };
  const parseB = { items: [{ name: 'A' }, { name: 'B' }], file: '/y/a.cbl' };
  const shared = { lo: 1 };
  const bits = new Uint16Array([3, 9]);
  const analysis = { field: parseA.items[1], twice: [shared, shared], at: new Map([[parseA.items[0], 7]]), s: new Set(['b', 'a']), facts: new Map([[1, bits], [2, bits]]), file: '/x/a.cbl', copy: '/x/C.cpy' };
  const kept = keep(analysis, parseOrder(parseA), ['/x/a.cbl', '/x/C.cpy']);
  const back = restore(kept, parseOrder(parseB), ['/y/a.cbl', '/y/C.cpy']);
  assert.equal(back.field, parseB.items[1]);
  assert.equal(back.twice[0], back.twice[1]);
  assert.deepEqual([...back.at], [[parseB.items[0], 7]]);
  assert.deepEqual([...back.s], ['b', 'a']);
  assert.equal(back.facts.get(1), back.facts.get(2));
  assert.equal(back.file, '/y/a.cbl');
  assert.equal(back.copy, '/y/C.cpy');
  assert.ok(sameAnalysis(back, restore(kept, parseOrder(parseB), ['/y/a.cbl', '/y/C.cpy']), new Set(parseOrder(parseB))));
});

test('a path inside a longer string, or a value that is not plain data, is not kept', () => {
  const parse = { file: '/x/a.cbl' };
  assert.equal(keep({ detail: 'read at /x/a.cbl:12' }, parseOrder(parse), ['/x/a.cbl']), null);
  assert.equal(keep({ when: new Date(0) }, parseOrder(parse), ['/x/a.cbl']), null);
  assert.equal(keep({ run: () => 1 }, parseOrder(parse), ['/x/a.cbl']), null);
});

test('a copy of a program follows its own neighbours: the callee beside each copy decides what it reaches', () => {
  const root = tree({ 'a/P1.cbl': CALLER, 'a/P2.cbl': RUNS, 'b/P1.cbl': CALLER, 'b/P2.cbl': SHOWS });
  const r = withVerify(() => scan(root, { reuseMinBytes: 0 }));
  assert.deepEqual(commands(r), ['a/P2.cbl']);
  assert.ok(!(r.summary.setsIncomplete || []).length);
});

test('copies of a caller and its callee each report under their own paths', () => {
  const root = tree({ 'a/P1.cbl': CALLER, 'a/P2.cbl': RUNS, 'b/P1.cbl': CALLER, 'b/P2.cbl': RUNS });
  const alone = scan(tree({ 'a/P1.cbl': CALLER, 'a/P2.cbl': RUNS }));
  const both = withVerify(() => scan(root, { reuseMinBytes: 0 }));
  assert.deepEqual(commands(both), ['a/P2.cbl', 'b/P2.cbl']);
  const traceOf = (r, dir) => r.findings.find((f) => f.path === `${dir}/P2.cbl`).trace.map((t) => `${t.file}:${t.line} ${t.program}.${t.item}`);
  assert.deepEqual(traceOf(both, 'a'), traceOf(alone, 'a'));
  assert.deepEqual(traceOf(both, 'b'), traceOf(alone, 'a').map((s) => s.replace(/^a\//, 'b/')));
});
