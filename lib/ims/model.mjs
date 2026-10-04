// SPDX-License-Identifier: AGPL-3.0-or-later
// A DBD or PSB as its generation utility builds it: segments with their fields, or PCBs with their
// sensitive segments, and what DBDGEN or PSBGEN refuses in it, each under its message number in IMS
// 15.6 Messages and Codes, Volume 2. A statement the reader could not read may hide a segment, so the
// checks that need every segment named run only while none has been missed.
import { readIms, parseImsStatement, IMS_MACROS } from './read.mjs';
import { sublist } from './operands.mjs';

const DBD_MACROS = new Set(['DBD', 'DATASET', 'AREA', 'SEGM', 'FIELD', 'LCHILD', 'XDFLD', 'DBDGEN']);
const PSB_MACROS = new Set(['PCB', 'SENSEG', 'SENFLD', 'PSBGEN']);

export function modelOf(text) {
  const read = readIms(text).statements.map((st) => ({ st, r: parseImsStatement(st) }));
  const first = read.find(({ st }) => DBD_MACROS.has(st.operation) || PSB_MACROS.has(st.operation));
  if (!first) return null;
  return DBD_MACROS.has(first.st.operation) ? dbdModel(read) : psbModel(read);
}

// PARENT=name, PARENT=((name,SNGL|DBLE),(lparent,VIRTUAL|PHYSICAL,dbname)) or PARENT=0.
function parents(raw) {
  if (raw == null) return { physical: null, logical: null };
  const [first, second] = sublist(raw);
  const physical = first.startsWith('(') ? sublist(first)[0] : first;
  const logical = second ? sublist(second)[0] : null;
  return { physical: physical === '0' ? null : physical, logical };
}

const unreadOf = (st, r) => ({ line: st.line, operation: st.operation ?? null, reason: r.reason ?? r.status });

// A statement that is not an IMS macro (a macro call, COPY) or a SEGM the reader refused may define a
// segment the model never saw.
const mayHideSegment = (st) => st.operation === 'SEGM' || !IMS_MACROS.has(st.operation);

function dbdModel(read) {
  const model = { kind: 'DBD', name: null, access: null, segments: [], unread: [], problems: [], complete: true };
  const problem = (line, message, text) => model.problems.push({ line, message, text });
  const segments = new Map();
  let segment;                  // the SEGM the next FIELD belongs to: undefined before any, null after an unread one

  for (const { st, r } of read) {
    if (r.status !== 'parsed') {
      model.unread.push(unreadOf(st, r));
      if (mayHideSegment(st)) model.complete = false;
      if (st.operation === 'SEGM') segment = null;
      else if (segment && (st.operation === 'FIELD' || st.operation === 'XDFLD')) segment.fieldStatements++;
      continue;
    }
    const n = r.node;
    if (n.kind === 'DBD') {
      model.name = n.name;
      model.access = n.access;
    } else if (n.kind === 'SEGM') {
      const { physical, logical } = parents(n.keywords.PARENT);
      segment = { name: n.name, parent: physical, logicalParent: logical, bytes: n.bytes, line: st.line, fields: [], fieldStatements: 0 };
      if (segments.has(n.name)) problem(st.line, 'SEGM140', `segment ${n.name} is defined twice`);
      else if (physical && !segments.has(physical) && model.complete) problem(st.line, 'SEGM170', `segment ${n.name} names parent ${physical}, which no earlier SEGM defines`);
      segments.set(n.name, segment);
      model.segments.push(segment);
    } else if (n.kind === 'FIELD' || n.kind === 'XDFLD') {
      if (segment === undefined) { problem(st.line, 'FLD100', `${n.kind} ${n.name ?? n.keywords.NAME} comes before any SEGM`); continue; }
      if (segment === null) continue;
      field(segment, n, st.line, problem);
    }
  }
  for (const s of model.segments) {
    const seq = s.fields.filter((f) => f.seq);
    if (seq.length > 1 && !s.logicalParent) problem(seq[1].line, 'FLD120', `segment ${s.name} has ${seq.length} sequence fields`);
  }
  return model;
}

function field(segment, n, line, problem) {
  const position = segment.fieldStatements++;
  const name = n.kind === 'FIELD' ? n.name : n.keywords.NAME;
  if (segment.fields.some((f) => f.name === name)) problem(line, 'FLD190', `field ${name} is defined twice in segment ${segment.name}`);
  if (n.kind === 'XDFLD') { segment.fields.push({ name, kind: 'XDFLD', seq: false, line }); return; }

  const f = { name, kind: 'FIELD', seq: n.seq, unique: n.unique, bytes: n.bytes, start: n.start, type: n.type, line };
  if (f.seq && position > 0 && !segment.fields.some((x) => x.seq)) problem(line, 'FLD230', `sequence field ${name} is not the first field of segment ${segment.name}`);
  // System-related fields (/SX, /CK) take START relative to the concatenated key, not the segment.
  const systemRelated = name.startsWith('/');
  if (!systemRelated && segment.bytes && f.start != null && f.bytes != null && f.start + f.bytes - 1 > segment.bytes.max) {
    problem(line, 'FLD170', `field ${name} ends at byte ${f.start + f.bytes - 1}, past segment ${segment.name}'s ${segment.bytes.max} bytes`);
  }
  segment.fields.push(f);
}

function psbModel(read) {
  const model = { kind: 'PSB', name: null, lang: null, pcbs: [], unread: [], problems: [] };
  const problem = (line, message, text) => model.problems.push({ line, message, text });
  let pcb;                      // the PCB the next SENSEG belongs to: undefined before any, null after an unread one

  for (const { st, r } of read) {
    if (r.status !== 'parsed') {
      model.unread.push(unreadOf(st, r));
      if (st.operation === 'PCB') pcb = null;
      else if (pcb && (st.operation === 'SENSEG' || !IMS_MACROS.has(st.operation))) pcb.complete = false;
      continue;
    }
    const n = r.node;
    if (n.kind === 'PSBGEN') {
      model.name = n.psbname;
      model.lang = n.lang;
    } else if (n.kind === 'PCB') {
      pcb = {
        name: n.name ?? `PCB ${model.pcbs.length + 1}`,
        type: n.type,
        dbd: n.dbd ?? null,
        // PROCOPT=A is the default (Full-function or Fast Path database PCB statement).
        procopt: n.type === 'DB' ? n.procopt ?? 'A' : n.procopt ?? null,
        procoptWritten: n.procopt ?? null,
        keylen: n.keylen ?? null,
        procseq: n.procseq ?? n.procseqd ?? null,
        line: st.line,
        sensegs: [],
        complete: true,
      };
      model.pcbs.push(pcb);
    } else if (n.kind === 'SENSEG') {
      if (pcb === undefined) { problem(st.line, 'SEG110', `SENSEG ${n.name} comes before any PCB`); continue; }
      if (pcb === null) continue;
      senseg(pcb, n, st.line, problem);
    }
  }
  return model;
}

function senseg(pcb, n, line, problem) {
  if (pcb.type !== 'DB') { problem(line, 'SEG140', `SENSEG ${n.name} follows ${pcb.type} PCB ${pcb.name}`); return; }
  if (pcb.sensegs.some((s) => s.name === n.name)) problem(line, 'SEG150', `SENSEG ${n.name} appears twice in PCB ${pcb.name}`);
  else if (n.parent && pcb.complete && !pcb.sensegs.some((s) => s.name === n.parent)) problem(line, 'SEG160', `SENSEG ${n.name} names parent ${n.parent}, which no earlier SENSEG of PCB ${pcb.name} defines`);
  // A SENSEG without PROCOPT takes the PCB's (SENSEG statement).
  pcb.sensegs.push({ name: n.name, parent: n.parent, procopt: n.procopt ?? pcb.procopt, procoptWritten: n.procopt ?? null, line });
}

// The bytes of the concatenated key of a segment: the first sequence field of each segment from the
// root down, along the DBD's physical parents. A segment with no sequence field adds nothing here, so
// the figure is never more than IMS's. Null when the path leaves the segments the model holds.
export function concatenatedKey(dbd, name) {
  const byName = new Map(dbd.segments.map((s) => [s.name, s]));
  const seen = new Set();
  let total = 0;
  for (let at = name; at; at = byName.get(at).parent) {
    if (!byName.has(at) || seen.has(at)) return null;
    seen.add(at);
    total += byName.get(at).fields.find((f) => f.seq)?.bytes ?? 0;
  }
  return total;
}
