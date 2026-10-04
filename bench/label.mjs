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
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { parseBms } from '../lib/bms.mjs';
import { kindsOf } from '../lib/consequence.mjs';
import { stampFingerprints } from '../lib/kernel/identity.mjs';
import { stoppedBecause } from '../lib/kernel/memory.mjs';
import { directoryTree } from '../lib/kernel/source-tree.mjs';
import { buildFileIndex, parseFile } from '../lib/parser.mjs';
import { scan as scanFlow } from '../lib/sets/flow.mjs';
import { isProgram, readSource } from '../lib/sources.mjs';
import { MARKER } from '../lib/verify.mjs';
import { RUN_ENDINGS } from '../lib/ironwork-ids.mjs';

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
};

// Sinks whose witness is how the run ends rather than a marker, with the input that provokes it
// and a control that should not. A byte whose low half is not a digit ends zoned arithmetic with a
// data exception (S0C7, ASRA in a CICS task), which the marker cannot: each of its letters reads as
// a digit. Nines put a subscript, start, length or count past the table or field, which under
// SSRANGE ends the run with U4038; ones keep it inside most.
const BEYOND = { codes: ['U4038'], value: '9', named: 'nines', control: '1', controlNamed: 'ones', ssrange: true };
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

// The DD names a SELECT's ASSIGN can mean: as written, and without IBM's class prefix (UT-S-, S-).
function ddNames(assign) {
  if (!assign?.v || assign.t !== 'word' && assign.t !== 'string') return [];
  const name = String(assign.v).toUpperCase();
  const bare = name.replace(/^(?:[A-Z]{2}-)?[A-Z]-(?=[A-Z0-9@#$])/, '');
  return [...new Set([name, bare])].filter((n) => /^[A-Z0-9@#$-]{1,8}$/.test(n));
}

// The inputs to try: the marker at each of the eight shifts, or the input an abend's witness needs.
const fills = (byAbend) => (byAbend ? [{ name: byAbend.named, text: (n) => byAbend.value.repeat(n) }]
  : [...Array(MARKER.length).keys()].map((shift) => ({ name: `shifted ${shift}`, text: (n) => shifted(shift).slice(0, n) })));
const controlOf = (byAbend) => byAbend?.control ?? '0';

// Sources a program reads through a DD: a file's records, and a job's in-stream data, which reaches
// the program as the records of the DD it is written on.
const FED_BY_DD = new Set(['file-record', 'jcl-instream']);

// Every DD the program assigns, and SYSIN, holding each fill.
function fileRecordVariants(program, byAbend) {
  const files = parseFile(program).programs.flatMap((p) => p.files || []);
  const dds = [...new Set([...files.flatMap((x) => ddNames(x.assign)), 'SYSIN'])];
  const holding = (record) => (dir) => ['run', program, ...dds.flatMap((dd) => {
    const path = join(dir, dd);
    writeFileSync(path, `${Array(RECORDS).fill(record).join('\n')}\n`);
    return ['--dd', `${dd}=${path}:text`];
  })];
  const control = { name: 'records of the control', args: holding(controlOf(byAbend).repeat(RECORD)) };
  return fills(byAbend).map((fill) => ({ name: `records ${fill.name}`, args: holding(fill.text(RECORD)), control }));
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

// A copy of the program with a CBL card of `options` before its first line, in `dir`.
function staged(program, options, dir) {
  const path = join(dir, 'staged', basename(program));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `       CBL ${options.join(',')}\n${readSource(program).text}`);
  return path;
}

// The variant run on a staged copy in the run's own directory; the program's directory stays a copy
// library.
function underOptions(program, options, variant) {
  const args = (dir) => {
    const [command, , ...rest] = variant.args(dir);
    return [command, staged(program, options, dir), '-I', dirname(program), ...rest];
  };
  return { ...variant, args, lineOffset: 1, control: variant.control && underOptions(program, options, variant.control) };
}

const libraries = (ctx) => [...ctx.copyDirs.flatMap((d) => ['-I', d]), ...ctx.programDirs.flatMap((d) => ['-L', d])];

// Options a program can only have been compiled with, by what ironwork refuses without them: a
// PICTURE of more than 18 digits compiles only under ARITH(EXTEND).
const NEEDED = [{ refused: /ARITH\(COMPAT\) allows/, option: 'ARITH(EXTEND)' }];

// Why ironwork refuses the program under `options`, or null where it compiles.
function refusalUnder(ctx, options) {
  const dir = options.length ? mkdtempSync(join(tmpdir(), 'cobolwork-label-check-')) : null;
  try {
    const program = dir ? staged(ctx.program, options, dir) : ctx.program;
    const r = spawnSync(ctx.ironwork, ['check', program, ...(dir ? ['-I', dirname(ctx.program)] : []), ...libraries(ctx)], { cwd: tmpdir(), encoding: 'utf8', timeout: ctx.timeout, maxBuffer: 1 << 22, stdio: ['ignore', 'ignore', 'pipe'] });
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
  if (ctx.checked.has(ctx.program)) return ctx.checked.get(ctx.program);
  const options = [];
  let why = refusalUnder(ctx, options);
  for (const need of NEEDED) {
    if (!why || !need.refused.test(why)) continue;
    options.push(need.option);
    why = refusalUnder(ctx, options);
  }
  const out = why ? { why: `ironwork does not compile the program: ${why}` } : { options };
  ctx.checked.set(ctx.program, out);
  return out;
}

// What taint found over several answers: input where any found it, unknown where any could not
// say, and none only where every one found none.
const combined = (answers) => (answers.includes(true) ? true : answers.includes(null) ? null : false);

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

// One run of one input variant, read back from its journal.
function runVariant(f, ctx, variant) {
  const data = mkdtempSync(join(tmpdir(), 'cobolwork-label-run-'));
  try {
    const [command, program, ...rest] = variant.args(data);
    const args = [command, program, ...libraries(ctx), ...rest, '--evidence', ctx.evidence, '--trace-marker', MARKER, ...(ctx.traceInput ? ['--trace-input'] : []), '--clock', '2026-01-01T00:00:00'];
    const r = spawnSync(ctx.ironwork, args, { cwd: data, encoding: 'utf8', timeout: ctx.timeout, maxBuffer: 1 << 22, stdio: ['ignore', 'ignore', 'pipe'] });
    if (r.error) return { outcome: r.error.code === 'ETIMEDOUT' ? `no end in ${ctx.timeout / 1000}s` : r.error.message };
    let journal;
    try { journal = journalOf(ctx.evidence); } catch { journal = null; }
    const why = IRONWORK_ENDED[RUN_ENDINGS[r.status]];
    const ended = why && `ironwork ${why} (exit ${r.status})`;
    if (!journal || journal.run === ctx.runs) return { outcome: ended || `ironwork kept no journal (exit ${r.status})` };
    ctx.runs = journal.run;
    if (ended) return { outcome: ended };
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
    };
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
}

export function labelFinding(f, root, opts) {
  const kinds = kindsOf(f.rule);
  const base = { source: 'execution', rule: f.rule, fingerprint: f.fingerprint, path: f.path, line: f.line };
  const unknown = (why) => ({ ...base, label: 'unknown', why });
  const byAbend = ABENDS[kinds?.sink];
  if (!kinds || (!TRACED[kinds.sink] && !byAbend)) return unknown(`ironwork does not trace the sink ${kinds?.sink ?? '?'}`);
  if (!FED_BY_DD.has(kinds.source) && kinds.source !== 'cics-terminal') return unknown(`the labeller does not feed the source ${kinds.source} yet`);
  // The input enters in the program that reads it, which a cross-program finding runs from.
  const candidates = [...(f.related || []).map((r) => r.path), ...(f.trace || []).map((t) => t.file), f.path].filter(Boolean).map((p) => resolve(root, p));
  const program = candidates.find(isProgram);
  if (!program) return unknown('no program source on the finding');
  const ctx = { ...opts, program, sink: kinds.sink, runs: null };
  let variants;
  try {
    if (FED_BY_DD.has(kinds.source)) variants = fileRecordVariants(program, byAbend);
    else {
      const source = (f.related || []).find((r) => resolve(root, r.path) === program);
      const planned = source ? terminalVariants(program, source.line, opts.maps, byAbend) : { why: 'the finding does not say where the input is received' };
      if (planned.why) return unknown(planned.why);
      variants = planned.variants;
    }
  } catch { return unknown('the program does not parse'); }
  const compiled = compileOptions(ctx);
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
    if (!byAbend && r.reached) return { ...base, label: 'confirmed', run: r.run, variant: variant.name };
    if (byAbend && byAbend.codes.includes(r.abendAtOperation)) {
      // The same run with the control input must get past the operation, or the abend is not the
      // input's doing.
      const c = runVariant(f, ctx, variant.control);
      if (c.ran && !c.abendAtOperation) return { ...base, label: 'confirmed', run: r.run, variant: variant.name, control: c.run };
      r.controlAbended = true;
    }
  }
  const why = byAbend ? (seen.some((r) => r.controlAbended) ? `the run with ${byAbend.controlNamed} abended at the operation too`
    : seen.find((r) => r.abend) ? `the run did not end at the operation: ABEND ${seen.find((r) => r.abend).abend}`
      : 'the run did not abend at the operation')
    : seen.some((r) => r.atSink) ? 'the operation ran without the marker in its operand'
    : seen.find((r) => r.abend) ? `the run ended before the operation: ABEND ${seen.find((r) => r.abend).abend}`
      : 'the run did not reach the operation';
  const atSink = seen.filter((r) => r.atSink);
  return { ...unknown(why), runs: seen.map((r) => r.run), ...(opts.traceInput && atSink.length ? { inputAtSink: combined(atSink.map((r) => r.input)) } : {}) };
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
  const programDirs = [...new Set(directoryTree(root).list().filter(isProgram).map((p) => dirname(p)))];
  const context = { ...opts, copyDirs, programDirs, maps };
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
  const out = label(target, opts);
  const text = `${JSON.stringify(out, null, 1)}\n`;
  if (opts.out) writeFileSync(opts.out, text);
  else process.stdout.write(text);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
