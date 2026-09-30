// SPDX-License-Identifier: AGPL-3.0-or-later
// A verification plan for one path finding, for the estate to run in a test region it owns: the
// entry to start, where the value goes in, a harmless value that shows the defect, and what to watch
// for. Where letting the operation run would act - a command, a statement, a job, a connection - the
// plan stops at the operation and reads a marker there, and never supplies a value that would run.
// It is built only for `cobolwork explain`, never for a scan report. See docs/spec/reach.md §8.
import { kindsOf } from './consequence.mjs';
import { ALL_RULES } from './kernel/registry.mjs';
import { entryName } from './reach.mjs';

export const MARKER = 'CWVRFY01';

const WHERE = 'a test region the estate owns, holding test data, under its own authorisation: never a production region, and never a system the estate does not own';

const ABSENT = `${MARKER}, after checking that nothing by that name is defined where the program looks`;
const END_TASK = 'end the task from CEDF or CEDX, or stop the program in the debugger, before the operation runs';

// What goes in, and what reading it at the operation shows. `run` says what letting the operation run
// shows; null means it would act on something, so the plan stops before it (`stopBefore`).
const SINKS = {
  // A letter's low half is 1 to 9 and its zone a valid sign, so zoned arithmetic reads it as a digit.
  arithmetic: (x) => ({ value: `an asterisk in every position of ${x.item}, whose digits it expects: a letter will not do, since zoned decimal reads a letter as a digit`, reads: `${x.item} holding the asterisks`, run: 'the task abends ASRA, a data exception (S0C7 in batch), at the operation' }),
  subscript: (x) => bounds(x, `${x.table ? `${x.table + 1}, one more than the ${x.table} entries in the table` : 'one more than the entries in the table'}, or 0`),
  'loop-bound': (x) => bounds(x, `${x.table ? `${x.table + 1}, one more than the ${x.table} entries in the table` : 'one more than the entries in the table'}`),
  'reference-modification': (x) => bounds(x, 'one more than the length of the field, or 0'),
  'occurs-depending-count': (x) => bounds(x, 'one more than the most entries the OCCURS clause allows, or 0'),
  'storage-length': (x) => ({ value: 'a length above what the program means to acquire', reads: `the LENGTH or FLENGTH the command is given, from ${x.item}`, run: null, stopBefore: `acquiring that much storage can take the region short on storage: ${END_TASK}` }),
  'record-key': (x) => ({ value: 'the key of a test record set up for a different test user', reads: `${x.item} holding that key`, run: 'the other user\'s test record comes back to the user who asked for it' }),
  'record-update': (x) => ({ value: 'the key of a test record set up for a different test user', reads: `${x.item} holding that key`, run: 'the other user\'s test record is changed or deleted: set the record up for this test alone' }),
  'dynamic-program-load': (x) => ({ value: ABSENT, reads: `${MARKER} as the program the CALL loads, from ${x.item}`, run: `the CALL fails to load ${MARKER} (an S806 abend in batch)` }),
  'cics-dynamic-transfer': (x) => ({ value: ABSENT, reads: `${MARKER} as the program or transaction the command names, from ${x.item}`, run: `the command fails with PGMIDERR, or TRANSIDERR for a START` }),
  'dynamic-file-path': (x) => ({ value: ABSENT, reads: `${MARKER} as the file the program assigns, from ${x.item}`, run: 'the OPEN fails with file status 35' }),
  'cics-sysid': (x) => ({ value: ABSENT, reads: `${MARKER} as the SYSID the command is shipped to, from ${x.item}`, run: 'the command fails with SYSIDERR' }),
  'queue-name': (x) => marker(x, 'as the queue the command acts on', 'the command would act on a queue the input chose'),
  'web-response': (x) => ({ value: `${MARKER}<>`, reads: `${MARKER}<> in ${x.item}`, run: `the response body carries ${MARKER}<> as sent, not ${MARKER}&lt;&gt;` }),
  screen: (x) => ({ value: MARKER, reads: `${MARKER} in ${x.item}`, run: `${MARKER} on the screen` }),
  log: (x) => ({ value: MARKER, reads: `${MARKER} in ${x.item}`, run: `${MARKER} in the log as sent, which shows a line break would go in the same way` }),
  'http-header': (x) => marker(x, 'in the header value', 'the header would go to the caller'),
  'os-command': (x) => marker(x, 'in the command', 'the command would run'),
  'dynamic-sql': (x) => marker(x, 'in the statement text', 'the statement would run'),
  'internal-reader': (x) => marker(x, 'in the record written', 'the job would be submitted'),
  'cics-system-resource': (x) => marker(x, 'as the resource the SET names', 'the command would change a region resource'),
  'connection-target': (x) => marker(x, 'as the database or queue manager named', 'the connection would be made'),
  'outbound-host': (x) => marker(x, 'as the host or path of the request', 'the request would go out'),
  'outbound-http': (x) => marker(x, 'in what the request sends', 'the request would go out'),
  'socket-send': (x) => marker(x, 'in what the socket sends', 'the data would leave the program'),
  'message-queue': (x) => marker(x, 'in the message put', 'the message would be put'),
  'extrapartition-queue': (x) => marker(x, 'in the record written', 'the record would leave the region through its DD'),
  'xml-document': (x) => marker(x, 'in the document parsed', 'the parser would read it'),
};

function bounds(x, value) {
  return {
    value,
    reads: `${x.item} out of range at the operation`,
    ...(x.ssrange ? { run: 'the task abends with a Language Environment range message (IGZ0006S for a subscript), since the program is compiled with SSRANGE' }
      : { run: null, stopBefore: `without SSRANGE the operation reaches the storage beside the table or field: ${END_TASK}` }),
  };
}

function marker(x, where, acts) {
  return { value: MARKER, reads: `${MARKER} ${where}, from ${x.item}`, run: null, stopBefore: `${acts}: ${END_TASK}` };
}

// Where the value goes in, by where the finding says the input comes from.
function enterAt(source, f, src, loc) {
  const field = f.screen ? `field ${f.screen.field} of map ${f.screen.map}${f.screen.mapset ? ` in mapset ${f.screen.mapset}` : ''}` : null;
  switch (source) {
    case 'cics-terminal': return field ? `${field}, received at ${loc}` : `the terminal input received at ${loc}`;
    case 'cics-protected-field': return `${field || 'the protected field'}: the map protects it, so change it under CEDF in the data the RECEIVE MAP at ${loc} returns, not with a modified client`;
    case 'cics-web': return `the web request read at ${loc}`;
    case 'argv-or-env': return `the command line or environment of the run, read at ${loc}`;
    case 'jcl-parm': return `${src?.detail || 'the PARM'}, in a copy of the job`;
    case 'jcl-instream': return `${src?.detail || 'the in-stream data'}, in a copy of the job`;
    case 'file-record': return `a test record in a test copy of the file read at ${loc}`;
    case 'database': return `a test row in a test copy of the table read at ${loc}`;
    default: return null;
  }
}

// CEDF and CEDX stop at EXEC CICS and EXEC SQL; a CALL, a COMPUTE or a subscript needs a debugger.
function toolFor(source, entries, program) {
  const tran = entries.find((e) => e.transaction)?.transaction;
  const debug = 'or a debugger such as z/OS Debugger where the operation is not an EXEC command';
  if (source === 'cics-web') return `CEDX ${tran || `on the transaction that runs ${program}`}, since a web request has no terminal, ${debug}`;
  if (tran || source === 'cics-terminal' || source === 'cics-protected-field') return `CEDF at the terminal that runs ${tran || program}, ${debug}`;
  return 'a debugger such as z/OS Debugger';
}

export function verificationPlan(f) {
  const kinds = ALL_RULES[f.rule]?.evidence === 'path' ? kindsOf(f.rule) : null;
  if (!kinds || !SINKS[kinds.sink]) return null;
  const entries = f.startedBy || [];
  const src = f.related?.[0];
  const loc = src ? `${src.path}:${src.line}` : 'the source';
  const last = f.trace?.length ? f.trace[f.trace.length - 1] : null;
  const table = Number(/a table of (\d+)$/.exec(f.detail || '')?.[1]) || null;
  const x = { item: last?.item || 'the value', table, ssrange: !!f.ssrange };
  const sink = `${f.path}:${f.line}`;
  const tool = toolFor(kinds.source, entries, f.program || 'the program');
  const start = entries.length
    ? `${entries.map(entryName).join('; ')}${f.startedByMore ? `; or one of ${f.startedByMore} more not listed` : ''}`
    : `nothing in this tree starts ${f.program || 'the program'}: start it the way the estate does`;

  if (kinds.source === 'system-response') {
    return {
      where: WHERE, start, tool,
      enter: `nothing: provoke the failure the program reports at ${loc}, such as a key that matches no test record`,
      value: null,
      observe: `stop at ${sink} and read ${x.item}: the response code or error text is in it`,
      run: 'the code or error text reaches the caller in what the program sends back',
      record: record(f),
    };
  }

  const s = SINKS[kinds.sink](x);
  return {
    where: WHERE, start, tool,
    enter: enterAt(kinds.source, f, src, loc),
    value: s.value,
    observe: `stop at ${sink} and read ${s.reads}: that is the defect, whatever the operation does next`,
    run: s.run,
    ...(s.stopBefore ? { stopBefore: s.stopBefore } : {}),
    ...(f.guardedFrom && f.guard ? { check: `if the check on ${f.guard.item} at ${f.guard.file}:${f.guard.line} turns the value away first, record not-reproduced: the check stops it, and the finding can be judged a false positive` } : {}),
    record: record(f),
  };
}

const record = (f) => `bring the result in a COBOLWORK_WITNESS feed under "${f.fingerprint}": outcome "reproduced" or "not-reproduced", who ran it, the date and the system; what was entered is not recorded there`;
