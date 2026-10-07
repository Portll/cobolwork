// SPDX-License-Identifier: AGPL-3.0-or-later
import { inScope, isProgram, isBms, relPath } from './sources.mjs';
import { parseBms, symbolicNames } from './bms.mjs';
import { dirname, join } from 'node:path';
import { parseSource, buildFileIndex } from './parser.mjs';
import { parseJcl } from './jcl.mjs';
import { holdsDecimal } from './layout.mjs';
import { hostVariablesIn } from './embedded-sql.mjs';
import { execReading } from './exec-reading.mjs';
import { CICS_EVERY_COMMAND } from './cics-commands.mjs';

// RESP and RESP2, which every command returns and the response-code source already reads.
const CICS_EVERY_COMMAND_OPTIONS = new Set(Object.keys(CICS_EVERY_COMMAND));
import { parsePliSource } from './pli/program.mjs';
import { membersOf, chooseMember } from './pli/include.mjs';
import { tsoCommands } from './utilities.mjs';
import { parseCsd, ddOfQueue } from './csd.mjs';
import { loadSite } from './site.mjs';
import { ssrangeAbends } from './options.mjs';
import { isJcl } from './sources.mjs';
import { watchMemoryBuffer } from './kernel/memory.mjs';
import { drive, loopOver } from './kernel/shared-pass.mjs';
import { keep, parseOrder, restore, sameAnalysis } from './control-reuse.mjs';
import { CONTROL_WORKER_MIN_BYTES, controlAhead, controlWorkerCount, programFiles } from './control-workers.mjs';
import { statSync } from 'node:fs';
import { createHash } from 'node:crypto';

// A flow finding is located by source and sink rather than by one path and line, so it keeps its
// own comparator. The text comparison underneath it is the shared one.
import { byText } from './kernel/findings.mjs';
import { buildControl, creditOf, hasFact, internFacts, namesOf, topOf, within, wholeTop } from './control.mjs';
import { directoryTree } from './kernel/source-tree.mjs';

// Every reused control analysis checked against the program's own: for the equivalence runs and tests.
const verifyReuse = () => process.env.COBOLWORK_VERIFY_REUSE === '1';
// The size of program text from which a copy's control analysis is restored rather than redone. On
// one repository of 14,500 copied small programs restoring took longer than analysing.
const REUSE_MIN_BYTES = 256 * 1024;

const OS_COMMAND_ROUTINE = /^(SYSTEM|C\$SYSTEM|CBL_EXEC_RUN_UNIT|CBL_GC_HOSTED|BXPSYSTM)$/i;

export const SOURCE_KINDS = {
  'argv-or-env': 'ACCEPT FROM COMMAND-LINE, ARGUMENT-VALUE or ENVIRONMENT',
  'cics-terminal': 'EXEC CICS RECEIVE',
  'cics-web': 'EXEC CICS WEB RECEIVE or EXTRACT',
  'file-record': 'record read from a file',
  'cics-queue': 'an item EXEC CICS READQ TS or TD returns, or the data RETRIEVE returns from the START that began the task',
  'database': 'host variable filled by EXEC SQL',
  'jcl-parm': 'PARM= on a JCL EXEC statement',
  'jcl-instream': 'in-stream data on a JCL DD statement',
  'cics-protected-field': 'a field the BMS map protects, read back after EXEC CICS RECEIVE MAP',
  'system-response': 'a response code or SQL error the system sets: a command\'s RESP or RESP2, EIBRESP, SQLCODE, SQLSTATE, SQLERRMC',
};
export const SINK_KINDS = {
  'os-command': 'CALL of an operating-system command routine',
  'dynamic-program-load': 'CALL whose target is a variable',
  'cics-dynamic-transfer': 'EXEC CICS LINK, XCTL or START with a variable program or transaction',
  'dynamic-sql': 'EXEC SQL EXECUTE IMMEDIATE or PREPARE from a host variable',
  'dynamic-file-path': 'SELECT ... ASSIGN TO a variable, or EXEC CICS READ, WRITE, DELETE or STARTBR with FILE or DATASET from a variable',
  'outbound-http': 'EXEC CICS WEB CONVERSE, WEB SEND on a client session, or the containers INVOKE SERVICE sends',
  'socket-send': 'CALL EZASOKET or EZACICAL with SEND, SENDTO or WRITE',
  'message-queue': 'CALL MQPUT or MQPUT1',
  'internal-reader': 'a record written where the internal reader submits it as a job: EXEC CICS WRITEQ TD to a queue the estate declares, or a DD the job sends to SYSOUT=(class,INTRDR)',
  'extrapartition-queue': 'EXEC CICS WRITEQ TD to a queue the CSD defines as extrapartition, which leaves the region through a DD',
  'web-response': 'the HTTP response this program returns: EXEC CICS WEB SEND, or a document built for it',
  'http-header': 'a header on that response: EXEC CICS WEB WRITE HTTPHEADER',
  'outbound-host': 'the host or path of a request this program makes: EXEC CICS WEB OPEN or CONVERSE',
  'queue-name': 'the name of the queue an EXEC CICS command acts on, rather than what it writes',
  'subscript': 'a name used as a subscript of a table',
  'reference-modification': 'a name used as the start or length of a reference modification',
  'occurs-depending-count': 'the object of OCCURS DEPENDING ON, which sets how many entries a table holds',
  'loop-bound': 'what a PERFORM VARYING counter is compared with to stop, where the counter subscripts a table',
  'arithmetic': 'a zoned or packed decimal operand of COMPUTE, ADD, SUBTRACT, MULTIPLY or DIVIDE',
  'record-key': 'the RIDFLD of EXEC CICS READ, STARTBR or RESETBR, which decides which record is read',
  'record-update': 'the RIDFLD of a READ UPDATE whose record the program then rewrites or deletes, or of a DELETE',
  'log': 'what a program in a CICS region writes to a log: DISPLAY, EXEC CICS WRITEQ TD to a queue that neither starts a transaction nor feeds the internal reader, WRITE JOURNALNAME or WRITE OPERATOR',
  'storage-length': 'how much storage a program acquires: the FLENGTH or LENGTH of EXEC CICS GETMAIN, or the size CALL CEEGTST is given',
  'xml-document': 'the document XML PARSE reads',
  'connection-target': 'the database or queue manager a program connects to: the host variable EXEC SQL CONNECT TO or SET CONNECTION names, or the first argument of CALL MQCONN or MQCONNX',
  'screen': 'what a CICS program shows its terminal: EXEC CICS SEND TEXT FROM, SEND MAP FROM, or the map\'s output record',
  'cics-sysid': 'the SYSID of an EXEC CICS command, which decides the region the command is shipped to',
  'cics-system-resource': 'the resource an EXEC CICS SET names, which a system-programming command then changes',
};

const ARITHMETIC = new Set(['COMPUTE', 'ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE']);
// Intrinsic functions whose result is a number the program computed, never the argument's bytes.
const NUMERIC_FUNCTIONS = new Set(`NUMVAL NUMVAL-C NUMVAL-F TEST-NUMVAL TEST-NUMVAL-C TEST-NUMVAL-F INTEGER INTEGER-PART
INTEGER-OF-DATE INTEGER-OF-DAY INTEGER-OF-FORMATTED-DATE DATE-OF-INTEGER DAY-OF-INTEGER DATE-TO-YYYYMMDD DAY-TO-YYYYDDD
YEAR-TO-YYYY LENGTH BYTE-LENGTH ORD ORD-MAX ORD-MIN MOD REM ABS SIGN SUM MEAN MEDIAN MIDRANGE RANGE VARIANCE
STANDARD-DEVIATION RANDOM SQRT FACTORIAL LOG LOG10 EXP EXP10 PI E ACOS ASIN ATAN COS SIN TAN ANNUITY PRESENT-VALUE
SECONDS-PAST-MIDNIGHT`.split(/\s+/));
const computes = (st) => ARITHMETIC.has(st.verb) || st.counts === true || (st.fns || []).some((f) => NUMERIC_FUNCTIONS.has(f));
const computedOnRoute = (state) => { for (let s = state; s; s = s.prev) if (s.why && s.why.computes) return true; return false; };
const typedOnRoute = (state) => { for (let s = state; s; s = s.prev) if (s.node.typed) return true; return false; };

// Most nodes are never a source or a sink. They share one empty list, frozen, so that adding to it
// fails rather than reaching every node.
const NO_ENDS = Object.freeze([]);
const addSource = (n, x) => { if (n.sources === NO_ENDS) n.sources = []; n.sources.push(x); };
const addSink = (n, x) => { if (n.sinks === NO_ENDS) n.sinks = []; n.sinks.push(x); };

// What a check's condition says, as text that differs whenever anything a reader could observe
// differs: property order, a set's order, undefined, -0 and NaN. Null for anything but plain data.
function consKey(v) {
  if (v === undefined) return 'u';
  if (v === null) return 'n';
  if (typeof v === 'number') return Object.is(v, -0) ? '#-0' : `#${v}`;
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'boolean') return v ? 't' : 'f';
  if (typeof v !== 'object') return null;
  const parts = v instanceof Set ? [...v] : Array.isArray(v) ? v : Object.getPrototypeOf(v) === Object.prototype ? null : undefined;
  if (parts === undefined) return null;
  const keys = parts ? parts.map(consKey) : Object.keys(v).map((k) => { const s = consKey(v[k]); return s === null ? null : `${JSON.stringify(k)}:${s}`; });
  if (keys.includes(null)) return null;
  return `${v instanceof Set ? 'S' : parts ? 'A' : 'O'}[${keys.join(',')}]`;
}

// Every literal a program holds that could be a program name: its VALUE clauses and the literals its
// statements and commands use. A menu that XCTLs through a table of names starts every one of them.
function literalNames(prog) {
  const out = new Set();
  const take = (v) => { const s = String(v).trim().toUpperCase(); if (/^[A-Z$#@][A-Z0-9$#@-]{0,7}$/.test(s)) out.add(s); };
  for (const it of prog.items) for (const v of it.values || []) if (v.t === 'lit') take(v.v);
  for (const st of prog.statements) for (const l of st.literals || []) if (l.t === 'lit') take(l.v);
  for (const e of prog.execs) for (const t of e.toks) if (t.t === 'lit') take(t.v);
  return out;
}

// The value of the last NAME(value) option in a list: the last one wins, at either level.
function lastOption(name, list) {
  for (let k = (list || []).length - 1; k >= 0; k--) {
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- name is a literal option name
    const m = new RegExp(`^${name}\\(([A-Z]+)\\)$`).exec(list[k]);
    if (m) return m[1];
  }
  return null;
}

const RELATION = new Set(['>', '<', '>=', '<=', '=', '<>']);
const RELATION_WORDS = new Set(['GREATER', 'LESS', 'EQUAL']);
const FILLER_WORDS = new Set(['IS', 'NOT', 'THAN', 'TO', 'OR', 'GREATER', 'LESS', 'EQUAL', 'OF', 'IN']);
// The names a loop counter is compared with in its UNTIL condition: I > N, N < I, I NOT LESS THAN N.
// GREATER THAN OR EQUAL TO is one relation, not two conditions joined by OR.
function boundsOf(counter, until) {
  const parts = [[]];
  let depth = 0;
  until.forEach((x, k) => {
    if (x.t === 'sep') depth += x.v === '(' ? 1 : -1;
    else if (depth === 0 && x.t === 'word' && (x.u === 'AND' || x.u === 'OR') && !(until[k + 1] && until[k + 1].u === 'EQUAL')) { parts.push([]); return; }
    parts[parts.length - 1].push(x);
  });
  const out = [];
  for (const p of parts) {
    const at = p.findIndex((x) => (x.t === 'op' && RELATION.has(x.v)) || (x.t === 'word' && RELATION_WORDS.has(x.u)));
    if (at < 0) continue;
    const names = (side) => side.filter((x, k) => x.t === 'word' && !FILLER_WORDS.has(x.u) && !/^\d+$/.test(x.v) && !(side[k - 1] && (side[k - 1].u === 'OF' || side[k - 1].u === 'IN')));
    const left = names(p.slice(0, at));
    const right = names(p.slice(at + 1));
    if (left.length === 1 && left[0].u === counter) out.push(...right);
    else if (right.length === 1 && right[0].u === counter) out.push(...left);
  }
  return out;
}

// Input from outside the program's own data. The bounds sinks follow only these: in batch COBOL
// nearly every subscript descends from a file record, and reporting those would be reporting batch.
const FROM_OUTSIDE = ['argv-or-env', 'cics-terminal', 'cics-web', 'jcl-parm', 'jcl-instream'];
// What can reach a CICS command: a batch job never issues one.
const IN_CICS = ['cics-web', 'cics-terminal', 'file-record', 'cics-queue', 'database'];
const REFLECTED = ['cics-web', 'cics-terminal'];
// What the system says about a failure: a command's RESP, the EIB's copy of it, the SQLCA. Sent to a
// web client it describes the system behind the program (CWE-209); written anywhere else it is the
// program's own business, so these reach only a response, and Db2's message text the terminal too.
const SYSTEM_FIELDS = new Set(['EIBRESP', 'EIBRESP2', 'SQLCODE', 'SQLSTATE', 'SQLERRMC']);
// PL/I's SQLCA holds Db2's message text in SQLERRM, a CHAR(70) VARYING, where COBOL's has SQLERRMC.
const PLI_SYSTEM_FIELDS = new Set([...SYSTEM_FIELDS, 'SQLERRM']);
const TO_CLIENT = ['web-response', 'http-header'];

// Exfiltration is data at rest leaving the program. Terminal or web input reaching the same channel
// is the program relaying its own caller's data, and pairing it would fire on every gateway.

// A trace longer than this keeps its two ends and says how many hops it dropped.
const PLI_PROGRAM = /\.(pli|pl1|plx)$/i;

export const TRACE_MAX = 64;
export const TRACE_KEEP = 24;
// Edges one source's walk may examine, and all walks together: about fifteen times what the largest
// repository of a 3,184-repository corpus needs, 294,370 for one walk and 33.5 million in all.
export const WALK_EDGES = 5_000_000;
export const TOTAL_EDGES = 500_000_000;

const DATA_AT_REST = ['database', 'file-record', 'cics-queue'];
// The class tests a condition can make, which restrict what a field holds rather than compare it.
const CLASS_TEST = new Set(['NUMERIC', 'ALPHABETIC', 'ALPHABETIC-LOWER', 'ALPHABETIC-UPPER', 'POSITIVE', 'NEGATIVE']);
const SOCKET_ROUTINE = /^(EZASOKET|EZACICAL)$/i;
const SOCKET_SEND = /^(SEND|SENDTO|WRITE|SENDMSG|WRITEV)$/i;
// MQPUT's buffer is its sixth argument, MQPUT1's its seventh.
// MQPUT(Hconn, Hobj, MsgDesc, PutMsgOpts, BufferLength, Buffer, …) and MQPUT1(Hconn, ObjDesc,
// MsgDesc, PutMsgOpts, BufferLength, Buffer, …): the buffer is the sixth argument of both.
const MQ_BUFFER_ARG = { MQPUT: 5, MQPUT1: 5 };

export function* analyzeSteps(root, opts = {}) {
  const repos = opts.repos || [''];
  const stats = { files: 0, programs: 0, edges: 0, nodes: 0, threw: 0, overBudget: 0, unreadable: 0, ebcdic: 0,
    jclFiles: 0, jclSteps: 0, jclStepsResolved: 0, jclCrossings: 0,
    filesNotReached: 0, stoppedBy: null, peakHeapBytes: 0, programsUnordered: 0,
    bmsFiles: 0, mapsReceived: 0, mapsNoSource: 0, mapsNoSymbolic: 0, protectedFields: 0 };
  // One watcher across every repository in the run, so a --repos scan cannot spend the whole heap
  // on the first repository and then report the rest as clean.
  const memoryWatcher = watchMemoryBuffer();
  // Reading everything is the default. A caller with less memory than the repository needs can set
  // a source budget; files past it are counted as unread, never silently dropped.
  const budget = opts.maxSourceBytes ?? (Number(process.env.COBOLWORK_MAX_SOURCE_BYTES) || Infinity);
  // Every hop of every trace, for the reader who is following one chain rather than counting
  // findings. Off by default: a chain-shaped program turns this quadratic in the chain length.
  const fullTrace = opts.fullTrace === true;
  // Every statement on any route from a finding's source to its sink, not only the route the trace
  // names: what a run must have executed before it can show a value does not arrive (reach.md §9.8).
  const allRoutes = opts.allRoutes === true;
  let held = 0;

  // Which files, not just how many. A count names nothing to go and look at, and it cannot tell
  // a permission denied from this code being wrong.
  const unread = [];
  const unparsed = [];
  const nodes = [];
  const programs = [];
  const jclPending = [];
  const jclTrees = new Map();
  // CICS definitions, from CSD extracts and from DFHCSDUP job input, and the estate's own statement
  // of which DDs and queues reach the internal reader.
  const csd = { tdqueues: new Map(), transactions: new Map(), urimaps: new Map() };
  const addCsd = (text, file, lineBase = 0) => {
    const c = parseCsd(text);
    for (const [k, v] of c.tdqueues) if (!csd.tdqueues.has(k)) csd.tdqueues.set(k, v);
    for (const [k, v] of c.transactions) if (!csd.transactions.has(k)) csd.transactions.set(k, { ...v, file, line: v.line + lineBase });
    for (const [k, v] of c.urimaps) if (!csd.urimaps.has(k)) csd.urimaps.set(k, { ...v, file, line: v.line + lineBase });
  };
  const jobSteps = [];
  // The maps of the repository being read, by MAPSET/MAP and by MAP alone.
  const bmsMaps = new Map();
  const site = loadSite(root, opts.site || null, opts.tree);
  const relOf = new Map();
  const rel = (p) => { let r = relOf.get(p); if (r === undefined) { r = relPath(root, p); relOf.set(p, r); } return r; };
  // `at` is the statement an edge that is not a statement's own is read at: the CALL or LINK that
  // passes an argument, the PUT or GET of a container.
  // `link` marks an edge into a callee at a call site ({ call }) or back out to it ({ ret }), and
  // `stmt` names the statement that carries an edge whose `why` is text.
  // Edges are kept as columns and laid out by source node before the walk. Most are a group's, a
  // REDEFINES' or a RENAMES', and those share one record of why they exist.
  const edgeFrom = [];
  const edgeTo = [];
  const edgeMeta = [];
  const sharedMeta = new Map();
  // Checks share a condition with the same content: 107,547 conditions of 66 Unieuro programs had
  // 2,423 contents. Conditions are read and never changed once the check model has made them.
  const conditions = new Map();
  const sameCondition = (c) => {
    const k = c ? consKey(c) : null;
    if (k === null) return c;
    let kept = conditions.get(k);
    if (!kept) conditions.set(k, kept = c);
    return kept;
  };
  const edge = (a, b, why, dir, at, link) => {
    if (!a || !b || a === b) return;
    let meta;
    if (typeof why === 'string' && at == null && !link) {
      const k = `${why}|${dir || ''}`;
      meta = sharedMeta.get(k);
      if (!meta) sharedMeta.set(k, meta = { why, dir });
    } else meta = { why, dir, ...(at != null ? { at } : {}), ...link };
    edgeFrom.push(a.id);
    edgeTo.push(b.id);
    edgeMeta.push(meta);
    stats.edges++;
  };
  let callSites = 0;

  // Everything the graph needs from one program is taken while its parse tree is in hand, and the
  // tree is then released. Holding every tree until the end is what exhausted a 4 GB heap on an
  // 8,024-file repository; nodes, edges and a few cross-program sites are all that survive.
  // A flow node holds what differs between nodes. Its program and file come from the program it
  // belongs to, and every other field from the class until the node sets its own.
  const programOf = [];
  class FlowNode {
    constructor(id, pk, name) { this.id = id; this.pk = pk; this.name = name; }
    get program() { return programOf[this.pk].id; }
    get file() { return programOf[this.pk].file; }
  }
  Object.assign(FlowNode.prototype, { off: null, size: null, repeats: false, sources: NO_ENDS, sinks: NO_ENDS });

  // A program whose text another program file repeats has its control analysis kept for the copies,
  // keyed by its place in its file and by what each copybook it resolved holds (lib/control-reuse.mjs).
  // Only a large one: below REUSE_MIN_BYTES (opts.reuseMinBytes) keeping and restoring costs more
  // than analysing again.
  const reuseMin = opts.reuseMinBytes ?? REUSE_MIN_BYTES;
  const textKey = (src) => createHash('sha1').update(src).digest('base64');
  function repeatedTexts(tree, files) {
    const count = new Map();
    const later = new Set();
    for (const f of files) {
      let src;
      try { src = tree.text(f).text; } catch { continue; }
      if (src.length < reuseMin) continue;
      const k = textKey(src);
      if (count.has(k)) later.add(f);
      count.set(k, (count.get(k) || 0) + 1);
    }
    const repeated = new Map();
    for (const [k, n] of count) if (n > 1) repeated.set(k, { text: k, left: n, kept: new Map() });
    return { repeated, later };
  }
  const copyText = new Map();
  const copyKey = (r, tree) => r.copies.map((c) => {
    if (!c.path) return `${c.status}:${c.name}`;
    if (!copyText.has(c.path)) { let k = null; try { k = textKey(tree.text(c.path).text); } catch { /* unread: compared by status */ } copyText.set(c.path, k); }
    return `${c.status}:${copyText.get(c.path)}`;
  }).join('|');
  const reuseOf = (copied, k, r, f, tree) => ({ kept: copied.kept, key: `${k}|${copyKey(r, tree)}`, files: programFiles(r, f) });
  // A restored analysis checked against the program's own, where COBOLWORK_VERIFY_REUSE asks.
  function sameAsOwn(ctl, prog, resolver, file, from) {
    let own = null;
    try { own = buildControl(prog, resolver); } catch { /* the restored one threw too, or it differs */ }
    if (own) internFacts(own.facts);
    if (!own !== !ctl || (own && !sameAnalysis(own, ctl, new Set(parseOrder(prog))))) throw new Error(`the control analysis ${from} for ${file} differs from its own`);
  }

  // `built` is the program's analysis from a worker thread (lib/control-workers.mjs), with the files
  // its references name.
  function summarise(prog, file, pk, options = [], reuse = null, built = null) {
    programOf[pk] = { id: prog.id, file };
    const byItem = new Map();
    const { byName, itemOfToken, indexNames, resolve: resolver } = namesOf(prog);
    const nodeOf = (item) => {
      let n = byItem.get(item);
      if (!n) {
        // Byte position within the record, so partial taint can be followed to the bytes it covers.
        // Under an OCCURS the position repeats, and a range there would claim more than is known.
        let repeats = false;
        let table = null;
        for (let a = item; a; a = a.parent) if ((a.occurs || 1) > 1) { repeats = true; table = a; }
        let top = item;
        while (top.parent) top = top.parent;
        n = new FlowNode(nodes.length, pk, item.name);
        n.off = item.offset ?? null;
        n.size = item.size ?? null;
        if (repeats) n.repeats = true;
        if (top.section === 'LINKAGE') n.linkage = true;
        // Where the outermost table holding this item sits in the record: every occurrence of the
        // item is somewhere inside it. A group's size already counts its occurrences; an
        // elementary item's is one element.
        if (table && table.offset != null && table.size != null) {
          n.tableOff = table.offset;
          n.tableEnd = table.offset + (table.children && table.children.length ? table.size : table.size * table.occurs);
        }
        nodes.push(n);
        byItem.set(item, n);
        stats.nodes++;
      }
      return n;
    };
    // An INDEXED BY name is not a data item, so it needs a node of its own to carry taint.
    const indexNodes = new Map();
    const indexNode = (name) => {
      let n = indexNodes.get(name);
      if (!n) {
        n = new FlowNode(nodes.length, pk, name);
        nodes.push(n);
        indexNodes.set(name, n);
        stats.nodes++;
      }
      return n;
    };
    // A system field the program never declares - the EIB's, or an SQLCA the precompiler supplies -
    // still holds a value, so it needs a node of its own, as an index name does.
    const systemNodes = new Map();
    const systemFields = PLI_PROGRAM.test(file) ? PLI_SYSTEM_FIELDS : SYSTEM_FIELDS;
    // A code on a terminal's error line is ordinary; Db2's message text names tables, columns and
    // constraints, so only SQLERRMC reaches the screen sink.
    const systemSource = (n, detail, at) => {
      const onlyTo = /^SQLERRMC?\b/.test(detail) ? [...TO_CLIENT, 'screen'] : TO_CLIENT;
      if (!n.sources.some((x) => x.kind === 'system-response')) addSource(n, { kind: 'system-response', onlyTo, noCredit: true, ...at, detail });
    };
    const systemNode = (tok) => {
      let n = systemNodes.get(tok.u);
      if (!n) {
        n = new FlowNode(nodes.length, pk, tok.u);
        nodes.push(n);
        systemNodes.set(tok.u, n);
        stats.nodes++;
        systemSource(n, `${tok.u}, which the system sets`, { file: tok.file || file, line: tok.line });
      }
      return n;
    };
    const nodeOfToken = (tok) => {
      const it = itemOfToken(tok);
      if (it) return nodeOf(it);
      if (!tok || tok.t !== 'word') return null;
      if (indexNames.has(tok.u)) return indexNode(tok.u);
      return systemFields.has(tok.u) ? systemNode(tok) : null;
    };
    // The program's statement order, where its structure could be read. Without it a check is
    // credited as it always was, wherever its field is used, and never clears anything.
    let ctl = null;
    // A kept or worker-built analysis is { value }, { threw } or { none }, the last for a program
    // with no procedure division, which is not counted as unordered.
    const kept = reuse && reuse.kept.get(reuse.key);
    const given = kept || (built && !built.local ? built : null);
    if (given) {
      ctl = given.value ? restore(given.value, parseOrder(prog), kept ? reuse.files : built.files) : null;
      if (given.threw) stats.programsUnordered++;
      if (verifyReuse()) sameAsOwn(ctl, prog, resolver, file, kept ? 'reused' : 'built in a worker');
      if (reuse && !kept) reuse.kept.set(reuse.key, given);
    } else {
      let threw = false;
      try { ctl = buildControl(prog, resolver); } catch { threw = true; stats.programsUnordered++; }
      if (ctl) internFacts(ctl.facts);
      if (reuse) {
        const value = ctl ? keep(ctl, parseOrder(prog), reuse.files) : null;
        if (!ctl || value) reuse.kept.set(reuse.key, value ? { value } : threw ? { threw: true } : { none: true });
      }
    }
    const pointOf = (x) => (ctl ? ctl.nodeOf.get(x) : undefined);
    // Where a name inside a condition is read, which can know more than the statement does.
    const placeOf = (tok, st) => (ctl && ctl.posOf.get(tok)) ?? pointOf(st);

    for (const it of prog.items) if (systemFields.has(it.name)) systemSource(nodeOf(it), `${it.name}, which the system sets`, { file: it.file || file, line: it.line });
    // What a program in a CICS region DISPLAYs goes to its CESE and CESO queues, a log. Terminal or web
    // input written there unchecked can carry the control characters that start a line the program
    // did not write (CWE-117). A batch program's DISPLAY is its job's own log, which no terminal
    // reaches, so it is no sink.
    const inRegion = prog.execs.some((e) => e.kind === 'CICS');
    for (const st of inRegion ? prog.statements : []) {
      if (st.verb !== 'DISPLAY') continue;
      const upon = st.sources.findIndex((t) => t.t === 'word' && t.u === 'UPON');
      const device = upon >= 0 && st.sources[upon + 1] ? ` UPON ${st.sources[upon + 1].u}` : '';
      for (const t of upon >= 0 ? st.sources.slice(0, upon) : st.sources) {
        const n = nodeOfToken(t);
        if (n) addSink(n, { kind: 'log', onlyFrom: REFLECTED, file: st.file, line: st.line, point: pointOf(st), detail: `DISPLAY ${n.name}${device}` });
      }
    }
    // The document XML PARSE reads is the operand after PARSE; what the parser does with a DTD in
    // it is the compiler's XMLPARSE option, which nothing here reads.
    for (const st of prog.statements) {
      if (st.verb !== 'XML' || !st.sources[0] || st.sources[0].u !== 'PARSE') continue;
      const n = st.sources[1] ? nodeOfToken(st.sources[1]) : null;
      if (n) addSink(n, { kind: 'xml-document', onlyFrom: REFLECTED, file: st.file, line: st.line, point: pointOf(st), detail: `XML PARSE ${n.name}` });
    }
    for (const it of prog.items) {
      const n = nodeOf(it);
      // A tainted child makes its group partly tainted; a tainted group taints every child. The
      // walk must not go up and back down: that path taints a sibling no statement ever wrote.
      if (it.parent) { const p = nodeOf(it.parent); edge(n, p, 'group', 'up'); edge(p, n, 'group', 'down'); }
      // The sibling this item redefines, resolved by the parser; the same bytes read two ways.
      if (it.redefinesItem) { const t = nodeOf(it.redefinesItem); edge(n, t, 'redefines'); edge(t, n, 'redefines'); }
      // A RENAMES alias covers a run of items. It is not their parent, so the partial rule would
      // block a value that reached one of them from reaching the alias that spans it.
      for (const covered of it.renamesSpan || []) {
        const c = nodeOf(covered);
        edge(c, n, 'renames', 'up');
        edge(n, c, 'renames', 'down');
      }
    }
    for (const st of prog.statements) {
      const targets = st.targets.map(nodeOfToken).filter(Boolean);
      if (!targets.length) continue;
      const sources = st.sources.map(nodeOfToken).filter(Boolean);
      if (!sources.length) continue;
      // One reason object per statement, shared by every edge it makes and formatted only if a
      // finding's path passes through it.
      const why = { verb: st.verb, file: rel(st.file), line: st.line, ...(computes(st) ? { computes: true } : {}), ...(ctl ? { point: pointOf(st) } : {}) };
      for (const tgt of targets) for (const src of sources) edge(src, tgt, why);
    }
    // Where the order is known, a check belongs to every node holding the bytes it tests: the field,
    // what lies inside it, and what redefines those bytes. Whether it counts is decided per route,
    // at the statement the value leaves the node by (lib/control.mjs).
    if (ctl) {
      const byRecord = new Map();
      const recordOf = (it) => { let top = it; while (top.parent) top = top.parent; return top; };
      for (const it of prog.items) { const top = recordOf(it); if (!byRecord.has(top)) byRecord.set(top, []); byRecord.get(top).push(it); }
      const extent = (it) => (it.offset != null && it.size != null ? [it.offset, it.offset + (it.contributes || it.size)] : null);
      // Each record's items with a known extent, by where they start, so a check finds the items
      // inside its field without testing every item of the record. They are then taken in the
      // record's order, which is the order their nodes are made in.
      const layouts = new Map();
      const layoutOf = (top, items) => {
        let l = layouts.get(top);
        if (!l) {
          const at = [];
          items.forEach((it, i) => { if (it.level !== 88 && it.offset != null && it.size != null) at.push({ i, start: it.offset, end: it.offset + (it.contributes || it.size) }); });
          at.sort((a, b) => a.start - b.start || a.i - b.i);
          layouts.set(top, l = { at, position: new Map(items.map((it, i) => [it, i])) });
        }
        return l;
      };
      for (const c of ctl.checks) {
        const entry = { x: c.x, t: c.t, f: c.f, tCons: sameCondition(c.tCons), fCons: sameCondition(c.fCons), file: c.file, line: c.line, item: c.field.index || c.field.name, ...(c.bounds ? { bounds: c.bounds } : {}), ...(c.mono ? { mono: true } : {}) };
        if (c.field.index) { (indexNode(c.field.index).checks ||= []).push(entry); continue; }
        const top = recordOf(c.field);
        const items = byRecord.get(top);
        if (!items) { if (c.field.level !== 88) (nodeOf(c.field).checks ||= []).push(entry); continue; }
        const { at, position } = layoutOf(top, items);
        const inside = new Set();
        if (c.field.level !== 88 && position.has(c.field)) inside.add(position.get(c.field));
        const span = extent(c.field);
        if (span) {
          let lo = 0;
          let hi = at.length;
          while (lo < hi) { const mid = (lo + hi) >>> 1; if (at[mid].start < span[0]) lo = mid + 1; else hi = mid; }
          for (let k = lo; k < at.length && at[k].start <= span[1]; k++) if (at[k].end <= span[1]) inside.add(at[k].i);
        }
        for (const i of [...inside].sort((a, b) => a - b)) (nodeOf(items[i]).checks ||= []).push(entry);
      }
    }
    // Without the order, a condition that restricts what an item may hold is credited wherever the
    // item is used: the finding says where the check is and is lowered one step, never cleared.
    // Restricting means a class test, an ordering comparison or a condition-name. Equality is not:
    // on the corpus IF X = SPACES tests that a field was filled, and IF X = "@STDIN" picks a branch.
    for (const st of ctl ? [] : prog.statements) {
      if (st.verb !== 'IF' && st.verb !== 'EVALUATE' && st.verb !== 'WHEN') continue;
      const operands = st.sources.map((tok) => ({ tok, item: itemOfToken(tok) }));
      const items = operands.filter((o) => o.item).map((o) => o.item);
      const words = operands.filter((o) => !o.item).map((o) => o.tok.u);
      const restricts = words.some((w) => CLASS_TEST.has(w) || w === 'GREATER' || w === 'LESS')
        || (st.ops || []).some((op) => op === '>' || op === '<' || op === '>=' || op === '<=')
        || items.some((it) => it.level === 88);
      if (!restricts) continue;
      const checked = items.map((it) => nodeOf(it.level === 88 && it.parent ? it.parent : it));
      for (const o of operands) if (!o.item && indexNames.has(o.tok.u)) checked.push(indexNode(o.tok.u));
      for (const n of checked) if (!n.guard) n.guard = { file: st.file, line: st.line };
    }
    // Where a statement reads or writes, taken from what it indexes with: a subscript of a table,
    // the start or length of a reference modification, and the count an OCCURS DEPENDING ON table
    // is sized by. Every use is a sink, judged where it reads, and a route reports one use per index
    // and the name it indexes, the least checked, so a loop that indexes one table forty times is one
    // thing to look at. SSRANGE, set on a CBL or PROCESS card, turns a bad index into an abend; the
    // finding carries it. The last option wins across both levels, and SSRANGE(MSG) reports and
    // carries on, so it does not count.
    const ssrange = ssrangeAbends([...(site.compilerOptions || []), ...options]) ?? false;
    const tableOf = (it) => { for (let a = it; a; a = a.parent) if ((a.occurs || 1) > 1) return a; return null; };
    // How many entries or bytes an index may name, where one number says it: a table of one
    // dimension and a fixed size, or an item of a fixed length.
    const variable = (it) => !!it.dependingOn || (it.children || []).some(variable);
    const dimensions = (it) => { let n = 0; for (let a = it; a; a = a.parent) if ((a.occurs || 1) > 1) n++; return n; };
    const limitOf = (host, table) => {
      if (table) return dimensions(host) === 1 && !variable(table) && !table.dependingOn ? table.occurs : null;
      if (host.size == null || variable(host)) return null;
      return (host.children || []).some((c) => c.level !== 88) ? host.size / Math.max(1, host.occurs || 1) : host.size;
    };
    // A whole number no sign is written on, which no value put in it can leave below 0.
    const unsignedWhole = (it) => it.level !== 88 && !it.index && !(it.children || []).length
      && /^9+$/.test(String(it.picture || '').toUpperCase().replace(/(\w)\((\d+)\)/g, (_, ch, n) => ch.repeat(Number(n))));
    // Where a length's reference starts: the start's node, a constant it is moved by, and the span
    // facts that keep start and length together inside the item.
    const startOf = (from, len, size) => {
      const s = from.tok ? itemOfToken(from.tok) : null;
      const spans = ctl && ctl.spans && s && len ? ctl.spans.filter((f) => ((f.a === s && f.b === len) || (f.a === len && f.b === s)) && f.k + from.offset <= size + 1).map((f) => f.t) : [];
      return { node: from.tok ? nodeOfToken(from.tok) : null, offset: from.offset, size, spans };
    };
    const indexed = new Set();
    const subscripting = new Map();
    // Each subscript use of a name, with the other indices of the same reference: the loop-bound
    // credit needs every one of them kept in range.
    const usesOf = new Map();
    for (const st of prog.statements) {
      const refs = new Map();
      for (const x of st.indexes || []) {
        const host = itemOfToken(x.host);
        const idx = itemOfToken(x.tok);
        if (!host || (idx && idx.level === 88)) continue;
        const at = idx ? nodeOf(idx) : nodeOfToken(x.tok);
        if (!at) continue;
        const kind = x.kind === 'subscript' ? 'subscript' : 'reference-modification';
        const table = kind === 'subscript' ? tableOf(host) : null;
        if (kind === 'subscript' && !table) continue;
        const key = `${kind}|${host.name}|${at.name}`;
        if (table && !subscripting.has(at.name)) subscripting.set(at.name, { host, table });
        const point = placeOf(x.tok, st);
        if (table) {
          const rec = { at: st.at, node: at, point, limit: limitOf(host, table), offset: x.offset || 0, mates: refs.get(x.host) || (refs.set(x.host, []), refs.get(x.host)) };
          rec.mates.push(rec);
          if (!usesOf.has(at.name)) usesOf.set(at.name, []);
          usesOf.get(at.name).push(rec);
        }
        const offset = x.offset || 0;
        // A constant length past the start, or a constant start before the length, takes that many bytes off the top.
        const base = limitOf(host, table);
        const limit = kind === 'reference-modification' && base != null && x.span ? base - x.span + 1 : base;
        const use = `${key}|${point ?? `s${st.at}`}|${offset}`;
        if (indexed.has(use)) continue;
        indexed.add(use);
        const start = kind === 'reference-modification' && x.from && base != null ? startOf(x.from, idx, base) : null;
        addSink(at, {
          kind, onlyFrom: FROM_OUTSIDE, file: st.file, line: st.line, point, group: `${pk}|${key}`, limit, ...(start ? { start } : {}), ...(offset ? { offset } : {}), ...(offset > 0 && idx && unsignedWhole(idx) ? { nonNeg: true } : {}), ...(ssrange ? { ssrange } : {}),
          detail: kind === 'subscript'
            ? `${at.name} subscripts ${host.name}, a table of ${table.occurs}`
            : `${at.name} sets the ${x.kind === 'refmod-offset' ? 'start' : 'length'} of a reference to ${host.name}, which is ${host.size} bytes`,
        });
      }
    }
    // The subscript uses a loop's body makes; every use of the name when the body can run code
    // elsewhere, and none for a loop whose body is a paragraph.
    const bodyUses = (st, uses) => {
      const body = ctl && ctl.loopBody.get(st);
      if (!body || !uses) return null;
      return body.leaves ? uses : uses.filter((u) => u.at >= body.from && u.at < body.to);
    };
    // A counter that subscripts a table walks as far as its loop's condition lets it. PERFORM
    // VARYING I ... UNTIL I > N with N from outside puts the table's bound in the caller's hands, and
    // no subscript sink sees it: I itself is only ever a literal plus one. The subscript may be
    // anywhere in the program; which statements the loop body holds is not known here.
    for (const st of prog.statements) {
      for (const loop of st.loops || []) {
        const counter = loop.counter && (itemOfToken(loop.counter)?.name || (indexNames.has(loop.counter.u) ? loop.counter.u : null));
        const walks = counter && subscripting.get(counter);
        if (!walks) continue;
        for (const tok of boundsOf(counter, loop.until)) {
          const it = itemOfToken(tok);
          if (!it || it.level === 88 || it.name === counter) continue;
          const key = `loop|${counter}|${it.name}`;
          const use = `${key}|${pointOf(st) ?? `s${st.at}`}`;
          if (indexed.has(use)) continue;
          indexed.add(use);
          addSink(nodeOf(it), {
            kind: 'loop-bound', onlyFrom: FROM_OUTSIDE, file: st.file, line: st.line, point: pointOf(st), group: `${pk}|${key}`, limit: limitOf(walks.host, walks.table), counterUses: bodyUses(st, usesOf.get(counter)), ...(ssrange ? { ssrange } : {}),
            detail: `${it.name} decides where PERFORM VARYING ${counter} stops, and ${counter} subscripts ${walks.host.name}, a table of ${walks.table.occurs}`,
          });
        }
      }
    }
    // Arithmetic reads a zoned or packed operand as decimal digits, and a byte that is not one stops
    // the program: S0C7 in batch, ASRA under CICS. Binary and floating-point fields cannot hold an
    // invalid value, and an alphanumeric one converted by NUMVAL is not an operand here, so neither
    // is a sink. Every use is a sink, and a route reports the least checked, as for an index.
    const numproc = lastOption('NUMPROC', options) ?? lastOption('NUMPROC', site.compilerOptions);
    for (const st of prog.statements) {
      if (!ARITHMETIC.has(st.verb)) continue;
      for (const tok of st.sources) {
        const it = itemOfToken(tok);
        if (!it || !holdsDecimal(it)) continue;
        const n = nodeOf(it);
        const use = `arithmetic|${n.id}|${pointOf(st) ?? `s${st.at}`}`;
        if (indexed.has(use)) continue;
        indexed.add(use);
        addSink(n, {
          kind: 'arithmetic', onlyFrom: FROM_OUTSIDE, file: st.file, line: st.line, point: pointOf(st), group: `${pk}|arithmetic|${n.id}`,
          detail: `${it.name} (PIC ${it.picture}${it.effectiveUsage && it.effectiveUsage !== 'DISPLAY' ? ` ${it.effectiveUsage}` : ''}) is an operand of ${st.verb}${numproc === 'PFD' ? ', compiled NUMPROC(PFD), which repairs no sign' : ''}`,
        });
      }
    }
    // The count matters wherever a statement names the table, a part of it, or a group holding it,
    // so it is judged at each such statement; a table no statement names is judged where it is declared.
    const odoTables = prog.items.filter((it) => it.dependingOn && byName.get(it.dependingOn));
    const touching = new Map(odoTables.map((it) => [it, []]));
    if (odoTables.length) {
      const inside = (a, b) => { for (let x = a; x; x = x.parent) if (x === b) return true; return false; };
      for (const st of prog.statements) {
        const named = [...st.sources, ...st.targets, ...(st.indexes || []).map((x) => x.host)].map(itemOfToken).filter(Boolean);
        for (const it of odoTables) if (named.some((n) => inside(n, it) || inside(it, n))) touching.get(it).push(st);
      }
    }
    for (const it of odoTables) {
      const count = byName.get(it.dependingOn);
      const sts = touching.get(it);
      for (const st of sts.length ? sts : [null]) {
        const point = st ? pointOf(st) : undefined;
        addSink(nodeOf(count), {
          kind: 'occurs-depending-count', onlyFrom: FROM_OUTSIDE, file: it.file, line: it.line, ...(st ? { point, group: `${pk}|odo|${it.name}` } : {}), top: it.occurs, ...(ssrange ? { ssrange } : {}),
          detail: `${count.name} sets how many ${it.name} entries there are, up to ${it.occurs}`,
        });
      }
    }
    for (const st of prog.statements) {
      if (st.verb !== 'READ' && st.verb !== 'RETURN') continue;
      for (const t of st.targets) {
        const n = nodeOfToken(t);
        if (n) addSource(n, { kind: 'file-record', file: st.file, line: st.line, detail: `${st.verb} ... INTO` });
      }
    }
    for (const fd of prog.fds || []) for (const rec of fd.records || []) {
      const readsFile = prog.statements.some(st => (st.verb === 'READ') && st.sources.concat(st.targets).some(t => t.u === fd.name));
      if (readsFile) addSource(nodeOf(rec), { kind: 'file-record', file: fd.file, line: fd.line, detail: `record of file ${fd.name}` });
    }
    for (const a of prog.accepts) {
      const item = (a.targetTok ? itemOfToken(a.targetTok) : null) || byName.get(a.target);
      if (!item) continue;
      const kind = /^(COMMAND-LINE|ARGUMENT-VALUE|ENVIRONMENT|ENVIRONMENT-VALUE)$/.test(a.from || '') ? 'argv-or-env' : null;
      if (kind) addSource(nodeOf(item), { kind, file: a.file, line: a.line, detail: `ACCEPT ... FROM ${a.from}` });
    }
    // A SELECT assigns either to a data item, which makes the path dynamic, or to an external
    // name. On z/OS that external name is the DD name a JCL step fills, and it is how a job's
    // in-stream data reaches a program's record without any COBOL statement naming the job.
    const ddFiles = [];
    for (const f of prog.files) {
      if (!f.assign) continue;
      if (f.assign.t === 'word') {
        const item = byName.get(f.assign.v);
        if (item) {
          addSink(nodeOf(item), { kind: 'dynamic-file-path', file: f.file, line: f.line, detail: `SELECT ${f.name} ASSIGN TO ${f.assign.v}` });
          continue;                       // a variable path is not a DD name
        }
      }
      // "DD:SYSIN", 'S-SYSIN' and SYSIN all name the same DD once the dialect prefix is off.
      const external = String(f.assign.v || '').replace(/^["']|["']$/g, '').replace(/^(DD:|S-|-)/i, '').toUpperCase();
      if (!external) continue;
      const fd = (prog.fds || []).find((x) => x.name === f.name);
      const recs = (fd?.records || []).map(nodeOf);
      // READ ... INTO moves the record it read into an item, which then holds the DD's data too.
      const into = prog.statements.filter((st) => st.verb === 'READ' && st.sources[0]?.u === f.name).flatMap((st) => st.targets.map(nodeOfToken).filter(Boolean));
      if (recs.length) ddFiles.push({ dd: external, nodes: recs, into, file: f.file, line: f.line, select: f.name });
    }
    const topOf = (it) => { let t = it; while (t && t.parent) t = t.parent; return t; };
    const ownParams = new Set((prog.paramTokens || []).map((pt) => topOf(itemOfToken(pt.tok))).filter(Boolean));
    // A LINKAGE record that is not one of this program's own parameters is storage it addressed
    // itself, through a pointer: its declared size says nothing about what the pointer points at.
    const argExtent = (it) => (it && topOf(it).section === 'LINKAGE' && !ownParams.has(topOf(it)) ? null : extentOf(it));
    // How far into each of its own parameters this program writes: a statement's targets, and
    // anything it passes on by reference, which the program it calls may write.
    const writtenEnd = new Map();
    const noteWrite = (it) => {
      const top = topOf(it);
      if (!it || !ownParams.has(top) || it.offset == null || it.size == null) return;
      const end = it.offset - (top.offset ?? 0) + it.size * Math.max(1, it.occurs || 1);
      if (end > (writtenEnd.get(top) || 0)) writtenEnd.set(top, end);
    };
    for (const st of prog.statements) for (const t of st.targets || []) noteWrite(itemOfToken(t));
    for (const c of prog.calls) for (const a of c.using) if (a.tok && a.mode === 'REFERENCE') noteWrite(itemOfToken(a.tok));
    const callSites = [];
    for (const c of prog.calls) {
      const point = pointOf(prog.statements[c.stmtIndex]);
      if (c.kind === 'I') {
        const n = nodeOfToken(c.targetTok);
        if (n) addSink(n, { kind: 'dynamic-program-load', file: c.file, line: c.line, point, detail: `CALL ${c.name}` });
        continue;
      }
      callSites.push({ name: String(c.name).toUpperCase(), display: c.name, file: c.file, line: c.line, point, args: c.using.map(a => ({ node: a.tok ? nodeOfToken(a.tok) : null, mode: a.mode, extent: a.tok ? argExtent(itemOfToken(a.tok)) : null })) });
      if (OS_COMMAND_ROUTINE.test(c.name)) {
        for (const a of c.using) {
          const n = a.tok ? nodeOfToken(a.tok) : null;
          if (n) addSink(n, { kind: 'os-command', file: c.file, line: c.line, point, detail: `CALL '${c.name}' USING ${a.word}` });
        }
      } else if (SOCKET_ROUTINE.test(c.name)) {
        // IBM's own examples hold the function code in a field: 01 SOC-FUNCTION PIC X(16) VALUE 'SEND'.
        const first = c.using[0];
        const fnItem = first && first.tok ? itemOfToken(first.tok) : null;
        const fnValue = fnItem && (fnItem.values || []).find(v => v.t === 'lit');
        const fn = (first && first.lit) || (fnValue && fnValue.v);
        if (fn && SOCKET_SEND.test(String(fn).trim())) {
          for (const a of c.using.slice(1)) {
            const n = a.tok ? nodeOfToken(a.tok) : null;
            if (n) addSink(n, { kind: 'socket-send', onlyFrom: DATA_AT_REST, file: c.file, line: c.line, point, detail: `CALL '${c.name}' ${String(fn).trim()} USING ${a.word}` });
          }
        }
      } else if (Object.hasOwn(MQ_BUFFER_ARG, String(c.name).toUpperCase())) {
        const a = c.using[MQ_BUFFER_ARG[String(c.name).toUpperCase()]];
        const n = a && a.tok ? nodeOfToken(a.tok) : null;
        if (n) addSink(n, { kind: 'message-queue', onlyFrom: DATA_AT_REST, file: c.file, line: c.line, point, detail: `CALL '${c.name}' with buffer ${a.word}` });
      } else if (/^MQCONNX?$/i.test(String(c.name))) {
        // MQCONN(QMgrName, Hconn, CompCode, Reason); MQCONNX puts its options second.
        const a = c.using[0];
        const n = a && a.tok ? nodeOfToken(a.tok) : null;
        if (n) addSink(n, { kind: 'connection-target', onlyFrom: FROM_OUTSIDE, file: c.file, line: c.line, point, detail: `CALL '${c.name}' with queue manager ${a.word}, which decides the queue manager the program connects to` });
      } else if (String(c.name).toUpperCase() === 'CEEGTST') {
        // CEEGTST(heap id, size, address, feedback code): the size is the second argument.
        const a = c.using[1];
        const n = a && a.tok ? nodeOfToken(a.tok) : null;
        if (n) addSink(n, { kind: 'storage-length', onlyFrom: FROM_OUTSIDE, file: c.file, line: c.line, point, detail: `CALL 'CEEGTST' with size ${a.word}, which decides how much heap storage is acquired` });
      }
    }
    const transfers = [];
    const channelOf = new Map();
    const invokes = [];
    const transfersTo = new Set();
    const startsTransactions = new Set();
    const tdWrites = [];
    // A container is storage with a name rather than a field, so it gets a node of its own and the
    // PUT and GET statements are edges into and out of it. Without one, data put in a container and
    // sent by WEB CONVERSE CONTAINER(...) left no trace at all.
    const containers = new Map();
    const containerNode = (name) => {
      let n = containers.get(name);
      if (!n) {
        n = new FlowNode(nodes.length, pk, `CONTAINER(${name})`);
        n.off = undefined;
        n.size = undefined;
        n.repeats = undefined;
        nodes.push(n);
        containers.set(name, n);
        stats.nodes++;
      }
      return n;
    };
    const optionName = (o, key) => {
      const t = (o.get(key) || [])[0];
      return t ? String(t.t === 'lit' ? t.v : t.u).trim().toUpperCase() : null;
    };
    // A map named through a data name is named by its VALUE, where nothing writes the item: CardDemo
    // writes MAP(LIT-THISMAP) for a map it never renames.
    let written = null;
    const constOption = (o, key) => {
      const t = (o.get(key) || [])[0];
      if (!t) return null;
      if (t.t === 'lit') return String(t.v).trim().toUpperCase();
      const it = itemOfToken(t);
      if (!it) return null;
      written ||= new Set(prog.statements.flatMap((st) => st.targets.map(itemOfToken).filter(Boolean)));
      const v = !written.has(it) && (it.values || [])[0];
      return v && v.t === 'lit' ? String(v.v).trim().toUpperCase() : null;
    };
    // The fields of a received map that the map protects, hides or restricts to digits. The terminal
    // enforces those attributes and CICS does not, so a modified 3270 client writes a protected field
    // and reads a dark one. Each such field's NAMEI carries what the map says; a protected one is also
    // a source of its own, for the one use a typed field makes ordinary and a protected one does not:
    // choosing which record to read.
    // The programs a data name can name at a transfer: the constant it holds there on every route,
    // from the program's own order, or else every literal the program puts in it. CardDemo names
    // each XCTL this way - MOVE 'COTRN01C' TO CDEMO-TO-PROGRAM - so without it no COMMAREA crossed
    // one of its transfers.
    let movedIn = null;
    const literalsInto = (it) => {
      if (!movedIn) {
        movedIn = new Map();
        const add = (item, v) => {
          const name = String(v).trim().toUpperCase();
          if (!/^[A-Z$#@][A-Z0-9$#@-]{0,7}$/.test(name)) return;
          if (!movedIn.has(item)) movedIn.set(item, new Set());
          movedIn.get(item).add(name);
        };
        for (const i of prog.items) for (const v of i.values || []) if (v.t === 'lit') add(i, v.v);
        for (const st of prog.statements) {
          if (st.verb !== 'MOVE' || st.sources.length) continue;
          const lit = (st.literals || []).find((l) => l.t === 'lit');
          if (lit) for (const t of st.targets) { const ti = itemOfToken(t); if (ti) add(ti, lit.v); }
        }
      }
      return [...(movedIn.get(it) || [])];
    };
    const programsNamed = (tok, e) => {
      const it = itemOfToken(tok);
      if (!it) return [];
      const bits = ctl && ctl.facts.get(ctl.nodeOf.get(e));
      if (bits) {
        const must = ctl.checks.filter((c) => c.assigned && c.field === it && hasFact(bits, c.t)).map((c) => [...c.tCons.set][0]);
        if (must.length) return [...new Set(must.map((v) => String(v).trim().toUpperCase()))];
      }
      return literalsInto(it);
    };
    const receiveMap = (e, o, into, at) => {
      stats.mapsReceived++;
      const mapName = constOption(o, 'MAP');
      const setName = constOption(o, 'MAPSET');
      const hit = mapName && ((setName && bmsMaps.get(`${setName}/${mapName}`)) || bmsMaps.get(mapName));
      if (!hit) { stats.mapsNoSource++; return; }
      const { mapset, map } = hit[0];
      const record = into || byName.get(map.symbolic.input);
      if (!record) { stats.mapsNoSymbolic++; return; }
      const within = new Map();
      const walk = (it) => { if (!within.has(it.name)) within.set(it.name, it); for (const c of it.children || []) walk(c); };
      walk(record);
      for (const field of map.fields) {
        if (!field.name) continue;
        const iname = symbolicNames(map, field).find((n) => n.suffix === 'I');
        const item = iname && within.get(iname.name);
        if (!item) continue;
        const marks = ['PROT', 'ASKIP', 'DRK', 'NUM'].filter((a) => field.effective.has(a));
        const typed = !marks.includes('PROT') && !marks.includes('ASKIP');
        if (typed) nodeOf(item).typed = true;
        if (!marks.length) continue;
        const n = nodeOf(item);
        n.screen = { item: item.name, field: field.name, map: map.name, mapset: mapset.name, marks, declared: !!field.attrb };
        if (typed) continue;
        stats.protectedFields++;
        const back = field.effective.has('FSET') ? ' with FSET' : '';
        addSource(n, { kind: 'cics-protected-field', onlyTo: ['record-key', 'record-update'], ...at,
          detail: `EXEC CICS RECEIVE MAP(${map.name}) returns ${item.name}, field ${field.name} of map ${map.name} in mapset ${mapset.name}, which the map marks ${marks.join(' and ')}${field.attrb ? '' : ' by default'}${back}` });
      }
    };
    // The files whose held record this program rewrites or deletes, by the operand naming them. The
    // REWRITE or DELETE carries no key: the READ UPDATE before it chose the record.
    const changes = new Map();
    for (const e of prog.execs) {
      if (e.kind !== 'CICS') continue;
      const { opts: o, verb } = execReading(e);
      if (verb !== 'REWRITE' && !(verb === 'DELETE' && !o.has('RIDFLD'))) continue;
      const file = optionName(o, 'DATASET') || optionName(o, 'FILE');
      if (file && !changes.has(file)) changes.set(file, verb === 'REWRITE' ? 'rewrites' : 'deletes');
    }
    for (const e of prog.execs) {
      const { opts: o, words, verb, sub, command, direction } = execReading(e);
      const at = { file: e.file, line: e.line, point: pointOf(e) };
      if (e.kind === 'CICS') {
        const intoTok = (o.get('INTO') || o.get('SET') || [])[0];
        for (const opt of ['RESP', 'RESP2']) {
          const r = nodeOfToken((o.get(opt) || [])[0]);
          if (r) systemSource(r, `the ${opt} of EXEC CICS ${verb}`, at);
        }
        if (verb === 'WRITE' && ['OPERATOR', 'JOURNALNAME', 'JOURNALNUM'].includes(sub)) {
          const opt = sub === 'OPERATOR' ? 'TEXT' : 'FROM';
          const n = nodeOfToken((o.get(opt) || [])[0]);
          if (n) addSink(n, { kind: 'log', onlyFrom: REFLECTED, ...at, detail: `EXEC CICS WRITE ${sub} ${opt}(${n.name}), ${sub === 'OPERATOR' ? 'to the operator console' : 'to a journal'}` });
        }
        if (verb === 'RECEIVE') {
          const isWeb = words.includes('WEB');
          const n = nodeOfToken(intoTok);
          if (n) addSource(n, { kind: isWeb ? 'cics-web' : 'cics-terminal', ...at, detail: `EXEC CICS ${isWeb ? 'WEB ' : ''}RECEIVE` });
          // RECEIVE MAP with no INTO fills the symbolic map, whose input record is <map>I.
          const map = optionName(o, 'MAP');
          if (!n && map) {
            const sym = byName.get(`${map}I`);
            if (sym) addSource(nodeOf(sym), { kind: 'cics-terminal', ...at, detail: `EXEC CICS RECEIVE MAP(${map}) into the symbolic map` });
          }
          if (!isWeb && o.has('MAP')) receiveMap(e, o, itemOfToken(intoTok), at);
        }
        // What the terminal shows: SEND TEXT's FROM, or the map's output record, <map>O without FROM.
        if (verb === 'SEND' && (sub === 'TEXT' || sub === 'MAP')) {
          const from = nodeOfToken((o.get('FROM') || [])[0]);
          const map = sub === 'MAP' ? optionName(o, 'MAP') : null;
          const sym = !from && map ? byName.get(`${map}O`) : null;
          const n = from || (sym ? nodeOf(sym) : null);
          if (n) addSink(n, { kind: 'screen', onlyFrom: ['system-response'], ...at, detail: `EXEC CICS SEND ${sub}${map ? `(${map})` : ''}${from ? ` FROM(${n.name})` : ', from its symbolic map'}, to the terminal` });
        }
        // RIDFLD decides which record a READ or DELETE reaches, or where a browse starts. A key the
        // user types is how a lookup works; a key the program put in a protected field and read back
        // is its own state, held where a modified client can change it.
        if (['READ', 'DELETE', 'STARTBR', 'RESETBR'].includes(verb) && o.has('RIDFLD')) {
          const k = nodeOfToken((o.get('RIDFLD') || [])[0]);
          const file = optionName(o, 'DATASET') || optionName(o, 'FILE');
          const then = verb === 'READ' && words.includes('UPDATE') ? changes.get(file) : null;
          const detail = verb === 'DELETE' ? `EXEC CICS DELETE RIDFLD(${k && k.name}), which decides which record it deletes`
            : then ? `EXEC CICS READ UPDATE RIDFLD(${k && k.name}), which decides which record the program then ${then}`
              : `EXEC CICS ${verb} RIDFLD(${k && k.name}), which decides which record it reaches`;
          if (k) addSink(k, { kind: verb === 'DELETE' || then ? 'record-update' : 'record-key', onlyFrom: ['cics-protected-field'], noCredit: true, ...at, detail });
        }
        if (verb === 'GETMAIN') {
          for (const opt of ['FLENGTH', 'LENGTH']) {
            const n = nodeOfToken((o.get(opt) || [])[0]);
            if (n) addSink(n, { kind: 'storage-length', onlyFrom: REFLECTED, ...at, detail: `EXEC CICS GETMAIN ${opt}(${n.name}), which decides how much storage is acquired` });
          }
        }
        if (verb === 'PUT' && o.has('CONTAINER')) {
          const name = optionName(o, 'CONTAINER');
          const from = nodeOfToken((o.get('FROM') || [])[0]);
          if (name && from) edge(from, containerNode(name), `EXEC CICS PUT CONTAINER(${name})`, undefined, at.point, { stmt: { verb: 'EXEC CICS PUT', file: rel(at.file), line: at.line } });
          if (name) channelOf.set(name, optionName(o, 'CHANNEL'));
        }
        // A service call sends every container on its channel, and its URI decides where they go.
        if (verb === 'INVOKE' && (sub === 'SERVICE' || sub === 'WEBSERVICE')) {
          invokes.push({ at, what: sub, channel: optionName(o, 'CHANNEL') });
          for (const opt of ['URI', 'URIMAP']) {
            const n = nodeOfToken((o.get(opt) || [])[0]);
            if (n) addSink(n, { kind: 'outbound-host', onlyFrom: IN_CICS, ...at, detail: `EXEC CICS INVOKE ${sub} ${opt}(...), which decides where the request goes` });
          }
        }
        if (verb === 'GET' && o.has('CONTAINER')) {
          const name = optionName(o, 'CONTAINER');
          const into = nodeOfToken((o.get('INTO') || o.get('SET') || [])[0]);
          if (name && into) edge(containerNode(name), into, `EXEC CICS GET CONTAINER(${name})`, undefined, at.point, { stmt: { verb: 'EXEC CICS GET', file: rel(at.file), line: at.line } });
        }
        // CONVERSE is always a client call; SEND is one only on a session this program opened. A
        // plain WEB SEND answers the request that started the program, which is its job.
        if (verb === 'WEB' && (sub === 'CONVERSE' || (sub === 'SEND' && o.has('SESSTOKEN')))) {
          const n = nodeOfToken((o.get('FROM') || [])[0]);
          if (n) addSink(n, { kind: 'outbound-http', onlyFrom: DATA_AT_REST, ...at, detail: `EXEC CICS WEB ${sub} to a remote server` });
          // The request may be a container rather than a field.
          const sent = o.has('CONTAINER') ? optionName(o, 'CONTAINER') : null;
          if (sent) addSink(containerNode(sent), { kind: 'outbound-http', onlyFrom: DATA_AT_REST, ...at, detail: `EXEC CICS WEB ${sub} sending CONTAINER(${sent})` });
        }
        // The response this program returns to its own caller, and the document built for it. CICS
        // escapes nothing on the way out - DOCUMENT SET's UNESCAPED option is about URL decoding,
        // not HTML - so whatever reaches here is what the browser is handed.
        if (verb === 'WEB' && sub === 'SEND' && !o.has('SESSTOKEN')) {
          const n = nodeOfToken((o.get('FROM') || [])[0]);
          // A stored value becomes script only where the reply is markup, and a web program
          // answering with a database row is the ordinary shape of one. Input echoed back is a
          // defect whatever the reply holds.
          const media = (o.get('MEDIATYPE') || [])[0];
          const markup = media && media.t === 'lit' && /html|xml|svg/i.test(String(media.v));
          if (n) addSink(n, { kind: 'web-response', onlyFrom: [...(markup ? IN_CICS : REFLECTED), 'system-response'], ...at, detail: `EXEC CICS WEB SEND answering this program's caller${markup ? ` as ${String(media.v).trim()}` : ''}` });
        }
        if (verb === 'DOCUMENT') {
          const what = sub === 'SET' ? ['VALUE', 'SYMBOLLIST'] : ['TEXT', 'FROM', 'BINARY'];
          for (const opt of what) {
            const n = nodeOfToken((o.get(opt) || [])[0]);
            if (n) addSink(n, { kind: 'web-response', onlyFrom: [...IN_CICS, 'system-response'], ...at, detail: `EXEC CICS DOCUMENT ${sub} ${opt}(...), which is sent as the response` });
          }
        }
        if (verb === 'WEB' && sub === 'WRITE' && o.has('HTTPHEADER')) {
          for (const opt of ['HTTPHEADER', 'VALUE']) {
            const n = nodeOfToken((o.get(opt) || [])[0]);
            if (n) addSink(n, { kind: 'http-header', onlyFrom: [...IN_CICS, 'system-response'], ...at, detail: `EXEC CICS WEB WRITE HTTPHEADER ${opt}(...)` });
          }
        }
        if (verb === 'WEB' && (sub === 'OPEN' || sub === 'CONVERSE')) {
          for (const opt of ['HOST', 'URIMAP', 'PATH']) {
            const n = nodeOfToken((o.get(opt) || [])[0]);
            if (n) addSink(n, { kind: 'outbound-host', onlyFrom: IN_CICS, ...at, detail: `EXEC CICS WEB ${sub} ${opt}(...), which decides where the request goes` });
          }
        }
        // FILE or DATASET picks the file a command reads, writes or browses from every file the region
        // defines; the commands that carry on from these act on the file already picked.
        if (['READ', 'WRITE', 'DELETE', 'STARTBR'].includes(verb)) {
          for (const opt of ['FILE', 'DATASET']) {
            const t = (o.get(opt) || [])[0];
            const n = t && t.t === 'word' ? nodeOfToken(t) : null;
            if (n) addSink(n, { kind: 'dynamic-file-path', onlyFrom: IN_CICS, ...at, detail: `EXEC CICS ${verb} ${opt}(${n.name}), which decides the file the command acts on` });
          }
        }
        // The queue a command acts on, as distinct from what it writes there: a name from input
        // reads, overwrites or deletes whatever queue the input asks for.
        if (['WRITEQ', 'READQ', 'DELETEQ'].includes(verb)) {
          const ts = sub === 'TS' || !words.includes('TD');
          for (const opt of ['QUEUE', 'QNAME']) {
            const n = nodeOfToken((o.get(opt) || [])[0]);
            if (n) addSink(n, { kind: 'queue-name', onlyFrom: IN_CICS, ...at, detail: `EXEC CICS ${verb} ${ts ? 'TS' : 'TD'} ${opt}(...) names the queue` });
          }
        }
        // SYSID ships a command to the region it names; SET's first option names the resource a
        // system-programming command changes. A literal in either is the program's own choice. ASSIGN,
        // INQUIRE and EXTRACT return SYSID into the field rather than read it.
        if (o.has('SYSID') && !['ASSIGN', 'INQUIRE', 'EXTRACT'].includes(verb)) {
          const n = nodeOfToken((o.get('SYSID') || [])[0]);
          if (n) addSink(n, { kind: 'cics-sysid', onlyFrom: IN_CICS, ...at, detail: `EXEC CICS ${verb} SYSID(${n.name}), which decides the region the command is shipped to` });
        }
        // The resource option is the one the table names the command by, or the synonym written (SET
        // DATASET is SET FILE).
        const resource = o.has(sub) ? sub : words[1];
        if (verb === 'SET' && resource && o.has(resource)) {
          const n = nodeOfToken((o.get(resource) || [])[0]);
          if (n) addSink(n, { kind: 'cics-system-resource', onlyFrom: IN_CICS, ...at, detail: `EXEC CICS SET ${resource}(${n.name}), which decides the resource the command changes` });
        }
        if (verb === 'READ' || verb === 'READNEXT' || verb === 'READPREV') {
          const n = nodeOfToken(intoTok);
          if (n && (o.has('FILE') || o.has('DATASET'))) addSource(n, { kind: 'file-record', ...at, detail: `EXEC CICS ${verb} FILE ... INTO` });
        }
        // A CONVERSE response is the remote server's data, which is untrusted input like any other.
        if ((verb === 'WEB' && sub !== 'SEND') || verb === 'EXTRACT') {
          const n = nodeOfToken(intoTok);
          if (n) addSource(n, { kind: 'cics-web', ...at, detail: `EXEC CICS ${[verb, sub].filter(Boolean).join(' ')}` });
        }
        // The request's form fields, query parameters and headers, and what WEB EXTRACT says about the
        // request, come back in options other than INTO: each one CICS returns a value in.
        if (/^(WEB (READ|READNEXT|EXTRACT)|EXTRACT WEB)/.test(command || '')) {
          for (const [opt, toks] of o) {
            if (opt === 'INTO' || !['receives', 'both'].includes(direction(opt)) || CICS_EVERY_COMMAND_OPTIONS.has(opt)) continue;
            const n = nodeOfToken(toks[0]);
            if (n) addSource(n, { kind: 'cics-web', ...at, detail: `EXEC CICS ${command} ${opt}` });
          }
        }
        // A queue item, and the data a START passed, were stored by another task.
        if (/^READQ /.test(command || '') || command === 'RETRIEVE') {
          const n = nodeOfToken(intoTok);
          if (n) addSource(n, { kind: 'cics-queue', ...at, detail: `EXEC CICS ${command} INTO` });
        }
        // Where a transient-data write lands is not in the program: the CSD maps the queue to a DD
        // and the region's JCL maps the DD to a destination. Collected here, resolved once every
        // definition has been read.
        if (verb === 'WRITEQ' && sub === 'TD') {
          const from = nodeOfToken((o.get('FROM') || [])[0]);
          const qTok = (o.get('QUEUE') || o.get('TDQUEUE') || [])[0];
          const qItem = qTok && qTok.t === 'word' ? itemOfToken(qTok) : null;
          const qValue = qItem && (qItem.values || []).find((v) => v.t === 'lit');
          const queue = qTok && qTok.t === 'lit' ? qTok.v : qValue ? qValue.v : null;
          if (from) tdWrites.push({ node: from, queue: queue == null ? null : String(queue).trim().toUpperCase(), ...at });
        }
        if (['LINK', 'XCTL', 'START'].includes(verb)) {
          const pgm = (o.get('PROGRAM') || o.get('TRANSID') || [])[0];
          if (pgm && pgm.t === 'word') {
            const n = nodeOfToken(pgm);
            if (n) addSink(n, { kind: 'cics-dynamic-transfer', ...at, detail: `EXEC CICS ${verb} with a variable program name` });
          }
          const commarea = (o.get('COMMAREA') || o.get('FROM') || [])[0];
          const argNode = commarea ? nodeOfToken(commarea) : null;
          if (pgm && pgm.t === 'lit' && argNode) transfers.push({ verb, callee: pgm.v.toUpperCase(), argNode, point: at.point, file: at.file, line: at.line });
          else if (pgm && pgm.t === 'word' && argNode && o.has('PROGRAM')) {
            for (const callee of programsNamed(pgm, e)) { transfers.push({ verb, callee, argNode, point: at.point, file: at.file, line: at.line, through: pgm.u }); transfersTo.add(callee); }
          }
          if (pgm && pgm.t === 'lit') (o.has('TRANSID') && !o.has('PROGRAM') ? startsTransactions : transfersTo).add(String(pgm.v).trim().toUpperCase());
        }
        // RETURN TRANSID names the transaction the terminal's next input starts.
        if (verb === 'RETURN' && o.has('TRANSID')) {
          const t = (o.get('TRANSID') || [])[0];
          if (t && t.t === 'lit') startsTransactions.add(String(t.v).trim().toUpperCase());
        }
      }
      if (e.kind === 'SQL') {
        // A host variable names the item a qualified :G.F resolves to; the statement fills the ones
        // Db2 writes, and those hold what the database held.
        const hv = e.hostVariables || hostVariablesIn(e.toks);
        for (const h of hv) {
          if (!h.written) continue;
          const n = nodeOfToken(h.tok);
          if (n) addSource(n, { kind: 'database', ...at, detail: `EXEC SQL ${verb} ${verb === 'SELECT' || verb === 'FETCH' ? 'INTO' : 'writes'} host variable` });
        }
        // The location CONNECT TO or SET CONNECTION names, where a host variable holds it; what
        // follows USER and USING is the credential, not the target.
        if (verb === 'CONNECT' || (verb === 'SET' && words[1] === 'CONNECTION')) {
          const to = e.toks.findIndex((t) => t.t === 'word' && (t.u === 'TO' || t.u === 'CONNECTION'));
          const colon = to >= 0 ? e.toks[to + 1] : null;
          const n = colon && colon.t === 'op' && colon.v === ':' && e.toks[to + 2] ? nodeOfToken(e.toks[to + 2]) : null;
          if (n) addSink(n, { kind: 'connection-target', onlyFrom: FROM_OUTSIDE, ...at, detail: `EXEC SQL ${verb === 'SET' ? 'SET CONNECTION' : 'CONNECT TO'} :${n.name}, which decides the database the program connects to` });
        }
        const dynamic = words.some((w, i) => w === 'PREPARE' || (w === 'EXECUTE' && words[i + 1] === 'IMMEDIATE'));
        if (dynamic) for (const h of hv) {
          const n = nodeOfToken(h.tok);
          if (n) addSink(n, { kind: 'dynamic-sql', ...at, detail: `EXEC SQL ${words.slice(0, 2).join(' ')} from a host variable` });
        }
      }
    }
    for (const inv of invokes) {
      for (const [name, channel] of channelOf) {
        if (inv.channel && channel && channel !== inv.channel) continue;
        addSink(containerNode(name), { kind: 'outbound-http', onlyFrom: DATA_AT_REST, ...inv.at, detail: `EXEC CICS INVOKE ${inv.what} sending CONTAINER(${name})${inv.channel ? ` on CHANNEL(${inv.channel})` : ''}` });
      }
    }
    const commareaItem = byName.get('DFHCOMMAREA');
    return {
      id: prog.id, pk, file, callSites, transfers, ddFiles, tdWrites,
      params: prog.paramTokens ? prog.paramTokens.map(p => {
        const it = itemOfToken(p.tok);
        const extent = extentOf(it);
        return { node: nodeOfToken(p.tok), mode: p.mode, extent: extent && { ...extent, written: writtenEnd.get(topOf(it)) || 0 } };
      }) : null,
      commarea: commareaItem ? nodeOf(commareaItem) : null,
      // Only the facts survive the parse tree: which checks hold before each statement, and so which
      // statements a route reaches at all.
      ordered: !!ctl,
      reachKnown: !!ctl && !ctl.partial,
      reached: ctl ? ctl.reached : null,
      facts: ctl ? ctl.facts : null,
      file, line: prog.line,
      calls: new Set(prog.calls.filter((c) => c.kind === 'L').map((c) => String(c.name).toUpperCase())),
      transfersTo, startsTransactions,
      names: literalNames(prog),
    };
  }

  for (const repo of repos) {
    const base = repo ? join(root, repo) : root;
    // The scan's tree covers the root it was built for. A --repos run scans a different directory
    // per repository, so each gets its own; a single-root run reuses the one already walked.
    const tree = (!repo && opts.tree) ? opts.tree : directoryTree(base, opts);
    const idx = tree.index;
    const files = tree.list().filter(isProgram).filter(inScope(opts));
    // PL/I programs are read when asked for; their summaries join the same graph.
    const readsPli = opts.pli ?? process.env.COBOLWORK_PLI === '1';
    if (readsPli) files.push(...tree.list().filter((p) => PLI_PROGRAM.test(p)).filter(inScope(opts)));
    // A PL/I %INCLUDE names a member by base name; any file of the tree may hold it.
    const pliMembers = readsPli ? membersOf(tree.list()) : null;
    const readMember = (name, from) => {
      const path = chooseMember(pliMembers.get(name), from);
      if (!path) return null;
      try { return { path, text: tree.text(path).text }; } catch { return null; }
    };
    for (const f of tree.list().filter(isJcl).filter(inScope(opts))) { jclPending.push(f); jclTrees.set(f, tree); }
    for (const f of tree.list().filter((p) => /\.csd$/i.test(p)).filter(inScope(opts))) {
      try { addCsd(tree.text(f).text, f); } catch (e) { stats.unreadable++; unread.push(`${tree.rel(f)}: ${e.code || e.name}`); }
    }
    bmsMaps.clear();
    for (const f of tree.list().filter(isBms).filter(inScope(opts))) {
      let bms;
      try { bms = parseBms(tree.text(f).text); } catch (e) { stats.unreadable++; unread.push(`${tree.rel(f)}: ${e.code || e.name}`); continue; }
      stats.bmsFiles++;
      for (const ms of bms.mapsets) for (const map of ms.maps) for (const k of [`${ms.name}/${map.name}`, map.name]) {
        if (!bmsMaps.has(k)) bmsMaps.set(k, []);
        bmsMaps.get(k).push({ mapset: ms, map });
      }
    }
    // The byte budget bounds the source read. It does not bound the graph built from it: nodes and
    // edges are proportional to data items and statements, not to bytes, so a repository of small
    // programs with large record layouts can exhaust a heap the budget believes is untouched. The
    // shared loop watches the heap itself, and the budget stays as the cheaper first line.
    const { repeated, later } = repeatedTexts(tree, files);
    // The larger COBOL programs' control analyses are built in worker threads ahead of the loop, where
    // the tree can say how it parses as data. A copy whose first is analysed already is restored instead.
    const workers = tree.parseSpec ? (opts.controlWorkers ?? controlWorkerCount()) : 0;
    const minWorkerBytes = opts.controlWorkerMinBytes ?? CONTROL_WORKER_MIN_BYTES;
    const sizeOf = (f) => { try { return statSync(f).size; } catch { return 0; } };
    const toWorkers = new Set(workers > 0 ? files.filter((f) => !PLI_PROGRAM.test(f) && !later.has(f) && sizeOf(f) >= minWorkerBytes) : []);
    const ahead = toWorkers.size ? controlAhead(tree.parseSpec, files, (f) => toWorkers.has(f), { workers }) : null;
    const readProgram = (f, i) => {
      let src;
      try { const s = tree.text(f); src = s.text; if (s.encoding === 'ebcdic') stats.ebcdic++; } catch (e) { stats.unreadable++; unread.push(`${tree.rel(f)}: ${e.code || e.name}`); return 0; }
      const pli = PLI_PROGRAM.test(f);
      if (!pli && !/PROCEDURE\s+DIVISION|PROGRAM-ID/i.test(src)) return 0;
      if (held + src.length > budget) { stats.overBudget++; return 0; }
      held += src.length;
      let r;
      try {
        r = pli ? parsePliSource(src, f, { readMember }) : tree.parse(f, src);
      } catch (e) { stats.threw++; unparsed.push(`${tree.rel(f)}: ${e.code || e.name}`); return src.length; }
      stats.files++;
      const copied = src.length >= reuseMin && repeated.size ? repeated.get(textKey(src)) : undefined;
      const answer = ahead ? ahead.take(f, i) : null;
      const builtFiles = answer && answer.length === r.programs.length ? programFiles(r, f) : null;
      r.programs.forEach((p, k) => {
        programs.push(summarise(p, f, programs.length, r.options, copied ? reuseOf(copied, k, r, f, tree) : null, builtFiles && { ...answer[k], files: builtFiles }));
        stats.programs++;
      });
      if (copied && --copied.left === 0) repeated.delete(copied.text);
      return src.length;
    };
    let run;
    try { run = yield loopOver(files, readProgram, { label: 'flow', watcher: memoryWatcher }); } finally { ahead?.close(); }

    // A file the loop never reached is not the same as one past the byte budget, and they are
    // counted separately so a report can say which limit it hit.
    stats.filesNotReached += run.skipped.length;
    if (run.stoppedBy) stats.stoppedBy = run.stoppedBy;
    stats.peakHeapBytes = Math.max(stats.peakHeapBytes, run.peakHeapBytes);
  }

  const byId = new Map();
  const idCount = new Map();
  const allById = new Map();
  for (const p of programs) {
    if (p.id && !byId.has(p.id)) byId.set(p.id, p);
    if (p.id) { idCount.set(p.id, (idCount.get(p.id) || 0) + 1); (allById.get(p.id) || allById.set(p.id, []).get(p.id)).push(p); }
  }
  // The programs a CALL or LINK may reach. A program id the repository holds once is that program.
  // Held several times, the one in the caller's own source file is the one its executable links;
  // with none there, the holders nearest in the directory tree are, since a copy of a program tree
  // or a sibling executable's copy is farther than the caller's own build directory. Ties keep every
  // holder, and the edge says how many candidates there were.
  const sharedDirs = (a, b) => {
    const x = a.split(/[\\/]/), y = b.split(/[\\/]/);
    let n = 0;
    while (n < x.length - 1 && n < y.length - 1 && x[n] === y[n]) n++;
    return n;
  };
  const calleesOf = (name, fromFile) => {
    const all = allById.get(name) || [];
    if (all.length < 2) return { list: all, of: 0 };
    const here = all.filter((q) => q.file === fromFile);
    if (here.length) return { list: here, of: 0 };
    const depth = all.map((q) => sharedDirs(q.file, fromFile));
    const best = Math.max(...depth);
    return { list: all.filter((_, i) => depth[i] === best), of: all.length };
  };
  const ofN = (r, name) => (r.of ? `, ${r.list.length === r.of ? 'any' : 'nearest'} of ${r.of} programs named ${name}` : '');
  const constructs = [];
  for (const p of programs) {
    for (const t of p.transfers) {
      const r = calleesOf(t.callee, p.file);
      const site = ++callSites;
      const stmt = { verb: `EXEC CICS ${t.verb}`, file: rel(t.file), line: t.line };
      for (const callee of r.list) {
        if (!callee.commarea) continue;
        edge(t.argNode, callee.commarea, `EXEC CICS ${t.verb} COMMAREA to ${t.callee}${t.through ? `, the program ${t.through} names` : ''}${ofN(r, t.callee)}`, undefined, t.point, { call: site, stmt });
        if (t.verb === 'LINK') edge(callee.commarea, t.argNode, `COMMAREA returned from ${t.callee}${ofN(r, t.callee)}`, undefined, undefined, { ret: site, stmt });
      }
    }
    for (const c of p.callSites) {
      const r = calleesOf(c.name, p.file);
      const site = ++callSites;
      const stmt = { verb: 'CALL', file: rel(c.file), line: c.line };
      for (const callee of r.list) {
        if (!callee.params) continue;
        c.args.forEach((arg, i) => {
          const param = callee.params[i];
          if (!param || !arg.node || !param.node) return;
          edge(arg.node, param.node, `CALL '${c.display}' argument ${i + 1} at ${rel(c.file)}:${c.line}${ofN(r, c.display)}`, undefined, c.point, { call: site, stmt });
          if (arg.mode === 'REFERENCE' && param.mode === 'REFERENCE') edge(param.node, arg.node, `CALL '${c.display}' argument ${i + 1} written back${ofN(r, c.display)}`, undefined, undefined, { ret: site, stmt });
        });
      }
      const callee = r.list.length === 1 ? r.list[0] : null;
      if (!callee || !callee.params) continue;
      // A callee that declares more bytes than its caller passes reads and writes whatever follows
      // the argument in the caller's storage. Measured over 8,640 bound pairs in 125 repositories:
      // where the extra bytes stay inside the caller's own record they are its neighbouring fields,
      // sometimes on purpose (ACAS passes the first field of a group to reach the whole group);
      // where they run past the record they are someone else's storage. Those are different
      // claims, so they are different rules.
      //
      // Not compared: a program id defined twice in the repository, where which callee runs is not
      // known here; BY VALUE, which passes no storage; and a parameter holding an OCCURS DEPENDING
      // ON table, whose declared size is its largest rather than what it holds.
      if ((idCount.get(c.name) || 0) > 1) continue;
      const over = [];
      c.args.forEach((arg, i) => {
        const param = callee.params[i];
        const a = arg.extent;
        const q = param && param.extent;
        if (!a || !q || q.variable || arg.mode === 'VALUE' || param.mode === 'VALUE' || q.bytes <= a.bytes) return;
        over.push({ position: i + 1, argument: a.name, argumentBytes: a.bytes, bytesToEndOfRecord: a.room,
          parameter: q.name, parameterBytes: q.bytes, writesPast: q.written > a.room, declared: { file: rel(q.file), line: q.line } });
      });
      for (const [rule, past] of [['call-parameter-exceeds-caller-record', true], ['call-parameter-exceeds-argument', false]]) {
        const these = over.filter(o => (o.parameterBytes > o.bytesToEndOfRecord) === past);
        // Past the caller's record, a callee that only reads takes a wrong value; one that writes
        // overwrites storage that is not the caller's.
        const readsOnly = past && these.every((o) => !o.writesPast);
        if (these.length) constructs.push({ rule, file: rel(c.file), line: c.line, program: p.id, callee: callee.id, args: these, pk: p.pk, ...(readsOnly ? { sev: 'low' } : {}) });
      }
    }
  }
  constructs.sort((a, b) => byText(a.file, b.file) || a.line - b.line || byText(a.rule, b.rule));

  // The entry point above the program boundary. Until this ran, the flow engine began where a
  // program began, and the real beginning is a JCL step: it chooses the program, hands it a
  // parameter, and fills the DD names the program reads. Both of those are written in files that
  // anyone who can commit to the repository can edit, which makes them untrusted in the same sense
  // ACCEPT FROM COMMAND-LINE is untrusted.
  for (const f of jclPending) {
    let src;
    try { src = jclTrees.get(f).text(f).text; } catch (e) { stats.unreadable++; unread.push(`${rel(f)}: ${e.code || e.name}`); continue; }
    let job;
    try { job = parseJcl(src, f); } catch (e) { stats.threw++; unparsed.push(`${rel(f)}: ${e.code || e.name}`); continue; }
    stats.jclFiles++;

    for (const step of job.steps) {
      if (!step.pgm) continue;
      stats.jclSteps++;
      // A DFHCSDUP step's input is CSD definitions, kept in a job rather than an extract.
      if (step.pgm.toUpperCase() === 'DFHCSDUP') {
        for (const dd of step.dds) if (dd.name && dd.name.toUpperCase() === 'SYSIN' && dd.inStream) addCsd(dd.inStream.map((l) => l.text).join('\n'), f, dd.inStream[0].line - 1);
      }
      jobSteps.push({ file: f, job: job.jobs[0]?.name || null, step: step.name, line: step.line, pgm: step.pgm.toUpperCase() });
      // A TSO batch step starts programs by name in its commands, TSO CALL and DSN RUN PROGRAM, and
      // each is handed the step's DDs and its own parameter as EXEC PGM= would be.
      const runs = [{ pgm: step.pgm.toUpperCase(), parm: step.parm, line: step.line, how: `PARM= on step ${step.name || '(unnamed)'} of ${rel(f)}` }];
      for (const r of tsoCommands(step).runs) {
        jobSteps.push({ file: f, job: job.jobs[0]?.name || null, step: step.name, line: r.line, pgm: r.program });
        runs.push({ pgm: r.program, parm: r.parm, line: r.line, how: `the parameter ${r.via} passes in step ${step.name || '(unnamed)'} of ${rel(f)}` });
      }
      for (const run of runs) {
        const holders = allById.get(run.pgm) || [];
        if (!holders.length) continue;            // a system utility, or a program not in this tree
        stats.jclStepsResolved++;
        // A program id held several times has no caller file to choose by, so each holder is a candidate.
        const amb = holders.length > 1 ? `, any of ${holders.length} programs named ${run.pgm}` : '';
        for (const callee of holders) {

          // PARM arrives in the first PROCEDURE DIVISION USING item: on z/OS a halfword length
          // followed by the text. A program with no USING cannot receive one, and saying it does
          // would be a path nobody could follow.
          if (run.parm !== null && callee.params && callee.params[0] && callee.params[0].node) {
            addSource(callee.params[0].node, {
              kind: 'jcl-parm', file: f, line: run.line,
              detail: `${run.how}, which runs ${run.pgm}${amb}`,
            });
            stats.jclCrossings++;
          }

          // In-stream data reaches whatever record the program reads from that DD. The COBOL says
          // ASSIGN TO SYSIN and the job says //SYSIN DD *; neither half names the other, and the
          // join is the whole point of reading both.
          for (const dd of step.dds) {
            // The same join in the other direction: what the program writes through SELECT ... ASSIGN
            // TO a DD the job sends to the internal reader is submitted as a job.
            if (dd.name && dd.sysout && /\bINTRDR\b/i.test(dd.sysout)) {
              for (const m of callee.ddFiles || []) {
                if (m.dd !== dd.name.toUpperCase()) continue;
                for (const n of m.nodes) {
                  addSink(n, { kind: 'internal-reader', file: m.file, line: m.line,
                    detail: `records written through SELECT ${m.select} to //${dd.name}, which step ${step.name || '(unnamed)'} of ${rel(f)} sends to the internal reader${amb}` });
                }
              }
            }
            if (!dd.inStream || !dd.inStream.length || !dd.name) continue;
            for (const m of callee.ddFiles || []) {
              if (m.dd !== dd.name.toUpperCase()) continue;
              for (const n of [...m.nodes, ...m.into]) {
                addSource(n, {
                  kind: 'jcl-instream', file: f, line: dd.line,
                  detail: `${dd.inStream.length} lines of in-stream data on //${dd.name} in step ${step.name || '(unnamed)'}, read through SELECT ${m.select}${amb}`,
                });
                stats.jclCrossings++;
              }
            }

          }
        }
      }
    }
  }

  // Where each program is started from: the transactions the CSD defines for it, the job steps that
  // run it, and whatever those programs call, link or transfer to, or start by transaction on the
  // way. A mainframe team triages by transaction, and a program nothing here starts is one no route
  // in this tree reaches.
  const roots = [];
  for (const [name, t] of csd.transactions) if (t.program && byId.has(t.program)) roots.push({ transaction: name, file: rel(t.file), line: t.line, program: t.program });
  // A URI map serves its program to an HTTP request under an alias transaction, CWBA unless it names
  // one, and that transaction is what the region checks the caller may start.
  for (const [name, u] of csd.urimaps) {
    if ((u.usage && u.usage !== 'SERVER') || !u.program || !byId.has(u.program)) continue;
    roots.push({ transaction: u.transaction || 'CWBA', urimap: name, ...(u.path ? { uri: u.path } : {}), file: rel(u.file), line: u.line, program: u.program });
  }
  for (const j of jobSteps) if (byId.has(j.pgm)) roots.push({ job: j.job, step: j.step, file: rel(j.file), line: j.line, program: j.pgm });
  const STARTED_BY_LISTED = 8;
  for (const r of roots) {
    const { program, ...entry } = r;
    const seenIds = new Set([program]);
    const queue = [program];
    for (let i = 0; i < queue.length; i++) {
      const p = byId.get(queue[i]);
      if (!p) continue;
      p.startedCount = (p.startedCount || 0) + 1;
      if (!p.startedBy) p.startedBy = [];
      if (p.startedBy.length < STARTED_BY_LISTED) p.startedBy.push(entry);
      const next = [...p.calls, ...p.transfersTo];
      for (const t of p.startsTransactions) { const d = csd.transactions.get(t); if (d && d.program) next.push(d.program); }
      for (const n of next) if (!seenIds.has(n) && byId.has(n)) { seenIds.add(n); queue.push(n); }
    }
  }
  // A program nothing starts, where the tree holds its entries at all. One whose name another
  // program spells in a literal may be started through a variable, and is left alone. Nothing is
  // said when any program went unread: its caller may be among them.
  const spelled = new Set();
  for (const p of programs) for (const n of p.names) if (n !== p.id) spelled.add(n);
  const readAll = !stats.stoppedBy && !stats.filesNotReached && !stats.overBudget && !stats.threw && !stats.unreadable;
  const unstarted = roots.length && readAll ? programs.filter((p) => p.id && !p.startedBy && !spelled.has(p.id) && byId.get(p.id) === p)
    .map((p) => ({ program: p.id, file: rel(p.file), line: p.line })) : [];
  const startedByOf = (pk) => {
    const p = programs[pk];
    return p && p.startedBy ? { startedBy: p.startedBy, ...(p.startedCount > p.startedBy.length ? { startedByMore: p.startedCount - p.startedBy.length } : {}) } : {};
  };

  // A transient-data write reaches the internal reader when the estate says its queue does, or says
  // the DD the CSD maps it to does. Anything else extrapartition is undecided rather than clean:
  // the region's JCL is what knows, and it is rarely in the repository. An intrapartition queue has
  // no DD and is decided; a queue named by a variable is undecided whatever the estate declares.
  const readerDds = new Set(site.internalReaderDds);
  const readerQueues = new Set(site.internalReaderQueues);
  const declared = readerDds.size > 0 || readerQueues.size > 0;
  stats.tdWritesUndecided = 0;
  for (const p of programs) {
    for (const w of p.tdWrites) {
      const def = w.queue ? csd.tdqueues.get(w.queue) : null;
      const dd = w.queue ? ddOfQueue(csd, w.queue) : null;
      if (w.queue && (readerQueues.has(w.queue) || (dd && readerDds.has(dd)))) {
        addSink(w.node, { kind: 'internal-reader', file: w.file, line: w.line, point: w.point,
          detail: `EXEC CICS WRITEQ TD QUEUE('${w.queue}')${dd ? `, which the CSD sends to DD ${dd}` : ''}, declared as reaching the internal reader` });
        continue;
      }
      // Any other queue is where a region writes what it logs or prints, unless it starts a
      // transaction, when it is a channel to that transaction instead.
      if (!(def && def.transid)) {
        addSink(w.node, { kind: 'log', onlyFrom: REFLECTED, file: w.file, line: w.line, point: w.point,
          detail: `EXEC CICS WRITEQ TD QUEUE(${w.queue ? `'${w.queue}'` : 'a name the program computes'})` });
      }
      if (!w.queue) { stats.tdWritesUndecided++; continue; }
      if (def && def.type === 'INTRA') continue;
      // A queue the CSD sends to a DD leaves the region: to a dataset, a printer or another job.
      if (dd) {
        addSink(w.node, { kind: 'extrapartition-queue', onlyFrom: DATA_AT_REST, file: w.file, line: w.line, point: w.point,
          detail: `EXEC CICS WRITEQ TD QUEUE('${w.queue}'), which the CSD sends out of the region to DD ${dd}` });
      }
      if (!declared) stats.tdWritesUndecided++;
      else if (!def && !readerQueues.size) stats.tdWritesUndecided++;
    }
  }

  // Each node's edges, in the order they were added: outStart[id] up to outStart[id + 1] index outTo
  // and outMeta.
  const outStart = new Int32Array(nodes.length + 1);
  for (let k = 0; k < edgeFrom.length; k++) outStart[edgeFrom[k] + 1]++;
  for (let i = 0; i < nodes.length; i++) outStart[i + 1] += outStart[i];
  const outTo = new Int32Array(edgeFrom.length);
  const outMeta = new Array(edgeFrom.length);
  {
    const fill = outStart.slice(0, nodes.length);
    for (let k = 0; k < edgeFrom.length; k++) { const at = fill[edgeFrom[k]]++; outTo[at] = edgeTo[k]; outMeta[at] = edgeMeta[k]; }
    edgeFrom.length = 0; edgeTo.length = 0; edgeMeta.length = 0;
  }

  // Only nodes that can reach some sink are worth walking into. One backward pass over a transient
  // reverse index answers that for every source at once; it is a superset, so nothing is lost.
  // Two answers, one bit each: whether a node reaches a sink a source at rest could be reported at,
  // and whether it reaches any sink. The bounds sinks take only input from outside, and a file
  // record's walk is not widened by sinks that could never report it - batch programs index
  // everything, and those are the walks that would pay.
  const AT_REST = 1, ANY = 2;
  const canReach = new Uint8Array(nodes.length);
  {
    const revStart = new Int32Array(nodes.length + 1);
    for (let k = 0; k < outTo.length; k++) revStart[outTo[k] + 1]++;
    for (let i = 0; i < nodes.length; i++) revStart[i + 1] += revStart[i];
    const fill = revStart.slice(0, nodes.length);
    const rev = new Int32Array(revStart[nodes.length]);
    for (let id = 0; id < nodes.length; id++) for (let k = outStart[id]; k < outStart[id + 1]; k++) rev[fill[outTo[k]]++] = id;
    const mark = (bit, seeds) => {
      const queue = [];
      for (const n of nodes) if (seeds(n)) { canReach[n.id] |= bit; queue.push(n.id); }
      for (let qi = 0; qi < queue.length; qi++) {
        const id = queue[qi];
        for (let k = revStart[id]; k < revStart[id + 1]; k++) if (!(canReach[rev[k]] & bit)) { canReach[rev[k]] |= bit; queue.push(rev[k]); }
      }
    };
    mark(ANY, (n) => n.sinks.length > 0);
    mark(AT_REST, (n) => n.sinks.some((s) => !s.onlyFrom || s.onlyFrom.some((k) => DATA_AT_REST.includes(k))));
  }

  const fmtWhy = (w) => (typeof w === 'string' ? w : `${w.verb} at ${w.file}:${w.line}`);

  // Whether a check carries a value at the point it leaves a node, and how far: 2 when what the node
  // holds there is safe for the sink, 1 when a check has run on every route to that point, 0 when
  // neither. A program whose order could not be read credits its checks the old way, wherever the
  // field is used and never past 1.
  const STRUCTURAL = new Set(['group', 'redefines', 'renames']);
  const pointOfEdge = (e) => (e.why && typeof e.why === 'object' ? e.why.point : e.at);
  const moves = (e) => !(typeof e.why === 'string' && STRUCTURAL.has(e.why));
  const NONE = { level: 0, check: null };
  // `limit` is how many entries or bytes the sink's index may name, where one number says it.
  function creditAt(n, point, kind, limit = null, offset = 0, nonNeg = false) {
    const p = programs[n.pk];
    if (!p || !p.ordered) return n.guard ? { level: 1, check: n.guard } : NONE;
    if (!n.checks || point == null) return NONE;
    const bits = p.facts.get(point);
    return bits ? creditOf(n.checks, bits, kind, limit, offset, nonNeg) : NONE;
  }
  // A length is judged with its start: the last byte, S + L - 1, stays inside the item where the
  // start at its highest leaves room for the length, or where a fact bounds the two together.
  function spanned(c, sink, n) {
    if (c.level < 2 || !sink.start) return c;
    const p = programs[n.pk];
    const bits = p && p.ordered && sink.point != null ? p.facts.get(sink.point) : null;
    const s = sink.start;
    if (bits && s.spans.some((t) => hasFact(bits, t))) return c;
    const top = bits && s.node ? topOf(s.node.checks, bits) : null;
    const len = c.cons ? wholeTop(c.cons) : null;
    return top != null && len != null && top + s.offset + len - 1 <= s.size ? c : { level: 1, check: c.check };
  }
  // A loop bound cannot push its counter out of the table when the loop's own condition or the
  // body's checks keep every subscript the counter makes, and each index beside it, in range.
  // That holds whatever the bound is, so it does not depend on the route the input took.
  function counterCredit(sink) {
    const uses = sink.kind === 'loop-bound' ? sink.counterUses : null;
    if (!uses || !uses.length) return null;
    let first = null;
    for (const u of uses) {
      for (const m of u.mates) {
        const c = creditAt(m.node, m.point, 'subscript', m.limit, m.offset || 0);
        if (c.level < 2 || m.limit == null || !within(c.cons, m.limit)) return null;
        if (m === u && !first) first = { credit: c, node: m.node };
      }
    }
    return first;
  }
  // The best credit on a route. Each node is judged at the statement its value leaves by, which for
  // the last is the sink's own. A structural hop - into a group, across a REDEFINES - moves no value
  // in time, so the node before it is judged where the value next moves.
  function routeCredit(hops, sink, src) {
    if (sink.noCredit || (src && src.noCredit)) return { best: NONE, by: null, missed: null };
    const own = counterCredit(sink);
    if (own) return { best: own.credit, by: own.node, missed: null, own: true };
    let best = NONE;
    let by = null;
    let missed = null;
    let point = sink.point;
    for (let h = hops.length - 1; h >= 0; h--) {
      const n = hops[h].node;
      let c = spanned(creditAt(n, point, sink.kind, sink.limit, sink.offset, sink.nonNeg), sink, n);
      // A count checked against a number above the table's maximum has been checked, not kept in range.
      if (c.level === 2 && sink.top != null && !within(c.cons, sink.top, false)) c = { level: 1, check: c.check };
      if (c.level > best.level) { best = c; by = n; }
      const any = (n.checks && n.checks.find((c) => c.x != null)) || n.guard;
      if (!c.level && any && !missed) missed = { node: n, check: any };
      if (h > 0 && hops[h].moves) point = hops[h].point;
    }
    return { best, by, missed };
  }
  // The credited findings of one source whose sink can be reached without the credit: walking from
  // the source, a value may not leave a node - or any node it reached by a structural hop since it
  // last moved - at a point where the credit reaches `level`.
  function refuse(start, reach, credited, level, kind, shift = 0) {
    walk++;
    stampCtx.clear();
    const want = credited.filter((c) => c.level >= level && c.sink.kind === kind && (c.sink.offset || 0) === shift);
    // Past the budget no route can be ruled out, so every credit in question is lost: a finding
    // may be reported unchecked, never dropped.
    if (edgesWalked >= totalBudget) { stats.creditUndecided++; return new Set(want); }
    const at = new Map();
    for (const c of want) { if (!at.has(c.node.id)) at.set(c.node.id, []); at.get(c.node.id).push(c); }
    // Along the way no sink's limit applies, so a bound that holds only against one blocks nothing.
    const holds = (since, point, k, limit = null, offset = 0, nonNeg = false, sink = null) => since.some((n) => {
      const c = creditAt(n, point, k, limit, offset, nonNeg);
      return (sink ? spanned(c, sink, n) : c).level >= level;
    });
    const lost = new Set();
    const dirty = new Map();
    const parts = new Map();
    const open = [{ node: start, partial: false, lo: 0, hi: 0, vague: false, since: [start] }];
    stampWhole[start.id] = walk;
    const began = edgesWalked;
    for (let i = 0; i < open.length; i++) {
      const st = open[i];
      for (const c of at.get(st.node.id) || []) if (!holds(st.since, c.sink.point, c.sink.kind, c.sink.limit, c.sink.offset, c.sink.nonNeg, c.sink)) lost.add(c);
      for (let k = outStart[st.node.id]; k < outStart[st.node.id + 1]; k++) {
        edgesWalked++;
        const e = outMeta[k];
        const to = nodes[outTo[k]];
        if (!(canReach[to.id] & reach)) continue;
        const mv = moves(e);
        if (mv && holds(st.since, pointOfEdge(e), kind, null, shift)) continue;
        const t = cross(st, e, to);
        if (!t) continue;
        const since = mv ? [to] : [...st.since, to];
        // An arrival carrying a checked node is refused more than one that does not, so it must not
        // stand in for it.
        const guarded = since.some((n) => n.checks || n.guard);
        if (t.partial) {
          const key = atContext(to.id, t.ctx, guarded ? 1 : 0);
          const held = parts.get(key);
          if (held && held.some((r) => (r[2] ? t.vague : !t.vague && r[0] <= t.lo && t.hi <= r[1]))) continue;
          if (held) held.push([t.lo, t.hi, t.vague]); else parts.set(key, [[t.lo, t.hi, t.vague]]);
        } else if (guarded) {
          const dk = atContext(to.id, t.ctx);
          if (stampWhole[to.id] === walk || dirty.get(dk) === walk) continue;
          dirty.set(dk, walk);
        } else if (!firstVisit(to.id, t.ctx)) continue;
        open.push({ node: to, ...t, since });
      }
      if (edgesWalked - began > walkBudget) { stats.creditUndecided++; return new Set(want); }
    }
    return lost;
  }
  const findings = [];
  const seen = new Set();
  // A sink at a statement no route from any entry reaches does not run as the program stands.
  const unreached = (n, sink) => {
    const p = programs[n.pk];
    return !!p && p.reachKnown && sink.point != null && p.reached[sink.point] !== 1;
  };
  // The findings of one source, one table and one index name, from which the least checked is kept.
  const useGroup = new Map();
  // Visit stamps instead of a per-walk Set: one walk per source, and a Set of string keys per walk
  // was most of the time spent on large repositories.
  const stampWhole = new Int32Array(nodes.length);
  // A whole node reached with a call context, per walk. Reached with none, it stands in for every context.
  const stampCtx = new Map();
  // A node and a call context as one number, with room for a second bit of state.
  const atContext = (id, ctx, bit = 0) => (ctx * 2 + bit) * nodes.length + id;
  const firstVisit = (id, ctx) => {
    if (stampWhole[id] === walk) return false;
    if (!ctx) { stampWhole[id] = walk; return true; }
    const key = atContext(id, ctx);
    if (stampCtx.get(key) === walk) return false;
    stampCtx.set(key, walk);
    return true;
  };
  let walk = 0;
  // Every walk is bounded, and so is the analysis. One source of an estate whose programs share
  // their records through thousands of copybooks reached millions of nodes, and 22,905 such walks
  // would have run for hours. Edges examined are counted rather than seconds, so the same tree always
  // stops at the same place.
  const walkBudget = opts.walkEdges ?? WALK_EDGES;
  const totalBudget = opts.totalEdges ?? TOTAL_EDGES;
  let edgesWalked = 0;
  stats.walksCut = 0;
  stats.sourcesNotWalked = 0;
  stats.creditUndecided = 0;

  // How taint crosses one edge: whether it reaches the far item, and which of its bytes. Null when
  // it does not. Both walks below cross edges through this, so neither can take a route the other
  // would refuse.
  const known = (n) => n.off != null && n.size != null && !n.repeats;
  // The call sites a value entered its callees through, innermost last, as a number standing for
  // that sequence; 0 where any caller may be returned to: a value born in the callee, or one that
  // rested in storage a program keeps between calls, which a later call from any caller can read.
  const CONTEXT_DEPTH = 4;
  const contextSites = [[]];
  const contextNumber = new Map([['', 0]]);
  const entered = new Map();
  const returned = new Map();
  const contextOf = (sites) => {
    const k = sites.join('/');
    let c = contextNumber.get(k);
    if (c === undefined) { c = contextSites.length; contextSites.push(sites); contextNumber.set(k, c); }
    return c;
  };
  function contextOver(state, e, to) {
    const ctx = state.ctx || 0;
    if (e.ret != null) {
      if (!ctx) return 0;
      let byRet = returned.get(ctx);
      if (!byRet) returned.set(ctx, byRet = new Map());
      let out = byRet.get(e.ret);
      if (out === undefined) {
        const sites = contextSites[ctx];
        out = Number(sites[sites.length - 1]) === e.ret ? contextOf(sites.slice(0, -1)) : null;
        byRet.set(e.ret, out);
      }
      return out;
    }
    if (e.call != null) {
      let byCall = entered.get(ctx);
      if (!byCall) entered.set(ctx, byCall = new Map());
      let out = byCall.get(e.call);
      if (out === undefined) {
        out = contextOf([...contextSites[ctx], String(e.call)].slice(-CONTEXT_DEPTH));
        byCall.set(e.call, out);
      }
      return out;
    }
    return to.linkage ? ctx : 0;
  }
  function cross(state, e, to) {
    const cur = state.node;
    const ctx = contextOver(state, e, to);
    if (ctx === null) return null;
    let partial = false, lo = 0, hi = 0, vague = false;
    if (opts.legacyGroupEdges) { /* every edge carries the whole item */ }
    else if (e.dir === 'up') {
      partial = true;
      if (known(cur) && known(to) && !state.vague) {
        const shift = cur.off - to.off;
        lo = shift + (state.partial ? state.lo : 0);
        hi = shift + (state.partial ? state.hi : cur.size);
      } else vague = true;
    } else if (e.dir === 'down') {
      if (state.partial && to.repeats) {
        // A table inside the group. Which element the tainted bytes fall in is not known, but
        // whether they fall inside the table is; if they do, some element holds them, and the walk
        // goes on without claiming which bytes. A table they miss stays clean.
        if (state.vague || !known(cur) || to.tableOff == null) return null;
        const tlo = cur.off + state.lo;
        const thi = cur.off + state.hi;
        if (Math.max(tlo, to.tableOff) >= Math.min(thi, to.tableEnd)) return null;
        partial = true; vague = true;
      } else if (state.partial) {
        if (state.vague || !known(cur) || !known(to)) return null;
        const start = to.off - cur.off;
        lo = Math.max(state.lo, start) - start;
        hi = Math.min(state.hi, start + to.size) - start;
        if (hi <= lo) return null;
        partial = !(lo === 0 && hi === to.size);
      }
    } else if (state.partial) {
      // A statement other than MOVE builds its result from the operand, so the tainted bytes are in
      // the result at a position nobody can name: the whole result is tainted.
      const copies = typeof e.why === 'string' || (e.why && e.why.verb === 'MOVE');
      if (copies) {
        partial = true; vague = state.vague; lo = state.lo; hi = state.hi;
        if (!vague && to.size != null) { hi = Math.min(hi, to.size); if (hi <= lo) return null; }
      }
    }
    return { partial, lo, hi, vague, ctx };
  }
  // The statement that carries an edge: null for storage that overlays storage, which runs nothing,
  // and undefined where the engine does not know which statement it is.
  const OVERLAYS = new Set(['group', 'redefines', 'renames']);
  const statementOf = (e) => {
    if (e.stmt) return e.stmt;
    if (e.why && typeof e.why === 'object') return { verb: e.why.verb, file: e.why.file, line: e.why.line };
    return OVERLAYS.has(e.why) ? null : undefined;
  };
  // Every route from one walk's source to each sink it reached: the edges the walk could cross that
  // lead on to the sink, taken or not, by node rather than by call context or bytes. That lists a
  // statement no route needs sooner than it leaves out one a route does.
  function attachRoutes(awaiting, crossed, src, cut) {
    const into = new Map();
    for (const c of crossed) {
      const list = into.get(c.to);
      if (list) list.push(c); else into.set(c.to, [c]);
    }
    for (const { finding, at } of awaiting) {
      const onRoute = new Set([at]);
      const stack = [at];
      const statements = new Map();
      let unplaced = 0;
      while (stack.length) {
        for (const c of into.get(stack.pop()) || []) {
          const s = statementOf(c.e);
          if (s) statements.set(`${s.file}:${s.line}:${s.verb}`, s);
          else if (s === undefined) unplaced++;
          if (!onRoute.has(c.from)) { onRoute.add(c.from); stack.push(c.from); }
        }
      }
      finding.routes = {
        sources: [{ kind: src.kind, file: rel(src.file), line: src.line }],
        statements: [...statements.values()].sort((a, b) => byText(a.file, b.file) || a.line - b.line || byText(a.verb, b.verb)),
        ...(unplaced ? { unplaced } : {}),
        complete: !cut && !unplaced,
      };
    }
  }
  for (const start of nodes) {
    if (!start.sources.length || !canReach[start.id]) continue;
    for (const src of start.sources) {
      const reach = DATA_AT_REST.includes(src.kind) ? AT_REST : ANY;
      if (!(canReach[start.id] & reach)) continue;
      if (edgesWalked >= totalBudget) { stats.sourcesNotWalked++; continue; }
      walk++;
      stampCtx.clear();
      const credited = [];
      // A state is a node plus which of its bytes are tainted. Going up from a child taints only
      // that child's bytes of the group; going down reaches a child only if those bytes overlap it,
      // which is what keeps a sibling nobody wrote out of the path. The bytes travel unchanged
      // through anything that copies or overlays storage: a group MOVE, a REDEFINES, an argument
      // passed by CALL or a communication area. Where a position is unknown (an OCCURS, a record
      // without a layout) partial taint does not descend at all.
      const queue = [{ node: start, partial: false, lo: 0, hi: 0, vague: false, prev: null, why: 'source' }];
      const partSeen = new Map();
      const crossedEdges = allRoutes ? [] : null;
      const awaiting = allRoutes ? [] : null;
      stampWhole[start.id] = walk;
      let cut = false;
      const began = edgesWalked;
      for (let qi = 0; qi < queue.length && !cut; qi++) {
        const state = queue[qi];
        const cur = state.node;
        for (const sink of cur.sinks) {
          if (sink.onlyFrom && !sink.onlyFrom.includes(src.kind)) continue;
          if (src.onlyTo && !src.onlyTo.includes(sink.kind)) continue;
          // Uses of an index are told apart by name and place, so one line's two uses are both judged.
          const key = `${src.kind}|${src.file}:${src.line}|${sink.kind}|${sink.file}:${sink.line}${sink.group ? `|${sink.group}|${sink.point}` : ''}`;
          if (seen.has(key)) continue;
          // A value the program computed is valid decimal whatever the input was, so a route through
          // arithmetic or a numeric function carries no bad bytes to the next one. Only this route is
          // dropped: a later one that copies the bytes still reports.
          if (sink.kind === 'arithmetic' && computedOnRoute(state)) continue;
          // A protected field's value carried through a field the terminal may type into reaches the
          // key as typed input, which the user could have entered anyway: the protection was no control.
          if (src.kind === 'cics-protected-field' && typedOnRoute(state)) continue;
          seen.add(key);
          // The ends of a long path are what a reader uses: where the value came from, and what it
          // reached. Keeping every hop of a thousand-hop chain, for a thousand findings, is the
          // quadratic cost in a chain-shaped program, so the middle is dropped and said to be.
          const hops = [];
          for (let s = state; s; s = s.prev) hops.push(s);
          hops.reverse();
          const hop = (s) => ({ program: s.node.program, item: s.node.name, file: rel(s.node.file), via: fmtWhy(s.why), ...(s.dir ? { dir: s.dir } : {}) });
          const path = fullTrace || hops.length <= TRACE_MAX
            ? hops.map(hop)
            : [...hops.slice(0, TRACE_KEEP).map(hop),
              { program: null, item: null, file: null, via: `… ${hops.length - TRACE_KEEP * 2} hops not listed`, elided: hops.length - TRACE_KEEP * 2 },
              ...hops.slice(-TRACE_KEEP).map(hop)];
          const { best, by, missed, own } = routeCredit(hops, sink, src);
          const screen = hops.find((h) => h.node.screen)?.node.screen;
          findings.push({
            rule: `${src.kind}-to-${sink.kind}`,
            source: { kind: src.kind, detail: src.detail, file: rel(src.file), line: src.line, program: start.program },
            sink: { kind: sink.kind, detail: sink.detail, file: rel(sink.file), line: sink.line, program: cur.program },
            crossProgram: start.pk !== cur.pk,
            hops: hops.length,
            path,
            ...(sink.ssrange ? { ssrange: true } : {}),
            ...(unreached(cur, sink) ? { unreached: true } : {}),
            ...(screen ? { screen } : {}),
            ...startedByOf(cur.pk),
            ...(best.level ? { guard: { program: by.program, item: by.name, file: rel(best.check.file), line: best.check.line, ...(best.level === 2 ? { stops: true } : {}) } } : {}),
            ...(!best.level && missed ? { checkElsewhere: { program: missed.node.program, item: missed.node.name, file: rel(missed.check.file), line: missed.check.line } } : {}),
          });
          if (awaiting) awaiting.push({ finding: findings[findings.length - 1], at: cur.id });
          if (best.level && !own) credited.push({ finding: findings[findings.length - 1], node: cur, sink, level: best.level });
          if (sink.group) useGroup.set(findings[findings.length - 1], `${src.kind}|${src.file}:${src.line}|${sink.kind}|${sink.group}`);
        }
        for (let k = outStart[cur.id]; k < outStart[cur.id + 1]; k++) {
          if (++edgesWalked - began > walkBudget) { cut = true; break; }
          const e = outMeta[k];
          const to = nodes[outTo[k]];
          if (!(canReach[to.id] & reach)) continue;
          const crossed = cross(state, e, to);
          if (!crossed) continue;
          if (crossedEdges) crossedEdges.push({ from: cur.id, to: to.id, e });
          const { partial, lo, hi, vague, ctx } = crossed;
          if (partial) {
            const pk = atContext(to.id, ctx);
            const held = partSeen.get(pk);
            if (held && held.some(r => (r[2] ? vague : !vague && r[0] <= lo && hi <= r[1]))) continue;
            if (held) held.push([lo, hi, vague]); else partSeen.set(pk, [[lo, hi, vague]]);
          } else if (!firstVisit(to.id, ctx)) continue;
          queue.push({ node: to, partial, lo, hi, vague, ctx, prev: state, why: e.why, dir: e.dir, point: pointOfEdge(e), moves: moves(e) });
        }
      }
      if (cut) stats.walksCut++;
      if (awaiting?.length) attachRoutes(awaiting, crossedEdges, src, cut);
      // The walk keeps the shortest route to each sink, and credit on that route says nothing if
      // another reaches the sink without it. So the walk runs again, refusing to let the value leave
      // a node where the credit holds, and a sink it still reaches loses the credit: first for any
      // check that ran, then, per kind of sink, for one that stops the value. It crosses edges through
      // cross() like the first walk, so it cannot take a route the first would refuse.
      if (credited.length) {
        // Per kind of sink, because what a check leaves may stop one kind and say nothing to another.
        // And per shift, because a value that stops a bare index does not stop one moved down by a constant.
        const shiftsOf = (list, kind) => new Set(list.filter((c) => c.sink.kind === kind).map((c) => c.sink.offset || 0));
        for (const kind of new Set(credited.map((c) => c.sink.kind))) {
          for (const shift of shiftsOf(credited, kind)) {
            for (const c of refuse(start, reach, credited, 1, kind, shift)) {
              const g = c.finding.guard;
              delete c.finding.guard;
              c.finding.checkElsewhere = { program: g.program, item: g.item, file: g.file, line: g.line };
              c.level = 0;
            }
          }
        }
        for (const kind of new Set(credited.filter((c) => c.level === 2).map((c) => c.sink.kind))) {
          const two = credited.filter((c) => c.level === 2);
          for (const shift of shiftsOf(two, kind)) {
            for (const c of refuse(start, reach, credited, 2, kind, shift)) if (c.level === 2) { delete c.finding.guard.stops; c.level = 1; }
          }
        }
      }
    }
  }

  // One use per source, table and index: the least checked a route reaches, then the first.
  if (useGroup.size) {
    const rank = (f) => (f.unreached ? 3 : f.guard ? (f.guard.stops ? 2 : 1) : 0);
    const kept = new Map();
    for (const [f, key] of useGroup) {
      const k = kept.get(key);
      if (!k || rank(f) < rank(k) || (rank(f) === rank(k) && (byText(f.sink.file, k.sink.file) || f.sink.line - k.sink.line) < 0)) kept.set(key, f);
    }
    const keep = new Set(kept.values());
    // The uses left out are named on the one kept, with how far each is checked, so a reader can see them.
    const level = (f) => (f.guard ? (f.guard.stops ? 2 : 1) : 0);
    for (const [f, key] of useGroup) {
      if (keep.has(f)) continue;
      const k = kept.get(key);
      (k.also ||= []).push({ file: f.sink.file, line: f.sink.line, program: f.sink.program, detail: f.sink.detail, level: level(f), unreached: !!f.unreached, ...(f.guard ? { guardLine: f.guard.line } : {}) });
    }
    let w = 0;
    for (const f of findings) if (!useGroup.has(f) || keep.has(f)) findings[w++] = f;
    findings.length = w;
  }
  findings.sort((a, b) => byText(a.rule, b.rule) || byText(a.source.file, b.source.file) || a.source.line - b.source.line || a.sink.line - b.sink.line);
  // The counts say how much was missed; these say what. A flow result over a tree where eleven
  // programs would not parse is a different claim from one over a tree where all of them did, and
  // the reader cannot tell which without the names.
  if (unread.length) stats.unreadableFiles = unread;
  if (unparsed.length) stats.unparsedFiles = unparsed;
  // Every sink the graph holds, reached or not, once per site and operand. A labelling worksheet
  // built from findings alone could measure precision and never recall.
  const sinks = opts.listSinks ? [] : null;
  if (sinks) {
    const listed = new Set();
    for (const n of nodes) for (const s of n.sinks) {
      const at = { program: n.program, programFile: rel(n.file), file: rel(s.file), line: s.line, kind: s.kind, item: n.name, detail: s.detail, ...(s.onlyFrom ? { onlyFrom: s.onlyFrom } : {}) };
      const key = `${at.programFile}|${at.program}|${at.file}|${at.line}|${at.kind}|${at.item}`;
      if (!listed.has(key)) { listed.add(key); sinks.push(at); }
    }
  }
  const sources = opts.listSources ? [] : null;
  if (sources) {
    const listed = new Set();
    for (const n of nodes) for (const s of n.sources) {
      if (!s.file) continue;
      const at = { program: n.program, programFile: rel(n.file), file: rel(s.file), line: s.line, kind: s.kind, item: n.name };
      const key = `${at.programFile}|${at.program}|${at.file}|${at.line}|${at.kind}|${at.item}`;
      if (!listed.has(key)) { listed.add(key); sources.push(at); }
    }
  }
  for (const c of constructs) { Object.assign(c, startedByOf(c.pk)); delete c.pk; }
  stats.entryPoints = { transactions: csd.transactions.size, uriMaps: csd.urimaps.size, jobSteps: jobSteps.length, roots: roots.length, programsStarted: programs.filter((p) => p.startedBy).length, programsWithoutEntry: unstarted.length };
  const startedBy = {};
  for (const p of programs) if (p.id && p.startedBy && !startedBy[p.id]) startedBy[p.id] = p.startedBy;
  return { findings, constructs, unstarted, startedBy, stats, sourceKinds: SOURCE_KINDS, sinkKinds: SINK_KINDS, ...(sinks ? { sinks } : {}), ...(sources ? { sources } : {}) };
}

export const analyze = (root, opts = {}) => drive(analyzeSteps(root, opts));

// What the size check across a CALL needs from an item: its bytes, the bytes from it to the end of
// the record it sits in, whether a table inside it is variable, and where it was declared.
function extentOf(item) {
  if (!item || item.size == null) return null;
  let top = item;
  while (top.parent) top = top.parent;
  const room = top.size != null && item.offset != null ? top.size - (item.offset - (top.offset ?? 0)) : item.size;
  return { name: item.name, bytes: item.size, room, variable: hasVariableTable(item), file: item.file, line: item.line };
}

function hasVariableTable(item) {
  if (item.dependingOn) return true;
  for (const c of item.children || []) if (hasVariableTable(c)) return true;
  return false;
}

if (process.argv[1] && process.argv[1].endsWith('dataflow.mjs')) {
  const [root, out] = process.argv.slice(2);
  const repos = process.env.DF_REPOS ? process.env.DF_REPOS.split(',') : (process.env.DF_FLAT ? [''] : null);
  const { readdirSync, writeFileSync } = await import('node:fs');
  const list = repos || readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name);
  const t0 = Date.now();
  // One graph per repository: program names are only unique within a repository, so a single
  // corpus-wide graph would link a CALL in one repository to a same-named program in another.
  const res = { findings: [], stats: { files: 0, programs: 0, edges: 0, nodes: 0, threw: 0 }, perRepo: {} };
  for (const repo of list) {
    const one = analyze(root, { repos: [repo] });
    for (const k of Object.keys(res.stats)) res.stats[k] += one.stats[k];
    res.findings.push(...one.findings);
    res.perRepo[repo] = { files: one.stats.files, programs: one.stats.programs, findings: one.findings.length };
    if (process.env.DF_PROGRESS) console.error(`${repo} files=${one.stats.files} findings=${one.findings.length}`);
  }
  res.sourceKinds = SOURCE_KINDS;
  res.sinkKinds = SINK_KINDS;
  res.secs = Math.round((Date.now() - t0) / 1000);
  if (out) writeFileSync(out, JSON.stringify(res, null, 1));
  const byRule = {};
  for (const f of res.findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  const cross = res.findings.filter(f => f.crossProgram).length;
  console.log(`files=${res.stats.files} programs=${res.stats.programs} nodes=${res.stats.nodes} edges=${res.stats.edges} secs=${res.secs}`);
  console.log(`findings=${res.findings.length} crossProgram=${cross}`);
  console.log(JSON.stringify(byRule, null, 1));
}
