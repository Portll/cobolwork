// SPDX-License-Identifier: AGPL-3.0-or-later
// How the common z/OS utilities move data between their DD names. None of it can be derived from
// the JCL: SYSUT1 is IEBGENER's input and SYSUT2 its output only because IBM says so, and a SORT
// step's outputs are named in its control statements rather than on any DD. So it is a table, kept
// by hand, and each entry names the pages it was written from.
//
// A program the table does not know has no copies, rather than guessed ones. A step whose control
// statements are not in the job - SYSIN naming a library member - says so, because its copies are
// then only the ones its DD names decide on their own.

import { ftpSession } from './ftp.mjs';
import { statementCard } from './cards.mjs';

const upper = (s) => String(s).toUpperCase();

// The DDs of a step by name, each followed by the datasets concatenated to it.
export function ddGroups(step) {
  const out = new Map();
  let current = null;
  for (const dd of step.dds) {
    if (dd.name) {
      current = upper(dd.name);
      if (!out.has(current)) out.set(current, []);
    }
    if (current) out.get(current).push(dd);
  }
  return out;
}

// The in-stream lines of a control DD, and the first dataset in its concatenation, whose lines are
// statements this reader never sees.
function cards(group) {
  const lines = [];
  let unread = null;
  for (const dd of group || []) {
    if (dd.inStream) lines.push(...dd.inStream);
    else if (dd.dsn && !unread) unread = dd.dsn;
  }
  return { lines, unread };
}

// Up to the first blank outside quotes: an operand field, where whatever follows is a remark.
function upToBlank(s) {
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "'") quoted = !quoted;
    else if (!quoted && /\s/.test(s[i])) return s.slice(0, i);
  }
  return s;
}

// Splits on commas outside parentheses.
function topLevel(s) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth = Math.max(0, depth - 1);
    else if (s[i] === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

const unwrap = (v) => (/^\(.*\)$/.test(v) ? v.slice(1, -1) : v);

// DFSORT and DFSMSdfp utility statements: a label in column 1, or a comment if column 1 holds an
// asterisk; the operation; operands up to the first blank, after which comes a remark. `continues`
// says whether a line's operands carry on to the next line.
function utilityStatements(lines, continues) {
  const out = [];
  let cur = null;
  for (const { line, text } of lines) {
    const s = text.slice(0, 71);
    if (cur) {
      const more = upToBlank(s.trimStart());
      cur.operands += more;
      if (!continues(more, text)) { out.push(cur); cur = null; }
      continue;
    }
    if (/^\*/.test(s) || !s.trim()) continue;
    const m = /^(\S+)?\s+(\S+)\s*(.*)$/.exec(s);
    const [, label, op, rest] = m || [null, null, s.trim(), ''];
    cur = { line, label: label || null, op: upper(op), operands: upToBlank(rest) };
    if (!continues(cur.operands, text)) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

// IDCAMS and ADRDSSU commands: a hyphen at the end of a line continues the command after a blank,
// a plus continues it and the value it is in, and /* */ encloses a comment.
function commands(lines) {
  const out = [];
  let cur = null;
  let comment = false;
  for (const { line, text } of lines) {
    let t = '';
    const s = statementCard(text).text;
    for (let i = 0; i < s.length; i++) {
      if (comment) { if (s[i] === '*' && s[i + 1] === '/') { comment = false; i++; } continue; }
      if (s[i] === '/' && s[i + 1] === '*') { comment = true; i++; continue; }
      t += s[i];
    }
    t = t.trim();
    const join = /-$/.test(t) ? ' ' : /\+$/.test(t) ? '' : null;
    if (join !== null) t = t.slice(0, -1).trim();
    if (!cur) {
      if (!t) continue;
      cur = { line, text: t, join: '' };
    } else cur.text += cur.join + t;
    if (join === null) { out.push(cur); cur = null; } else cur.join = join;
  }
  if (cur) out.push(cur);
  return out;
}

// The values of the first of `names` given as a keyword in a command, as in INFILE(IN) or
// OUTDDNAME(TAPE1,TAPE2). A name only counts at the start of a word, so INDD is not LOGINDD.
function param(text, names) {
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- names are literal keyword lists
  const m = new RegExp(`(?:^|[\\s,])(?:${names.join('|')})\\s*\\(([^)]*)\\)`, 'i').exec(text);
  return m ? m[1].split(/[\s,]+/).filter(Boolean).map((v) => upper(v.replace(/^'|'$/g, ''))) : null;
}

const who = (step) => `step ${step.name || '(unnamed)'}`;

// ---------------------------------------------------------------------------------------------
// The table. Each entry turns a step into moves: data read from `from` and written to `to`, where
// an end is a DD name or, when a control statement names one itself, a dataset.

// IEBGENER copies SYSUT1 to SYSUT2, and ICEGENER, DFSORT's replacement for it, reads the same DDs.
// Control statements only edit records or split members, so the copy is the DDs' alone.
//   https://www.ibm.com/docs/api/v1/content/zosbasics/com.ibm.zos.zdatamgmt/zsysprogc_utilities_IEBGENER.htm
//   https://www.ibm.com/docs/en/zos/3.1.0?topic=performance-use-icegener-instead-iebgener
// IEBPTPCH reads SYSUT1 and writes its print or punch output to SYSUT2, and IEBUPDTE reads its old
// master from SYSUT1 and writes SYSUT2. IEBUPDTE's control data set may also carry input data for the
// new master, which is not followed here.
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.2.0/com.ibm.zos.v2r2.idau100/u1367.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.2.0/com.ibm.zos.v2r2.idau100/u1427.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.2.0/com.ibm.zos.v2r2.idau100/u1425.htm
function generCopy(step, dds) {
  if (!dds.has('SYSUT1') || !dds.has('SYSUT2')) return { moves: [], notes: [] };
  return { moves: [{ from: [{ dd: 'SYSUT1' }], to: [{ dd: 'SYSUT2' }], line: step.line }], notes: [] };
}

// DFSORT reads SORTIN for a sort or a copy and SORTINnn, nn from 00 to 99, for a merge, and writes
// SORTOUT. OUTFIL writes the DDs its FNAMES operand names, SORTOFx or SORTOFxx for each suffix its
// FILES operand gives, or SORTOUT when it gives neither. SORTDD= and SORTOUT= in DFSPARM rename the
// defaults, and are not read. A line whose operand field ends in a comma, semicolon or colon
// continues.
//   https://www.ibm.com/docs/en/zos/3.1.0?topic=statements-program-dd
//   https://www.ibm.com/docs/en/zos/2.5.0?topic=sets-jcl-merging-data-directly
//   https://www.ibm.com/docs/en/zos/2.2.0?topic=statements-outfil-control
//   https://www.ibm.com/docs/en/zos/3.1.0?topic=statements-general-coding-rules
// SYNCSORT is here because it takes the same DD names and statements; this was not checked against
// Precisely's own guide, which could not be retrieved.
function sortCopies(step, dds) {
  const { lines, unread } = cards(dds.get('SYSIN'));
  const statements = utilityStatements(lines, (ops) => /[,;:]$/.test(ops));
  const merge = statements.some((st) => st.op === 'MERGE' && !/(?:^|,)FIELDS=COPY\b/i.test(st.operands));
  const inputs = [...dds.keys()].filter((n) => (unread
    ? n === 'SORTIN' || /^SORTIN\d\d$/.test(n)
    : merge ? /^SORTIN\d\d$/.test(n) : n === 'SORTIN'));
  const from = inputs.map((dd) => ({ dd }));
  const notes = unread ? [{ line: step.line, text: `${who(step)} runs ${step.pgm} with control statements in ${unread}, which this reader cannot see, so whether it merges and which OUTFIL data sets it writes are not known` }] : [];
  const moves = dds.has('SORTOUT') ? [{ from, to: [{ dd: 'SORTOUT' }], line: step.line }] : [];
  for (const st of statements) {
    if (st.op !== 'OUTFIL') continue;
    const fnames = /(?:^|,)FNAMES=(\([^)]*\)|[^,()]+)/i.exec(st.operands);
    const files = /(?:^|,)FILES=(\([^)]*\)|[^,()]+)/i.exec(st.operands);
    const to = [
      ...(fnames ? topLevel(unwrap(fnames[1])).map((n) => ({ dd: upper(n) })) : []),
      ...(files ? topLevel(unwrap(files[1])).map((x) => ({ dd: `SORTOF${upper(x)}` })) : []),
    ];
    moves.push({ from, to: to.length ? to : [{ dd: 'SORTOUT' }], line: st.line });
  }
  return { moves, notes };
}

// IDCAMS REPRO copies INFILE(ddname) or INDATASET(entryname) to OUTFILE(ddname) or
// OUTDATASET(entryname), abbreviated IFILE, IDS, OFILE and ODS. The dataset forms name no DD:
// IDCAMS allocates those itself.
//   https://www.ibm.com/docs/en/zos/3.1.0?topic=commands-repro
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.3.0/com.ibm.zos.v2r3.idai200/da6i2253.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.2.0/com.ibm.zos.v2r2.idai200/continu.htm
// EXPORT writes the cluster its first parameter names, or the one INFILE(ddname) identifies, to the
// portable data set OUTFILE(ddname) or OUTDATASET(entryname) gives, and may be abbreviated EXP.
// IMPORT reads the portable data set INFILE(ddname) or INDATASET(entryname) names and writes the
// cluster OUTFILE(ddname) or OUTDATASET(entryname) names.
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.3.0/com.ibm.zos.v2r3.idai200/export.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.3.0/com.ibm.zos.v2r3.idai200/da6i2210.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.3.0/com.ibm.zos.v2r3.idai200/da6i211.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.3.0/com.ibm.zos.v2r3.idai200/import.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.3.0/com.ibm.zos.v2r3.idai200/da6i2221.htm
// PRINT reads INFILE(ddname) or INDATASET(entryname) and writes the listing to OUTFILE(ddname),
// SYSPRINT when it names none, so a production data set printed to SYSOUT leaves by that DD.
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.3.0/com.ibm.zos.v2r3.idai200/print.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.3.0/com.ibm.zos.v2r3.idai200/da6i2244.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.3.0/com.ibm.zos.v2r3.idai200/da6i2245.htm
// ALTER entryname NEWNAME(newname), abbreviated NEWNM, gives the entry a new name, so the data the
// old name held is read under the new one. A generic name (both must then be generic) or a member
// of a partitioned data set leaves the data set where it was, and is not followed.
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.3.0/com.ibm.zos.v2r3.idai200/da6i2052.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.3.0/com.ibm.zos.v2r3.idai200/da6i2055.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.3.0/com.ibm.zos.v2r3.idai200/da6i2056.htm
function renamed(cmd) {
  const m = /^ALTER\s+'?([^\s(),'*]+)'?(?=[\s,]|$)/i.exec(cmd.text);
  const to = m && param(cmd.text, ['NEWNAME', 'NEWNM']);
  if (!to || /[*(]/.test(to[0])) return null;
  return { from: [{ dsn: upper(m[1]) }], to: [{ dsn: to[0] }], line: cmd.line };
}

function reproCopies(step, dds) {
  const { lines, unread } = cards(dds.get('SYSIN'));
  const notes = unread ? [{ line: step.line, text: `${who(step)} runs IDCAMS with commands in ${unread}, which this reader cannot see, so any REPRO, EXPORT, IMPORT, PRINT or rename it runs is not known` }] : [];
  const moves = [];
  for (const cmd of commands(lines)) {
    if (/^ALTER\b/i.test(cmd.text)) {
      const move = renamed(cmd);
      if (move) moves.push(move);
      continue;
    }
    if (/^PRINT\b/i.test(cmd.text)) {
      const input = param(cmd.text, ['INFILE', 'IFILE']);
      const ds = !input && param(cmd.text, ['INDATASET', 'IDS']);
      const out = param(cmd.text, ['OUTFILE', 'OFILE']);
      const from = input ? [{ dd: input[0] }] : ds ? [{ dsn: ds[0] }] : [];
      moves.push({ from, to: [{ dd: out ? out[0] : 'SYSPRINT' }], line: cmd.line });
      continue;
    }
    const verb = /^(REPRO|EXPORT|EXP|IMPORT)\b/i.exec(cmd.text);
    if (!verb) continue;
    const entry = /^EXP/i.test(verb[1]) && /^\S+\s+([^\s(),]+)/.exec(cmd.text);
    const end = (ddNames, dsNames, fallback) => {
      const dd = param(cmd.text, ddNames);
      if (dd) return [{ dd: dd[0] }];
      const ds = param(cmd.text, dsNames);
      if (ds) return [{ dsn: ds[0] }];
      return fallback ? [{ dsn: upper(fallback.replace(/^'|'$/g, '')) }] : [];
    };
    moves.push({ from: end(['INFILE', 'IFILE'], ['INDATASET', 'IDS'], entry && entry[1]), to: end(['OUTFILE', 'OFILE'], ['OUTDATASET', 'ODS']), line: cmd.line });
  }
  return { moves, notes };
}

// IEBCOPY COPY, COPYGRP and COPYMOD name their output with OUTDD and their inputs with INDD, where an input
// written (ddname,R) replaces members of the same name. An INDD= on a record of its own begins
// another step of the COPY before it. A statement continues after a comma or a mark in column 72.
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_3.1.0/com.ibm.zos.v3r1.idau100/copy.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_3.1.0/com.ibm.zos.v3r1.idau100/copygrp.htm
//   https://www.ibm.com/docs/en/zos/2.4.0?topic=ie-example-15-copy-groups-from-pdse-pdse-replace
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_3.1.0/com.ibm.zos.v3r1.idau100/copymd.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_3.1.0/com.ibm.zos.v3r1.idau100/u1055.htm
function iebcopyCopies(step, dds) {
  const { lines, unread } = cards(dds.get('SYSIN'));
  const notes = unread ? [{ line: step.line, text: `${who(step)} runs IEBCOPY with statements in ${unread}, which this reader cannot see, so what it copies is not known` }] : [];
  const moves = [];
  let out = null;
  const statements = utilityStatements(lines, (ops, text) => /,$/.test(ops) || (text.length > 71 && text[71] !== ' '));
  for (const st of statements) {
    // A record holding only INDD= has no operation, so what reads as its operation is its operand.
    const alone = /^INDD=/.test(st.op);
    if (st.op === 'COPY' || st.op === 'COPYGRP' || st.op === 'COPYMOD') out = null;
    else if (!alone) {
      if (st.op !== 'SELECT' && st.op !== 'EXCLUDE') out = null;
      continue;
    }
    const kw = new Map(topLevel(alone ? st.op + st.operands : st.operands).map((o) => {
      const eq = o.indexOf('=');
      return [upper(o.slice(0, eq)), o.slice(eq + 1)];
    }));
    if (kw.has('OUTDD')) out = upper(kw.get('OUTDD'));
    if (!out || !kw.has('INDD')) continue;
    const from = topLevel(unwrap(kw.get('INDD'))).map((i) => ({ dd: upper(unwrap(i).split(',')[0].trim()) }));
    moves.push({ from, to: [{ dd: out }], line: st.line });
  }
  return { moves, notes };
}

// ADRDSSU DUMP reads the INDDNAME volume, or the LOGINDDNAME volumes of a logical dump, and writes
// each OUTDDNAME, up to 255 of them. RESTORE reads the dump data set INDDNAME names and writes the
// OUTDDNAME volumes. With no input DD a logical dump chooses its datasets by filter, and with no
// output DD a logical restore puts them where the catalogue says, neither of which the job shows.
// COPY reads the volumes INDDNAME or LOGINDDNAME name and writes the DASD volumes OUTDDNAME names.
//   https://www.ibm.com/docs/en/zos/3.1.0?topic=commands-command-syntax
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.4.0/com.ibm.zos.v2r4.adru000/r2319.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.4.0/com.ibm.zos.v2r4.adru000/r2321.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.4.0/com.ibm.zos.v2r4.adru000/r2327.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.2.0/com.ibm.zos.v2r2.adru000/dgt3u2165.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.2.0/com.ibm.zos.v2r2.adru000/dgt3u2174.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.2.0/com.ibm.zos.v2r2.adru000/r2172.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.2.0/com.ibm.zos.v2r2.adru000/r2204.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.2.0/com.ibm.zos.v2r2.adru000/r2206.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.2.0/com.ibm.zos.v2r2.adru000/r2216.htm
function dssCopies(step, dds) {
  const { lines, unread } = cards(dds.get('SYSIN'));
  const notes = unread ? [{ line: step.line, text: `${who(step)} runs ADRDSSU with commands in ${unread}, which this reader cannot see, so what it dumps, restores or copies is not known` }] : [];
  const moves = [];
  for (const cmd of commands(lines)) {
    const op = /^(DUMP|RESTORE|COPY)\b/i.exec(cmd.text);
    if (!op) continue;
    const verb = upper(op[1]);
    const dump = verb === 'DUMP';
    const ins = param(cmd.text, ['INDDNAME', 'INDD', 'IDD']) || (verb !== 'RESTORE' && param(cmd.text, ['LOGINDDNAME', 'LOGINDD', 'LIDD'])) || [];
    const outs = param(cmd.text, ['OUTDDNAME', 'OUTDD', 'ODD']) || [];
    if (dump && !ins.length) notes.push({ line: cmd.line, text: `${who(step)} dumps datasets chosen by filter from the catalogue, so which ones it copies is not known here` });
    if (verb === 'COPY' && !ins.length) notes.push({ line: cmd.line, text: `${who(step)} copies datasets whose input volume the command names no DD for, so where they come from is not known here` });
    if (verb === 'COPY' && !outs.length) notes.push({ line: cmd.line, text: `${who(step)} copies datasets to an output volume the command names no DD for, so what it writes is not known here` });
    if (verb === 'RESTORE' && !outs.length) notes.push({ line: cmd.line, text: `${who(step)} restores datasets to where the catalogue puts them, so what it writes is not known here` });
    moves.push({ from: ins.map((dd) => ({ dd })), to: outs.map((dd) => ({ dd })), line: cmd.line });
  }
  return { moves, notes };
}

// ICETOOL runs the operators in TOOLIN. COPY, SORT and MERGE read the DDs their FROM operands name
// and write the DDs their TO operands name, several ddnames to an operand. A statement's operands
// continue on the next line after a hyphen, and what follows the hyphen is ignored. USING(xxxx) reads
// DFSORT control statements from the xxxxCNTL DD, whose OUTFIL statements can write further data sets.
//   https://www.ibm.com/docs/en/zos/3.1.0?topic=icetool-copy-operator
//   https://www.ibm.com/docs/en/zos/3.1.0?topic=icetool-sort-operator
//   https://www.ibm.com/docs/en/zos/3.1.0?topic=icetool-merge-operator
//   https://www.ibm.com/docs/en/zos/2.3.0?topic=icetool-job-control-language
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_3.1.0/com.ibm.zos.v3r1.icea100/ice2ca_General_coding_rules.htm
function icetoolCopies(step, dds) {
  const { lines, unread } = cards(dds.get('TOOLIN'));
  const notes = unread ? [{ line: step.line, text: `${who(step)} runs ICETOOL with statements in ${unread}, which this reader cannot see, so what it copies is not known` }] : [];
  const statements = [];
  let cur = null;
  for (const { line, text } of lines) {
    const s = statementCard(text).text;
    if (!cur && (/^\*/.test(s) || !s.trim())) continue;
    const tokens = s.trim().split(/\s+/);
    const hyphen = tokens.findIndex((t) => t.endsWith('-'));
    const used = hyphen < 0 ? tokens : tokens.slice(0, hyphen + 1);
    if (!cur) cur = { line, op: upper(used.shift()), operands: [] };
    cur.operands.push(...used.map((t) => t.replace(/-$/, '')).filter(Boolean));
    if (hyphen < 0) { statements.push(cur); cur = null; }
  }
  if (cur) statements.push(cur);
  const moves = [];
  for (const st of statements) {
    if (!['COPY', 'SORT', 'MERGE'].includes(st.op)) continue;
    const named = (kw) => st.operands.flatMap((o) => {
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- kw is a literal keyword
      const m = new RegExp(`^${kw}\\((.*)\\)$`, 'i').exec(o);
      return m ? m[1].split(',').map((n) => upper(n.trim())).filter(Boolean) : [];
    });
    moves.push({ from: named('FROM').map((dd) => ({ dd })), to: named('TO').map((dd) => ({ dd })), line: st.line });
    for (const using of named('USING')) {
      const control = cards(dds.get(`${using}CNTL`));
      if (control.unread || utilityStatements(control.lines, (ops) => /[,;:]$/.test(ops)).some((c) => c.op === 'OUTFIL')) {
        notes.push({ line: st.line, text: `${who(step)} runs ICETOOL ${st.op} with control statements in ${using}CNTL that may write OUTFIL data sets, which are not followed here` });
      }
    }
  }
  return { moves, notes };
}

// An FTP step's transfers, from the session lib/ftp.mjs reads: what PUt, MPut and APpend send leaves
// for the remote host, and what Get and MGet fetch is written locally. The remote end names the host
// and file, and the FILETYPE a SIte gave it.
function ftpCopies(step, dds) {
  const s = ftpSession(step, dds);
  const localEnds = (x) => (x.dd ? [{ dd: x.dd }] : x.dsns.map((dsn) => ({ dsn })));
  const remote = (name, x) => ({ remote: { host: s.host, name, ...(x.filetype ? { filetype: x.filetype } : {}) } });
  const moves = [
    ...s.sends.map((x) => ({ from: localEnds(x), to: [remote(x.foreign, x)], line: x.line })),
    ...s.gets.map((x) => ({ from: [remote(x.name, x)], to: localEnds(x), line: x.line })),
  ].sort((a, b) => a.line - b.line);
  const notes = s.inputUnread ? [{ line: step.line, text: `${who(step)} runs FTP with subcommands in ${s.inputUnread}, which this reader cannot see, so what it sends or fetches is not known` }] : [];
  return { moves, notes };
}

const TABLE = [
  [['IEBGENER', 'ICEGENER', 'IEBPTPCH', 'IEBUPDTE'], generCopy],
  [['SORT', 'ICEMAN', 'DFSORT', 'SYNCSORT'], sortCopies],
  [['IDCAMS'], reproCopies],
  [['IEBCOPY'], iebcopyCopies],
  [['ADRDSSU'], dssCopies],
  [['ICETOOL'], icetoolCopies],
  [['FTP'], ftpCopies],
];
const BY_PROGRAM = new Map(TABLE.flatMap(([names, fn]) => names.map((n) => [n, fn])));

export const UTILITIES = [...BY_PROGRAM.keys()];

// What a step's program copies, as { copies, uses, notes }: the copies from dataset to dataset, how
// the utility uses each DD statement it names ('read' or 'write'), and what could not be read. Null
// for a program the table does not know.
export function copiesOf(step) {
  const utility = step.pgm ? upper(step.pgm) : null;
  const fn = utility && BY_PROGRAM.get(utility);
  if (!fn) return null;
  const dds = ddGroups(step);
  const { moves, notes } = fn(step, dds);

  // An end naming a DD stands for every dataset concatenated under that name. A DD the step does
  // not define is kept, with no dataset: a statement naming it still says where the data went.
  const expand = (end) => {
    if (!end.dd) return [{ dd: null, dsn: end.dsn ?? null, ...(end.remote ? { remote: end.remote } : {}) }];
    const group = dds.get(end.dd);
    if (!group) return [{ dd: end.dd, dsn: null }];
    return group.map((dd) => ({ dd: end.dd, dsn: dd.dsn || null, ...(dd.inStream ? { inStream: true } : {}) }));
  };

  const copies = [];
  const uses = new Map();
  const mark = (end, use) => {
    for (const dd of (end.dd && dds.get(end.dd)) || []) if (uses.get(dd) !== 'write') uses.set(dd, use);
  };
  for (const m of moves) {
    for (const end of m.from) mark(end, 'read');
    for (const end of m.to) mark(end, 'write');
    for (const from of m.from.flatMap(expand)) {
      for (const to of m.to.flatMap(expand)) copies.push({ step: step.name, utility, from, to, line: m.line });
    }
  }
  return { copies, uses, notes };
}

// A TSO command's operands: KEYWORD(value) with the value's parentheses and quotes kept, a quoted
// string, or a bare word, split on blanks and commas. Blanks may stand between a keyword and its
// parenthesis, as in PROGRAM (GETTAB).
function tsoOperands(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    if (/[\s,]/.test(text[i])) { i++; continue; }
    const start = i;
    let depth = 0, quoted = false;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === "'") quoted = !quoted;
      else if (quoted) continue;
      else if (c === '(') depth++;
      else if (c === ')') depth = Math.max(0, depth - 1);
      else if (depth === 0 && /[\s,]/.test(c)) {
        const next = /^\s*\(/.exec(text.slice(i));
        if (next && /^[A-Z][A-Z0-9$#@]*$/i.test(text.slice(start, i))) { text = text.slice(0, i) + text.slice(i + next[0].length - 1); i--; continue; }
        break;
      }
    }
    const tok = text.slice(start, i);
    const kw = /^([A-Z][A-Z0-9$#@]*)\((.*)\)$/is.exec(tok);
    out.push(kw ? { key: upper(kw[1]), value: kw[2] } : { word: tok });
  }
  return out;
}

const unquote = (s) => s.replace(/^'(.*)'$/s, '$1').replace(/''/g, "'");

// ALLOCATE's keywords, abbreviated as far as IBM's rule allows: to any leading part that no other
// ALLOCATE keyword shares. FILE shares F, FI and FIL with FILEDATA, FCB, FLASH and FORMS, and DSNAME
// shares DS and DSN with DSNTYPE and DSORG.
const ALLOC_DATASET = /^(DA|DAT|DATA|DATAS|DATASE|DATASET|DSNA|DSNAM|DSNAME)$/;
const ALLOC_FILE = /^(FILE|DD|DDN|DDNA|DDNAM|DDNAME)$/;
const ALLOC_STATUS = new Set(['OLD', 'SHR', 'MOD', 'NEW']);

// What a TSO batch step (IKJEFT01, IKJEFT1A, IKJEFT1B) does in its commands, from the step's PARM,
// which TSO runs as its first command, and the in-stream SYSTSIN:
//   allocations: ALLOCATE's DDs, which the programs the step runs open as if the JCL defined them.
//     A data set name in quotes is the whole name; one without has the user's prefix added, which
//     the job does not say, so it is kept as written with no dsn.
//   runs: the programs the step starts, by TSO CALL, whose parameter string reaches the program as
//     EXEC PARM does, and by the DSN subcommand RUN PROGRAM, with PARMS.
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.1.0/com.ibm.zos.v2r1.ikjc500/allocsyn.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_3.2.0/com.ibm.zos.v3r2.ikjc500/alloccmd.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_3.1.0/com.ibm.zos.v3r1.ikjp100/ikjp100114.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.5.0/com.ibm.zos.v2r5.ikjc200/ikj2o20039.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_3.1.0/com.ibm.zos.v3r1.ikjc500/ikj2l2_CALL_command_operands.htm
//   https://www.ibm.com/docs/api/v1/content/SSEPEK_13.0.0/comref/src/tpc/db2z_cmd_run.html
export const TSO_BATCH = new Set(['IKJEFT01', 'IKJEFT1A', 'IKJEFT1B']);

export function tsoCommands(step) {
  const out = { allocations: [], runs: [], notes: [] };
  if (!step.pgm || !TSO_BATCH.has(upper(step.pgm))) return out;
  const { lines, unread } = cards(ddGroups(step).get('SYSTSIN'));
  if (unread) out.notes.push({ line: step.line, text: `${who(step)} runs TSO with commands in ${unread}, which this reader cannot see, so any ALLOCATE, CALL or RUN it runs is not known` });
  // PARM keeps JCL's doubled apostrophes; TSO sees one.
  const cmds = [...(step.parm ? [{ line: step.line, text: step.parm.replace(/''/g, "'") }] : []), ...commands(lines)];
  for (const cmd of cmds) {
    const verb = upper(/^\S*/.exec(cmd.text)[0]);
    const ops = tsoOperands(cmd.text.slice(verb.length));
    if (verb === 'ALLOC' || verb === 'ALLOCATE') {
      const file = ops.find((o) => o.key && ALLOC_FILE.test(o.key));
      if (!file) continue;
      const names = ops.find((o) => o.key && ALLOC_DATASET.test(o.key));
      const words = ops.filter((o) => o.word).map((o) => upper(o.word));
      const sysout = ops.find((o) => o.key === 'SYSOUT') || (words.includes('SYSOUT') ? { value: '' } : null);
      const datasets = names ? tsoOperands(names.value).map((o) => o.word).filter((w) => w && w !== '*') : [];
      if (!datasets.length && !sysout) continue;
      out.allocations.push({
        dd: upper(unquote(file.value)), line: cmd.line,
        status: words.find((w) => ALLOC_STATUS.has(w)) || null,
        sysout: sysout ? upper(sysout.value) || '*' : null,
        datasets: datasets.map((w) => ({ written: w, dsn: /^'.*'$/.test(w) ? upper(unquote(w)) : null })),
      });
    } else if (verb === 'CALL') {
      const target = ops[0]?.word || (ops[0]?.key ? `${ops[0].key}(${ops[0].value})` : '');
      const member = /\(([A-Z0-9$#@]{1,8})\)'?$/i.exec(target);
      const parm = ops[1]?.word && /^'.*'$/s.test(ops[1].word) ? unquote(ops[1].word) : null;
      out.runs.push({ program: member ? upper(member[1]) : 'TEMPNAME', parm, line: cmd.line, via: 'TSO CALL' });
    } else if (verb === 'RUN') {
      const program = ops.find((o) => o.key === 'PROGRAM');
      if (!program || !/^[A-Z0-9$#@]{1,8}$/i.test(program.value.trim())) continue;
      const parms = ops.find((o) => o.key === 'PARMS');
      out.runs.push({ program: upper(program.value.trim()), parm: parms ? unquote(parms.value.trim()) : null, line: cmd.line, via: 'DSN RUN' });
    }
  }
  return out;
}
