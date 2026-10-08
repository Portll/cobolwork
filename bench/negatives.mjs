// SPDX-License-Identifier: AGPL-3.0-or-later
// Programs whose answer is known by construction, for every path rule a source and a sink template
// cover: guards that make the sink safe (negatives) and near-misses of them that do not
// (positives), each inline and deeper in the program (docs/spec/reach.md §9.6). cobolwork scans
// each one, so an item also says whether the analyser itself gets it right: a negative it reports
// is a false alarm of its own, which is what a model reviewing its findings has to catch.
//
// --prompts writes each item as a question for bench/label-models.mjs --items: the rule, the source
// and the sink, and every line of the program, asked as a finding of the corpus is asked.
//
//   node bench/negatives.mjs [--out <dir>] [--json <file> [--with-files]] [--prompts <file>]
//        [--rule <id>]
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanAll } from '../lib/scan.mjs';
import { RULES } from '../lib/sets/flow.mjs';
import { capped, excerpt, QUESTION } from './label-models.mjs';

const ALLOWED = ["'CWPGM1'", "'CWPGM2'"];

// Where the input comes from: what the program declares, the statements that fill WS-IN, which of
// them reads the input (`at`, the first by default) and how cobolwork names it.
const SOURCES = {
  'argv-or-env': { detail: 'ACCEPT ... FROM COMMAND-LINE', stmt: () => ['ACCEPT WS-IN FROM COMMAND-LINE'] },
  'cics-terminal': { detail: 'EXEC CICS RECEIVE', stmt: () => ['EXEC CICS RECEIVE INTO(WS-IN) LENGTH(WS-LEN)', '     END-EXEC'] },
  'cics-web': { detail: 'EXEC CICS WEB RECEIVE', stmt: () => ['EXEC CICS WEB RECEIVE INTO(WS-IN) LENGTH(WS-LEN)', '     END-EXEC'] },
  'cics-queue': { detail: 'EXEC CICS READQ TS INTO', stmt: () => ["EXEC CICS READQ TS QUEUE('CWQ1') INTO(WS-IN)", '     LENGTH(WS-LEN) END-EXEC'] },
  database: { detail: 'EXEC SQL SELECT INTO host variable', stmt: () => ['EXEC SQL SELECT NAME INTO :WS-IN FROM CWT1', '     WHERE ID = 1 END-EXEC'] },
  'file-record': {
    detail: 'READ ... INTO',
    at: 1,
    env: ['       INPUT-OUTPUT SECTION.', '       FILE-CONTROL.', '           SELECT IN-FILE ASSIGN TO INDD.'],
    files: ['       FILE SECTION.', '       FD  IN-FILE.', '       01  IN-REC PIC X(80).'],
    stmt: () => ['OPEN INPUT IN-FILE', 'READ IN-FILE INTO WS-IN', 'CLOSE IN-FILE'],
  },
};

// What a sink does with a field, and the items it needs. `kind` groups sinks by what makes them
// safe: `set` (a value that can only be one of a list), `bound` (an index kept in range), `digits`
// (a value that is only digits), `none` (no guard the analyser credits).
const SINKS = {
  'os-command': { kind: 'set', use: (f) => [`CALL 'SYSTEM' USING ${f}`] },
  'dynamic-sql': { kind: 'set', use: (f) => [`EXEC SQL EXECUTE IMMEDIATE :${f} END-EXEC`] },
  'cics-dynamic-transfer': { kind: 'set', use: (f) => [`EXEC CICS LINK PROGRAM(${f}) END-EXEC`] },
  'dynamic-program-load': { kind: 'set', use: (f) => [`CALL ${f}`] },
  'queue-name': { kind: 'set', use: (f) => [`EXEC CICS WRITEQ TS QUEUE(${f}) FROM(WS-DATA)`, '     END-EXEC'] },
  'outbound-host': { kind: 'set', use: (f) => [`EXEC CICS WEB OPEN HOST(${f}) HOSTLENGTH(WS-LEN)`, '     SESSTOKEN(WS-TOKEN) END-EXEC'] },
  'cics-sysid': { kind: 'set', use: (f) => [`EXEC CICS LINK PROGRAM('CWPGM2') SYSID(${f})`, '     END-EXEC'] },
  'connection-target': { kind: 'set', use: (f) => [`EXEC SQL CONNECT TO :${f} END-EXEC`] },
  'web-response': { kind: 'set', use: (f) => [`EXEC CICS WEB SEND FROM(${f}) FROMLENGTH(WS-LEN)`, '     MEDIATYPE(WS-MEDIA) END-EXEC'] },
  log: { kind: 'set', use: (f) => [`DISPLAY ${f}`] },
  // Its branches name the allowed values, so a value an allow-list lets through has a branch to run.
  'unhandled-selector': { kind: 'set', use: (f) => [`EVALUATE ${f}`, ...ALLOWED.map((v) => `   WHEN ${v}`), '      CONTINUE', 'END-EVALUATE'] },
  arithmetic: { kind: 'digits', numeric: true, use: (f) => [`COMPUTE WS-RESULT = ${f} + 1`] },
  subscript: { kind: 'bound', numeric: true, use: (f) => [`DISPLAY WS-ROW(${f})`] },
  'reference-modification': { kind: 'bound', numeric: true, use: (f) => [`DISPLAY WS-TEXT(${f}:1)`] },
  'loop-bound': { kind: 'bound', numeric: true, use: (f) => ['PERFORM VARYING WS-I FROM 1 BY 1', `   UNTIL WS-I > ${f}`, '   DISPLAY WS-ROW(WS-I)', 'END-PERFORM'] },
  'storage-length': { kind: 'bound', numeric: true, use: (f) => [`EXEC CICS GETMAIN SET(WS-PTR) FLENGTH(${f})`, '     END-EXEC'] },
  'numeric-truncation': { kind: 'none', numeric: true, use: (f) => [`MOVE ${f} TO WS-SMALL`] },
  'text-truncation': { kind: 'none', use: (f) => [`STRING ${f} DELIMITED BY SIZE`, '   INTO WS-SHORT', 'END-STRING'] },
};

// A guard placed before the sink, and whether the sink is then safe: `truth` is the answer by
// construction. `fits` says which sinks the guard means something for.
const GUARDS = {
  // Negatives: the value cannot reach the sink in a form that makes it unsafe.
  'allow-list': { truth: 'does-not-reach', fits: (s) => s.kind === 'set', code: (f) => [`EVALUATE ${f}`, ...ALLOWED.map((v) => `   WHEN ${v}`), '      CONTINUE', '   WHEN OTHER', '      GOBACK', 'END-EVALUATE'] },
  'must-equal': { truth: 'does-not-reach', fits: (s) => s.kind === 'set', code: (f) => [`IF ${f} NOT = ${ALLOWED[0]}`, '   GOBACK', 'END-IF'] },
  'condition-name': { truth: 'does-not-reach', fits: (s) => s.kind === 'set', code: (f) => [`MOVE ${f} TO WS-CHOICE`, 'IF NOT WS-CHOICE-OK', '   GOBACK', 'END-IF'] },
  'numeric-test': { truth: 'does-not-reach', fits: (s) => s.kind === 'digits', code: (f) => [`IF ${f} IS NOT NUMERIC`, '   GOBACK', 'END-IF'] },
  'both-bounds': { truth: 'does-not-reach', fits: (s) => s.kind === 'bound', code: (f) => [`IF ${f} < 1 OR ${f} > 10`, '   GOBACK', 'END-IF'] },
  'upper-bound-fits': { truth: 'does-not-reach', fits: (s) => s.kind === 'none' && s.numeric, code: (f) => [`IF ${f} > 99`, '   GOBACK', 'END-IF'] },
  overwritten: { truth: 'does-not-reach', fits: () => true, code: (f, s) => [`MOVE ${s.numeric ? '1' : ALLOWED[0]} TO ${f}`] },
  'checked-by-flag': { truth: 'does-not-reach', fits: (s) => s.kind === 'set', code: (f) => ["MOVE 'N' TO WS-BAD", `EVALUATE ${f}`, ...ALLOWED.map((v) => `   WHEN ${v}`), '      CONTINUE', '   WHEN OTHER', "      MOVE 'Y' TO WS-BAD", 'END-EVALUATE', "IF WS-BAD = 'Y'", '   GOBACK', 'END-IF'] },
  'table-search': { truth: 'does-not-reach', fits: (s) => s.kind === 'set', code: (f) => ['SET WS-AX TO 1', 'SEARCH WS-ALLOWED', '   AT END', '      GOBACK', `   WHEN WS-ALLOWED-NAME(WS-AX) = ${f}`, '      CONTINUE', 'END-SEARCH'] },
  // Positives: a near-miss of a guard, which leaves the sink unsafe.
  none: { truth: 'reaches', fits: () => true, code: () => [] },
  'otherwise-continues': { truth: 'reaches', fits: (s) => s.kind === 'set', code: (f) => [`EVALUATE ${f}`, ...ALLOWED.map((v) => `   WHEN ${v}`), "      MOVE 'K' TO WS-NOTE", '   WHEN OTHER', '      CONTINUE', 'END-EVALUATE'] },
  'guards-another-field': { truth: 'reaches', fits: (s) => s.kind !== 'none', code: (f, s) => (s.kind === 'set' ? [`IF WS-OTHER NOT = ${ALLOWED[0]}`, '   GOBACK', 'END-IF'] : ['IF WS-COUNT < 1 OR WS-COUNT > 10', '   GOBACK', 'END-IF']) },
  // A count or a length needs only its top kept; a subscript or a start needs both ends.
  'upper-bound-only': { truth: 'reaches', truthFor: { 'loop-bound': 'does-not-reach', 'storage-length': 'does-not-reach' }, fits: (s) => s.kind === 'bound', code: (f) => [`IF ${f} > 10`, '   GOBACK', 'END-IF'] },
  // One past the ten-row table; for a length of storage, eleven bytes are as harmless as ten.
  'bound-off-by-one': { truth: 'reaches', truthFor: { 'storage-length': 'does-not-reach' }, fits: (s) => s.kind === 'bound', code: (f) => [`IF ${f} < 1 OR ${f} > 11`, '   GOBACK', 'END-IF'] },
};

// Where the guard and the sink sit: beside the source, in a paragraph PERFORMed later, after the
// value has moved through two other fields, or in a subprogram the input is passed to.
const PLACEMENTS = ['inline', 'paragraph', 'hops', 'subprogram'];

const AREA_B = '           ';
const line = (s) => `${AREA_B}${s}`;

function data(numeric) {
  const pic = numeric ? 'PIC 9(4)' : 'PIC X(8)';
  return [
    `       01  WS-IN ${pic}.`, `       01  WS-A ${pic}.`, `       01  WS-B ${pic}.`,
    `       01  WS-OTHER ${pic} VALUE ${numeric ? '1' : "'CWPGM1'"}.`,
    '       01  WS-COUNT PIC 9(4) VALUE 1.',
    '       01  WS-LEN PIC S9(8) COMP VALUE 8.',
    '       01  WS-DATA PIC X(8) VALUE SPACES.', '       01  WS-TOKEN PIC X(8).', '       01  WS-MEDIA PIC X(56) VALUE SPACES.',
    '       01  WS-RESULT PIC 9(5).', '       01  WS-SMALL PIC 9(2).', '       01  WS-SHORT PIC X(4).', '       01  WS-NOTE PIC X.',
    "       01  WS-BAD PIC X VALUE 'N'.", '       01  WS-PTR USAGE POINTER.', '       01  WS-I PIC 9(4).',
    '       01  WS-TABLE.', '           05  WS-ROW PIC X(4) OCCURS 10.', '       01  WS-TEXT PIC X(10) VALUE SPACES.',
    '       01  WS-CHOICE PIC X(8).', ...ALLOWED.map((v, k) => (k ? `               ${v}` : `           88  WS-CHOICE-OK VALUES ${v}`)),
    '       01  WS-ALLOWED-LIST.', ...ALLOWED.map((v) => `           05  FILLER PIC X(8) VALUE ${v}.`),
    '       01  WS-ALLOWED-TABLE REDEFINES WS-ALLOWED-LIST.', `           05  WS-ALLOWED OCCURS ${ALLOWED.length} INDEXED BY WS-AX.`, '               10  WS-ALLOWED-NAME PIC X(8).',
  ];
}

// The 88-level's values end with a period on their last line.
const fixEighty8 = (lines) => {
  const at = lines.findIndex((l) => l.includes('88  WS-CHOICE-OK'));
  if (at >= 0) lines[at + ALLOWED.length - 1] += '.';
  return lines;
};

// An item's program files, the main program first, and where its source and its sink are. Every
// main program is CWMAIN, so what a model is shown depends only on what the item is made of.
function program({ srcKind, sinkName, guardName, placement }) {
  const src = SOURCES[srcKind];
  const sink = SINKS[sinkName];
  const guard = GUARDS[guardName];
  const numeric = !!sink.numeric;
  const field = placement === 'hops' ? 'WS-B' : 'WS-IN';
  const checks = guard.code(field, sink);
  const main = ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. CWMAIN.', '       ENVIRONMENT DIVISION.', ...(src.env || []), '       DATA DIVISION.', ...(src.files || []),
    '       WORKING-STORAGE SECTION.', ...fixEighty8(data(numeric)), '       PROCEDURE DIVISION.', '       MAIN-PARA.'];
  const source = { file: 'CWMAIN.cbl', line: main.length + (src.at || 0) + 1, text: src.detail };
  main.push(...src.stmt().map(line));
  let sinkLine;
  const use = (lines) => { sinkLine = lines.length + checks.length + 1; lines.push(...[...checks, ...sink.use(field)].map(line)); };
  const files = { 'CWMAIN.cbl': null };
  if (placement === 'inline') { use(main); main.push(line('GOBACK.')); }
  else if (placement === 'paragraph') { main.push(line('PERFORM USE-PARA'), line('GOBACK.'), '       USE-PARA.'); use(main); main.push(line('EXIT.')); }
  else if (placement === 'hops') { main.push(line('MOVE WS-IN TO WS-A'), line('MOVE WS-A TO WS-B')); use(main); main.push(line('GOBACK.')); }
  else {
    main.push(line("CALL 'CWSUB' USING WS-IN"), line('GOBACK.'));
    const sub = ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. CWSUB.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
      ...fixEighty8(data(numeric)).filter((l) => !/WS-IN /.test(l)), '       LINKAGE SECTION.', `       01  WS-IN ${numeric ? 'PIC 9(4)' : 'PIC X(8)'}.`,
      '       PROCEDURE DIVISION USING WS-IN.'];
    use(sub);
    sub.push(line('GOBACK.'));
    files['CWSUB.cbl'] = `${sub.join('\n')}\n`;
  }
  files['CWMAIN.cbl'] = `${main.join('\n')}\n`;
  return { files, at: { source, sink: { file: placement === 'subprogram' ? 'CWSUB.cbl' : 'CWMAIN.cbl', line: sinkLine } } };
}

// Every item the templates make for the path rules they cover, each with its answer.
export function items({ rule = null } = {}) {
  const out = [];
  for (const [srcKind] of Object.entries(SOURCES)) {
    for (const [sinkName, sink] of Object.entries(SINKS)) {
      const r = `${srcKind}-to-${sinkName}`;
      if (!RULES[r] || RULES[r].evidence !== 'path' || (rule && r !== rule)) continue;
      let deep = 0;
      for (const [guardName, guard] of Object.entries(GUARDS)) {
        if (!guard.fits(sink)) continue;
        // Each guard inline, and in one deeper placement, taken in turn across the guards.
        for (const placement of ['inline', PLACEMENTS[1 + (deep++ % 3)]]) {
          const id = `CW${String(out.length + 1).padStart(4, '0')}`;
          out.push({ id, rule: r, source: srcKind, sink: sinkName, guard: guardName, placement, truth: guard.truthFor?.[sinkName] || guard.truth, ...program({ srcKind, sinkName, guardName, placement }) });
        }
      }
    }
  }
  return out;
}

// An item asked as a finding of the corpus is asked (bench/label-models.mjs): the rule, the source,
// the sink and, since a program here is short, every line of each file.
export function questionFor(item) {
  const r = RULES[item.rule];
  const { source, sink } = item.at;
  const code = Object.entries(item.files).map(([name, text]) => {
    const n = text.replace(/\n$/, '').split('\n').length;
    return `\nCode of ${name}:\n${excerpt(text, Array.from({ length: n }, (_, k) => k + 1), 0)}\n`;
  });
  return `${capped([`Rule: ${item.rule}: ${r.text}${r.cwe ? ` (${r.cwe})` : ''}.\n`, `Source: ${source.file}:${source.line}: ${source.text}\n`, `Sink: ${sink.file}:${sink.line}\n`, ...code])}\n${QUESTION}`;
}

// The question line for --prompts: keyed by what the item is made of, so it keeps its key when
// templates are added.
export const questionLine = (it) => ({ set: 'generated', item: `${it.rule}/${it.guard}/${it.placement}`, rule: it.rule, truth: it.truth,
  meta: { id: it.id, source: it.source, sink: it.sink, guard: it.guard, placement: it.placement, engine: it.engine }, prompt: questionFor(it) });

// What cobolwork reports for an item: whether its rule fires, and with a guard that stops it.
export function engineVerdict(item) {
  const dir = mkdtempSync(join(tmpdir(), 'cobolwork-negatives-'));
  try {
    for (const [name, text] of Object.entries(item.files)) writeFileSync(join(dir, name), text);
    const r = scanAll(dir, { only: ['flow'] });
    const reported = r.findings.filter((f) => f.rule === item.rule);
    const stopped = (r.checked || []).filter((c) => c.rule === item.rule);
    return reported.length ? (reported.some((f) => f.guard) ? 'reported-lowered' : 'reported') : stopped.length ? 'checked' : 'silent';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--with-files') opts.withFiles = true;
    else if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = argv[++i];
  }
  const made = items({ rule: opts.rule || null });
  for (const it of made) it.engine = engineVerdict(it);
  // A rule whose unguarded program cobolwork does not report has a template that does not make the
  // flow it names: its items say nothing, and are left out and named.
  const broken = new Set(made.filter((it) => it.guard === 'none' && it.placement === 'inline' && !it.engine.startsWith('reported')).map((it) => it.rule));
  const all = made.filter((it) => !broken.has(it.rule));
  if (opts.out) for (const it of all) { const d = join(opts.out, it.id); mkdirSync(d, { recursive: true }); for (const [n, t] of Object.entries(it.files)) writeFileSync(join(d, n), t); }
  const summary = { items: all.length, rules: new Set(all.map((i) => i.rule)).size, leftOut: [...broken].sort(), byTruth: {}, engine: {} };
  for (const it of all) {
    summary.byTruth[it.truth] = (summary.byTruth[it.truth] || 0) + 1;
    const k = `${it.truth} -> ${it.engine}`;
    summary.engine[k] = (summary.engine[k] || 0) + 1;
  }
  if (opts.prompts) writeFileSync(opts.prompts, all.map((it) => `${JSON.stringify(questionLine(it))}\n`).join(''));
  if (opts.json) writeFileSync(opts.json, `${JSON.stringify(opts.withFiles ? all : all.map(({ files, ...rest }) => rest), null, 1)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 1)}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
