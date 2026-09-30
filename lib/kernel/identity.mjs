// SPDX-License-Identifier: AGPL-3.0-or-later
// What a finding is, as distinct from where it is printed today.
//
// A report that cannot say a finding is the one it reported yesterday cannot say fixed, new or
// regressed, and a baseline has nothing to accept. The line number is the obvious key and the wrong
// one: code added above a finding moves it, and commitwork measured a line-keyed identity reporting
// eight findings fixed that had only shifted. So identity is built from names the source gives
// itself: the program, then the section and paragraph a statement sits in, or the record a data
// entry belongs to; the job, step and DD for JCL; and the statement's own text, with the sequence
// and identification areas removed because renumbering rewrites them.
//
// No position enters it anywhere, including as a tiebreak. An ordinal among look-alikes would be a
// line number under another name, unstable in exactly the cases it exists for. Two findings that
// agree on rule, scope and text are the same statement flagged twice, and they share a fingerprint;
// the report counts how many did, so the collapse is visible rather than silent.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { detectFormat, normalize, tokenize, VERBS, NOT_LABELS, SCOPE_TERMINATORS } from '../parser.mjs';
import { parseJcl } from '../jcl.mjs';
import { isJcl, isProgram, isCopybook, readSource } from '../sources.mjs';

export const FINGERPRINT_VERSION = 'cobolwork/v1';

const LEVEL_RECORD = /^(0?1|77)$/;

// The named scope of every line of a COBOL source: program, then section.paragraph in the
// procedure division, or the 01 or 77 record elsewhere. Read from tokens, so a comment or a
// literal cannot pose as a label. A copybook has no divisions, so there a label and a record are
// both read, whichever the copybook turns out to hold.
export function cobolScopes(src, file = '') {
  const norm = normalize(src, detectFormat(src), new Map());
  const { tokens } = tokenize(norm, file);
  const at = new Array(norm.entries.length + 1).fill(null);
  let program = null, division = null, section = null, paragraph = null, record = null;
  let sentenceStart = true;
  const inProcedure = () => division === 'PROCEDURE' || (division === null && program === null);
  const current = () => {
    const where = division === 'PROCEDURE' || ((section || paragraph) && division === null)
      ? [section, paragraph].filter(Boolean).join('.')
      : record || division || '';
    return program ? `${program}/${where}` : where;
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1];
    if (t.t === 'period') { sentenceStart = true; continue; }
    if (t.t === 'word') {
      if (t.u === 'PROGRAM-ID' || t.u === 'FUNCTION-ID') {
        let j = i + 1;
        if (tokens[j] && tokens[j].t === 'period') j++;
        if (tokens[j]) program = String(tokens[j].v).toUpperCase();
        division = 'IDENTIFICATION'; section = paragraph = record = null;
      } else if (next && next.t === 'word' && next.u === 'DIVISION') {
        division = t.u === 'ID' ? 'IDENTIFICATION' : t.u;
        section = paragraph = record = null;
      } else if (sentenceStart && inProcedure() && next && next.t === 'word' && next.u === 'SECTION' && !NOT_LABELS.has(t.u)) {
        section = t.u; paragraph = null;
      } else if (sentenceStart && inProcedure() && next && next.t === 'period' && !NOT_LABELS.has(t.u) && !VERBS.has(t.u) && !SCOPE_TERMINATORS.has(t.u)) {
        paragraph = t.u;
      } else if (sentenceStart && division !== 'PROCEDURE' && (t.u === 'FD' || t.u === 'SD') && next && next.t === 'word') {
        record = next.u;
      } else if (sentenceStart && division !== 'PROCEDURE' && LEVEL_RECORD.test(t.v) && next && next.t === 'word') {
        record = next.u;
      }
    }
    sentenceStart = false;
    if (at[t.line] == null) at[t.line] = current();
  }
  // A line holding no token of its own - a comment, a continuation, a line inside EXEC - is in
  // whatever scope was in force above it.
  let last = '';
  for (let l = 1; l < at.length; l++) { if (at[l] == null) at[l] = last; else last = at[l]; }
  return at;
}

// Job, step and DD for every line of a job. In-stream data belongs to the DD that opens it.
export function jclScopes(src, file = '') {
  const lines = String(src).split(/\r?\n/).length;
  const at = new Array(lines + 1).fill('');
  let job;
  try { job = parseJcl(src, file); } catch { return at; }
  const events = [
    ...job.jobs.map((j) => ({ line: j.line, kind: 'job', name: j.name })),
    ...job.steps.map((s) => ({ line: s.line, kind: 'step', name: s.name || `(${s.pgm || s.proc || 'step'})` })),
    ...job.dds.map((d) => ({ line: d.line, kind: 'dd', name: d.name || '(concatenated)' })),
  ].sort((a, b) => a.line - b.line);
  let jobName = '', stepName = '', ddName = '';
  let e = 0;
  for (let l = 1; l <= lines; l++) {
    while (e < events.length && events[e].line <= l) {
      const ev = events[e++];
      if (ev.kind === 'job') { jobName = ev.name || ''; stepName = ''; ddName = ''; }
      else if (ev.kind === 'step') { stepName = ev.name; ddName = ''; }
      else ddName = ev.name;
    }
    at[l] = [jobName, stepName, ddName].filter(Boolean).join('/');
  }
  return at;
}

// A fingerprint can be tested against guesses, so its line has credentials masked or is left out.
const SECRET_LINE = new Set(['jcl-instream-credential', 'cd-signon-password', 'cd-snode-credentials']);
// Every repetition is bounded or cannot overlap its neighbour, so a crafted line costs linear time.
const maskSecrets = (s) => {
  const out = s
    .replace(/\b(PASSWORD|PASSWRD|PASSPHRASE|PHRASE|PWD|PASS)(\s*[=(]\s*)('[^']{0,256}'|"[^"]{0,256}"|[^\s,)'"]{1,256})/gi, '$1$2*')
    .replace(/\b(USERID|SNODEID|PNODEID)(\s*=\s*\([^,)]{0,256},)[^)]{0,256}\)/gi, '$1$2*)');
  const named = out.search(/PASS|PWD|PSWD/i);
  return named < 0 ? out : out.replace(/\bVALUE(\s+)('[^']{0,256}'|"[^"]{0,256}")/gi,
    (m, space, literal, at) => (at > named ? `${m.slice(0, m.length - literal.length)}'*'` : m));
};
// Strips trailing blanks and periods in linear time; a regular expression for it is quadratic on a long run.
const trimEnd = (s) => {
  let end = s.length;
  while (end > 0 && /[\s.]/.test(s[end - 1])) end--;
  return s.slice(0, end);
};

// A line as the compiler or the reader sees it: without the sequence area, without columns 73 to
// 80, with its spacing collapsed. Case is folded for COBOL and JCL, which do not distinguish it, and
// a COBOL line loses the period that ends its sentence, which moves when a statement is added after it.
function codeText(line, kind, format) {
  // A line past this is not code anyone reads, and every step below is linear in what is left.
  let s = (line || '').slice(0, 4096);
  if (kind === 'cobol') {
    if (format === 'fixed') s = s.slice(7, 72);
    else if (format === 'variable') s = s.slice(7, 250);
    else if (format === 'terminal') s = s.slice(1);
    s = trimEnd(s.replace(/\*>.*$/, '').toUpperCase());
  } else if (kind === 'jcl') s = s.slice(0, 72).toUpperCase();
  return maskSecrets(s).replace(/\s+/g, ' ').trim();
}

// Reads each file once, however many findings it holds, from disk or through the reader the
// caller's source tree supplies.
function fileFacts(root, path, cache) {
  let facts = cache.get(path);
  if (facts) return facts;
  facts = { kind: 'other', lines: [], scopes: null, format: null };
  cache.set(path, facts);
  let src;
  try { src = cache.read ? cache.read(path) : readSource(join(root, path)).text; } catch { return facts; }
  facts.lines = src.split(/\r?\n/);
  if (isJcl(join(root, path))) {
    facts.kind = 'jcl';
    facts.scopes = jclScopes(src, path);
  } else if (isProgram(join(root, path)) || isCopybook(join(root, path))) {
    facts.kind = 'cobol';
    facts.format = detectFormat(src);
    try { facts.scopes = cobolScopes(src, path); } catch { facts.scopes = null; }
  }
  return facts;
}

// What a finding's fingerprint is made of.
function partsOf(f, root, cache) {
  const facts = f.path ? fileFacts(root, f.path, cache) : { kind: 'other', lines: [], scopes: null };
  const line = Number(f.line) || 0;
  const scoped = facts.scopes && line > 0 && line < facts.scopes.length ? facts.scopes[line] : '';
  // A program-level scope names the program, which survives the file being moved or renamed.
  // Anything without one - a copybook's data, a Dockerfile, a site file - is known by its path.
  const scope = facts.kind === 'cobol' && /\//.test(scoped) && !isCopybook(join(root, f.path)) ? scoped : `${f.path || ''}#${scoped}`;
  // Line 1 is where a set reports a whole file or a whole program; its text is not what the
  // finding is about.
  const text = line > 1 && !SECRET_LINE.has(f.rule) ? codeText(facts.lines[line - 1], facts.kind, facts.format) : '';
  const subject = [f.program, f.name, f.step].filter((x) => x != null && x !== '').join('|');
  return { scope, subject, text };
}

const digest = (parts) => createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 32);

// Stamps `fingerprint` on every finding and returns how many shared one with an earlier finding.
// `repo` names the repository when one report holds several, where the same program id in two
// repositories is two programs.
export function stampFingerprints(findings, { root, repo = '', read = null } = {}) {
  const cache = Object.assign(new Map(), { read });
  const seen = new Set();
  let shared = 0;
  for (const f of findings) {
    const { scope, subject, text } = partsOf(f, root, cache);
    const fp = digest([FINGERPRINT_VERSION, f.rule, repo, scope, subject, text]);
    if (seen.has(fp)) shared++;
    seen.add(fp);
    f.fingerprint = fp;
  }
  return { version: FINGERPRINT_VERSION, shared };
}

// Looser keys for one finding seen in two trees whose line was edited between them: `scope` is the
// fingerprint without the line's text, and `route` names a data-flow finding by the statement its
// trace starts at. Null where a finding has no route.
export function pairingKeys(findings, { root, repo = '', read = null } = {}) {
  const cache = Object.assign(new Map(), { read });
  return findings.map((f) => {
    const { scope, subject } = partsOf(f, root, cache);
    const src = f.evidence === 'path' && f.related && f.related[0];
    let route = null;
    if (src && src.path) {
      const facts = fileFacts(root, src.path, cache);
      const text = codeText(facts.lines[(Number(src.line) || 0) - 1], facts.kind, facts.format);
      route = digest([FINGERPRINT_VERSION, 'route', f.rule, repo, f.program || '', src.path, text]);
    }
    return { scope: digest([FINGERPRINT_VERSION, 'scope', f.rule, repo, scope, subject]), route };
  });
}

// Every line of a file as the fingerprint reads it, led by a fixed-format line's indicator column so
// that a line commented out reads as changed. Null when the file cannot be read.
export function codeLines(root, path) {
  const full = join(root, path);
  let src;
  try { src = readSource(full).text; } catch { return null; }
  const kind = isJcl(full) ? 'jcl' : isProgram(full) || isCopybook(full) ? 'cobol' : 'other';
  const format = kind === 'cobol' ? detectFormat(src) : null;
  const indicator = format === 'fixed';
  return src.split(/\r?\n/).map((l) => (indicator ? l.charAt(6) : '') + codeText(l, kind, format));
}
