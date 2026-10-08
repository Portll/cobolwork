// SPDX-License-Identifier: AGPL-3.0-or-later
// Abends an input caused, from the runs ironwork's fuzzing harness kept (docs/spec/evidence.md §13.6).
//
// A fuzz run is a directory: manifest.json names the program, the inputs and each run that ended in
// an abend, and evidence/ holds each kept run's hash-chained journal. A finding is reported only
// where the evidence verifies and the run's own journal records the abend the manifest claims, so
// the finding rests on a record of the run rather than on the manifest's word.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { delimiter, join, posix, basename } from 'node:path';
import { report } from '../kernel/ruleset.mjs';
import { verifyEvidence } from '../evidence/verify.mjs';
import { NOT_RUN_ABENDS } from '../ironwork-ids.mjs';
import { IBM } from '../kernel/manuals.mjs';

export const ABEND_RULES = {
  'input-causes-abend-s0c7': {
    sev: 'med', evidence: 'execution', cwe: 'CWE-20',
    text: 'An input the program accepts ends its run with a data exception (S0C7)',
    impact: 'Whoever supplies that input can stop the program at will: a batch step abends and the job behind it does not finish, a transaction abends at the terminal',
    remedy: 'Test the field with IS NUMERIC, or validate the record, before the arithmetic or MOVE the journal names, and reject the input rather than letting the data exception end the run',
    references: [IBM.classCondition, IBM.numericClassTest],
  },
  'input-causes-abend-s0c4': {
    sev: 'high', evidence: 'execution', cwe: 'CWE-119',
    text: 'An input the program accepts ends its run with a protection exception (S0C4)',
    impact: 'The input made the program address storage it does not own; the same input under another layout can read or overwrite other data before anything stops it',
    remedy: 'Find the subscript, reference modification, pointer or parameter length the input controls at the line the journal names, and bound it before use',
  },
  'input-causes-abend-subscript-range': {
    sev: 'high', evidence: 'execution', cwe: 'CWE-129',
    text: 'An input the program accepts drives a subscript or reference modification out of range, and the run abends',
    impact: 'SSRANGE caught the overrun and ended the run; compiled without SSRANGE, as production builds often are, the same input reads or writes storage beside the table or field',
    remedy: 'Check the index against both ends of the table or field before the statement the journal names, and keep SSRANGE on for the build',
    references: [IBM.ssrange],
  },
  'input-causes-hang': {
    sev: 'med', evidence: 'execution', cwe: 'CWE-834',
    text: 'An input the program accepts keeps a loop running past the statement limit that stands in for its time limit (S322)',
    impact: 'Whoever supplies that input decides how long the loop runs; on z/OS a long enough run holds the step and its processor until TIME= ends it, and the jobs behind it wait. The run shows the loop passed the limit, not that it would never end',
    remedy: 'Find the loop at the line the journal names and bound its iterations: check the count or the exit condition the input supplies before the loop starts, or stop it at a counter and reject the input that would pass it',
  },
  'input-selects-program': {
    sev: 'high', evidence: 'execution', cwe: 'CWE-470',
    text: 'An input the program accepts chooses the program a CALL loads',
    impact: "Whoever supplies that input picks which load module runs with this program's authority and data; the fuzz run named one the library does not hold, so the run ended in S806, but a name the library does hold runs",
    remedy: 'Choose the called program from a fixed set of names checked against the input, or call it by a literal name, at the CALL the journal names',
  },
  'input-causes-abend': {
    sev: 'med', evidence: 'execution', cwe: 'CWE-248',
    text: 'An input the program accepts ends its run with an abend',
    impact: 'Whoever supplies that input can stop the program at will, and the abend code says what the program failed to handle',
    remedy: 'Read the abend code and the line the journal names, and handle the condition the input raises before it ends the run',
  },
};

// What the manifest's `optimized` says of an abend: whether the same input ends the same way with
// the program compiled at OPTIMIZE(2), where IBM may compare invalid data by its bytes rather than
// end in a data exception at OPTIMIZE(0), its default.
const OPTIMIZED = {
  true: '; compiled with OPTIMIZE(2) it ends the same way',
  false: '; it holds at OPTIMIZE(0), IBM\'s default: compiled with OPTIMIZE(2) the same input does not end there',
};

// IBM's messages for an SSRANGE failure: a subscript or index, an OCCURS DEPENDING ON object, and a
// reference modification's start, length, and start plus length.
const RANGE_MESSAGES = /^IGZ00(06|07|72|73|74)S\b/;

// Language Environment's message for a dynamic CALL of a module no library holds, by its id, which
// ironwork ends U4038 (its assumption C450); earlier ironwork releases ended the same CALL S806.
const MODULE_NOT_FOUND = /^CEE3501S\b/;

export function abendRunPaths(opts = {}) {
  if (opts.abendRuns) return opts.abendRuns;
  return (process.env.COBOLWORK_ABENDS || '').split(delimiter).filter(Boolean);
}

// How ironwork ends the message of a data or protection exception in a CICS task, whose abend
// code CICS reports as ASRA.
const CICS_PROGRAM_CHECK = /\((S0C7|S0C4), which CICS reports as ASRA\)$/;

// How ironwork ends the message of a Language Environment condition in a CICS task, U4038 in
// batch, which CICS reports as transaction abend 4038 (its assumption C454).
const CICS_LE_CONDITION = / \(U4038, which CICS reports as transaction abend 4038\)$/;

export function abendRule(abend) {
  const cicsLe = abend.code === '4038' && CICS_LE_CONDITION.test(abend.message || '');
  const message = cicsLe ? abend.message.replace(CICS_LE_CONDITION, '') : abend.message || '';
  const code = cicsLe ? 'U4038' : (abend.code === 'ASRA' && CICS_PROGRAM_CHECK.exec(message)?.[1]) || abend.code;
  if (code === 'S0C7') return 'input-causes-abend-s0c7';
  if (code === 'S0C4') return 'input-causes-abend-s0c4';
  if (code === 'S322') return 'input-causes-hang';
  if (code === 'S806' || (code === 'U4038' && MODULE_NOT_FOUND.test(message))) return 'input-selects-program';
  if (RANGE_MESSAGES.test(message)) return 'input-causes-abend-subscript-range';
  return 'input-causes-abend';
}

// The abend a kept run's own journal records, with the sources it read and the programs it CALLed,
// or null.
function journalAbend(evidenceDir, runId) {
  if (typeof runId !== 'string' || !/^[0-9TZ]+-[0-9a-f]{16}$/.test(runId)) return null;
  const file = join(evidenceDir, 'runs', `${runId}.jsonl`);
  if (!existsSync(file)) return null;
  let abend = null;
  const inputs = [];
  const calls = [];
  const sinks = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    const rec = JSON.parse(line);
    if (rec.kind === 'abend') abend ??= rec;
    else if (rec.kind === 'input') inputs.push(rec);
    else if (rec.kind === 'call') calls.push(rec);
    else if (rec.kind === 'sink') sinks.push(rec);
  }
  return abend && { ...abend, inputs, calls, sinks };
}

const MANIFEST_FORMAT = 'ironwork-fuzz/v1';
// A subprogram fuzzed at its interface: its inputs are arguments, and a caller passing them is
// not shown to exist (ironwork docs/evidence.md §5.2).
const INTERFACE_FORMAT = 'ironwork-fuzz-interface/v1';
const FORMATS = [MANIFEST_FORMAT, INTERFACE_FORMAT];

// What a finding from an interface run says of the caller its input needs.
function interfaceClause(callers) {
  const where = callers.length
    ? `with arguments shaped by the CALL${callers.length === 1 ? '' : 's'} at ${callers.map((c) => `${c.file}:${c.line}`).join(', ')}`
    : 'on generated arguments, with no CALL to it in the scanned tree';
  return `; it ran as a subprogram, ${where}, on its first call in its initial state: a caller passing these bytes ends it, and no caller run shows one does`;
}

// ironwork's own abend codes for a construct it does not run: no IBM system would raise them.
const NOT_MODELLED = new Set(NOT_RUN_ABENDS);

const isString = (x) => typeof x === 'string' && x.length > 0;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// A manifest root as a directory of the scanned tree, or null when it is not one.
function treeDir(dir) {
  if (typeof dir !== 'string') return null;
  const norm = posix.normalize(dir.replace(/\\/g, '/'));
  return norm === '..' || norm.startsWith('../') || posix.isAbsolute(norm) ? null : norm;
}

// The directory in the scanned tree of the root the run read `file` from, located by the manifest's
// roots: the root the journal's input record for that file names, or for a CALLed program's source,
// which its call record names by path and digest alone, the root under which the tree holds that
// file with that digest. Undefined where neither record names the file, null where the root cannot
// be told or lies outside the tree.
function rootDirectory(roots, journal, file, tree) {
  if (!Array.isArray(roots)) return undefined;
  const held = [...new Set(journal.inputs.filter((i) => i.path === file && Number.isInteger(i.root)).map((i) => i.root))];
  if (held.length) return held.length === 1 ? treeDir(roots[held[0]]) : null;
  const digests = new Set(journal.calls.filter((c) => c.from === file).map((c) => c.sha256));
  if (!digests.size || !tree) return undefined;
  const holding = [...new Set(roots.map(treeDir).filter((d) => d !== null && existsSync(join(tree, d, file))))];
  const same = holding.filter((d) => digests.has(sha256(readFileSync(join(tree, d, file)))));
  const found = same.length ? same : holding;
  return found.length === 1 ? found[0] : null;
}

// One fuzz run: its findings, and what kept any of it from counting. `tree` is the scanned tree,
// where a CALLed program's source is looked for.
export function loadAbendRun(dir, tree) {
  const out = { dir: basename(dir), program: null, findings: [], problems: [], counts: null, notModelled: 0 };
  let doc;
  try { doc = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')); } catch (e) {
    out.problems.push(e.code ? `manifest.json could not be read (${e.code})` : `manifest.json is not JSON (${e.message})`);
    return out;
  }
  if (!doc || doc.tool !== 'ironwork-fuzz' || !doc.program || !isString(doc.program.file) || !Array.isArray(doc.inputs) || !Array.isArray(doc.runs)) {
    out.problems.push('manifest.json is not an ironwork-fuzz manifest with a program, inputs and runs');
    return out;
  }
  // A manifest from before ironwork wrote `format` has the first format's shape.
  if (doc.format !== undefined && !FORMATS.includes(doc.format)) {
    out.problems.push(`manifest.json is in format ${JSON.stringify(doc.format)}, and this cobolwork reads ${FORMATS.join(' and ')}`);
    return out;
  }
  const inputFrom = doc.format === INTERFACE_FORMAT ? 'interface' : 'entry';
  const callers = inputFrom === 'interface' && Array.isArray(doc.callers)
    ? doc.callers.filter((c) => c && isString(c.file) && Number.isInteger(c.line)).map((c) => ({ file: posix.normalize(c.file.replace(/\\/g, '/')), line: c.line }))
    : [];
  const programFile = posix.normalize(doc.program.file.replace(/\\/g, '/'));
  if (programFile.startsWith('../') || posix.isAbsolute(programFile)) {
    out.problems.push(`the program ${doc.program.file} is outside the scanned tree`);
    return out;
  }
  out.program = { file: programFile, id: isString(doc.program.id) ? doc.program.id : null };
  out.counts = doc.counts && typeof doc.counts === 'object' ? doc.counts : null;

  const evidenceDir = join(dir, 'evidence');
  const verdict = verifyEvidence(evidenceDir);
  if (!verdict.verified) {
    out.problems.push(`its evidence does not verify: ${verdict.broken.map((b) => `${b.file}:${b.line} ${b.check}`).join(', ') || 'nothing is recorded'}`);
    return out;
  }
  const inputs = new Map(doc.inputs.filter((i) => i && isString(i.id)).map((i) => [i.id, i]));
  const seen = new Map();
  for (const run of doc.runs) {
    if (!run || run.outcome !== 'abend' || !run.abend || !isString(run.abend.code)) continue;
    if (NOT_MODELLED.has(run.abend.code)) { out.notModelled++; continue; }
    const recorded = journalAbend(evidenceDir, run.journal);
    if (!recorded || recorded.code !== run.abend.code) {
      out.problems.push(`run ${run.journal ?? '(unnamed)'}: its journal does not record the abend ${run.abend.code} the manifest gives`);
      continue;
    }
    // Where the journal names the abend's place, that is the place, and a manifest that says otherwise is not believed.
    const claimed = { file: run.abend.file, line: run.abend.line };
    const place = isString(recorded.file) && Number.isInteger(recorded.line) ? { file: recorded.file, line: recorded.line } : claimed;
    if (place !== claimed && ((isString(claimed.file) && claimed.file !== place.file) || (claimed.line != null && claimed.line !== place.line))) {
      out.problems.push(`run ${run.journal}: its journal records the abend at ${place.file}:${place.line}, not where the manifest puts it`);
      continue;
    }
    const rootDir = isString(place.file) ? rootDirectory(doc.roots, recorded, place.file, tree) : undefined;
    if (rootDir === null) {
      out.problems.push(`run ${run.journal}: the abend is in ${place.file}, which its journal and manifest do not place in the scanned tree`);
      continue;
    }
    const where = isString(place.file) ? posix.normalize(posix.join(rootDir ?? posix.dirname(programFile), place.file.replace(/\\/g, '/'))) : programFile;
    const line = Number.isInteger(place.line) && place.line > 0 ? place.line : 1;
    const rule = abendRule(run.abend);
    // A CALL of a missing program is input choosing the program only where the run's own journal
    // records the marker fuzz put in the input reaching that CALL's program load.
    if (rule === 'input-selects-program' && !recorded.sinks.some((k) => k.sink === 'dynamic-program-load' && k.reached === true && k.file === place.file && k.line === place.line)) {
      out.problems.push(`run ${run.journal}: its journal does not record the input reaching the CALL at ${place.file}:${place.line}, so its missing-program ending is not reported`);
      continue;
    }
    const used = (Array.isArray(run.input) ? run.input : []).map((id) => inputs.get(id)).filter(Boolean)
      .map((i) => ({ kind: i.kind, name: i.name, bytes: i.bytes, ...(i.minimized ? { minimized: true } : {}), ...(Number.isInteger(i.position) ? { position: i.position } : {}), ...(i.omitted === true ? { omitted: true } : {}) }));
    const key = `${rule}|${where}|${line}`;
    const size = used.reduce((n, i) => n + String(i.bytes || '').length, 0);
    const held = seen.get(key);
    if (held && held.size <= size) continue;
    const optimized = typeof run.abend.optimized === 'boolean' ? run.abend.optimized : undefined;
    const finding = {
      rule, path: where, line, program: out.program.id,
      detail: `${out.program.id || programFile} ended with ${run.abend.code}${isString(run.abend.message) ? ` (${run.abend.message})` : ''} on an input the fuzz run ${out.dir} kept${OPTIMIZED[optimized] ?? ''}${inputFrom === 'interface' ? interfaceClause(callers) : ''}`,
      abend: { code: run.abend.code, ...(isString(run.abend.message) ? { message: run.abend.message } : {}), ...(optimized === undefined ? {} : { optimized }), inputFrom, ...(inputFrom === 'interface' ? { callers } : {}) },
      input: used, run: { dir: out.dir, journal: run.journal },
    };
    seen.set(key, { size, finding });
  }
  out.findings = [...seen.values()].map((s) => s.finding);
  return out;
}

export function scanAbend(root, opts = {}) {
  const dirs = abendRunPaths(opts);
  const runs = dirs.map((d) => loadAbendRun(d, root));
  const findings = runs.flatMap((r) => r.findings.filter((f) => existsSync(join(root, f.path))));
  const stats = {
    filesScanned: 0, filesUnreadable: 0,
    abendRuns: runs.map((r) => ({ dir: r.dir, program: r.program ? r.program.file : null, findings: r.findings.length, ...(r.notModelled ? { notModelled: r.notModelled } : {}), ...(r.counts ? { counts: r.counts } : {}) })),
    ...(runs.some((r) => r.problems.length) ? { abendRunProblems: runs.flatMap((r) => r.problems.map((p) => `${r.dir}: ${p}`)) } : {}),
    ...(runs.some((r) => r.findings.some((f) => !existsSync(join(root, f.path)))) ? { abendRunsElsewhere: runs.flatMap((r) => r.findings.filter((f) => !existsSync(join(root, f.path))).map((f) => `${r.dir}: ${f.path}`)) } : {}),
    byInputFrom: { entry: findings.filter((f) => f.abend.inputFrom === 'entry').length, interface: findings.filter((f) => f.abend.inputFrom === 'interface').length },
    setIncomplete: runs.some((r) => r.problems.length > 0),
  };
  return report('abend', { rules: ABEND_RULES, findings, stats, run: null });
}

