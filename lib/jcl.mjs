// SPDX-License-Identifier: AGPL-3.0-or-later
// JCL, read the way the reader does: statements folded across continuations, in-stream data
// bounded by its own delimiter, symbolic parameters substituted, and every step tied to the
// program it runs.
//
// Most of the mainframe's privileged surface is here rather than in COBOL. A COPY moves a record
// layout; a JCL step decides which program runs, with what parameter, against which dataset, under
// whose authority. Until this existed the flow engine began at the program boundary, one level
// below the actual entry point.
//
// What it will not do is guess. A statement it cannot read is reported in `diags` and kept in the
// output as `unreadable`, never dropped, because a step nobody parsed is not a step that is not
// there.
import { readSource } from './sources.mjs';
import { copiesOf, tsoCommands } from './utilities.mjs';
import { statementCard, parseOperands } from './cards.mjs';

export { splitOperands, parseOperands } from './cards.mjs';

// The operations a statement may carry. Anything else in the operation field is a statement this
// reader does not know, which is a diagnostic rather than a silent skip.
export const OPERATIONS = new Set(['JOB', 'EXEC', 'DD', 'PROC', 'PEND', 'SET', 'IF', 'THEN',
  'ELSE', 'ENDIF', 'INCLUDE', 'JCLLIB', 'OUTPUT', 'CNTL', 'ENDCNTL', 'XMIT', 'COMMAND', 'NOTIFY', 'EXPORT']);

// A continued operand resumes in these columns. Outside them it is not a continuation, whatever
// the previous line ended with.
const CONTINUE_FROM = 4;
const CONTINUE_TO = 16;

const NAME = /^[A-Z$#@][A-Z0-9$#@]{0,7}$/;

// DDs that follow the JOB statement and serve every step, before any EXEC.
const JOB_LEVEL_DDS = new Set(['JOBLIB', 'JOBCAT']);

// Values the system supplies when a job is converted, which no repository can hold. JES sets
// &SYSUID to the user the job runs under (z/OS JES application programming, "JES system symbols");
// the rest are z/OS's static and dynamic system symbols (z/OS 3.1 MVS Initialization and Tuning
// Reference, "Static system symbols" and "Dynamic system symbols").
const SYSTEM_SYMBOLS = new Set(`SYSUID SYSALVL SYSCLONE SYSNAME SYSOSLVL SYSPLEX SYSR1
  YYMMDD LYYMMDD HHMMSS LHHMMSS DAY HR MIN SEC JDAY MON YR2 YR4 WDAY
  LDATE LDAY LHR LMIN LSEC LJDAY LMON LYR2 LYR4 LWDAY LTIME JOBNAME DS SEQ DATE TIME`.split(/\s+/));

// Symbolic substitution. &NAME ends at a non-name character, and a trailing dot is a separator
// that is consumed rather than kept: &PREFIX..DATA resolves to <prefix>.DATA.
export function substitute(text, symbols) {
  if (!text.includes('&')) return { text, unresolved: [] };
  const unresolved = [];
  const out = text.replace(/&&|&([A-Z$#@][A-Z0-9$#@]{0,7})\.?/gi, (m, name) => {
    if (m === '&&') return '&&';                      // && is a literal ampersand, not a symbol
    const key = name.toUpperCase();
    if (!symbols.has(key)) { unresolved.push(key); return m; }
    return symbols.get(key);
  });
  return { text: out, unresolved };
}

// The operand field ends at the first blank outside apostrophes; what follows is a comment, and a
// field ending in a comma continues whatever the comment says. An IF condition may hold blanks.
const BLANKS_IN_OPERANDS = new Set(['IF', 'THEN', 'ELSE', 'ENDIF']);
function operandField(s) {
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "'") quoted = !quoted;
    else if (s[i] === ' ' && !quoted) return s.slice(0, i);
  }
  return s;
}

// Folds physical lines into logical statements. Continuation is the part naive readers get wrong,
// and a payload split across a continuation boundary is exactly what hiding in JCL looks like.
export function foldStatements(src) {
  // A DOS end-of-file byte (Ctrl-Z) closes files written on a PC.
  const phys = src.replace(/\r\n?/g, '\n').replace(/\x1a[\s\x1a]*$/, '').split('\n');
  const statements = [];
  const diags = [];
  let open = null;                 // the statement being continued
  let stream = null;               // the DD statement currently collecting in-stream data
  let endedByComment = null;       // a DD whose in-stream data a comment statement ended

  // A statement is only complete once its continuations are in, and only then can it be known to
  // open a data stream. Both happen here so that there is one place that decides what a line is.
  const push = (st) => {
    statements.push(st);
    if (st.comments) { statements.push(...st.comments); delete st.comments; }
    if (st.kind !== 'statement' || st.operation !== 'DD') return;
    const { positional, keywords } = parseOperands(st.field);
    if (!positional.some((p) => p === '*' || p.toUpperCase() === 'DATA')) return;
    const dlm = keywords.get('DLM');
    st.dlm = dlm ? dlm.replace(/^'|'$/g, '') : null;
    st.inStream = [];
    stream = st;
    // A non-default delimiter conceals what follows from anything reading JCL line by line, which
    // is worth seeing on its own.
    if (st.dlm) diags.push({ sev: 'info', line: st.line, text: `in-stream data uses DLM=${st.dlm}, so it does not end at /*` });
  };

  for (let i = 0; i < phys.length; i++) {
    const line = i + 1;
    const raw = phys[i];
    if (raw.length > 80) diags.push({ sev: 'warn', line, text: 'line is longer than 80 columns' });
    // The sequence area is not the statement; a payload hidden there is the hidden-content rules' business.
    const card = statementCard(raw);
    const text = card.text.replace(/\s+$/, '');
    const sequence = card.sequence;

    if (stream) {
      // A custom DLM ends the stream and nothing else does. The default ends at /* or at the next
      // statement, which is why a job that omits its /* still parses.
      const ends = stream.dlm ? text.startsWith(stream.dlm)
        : (/^\/[*&]/.test(text) || /^\/\/\S/.test(text) || /^\/\/\s*$/.test(text));
      if (!ends) { stream.inStream.push({ line, text: raw }); continue; }
      stream.streamEndLine = line;
      const wasDelimited = stream.dlm !== null || /^\/\*/.test(text);
      if (!stream.dlm && /^\/\/\*/.test(text)) endedByComment = stream;
      stream = null;
      if (wasDelimited && !/^\/\/\S/.test(text) && !/^\/\/\s*$/.test(text)) continue;   // the delimiter is not a statement
    }

    if (open) {
      // A comment statement may stand between the lines of a continued statement (z/OS MVS JCL
      // Reference, "Comment statement", location in the JCL). It is kept, and follows the statement.
      if (/^\/\/\*/.test(text)) { (open.comments ||= []).push({ kind: 'comment', line, endLine: line, text: text.slice(3), lines: [line], sequence }); continue; }
      const col = text.search(/\S/) + 1;
      if (!/^\/\//.test(text)) {
        diags.push({ sev: 'error', line, text: 'a continuation must begin with // in columns 1 and 2' });
        open = null;
      } else {
        const body = text.slice(2);
        const at = body.search(/\S/) + 3;
        if (at < CONTINUE_FROM || at > CONTINUE_TO) {
          diags.push({ sev: 'error', line, text: `a continued operand must resume between columns ${CONTINUE_FROM} and ${CONTINUE_TO}, not ${at}` });
        }
        const piece = BLANKS_IN_OPERANDS.has(open.operation) ? body.trim() : operandField(body.trim());
        open.field += piece;
        open.endLine = line;
        open.lines.push(line);
        if (!(BLANKS_IN_OPERANDS.has(open.operation) ? /,\s*$/.test(text) : piece.endsWith(','))) { push(open); open = null; }
        continue;
      }
    }

    if (!text.trim()) continue;
    if (/^\/\/\*/.test(text)) { push({ kind: 'comment', line, endLine: line, text: text.slice(3), lines: [line], sequence }); continue; }
    // A comment ends in-stream data as any statement does, and data after it goes to the SYSIN DD *
    // the system supplies for data with no DD statement.
    if (endedByComment && !/^\/[/*&]/.test(text)) {
      diags.push({ sev: 'warn', line, text: `data after a comment that ended ${endedByComment.name || 'a DD'}'s in-stream data is read as an implicit SYSIN DD *` });
      push({ kind: 'statement', name: 'SYSIN', operation: 'DD', field: '*', implicit: true, line, endLine: line, lines: [line], sequence: '' });
      stream.inStream.push({ line, text: raw });
      endedByComment = null;
      continue;
    }
    endedByComment = null;
    if (/^\/\*/.test(text)) { push({ kind: 'delimiter', line, endLine: line, lines: [line] }); continue; }
    if (/^\/\/\s*$/.test(text)) { push({ kind: 'null', line, endLine: line, lines: [line] }); continue; }
    if (/^\/&/.test(text)) { push({ kind: 'end-of-job', line, endLine: line, lines: [line] }); continue; }
    if (!/^\/\//.test(text)) {
      diags.push({ sev: 'error', line, text: 'a statement must begin with // in columns 1 and 2' });
      push({ kind: 'unreadable', line, endLine: line, lines: [line], text });
      continue;
    }

    const body = text.slice(2);
    const m = body.match(/^(\S*)\s+(\S+)(?:\s+([\s\S]*))?$/);
    if (!m) {
      diags.push({ sev: 'error', line, text: 'no operation field' });
      push({ kind: 'unreadable', line, endLine: line, lines: [line], text });
      continue;
    }
    const [, name, op, field = ''] = m;
    const operation = op.toUpperCase();
    // A DD named PROCSTEP.DDNAME overrides or adds a DD in a step of the procedure its EXEC calls.
    const override = operation === 'DD' && name.split('.').length === 2 && name.split('.').every((p) => NAME.test(p));
    if (name && !NAME.test(name) && !override) {
      diags.push({ sev: 'warn', line, text: `name field '${name}' is not 1 to 8 characters starting with a letter or national` });
    }
    if (!OPERATIONS.has(operation)) {
      diags.push({ sev: 'warn', line, text: `operation '${operation}' is not a JCL statement this reader knows` });
    }

    const blanks = BLANKS_IN_OPERANDS.has(operation);
    const operands = blanks ? field.trim() : operandField(field.trim());
    const st = { kind: 'statement', name: name || null, operation, field: operands, line, endLine: line, lines: [line], sequence };

    // An operand field ending in a comma continues, but only when something follows it.
    if ((blanks ? /,\s*$/.test(text) : operands.endsWith(',')) && i + 1 < phys.length) { open = st; continue; }
    push(st);
  }

  if (open) {
    diags.push({ sev: 'error', line: open.line, text: 'statement ends on a continuation with nothing continuing it' });
    push(open);
  }
  return { statements, diags };
}

// DISP=(status,normal,abnormal), any part omitted. An omitted status is NEW: IBM's own example
// codes DISP=(,PASS) for "a new data set" (https://www.ibm.com/docs/en/zos/2.1.0?topic=parameter-examples-disp).
export function dispositionOf(disp) {
  if (!disp) return null;
  const [status = '', normal = '', abnormal = ''] = String(disp).replace(/^\(|\)$/g, '').split(',')
    .map((s) => s.trim().toUpperCase());
  return { status: status || 'NEW', normal: normal || null, abnormal: abnormal || null };
}

// What a step does to a dataset, read from its disposition. A DISP is (status,normal,abnormal) and
// the status is the half that says whether this step expects the dataset to exist. Getting this
// wrong in either direction matters: a step that creates a dataset is where its content comes
// from, and a step that reads one is where that content goes.
export function accessOf(disp) {
  if (!disp) return 'unknown';
  const { status } = dispositionOf(disp);
  if (status === 'NEW') return 'create';
  if (status === 'MOD') return 'append';
  if (status === 'SHR') return 'read';
  // OLD is exclusive access and says nothing about direction on its own. Claiming either would be
  // a guess, and a dataset flow built on guesses is worse than one that admits the gap.
  if (status === 'OLD') return 'exclusive';
  return 'unknown';
}

// A referback names an earlier DD rather than a dataset: DSN=*.STEP010.SYSUT2, or *.SYSUT2 within
// the same step. Left unresolved it reads as a dataset literally called "*.STEP010.SYSUT2", and
// every flow through it is lost.
export function resolveReferback(dsn, dds, currentStep) {
  const m = /^\*\.(?:([A-Z$#@][A-Z0-9$#@]{0,7})\.)?([A-Z$#@][A-Z0-9$#@]{0,7})$/i.exec(dsn || '');
  if (!m) return { dsn, referback: null };
  const [, stepName, ddName] = m;
  const target = dds.find((d) => d.name && d.name.toUpperCase() === ddName.toUpperCase()
    && (!stepName || (d.step || '').toUpperCase() === stepName.toUpperCase())
    && (stepName || d.step === currentStep));
  return { dsn: target?.dsn ?? dsn, referback: { step: stepName || currentStep, dd: ddName, resolved: !!target?.dsn } };
}

export function parseJcl(src, file, opts = {}) {
  const { statements, diags } = foldStatements(src);

  const symbols = new Map(Object.entries(opts.symbols || {}));
  const jobs = [];
  const steps = [];
  const dds = [];
  const procs = [];
  const includes = [];
  const unresolvedSymbols = new Set();
  const stepOf = new Map();
  // z/OS allows a symbolic value of at most 255 characters; a longer one is left unset.
  const setSymbol = (k, v, line) => {
    const value = v.replace(/^'|'$/g, '');
    if (value.length <= 255) { symbols.set(k, value); return; }
    diags.push({ sev: 'warn', line, text: `a symbolic parameter would be ${value.length} characters, more than JCL allows, so it was left unset` });
  };

  let job = null;
  let step = null;
  let proc = null;
  // Whether the last DD belonged to the job rather than a step, so a DD concatenated to it does too.
  let jobLevel = false;

  const resolveField = (st) => {
    const { text, unresolved } = substitute(st.field, symbols);
    for (const u of unresolved) unresolvedSymbols.add(u);
    return text;
  };

  for (const st of statements) {
    if (st.kind !== 'statement') continue;
    const field = resolveField(st);
    const { positional, keywords } = parseOperands(field);

    switch (st.operation) {
      case 'JOB':
        job = { name: st.name, field, keywords, steps: [], line: st.line };
        jobs.push(job);
        step = null;
        jobLevel = false;
        break;

      case 'PROC':
        // A PROC statement's operands are the symbolic defaults for the procedure body.
        proc = { name: st.name, line: st.line, endLine: null, steps: [] };
        procs.push(proc);
        for (const [k, v] of keywords) if (!symbols.has(k)) setSymbol(k, v, st.line);
        break;

      case 'PEND':
        if (proc) { proc.endLine = st.line; proc = null; }
        break;

      case 'SET':
        for (const [k, v] of keywords) setSymbol(k, v, st.line);
        break;

      case 'EXEC': {
        // PGM=&NAME takes the program from a symbolic. In a procedure that is usually the caller's to
        // set, and a procedure that leaves it empty names no program of its own.
        const rawPgm = parseOperands(st.field).keywords.get('PGM') || '';
        const pgmSymbol = /^&([A-Z$#@][A-Z0-9$#@]{0,7})\.?$/i.exec(rawPgm)?.[1].toUpperCase() || null;
        const named = keywords.get('PGM') || null;
        const pgm = named && !named.startsWith('&') ? named : null;
        // EXEC names either a program or a procedure; the procedure may be positional or PROC=.
        const procName = pgm || pgmSymbol ? null : (keywords.get('PROC') || positional[0] || null);
        step = {
          name: st.name, pgm, ...(pgmSymbol ? { pgmSymbol } : {}), proc: procName,
          parm: keywords.get('PARM') ? keywords.get('PARM').replace(/^'|'$/g, '') : null,
          cond: keywords.get('COND') || null,
          keywords, dds: [], line: st.line,
          inProc: proc ? proc.name : null,
        };
        if (pgmSymbol && !pgm) diags.push({ sev: 'warn', line: st.line, text: `EXEC PGM=&${pgmSymbol} names no program in this file, which ${symbols.has(pgmSymbol) ? 'leaves the symbolic empty' : 'never sets the symbolic'}, so the caller decides what the step runs` });
        else if (!pgm && !procName) diags.push({ sev: 'error', line: st.line, text: 'EXEC names neither PGM= nor a procedure' });
        steps.push(step);
        (proc ? proc.steps : job ? job.steps : []).push(step);
        break;
      }

      case 'DD': {
        const rawDsn = keywords.get('DSN') || keywords.get('DSNAME') || null;
        const disp = keywords.get('DISP') || null;
        const { dsn, referback } = resolveReferback(rawDsn, dds, step ? step.name : null);
        // The name stays as written, since a finding's identity is built from it; procStep says which
        // step of the called procedure a PROCSTEP.DDNAME override belongs to.
        const procStep = st.name && st.name.includes('.') ? st.name.split('.')[0] : null;
        const dd = {
          name: st.name, procStep, dsn, rawDsn, referback,
          disp, access: accessOf(disp),
          temporary: /^&&/.test(rawDsn || ''),
          sysout: keywords.get('SYSOUT') || null,
          inStream: st.inStream || null, dlm: st.dlm || null,
          concatenated: !st.name, keywords, line: st.line, endLine: st.endLine,
          step: step ? step.name : null,
        };
        dds.push(dd);
        if (step) { step.dds.push(dd); stepOf.set(dd, step); }
        else if (job && (JOB_LEVEL_DDS.has((st.name || '').toUpperCase()) || (!st.name && jobLevel))) { (job.dds ||= []).push(dd); jobLevel = true; continue; }
        else diags.push({ sev: 'warn', line: st.line, text: 'DD statement outside any step' });
        jobLevel = false;
        break;
      }

      case 'INCLUDE': {
        const member = keywords.get('MEMBER') || positional[0] || null;
        includes.push({ member, line: st.line, resolved: false });
        // An unresolved INCLUDE is a coverage gap in the same sense an unresolved COPY is: the
        // statements it would have contributed were never read.
        diags.push({ sev: 'warn', line: st.line, text: `INCLUDE MEMBER=${member} was not resolved, so its statements were not read` });
        break;
      }

      default:
        break;
    }
  }

  for (const s of unresolvedSymbols) {
    if (SYSTEM_SYMBOLS.has(s)) diags.push({ sev: 'info', line: 0, text: `&${s} is a system symbol, given its value when the job is converted, so the operands using it were read with the symbol in place` });
    else diags.push({ sev: 'warn', line: 0, text: `symbolic parameter &${s} has no value, so the operands using it were read unsubstituted` });
  }

  // A TSO batch step's ALLOCATE commands define DDs its JCL does not show. Each is kept as a DD of the
  // step, marked `allocated`, with the datasets of a list concatenated under it as JCL would.
  for (const s of steps) {
    const tso = tsoCommands(s);
    for (const n of tso.notes) diags.push({ sev: 'info', ...n });
    for (const a of tso.allocations) {
      const ends = a.datasets.length ? a.datasets : [{ written: null, dsn: null }];
      ends.forEach((d, i) => {
        const dd = {
          name: i === 0 ? a.dd : null, procStep: null, dsn: d.dsn, rawDsn: d.written, referback: null,
          disp: a.status, access: accessOf(a.status), temporary: false, sysout: a.sysout,
          inStream: null, dlm: null, concatenated: i > 0, keywords: new Map(), line: a.line, endLine: a.line,
          step: s.name, allocated: true,
        };
        dds.push(dd);
        s.dds.push(dd);
        stepOf.set(dd, s);
      });
    }
  }

  // What each step's program copies, from lib/utilities.mjs. A program that table does not know
  // copies nothing here, which is not the same as copying nothing.
  const copies = [];
  const copiesOfStep = new Map();
  const uses = new Map();
  for (const s of steps) {
    const found = copiesOf(s);
    if (!found) continue;
    copies.push(...found.copies);
    copiesOfStep.set(s, found.copies);
    for (const [dd, use] of found.uses) uses.set(dd, use);
    for (const n of found.notes) diags.push({ sev: 'info', ...n });
  }

  // Which steps touch each dataset, in order, and how. What a utility does with a DD outranks its
  // disposition, since SYSUT2 opened SHR is still written; a dataset a control statement names
  // itself, as REPRO OUTDATASET does, is touched with no DD.
  const byDataset = new Map();
  const touchedIn = new Map();
  const touch = (dsn, temporary, t, s) => {
    if (!byDataset.has(dsn)) byDataset.set(dsn, { dsn, temporary, touches: [] });
    byDataset.get(dsn).touches.push(t);
    touchedIn.set(t, s);
  };
  for (const dd of dds) {
    if (!dd.dsn || dd.sysout) continue;
    const s = stepOf.get(dd);
    touch(dd.dsn, dd.temporary, { step: dd.step, dd: dd.name, access: dd.access, use: uses.get(dd) || null, program: s?.pgm || null, line: dd.line }, s);
  }
  for (const [s, found] of copiesOfStep) {
    const seen = new Set();
    for (const c of found) {
      for (const [end, use] of [[c.from, 'read'], [c.to, 'write']]) {
        const key = `${c.line}|${end.dsn}|${use}`;
        if (end.dd || !end.dsn || seen.has(key)) continue;
        seen.add(key);
        touch(end.dsn, false, { step: s.name, dd: null, access: 'unknown', use, program: c.utility, line: c.line }, s);
      }
    }
  }
  for (const d of byDataset.values()) d.touches.sort((a, b) => a.line - b.line);

  const direction = (t) => t.use || (t.access === 'create' || t.access === 'append' ? 'write' : t.access === 'read' ? 'read' : null);
  const datasetFlow = [...byDataset.values()]
    .filter((d) => new Set(d.touches.map((t) => t.step)).size > 1)
    .map((d) => {
      const writes = d.touches.filter((t) => direction(t) === 'write');
      return {
        ...d,
        writtenBy: writes.map((t) => t.step),
        readBy: d.touches.filter((t) => direction(t) === 'read').map((t) => t.step),
        undetermined: d.touches.filter((t) => !direction(t)).map((t) => t.step),
        // Who wrote it: the step, the program it ran, and what that program copied in, when it is
        // a utility the table knows.
        writers: writes.map((t) => ({
          step: t.step, program: t.program, dd: t.dd, line: t.line,
          copiedFrom: (copiesOfStep.get(touchedIn.get(t)) || [])
            .filter((c) => c.to.dsn === d.dsn && c.to.dd === t.dd).map((c) => c.from),
        })),
      };
    });

  return {
    file, jobs, steps, dds, procs, includes, statements, copies, datasets: [...byDataset.values()], datasetFlow,
    symbols: Object.fromEntries(symbols),
    unresolvedSymbols: [...unresolvedSymbols],
    diags,
    coverageIncomplete: includes.length > 0 || [...unresolvedSymbols].some((s) => !SYSTEM_SYMBOLS.has(s)) || diags.some((d) => d.sev === 'error'),
  };
}

export function parseJclFile(file, opts = {}) {
  return parseJcl(readSource(file).text, file, opts);
}
