// SPDX-License-Identifier: AGPL-3.0-or-later
// IMS database and program definitions: what a PSB lets a program change, SENSEGs that name segments
// their DBD does not define, and what DBDGEN, PSBGEN or ACBGEN refuses (lib/ims/rules.mjs). DBDs and
// PSBs are assembler macros and are often named .asm, so assembler files are read too, and kept only
// where they hold a DBD or PSB.
import { inScope, isAssembler, isIms, isJcl, isProgram, relPath } from '../sources.mjs';
import { report } from '../kernel/ruleset.mjs';
import { treeFor, noteUnread, noteUnparsed } from '../kernel/source-tree.mjs';
import { eachWithinMemory } from '../kernel/memory.mjs';
import { modelOf } from '../ims/model.mjs';
import { IMS_RULES, checkModels, checkProcoptAgainstCalls } from '../ims/rules.mjs';
import { DLI_ROUTINE, DLI_FUNCTIONS, DLI_SERVICES, psbOfParm } from '../ims/dli.mjs';
import { parseJcl } from '../jcl.mjs';
import { constantsReaching } from '../constants.mjs';
import { execReading } from '../exec-reading.mjs';

export { IMS_RULES };

export function scanIms(root, opts = {}) {
  const tree = treeFor(root, opts);
  const files = tree.list().filter(inScope(opts)).filter((f) => isIms(f) || isAssembler(f));
  const stats = { filesScanned: 0, filesUnreadable: 0, dbdFiles: 0, psbFiles: 0 };
  const models = [];
  const unread = {};
  const run = eachWithinMemory(files, (f) => {
    let src;
    try { src = tree.text(f).text; } catch (e) { noteUnread(stats, tree, f, e); return 0; }
    const model = modelOf(src);
    if (!model) return src.length;
    stats.filesScanned++;
    stats[model.kind === 'DBD' ? 'dbdFiles' : 'psbFiles']++;
    const path = relPath(root, f);
    for (const u of model.unread) (unread[u.operation || 'UNREADABLE'] ||= { count: 0, first: `${path}:${u.line}` }).count++;
    models.push({ path, model });
    return src.length;
  }, { label: 'ims', maxBytes: opts.maxSourceBytes ?? Infinity });

  // A statement the reader refused may hold a segment, a field or a PCB the rules never saw.
  if (Object.keys(unread).length) { stats.statementsNotRead = unread; stats.coverageIncomplete = true; }

  // Programs are read only when a PSB could be named for one, and only those that issue DL/I.
  const programs = [];
  const links = [];
  let calls = null;
  if (models.some(({ model }) => model.kind === 'PSB')) {
    const sources = tree.list().filter(inScope(opts)).filter((f) => isProgram(f) || isJcl(f));
    calls = eachWithinMemory(sources, (f) => {
      let src;
      try { src = tree.text(f).text; } catch (e) { noteUnread(stats, tree, f, e); return 0; }
      const path = relPath(root, f);
      if (isJcl(f)) {
        if (!/DFSRRC00/i.test(src)) return src.length;
        let jcl;
        try { jcl = parseJcl(src); } catch { return src.length; }
        for (const step of jcl.steps || []) {
          const l = String(step.pgm || '').toUpperCase() === 'DFSRRC00' ? psbOfParm(step.parm) : null;
          if (l) links.push({ ...l, at: `${path}:${step.line}` });
        }
        return src.length;
      }
      if (!/CBLTDLI|AIBTDLI|EXEC\s+DLI/i.test(src)) return src.length;
      let r;
      try { r = tree.parse(f, src); } catch (e) { noteUnparsed(stats, tree, f, e); return src.length; }
      for (const prog of r.programs) {
        const read = dliCallsOf(prog);
        const id = String(prog.id).toUpperCase();
        programs.push({ id, path, line: prog.line || 1, functions: read.functions });
        for (const psb of read.schedules) links.push({ program: id, psb, at: `${path}, its own scheduling call` });
      }
      return src.length;
    }, { label: 'ims programs', maxBytes: opts.maxSourceBytes ?? Infinity });
    stats.programsWithDli = programs.length;
  }
  const findings = [...checkModels(models), ...checkProcoptAgainstCalls(models, programs, links)];
  return report('ims', { rules: IMS_RULES, findings, stats, run: calls ? bothRuns(run, calls) : run });
}

// The DL/I database functions a program issues itself, null when they cannot all be told: a function
// code no constant decides, a CALL that passes on a PCB or a LINKAGE item, which may hold one, or a
// CICS LINK or XCTL from a program that schedules a PSB, whose target can issue DL/I against it. And
// the PSBs it schedules itself, by EXEC DLI SCHD or a PCB call, where a constant names one.
function dliCallsOf(prog) {
  let functions = new Set();
  const schedules = new Set();
  const ignore = { ignoreCall: (x) => DLI_ROUTINE.test(String(x.name)) };
  const valuesOf = (a) => {
    if (!a) return { values: [], open: true };
    if (a.lit != null) return { values: [String(a.lit)], open: false };
    return a.word ? constantsReaching(prog, a.word, ignore) : { values: [], open: true };
  };
  const named = (k) => (k.open ? null : k.values.map((v) => String(v).trim().toUpperCase()));
  const known = (v) => Object.hasOwn(DLI_FUNCTIONS, v) || DLI_SERVICES.has(v);
  const byName = new Map((prog.items || []).map((it) => [it.name, it]));
  const topOf = (it) => { while (it && it.parent) it = it.parent; return it; };
  // The function code is the first of the two arguments whose constants name one; the PCB or AIB follows it.
  const functionAt = (using) => [0, 1].find((i) => valuesOf(using[i]).values.some((v) => known(String(v).trim().toUpperCase())));
  const pcbs = new Set();
  for (const c of prog.calls || []) {
    if (c.kind !== 'L' || !DLI_ROUTINE.test(String(c.name))) continue;
    const at = functionAt(c.using || []);
    const pcb = at === undefined ? null : (c.using || [])[at + 1];
    if (pcb && pcb.word) pcbs.add(pcb.word);
  }
  const passesOn = (a) => a.word && (pcbs.has(a.word) || (topOf(byName.get(a.word)) || {}).section === 'LINKAGE');
  for (const c of prog.calls || []) {
    if (c.kind !== 'L') { functions = null; continue; }
    if (!DLI_ROUTINE.test(String(c.name))) {
      if ((c.using || []).some(passesOn)) functions = null;
      continue;
    }
    const using = c.using || [];
    const at = functionAt(using);
    const codes = at === undefined ? null : named(valuesOf(using[at]));
    if (!codes || !codes.every(known)) { functions = null; continue; }
    if (codes.includes('PCB')) for (const n of named(valuesOf(using[at + 1])) || []) schedules.add(n);
    if (functions) for (const fn of codes) if (Object.hasOwn(DLI_FUNCTIONS, fn)) functions.add(fn);
  }
  for (const e of prog.execs || []) {
    if (e.kind !== 'DLI') continue;
    const { verb, opts } = execReading(e);
    if (verb === 'SCHD') {
      const tok = (opts.get('PSB') || []).find((t) => t.t === 'word' || t.t === 'lit');
      const k = !tok ? { values: [], open: true } : tok.t === 'lit' ? { values: [tok.v], open: false } : constantsReaching(prog, tok.v, ignore);
      for (const n of named(k) || []) schedules.add(n);
    } else if (functions && Object.hasOwn(DLI_FUNCTIONS, verb)) functions.add(verb);
  }
  const transfers = (prog.execs || []).some((e) => e.kind === 'CICS' && ['LINK', 'XCTL'].includes(execReading(e).verb));
  if (schedules.size && transfers) functions = null;
  return { functions: functions && functions.size ? functions : null, schedules: [...schedules] };
}

function bothRuns(a, b) {
  return {
    skipped: [...a.skipped, ...b.skipped],
    stoppedBy: a.stoppedBy || b.stoppedBy,
    peakHeapBytes: Math.max(a.peakHeapBytes || 0, b.peakHeapBytes || 0) || undefined,
    note: [a.note, b.note].filter(Boolean).join(' ') || undefined,
  };
}
