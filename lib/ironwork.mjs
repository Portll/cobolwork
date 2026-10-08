// SPDX-License-Identifier: AGPL-3.0-or-later
// `ironwork check` over every program in a tree: IBM Enterprise COBOL's front end as ironwork models
// it, for an estate whose compile step runs on z/OS and so never meets the build gate otherwise.
// ironwork is run as a separate program, as cobc is; nothing here links it.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, resolve, sep } from 'node:path';
import { directoryTree } from './kernel/source-tree.mjs';
import { printable } from './kernel/printable.mjs';
import { buildFileIndex } from './parser.mjs';
import { isProgram, relPath } from './sources.mjs';
import { EIB_FIELDS, DIB_FIELDS, SQLCA_FIELDS } from './words.mjs';
import { IRONWORK_FORMATS, MESSAGE_AREAS, MESSAGE_IDS, UNDEFINED_NAME } from './ironwork-ids.mjs';

// ironwork check exits with IBM's highest return code: 0 clean, 4 warnings only (compiled), 8 E,
// 12 S, 16 U. Only 0 and 4 produce a program; any other status is ironwork stopping on its own.
const COMPILED = new Set([0, 4]);
const REJECTED = new Set([8, 12, 16]);
const SEVERITIES = new Set(['I', 'W', 'E', 'S', 'U']);
const ERRORS = new Set(['E', 'S', 'U']);
export const DIAGNOSTICS = ['--diagnostics', 'json'];
const MESSAGE_ID = /^IW[A-Z]\d{4}$/;
const PER_PROGRAM_MS = 60000;
const MAX_LISTED = 10;
const TRANSLATOR_NAMES = [EIB_FIELDS, DIB_FIELDS, SQLCA_FIELDS];

// A diagnostic can quote a literal from the program, and no output of the gate carries source text.
const redact = (s) => String(s).replace(/'[^']*'|"[^"]*"/g, "'…'");

// The name the source holds where a message is placed; `sources` keeps each file's lines once read.
function nameAt(m, sources) {
  if (!m.file || !m.line || !m.col) return null;
  if (!sources.has(m.file)) {
    let lines = null;
    try { lines = readFileSync(m.file, 'latin1').split(/\r?\n/); } catch { /* unreadable: no name */ }
    sources.set(m.file, lines);
  }
  const row = sources.get(m.file)?.[m.line - 1];
  return row ? /^[A-Za-z0-9][A-Za-z0-9-]*/.exec(row.slice(m.col - 1))?.[0].toUpperCase() ?? null : null;
}

// What a message is about, by its id alone (ironwork-ids.mjs): 'program', a rule the program
// breaks; 'refused' or 'limit', what ironwork does not model or cannot hold; 'translator', a field a
// CICS, DL/I or SQL translator declares, named by the source at the message's position;
// 'unresolved', a member no copy library holds; 'invocation', how ironwork was run; 'unknown', an id
// in an area this cobolwork does not read, or no id.
export function messageClass(m, sources = new Map()) {
  if (typeof m.id !== 'string' || !MESSAGE_ID.test(m.id)) return 'unknown';
  if (MESSAGE_IDS[m.id]) return MESSAGE_IDS[m.id];
  if (m.id === UNDEFINED_NAME) {
    const name = nameAt(m, sources);
    if (name && TRANSLATOR_NAMES.some((s) => s.has(name))) return 'translator';
  }
  return MESSAGE_AREAS[m.id[2]] ?? 'unknown';
}

function diagnostic(line) {
  if (!line.startsWith('{')) return null;
  try {
    const d = JSON.parse(line);
    return d && typeof d === 'object' && !Array.isArray(d) && typeof d.message === 'string' ? d : null;
  } catch { return null; }
}

// ironwork's messages under --diagnostics json, one object a line: `file` the program as passed,
// `member` the COPY member the position is in or null. `path` is where the message is, from the
// root; `file` the absolute file the position is in. Any other line is ironwork's own, with no id.
export function parseMessages(stderr, { root, program }) {
  const top = resolve(root);
  const under = top.endsWith(sep) ? top : top + sep;
  const named = (file) => {
    if (!isAbsolute(file)) return printable(file, 120);
    const p = resolve(file);
    return p === top || p.startsWith(under) ? relPath(top, p) : printable(file, 120);
  };
  const main = resolve(program);
  const out = [];
  for (const line of String(stderr || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const d = diagnostic(line);
    if (!d) { out.push({ id: null, severity: null, text: printable(redact(line), 200), path: named(main), line: null, col: null, file: null }); continue; }
    const member = typeof d.member === 'string' && d.member ? d.member : null;
    const at = Number.isInteger(d.line) && d.line > 0 ? d.line : null;
    out.push({
      id: typeof d.id === 'string' ? d.id : null, severity: SEVERITIES.has(d.severity) ? d.severity : null,
      text: printable(redact(d.message), 200), path: named(member ?? main), ...(member ? { member: named(member) } : {}),
      line: at, col: at && Number.isInteger(d.col) ? d.col : null, file: member ? (isAbsolute(member) ? member : null) : main,
    });
  }
  return out;
}

export function ironworkVersion(path, { env = process.env } = {}) {
  const r = spawnSync(path, ['--version'], { cwd: tmpdir(), env, encoding: 'utf8', timeout: 10000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 ? printable(String(r.stdout).trim(), 80) || null : null;
}

// The release `ironwork --version` names where it is older than the first that writes
// --diagnostics json; null where it is not, or names none.
function olderThanDiagnostics(said) {
  const v = /(\d+)\.(\d+)\.(\d+)/.exec(said || '');
  if (!v) return null;
  const want = IRONWORK_FORMATS['diagnostics-json'].split('.').map(Number);
  const k = [1, 2, 3].findIndex((i) => Number(v[i]) !== want[i - 1]);
  return k >= 0 && Number(v[k + 1]) < want[k] ? v[0] : null;
}

export const duration = (ms) => (ms >= 60000 ? `${Math.round(ms / 60000)}-minute` : `${Math.max(0, Math.round(ms / 1000))}-second`);

const entry = (m, rel) => ({ path: rel, ...(m.line ? { line: m.line, col: m.col } : {}), ...(m.member ? { member: m.member } : {}), ...(m.id ? { id: m.id } : {}), message: m.text });

// Runs `ironwork check` on each program under `root`, with the tree's copy directories and the
// estate's copy libraries as -I, and sorts the programs by exit status and then by the ids of their
// errors: those it accepts, those it rejects for their own errors, and those it could not decide: a
// construct it does not model, a copybook the tree lacks, an id this cobolwork does not read, or a
// run that ended some other way. `checked` keeps every message of every program's run; with
// `extended`, a program it rejects is checked again under --compliance extended. Past `maxPrograms`
// or `budgetMs` a program is not checked, and `bounded` names the limit.
export function checkWithIronwork(path, root, { allow = null, programs: given = null, copyDirs = null, copylibs = [], env = process.env, extended = false, maxPrograms = Infinity, budgetMs = Infinity } = {}) {
  const programs = given || [...new Set(directoryTree(root).list())].filter((p) => isProgram(p) && (!allow || allow.has(p))).sort();
  const libraries = [...(copyDirs || buildFileIndex(root).copyDirs), ...copylibs].flatMap((d) => ['-I', d]);
  const out = { programs: programs.length, accepted: 0, warned: 0, failed: [], notModelled: [], unresolved: [], unread: [], unrun: [], checked: [], bounded: { cap: false, budget: false, extendedSkipped: 0 } };
  const old = olderThanDiagnostics(ironworkVersion(path, { env }));
  const deadline = Date.now() + budgetMs;
  const check = (file, more = []) => spawnSync(path, ['check', file, ...more, ...DIAGNOSTICS, ...libraries], {
    cwd: tmpdir(), env, encoding: 'utf8', timeout: PER_PROGRAM_MS, maxBuffer: 1 << 20, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
  });
  for (const [n, file] of programs.entries()) {
    const rel = relPath(root, file);
    if (n >= maxPrograms || Date.now() > deadline) {
      out.bounded[n >= maxPrograms ? 'cap' : 'budget'] = true;
      out.unrun.push({ path: rel, why: n >= maxPrograms ? `not checked: past the cap of ${maxPrograms} programs` : `not checked: past the ${duration(budgetMs)} budget` });
      continue;
    }
    if (old) {
      out.unrun.push({ path: rel, why: `ironwork ${old} writes no --diagnostics json, which cobolwork reads from ironwork ${IRONWORK_FORMATS['diagnostics-json']}` });
      continue;
    }
    const r = check(file);
    const record = { path: rel, file, status: r.status ?? null, messages: parseMessages(r.stderr, { root, program: file }), extended: null };
    out.checked.push(record);
    if (COMPILED.has(r.status)) { out.accepted++; if (r.status === 4) out.warned++; continue; }
    const errors = REJECTED.has(r.status) ? record.messages.filter((m) => ERRORS.has(m.severity)) : [];
    if (!errors.length) {
      const why = r.error ? (r.error.code === 'ETIMEDOUT' ? `no answer in ${PER_PROGRAM_MS / 1000}s` : r.error.message)
        : `ironwork exited ${r.status ?? r.signal}${REJECTED.has(r.status) ? ' and gave no error message' : ''}`;
      out.unrun.push({ path: rel, why: printable(why, 200) });
      continue;
    }
    const sources = new Map();
    const classes = errors.map((m) => messageClass(m, sources));
    const first = (c) => entry(errors[classes.indexOf(c)], rel);
    if (classes.includes('program')) {
      out.failed.push({ ...first('program'), errors: classes.filter((c) => c === 'program').length });
      if (!extended) continue;
      if (Date.now() > deadline) { out.bounded.extendedSkipped++; continue; }
      const x = check(file, ['--compliance', 'extended']);
      record.extended = { status: x.status ?? null, compiled: COMPILED.has(x.status), messages: parseMessages(x.stderr, { root, program: file }) };
    } else if (classes.includes('unknown')) out.unread.push(first('unknown'));
    else if (classes.includes('invocation')) {
      const m = errors[classes.indexOf('invocation')];
      out.unrun.push({ path: rel, why: printable(`ironwork stopped on how it was run, not on the program: ${m.id} ${m.text}`, 200) });
    } else if (classes.includes('unresolved')) out.unresolved.push(first('unresolved'));
    else out.notModelled.push(entry(errors[0], rel));
  }
  return out;
}

// The compile check from a checkWithIronwork result: false where a program does not compile, null
// where every program that did not pass is one ironwork could not decide, true otherwise.
export function ironworkVerdict(result) {
  if (result.failed.length) return false;
  return result.notModelled.length || result.unresolved.length || result.unread.length || result.unrun.length ? null : true;
}

export function ironworkReasons(result) {
  const reasons = [];
  const at = (d) => `${d.path}${d.line ? `:${d.line}:${d.col}` : ''}${d.member ? ` (in ${d.member})` : ''}${d.id ? ` ${d.id}` : ''}`;
  if (result.failed.length) {
    reasons.push(`ironwork check: ${result.failed.length} of ${result.programs} program(s) do not compile as Enterprise COBOL`);
    for (const d of result.failed.slice(0, MAX_LISTED)) reasons.push(`${at(d)}: ${d.message}`);
  }
  if (result.notModelled.length) reasons.push(`ironwork check: ${result.notModelled.length} program(s) use what ironwork does not model yet, so whether they compile is not decided; the first is ${at(result.notModelled[0])}: ${result.notModelled[0].message}`);
  if (result.unresolved.length) reasons.push(`ironwork check: ${result.unresolved.length} program(s) copy a member the copy libraries do not hold; name the estate's with --copylib`);
  if (result.unread.length) reasons.push(`ironwork check: ${result.unread.length} program(s) stop at a message whose id this cobolwork does not read, so whether they compile is not decided; the first is ${at(result.unread[0])}: ${result.unread[0].message}`);
  if (result.unrun.length) reasons.push(`ironwork check: ${result.unrun.length} program(s) were not checked; the first, ${result.unrun[0].path}: ${result.unrun[0].why}`);
  return reasons;
}

export const listed = (result) => ({
  programs: result.programs, accepted: result.accepted, warned: result.warned,
  failed: result.failed.slice(0, MAX_LISTED), notModelled: result.notModelled.slice(0, MAX_LISTED),
  unresolved: result.unresolved.slice(0, MAX_LISTED), unread: result.unread.slice(0, MAX_LISTED), unrun: result.unrun.slice(0, MAX_LISTED),
  counts: { failed: result.failed.length, notModelled: result.notModelled.length, unresolved: result.unresolved.length, unread: result.unread.length, unrun: result.unrun.length },
});
