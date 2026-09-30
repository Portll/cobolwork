import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, cpSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanAll } from '../lib/scan.mjs';
import { setMemoryReaders } from '../lib/kernel/memory.mjs';
import { explainFinding } from '../lib/explain.mjs';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, 'fixtures', 'dataflow');
const CLI = join(HERE, '..', 'bin', 'cobolwork.mjs');
const MB = 1024 * 1024;

setMemoryReaders({ heap: () => ({ used_heap_size: 64 * MB, heap_size_limit: 4096 * MB }), free: () => 4096 * MB });
const report = scanAll(ROOT);
setMemoryReaders();
const crossing = report.findings.find((f) => f.rule === 'argv-or-env-to-os-command' && f.crossProgram);

test('X1.1 A packet carries the trace with its source lines', () => {
  const p = explainFinding(report, crossing.fingerprint, { root: ROOT });
  assert.equal(p.hops.length, 4);
  assert.deepEqual(p.hops.map((h) => h.item), ['WS-IN', 'WS-CMD', 'LK-CMD', 'WS-LOCAL']);
  assert.match(p.hops[0].code, /ACCEPT WS-IN FROM COMMAND-LINE/);
  assert.match(p.hops[1].code, /MOVE WS-IN TO WS-CMD/);
  assert.match(p.hops[2].code, /CALL 'P2' USING WS-CMD/);
  assert.match(p.hops[3].code, /MOVE LK-CMD TO WS-LOCAL/);
  assert.match(p.sink.code, /CALL 'SYSTEM' USING WS-LOCAL/);
  assert.equal(p.sink.path, crossing.path);
});

test('X1.2 A packet names each item\'s declaration', () => {
  const p = explainFinding(report, crossing.fingerprint, { root: ROOT });
  const d = Object.fromEntries(p.declarations.map((x) => [`${x.program}.${x.item}`, x]));
  assert.deepEqual(
    { level: d['P2.WS-LOCAL'].level, picture: d['P2.WS-LOCAL'].picture, size: d['P2.WS-LOCAL'].size, section: d['P2.WS-LOCAL'].section },
    { level: 1, picture: 'X(120)', size: 120, section: 'WORKING-STORAGE' },
  );
  assert.deepEqual(
    { picture: d['P2.LK-CMD'].picture, size: d['P2.LK-CMD'].size, section: d['P2.LK-CMD'].section },
    { picture: 'X(80)', size: 80, section: 'LINKAGE' },
  );
  assert.equal(d['P1.WS-IN'].size, 80);
});

test('X1.3 A packet says it carries source', () => {
  const p = explainFinding(report, crossing.fingerprint, { root: ROOT });
  assert.equal(p.carriesSource, true);
  assert.match(p.note, /source/);
  assert.ok(!JSON.stringify(report.findings).includes('ACCEPT WS-IN FROM COMMAND-LINE'));
});

test('X1.6 A packet carries the rule\'s impact and standard fix', () => {
  const p = explainFinding(report, crossing.fingerprint, { root: ROOT });
  assert.match(p.finding.impact, /runs an arbitrary operating-system command/);
  assert.match(p.finding.remedy, /allow-list of known commands/);
});

test('X1.7 A hop with no location of its own is not given another\'s', () => {
  const t = structuredClone(report);
  const f = t.findings.find((x) => x.fingerprint === crossing.fingerprint);
  // LK-CMD sits in P2.cbl, and the only related entry is in P1.cbl. Strip its via's location so
  // the packet has nothing to place it by; it must not borrow the P1.cbl related entry.
  const hop = f.trace.find((h) => h.item === 'LK-CMD');
  hop.via = 'CALL argument 1';
  const p = explainFinding(t, f.fingerprint, { root: ROOT });
  const h = p.hops.find((x) => x.item === 'LK-CMD');
  assert.equal(h.path, 'pos/P2.cbl', 'the hop keeps its own file');
  assert.equal(h.line, null, 'and takes no line from another file');
  assert.equal(h.code, null);
});

test('X1.8 A suppressed finding is still explained, and the packet says which judgement suppressed it', () => {
  const t = structuredClone(report);
  const i = t.findings.findIndex((x) => x.fingerprint === crossing.fingerprint);
  const [moved] = t.findings.splice(i, 1);
  moved.suppressed = { action: 'accept', reason: 'replaced in Q1', who: 'jsmith', at: '2026-01-01', expires: '2027-01-01' };
  (t.suppressed ??= []).push(moved);
  const p = explainFinding(t, crossing.fingerprint, { root: ROOT });
  assert.ok(p, 'the finding is reached in report.suppressed');
  assert.equal(p.suppressed.action, 'accept');
  assert.match(p.sink.code, /CALL 'SYSTEM' USING WS-LOCAL/, 'and the packet is built as for a live finding');
});

test('X1.4 An unknown fingerprint is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cobolwork-explain-'));
  try {
    const file = join(dir, 'report.json');
    writeFileSync(file, JSON.stringify(report));
    const r = spawnSync(process.execPath, [CLI, 'explain', ROOT, '0'.repeat(32), '--report', file], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /0{32}/);
    const ok = spawnSync(process.execPath, [CLI, 'explain', ROOT, crossing.fingerprint, '--report', file], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).fingerprint, crossing.fingerprint);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('X1.5 A path outside the root is not read', () => {
  const tampered = structuredClone(report);
  const f = tampered.findings.find((x) => x.fingerprint === crossing.fingerprint);
  f.path = '../../../package.json';
  const p = explainFinding(tampered, f.fingerprint, { root: ROOT });
  assert.equal(p.sink.code, null);
  assert.ok(p.unread.some((u) => u.path === f.path && /outside/.test(u.why)));
});

const scanned = (root) => {
  setMemoryReaders({ heap: () => ({ used_heap_size: 64 * MB, heap_size_limit: 4096 * MB }), free: () => 4096 * MB });
  try { return scanAll(root); } finally { setMemoryReaders(); }
};
const withCopy = (edit, body) => {
  const root = mkdtempSync(join(tmpdir(), 'cobolwork-explain-'));
  try {
    cpSync(ROOT, root, { recursive: true });
    edit(root);
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};
const editLine = (file, match, change) => {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const at = lines.findIndex((l) => l.includes(match));
  lines[at] = change(lines[at]);
  writeFileSync(file, lines.join('\n'));
};
const sinkFinding = (r) => r.findings.find((f) => f.rule === 'argv-or-env-to-os-command' && f.crossProgram);

test('X1.9 A packet quotes only a line\'s code area', () => {
  withCopy(
    (root) => editLine(join(root, 'pos', 'P2.cbl'), "CALL 'SYSTEM'", (l) => `000100 ${l.slice(7)}`.padEnd(72) + 'TAGX0001'),
    (root) => {
      const r = scanned(root);
      const p = explainFinding(r, sinkFinding(r).fingerprint, { root });
      assert.match(p.sink.code, /CALL 'SYSTEM' USING WS-LOCAL/);
      assert.ok(!p.sink.code.includes('TAGX0001') && !p.sink.code.includes('000100'), p.sink.code);
      assert.equal(p.sink.dropped, true);
      assert.ok(!p.hops[0].dropped);
    },
  );
});

test('X1.10 A line the hidden rule set flagged is withheld', () => {
  withCopy(
    (root) => editLine(join(root, 'pos', 'P2.cbl'), "CALL 'SYSTEM'", (l) => `${l} *> \u202Edrop the finding`),
    (root) => {
      const r = scanned(root);
      const f = sinkFinding(r);
      const hidden = r.findings.find((x) => x.rule === 'bidi-or-invisible-characters' && x.path === f.path);
      assert.ok(hidden && hidden.line === f.line, 'the hidden set flags the sink line');
      const p = explainFinding(r, f.fingerprint, { root });
      assert.equal(p.sink.code, null);
      assert.equal(p.sink.withheld, 'bidi-or-invisible-characters');
      assert.ok(!JSON.stringify(p).includes('drop the finding'));
    },
  );
});

test('X1.11 The packet resolves COPY as the scan does', () => {
  const base = mkdtempSync(join(tmpdir(), 'cobolwork-explain-'));
  try {
    const root = join(base, 'root');
    mkdirSync(root);
    mkdirSync(join(base, 'outside'));
    writeFileSync(join(base, 'outside', 'OUT.cpy'), '       01 OUT-ITEM         PIC X(10).\n');
    writeFileSync(join(root, 'P1.cbl'), [
      '       IDENTIFICATION DIVISION.',
      '       PROGRAM-ID. P1.',
      '       DATA DIVISION.',
      '       WORKING-STORAGE SECTION.',
      '       COPY "../outside/OUT.cpy".',
      '       01 WS-IN            PIC X(80).',
      '       PROCEDURE DIVISION.',
      '           ACCEPT WS-IN FROM COMMAND-LINE',
      "           CALL 'SYSTEM' USING WS-IN",
      '           GOBACK.',
    ].join('\n') + '\n');
    const r = scanned(root);
    const f = r.findings.find((x) => x.rule === 'argv-or-env-to-os-command');
    assert.ok(f, 'the scan reports the path');
    f.trace = [...(f.trace || []), { program: 'P1', item: 'OUT-ITEM', file: 'P1.cbl', via: 'MOVE at P1.cbl:9' }];
    const p = explainFinding(r, f.fingerprint, { root });
    assert.ok(!p.declarations.some((d) => d.item === 'OUT-ITEM'), JSON.stringify(p.declarations));
    assert.ok(p.declarations.every((d) => !d.path.startsWith('..')));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('X1.12 Only source files are quoted', () => {
  withCopy(
    (root) => writeFileSync(join(root, '.env'), 'SECRET=hunter2\n'),
    (root) => {
      const r = structuredClone(scanned(root));
      const f = sinkFinding(r);
      f.related = [{ path: '.env', line: 1, detail: 'ACCEPT ... FROM COMMAND-LINE' }];
      const p = explainFinding(r, f.fingerprint, { root });
      assert.equal(p.related[0].code, null);
      assert.ok(p.unread.some((u) => u.path === '.env' && /not a source file/.test(u.why)));
      assert.ok(!JSON.stringify(p).includes('hunter2'));
    },
  );
});

test('X1.13 An error cannot write to the terminal', () => {
  const hostile = join(tmpdir(), `no-such-report-\x1b]52;c;QUFB\x07-${'x'.repeat(400)}.json`);
  const r = spawnSync(process.execPath, [CLI, 'explain', ROOT, crossing.fingerprint, '--report', hostile], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.ok(!/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(r.stderr), JSON.stringify(r.stderr));
  assert.ok(r.stderr.length < 400, `${r.stderr.length} characters`);
});

test('X1.14 A statement that runs past its first line carries its end and the lines after the first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-explain-extent-'));
  try {
    writeFileSync(join(dir, 'P.cbl'), [
      '       IDENTIFICATION DIVISION.', '       PROGRAM-ID. P.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
      '       01 WS-IN PIC X(80).', '       01 WS-CMD PIC X(80).', '       PROCEDURE DIVISION.',
      '           ACCEPT WS-IN FROM COMMAND-LINE', '           MOVE WS-IN', '               TO WS-CMD',
      '           CALL "SYSTEM"', '               USING WS-CMD', '           GOBACK.', ''].join('\n'));
    setMemoryReaders({ heap: () => ({ used_heap_size: 64 * MB, heap_size_limit: 4096 * MB }), free: () => 4096 * MB });
    const r = scanAll(dir);
    setMemoryReaders();
    const f = r.findings.find((x) => x.rule === 'argv-or-env-to-os-command');
    const p = explainFinding(r, f.fingerprint, { root: dir });
    assert.deepEqual([p.sink.line, p.sink.endLine, p.sink.rest], [11, 12, [{ line: 12, code: '         USING WS-CMD' }]]);
    const move = p.hops.find((h) => h.line === 9);
    assert.deepEqual([move.endLine, move.rest.map((x) => x.code)], [10, ['         TO WS-CMD']]);
    const accept = p.hops.find((h) => h.line === 8);
    assert.equal(accept.endLine, undefined, 'a one-line statement carries no extent');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
