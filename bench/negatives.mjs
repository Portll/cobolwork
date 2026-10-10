// SPDX-License-Identifier: AGPL-3.0-or-later
// Programs whose answer is known by construction, for every path rule a source and a sink template
// cover: guards that make the sink safe (negatives) and near-misses of them that do not
// (positives), each inline and deeper in the program (docs/spec/reach.md §9.6). cobolwork scans
// each one, so an item also says whether the analyser itself gets it right: a negative it reports
// is a false alarm of its own, which is what a model reviewing its findings has to catch.
//
// --prompts writes each item as a question for bench/label-models.mjs --items: the rule, the source
// and the sink, and every line of the program, asked as a finding of the corpus is asked. --labels
// writes each item as a label for bench/precision.mjs, source `generated`: its answer and whether
// cobolwork reported it.
//
//   node bench/negatives.mjs [--out <dir>] [--json <file> [--with-files]] [--prompts <file>] [--labels <file>]
//        [--rule <id>]
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanAll } from '../lib/scan.mjs';
import { RULES } from '../lib/sets/flow.mjs';
import { capped, excerpt, QUESTION } from './label-models.mjs';

const ALLOWED = ["'CWPGM1'", "'CWPGM2'"];
const DATA_AT_REST = new Set(['database', 'file-record', 'cics-queue']);
const JOB = '//CWJOB    JOB (ACCT),CLASS=A,MSGCLASS=X';

// Where the input comes from: the statements that fill WS-IN, which of them reads the input (`at`,
// the first by default) and how cobolwork names it. A source a job hands in (`jcl`) is placed in
// the job, at the line `jcl.at` matches; `selects`, `fds`, `data` and `linkage` are what the
// program declares for it, and `aux` the other files it needs.
const SOURCES = {
  'argv-or-env': { detail: 'ACCEPT ... FROM COMMAND-LINE', stmt: () => ['ACCEPT WS-IN FROM COMMAND-LINE'] },
  'cics-terminal': { detail: 'EXEC CICS RECEIVE', stmt: () => ['EXEC CICS RECEIVE INTO(WS-IN) LENGTH(WS-LEN)', '     END-EXEC'] },
  'cics-web': { detail: 'EXEC CICS WEB RECEIVE', stmt: () => ['EXEC CICS WEB RECEIVE INTO(WS-IN) LENGTH(WS-LEN)', '     END-EXEC'] },
  'cics-queue': { detail: 'EXEC CICS READQ TS INTO', stmt: () => ["EXEC CICS READQ TS QUEUE('CWQ1') INTO(WS-IN)", '     LENGTH(WS-LEN) END-EXEC'] },
  database: { detail: 'EXEC SQL SELECT INTO host variable', stmt: () => ['EXEC SQL SELECT NAME INTO :WS-IN FROM CWT1', '     WHERE ID = 1 END-EXEC'] },
  'file-record': {
    detail: 'READ ... INTO',
    at: 1,
    selects: ['           SELECT IN-FILE ASSIGN TO INDD.'],
    fds: ['       FD  IN-FILE.', '       01  IN-REC PIC X(80).'],
    stmt: () => ['OPEN INPUT IN-FILE', 'READ IN-FILE INTO WS-IN', 'CLOSE IN-FILE'],
  },
  // On z/OS a PARM arrives as a halfword length and the text, in the first USING item.
  'jcl-parm': {
    detail: 'PARM= on step STEP1 of CWJOB.jcl, which runs CWMAIN',
    jcl: { parm: "'VALUE1'", at: /EXEC PGM=/ },
    linkage: (numeric) => ['       01  LS-PARM.', '           05  LS-PARM-LEN PIC S9(4) COMP.', `           05  LS-PARM-TEXT ${numeric ? 'PIC 9(4)' : 'PIC X(8)'}.`],
    using: 'LS-PARM',
    stmt: () => ['MOVE LS-PARM-TEXT TO WS-IN'],
  },
  'jcl-instream': {
    detail: '1 lines of in-stream data on //SYSIN in step STEP1, read through SELECT IN-FILE',
    jcl: { dds: ['//SYSIN    DD *', 'VALUE1', '/*'], at: /^\/\/SYSIN/ },
    selects: ['           SELECT IN-FILE ASSIGN TO SYSIN.'],
    fds: ['       FD  IN-FILE.', '       01  IN-REC PIC X(80).'],
    stmt: () => ['OPEN INPUT IN-FILE', 'READ IN-FILE INTO WS-IN', 'CLOSE IN-FILE'],
  },
  'system-response': {
    detail: 'SQLERRMC, which the system sets',
    at: 2,
    data: ['           EXEC SQL INCLUDE SQLCA END-EXEC.'],
    stmt: () => ['EXEC SQL SELECT NAME INTO :WS-DATA FROM CWT1', '     WHERE ID = 1 END-EXEC', 'MOVE SQLERRMC TO WS-IN'],
  },
  'cics-system-info': { detail: 'the APPLID EXEC CICS ASSIGN returns', stmt: () => ['EXEC CICS ASSIGN APPLID(WS-IN) END-EXEC'] },
  // A field the map protects, with FSET so it comes back on every RECEIVE MAP.
  'cics-protected-field': {
    detail: 'EXEC CICS RECEIVE MAP(CWMAP1) returns CUSTIDI, field CUSTID of map CWMAP1 in mapset CWMAP, which the map marks PROT with FSET',
    data: ['       01  CWMAP1I.', '           05  FILLER PIC X(12).', '           05  CUSTIDL PIC S9(4) COMP.', '           05  CUSTIDF PIC X.', '           05  CUSTIDI PIC X(8).'],
    aux: { 'CWMAP.bms': ['CWMAP    DFHMSD TYPE=&SYSPARM,MODE=INOUT,LANG=COBOL,TIOAPFX=YES', 'CWMAP1   DFHMDI SIZE=(24,80)',
      'CUSTID   DFHMDF POS=(1,1),LENGTH=8,ATTRB=(PROT,FSET)', '         DFHMSD TYPE=FINAL', '         END'] },
    stmt: () => ["EXEC CICS RECEIVE MAP('CWMAP1') MAPSET('CWMAP')", '     INTO(CWMAP1I) END-EXEC', 'MOVE CUSTIDI TO WS-IN'],
  },
};

// What a sink does with a field, and the items it needs. `kind` groups sinks by what makes them
// safe: `set` (a value that can only be one of a list), `bound` (an index kept in range), `digits`
// (a value that is only digits), `out` (a value sent out of the program, safe only replaced),
// `key` (a record key a client must not choose, safe only fixed or replaced),
// `none` (no guard the analyser credits). `use` may depend on the source. `where` matches the line
// cobolwork names for the sink where that is not the first line of `use`; `selects`, `fds`,
// `data` and `tail` go in the program holding the sink, `jcl` and `aux` beside it.
const SINKS = {
  'os-command': { kind: 'set', use: (f) => [`CALL 'SYSTEM' USING ${f}`] },
  'dynamic-sql': { kind: 'set', use: (f) => [`EXEC SQL EXECUTE IMMEDIATE :${f} END-EXEC`] },
  'cics-dynamic-transfer': { kind: 'set', use: (f) => [`EXEC CICS LINK PROGRAM(${f}) END-EXEC`] },
  'dynamic-program-load': { kind: 'set', use: (f) => [`CALL ${f}`] },
  'queue-name': { kind: 'set', use: (f) => [`EXEC CICS WRITEQ TS QUEUE(${f}) FROM(WS-DATA)`, '     END-EXEC'] },
  'outbound-host': { kind: 'set', use: (f) => [`EXEC CICS WEB OPEN HOST(${f}) HOSTLENGTH(WS-LEN)`, '     SESSTOKEN(WS-TOKEN) END-EXEC'] },
  'cics-sysid': { kind: 'set', use: (f) => [`EXEC CICS LINK PROGRAM('CWPGM2') SYSID(${f})`, '     END-EXEC'] },
  'connection-target': { kind: 'set', use: (f) => [`EXEC SQL CONNECT TO :${f} END-EXEC`] },
  // Stored data is only a finding where it is sent as markup.
  'web-response': { kind: 'set', use: (f, src) => [`EXEC CICS WEB SEND FROM(${f}) FROMLENGTH(WS-LEN)`, DATA_AT_REST.has(src) ? "     MEDIATYPE('text/html') END-EXEC" : '     MEDIATYPE(WS-MEDIA) END-EXEC'] },
  log: { kind: 'set', use: (f) => [`DISPLAY ${f}`] },
  // Its branches name the allowed values, so a value an allow-list lets through has a branch to run.
  'unhandled-selector': { kind: 'set', use: (f) => [`EVALUATE ${f}`, ...ALLOWED.map((v) => `   WHEN ${v}`), '      CONTINUE', 'END-EVALUATE'] },
  arithmetic: { kind: 'digits', numeric: true, use: (f) => [`COMPUTE WS-RESULT = ${f} + 1`] },
  subscript: { kind: 'bound', numeric: true, use: (f) => [`DISPLAY WS-ROW(${f})`] },
  'reference-modification': { kind: 'bound', numeric: true, use: (f) => [`DISPLAY WS-TEXT(${f}:1)`] },
  'loop-bound': { kind: 'bound', numeric: true, use: (f) => ['PERFORM VARYING WS-I FROM 1 BY 1', `   UNTIL WS-I > ${f}`, '   DISPLAY WS-ROW(WS-I)', 'END-PERFORM'] },
  // CICS acquires storage with GETMAIN; a batch program through Language Environment.
  'storage-length': {
    kind: 'bound', numeric: true,
    use: (f, src) => (src.startsWith('cics-') ? [`EXEC CICS GETMAIN SET(WS-PTR) FLENGTH(${f})`, '     END-EXEC'] : [`MOVE ${f} TO WS-SIZE`, "CALL 'CEEGTST' USING WS-HEAPID WS-SIZE WS-PTR WS-FC"]),
    where: /GETMAIN|CALL 'CEEGTST'/,
    data: (src) => (src.startsWith('cics-') ? [] : ['       01  WS-SIZE PIC S9(9) BINARY.', '       01  WS-HEAPID PIC S9(9) BINARY VALUE 0.', '       01  WS-FC PIC X(12).']),
  },
  'numeric-truncation': { kind: 'none', numeric: true, use: (f) => [`MOVE ${f} TO WS-SMALL`] },
  'text-truncation': { kind: 'none', use: (f) => [`STRING ${f} DELIMITED BY SIZE`, '   INTO WS-SHORT', 'END-STRING'] },
  'dynamic-file-path': {
    kind: 'set', where: /SELECT OUT-FILE/,
    selects: ['           SELECT OUT-FILE ASSIGN TO WS-PATH.'], fds: ['       FD  OUT-FILE.', '       01  OUT-REC PIC X(80).'], data: ['       01  WS-PATH PIC X(44).'],
    use: (f) => [`MOVE ${f} TO WS-PATH`, 'OPEN OUTPUT OUT-FILE', 'CLOSE OUT-FILE'],
  },
  // What the step writes to a DD the job sends to the internal reader is submitted as a job.
  'internal-reader': {
    kind: 'set', where: /SELECT OUT-FILE/,
    selects: ['           SELECT OUT-FILE ASSIGN TO CWRDR.'], fds: ['       FD  OUT-FILE.', '       01  OUT-REC PIC X(80).'],
    jcl: { dds: ['//CWRDR    DD SYSOUT=(A,INTRDR)'] },
    use: (f) => [`MOVE ${f} TO OUT-REC`, 'OPEN OUTPUT OUT-FILE', 'WRITE OUT-REC', 'CLOSE OUT-FILE'],
  },
  'http-header': {
    kind: 'set', data: ["       01  WS-HNAME PIC X(4) VALUE 'X-CW'.", '       01  WS-HLEN PIC S9(8) COMP VALUE 4.'],
    use: (f) => ['EXEC CICS WEB WRITE HTTPHEADER(WS-HNAME)', `     NAMELENGTH(WS-HLEN) VALUE(${f})`, '     VALUELENGTH(WS-LEN) END-EXEC'],
  },
  // A table of no entries is valid, so the count, like a loop's, needs only its top kept.
  'occurs-depending-count': {
    kind: 'bound', numeric: true, where: /05  WS-ODO-ROW/,
    data: ['       01  WS-ODO-N PIC 9(4) VALUE 1.', '       01  WS-ODO-TABLE.', '           05  WS-ODO-ROW PIC X(4)', '               OCCURS 0 TO 10 DEPENDING ON WS-ODO-N.'],
    use: (f) => [`MOVE ${f} TO WS-ODO-N`, 'DISPLAY WS-ODO-TABLE'],
  },
  'cics-system-resource': { kind: 'set', use: (f) => [`EXEC CICS SET FILE(${f}) CLOSED END-EXEC`] },
  'xml-document': { kind: 'set', use: (f) => [`XML PARSE ${f}`, '   PROCESSING PROCEDURE XML-HANDLER', 'END-XML'], tail: ['       XML-HANDLER.', '           CONTINUE.'] },
  'outbound-http': { kind: 'out', use: (f) => ['EXEC CICS WEB CONVERSE SESSTOKEN(WS-TOKEN) POST', `     FROM(${f}) FROMLENGTH(WS-LEN)`, '     INTO(WS-DATA) TOLENGTH(WS-LEN) END-EXEC'] },
  'socket-send': {
    kind: 'out',
    data: ["       01  WS-SOC-FUNCTION PIC X(16) VALUE 'SEND'.", '       01  WS-SOCKID PIC 9(4) BINARY VALUE 0.', '       01  WS-FLAGS PIC 9(8) BINARY VALUE 0.',
      '       01  WS-NBYTE PIC 9(8) BINARY VALUE 8.', '       01  WS-ERRNO PIC 9(8) BINARY.', '       01  WS-RETCODE PIC S9(8) BINARY.'],
    use: (f) => ["CALL 'EZASOKET' USING WS-SOC-FUNCTION WS-SOCKID", `   WS-FLAGS WS-NBYTE ${f} WS-ERRNO WS-RETCODE`],
  },
  'message-queue': {
    kind: 'out',
    data: ['       01  WS-HCONN PIC S9(9) BINARY.', '       01  WS-HOBJ PIC S9(9) BINARY.', '       01  WS-MD PIC X(364).', '       01  WS-PMO PIC X(184).',
      '       01  WS-BUFLEN PIC S9(9) BINARY VALUE 8.', '       01  WS-CC PIC S9(9) BINARY.', '       01  WS-RC PIC S9(9) BINARY.'],
    use: (f) => ["CALL 'MQPUT' USING WS-HCONN WS-HOBJ WS-MD WS-PMO", `   WS-BUFLEN ${f} WS-CC WS-RC`],
  },
  // A transient-data queue the CSD sends to a DD leaves the region.
  'extrapartition-queue': {
    kind: 'out', aux: { 'CWCSD.csd': ['DEFINE TDQUEUE(CWTD) GROUP(CWGRP) TYPE(EXTRA) DDNAME(CWOUT)'] },
    use: (f) => [`EXEC CICS WRITEQ TD QUEUE('CWTD') FROM(${f})`, '     LENGTH(WS-LEN) END-EXEC'],
  },
  screen: { kind: 'set', use: (f) => [`EXEC CICS SEND TEXT FROM(${f}) LENGTH(WS-LEN)`, '     ERASE END-EXEC'] },
  'record-key': { kind: 'key', use: (f) => ["EXEC CICS READ FILE('CWFILE') INTO(WS-DATA)", `     RIDFLD(${f}) END-EXEC`] },
  'record-update': { kind: 'key', use: (f) => [`EXEC CICS DELETE FILE('CWFILE') RIDFLD(${f})`, '     END-EXEC'] },
};

// A guard placed before the sink, and whether the sink is then safe: `truth` is the answer by
// construction. `fits` says which sinks the guard means something for.
const GUARDS = {
  // Negatives: the value cannot reach the sink in a form that makes it unsafe.
  'allow-list': { truth: 'does-not-reach', fits: (s) => s.kind === 'set', code: (f) => [`EVALUATE ${f}`, ...ALLOWED.map((v) => `   WHEN ${v}`), '      CONTINUE', '   WHEN OTHER', '      GOBACK', 'END-EVALUATE'] },
  'must-equal': { truth: 'does-not-reach', fits: (s) => s.kind === 'set' || s.kind === 'key', code: (f) => [`IF ${f} NOT = ${ALLOWED[0]}`, '   GOBACK', 'END-IF'] },
  'condition-name': { truth: 'does-not-reach', fits: (s) => s.kind === 'set', code: (f) => [`MOVE ${f} TO WS-CHOICE`, 'IF NOT WS-CHOICE-OK', '   GOBACK', 'END-IF'] },
  'numeric-test': { truth: 'does-not-reach', fits: (s) => s.kind === 'digits', code: (f) => [`IF ${f} IS NOT NUMERIC`, '   GOBACK', 'END-IF'] },
  'both-bounds': { truth: 'does-not-reach', fits: (s) => s.kind === 'bound', code: (f) => [`IF ${f} < 1 OR ${f} > 10`, '   GOBACK', 'END-IF'] },
  'upper-bound-fits': { truth: 'does-not-reach', fits: (s) => s.kind === 'none' && s.numeric, code: (f) => [`IF ${f} > 99`, '   GOBACK', 'END-IF'] },
  overwritten: { truth: 'does-not-reach', fits: () => true, code: (f, s) => [`MOVE ${s.numeric ? '1' : ALLOWED[0]} TO ${f}`] },
  'checked-by-flag': { truth: 'does-not-reach', fits: (s) => s.kind === 'set', code: (f) => ["MOVE 'N' TO WS-BAD", `EVALUATE ${f}`, ...ALLOWED.map((v) => `   WHEN ${v}`), '      CONTINUE', '   WHEN OTHER', "      MOVE 'Y' TO WS-BAD", 'END-EVALUATE', "IF WS-BAD = 'Y'", '   GOBACK', 'END-IF'] },
  'table-search': { truth: 'does-not-reach', fits: (s) => s.kind === 'set', code: (f) => ['SET WS-AX TO 1', 'SEARCH WS-ALLOWED', '   AT END', '      GOBACK', `   WHEN WS-ALLOWED-NAME(WS-AX) = ${f}`, '      CONTINUE', 'END-SEARCH'] },
  // Positives: a near-miss of a guard, which leaves the sink unsafe.
  none: { truth: 'reaches', fits: () => true, code: () => [] },
  'otherwise-continues': { truth: 'reaches', fits: (s) => s.kind === 'set', code: (f) => [`EVALUATE ${f}`, ...ALLOWED.map((v) => `   WHEN ${v}`), "      MOVE 'K' TO WS-NOTE", '   WHEN OTHER', '      CONTINUE', 'END-EVALUATE'] },
  'guards-another-field': { truth: 'reaches', fits: (s) => s.kind !== 'none', code: (f, s) => (s.kind === 'set' ? [`IF WS-OTHER NOT = ${ALLOWED[0]}`, '   GOBACK', 'END-IF'] : ['IF WS-COUNT < 1 OR WS-COUNT > 10', '   GOBACK', 'END-IF']) },
  // A count or a length needs only its top kept; a subscript or a start needs both ends.
  'upper-bound-only': { truth: 'reaches', truthFor: { 'loop-bound': 'does-not-reach', 'storage-length': 'does-not-reach', 'occurs-depending-count': 'does-not-reach' }, fits: (s) => s.kind === 'bound', code: (f) => [`IF ${f} > 10`, '   GOBACK', 'END-IF'] },
  // One past the ten-row table; for a length of storage, eleven bytes are as harmless as ten.
  'bound-off-by-one': { truth: 'reaches', truthFor: { 'storage-length': 'does-not-reach' }, fits: (s) => s.kind === 'bound', code: (f) => [`IF ${f} < 1 OR ${f} > 11`, '   GOBACK', 'END-IF'] },
  // Adversarial items, asked for one source per sink: what a reviewer must read the code for, not
  // the names or the comments. Each is a near-miss but the last.
  'guard-after-sink': { truth: 'reaches', sampled: true, fits: (s) => s.kind === 'set', code: () => [], after: (f) => [`EVALUATE ${f}`, ...ALLOWED.map((v) => `   WHEN ${v}`), '      CONTINUE', '   WHEN OTHER', '      GOBACK', 'END-EVALUATE'] },
  // WS-COUNT holds 1 and nothing changes it, so the test never passes.
  'dead-guard': { truth: 'reaches', sampled: true, fits: (s) => s.kind === 'set', code: (f) => ['IF WS-COUNT > 9999', `   EVALUATE ${f}`, ...ALLOWED.map((v) => `      WHEN ${v}`), '         CONTINUE', '      WHEN OTHER', '         GOBACK', '   END-EVALUATE', 'END-IF'] },
  'comment-says-checked': { truth: 'reaches', sampled: true, fits: () => true, code: (f) => [`*    ${f} WAS CHECKED AGAINST THE ALLOW-LIST BY THE CALLER.`, '*    NO FURTHER VALIDATION IS NEEDED HERE.'] },
  'misleading-paragraph': { truth: 'reaches', sampled: true, fits: (s) => s.kind !== 'none', code: () => ['PERFORM VALIDATE-INPUT'],
    tail: (f, s) => ['       VALIDATE-INPUT.', ...(s.kind === 'set' ? [`IF WS-OTHER NOT = ${ALLOWED[0]}`, '   GOBACK', 'END-IF.'] : ['IF WS-COUNT < 1 OR WS-COUNT > 10', '   GOBACK', 'END-IF.']).map(line)] },
  'comment-says-unchecked': { truth: 'does-not-reach', sampled: true, fits: (s) => s.kind === 'set', code: (f) => [`*    TODO: ${f} IS NOT VALIDATED YET.`, `EVALUATE ${f}`, ...ALLOWED.map((v) => `   WHEN ${v}`), '      CONTINUE', '   WHEN OTHER', '      GOBACK', 'END-EVALUATE'] },
};

// Where the guard and the sink sit: beside the source, in a paragraph PERFORMed later, after the
// value has moved through two other fields, or in a subprogram the input is passed to.
const PLACEMENTS = ['inline', 'paragraph', 'hops', 'subprogram'];

const AREA_B = '           ';
// A line starting with * is a comment, marked in column 7.
const line = (s) => (s.startsWith('*') ? `      ${s}` : `${AREA_B}${s}`);

function data(numeric) {
  const pic = numeric ? 'PIC 9(4)' : 'PIC X(8)';
  return [
    `       01  WS-IN ${pic}.`, `       01  WS-A ${pic}.`, `       01  WS-B ${pic}.`,
    `       01  WS-OTHER ${pic} VALUE ${numeric ? '1' : "'CWPGM1'"}.`,
    '       01  WS-COUNT PIC 9(4) VALUE 1.',
    '       01  WS-LEN PIC S9(8) COMP VALUE 8.',
    '       01  WS-DATA PIC X(8) VALUE SPACES.', '       01  WS-TOKEN PIC X(8).', '       01  WS-MEDIA PIC X(56) VALUE SPACES.',
    '       01  WS-RESULT PIC 9(5).', '       01  WS-SMALL PIC 9(2).', '       01  WS-SHORT PIC X(4).', '       01  WS-NOTE PIC X.',
    "       01  WS-BAD PIC X VALUE 'N'.", '       01  WS-PTR USAGE POINTER.', '       01  WS-I PIC 9(4).',
    '       01  WS-TABLE.', '           05  WS-ROW PIC X(4) OCCURS 10.', '       01  WS-TEXT PIC X(10) VALUE SPACES.',
    '       01  WS-CHOICE PIC X(8).', ...ALLOWED.map((v, k) => (k ? `               ${v}` : `           88  WS-CHOICE-OK VALUES ${v}`)),
    '       01  WS-ALLOWED-LIST.', ...ALLOWED.map((v) => `           05  FILLER PIC X(8) VALUE ${v}.`),
    '       01  WS-ALLOWED-TABLE REDEFINES WS-ALLOWED-LIST.', `           05  WS-ALLOWED OCCURS ${ALLOWED.length} INDEXED BY WS-AX.`, '               10  WS-ALLOWED-NAME PIC X(8).',
  ];
}

// The 88-level's values end with a period on their last line.
const fixEighty8 = (lines) => {
  const at = lines.findIndex((l) => l.includes('88  WS-CHOICE-OK'));
  if (at >= 0) lines[at + ALLOWED.length - 1] += '.';
  return lines;
};

// A declaration list a source or a sink gives as it is, or as it depends on the source.
const part = (x, srcKind) => (typeof x === 'function' ? x(srcKind) : x || []);

// The environment and data divisions down to WORKING-STORAGE's last item.
const declare = (selects, fds, storage) => [
  ...(selects.length ? ['       INPUT-OUTPUT SECTION.', '       FILE-CONTROL.', ...selects] : []),
  '       DATA DIVISION.', ...(fds.length ? ['       FILE SECTION.', ...fds] : []),
  '       WORKING-STORAGE SECTION.', ...storage,
];

// An item's program files, the main program first, then any job, map or CSD it needs, and where
// its source and its sink are. Every main program is CWMAIN, so what a model is shown depends only
// on what the item is made of.
function program({ srcKind, sinkName, guardName, placement }) {
  const src = SOURCES[srcKind];
  const sink = SINKS[sinkName];
  const guard = GUARDS[guardName];
  const numeric = !!sink.numeric;
  const field = placement === 'hops' ? 'WS-B' : 'WS-IN';
  const checks = guard.code(field, sink);
  const after = guard.after ? guard.after(field, sink) : [];
  const uses = sink.use(field, srcKind);
  const inSub = placement === 'subprogram';
  const sinkDecl = (on) => (on ? [part(sink.selects, srcKind), part(sink.fds, srcKind), part(sink.data, srcKind)] : [[], [], []]);
  const [mSelects, mFds, mData] = sinkDecl(!inSub);
  const main = ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. CWMAIN.', '       ENVIRONMENT DIVISION.',
    ...declare([...part(src.selects), ...mSelects], [...part(src.fds), ...mFds], [...fixEighty8(data(numeric)), ...part(src.data), ...mData]),
    ...(src.linkage ? ['       LINKAGE SECTION.', ...src.linkage(numeric)] : []),
    `       PROCEDURE DIVISION${src.using ? ` USING ${src.using}` : ''}.`, '       MAIN-PARA.'];
  const sourceLine = main.length + (src.at || 0) + 1;
  main.push(...src.stmt().map(line));
  let holder;
  let sinkStart;
  const use = (lines) => { holder = lines; sinkStart = lines.length + checks.length + 1; lines.push(...[...checks, ...uses, ...after].map(line)); };
  const files = { 'CWMAIN.cbl': null };
  if (placement === 'inline') { use(main); main.push(line('GOBACK.')); }
  else if (placement === 'paragraph') { main.push(line('PERFORM USE-PARA'), line('GOBACK.'), '       USE-PARA.'); use(main); main.push(line('EXIT.')); }
  else if (placement === 'hops') { main.push(line('MOVE WS-IN TO WS-A'), line('MOVE WS-A TO WS-B')); use(main); main.push(line('GOBACK.')); }
  else {
    main.push(line("CALL 'CWSUB' USING WS-IN"), line('GOBACK.'));
    const [sSelects, sFds, sData] = sinkDecl(true);
    const sub = ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. CWSUB.', ...(sSelects.length ? ['       ENVIRONMENT DIVISION.'] : []),
      ...declare(sSelects, sFds, [...fixEighty8(data(numeric)).filter((l) => !/WS-IN /.test(l)), ...sData]),
      '       LINKAGE SECTION.', `       01  WS-IN ${numeric ? 'PIC 9(4)' : 'PIC X(8)'}.`, '       PROCEDURE DIVISION USING WS-IN.'];
    use(sub);
    sub.push(line('GOBACK.'));
    files['CWSUB.cbl'] = sub;
  }
  holder.push(...(sink.tail || []), ...(guard.tail ? guard.tail(field, sink) : []));
  const holderName = inSub ? 'CWSUB.cbl' : 'CWMAIN.cbl';
  const sinkLine = sink.where ? holder.findIndex((l) => sink.where.test(l)) + 1 : sinkStart;
  files['CWMAIN.cbl'] = main;
  const jcl = src.jcl || sink.jcl ? [JOB, `//STEP1    EXEC PGM=CWMAIN${src.jcl?.parm ? `,PARM=${src.jcl.parm}` : ''}`, ...(src.jcl?.dds || []), ...(sink.jcl?.dds || [])] : null;
  if (jcl) files['CWJOB.jcl'] = jcl;
  for (const [name, lines] of Object.entries({ ...src.aux, ...sink.aux })) files[name] = lines;
  const source = src.jcl ? { file: 'CWJOB.jcl', line: jcl.findIndex((l) => src.jcl.at.test(l)) + 1, text: src.detail } : { file: 'CWMAIN.cbl', line: sourceLine, text: src.detail };
  return { files: Object.fromEntries(Object.entries(files).map(([n, l]) => [n, `${l.join('\n')}\n`])), at: { source, sink: { file: holderName, line: sinkLine } } };
}

// Every item the templates make for the path rules they cover, each with its answer.
export function items({ rule = null } = {}) {
  const out = [];
  const firstSource = new Map(Object.keys(SINKS).map((s) => [s, Object.keys(SOURCES).find((src) => RULES[`${src}-to-${s}`]?.evidence === 'path')]));
  for (const [srcKind] of Object.entries(SOURCES)) {
    for (const [sinkName, sink] of Object.entries(SINKS)) {
      const r = `${srcKind}-to-${sinkName}`;
      if (!RULES[r] || RULES[r].evidence !== 'path' || (rule && r !== rule)) continue;
      let deep = 0;
      for (const [guardName, guard] of Object.entries(GUARDS)) {
        if (!guard.fits(sink) || (guard.sampled && firstSource.get(sinkName) !== srcKind)) continue;
        // Each guard inline, and in one deeper placement, taken in turn across the guards.
        for (const placement of ['inline', PLACEMENTS[1 + (deep++ % 3)]]) {
          const id = `CW${String(out.length + 1).padStart(4, '0')}`;
          out.push({ id, rule: r, source: srcKind, sink: sinkName, guard: guardName, placement, truth: guard.truthFor?.[sinkName] || guard.truth, ...program({ srcKind, sinkName, guardName, placement }) });
        }
      }
    }
  }
  return out;
}

// An item asked as a finding of the corpus is asked (bench/label-models.mjs): the rule, the source,
// the sink and, since a program here is short, every line of each file.
export function questionFor(item) {
  const r = RULES[item.rule];
  const { source, sink } = item.at;
  const code = Object.entries(item.files).map(([name, text]) => {
    const n = text.replace(/\n$/, '').split('\n').length;
    return `\nCode of ${name}:\n${excerpt(text, Array.from({ length: n }, (_, k) => k + 1), 0)}\n`;
  });
  return `${capped([`Rule: ${item.rule}: ${r.text}${r.cwe ? ` (${r.cwe})` : ''}.\n`, `Source: ${source.file}:${source.line}: ${source.text}\n`, `Sink: ${sink.file}:${sink.line}\n`, ...code])}\n${QUESTION}`;
}

// The question line for --prompts: keyed by what the item is made of, so it keeps its key when
// templates are added.
export const questionLine = (it) => ({ set: 'generated', item: `${it.rule}/${it.guard}/${it.placement}`, rule: it.rule, truth: it.truth,
  meta: { id: it.id, source: it.source, sink: it.sink, guard: it.guard, placement: it.placement, engine: it.engine }, prompt: questionFor(it) });

// What cobolwork reports for an item: whether its rule fires, and with a guard that stops it.
export function engineVerdict(item) {
  const dir = mkdtempSync(join(tmpdir(), 'cobolwork-negatives-'));
  try {
    for (const [name, text] of Object.entries(item.files)) writeFileSync(join(dir, name), text);
    const r = scanAll(dir, { only: ['flow'] });
    const reported = r.findings.filter((f) => f.rule === item.rule);
    const stopped = (r.checked || []).filter((c) => c.rule === item.rule);
    return reported.length ? (reported.some((f) => f.guard) ? 'reported-lowered' : 'reported') : stopped.length ? 'checked' : 'silent';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--with-files') opts.withFiles = true;
    else if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = argv[++i];
  }
  const made = items({ rule: opts.rule || null });
  for (const it of made) it.engine = engineVerdict(it);
  // A rule whose unguarded program cobolwork does not report has a template that does not make the
  // flow it names: its items say nothing, and are left out and named.
  const broken = new Set(made.filter((it) => it.guard === 'none' && it.placement === 'inline' && !it.engine.startsWith('reported')).map((it) => it.rule));
  const all = made.filter((it) => !broken.has(it.rule));
  if (opts.out) for (const it of all) { const d = join(opts.out, it.id); mkdirSync(d, { recursive: true }); for (const [n, t] of Object.entries(it.files)) writeFileSync(join(d, n), t); }
  const summary = { items: all.length, rules: new Set(all.map((i) => i.rule)).size, leftOut: [...broken].sort(), byTruth: {}, engine: {} };
  for (const it of all) {
    summary.byTruth[it.truth] = (summary.byTruth[it.truth] || 0) + 1;
    const k = `${it.truth} -> ${it.engine}`;
    summary.engine[k] = (summary.engine[k] || 0) + 1;
  }
  if (opts.labels) writeFileSync(opts.labels, `${JSON.stringify({ tool: 'cobolwork-negatives', labels: all.map((it) => ({ source: 'generated', rule: it.rule, item: questionLine(it).item, label: it.truth, reported: it.engine.startsWith('reported') })) }, null, 1)}\n`);
  if (opts.prompts) writeFileSync(opts.prompts, all.map((it) => `${JSON.stringify(questionLine(it))}\n`).join(''));
  if (opts.json) writeFileSync(opts.json, `${JSON.stringify(opts.withFiles ? all : all.map(({ files, ...rest }) => rest), null, 1)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 1)}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
