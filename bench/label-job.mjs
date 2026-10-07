// SPDX-License-Identifier: AGPL-3.0-or-later
// Labels for a finding whose source is a job's in-stream data: the job runs under `ironwork job`
// through the finding's step, from a copy of its JCL in which the in-stream data of the finding's DD
// is marker records and the steps after it are left out. Every other DD holds what the job gives
// it. A data set the steps read before any of them creates it is the repository's file of that name
// where it holds whole z/OS records, and empty otherwise: a generation data group gets its base and
// the generations the job reads back, an indexed or relative file an empty cluster (operator
// 2026-10-07; docs/spec/reach.md §9.6).
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { dispositionOf, parseJcl } from '../lib/jcl.mjs';
import { directoryTree } from '../lib/kernel/source-tree.mjs';
import { parseFile } from '../lib/parser.mjs';
import { isProgram, readSource } from '../lib/sources.mjs';
import { MARKER } from '../lib/verify.mjs';
import { RUN_ENDINGS } from '../lib/ironwork-ids.mjs';
import {
  ABENDS, abendText, calledAway, combined, compileOptions, compliance, controlOf, DATA_EXCEPTION, fileShapes, fills,
  IRONWORK_ENDED, journalOf, libraries, restedOn, TRACED, withoutValue,
} from './label.mjs';

// In-stream data is card images.
const CARD = 80;
// The user the job is submitted as: &SYSUID's value.
const USER = 'CWLABEL';
// The programs `ironwork job` runs itself rather than from a program library.
const RUN_BY_IRONWORK = new Set(['IEFBR14', 'IEBGENER', 'ICEGENER', 'IDCAMS', 'SORT', 'ICEMAN', 'DFSORT', 'SYNCSORT']);
// DDs that name load libraries, which ironwork does not allocate.
const NOT_ALLOCATED = new Set(['STEPLIB', 'JOBLIB', 'JOBCAT', 'STEPCAT']);
const GENERATION = /^([^()]+)\(([+-]?\d+)\)$/;
const MEMBER = /^([^()]+)\(([A-Z@#$][A-Z0-9@#$]{0,7})\)$/i;
const PROCEDURE_EXT = new Set(['.prc', '.proc', '.jcl', '.inc', '.incl']);

// The JCL file, its parse, and the DD whose in-stream data is the finding's source, where the
// finding's source is in-stream data in a JCL file the repository holds.
export function inStreamJob(f, root) {
  const src = (f.related || [])[0];
  if (!src?.path || !src.line) return null;
  const path = resolve(root, src.path);
  if (!existsSync(path) || isProgram(path)) return null;
  let parsed;
  try { parsed = parseJcl(readSource(path).text, path, { symbols: { SYSUID: USER } }); } catch { return null; }
  const dd = parsed.dds.find((d) => d.line === src.line && d.inStream?.length);
  const step = dd && parsed.steps.find((s) => s.dds.includes(dd));
  return step ? { path, rel: src.path, parsed, dd, step } : null;
}

const parsedPrograms = new Map();
function programsOf(path, copyDirs) {
  if (!parsedPrograms.has(path)) {
    try { parsedPrograms.set(path, parseFile(path, { includeDirs: copyDirs }).programs); } catch { parsedPrograms.set(path, []); }
  }
  return parsedPrograms.get(path);
}

// The repository's program sources by the name a step can run them under: the file's name, then
// its PROGRAM-ID.
const programIndexes = new Map();
function programIndex(root) {
  if (programIndexes.has(root)) return programIndexes.get(root);
  const byFile = new Map();
  const byId = new Map();
  for (const p of directoryTree(root).list().filter(isProgram)) {
    const name = basename(p, extname(p)).toUpperCase();
    if (!byFile.has(name)) byFile.set(name, p);
    const id = /\bPROGRAM-ID\s*\.?\s*['"]?([A-Z0-9@#$-]{1,30})/i.exec(readSource(p).text)?.[1]?.toUpperCase();
    if (id && !byId.has(id)) byId.set(id, p);
  }
  const index = { byFile, byId };
  programIndexes.set(root, index);
  return index;
}

// The source a step's EXEC PGM= runs, and the name ironwork finds it under in a program library:
// PGM.cbl or PGM.cob, as written or in lower case.
function programFor(pgm, root, ctx) {
  for (const dir of ctx.programDirs) {
    for (const name of [pgm, pgm.toLowerCase()]) {
      for (const ext of ['cbl', 'cob', 'CBL', 'COB']) {
        const path = join(dir, `${name}.${ext}`);
        if (existsSync(path)) return { path, as: basename(path) };
      }
    }
  }
  const { byFile, byId } = programIndex(root);
  const path = byFile.get(pgm) || byId.get(pgm);
  return path ? { path, as: `${pgm}.cbl` } : null;
}

// The repository's files by name, with and without their extension, to supply the data sets the
// job reads.
const fileIndexes = new Map();
function fileIndex(root) {
  if (fileIndexes.has(root)) return fileIndexes.get(root);
  const index = new Map();
  for (const p of directoryTree(root).list()) {
    const name = basename(p).toUpperCase();
    for (const key of new Set([name, name.replace(/\.[^.]*$/, '')])) {
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(p);
    }
  }
  fileIndexes.set(root, index);
  return index;
}

// The length of the fixed records a step reads a data set as, from its program's FD or the DD's
// LRECL; null for variable-length records, or where neither says.
function recordLength(dd, shape) {
  const dcb = [dd.keywords?.get('DCB'), dd.keywords?.get('RECFM') && `RECFM=${dd.keywords.get('RECFM')}`, dd.keywords?.get('LRECL') && `LRECL=${dd.keywords.get('LRECL')}`].filter(Boolean).join(',');
  if (/RECFM=V/i.test(dcb)) return null;
  return shape?.length || Number(/LRECL=(\d+)/i.exec(dcb)?.[1]) || null;
}

// Whether a repository file holds whole z/OS records of `length` bytes: ironwork reads a fixed
// data set as records back to back, with nothing between them.
const wholeRecords = (path, length) => !!length && statSync(path).size % length === 0;

// The repository's file for a data set, as its bytes: a file named after it, or for a member a file
// named after the member in a directory named after the data set's last qualifier; with the files
// that matched by name and do not hold whole records.
function supplied(root, name, member, length) {
  const last = name.split('.').at(-1).toUpperCase();
  const found = (fileIndex(root).get((member || name).toUpperCase()) || []).filter((p) => !member || basename(dirname(p)).toUpperCase() === last).sort();
  return { from: found.find((p) => wholeRecords(p, length)) || null, refused: found.filter((p) => !wholeRecords(p, length)) };
}

// The names IDCAMS DEFINEs in a step's in-stream commands.
function definedIn(step) {
  if (step.pgm?.toUpperCase() !== 'IDCAMS') return [];
  const text = step.dds.filter((d) => (d.name || '').toUpperCase() === 'SYSIN' && d.inStream).flatMap((d) => d.inStream.map((l) => l.text.slice(0, 72))).join('\n').replace(/[-+]\s*\n/g, ' ');
  return [...text.matchAll(/\bDEFINE\s+(?:GDG|GENERATIONDATAGROUP|CLUSTER|CL|ALTERNATEINDEX|AIX|PATH)\s*\(\s*NAME\s*\(\s*'?([^)'\s]+)/gi)].map((m) => m[1].toUpperCase());
}

// The data sets the steps read before any of them creates them: plain ones and members, with the
// shape of the file the step's program reads them as and their record length, and each generation
// data group with the number of generations its relative references read back.
function inputsOf(steps, shapesOf) {
  const created = new Set();
  const inputs = new Map();
  const groups = new Map();
  for (const step of steps) {
    for (const name of definedIn(step)) created.add(name);
    let ddName = null;
    for (const dd of step.dds) {
      if (dd.name) ddName = dd.name.toUpperCase();
      const dsn = dd.dsn?.toUpperCase();
      if (!dsn || dd.sysout || dd.temporary || dsn.includes('&') || dsn.startsWith('*') || NOT_ALLOCATED.has(ddName)) continue;
      const status = dispositionOf(dd.disp)?.status || 'NEW';
      const shape = shapesOf(step)?.get(ddName) || null;
      const length = recordLength(dd, shape);
      const gen = GENERATION.exec(dsn);
      if (gen) {
        if (created.has(gen[1])) continue;
        const relative = Number(gen[2]);
        const group = groups.get(gen[1]) || { needed: 0, length: null };
        groups.set(gen[1], { needed: Math.max(group.needed, relative <= 0 ? 1 - relative : 0), length: group.length || (relative <= 0 ? length : null) });
        continue;
      }
      const member = MEMBER.exec(dsn);
      const name = member ? member[1] : dsn;
      if (status === 'NEW' || status === 'MOD') { created.add(dsn); continue; }
      if (created.has(dsn) || created.has(name) || inputs.has(dsn)) continue;
      inputs.set(dsn, { name, member: member?.[2] || null, shape, length });
    }
  }
  for (const [dsn, input] of inputs) {
    if (input.member || !groups.has(dsn)) continue;
    const group = groups.get(dsn);
    groups.set(dsn, { needed: Math.max(group.needed, 1), length: group.length || input.length });
    inputs.delete(dsn);
  }
  return { inputs, groups };
}

// IDCAMS commands that make each group's base and each keyed input's empty cluster, as ironwork's
// own DEFINE writes them.
function defineCards(inputs, groups) {
  const cards = [];
  for (const base of groups.keys()) cards.push('  DEFINE GDG -', `    (NAME(${base}) -`, '    LIMIT(255) NOEMPTY SCRATCH)');
  for (const [dsn, { member, shape }] of inputs) {
    if (member || !shape?.keyed || !shape.length || (!shape.relative && !shape.key)) continue;
    cards.push('  DEFINE CLUSTER -', `    (NAME(${dsn}) -`, shape.relative ? '    NUMBERED -' : `    INDEXED KEYS(${shape.key.size} ${shape.key.offset}) -`, `    RECORDSIZE(${shape.length} ${shape.length}))`);
  }
  return cards;
}

// The --datasets directory the job starts with, and the repository files that matched a data set
// by name and were not used because they do not hold whole records; or why it could not be made.
function prepareDatasets(dir, root, ctx, steps, shapesOf) {
  mkdirSync(dir, { recursive: true });
  const { inputs, groups } = inputsOf(steps, shapesOf);
  const cards = defineCards(inputs, groups);
  const refused = [];
  if (cards.length) {
    const prep = mkdtempSync(join(tmpdir(), 'cobolwork-label-prep-'));
    try {
      writeFileSync(join(prep, 'DEFINE.jcl'), ['//CWPREP   JOB', '//DEFINE   EXEC PGM=IDCAMS', '//SYSPRINT DD SYSOUT=*', '//SYSIN    DD *', ...cards, '/*', ''].join('\n'));
      const r = spawnSync(ctx.ironwork, ['job', join(prep, 'DEFINE.jcl'), '--datasets', dir], { cwd: prep, encoding: 'utf8', timeout: ctx.timeout, maxBuffer: 1 << 22, stdio: ['ignore', 'pipe', 'pipe'] });
      if (r.status !== 0) return { why: `ironwork could not define the job's generation data groups and clusters: ${String(r.stderr || r.error?.message || '').trim().split('\n')[0]}` };
    } finally {
      rmSync(prep, { recursive: true, force: true });
    }
  }
  for (const [base, { needed, length }] of groups) {
    const escaped = base.replace(/[.$#@]/g, (c) => `\\${c}`);
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- the name is escaped
    const named = new RegExp(`^${escaped}\\.G(\\d{4})V00(?:\\.[^.]+)?$`, 'i');
    const byNumber = new Map();
    for (const p of directoryTree(root).list().filter((x) => named.test(basename(x))).sort()) {
      if (!wholeRecords(p, length)) { refused.push(p); continue; }
      const number = named.exec(basename(p))[1];
      if (!byNumber.has(number)) byNumber.set(number, p);
    }
    if (byNumber.size && byNumber.size >= needed) {
      for (const [number, p] of byNumber) copyFileSync(p, join(dir, `${base}.G${number}V00`));
    } else {
      for (let n = 1; n <= needed; n++) writeFileSync(join(dir, `${base}.G${String(n).padStart(4, '0')}V00`), '');
    }
  }
  for (const [dsn, { name, member, length }] of inputs) {
    const given = supplied(root, name, member, length);
    refused.push(...given.refused);
    const path = member ? join(dir, name, member) : join(dir, dsn);
    mkdirSync(dirname(path), { recursive: true });
    if (given.from) copyFileSync(given.from, path);
    else if (!existsSync(path)) writeFileSync(path, '');
  }
  return { refused: [...new Set(refused)] };
}

// Where the copy of the JCL ends: the job card and every statement through the finding's step,
// up to the next step or job; null where the step is in a procedure, whose callers it cannot
// tell apart. `closers` ENDIFs end the IF constructs open there.
function cutAfter(job) {
  if (job.step.inProc) return { cut: null, closers: 0 };
  const later = [...job.parsed.steps.filter((s) => !s.inProc).map((s) => s.line), ...job.parsed.jobs.map((j) => j.line)].filter((l) => l > job.step.line);
  if (!later.length) return { cut: null, closers: 0 };
  const cut = Math.min(...later);
  const before = job.parsed.statements.filter((st) => st.kind === 'statement' && st.line < cut);
  return { cut, closers: Math.max(0, before.filter((st) => st.operation === 'IF').length - before.filter((st) => st.operation === 'ENDIF').length) };
}

// The JCL with each in-stream line of the DD replaced by `record` and the statements from `cut`
// on left out, every other byte as it was.
function withRecords(path, dd, record, { cut, closers }) {
  const parts = readFileSync(path, 'latin1').split(/(\r\n|\n|\r)/);
  for (const { line } of dd.inStream) parts[2 * (line - 1)] = record;
  const kept = cut ? parts.slice(0, 2 * (cut - 1)).join('') : parts.join('');
  return `${kept}${'//         ENDIF\n'.repeat(closers)}`;
}

// The procedure libraries a job's EXEC and INCLUDE statements can name: each procedure source in
// the repository under its member name.
function procedureLibrary(dir, root) {
  mkdirSync(dir, { recursive: true });
  for (const p of directoryTree(root).list().filter((x) => PROCEDURE_EXT.has(extname(x).toLowerCase()))) {
    const member = basename(p, extname(p)).toUpperCase();
    if (!existsSync(join(dir, member))) symlinkSync(p, join(dir, member));
  }
}

// One run of the job with `record` as the finding's in-stream data, read back from its journal.
function runJob(f, ctx, plan, record) {
  const dir = mkdtempSync(join(tmpdir(), 'cobolwork-label-job-'));
  try {
    mkdirSync(join(dir, 'jcl'));
    const jcl = join(dir, 'jcl', basename(plan.job.path));
    writeFileSync(jcl, withRecords(plan.job.path, plan.job.dd, record, plan.cut), 'latin1');
    cpSync(plan.datasets, join(dir, 'datasets'), { recursive: true });
    const args = ['job', jcl, '--datasets', join(dir, 'datasets'), '-L', plan.staging, ...plan.copyDirs.flatMap((d) => ['-I', d]), ...libraries(ctx),
      ...(plan.procs ? ['--proclib', plan.procs] : []), ...compliance(ctx), '--user', USER,
      '--evidence', ctx.evidence, '--trace-marker', MARKER, ...(ctx.traceInput ? ['--trace-input'] : []), '--clock', '2026-01-01T00:00:00'];
    // Each step gets the time one program's run has.
    const timeout = ctx.timeout * Math.max(1, plan.job.parsed.steps.length);
    const r = spawnSync(ctx.ironwork, args, { cwd: dir, encoding: 'utf8', timeout, maxBuffer: 1 << 24, stdio: ['ignore', 'ignore', 'pipe'] });
    if (r.error) return { outcome: r.error.code === 'ETIMEDOUT' ? `the job had no end in ${timeout / 1000}s` : r.error.message };
    let journal;
    try { journal = journalOf(ctx.evidence); } catch { journal = null; }
    if (!journal || journal.run === ctx.runs) {
      const said = String(r.stderr || '').split('\n').find((l) => /^ironwork: /.test(l))?.replace(/^ironwork: /, '').replace(/\S*\/([^/\s]+)/g, '$1').slice(0, 200);
      const why = IRONWORK_ENDED[RUN_ENDINGS[r.status]];
      return { notRun: said ? `ironwork refuses the job: ${said}` : why ? `ironwork ${why} (exit ${r.status})` : `ironwork kept no journal (exit ${r.status})` };
    }
    ctx.runs = journal.run;
    // Records name the staged copies; a copy with an option card has its lines one further on.
    const fileOf = (x) => (x.file ? plan.names.get(basename(x.file)) || basename(x.file) : null);
    const lineOf = (x) => x.line - (x.file && plan.carded.has(basename(x.file)) ? 1 : 0);
    const at = journal.records.filter((x) => x.kind === 'sink' && (TRACED[ctx.sink] || []).includes(x.sink) && lineOf(x) === f.line && fileOf(x) === basename(f.path));
    const abends = journal.records.filter((x) => x.kind === 'abend');
    const atOperation = abends.find((x) => x.line && lineOf(x) === f.line && fileOf(x) === basename(f.path));
    const abend = abends[0];
    return {
      run: journal.run,
      ran: true,
      reached: at.some((x) => x.reached),
      atSink: at.length > 0,
      input: combined(at.map((x) => x.input ?? null)),
      abend: abend ? `${abend.code}${abend.line ? ` at ${fileOf(abend)}:${lineOf(abend)}` : ''}` : null,
      abendAtOperation: atOperation ? atOperation.code : null,
      noValue: abend?.line && !atOperation && DATA_EXCEPTION.has(abend.code) ? withoutValue(fileOf(abend), lineOf(abend), { ...ctx, program: plan.paths.get(fileOf(abend)) || ctx.program }) : [],
      steps: journal.records.filter((x) => x.kind === 'step'),
      calledAway: calledAway(r.stderr, ctx),
      assumptions: journal.records.find((x) => x.kind === 'close')?.assumptions || [],
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const stepOf = (plan) => (plan.job.step.name || '').toUpperCase();
const isStep = (plan) => (x) => x.step === stepOf(plan) || x.step.endsWith(`.${stepOf(plan)}`);

// Why the finding's step did not start in a run of the job: a step before it stopped the job, or
// the job bypassed it; null where it started.
function stoppedShort(r, plan) {
  const own = r.steps.findIndex(isStep(plan));
  if (own >= 0 && !/^(?:BYPASSED|JCL ERROR)/.test(r.steps[own].outcome)) return null;
  const shown = (outcome) => outcome.replace(/; the job ends$/, '').replace(/\/\S*\/([^/\s:]+)/g, '$1').slice(0, 200);
  const stopped = r.steps.slice(0, own >= 0 ? own + 1 : undefined).find((x) => /^(?:JCL ERROR|ABEND)/.test(x.outcome));
  if (stopped) return `the job stopped at step ${stopped.step}, ${isStep(plan)(stopped) ? 'the finding\'s step' : `before step ${stepOf(plan)}`}: ${shown(stopped.outcome)}`;
  if (own >= 0) return `the job bypassed step ${stepOf(plan)}: ${r.steps[own].outcome.replace(/^BYPASSED: /, '')}`;
  return `the job never ran step ${stepOf(plan)}`;
}

// Why runs of the job that reached the finding's step did not show the finding.
function whyNot(seen, byAbend, plan) {
  const called = seen.find((r) => r.calledAway && !r.atSink && !r.abendAtOperation);
  if (called) return called.calledAway;
  const ownIronwork = seen.flatMap((r) => r.steps).find((x) => isStep(plan)(x) && /^ABEND IRONWORK/.test(x.outcome));
  if (ownIronwork) return `ironwork did not run step ${stepOf(plan)}: ${ownIronwork.outcome.replace(/^ABEND IRONWORK: /, '').replace(/\/\S*\/([^/\s:]+)/g, '$1').slice(0, 200)}`;
  const ended = seen.find((r) => r.abend);
  if (byAbend) {
    return seen.some((r) => r.controlAbended) ? `the run with ${byAbend.controlNamed} abended at the operation too`
      : ended ? `the run did not end at the operation: ABEND ${abendText(ended)}` : 'the run did not abend at the operation';
  }
  return seen.some((r) => r.atSink) ? 'the operation ran without the marker in its operand'
    : ended ? `the run ended before the operation: ABEND ${abendText(ended)}` : 'the run did not reach the operation';
}

// Stages each program the job runs up to the finding's step, and the program the finding is in,
// in a library searched before the repository's, each with the options it compiles under; or why
// the job cannot run them. `steps` are the steps the copy of the JCL keeps.
function stagePrograms(f, root, ctx, job, steps, byAbend, staging) {
  const names = new Map();
  const paths = new Map();
  const carded = new Set();
  const copyDirs = new Set();
  const shapes = new Map();
  const upTo = job.parsed.steps.filter((s) => (!s.inProc && s.line <= job.step.line) || s === job.step);
  const stage = (path, as, extra) => {
    const compiled = compileOptions({ ...ctx, program: path, rewrite: undefined });
    if (compiled.why) return compiled.why;
    if (compiled.extended) ctx.extended = true;
    const options = [...extra, ...compiled.options];
    writeFileSync(join(staging, as), `${options.length ? `       CBL ${options.join(',')}\n` : ''}${readSource(path).text}`);
    names.set(as, basename(path));
    paths.set(basename(path), path);
    if (options.length) carded.add(as);
    copyDirs.add(dirname(path));
    return null;
  };
  const target = resolve(root, f.path);
  const ssrange = byAbend?.ssrange ? ['SSRANGE'] : [];
  for (const step of steps) {
    const pgm = step.pgm?.toUpperCase();
    if (!pgm || RUN_BY_IRONWORK.has(pgm)) continue;
    const found = programFor(pgm, root, ctx);
    if (found) shapes.set(step, fileShapes(programsOf(found.path, ctx.copyDirs)));
    if (!upTo.includes(step)) continue;
    if (!found) {
      const asm = ctx.assemblers?.get(pgm);
      if (asm) return { why: `step ${step.name} of the job runs ${pgm}, an assembler program (${asm}) ironwork does not run` };
      return { why: `step ${step.name} of the job runs ${pgm}, which no program library holds` };
    }
    if (names.has(found.as)) continue;
    const why = stage(found.path, found.as, found.path === target || (step === job.step && !isProgram(target)) ? ssrange : []);
    if (why && step === job.step) return { why };
  }
  if (isProgram(target) && ![...names.values()].includes(basename(target))) {
    const why = stage(target, basename(target), ssrange);
    if (why) return { why };
  }
  return { names, paths, carded, copyDirs: [...copyDirs], shapesOf: (step) => shapes.get(step) };
}

// The label of a jcl-instream finding from runs of its job, through the finding's step. `stamped`
// makes the label's fields for the strata the runs took. Where the job cannot be prepared,
// ironwork refuses it, or a run ends before the finding's step starts, the result is
// { jobNotRun } with why, and the caller labels the finding by running its program alone.
export function labelByJob(f, root, ctx, job, stamped) {
  const byAbend = ABENDS[ctx.sink];
  const dir = mkdtempSync(join(tmpdir(), 'cobolwork-label-jobplan-'));
  const unknown = (why, more = {}) => ({ ...stamped(ctx.extended), job: job.rel, label: 'unknown', why, ...more });
  try {
    const cut = cutAfter(job);
    const steps = job.parsed.steps.filter((s) => !cut.cut || s.line < cut.cut);
    const staging = join(dir, 'programs');
    mkdirSync(staging);
    const staged = stagePrograms(f, root, ctx, job, steps, byAbend, staging);
    if (staged.why) return { jobNotRun: staged.why };
    const card = (text) => text.slice(0, CARD);
    const dlm = job.dd.dlm;
    if (dlm && fills(byAbend).some((x) => x.text(CARD).startsWith(dlm))) return { jobNotRun: `the in-stream data ends at DLM=${dlm}, which a marker record would begin with` };
    const plan = { job, cut, staging, datasets: join(dir, 'datasets'), ...staged };
    const prepared = prepareDatasets(plan.datasets, root, ctx, steps, staged.shapesOf);
    if (prepared.why) return { jobNotRun: prepared.why };
    if (job.parsed.steps.some((s) => s.proc) || job.parsed.includes.length) {
      plan.procs = join(dir, 'procs');
      procedureLibrary(plan.procs, root);
    }
    ctx.parsed ||= new Map();
    try { ctx.runs = journalOf(ctx.evidence).run; } catch { /* no run yet */ }
    const seen = [];
    for (const fill of fills(byAbend)) {
      const variant = `in-stream ${fill.name}`;
      const r = runJob(f, ctx, plan, card(fill.text(CARD)));
      if (r.notRun) return { jobNotRun: r.notRun };
      if (!r.ran) return unknown(r.outcome, { variant });
      const short = stoppedShort(r, plan);
      if (short) return { jobNotRun: short };
      seen.push(r);
      if (!byAbend && r.reached) return { ...stamped(ctx.extended), job: job.rel, label: 'confirmed', run: r.run, variant, ...restedOn(r) };
      if (byAbend && byAbend.codes.includes(r.abendAtOperation)) {
        // The job with the control in the in-stream data must get past the operation, or the
        // abend is not the input's doing.
        const c = runJob(f, ctx, plan, card(controlOf(byAbend).repeat(CARD)));
        if (c.ran && !stoppedShort(c, plan) && !c.abendAtOperation) return { ...stamped(ctx.extended), job: job.rel, label: 'confirmed', run: r.run, variant, control: c.run, ...restedOn(r, c) };
        r.controlAbended = true;
      }
    }
    const atSink = seen.filter((r) => r.atSink);
    return unknown(whyNot(seen, byAbend, plan), { runs: seen.map((r) => r.run), ...restedOn(...seen), ...(ctx.traceInput && atSink.length ? { inputAtSink: combined(atSink.map((r) => r.input)) } : {}) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
