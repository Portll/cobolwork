// SPDX-License-Identifier: AGPL-3.0-or-later
// Execution labels: each path finding's verification plan run in ironwork. The marker goes in at
// the finding's source, ironwork runs the program with --trace-marker, and the finding is confirmed
// where the run's journal records the marker in the operand of the operation the finding names.
// Anything else is unknown, never refuted: a run that did not carry the marker there shows only
// that these inputs did not (docs/spec/reach.md §9.6; refuting needs coverage of every route).
//
//   node bench/label.mjs <repository | corpus-root> [--corpus] [--ironwork path] [--out file]
//                        [--evidence dir] [--timeout ms] [--trace-input]
//
// With --trace-input each run also follows input by taint, and an unknown label whose operation
// ran says what taint found there in `inputAtSink`. No label is refuted on it (reach.md §9.8).
//
// ironwork only reads the repository: data sets and the journal go to temporary directories, and
// the journals stay in --evidence (or a new temporary directory, named in the output), where
// `cobolwork evidence verify` checks them. No operation a finding names runs: ironwork runs no
// operating-system command, and a program named by the marker does not exist.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseBms } from '../lib/bms.mjs';
import { kindsOf } from '../lib/consequence.mjs';
import { stampFingerprints } from '../lib/kernel/identity.mjs';
import { stoppedBecause } from '../lib/kernel/memory.mjs';
import { directoryTree } from '../lib/kernel/source-tree.mjs';
import { buildFileIndex, parseFile } from '../lib/parser.mjs';
import { scan as scanFlow } from '../lib/sets/flow.mjs';
import { isAssembler, isProgram, readSource } from '../lib/sources.mjs';
import { MARKER } from '../lib/verify.mjs';
import { RUN_ENDINGS } from '../lib/ironwork-ids.mjs';
import { inStreamJob, labelByJob } from './label-job.mjs';

// The journal's sink names that show a finding's sink kind, as ironwork docs/evidence.md §1.1
// records them. A TD queue's data is `log` to ironwork whatever the CSD makes of the queue.
export const TRACED = {
  'dynamic-program-load': ['dynamic-program-load'],
  'os-command': ['os-command'],
  log: ['log'],
  'extrapartition-queue': ['log'],
  'internal-reader': ['log'],
  'cics-dynamic-transfer': ['cics-dynamic-transfer'],
  'queue-name': ['queue-name'],
  'record-key': ['record-key', 'record-update'],
  'record-update': ['record-key', 'record-update'],
  screen: ['screen'],
  'web-response': ['web-response'],
  'http-header': ['http-header'],
  'outbound-host': ['outbound-host'],
  'outbound-http': ['outbound-http'],
  'cics-sysid': ['cics-sysid'],
  'dynamic-file-path': ['dynamic-file-path'],
};

// Whether a file-named-at-run-time finding is a SELECT whose ASSIGN names a data item, Micro Focus's
// and GnuCOBOL's form, which ironwork runs and traces only under --compliance extended. The other
// form, an EXEC CICS FILE or DATASET option, ironwork does not trace.
function assignsFromItem(f, root) {
  try { return /^\s*SELECT\b/i.test(statementAt(resolve(root, f.path), f.line)); } catch { return false; }
}

// Sinks whose witness is how the run ends rather than a marker, with the input that provokes it
// and a control that should not. A byte whose low half is not a digit ends zoned arithmetic with a
// data exception (S0C7, ASRA in a CICS task), which the marker cannot: each of its letters reads as
// a digit. Nines put a subscript, start, length or count past the table or field, which under
// SSRANGE ends the run with U4038, transaction abend 4038 in a CICS task; ones keep it inside most.
const BEYOND = { codes: ['U4038', '4038'], value: '9', named: 'nines', control: '1', controlNamed: 'ones', ssrange: true };
export const ABENDS = {
  arithmetic: { codes: ['S0C7', 'ASRA'], value: '*', named: 'asterisks', control: '0', controlNamed: 'digits' },
  subscript: BEYOND,
  'reference-modification': BEYOND,
  'occurs-depending-count': BEYOND,
  'loop-bound': BEYOND,
};

const RECORD = 1024;
const RECORDS = 3;

// A record of the marker repeated, starting `shift` bytes into it: across the eight shifts, every
// field of eight bytes or more holds the whole marker in one of them.
export const shifted = (shift) => (MARKER.repeat(Math.ceil(RECORD / MARKER.length) + 1)).slice(shift, shift + RECORD);

// The DD names a SELECT's ASSIGN can mean: as written, which is how ironwork looked it up before it
// read IBM's label prefix, and the name after IBM's label and organization (UT-S-, DA-, AS-),
// which documents the device and is not part of the DD name.
function ddNames(assign) {
  if (!assign?.v || assign.t !== 'word' && assign.t !== 'string') return [];
  const name = String(assign.v).toUpperCase();
  const bare = name.slice(name.lastIndexOf('-') + 1);
  return [...new Set([name, bare])].filter((n) => /^[A-Z0-9@#$-]{1,44}$/.test(n) && (n === name || /^[A-Z@#$][A-Z0-9@#$]{0,7}$/.test(n)));
}

// The inputs to try: the marker at each of the eight shifts, or the input an abend's witness needs.
const fills = (byAbend) => (byAbend ? [{ name: byAbend.named, text: (n) => byAbend.value.repeat(n) }]
  : [...Array(MARKER.length).keys()].map((shift) => ({ name: `shifted ${shift}`, text: (n) => shifted(shift).slice(0, n) })));
const controlOf = (byAbend) => byAbend?.control ?? '0';

// Sources a program reads through a DD: a file's records, and a job's in-stream data, which reaches
// the program as the records of the DD it is written on.
const FED_BY_DD = new Set(['file-record', 'jcl-instream']);

// Each DD name the programs assign, with its file's name, fixed record length, whether it is
// indexed or relative, and where the record key sits in the record.
export function fileShapes(programs) {
  const shapes = new Map();
  for (const p of programs) {
    for (const f of p.files || []) {
      const fd = (p.fds || []).find((d) => d.name === f.name);
      const words = (f.envRefs || []).map((t) => t.u);
      const keyed = words.includes('INDEXED') || words.includes('RELATIVE');
      const at = words.findIndex((w, i) => w === 'KEY' && words[i - 1] === 'RECORD');
      const keyName = at >= 0 ? words[at + (words[at + 1] === 'IS' ? 2 : 1)] : null;
      const key = keyName ? p.items.find((it) => it.name === keyName && it.offset != null && it.size) : null;
      const recordOf = key ? (it) => { let top = it; while (top.parent) top = top.parent; return top; } : null;
      const shape = {
        file: f.name,
        length: fd?.fixedLength || (keyed ? fd?.size : null) || null,
        keyed,
        relative: words.includes('RELATIVE'),
        key: key ? { offset: key.offset - (recordOf(key).offset || 0), size: key.size } : null,
      };
      for (const dd of ddNames(f.assign)) if (!shapes.has(dd)) shapes.set(dd, shape);
    }
  }
  return shapes;
}

// Every DD the program assigns, and SYSIN, holding each fill. A DD's records are as long as its
// file's fixed record: a longer line is a length conflict (FILE STATUS 04), which a program that
// checks its status takes as a fatal error before it reaches anything it does with the record.
// An indexed or relative file is empty unless it is the finding's source, whose records then have
// distinct ascending keys at the record key, as a REPRO unload holds them (operator 2026-10-07).
function fileRecordVariants(program, byAbend, { copyDirs = [], sourceFile = null } = {}) {
  const programs = parseFile(program, { includeDirs: copyDirs }).programs;
  const shapes = new Map([...fileShapes(programs)].map(([dd, s]) => [dd, { ...s, source: sourceFile === s.file }]));
  const unplaced = [...shapes.values()].find((x) => x.keyed && x.source && !x.key);
  if (unplaced) return { why: 'the finding\'s source is an indexed file whose record key the labeller cannot place' };
  const dds = [...new Set([...programs.flatMap((p) => p.files || []).flatMap((x) => ddNames(x.assign)), 'SYSIN'])];
  const recordsFor = (shape, record) => {
    const length = shape?.length || RECORD;
    if (shape?.keyed && !shape.source) return [];
    if (!shape?.keyed) return Array(RECORDS).fill(record(length));
    return Array.from({ length: RECORDS }, (_, n) => {
      const text = record(length).padEnd(length, ' ');
      const key = String(n + 1).padStart(shape.key.size, '0').slice(-shape.key.size);
      return text.slice(0, shape.key.offset) + key + text.slice(shape.key.offset + shape.key.size);
    });
  };
  const holding = (record) => (dir) => ['run', program, ...dds.flatMap((dd) => {
    const path = join(dir, dd);
    const lines = recordsFor(shapes.get(dd), record);
    writeFileSync(path, lines.length ? `${lines.join('\n')}\n` : '');
    return ['--dd', `${dd}=${path}:text`];
  })];
  const control = { name: 'records of the control', args: holding((n) => controlOf(byAbend).repeat(n)) };
  return fills(byAbend).map((fill) => ({ name: `records ${fill.name}`, args: holding(fill.text), control }));
}

// GnuCOBOL's command-line and environment statements, which Enterprise COBOL does not have and
// ironwork refuses or reads as SYSIN: an ACCEPT from COMMAND-LINE, ARGUMENT-VALUE, ENVIRONMENT-VALUE,
// ENVIRONMENT and a name, or ARGUMENT-NUMBER, and a DISPLAY UPON one of their names.
const ARGV_ACCEPT = /\bACCEPT([ \t]+)([A-Z0-9][A-Z0-9_-]*(?:\([^)\n]*\))?)[ \t]+FROM[ \t]+(COMMAND-LINE|ARGUMENT-VALUE|ARGUMENT-NUMBER|ENVIRONMENT-VALUE|ENVIRONMENT(?:[ \t]+(?:'[^'\n]*'|"[^"\n]*"|[A-Z0-9][A-Z0-9_-]*))?)(?![A-Z0-9_-])(?:[ \t]+END-ACCEPT(?![A-Z0-9_-]))?/gi;
const ARGV_UPON = /\bUPON[ \t]+(?:ENVIRONMENT-NAME|ENVIRONMENT-VALUE|ARGUMENT-NUMBER|COMMAND-LINE)(?![A-Z0-9_-])/gi;
const ACCEPT_GOES_ON = /^\s*(?:(?:NOT\s+)?(?:ON\s+)?EXCEPTION|END-ACCEPT)(?![A-Z0-9_-])/i;

// The program's text with each command-line or environment ACCEPT, and an END-ACCEPT on its line,
// made a MOVE of ALL `fill` to its receiver, an argument count made 1, and each DISPLAY UPON their
// names made a DISPLAY to SYSOUT, every statement padded to the columns it held; or why it cannot be.
// `fill` is at most eight characters.
export function argvRewritten(text, fill) {
  if (!/\bACCEPT\b/i.test(text)) return { why: 'the program has no ACCEPT' };
  let found = 0;
  let why = null;
  const out = text.replace(ARGV_ACCEPT, (span, gap, receiver, from, at, whole) => {
    found++;
    if (/^ENVIRONMENT$/i.test(from)) why ??= 'an ACCEPT FROM ENVIRONMENT names its variable on another line';
    if (ACCEPT_GOES_ON.test(whole.slice(at + span.length))) why ??= 'an ACCEPT of the command line or environment goes on past its line, with an EXCEPTION phrase or END-ACCEPT, which a MOVE does not take';
    const move = /^ARGUMENT-NUMBER$/i.test(from) ? `MOVE 1 TO ${receiver}` : `MOVE ALL '${fill}' TO ${receiver}`;
    return move.padEnd(span.length);
  }).replace(ARGV_UPON, (span) => ' '.repeat(span.length));
  if (why) return { why };
  if (!found) return { why: 'no ACCEPT of the command line or environment was found to rewrite' };
  return { text: out };
}

// The finding's command-line or environment input as the marker at each of the eight rotations, or
// the input an abend's witness needs, moved into every receiver of a rewritten ACCEPT in a staged
// copy; every DD the program assigns and SYSIN hold the control, so no other input carries it.
function argvVariants(program, byAbend) {
  const text = readSource(program).text;
  const probe = argvRewritten(text, controlOf(byAbend));
  if (probe.why) return { why: probe.why };
  const files = parseFile(program).programs.flatMap((p) => p.files || []);
  const dds = [...new Set([...files.flatMap((x) => ddNames(x.assign)), 'SYSIN'])];
  const holding = (fill) => {
    const rewrite = (source) => argvRewritten(source, fill).text;
    return {
      rewrite,
      args: (dir) => ['run', staged(program, [], dir, rewrite), '-I', dirname(program), ...dds.flatMap((dd) => {
        const path = join(dir, dd);
        writeFileSync(path, `${Array(RECORDS).fill(controlOf(byAbend).repeat(RECORD)).join('\n')}\n`);
        return ['--dd', `${dd}=${path}:text`];
      })],
    };
  };
  const rotations = byAbend ? [{ name: byAbend.named, fill: byAbend.value }]
    : [...Array(MARKER.length).keys()].map((k) => ({ name: `rotated ${k}`, fill: MARKER.slice(k) + MARKER.slice(0, k) }));
  const control = { name: 'the control moved in', ...holding(controlOf(byAbend)) };
  return { rewrite: control.rewrite, variants: rotations.map((r) => ({ name: `command line or environment ${r.name}`, ...holding(r.fill), control })) };
}

// The statement that begins at `line`, in the program's code columns, up to END-EXEC.
function statementAt(program, line) {
  const lines = readSource(program).text.split(/\r?\n/);
  let text = '';
  for (let i = line - 1; i < Math.min(lines.length, line + 12); i++) {
    text += ` ${lines[i].slice(7, 72)}`;
    if (/END-EXEC/i.test(lines[i])) break;
  }
  return text;
}

// The operator's turn: the fill typed into every unprotected field of the map, or digits into its
// numeric fields, where a program that checks them would turn letters away; then ENTER.
function screenScript(map, digits, fill = (n) => MARKER.repeat(Math.ceil(n / MARKER.length)).slice(0, n)) {
  const origin = { line: Number(map.options?.line) || 1, column: Number(map.options?.column) || 1 };
  const turns = [];
  for (const field of map.fields) {
    const attributes = field.effective || new Set();
    if (!field.pos || !field.length || !attributes.has('UNPROT')) continue;
    const text = digits && attributes.has('NUM') ? '0'.repeat(field.length) : fill(field.length);
    // POS is the attribute byte; the field's data starts one column after it.
    turns.push(`type ${origin.line + field.pos.line - 1} ${origin.column + field.pos.column} ${text}`);
  }
  return turns.length ? `${turns.join('\n')}\nENTER\n` : null;
}

// The terminal's turn in a pseudo-conversation: the task that sends the map returns TRANSID, and
// the operator's ENTER starts the task that receives it, so both run with the transaction the
// program names on RETURN.
function terminalVariants(program, receivedAt, maps, byAbend) {
  const statement = statementAt(program, receivedAt);
  if (!/\bRECEIVE\b/i.test(statement)) return { why: 'the input is not a RECEIVE the labeller can type into' };
  const named = /\bMAP\s*\(\s*'([^']+)'/i.exec(statement)?.[1]?.toUpperCase();
  const transid = /\bRETURN\b[^.]*?\bTRANSID\s*\(\s*'([^']{1,4})'/i.exec(readSource(program).text)?.[1]?.toUpperCase() || 'TRAN';
  const typing = (script) => (dir) => {
    writeFileSync(join(dir, 'screens'), script);
    return ['cics', program, '--transid', transid, '--screens', join(dir, 'screens')];
  };
  // A RECEIVE without a map reads what the operator typed on a cleared screen after the
  // transaction's name, which the program cuts at an offset of its own.
  if (!named) {
    const line = (text) => `type 1 1 ${transid} ${text}\nENTER\n`;
    const control = { name: 'the control after the transaction', args: typing(line(controlOf(byAbend).repeat(70))) };
    return { variants: fills(byAbend).map((fill) => ({ name: `typed after the transaction, ${fill.name}`, args: typing(line(fill.text(70))), control })) };
  }
  const mapset = (/\bMAPSET\s*\(\s*'([^']+)'/i.exec(statement)?.[1] || named).toUpperCase();
  const map = maps.get(mapset)?.maps.find((m) => m.name?.toUpperCase() === named);
  if (!map) return { why: `the repository holds no BMS source for map ${named} of mapset ${mapset}` };
  const control = { name: 'the control in every unprotected field', args: typing(screenScript(map, false, (n) => controlOf(byAbend).repeat(n))) };
  const variants = [];
  const fill = byAbend ? (n) => byAbend.value.repeat(n) : undefined;
  const what = byAbend ? byAbend.named : 'the marker';
  for (const [name, digits] of [[`${what} in every unprotected field`, false], ['digits in numeric fields', true]]) {
    const script = screenScript(map, digits, fill);
    if (!script || variants.some((v) => v.script === script)) continue;
    variants.push({ name, script, args: typing(script), control });
  }
  return variants.length ? { variants } : { why: `map ${named} has no unprotected field` };
}

function journalOf(evidence) {
  const ledger = readFileSync(join(evidence, 'ledger.jsonl'), 'utf8').trim().split('\n');
  const run = JSON.parse(ledger[ledger.length - 1]).run;
  const records = readFileSync(join(evidence, 'runs', `${run}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return { run, records };
}

// A copy of the program in `dir`, its text rewritten where `rewrite` is given, with a CBL card of
// `options` before its first line where there are any.
function staged(program, options, dir, rewrite = (text) => text) {
  const path = join(dir, 'staged', basename(program));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${options.length ? `       CBL ${options.join(',')}\n` : ''}${rewrite(readSource(program).text)}`);
  return path;
}

// The variant run on a staged copy in the run's own directory; the program's directory stays a copy
// library.
function underOptions(program, options, variant) {
  const args = (dir) => {
    const [command, , ...rest] = variant.args(dir);
    return [command, staged(program, options, dir, variant.rewrite), '-I', dirname(program), ...rest];
  };
  return { ...variant, args, lineOffset: 1, control: variant.control && underOptions(program, options, variant.control) };
}

const compliance = (ctx) => (ctx.extended ? ['--compliance', 'extended'] : []);
const libraries = (ctx) => [...ctx.copyDirs.flatMap((d) => ['-I', d]), ...ctx.programDirs.flatMap((d) => ['-L', d])];

// Options a program can only have been compiled with, by what ironwork refuses without them: a
// PICTURE of more than 18 digits compiles only under ARITH(EXTEND).
const NEEDED = [{ refused: /ARITH\(COMPAT\) allows/, option: 'ARITH(EXTEND)' }];

// Refusals of a form ironwork reads only under --compliance extended, where it means what cobc's IBM
// dialect gives it: a level-66 entry inside its record (IWX0032).
const EXTENDED_READS = [/\bIWC0035-S\b/];

// Why ironwork refuses the program under `options`, or null where it compiles.
function refusalUnder(ctx, options) {
  const dir = options.length || ctx.rewrite ? mkdtempSync(join(tmpdir(), 'cobolwork-label-check-')) : null;
  try {
    const program = dir ? staged(ctx.program, options, dir, ctx.rewrite) : ctx.program;
    const r = spawnSync(ctx.ironwork, ['check', program, ...(dir ? ['-I', dirname(ctx.program)] : []), ...libraries(ctx), ...compliance(ctx)], { cwd: tmpdir(), encoding: 'utf8', timeout: ctx.timeout, maxBuffer: 1 << 22, stdio: ['ignore', 'ignore', 'pipe'] });
    if (r.status === 0 || r.status === 4) return null;
    const first = String(r.stderr || '').split('\n').find((l) => l && !/: (warning|informational): /.test(l));
    return first ? first.replace(/^.*?:\d+:\d+: /, '').replace(/'[^']*'/g, "'…'").slice(0, 160) : r.error?.message || `exit ${r.status}`;
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

// The options ironwork compiles the program under, or why it does not: a refusal is not the
// finding's to answer for.
function compileOptions(ctx) {
  const key = `${ctx.program}\0${ctx.rewrite ? 'rewritten' : ''}\0${ctx.extended ? 'extended' : ''}`;
  if (ctx.checked.has(key)) return ctx.checked.get(key);
  const options = [];
  let why = refusalUnder(ctx, options);
  for (const need of NEEDED) {
    if (!why || !need.refused.test(why)) continue;
    options.push(need.option);
    why = refusalUnder(ctx, options);
  }
  if (why && !ctx.extended && EXTENDED_READS.some((r) => r.test(why))) {
    const out = { ...compileOptions({ ...ctx, extended: true }), extended: true };
    ctx.checked.set(key, out);
    return out;
  }
  const out = why ? { why: `ironwork does not compile the program: ${why}` } : { options };
  ctx.checked.set(key, out);
  return out;
}

// What taint found over several answers: input where any found it, unknown where any could not
// say, and none only where every one found none.
export const combined = (answers) => (answers.includes(true) ? true : answers.includes(null) ? null : false);

// How ironwork ended a run itself rather than the program, by the ending its exit status names; an
// abend is read from the journal instead.
const IRONWORK_ENDED = {
  refused: 'gave the compile no program to run',
  'not-generated': 'refused a construct in code generation',
  stopped: 'stopped at a construct the VM does not run yet',
  'not-run': 'reached a construct it does not run',
  unreadable: 'could not read the source or module',
  usage: 'refused its arguments',
  internal: 'failed',
};

// A run that ended at a CALL no library could resolve: an assembler program the repository holds,
// which ironwork does not run, or a program it does not hold at all (operator 2026-10-07: named,
// never stubbed).
function calledAway(stderr, ctx) {
  const m = /CALL (\S+): IEW2456E SYMBOL \S+ UNRESOLVED/.exec(String(stderr || ''));
  if (!m) return null;
  const asm = ctx.assemblers?.get(m[1].toUpperCase());
  return asm ? `the run called ${m[1]}, an assembler program (${asm}) ironwork does not run` : `the run called ${m[1]}, which no program library holds`;
}

const DATA_EXCEPTION = new Set(['S0C7', 'ASRA']);

// The numeric WORKING-STORAGE items with no VALUE that the statement at `line` of `file` uses: a
// data exception there is the program's own uninitialised storage, which ironwork leaves as IBM
// does (operator 2026-10-07: named, never zeroed).
function withoutValue(file, line, ctx) {
  const path = [ctx.program, ...ctx.programDirs.map((d) => join(d, basename(file)))].find((p) => basename(p) === basename(file) && existsSync(p));
  if (!path) return [];
  ctx.parsed ||= new Map();
  if (!ctx.parsed.has(path)) {
    try { ctx.parsed.set(path, parseFile(path, { includeDirs: ctx.copyDirs }).programs); } catch { ctx.parsed.set(path, []); }
  }
  const names = new Set();
  for (const p of ctx.parsed.get(path)) {
    for (const st of p.statements.filter((x) => x.line === line)) {
      for (const t of [...st.targets, ...st.sources]) {
        const it = p.items.find((i) => i.name === t.u && i.section === 'WORKING-STORAGE' && i.picture && /9/.test(i.picture) && !(i.values || []).length && !i.redefines);
        if (it) names.add(it.name);
      }
    }
  }
  return [...names];
}

// One run of one input variant, read back from its journal.
function runVariant(f, ctx, variant) {
  const data = mkdtempSync(join(tmpdir(), 'cobolwork-label-run-'));
  try {
    const [command, program, ...rest] = variant.args(data);
    const args = [command, program, ...libraries(ctx), ...compliance(ctx), ...rest, '--evidence', ctx.evidence, '--trace-marker', MARKER, ...(ctx.traceInput ? ['--trace-input'] : []), '--clock', '2026-01-01T00:00:00'];
    const r = spawnSync(ctx.ironwork, args, { cwd: data, encoding: 'utf8', timeout: ctx.timeout, maxBuffer: 1 << 22, stdio: ['ignore', 'ignore', 'pipe'] });
    if (r.error) return { outcome: r.error.code === 'ETIMEDOUT' ? `no end in ${ctx.timeout / 1000}s` : r.error.message };
    let journal;
    try { journal = journalOf(ctx.evidence); } catch { journal = null; }
    const why = IRONWORK_ENDED[RUN_ENDINGS[r.status]];
    const ended = why && `ironwork ${why} (exit ${r.status})`;
    if (!journal || journal.run === ctx.runs) return { outcome: calledAway(r.stderr, ctx) || ended || `ironwork kept no journal (exit ${r.status})` };
    ctx.runs = journal.run;
    if (ended) return { outcome: calledAway(r.stderr, ctx) || ended };
    // A record in the program itself names the program; one in a COPY member or a called program
    // names that, and only the program's own lines moved for a staged card.
    const lineOf = (x) => x.line - (!x.file || basename(x.file) === basename(ctx.program) ? variant.lineOffset || 0 : 0);
    const at = journal.records.filter((x) => x.kind === 'sink' && (TRACED[ctx.sink] || []).includes(x.sink) && lineOf(x) === f.line && basename(x.file) === basename(f.path));
    const abend = journal.records.find((x) => x.kind === 'abend');
    const atOperation = !!abend && lineOf(abend) === f.line && basename(abend.file || ctx.program) === basename(f.path);
    return {
      run: journal.run,
      reached: at.some((x) => x.reached),
      atSink: at.length > 0,
      input: combined(at.map((x) => x.input ?? null)),
      ran: true,
      abend: abend ? `${abend.code}${abend.line ? ` at ${abend.file || basename(ctx.program)}:${lineOf(abend)}` : ''}` : null,
      abendAtOperation: atOperation ? abend.code : null,
      noValue: abend && !atOperation && DATA_EXCEPTION.has(abend.code) ? withoutValue(abend.file || ctx.program, lineOf(abend), ctx) : [],
      assumptions: journal.records.find((x) => x.kind === 'close')?.assumptions || [],
    };
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
}

const abendText = (r) => `${r.abend}${r.noValue?.length ? `, where ${r.noValue.join(', ')} ${r.noValue.length > 1 ? 'have' : 'has'} no VALUE` : ''}`;

// The ironwork assumptions a label's runs could have rested on, as their journals' close records
// name them.
export function restedOn(...runs) {
  const ids = [...new Set(runs.flatMap((r) => r?.assumptions || []))].sort();
  return ids.length ? { assumptions: ids } : {};
}

// The file a file-record finding's input is read from: the FD its record belongs to, or the file a
// READ ... INTO names.
function sourceFileOf(f, root, program) {
  const src = (f.related || [])[0];
  if (!src) return null;
  const named = /record of file (\S+)/.exec(src.detail || '');
  if (named) return named[1].toUpperCase();
  if (!/^READ\b/.test(src.detail || '') || resolve(root, src.path) !== program) return null;
  const st = parseFile(program).programs.flatMap((p) => p.statements).find((x) => x.verb === 'READ' && x.line === src.line);
  return st?.sources[0]?.u || null;
}

export function labelFinding(f, root, opts) {
  const kinds = kindsOf(f.rule);
  // Command-line and environment input runs only in a rewritten copy (argvRewritten), and a sink
  // ironwork traces only under --compliance extended runs in that mode, so their labels are their
  // own strata.
  const extended = kinds?.sink === 'dynamic-file-path' && assignsFromItem(f, root);
  const strata = (ext) => [kinds?.source === 'argv-or-env' && 'rewritten', ext && 'extended'].filter(Boolean).join('+');
  let jobNotRun = null;
  const stamped = (labelledOn) => ({ source: 'execution', ...(labelledOn ? { labelledOn } : {}), rule: f.rule, fingerprint: f.fingerprint, path: f.path, line: f.line, ...(jobNotRun ? { jobNotRun } : {}) });
  let base = stamped(strata(extended));
  const unknown = (why) => ({ ...base, label: 'unknown', why });
  const byAbend = ABENDS[kinds?.sink];
  if (!kinds || (!TRACED[kinds.sink] && !byAbend)) return unknown(`ironwork does not trace the sink ${kinds?.sink ?? '?'}`);
  if (kinds.sink === 'dynamic-file-path' && !extended) return unknown('ironwork traces a file named at run time in SELECT ... ASSIGN, not in an EXEC CICS FILE or DATASET option');
  if (!FED_BY_DD.has(kinds.source) && kinds.source !== 'cics-terminal' && kinds.source !== 'argv-or-env') return unknown(`the labeller does not feed the source ${kinds.source} yet`);
  // The input enters in the program that reads it, which a cross-program finding runs from.
  const candidates = [...(f.related || []).map((r) => r.path), ...(f.trace || []).map((t) => t.file), f.path].filter(Boolean).map((p) => resolve(root, p));
  const program = candidates.find(isProgram);
  if (!program) return unknown('no program source on the finding');
  // In-stream data in a JCL file the repository holds is labelled by running its job, and by
  // running the program alone where the job does not reach the finding's step.
  const job = kinds.source === 'jcl-instream' ? inStreamJob(f, root) : null;
  const byJob = job && labelByJob(f, root, { ...opts, program, sink: kinds.sink, runs: null, extended }, job, (ext) => stamped(['job', strata(ext)].filter(Boolean).join('+')));
  if (byJob?.label) return byJob;
  if (byJob) {
    jobNotRun = byJob.jobNotRun;
    base = stamped(strata(extended));
  }
  const ctx = { ...opts, program, sink: kinds.sink, runs: null, extended };
  let variants;
  try {
    if (FED_BY_DD.has(kinds.source)) {
      const planned = fileRecordVariants(program, byAbend, { copyDirs: opts.copyDirs, sourceFile: sourceFileOf(f, root, program) });
      if (planned.why) return unknown(planned.why);
      variants = planned;
    }
    else if (kinds.source === 'argv-or-env') {
      const planned = argvVariants(program, byAbend);
      if (planned.why) return unknown(planned.why);
      variants = planned.variants;
      ctx.rewrite = planned.rewrite;
    } else {
      const source = (f.related || []).find((r) => resolve(root, r.path) === program);
      const planned = source ? terminalVariants(program, source.line, opts.maps, byAbend) : { why: 'the finding does not say where the input is received' };
      if (planned.why) return unknown(planned.why);
      variants = planned.variants;
    }
  } catch { return unknown('the program does not parse'); }
  const compiled = compileOptions(ctx);
  if (compiled.extended) {
    ctx.extended = true;
    base = stamped(strata(true));
  }
  if (compiled.why) return unknown(compiled.why);
  // SSRANGE so that a range check ends the run.
  const options = [...(byAbend?.ssrange ? ['SSRANGE'] : []), ...compiled.options];
  if (options.length) variants = variants.map((v) => underOptions(program, options, v));
  try { ctx.runs = journalOf(ctx.evidence).run; } catch { /* no run yet */ }
  const seen = [];
  for (const variant of variants) {
    const r = runVariant(f, ctx, variant);
    if (!r.ran) return { ...unknown(r.outcome), variant: variant.name };
    seen.push(r);
    if (!byAbend && r.reached) return { ...base, label: 'confirmed', run: r.run, variant: variant.name, ...restedOn(r) };
    if (byAbend && byAbend.codes.includes(r.abendAtOperation)) {
      // The same run with the control input must get past the operation, or the abend is not the
      // input's doing.
      const c = runVariant(f, ctx, variant.control);
      if (c.ran && !c.abendAtOperation) return { ...base, label: 'confirmed', run: r.run, variant: variant.name, control: c.run, ...restedOn(r, c) };
      r.controlAbended = true;
    }
  }
  const why = byAbend ? (seen.some((r) => r.controlAbended) ? `the run with ${byAbend.controlNamed} abended at the operation too`
    : seen.find((r) => r.abend) ? `the run did not end at the operation: ABEND ${abendText(seen.find((r) => r.abend))}`
      : 'the run did not abend at the operation')
    : seen.some((r) => r.atSink) ? 'the operation ran without the marker in its operand'
    : seen.find((r) => r.abend) ? `the run ended before the operation: ABEND ${abendText(seen.find((r) => r.abend))}`
      : 'the run did not reach the operation';
  const atSink = seen.filter((r) => r.atSink);
  return { ...unknown(why), runs: seen.map((r) => r.run), ...restedOn(...seen), ...(opts.traceInput && atSink.length ? { inputAtSink: combined(atSink.map((r) => r.input)) } : {}) };
}

// The repository's BMS mapsets by name, and the directories that hold them, which ironwork reads
// physical maps from as it reads copybooks.
function mapsOf(root) {
  const maps = new Map();
  const dirs = new Set();
  for (const p of directoryTree(root).list().filter((x) => /\.bms$/i.test(x))) {
    let parsed;
    try { parsed = parseBms(readSource(p).text); } catch { continue; }
    for (const ms of parsed.mapsets) if (ms.name && !maps.has(ms.name.toUpperCase())) maps.set(ms.name.toUpperCase(), ms);
    dirs.add(dirname(p));
  }
  return { maps, dirs: [...dirs] };
}

const SCAN_ATTEMPTS = 3;
const SCAN_PAUSE_MS = 30000;

// The scan's memory guard reads the whole machine's free memory, so a scan stopped by it is tried
// again after a pause; one that stays stopped is named, since its missing findings are not labels.
export function labelRepository(root, opts) {
  let report;
  for (let attempt = 1; attempt <= SCAN_ATTEMPTS; attempt++) {
    report = scanFlow(root, {});
    if (!report.summary.stoppedBy) break;
    if (attempt < SCAN_ATTEMPTS) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, opts.scanPause ?? SCAN_PAUSE_MS);
  }
  if (report.summary.stoppedBy) return { incomplete: stoppedBecause(report.summary.stoppedBy), labels: [] };
  const { findings } = report;
  stampFingerprints(findings, { root });
  const { maps, dirs } = mapsOf(root);
  const copyDirs = [...new Set([...buildFileIndex(root).copyDirs, ...dirs])];
  const listed = directoryTree(root).list();
  const programDirs = [...new Set(listed.filter(isProgram).map((p) => dirname(p)))];
  const assemblers = new Map(listed.filter((p) => isAssembler(p)).map((p) => [basename(p).replace(/\.[^.]*$/, '').toUpperCase(), relative(root, p)]));
  const context = { ...opts, copyDirs, programDirs, maps, assemblers };
  return { labels: findings.filter((f) => f.evidence === 'path' && kindsOf(f.rule)).map((f) => labelFinding(f, root, context)) };
}

export function label(given, opts = {}) {
  const target = resolve(given);
  const evidence = opts.evidence || mkdtempSync(join(tmpdir(), 'cobolwork-label-evidence-'));
  mkdirSync(evidence, { recursive: true });
  const run = { ironwork: opts.ironwork || 'ironwork', timeout: opts.timeout || 20000, evidence: resolve(evidence), checked: new Map(), traceInput: opts.traceInput === true };
  const repos = opts.corpus ? readdirSync(target, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => join(target, d.name)).sort() : [target];
  const labels = [];
  const incomplete = [];
  for (const repo of repos) {
    const r = labelRepository(repo, run);
    if (r.incomplete) incomplete.push({ repo: basename(repo), why: r.incomplete });
    for (const l of r.labels) labels.push(opts.corpus ? { repo: basename(repo), ...l } : l);
  }
  const byRule = {};
  for (const l of labels) {
    const r = (byRule[l.rule] ??= { confirmed: 0, unknown: 0 });
    r[l.label]++;
  }
  const inputAtSink = run.traceInput ? Object.fromEntries([true, false, null].map((v) => [String(v), labels.filter((l) => l.inputAtSink === v).length])) : undefined;
  return { tool: 'cobolwork-label', marker: MARKER, evidence: run.evidence, byRule, ...(inputAtSink ? { inputAtSink } : {}), incomplete, labels };
}

export { abendText, calledAway, compileOptions, compliance, controlOf, DATA_EXCEPTION, fills, IRONWORK_ENDED, journalOf, libraries, withoutValue };

function main(argv) {
  const opts = {};
  let target = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--corpus') opts.corpus = true;
    else if (a === '--ironwork') opts.ironwork = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--evidence') opts.evidence = argv[++i];
    else if (a === '--timeout') opts.timeout = Number(argv[++i]);
    else if (a === '--trace-input') opts.traceInput = true;
    else target = a;
  }
  if (!target) {
    process.stderr.write('usage: node bench/label.mjs <repository | corpus-root> [--corpus] [--ironwork path] [--out file] [--evidence dir] [--timeout ms] [--trace-input]\n');
    return 2;
  }
  // The memory guard's free term is the whole machine, which macOS reports as free pages only.
  process.env.COBOLWORK_FREE_MEMORY_MB ||= '1024';
  const out = label(target, opts);
  const text = `${JSON.stringify(out, null, 1)}\n`;
  if (opts.out) writeFileSync(opts.out, text);
  else process.stdout.write(text);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
