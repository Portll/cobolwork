// cobolwork reads `ironwork check` by its exit status and the ids of its --diagnostics json
// messages, never by their wording. A stub stands in for the binary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import './pin-machine.mjs';
import { checkWithIronwork, ironworkReasons, ironworkVerdict, messageClass, parseMessages } from '../lib/ironwork.mjs';
import { MESSAGE_AREAS, MESSAGE_IDS, UNDEFINED_NAME } from '../lib/ironwork-ids.mjs';

// On Windows the stub does not start, and every run reads as unrun whatever the case asks.
const posix = { skip: process.platform === 'win32' && 'the stand-in ironwork is a shell script' };

const SOURCE = [
  '       IDENTIFICATION DIVISION.',
  '       PROGRAM-ID. P.',
  '           MOVE EIBCALEN TO WS-X',
  '           MOVE WS-Y TO DIBSTAT',
  '           MOVE SQLCODE TO WS-Z',
].join('\n') + '\n';

// One message as ironwork 0.9.0 writes it under --diagnostics json.
const json = (file, { id = null, severity = 'S', line = 3, col = 17, member = null, message = 'm' } = {}) =>
  JSON.stringify({ col: line ? col : null, file, id, line: line || null, member, message, severity });

function tree() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-iw-'));
  writeFileSync(join(dir, 'P.cbl'), SOURCE);
  return dir;
}

// `lines` for one program, each a string or a function of the program's path; ironwork --version
// answers `version`. The arguments of every check run are kept beside the stub.
function run(status, lines = [], { version = 'ironwork for COBOL 0.9.0', extended = false } = {}) {
  const dir = tree();
  try {
    const program = join(dir, 'P.cbl');
    const said = join(dir, 'said.txt');
    writeFileSync(said, lines.map((l) => (typeof l === 'function' ? l(program) : l)).join('\n') + '\n');
    const stub = join(dir, 'ironwork-stub');
    writeFileSync(stub, `#!/bin/sh\nif [ "$1" = --version ]; then echo '${version}'; exit 0; fi\necho "$@" >> '${join(dir, 'args.txt')}'\ncat '${said}' >&2\nexit ${status}\n`);
    chmodSync(stub, 0o755);
    const result = checkWithIronwork(stub, dir, { programs: [program], extended });
    let args = [];
    try { args = readFileSync(join(dir, 'args.txt'), 'utf8').trim().split('\n'); } catch { /* never run */ }
    return { ...result, args };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('exit 0 and 4 compile, and check runs with --diagnostics json', posix, () => {
  const clean = run(0);
  assert.equal(ironworkVerdict(clean), true);
  assert.match(clean.args[0], / --diagnostics json( |$)/);
  const warned = run(4, [(p) => json(p, { id: 'IWC0055', severity: 'W', line: null })]);
  assert.equal(warned.warned, 1);
  assert.equal(ironworkVerdict(warned), true);
});

test('an error in each area that names a rule of the program fails it', posix, () => {
  for (const id of ['IWS0001', 'IWC0101', 'IWO0001', 'IWP0003', 'IWX0001', 'IWJ0001']) {
    const r = run(12, [(p) => json(p, { id, line: 4, col: 8 })]);
    assert.deepEqual([r.failed.length, r.failed[0]?.id], [1, id], id);
    assert.equal(ironworkVerdict(r), false, id);
  }
  assert.equal(run(8, [(p) => json(p, { id: 'IWS0025', severity: 'E' })]).failed.length, 1);
  assert.equal(run(16, [(p) => json(p, { id: 'IWS0001', severity: 'U' })]).failed.length, 1);
});

test('an IWR refusal or an IWL limit leaves the program undecided', posix, () => {
  for (const id of ['IWR0001', 'IWL0004']) {
    const r = run(12, [(p) => json(p, { id })]);
    assert.deepEqual([r.notModelled.length, r.notModelled[0].id], [1, id], id);
    assert.equal(ironworkVerdict(r), null, id);
  }
});

test('IWS0002 is a member no copy library holds', posix, () => {
  const r = run(12, [(p) => json(p, { id: 'IWS0002', line: 2, col: 8 })]);
  assert.equal(r.unresolved.length, 1);
  assert.equal(ironworkVerdict(r), null);
});

test('IWO0004 and IWO0005 are how ironwork was run, and the program is not checked', posix, () => {
  for (const id of ['IWO0004', 'IWO0005']) {
    const r = run(12, [(p) => json(p, { id, line: null })]);
    assert.equal(r.unrun.length, 1, id);
    assert.match(r.unrun[0].why, new RegExp(`not on the program: ${id} `));
    assert.equal(ironworkVerdict(r), null, id);
  }
});

test('IWC0001 at a field a translator declares is undecided; at any other name it fails', posix, () => {
  assert.equal(run(12, [(p) => json(p, { id: UNDEFINED_NAME, line: 3, col: 17 })]).notModelled.length, 1);
  assert.equal(run(12, [(p) => json(p, { id: UNDEFINED_NAME, line: 4, col: 25 })]).notModelled.length, 1);
  assert.equal(run(12, [(p) => json(p, { id: UNDEFINED_NAME, line: 5, col: 17 })]).notModelled.length, 1);
  const other = run(12, [(p) => json(p, { id: UNDEFINED_NAME, line: 4, col: 17 })]);
  assert.deepEqual([other.failed.length, other.failed[0].line], [1, 4]);
});

test('an error of the program fails it beside what ironwork does not model, and only its own are counted', posix, () => {
  const r = run(12, [
    (p) => json(p, { id: 'IWR0001', line: 2 }),
    (p) => json(p, { id: UNDEFINED_NAME, line: 3, col: 17 }),
    (p) => json(p, { id: UNDEFINED_NAME, line: 4, col: 17 }),
    (p) => json(p, { id: 'IWC0055', severity: 'W', line: null }),
  ]);
  assert.deepEqual(r.failed, [{ path: 'P.cbl', line: 4, col: 17, id: UNDEFINED_NAME, message: 'm', errors: 1 }]);
});

test('an id in an area cobolwork does not read, an id not of ironwork, or none leaves the program undecided as unread', posix, () => {
  for (const id of ['IWQ0001', 'IGYPS2121', null]) {
    const r = run(12, [(p) => json(p, { id, message: 'x is not defined' })]);
    assert.deepEqual([r.unread.length, r.failed.length, r.notModelled.length], [1, 0, 0], String(id));
    assert.equal(ironworkVerdict(r), null);
    assert.match(ironworkReasons(r).join('\n'), /1 program\(s\) stop at a message whose id this cobolwork does not read/);
  }
  const both = run(12, [(p) => json(p, { id: 'IWQ0001' }), (p) => json(p, { id: 'IWR0001' })]);
  assert.equal(both.unread.length, 1);
});

test('the wording alone changes nothing', posix, () => {
  const said = (id, message, at = {}) => run(12, [(p) => json(p, { id, message, ...at })]);
  assert.equal(said('IWC0101', 'USAGE X is not supported yet').failed.length, 1);
  assert.equal(said('IWS0001', 'COPY X: no such member in the copy libraries').failed.length, 1);
  assert.equal(said('IWR0001', 'a statement, found ENTRY').notModelled.length, 1);
  assert.equal(said('IWS0002', 'anything at all').unresolved.length, 1);
  assert.equal(said(UNDEFINED_NAME, 'EIBCALEN is not defined', { line: 4, col: 17 }).failed.length, 1);
  assert.equal(said(UNDEFINED_NAME, 'WS-Y is not defined', { line: 3, col: 17 }).notModelled.length, 1);
  // A line that is not a diagnostic is ironwork's own, and an exit of 12 with no error read is not a verdict.
  const text = run(12, ['P.cbl:3:8: IWC0101-S WS-X is not defined']);
  assert.deepEqual([text.failed.length, text.unrun.length], [0, 1]);
  assert.match(text.unrun[0].why, /ironwork exited 12 and gave no error message/);
});

test('an exit outside the return codes, or 16 with no U message, is unrun', posix, () => {
  assert.equal(run(2, ['ironwork: usage']).unrun.length, 1);
  const internal = run(16, ['thread main panicked']);
  assert.match(internal.unrun[0].why, /ironwork exited 16 and gave no error message/);
});

test('an ironwork older than 0.9.0 is not run, and each program says why', posix, () => {
  const r = run(0, [], { version: 'ironwork for COBOL 0.8.3' });
  assert.deepEqual([r.accepted, r.unrun.length, r.args.length], [0, 1, 0]);
  assert.match(r.unrun[0].why, /ironwork 0\.8\.3 writes no --diagnostics json, which cobolwork reads from ironwork 0\.9\.0/);
  assert.equal(ironworkVerdict(r), null);
  assert.equal(run(0, [], { version: 'ironwork for COBOL 0.10.0' }).accepted, 1);
});

test('a program its own errors fail is checked again under --compliance extended, with --diagnostics json', posix, () => {
  const r = run(12, [(p) => json(p, { id: 'IWS0065' })], { extended: true });
  assert.equal(r.args.length, 2);
  assert.match(r.args[1], /--compliance extended --diagnostics json/);
  assert.equal(r.checked[0].extended.messages[0].id, 'IWS0065');
});

// The reading itself, with no ironwork to run, on every platform.

test('parseMessages reads each JSON line, and keeps any other line as ironwork\'s own with no id', () => {
  const dir = tree();
  try {
    const program = join(dir, 'P.cbl');
    const member = join(dir, 'MEMB3.cpy');
    const out = [
      json(program, { id: 'IWC0001', line: 10, col: 20, message: 'WS-UNDEFINED is not defined' }),
      json(program, { id: 'IWX0014', severity: 'W', line: 2, col: 22, member, message: "VALUE 'A' is read as VALUE" }),
      json(program, { id: 'IWC0055', severity: 'W', line: null, message: 'no STOP RUN' }),
      'ironwork: an unlabelled line',
      '',
    ].join('\n');
    assert.deepEqual(parseMessages(out, { root: dir, program }), [
      { id: 'IWC0001', severity: 'S', text: 'WS-UNDEFINED is not defined', path: 'P.cbl', line: 10, col: 20, file: program },
      { id: 'IWX0014', severity: 'W', text: "VALUE '…' is read as VALUE", path: 'MEMB3.cpy', member: 'MEMB3.cpy', line: 2, col: 22, file: member },
      { id: 'IWC0055', severity: 'W', text: 'no STOP RUN', path: 'P.cbl', line: null, col: null, file: program },
      { id: null, severity: null, text: 'ironwork: an unlabelled line', path: 'P.cbl', line: null, col: null, file: null },
    ]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('messageClass reads the id, the area and, for IWC0001, the source at the position; never the message', () => {
  const dir = tree();
  try {
    const file = join(dir, 'P.cbl');
    const at = (id, line = 3, col = 17, text = 'm') => messageClass({ id, line, col, file, text });
    for (const [letter, about] of Object.entries(MESSAGE_AREAS)) assert.equal(at(`IW${letter}0999`), about, letter);
    for (const [id, about] of Object.entries(MESSAGE_IDS)) assert.equal(at(id), about, id);
    assert.equal(at(UNDEFINED_NAME), 'translator');
    assert.equal(at(UNDEFINED_NAME, 4, 17, 'DIBSTAT is not defined'), 'program');
    assert.equal(at(UNDEFINED_NAME, 4, 25, 'WS-Y is not defined'), 'translator');
    assert.equal(messageClass({ id: UNDEFINED_NAME, line: 3, col: 17, file: null, text: 'EIBCALEN is not defined' }), 'program');
    for (const id of ['IWQ0001', 'IGYPS2121', 'IWC01', null]) assert.equal(at(id), 'unknown', String(id));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
