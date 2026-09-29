import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { scanAll } from '../lib/scan.mjs';
import { setMemoryReaders, setAvailableMemory } from '../lib/kernel/memory.mjs';
import { ACTIONS, KEYMAPS, LEGEND } from '../lib/tui/keys.mjs';
import { createScreen, put, redraw, screenText } from '../lib/tui/screen.mjs';
import { readReport, banner, rows, SEV_LETTER } from '../lib/tui/model.mjs';
import { initialState, update, view, PANELS } from '../lib/tui/app.mjs';
import { nodeTerminal } from '../lib/tui/terminal.mjs';
import { runTui } from '../lib/tui/run.mjs';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');
const CLI = join(HERE, '..', 'bin', 'cobolwork.mjs');
const MB = 1024 * 1024;

setMemoryReaders({ heap: () => ({ used_heap_size: 64 * MB, heap_size_limit: 4096 * MB }), free: () => 4096 * MB });
const dataflow = readReport(scanAll(join(FIXTURES, 'dataflow')));
const guards = readReport(scanAll(join(FIXTURES, 'guards')));
const bench = readReport(scanAll(join(HERE, '..', 'bench', 'cases')));
setAvailableMemory(0);
const starved = readReport(scanAll(join(FIXTURES, 'dataflow')));
setAvailableMemory(null);
setMemoryReaders();

const press = (state, ...tokens) => {
  const effects = [];
  for (const token of tokens) {
    const r = update(state, { type: 'key', token });
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
};
const type = (state, text) => press(state, ...[...text].map((c) => `char:${c}`), 'Enter');
const lines = (state) => screenText(view(state)).split('\n');
const panelOf = (state) => state.stack[state.stack.length - 1].panel;
const onFindings = (report, keymap = 'ispf') => press(initialState({ report, keymap }), 'Enter').state;

function fakeStreams(cols = 80, rows = 24) {
  const input = new PassThrough();
  input.isTTY = true;
  input.rawCalls = [];
  input.setRawMode = (on) => { input.rawCalls.push(on); input.isRaw = on; };
  const output = new PassThrough();
  output.columns = cols;
  output.rows = rows;
  output.written = '';
  output.write = (s) => { output.written += s; return true; };
  return { input, output };
}

test('T0.1 The terminal is restored when the interface quits', async () => {
  const { input, output } = fakeStreams();
  const terminal = nodeTerminal({ input, output });
  const done = runTui({ report: dataflow, terminal });
  assert.ok(output.written.includes('\x1b[?1049h'), 'entered the alternate screen');
  assert.equal(input.isRaw, true);
  input.write('\x1b[13~'); // F3
  await done;
  assert.ok(output.written.endsWith('\x1b[?25h\x1b[?1049l'), 'cursor shown, alternate screen left');
  assert.equal(input.isRaw, false);
});

test('T0.2 The terminal is restored when an error escapes', async () => {
  const { input, output } = fakeStreams();
  const terminal = nodeTerminal({ input, output });
  const boom = () => { throw new Error('boom'); };
  const done = runTui({ report: dataflow, terminal, app: { initialState, view, update: boom } });
  input.write('j');
  await assert.rejects(done, /boom/);
  assert.equal(input.isRaw, false);
  assert.ok(output.written.endsWith('\x1b[?25h\x1b[?1049l'));
});

test('T0.3 Without a terminal it refuses', () => {
  const r = spawnSync(process.execPath, [CLI, 'tui', join(FIXTURES, 'dataflow')], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /cobolwork scan/);
});

test('T0.4 Every action is reachable from both keymaps', () => {
  for (const [name, map] of Object.entries(KEYMAPS)) {
    const bound = new Set(Object.values(map));
    for (const action of ACTIONS) assert.ok(bound.has(action), `${name} binds ${action}`);
  }
});

test('T0.5 Every panel fits 80×24', () => {
  let s = initialState({ report: bench });
  const seen = new Set();
  const check = (state) => {
    const l = lines(state);
    assert.equal(l.length, 24, `${panelOf(state)} has 24 lines`);
    for (const line of l) assert.ok(line.length <= 80, `${panelOf(state)}: ${line}`);
    assert.match(l[23], /^ F1=Help/, `${panelOf(state)} ends in the key legend`);
    seen.add(panelOf(state));
  };
  check(s);
  s = press(s, 'Enter').state; check(s);
  s = press(s, 'Enter').state; check(s);
  s = press(s, 'F1').state; check(s);
  assert.deepEqual([...seen].sort(), [...PANELS].sort());
});

test('T0.6 A terminal smaller than 80×24 is told so', () => {
  const text = screenText(view(initialState({ report: dataflow, cols: 60, rows: 20 })));
  assert.match(text, /80x24/);
  assert.match(text, /60x20/);
});

test('T0.7 Only the rows that changed are redrawn', () => {
  const a = createScreen(80, 24);
  const b = createScreen(80, 24);
  put(a, 5, 0, 'before');
  put(b, 5, 0, 'after');
  const out = redraw(a, b, { color: false });
  assert.ok(out.includes('\x1b[6;1H'), 'row 6 is written');
  assert.equal((out.match(/\x1b\[\d+;1H/g) || []).length, 1, 'and no other row');
});

test('T0.9 Text from a report cannot drive the terminal', () => {
  const hostile = '\x1b]52;c;aGk=\x07\x1b[2J\u202e\x9b31m';
  const f = rows(dataflow)[0].f;
  assert.ok(f.trace && f.trace.length, 'the engine finding has a trace to poison');
  const report = readReport({ ...dataflow, findings: [{
    ...f, rule: `${f.rule}${hostile}`, program: `${f.program}${hostile}`, path: `${hostile}/${f.path}`,
    detail: `${f.detail}${hostile}`, fingerprint: `${f.fingerprint}${hostile}`,
    related: [...(f.related || []), { path: `rel${hostile}`, line: 1, detail: hostile }],
    trace: f.trace.map((h) => ({ ...h, item: `${h.item}${hostile}`, via: `${h.via}${hostile}` })),
  }] });
  let s = initialState({ report });
  for (const keys of [[], ['Enter'], ['Enter']]) {
    s = press(s, ...keys).state;
    const screen = view(s);
    assert.ok(!screen.chars.flat().some((c) => /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(c)), `${panelOf(s)} holds a control character`);
    const out = redraw(null, screen);
    assert.ok(!/\x1b\]|\x07|\x9b|\u202e/.test(out), `${panelOf(s)} writes an escape it did not make`);
    assert.equal(out.split('\x1b[2J').length, 2, `${panelOf(s)} clears the screen once`);
  }
  assert.equal(panelOf(s), 'finding');
});

test('T1.1 Coverage is read before counts', () => {
  assert.equal(starved.summary.coverageIncomplete, true);
  const b = banner(starved);
  assert.equal(b.complete, false);
  for (const panel of ['home', 'findings']) {
    const state = panel === 'home' ? initialState({ report: starved }) : onFindings(starved);
    const l = lines(state);
    const bannerAt = l.findIndex((x) => /COVERAGE INCOMPLETE/.test(x));
    const countAt = l.findIndex((x) => /\bSev C \d/.test(x));
    assert.ok(bannerAt > 0 && countAt > bannerAt, `${panel}: banner above counts`);
    assert.ok(l.some((x) => /\bflow\b.*memory/.test(x)), `${panel}: the flow set and why`);
  }
});

test('T1.2 A complete report says it is complete', () => {
  assert.equal(dataflow.summary.coverageIncomplete, false);
  const b = banner(dataflow);
  assert.equal(b.complete, true);
  assert.match(b.lines[0], /complete/i);
  assert.ok(b.lines.some((l) => /^recon\b.*not run/.test(l)));
  assert.ok(b.lines.slice(1).every((l) => /not run/.test(l)));
});

test('T1.3 Findings are ordered by severity, and severity is a letter', () => {
  const r = rows(bench);
  const order = ['crit', 'high', 'med', 'low', 'info'];
  for (let i = 1; i < r.length; i++) {
    const [a, b] = [r[i - 1], r[i]];
    const d = order.indexOf(a.sev) - order.indexOf(b.sev);
    assert.ok(d < 0 || (d === 0 && a.rule <= b.rule), `${a.rule} before ${b.rule}`);
  }
  // A listed row: selection mark, severity letter, two spaces.
  const shown = lines(onFindings(bench)).filter((l) => /^ [ >] [A-Z] {2}/.test(l));
  assert.ok(shown.length > 5);
  for (const l of shown) assert.match(l[3], /[CHMLI]/);
  assert.deepEqual(Object.values(SEV_LETTER).sort(), ['C', 'H', 'I', 'L', 'M']);
});

test('T1.4 Enter opens a finding', () => {
  const s = press(onFindings(dataflow), 'Enter').state;
  assert.equal(panelOf(s), 'finding');
  const text = screenText(view(s));
  const f = rows(dataflow)[0].f;
  for (const want of [f.rule, 'crit', 'path', "program's owner", f.program, `${f.path}:${f.line}`, f.fingerprint]) {
    assert.ok(text.includes(want), `shows ${want}`);
  }
});

test('T1.5 A credited check shows what it lowered', () => {
  let s = onFindings(guards);
  const at = rows(guards).findIndex((r) => r.f.guard && r.f.guard.file === 'GUARDED.cbl');
  assert.ok(at >= 0, 'the guards fixture has a credited check');
  for (let i = 0; i < at; i++) s = press(s, 'Down').state;
  s = press(s, 'Enter').state;
  const text = screenText(view(s));
  assert.match(text, /lowered from crit/);
  assert.match(text, /GUARDED\.cbl:9/);
});

test('T1.6 F3 goes back one panel, and quits from Home', () => {
  let r = press(onFindings(dataflow), 'Enter');
  assert.equal(panelOf(r.state), 'finding');
  r = press(r.state, 'F3'); assert.equal(panelOf(r.state), 'findings');
  r = press(r.state, 'F3'); assert.equal(panelOf(r.state), 'home');
  r = press(r.state, 'F3');
  assert.ok(r.effects.some((e) => e.type === 'quit'));
});

test('T1.7 F1 is help for the panel, and F1 again lists its keys', () => {
  for (const keymap of ['ispf', 'modern']) {
    let s = press(onFindings(dataflow, keymap), 'F1').state;
    assert.equal(panelOf(s), 'help');
    assert.match(screenText(view(s)), /Findings/);
    s = press(s, 'F1').state;
    const text = screenText(view(s));
    assert.match(text, new RegExp(`${keymap} keys`, 'i'));
    for (const action of ACTIONS) assert.ok(text.includes(action), `${keymap} lists ${action}`);
  }
});

test('T1.8 SORT, FILTER and FIND change the list', () => {
  const s0 = onFindings(bench);
  const byRule = type(s0, 'SORT RULE').state;
  const r = rows(bench, byRule.view);
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].rule <= r[i].rule);
  assert.match(lines(byRule)[0], /sorted by rule/i);

  const tamper = type(s0, 'FILTER tampering').state;
  const t = rows(bench, tamper.view);
  assert.ok(t.length > 0 && t.every((x) => x.evidence === 'tampering'));
  assert.match(lines(tamper)[0], /tampering/);
  assert.equal(rows(bench, type(tamper, 'FILTER OFF').state.view).length, rows(bench).length);

  const found = type(s0, 'FIND WS-').state;
  const w = rows(bench, found.view);
  assert.ok(w.length > 0 && w.length < rows(bench).length);

  const reset = type(found, 'RESET').state;
  assert.equal(rows(bench, reset.view).length, rows(bench).length);
});

test('T1.9 An unknown command says so', () => {
  const s0 = onFindings(dataflow);
  const s = type(s0, 'FROB').state;
  assert.match(lines(s)[22], /FROB.*not recognised.*F1/);
  assert.deepEqual(s.view, s0.view);
  assert.equal(panelOf(s), 'findings');
});

test('T1.10 Paging keeps the selection on screen', () => {
  let s = onFindings(bench);
  assert.ok(rows(bench).length > 20, 'the bench holds more findings than a page');
  s = press(s, 'F8').state;
  assert.ok(s.sel > 0);
  const selected = rows(bench, s.view)[s.sel];
  const shown = lines(s).find((l) => l.startsWith(' >'));
  assert.ok(shown && shown.includes(selected.rule.slice(0, 20)), 'the selected row is drawn');
});

test('T1.11 A report that is not cobolwork\'s is refused', () => {
  assert.throws(() => readReport({ runs: [] }), /not a cobolwork findings report/);
  assert.throws(() => readReport({ tool: 'cobolwork', summary: {} }), /findings/);
  assert.throws(() => readReport(null), /not a cobolwork findings report/);
});

test('T1.12 A report whose findings are not findings is refused', () => {
  const doc = (findings, summary = {}) => ({ tool: 'cobolwork', summary, findings });
  assert.throws(() => readReport(doc([null])), /finding 1 is not an object/);
  assert.throws(() => readReport(doc([{ rule: 'r', path: 123 }])), /finding 1 has a path that is not text/);
  assert.throws(() => readReport(doc([{ rule: 'r' }, { rule: 'r', trace: 'MOVE' }])), /finding 2 has a trace that is not a list/);
  assert.throws(() => readReport(doc([{ rule: 'r', related: [null] }])), /finding 1 has a related that is not a list/);
  assert.throws(() => readReport(doc([{ rule: 'r', guardedFrom: 'high' }])), /names no check/);
  assert.throws(() => readReport(doc([], { setsIncomplete: [{ why: 'budget' }] })), /incomplete sets are not named/);
  const ok = readReport(doc([{ rule: 'r', path: 'a.cbl', trace: [], related: [] }], { setsIncomplete: [{ set: 'cics', why: 'no CSD' }] }));
  assert.equal(ok.findings.length, 1);
  assert.ok(readReport(dataflow) && readReport(bench), 'reports the engine writes pass');
});

test('T1.13 A command on an open finding keeps that finding open', () => {
  const n = rows(dataflow).length;
  const opened = press(type(onFindings(dataflow), 'BOTTOM').state, 'Enter').state;
  const f = opened.stack[opened.stack.length - 1].f;
  assert.equal(f, rows(dataflow)[n - 1].f);
  assert.ok(screenText(view(opened)).includes(`${n} of ${n}`));
  for (const [cmd, where] of [['SORT RULE', / of \d+/], ['FIND ZZZ-NOT-THERE', /not in this view of 0/], ['FILTER coverage', /not in this view of \d+/], ['RESET', new RegExp(`${n} of ${n}`)]]) {
    const s = type(opened, cmd).state;
    assert.equal(panelOf(s), 'finding', cmd);
    assert.equal(s.stack[s.stack.length - 1].f, f, cmd);
    const text = screenText(view(s));
    assert.ok(text.includes(`${f.path}:${f.line}`), `${cmd} still shows the finding opened`);
    assert.match(text, where, cmd);
  }
  const back = press(type(opened, 'FIND ZZZ-NOT-THERE').state, 'F3').state;
  assert.equal(panelOf(back), 'findings');
  assert.match(screenText(view(back)), /No rows/);
});

test('T0.10 Ctrl-C quits and restores the terminal', async () => {
  const { input, output } = fakeStreams();
  const terminal = nodeTerminal({ input, output });
  const done = runTui({ report: dataflow, terminal });
  input.write('\r');
  input.write('\x03');
  await done;
  assert.equal(input.isRaw, false);
  assert.ok(output.written.endsWith('\x1b[?25h\x1b[?1049l'), 'cursor shown, alternate screen left');
});

test('T1.14 A report with no findings says so rather than opening nothing', () => {
  const empty = mkdtempSync(join(tmpdir(), 'cw-tui-empty-'));
  try {
    const report = readReport(scanAll(empty));
    assert.equal(report.findings.length, 0);
    const home = initialState({ report });
    assert.match(screenText(view(home)), /nothing was read/);
    const list = press(home, 'Enter').state;
    assert.equal(panelOf(list), 'findings');
    assert.match(screenText(view(list)), /No rows/);
    const tried = press(list, 'Enter').state;
    assert.equal(panelOf(tried), 'findings');
    assert.match(screenText(view(tried)), /no finding to open/);
  } finally { rmSync(empty, { recursive: true, force: true }); }
});

test('T1.15 KEYS switches the keymap and its legend', () => {
  const legendOf = (s) => lines(s)[23].trimEnd();
  const s0 = onFindings(bench);
  assert.equal(legendOf(s0), LEGEND.ispf.slice(0, 80).trimEnd());
  const modern = type(s0, 'KEYS MODERN').state;
  assert.equal(modern.keymap, 'modern');
  assert.equal(legendOf(modern), LEGEND.modern.slice(0, 80).trimEnd());
  assert.equal(press(modern, 'char:j').state.sel, modern.sel + 1);
  const back = type(press(modern, 'char::').state, 'KEYS ISPF').state;
  assert.equal(back.keymap, 'ispf');
  assert.equal(legendOf(back), LEGEND.ispf.slice(0, 80).trimEnd());
  const bad = type(s0, 'KEYS EMACS').state;
  assert.equal(bad.keymap, 'ispf');
  assert.match(screenText(view(bad)), /KEYS takes ispf or modern/);
});

test('T1.16 FINDINGS returns to the list rather than stacking another', () => {
  const list = press(onFindings(bench), 'Down', 'Down').state;
  for (const via of [['Enter'], ['Enter', 'F1']]) {
    const deep = press(list, ...via).state;
    for (const cmd of ['1', 'FINDINGS']) {
      const s = type(deep, cmd).state;
      assert.deepEqual(s.stack.map((t) => t.panel), ['home', 'findings'], `${via.join('+')} then ${cmd}`);
      assert.equal(s.sel, 2);
      assert.equal(panelOf(press(s, 'F3').state), 'home');
    }
  }
  assert.deepEqual(type(initialState({ report: bench }), '1').state.stack.map((t) => t.panel), ['home', 'findings']);
});

test('T1.17 A path finding says whether an attacker can use it', () => {
  const site = join(mkdtempSync(join(tmpdir(), 'cw-tui-site-')), 'cobolwork.site.json');
  writeFileSync(site, JSON.stringify({ openTransactions: ['INQ1'] }));
  setMemoryReaders({ heap: () => ({ used_heap_size: 64 * MB, heap_size_limit: 4096 * MB }), free: () => 4096 * MB });
  let report;
  try { report = readReport(scanAll(join(FIXTURES, 'entry'), { only: ['flow'], site })); } finally { setMemoryReaders(); }
  const text = (state) => lines(state).join('\n');

  const home = initialState({ report });
  assert.match(text(home), /Exploit\s+exploitable 1/);

  const findings = onFindings(report);
  const filtered = type(findings, 'FILTER exploitable').state;
  assert.match(text(filtered), /exploit exploitable/);
  assert.match(text(filtered), /Row 1 of 1/);
  const opened = press(filtered, 'Enter').state;
  assert.match(text(opened), /Exploit\s+exploitable, driven by a terminal user/);
  const whole = `${text(opened)}\n${text(press(opened, 'F8').state)}`;
  assert.match(whole, /Because\s+- A terminal user supplies it/);
  assert.match(whole, /Unknown\s+whether it reproduces/);
  assert.match(whole, /Fix at\s+before the operation at INQUIRY\.cbl:13/);

  const sorted = type(findings, 'SORT EXPLOIT').state;
  assert.match(text(press(sorted, 'Enter').state), /Exploit\s+exploitable,/, 'the exploitable finding sorts first');
  const both = type(findings, 'FILTER path attacker-driven').state;
  assert.ok(rows(report, both.view).every((r) => r.f.evidence === 'path' && r.f.exploitability.verdict === 'attacker-driven'));
  assert.match(type(findings, 'FILTER nonsense').state.message, /FILTER takes an evidence kind or an exploitability verdict/);
});
