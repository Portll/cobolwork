// SPDX-License-Identifier: AGPL-3.0-or-later
// `ironwork check` over every program in a tree: IBM Enterprise COBOL's front end as ironwork models
// it, for an estate whose compile step runs on z/OS and so never meets the build gate otherwise.
// ironwork is run as a separate program, as cobc is; nothing here links it.
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { directoryTree } from './kernel/source-tree.mjs';
import { printable } from './kernel/printable.mjs';
import { buildFileIndex } from './parser.mjs';
import { isProgram, relPath } from './sources.mjs';
import { EIB_FIELDS, DIB_FIELDS, SQLCA_FIELDS } from './words.mjs';

// ironwork check exits with IBM's highest return code: 0 clean, 4 warnings only (compiled), 8 E,
// 12 S, 16 U. Only 0 and 4 produce a program.
const COMPILED = new Set([0, 4]);
const REJECTED = new Set([8, 12, 16]);
// ironwork grades a refusal by name as severe (12), so a run that ends at 8 holds only IBM-graded
// errors in the program, whatever their wording says; the wording decides only at 12 and 16.
const GRADED_ERROR = 8;
// Warnings and informational lines follow the errors, and say nothing about why a program failed.
// The label follows the position, or opens a line that has none.
const NOT_AN_ERROR = /(?:^|: )(?:warning|informational): /;
// ironwork opens a message with its id and severity, `IWC0101-S`, as IBM opens its own.
const MESSAGE_ID = /^((?:IW[A-Z]|IGY[A-Z]{2})\d{4})-[IWESU] (.*)$/;
const PER_PROGRAM_MS = 60000;
const MAX_LISTED = 10;

// ironwork refuses by name what it does not model yet, with an IWR id; that says nothing about the
// program. An IWS, IWC or IGY id is a rule the program broke, whatever its wording says; the words
// decide only for a message without an id. A name the CICS, DL/I or SQL translator declares it reports
// as undefined (IWC0001), without saying so, and that is read as its gap, not the program's.
const NOT_SUPPORTED = /\bnot supported\b/i;
const TRANSLATOR_NAMES = [EIB_FIELDS, DIB_FIELDS, SQLCA_FIELDS];
const translatorName = (message) => {
  const name = /^([A-Z][A-Z0-9-]*) is not defined$/.exec(message);
  return !!name && TRANSLATOR_NAMES.some((s) => s.has(name[1]));
};
function notModelled({ id, message }) {
  if (id ? id.startsWith('IWR') : NOT_SUPPORTED.test(message)) return true;
  return translatorName(message);
}
// A copy library the tree does not hold leaves the program unread, as it does for the scan.
const UNRESOLVED = /\bno such member in the copy libraries\b/i;

// Whether a parsed message says something about ironwork or the copy libraries rather than the
// program: a refusal by name (IWR), one of ironwork's own limits (IWL), a field a translator
// declares, or a member no library holds.
export function aboutIronwork({ id, text }) {
  if (id && (id.startsWith('IWR') || id.startsWith('IWL'))) return true;
  return translatorName(text) || UNRESOLVED.test(text);
}
// A diagnostic can quote a literal from the program, and no output of the gate carries source text.
const redact = (s) => String(s).replace(/'[^']*'|"[^"]*"/g, "'…'");

// `file:line:col: message` or `file: message`, as ironwork's Error::place writes them. `file` is the
// program as it was passed, or the COPY member the position is in.
function diagnostic(line, programPath, rel) {
  const m = /^(.*?):(\d+):(\d+): (.*)$/.exec(line) || /^(.*?): (.*)$/.exec(line);
  if (!m) return { path: rel, message: printable(redact(line), 200) };
  const [file, ln, col, text] = m.length === 5 ? [m[1], Number(m[2]), Number(m[3]), m[4]] : [m[1], null, null, m[2]];
  const inProgram = resolve(file) === programPath;
  const [, id, said] = MESSAGE_ID.exec(text) || [null, null, text];
  return {
    path: rel, ...(ln ? { line: ln, col } : {}), ...(inProgram ? {} : { member: printable(file, 80) }), ...(id ? { id } : {}),
    message: printable(redact(said), 200),
  };
}

// One message a line, as `path[:line:col]: [warning: |informational: ]IWC0055-W text`: the path is
// the program as passed or the COPY member the message is in. A line with no id keeps its text.
const MESSAGE_AT = /(?:^|: )(?:(?:warning|informational): )?((?:IW[A-Z]|IGY[A-Z]{2})\d{4})-([IWESU]) /;
export function parseMessages(stderr, { root, program }) {
  const top = resolve(root);
  const under = top.endsWith(sep) ? top : top + sep;
  const named = (file) => {
    const p = resolve(file);
    return p === top || p.startsWith(under) ? relPath(top, p) : printable(file, 120);
  };
  const out = [];
  for (const line of String(stderr || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const m = MESSAGE_AT.exec(line);
    if (!m) { out.push({ id: null, severity: null, text: printable(redact(line), 200), path: named(program), line: null }); continue; }
    const head = line.slice(0, m.index);
    const placed = /^(.*):(\d+):(\d+)$/.exec(head);
    const file = placed ? placed[1] : head;
    out.push({
      id: m[1], severity: m[2], text: printable(redact(line.slice(m.index + m[0].length)), 200),
      path: named(file || program), line: placed ? Number(placed[2]) : null,
    });
  }
  return out;
}

export function ironworkVersion(path, { env = process.env } = {}) {
  const r = spawnSync(path, ['--version'], { cwd: tmpdir(), env, encoding: 'utf8', timeout: 10000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 ? printable(String(r.stdout).trim(), 80) || null : null;
}

export const duration = (ms) => (ms >= 60000 ? `${Math.round(ms / 60000)}-minute` : `${Math.max(0, Math.round(ms / 1000))}-second`);

// Runs `ironwork check` on each program under `root`, with the tree's copy directories and the
// estate's copy libraries as -I, and sorts the programs into those it accepts, those it rejects,
// and those it could not decide: a construct it does not model, a copybook the tree lacks, or a
// run that ended some other way. `checked` keeps every message of every program's run; with
// `extended`, a program it rejects is checked again under --compliance extended. Past `maxPrograms`
// or `budgetMs` a program is not checked, and `bounded` names the limit.
export function checkWithIronwork(path, root, { allow = null, programs: given = null, copyDirs = null, copylibs = [], env = process.env, extended = false, maxPrograms = Infinity, budgetMs = Infinity } = {}) {
  const programs = given || [...new Set(directoryTree(root).list())].filter((p) => isProgram(p) && (!allow || allow.has(p))).sort();
  const libraries = [...(copyDirs || buildFileIndex(root).copyDirs), ...copylibs].flatMap((d) => ['-I', d]);
  const out = { programs: programs.length, accepted: 0, warned: 0, failed: [], notModelled: [], unresolved: [], unrun: [], checked: [], bounded: { cap: false, budget: false, extendedSkipped: 0 } };
  const deadline = Date.now() + budgetMs;
  const check = (file, more = []) => spawnSync(path, ['check', file, ...more, ...libraries], {
    cwd: tmpdir(), env, encoding: 'utf8', timeout: PER_PROGRAM_MS, maxBuffer: 1 << 20, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
  });
  for (const [n, file] of programs.entries()) {
    const rel = relPath(root, file);
    if (n >= maxPrograms || Date.now() > deadline) {
      out.bounded[n >= maxPrograms ? 'cap' : 'budget'] = true;
      out.unrun.push({ path: rel, why: n >= maxPrograms ? `not checked: past the cap of ${maxPrograms} programs` : `not checked: past the ${duration(budgetMs)} budget` });
      continue;
    }
    const r = check(file);
    const record = { path: rel, file, status: r.status ?? null, messages: parseMessages(r.stderr, { root, program: file }), extended: null };
    out.checked.push(record);
    if (COMPILED.has(r.status)) { out.accepted++; if (r.status === 4) out.warned++; continue; }
    if (!REJECTED.has(r.status)) {
      const why = r.error ? (r.error.code === 'ETIMEDOUT' ? `no answer in ${PER_PROGRAM_MS / 1000}s` : r.error.message) : `ironwork exited ${r.status ?? r.signal}`;
      out.unrun.push({ path: rel, why: printable(why, 200) });
      continue;
    }
    const found = String(r.stderr || '').split(/\r?\n/).filter((l) => l && !NOT_AN_ERROR.test(l)).map((l) => diagnostic(l, resolve(file), rel));
    const errors = found.filter((d) => !(r.status !== GRADED_ERROR && notModelled(d)) && !UNRESOLVED.test(d.message));
    if (errors.length) {
      out.failed.push({ ...errors[0], errors: errors.length });
      if (!extended) continue;
      if (Date.now() > deadline) { out.bounded.extendedSkipped++; continue; }
      const x = check(file, ['--compliance', 'extended']);
      record.extended = { status: x.status ?? null, compiled: COMPILED.has(x.status), messages: parseMessages(x.stderr, { root, program: file }) };
    } else if (found.some((d) => UNRESOLVED.test(d.message))) out.unresolved.push(found.find((d) => UNRESOLVED.test(d.message)));
    else out.notModelled.push(found[0] || { path: rel, message: `ironwork exited ${r.status} and gave no error` });
  }
  return out;
}

// The compile check from a checkWithIronwork result: false where a program does not compile, null
// where every program that did not pass is one ironwork could not decide, true otherwise.
export function ironworkVerdict(result) {
  if (result.failed.length) return false;
  return result.notModelled.length || result.unresolved.length || result.unrun.length ? null : true;
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
  if (result.unrun.length) reasons.push(`ironwork check: ${result.unrun.length} program(s) were not checked; the first, ${result.unrun[0].path}: ${result.unrun[0].why}`);
  return reasons;
}

export const listed = (result) => ({
  programs: result.programs, accepted: result.accepted, warned: result.warned,
  failed: result.failed.slice(0, MAX_LISTED), notModelled: result.notModelled.slice(0, MAX_LISTED),
  unresolved: result.unresolved.slice(0, MAX_LISTED), unrun: result.unrun.slice(0, MAX_LISTED),
  counts: { failed: result.failed.length, notModelled: result.notModelled.length, unresolved: result.unresolved.length, unrun: result.unrun.length },
});
