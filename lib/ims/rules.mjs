// SPDX-License-Identifier: AGPL-3.0-or-later
// Rules over IMS DBD and PSB source alone: what a database PCB lets a program change, SENSEGs naming
// segments their DBD does not define, and what DBDGEN, PSBGEN or ACBGEN refuses.
import { modelOf, concatenatedKey } from './model.mjs';
import { DLI_FUNCTIONS } from './dli.mjs';
import { IBM } from '../kernel/manuals.mjs';

export const IMS_RULES = Object.freeze({
  'ims-pcb-procopt-all': { sev: 'info', evidence: 'context', cwe: 'CWE-250', text: 'A database PCB lets the program get, insert, replace and delete its sensitive segments' },
  'ims-senseg-unknown-segment': {
    sev: 'low', evidence: 'construct', cwe: 'CWE-1076',
    text: "A SENSEG names a segment its PCB's DBD does not define, which ends the program with abend U0914",
    impact: 'The PSB cannot be scheduled against the DBD in this tree: the program abends before it runs, or the DBD here is not the one production uses',
    remedy: 'Correct the SENSEG name, or bring the DBD in the tree up to the one the PSB was generated against',
  },
  'ims-procopt-broader-than-used': {
    sev: 'high', evidence: 'construct', cwe: 'CWE-250',
    text: "A PSB grants a processing option that no DL/I call of the program it is named for uses",
    impact: 'The program can insert, replace or delete segments it never needs to change, so a flaw in it, or input that steers it, can alter the database beyond what its own calls show',
    remedy: "Set the PCB's PROCOPT, or each SENSEG's, to the options the program's calls use, and regenerate the PSB and its ACB",
    references: [IBM.pcbStatement, IBM.sensegStatement],
  },
  'ims-definition-inconsistent': {
    sev: 'low', evidence: 'construct', cwe: 'CWE-1076',
    text: 'A DBD or PSB holds what DBDGEN, PSBGEN or ACBGEN refuses',
    impact: 'The generation step refuses the definition, or the program abends when it is scheduled (U0919 for a KEYLEN too short), so the source in the tree does not describe what runs',
    remedy: 'Correct the statement the message names and regenerate; where production runs a different definition, keep that one in the tree',
  },
});

const OPTION_NAME = { G: 'get', I: 'insert', R: 'replace', D: 'delete' };

// The database options a PROCOPT grants: A is all four, and R and D each imply G.
function granted(procopt) {
  const p = String(procopt || '');
  const out = new Set(p.includes('A') ? ['G', 'I', 'R', 'D'] : [...p].filter((c) => OPTION_NAME[c]));
  if (out.has('R') || out.has('D')) out.add('G');
  return out;
}

// Each PSB a program is known to run with, against the DL/I calls of every such program. A program
// is linked to a PSB by a DFSRRC00 step's PARM or by its own scheduling call, [{ program, psb, at }],
// and a PSB nothing links to is taken as its program's when PSBGEN PSBNAME, or else its file name,
// names one. `programs` holds [{ id, path, line, functions }], functions null when a program's calls
// cannot all be told. A call is not tied to its PCB, so only an option no call of any of the PSB's
// programs uses is reported, on each database PCB that grants it.
export function checkProcoptAgainstCalls(models, programs, links = []) {
  const byId = new Map();
  for (const p of programs) byId.set(p.id.toUpperCase(), byId.has(p.id.toUpperCase()) ? null : p);
  const users = new Map();
  for (const l of links) {
    if (!users.has(l.psb)) users.set(l.psb, new Map());
    users.get(l.psb).set(l.program, l.at);
  }
  const findings = [];
  for (const { path, model } of models) {
    if (model.kind !== 'PSB') continue;
    const fileName = path.split('/').pop().replace(/\.[^.]*$/, '').toUpperCase();
    const name = String(model.name || fileName).toUpperCase();
    let linked = users.get(name);
    if (!linked) {
      const own = byId.has(name) ? name : byId.has(fileName) ? fileName : null;
      if (!own) continue;
      linked = new Map([[own, null]]);
    }
    const progs = [...linked.keys()].map((id) => byId.get(id));
    if (progs.some((p) => !p || !p.functions)) continue;
    const functions = new Set(progs.flatMap((p) => [...p.functions]));
    const used = new Set([...functions].map((fn) => DLI_FUNCTIONS[fn]));
    if (used.has('R') || used.has('D')) used.add('G');
    const who = progs.map((p) => `${p.id} (${p.path}:${p.line}${linked.get(p.id.toUpperCase()) ? `, run with it at ${linked.get(p.id.toUpperCase())}` : ''})`).join(', ');
    for (const pcb of model.pcbs.filter((x) => x.type === 'DB')) {
      const grants = new Set([...granted(pcb.procopt), ...pcb.sensegs.flatMap((s) => [...granted(s.procopt)])]);
      const unused = ['G', 'I', 'R', 'D'].filter((c) => grants.has(c) && !used.has(c));
      if (!unused.length) continue;
      const written = pcb.procoptWritten ? `PROCOPT=${pcb.procoptWritten}` : 'PROCOPT omitted, so A,';
      findings.push({ rule: 'ims-procopt-broader-than-used', path, line: pcb.line, sev: IMS_RULES['ims-procopt-broader-than-used'].sev,
        detail: `PSB ${model.name ?? fileName} PCB ${pcb.name} on DBD ${pcb.dbd}: ${written} grants ${unused.map((c) => OPTION_NAME[c]).join(', ')}, which no DL/I call of ${who} uses; ${progs.length > 1 ? 'they issue' : 'it issues'} ${[...functions].sort().join(', ')}` });
    }
  }
  return findings;
}

// A holds G, I, R and D; R and D each imply G, so I, R and D together are all four.
const changesEverything = (procopt) => !!procopt && (procopt.includes('A') || ['I', 'R', 'D'].every((c) => procopt.includes(c)));

export const checkIms = (files) => checkModels(files.map(({ path, text }) => ({ path, model: modelOf(text) })).filter((m) => m.model));

// Findings over models already read, [{ path, model }], DBDs and PSBs together so a PCB can be
// checked against its DBD.
export function checkModels(models) {
  const dbds = new Map();
  for (const { model } of models.filter((m) => m.model.kind === 'DBD' && m.model.name)) {
    dbds.set(model.name, dbds.has(model.name) ? null : model);
  }

  const findings = [];
  for (const { path, model } of models) {
    const at = (rule, line, detail) => findings.push({ rule, path, line, sev: IMS_RULES[rule].sev, detail });
    for (const p of model.problems) at('ims-definition-inconsistent', p.line, `${p.message}: ${p.text}`);
    if (model.kind !== 'PSB') continue;
    for (const pcb of model.pcbs.filter((x) => x.type === 'DB')) {
      const where = `PSB ${model.name ?? '(no PSBGEN)'} PCB ${pcb.name} on DBD ${pcb.dbd}`;
      procoptAll(pcb, where, at);
      const dbd = dbds.get(pcb.dbd);
      if (dbd) againstDbd(pcb, dbd, where, at);
    }
  }
  return findings;
}

function procoptAll(pcb, where, at) {
  const full = pcb.sensegs.filter((s) => changesEverything(s.procopt));
  if (pcb.sensegs.length ? !full.length : !changesEverything(pcb.procopt)) return;
  const written = pcb.procoptWritten ? `PROCOPT=${pcb.procoptWritten}` : 'PROCOPT omitted, so A,';
  const segments = pcb.sensegs.length ? `segments ${full.map((s) => s.name).join(', ')}` : 'every sensitive segment';
  at('ims-pcb-procopt-all', pcb.line, `${where}: ${written} gives get, insert, replace and delete on ${segments}`);
}

// Checks that need the PCB's DBD: SENSEGs it does not define (abend U0914), and a KEYLEN shorter than
// the longest concatenated key (DFS0919I at ACBGEN). A secondary processing sequence or a logical DBD
// builds keys from other segments, so KEYLEN is checked only on the physical path of a physical DBD.
function againstDbd(pcb, dbd, where, at) {
  const defined = new Set(dbd.segments.map((s) => s.name));
  if (dbd.complete) {
    for (const s of pcb.sensegs.filter((x) => !defined.has(x.name))) at('ims-senseg-unknown-segment', s.line, `${where}: SENSEG ${s.name} is not a segment of DBD ${dbd.name}`);
  }
  if (pcb.keylen == null || pcb.procseq || dbd.access?.type === 'LOGICAL') return;
  let longest = null;
  for (const s of pcb.sensegs) {
    const key = concatenatedKey(dbd, s.name);
    if (key != null && (!longest || key > longest.key)) longest = { key, name: s.name };
  }
  if (longest && longest.key > pcb.keylen) {
    at('ims-definition-inconsistent', pcb.line, `DFS0919I: ${where} has KEYLEN=${pcb.keylen}, shorter than the ${longest.key}-byte concatenated key of ${longest.name}`);
  }
}
