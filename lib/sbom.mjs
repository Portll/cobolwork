// SPDX-License-Identifier: AGPL-3.0-or-later
// A CycloneDX 1.6 bill of materials for a COBOL estate (docs/spec/evidence.md §11): every source
// file by digest, what each program copies and calls, what each job runs, and the platforms a
// program uses, without versions the source does not state.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname, extname, resolve, sep } from 'node:path';
import { parseSource, detectFormat } from './parser.mjs';
import { parseJcl } from './jcl.mjs';
import { optionCards } from './options.mjs';
import { inScope, isBms, isCopybook, isJcl, isProgram, readSource, relPath } from './sources.mjs';
import { TOOL_VERSION } from './version.mjs';
import { revisionOf } from './revision.mjs';
import { treeFor } from './kernel/source-tree.mjs';

// The namespace of cobolwork's version 5 UUIDs (RFC 4122 §4.3), fixed so a serial number repeats.
const NAMESPACE = Buffer.from('6f1d2b8e5c3a4e7f9a0b1c2d3e4f5a6b', 'hex');

function uuidv5(name) {
  const h = createHash('sha1').update(NAMESPACE).update(name, 'utf8').digest().subarray(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// A routine a platform provides, which its platform component already stands for.
const platformRoutine = (n) => n === 'CBLTDLI' || n === 'AIBTDLI' || /^MQ[A-Z0-9]{2,}$/.test(n) || /^CEE[A-Z0-9]+$/.test(n);

// IBM programs a job step runs rather than one the estate builds.
const SYSTEM_PROGRAMS = new Set(['ADRDSSU', 'AMASPZAP', 'ASMA90', 'BPXBATCH', 'DFHCSDUP', 'DFHEAP1$', 'DFHECP1$', 'DFSRRC00', 'DFSORT', 'DSNTEP2', 'DSNTEP4',
  'DSNHPC', 'DSNTIAD', 'DSNTIAUL', 'DSNUTILB', 'FTP', 'HEWL', 'IEWBLINK', 'IEWL', 'ICEGENER', 'ICEMAN', 'ICETOOL', 'IDCAMS', 'IEBCOMPR',
  'IEBCOPY', 'IEBDG', 'IEBGENER', 'IEBUPDTE', 'IEFBR14', 'IEHLIST', 'IEHPROGM', 'IGYCRCTL', 'IKJEFT01', 'IKJEFT1A', 'IKJEFT1B',
  'SDSF', 'SORT']);
const TSO_BATCH = new Set(['IKJEFT01', 'IKJEFT1A', 'IKJEFT1B']);
// The IMS region types whose PARM names the application program second: PARM='BMP,PGM,PSB'.
const IMS_REGIONS = new Set(['BMP', 'DLI', 'DBB', 'IFP', 'JBP', 'JMP']);

// What a step runs beyond its PGM: the program a TSO batch step's DSN RUN names, or an IMS region's
// application program.
function programsRunBy(step) {
  const pgm = String(step.pgm || '').toUpperCase();
  const out = [];
  if (TSO_BATCH.has(pgm)) {
    for (const dd of step.dds || []) {
      if (dd.name !== 'SYSTSIN') continue;
      const text = (dd.inStream || []).map((l) => l.text).join(' ');
      for (const m of text.matchAll(/\bRUN\s+PROG(?:RAM)?\s*\(\s*([A-Z0-9#@$]{1,8})\s*\)/gi)) out.push(m[1].toUpperCase());
    }
  } else if (pgm === 'DFSRRC00' && step.parm) {
    const [region, app] = String(step.parm).replace(/^['(]|[')]$/g, '').split(',').map((x) => x.trim().toUpperCase());
    if (IMS_REGIONS.has(region) && /^[A-Z0-9#@$]{1,8}$/.test(app || '')) out.push(app);
  }
  return out;
}

// The literal operand of a CICS option, `PROGRAM('X')`; the field's name where a field is given.
function cicsOperand(toks, option) {
  const at = toks.findIndex((t, i) => t.t === 'word' && t.u === option && toks[i + 1] && toks[i + 1].v === '(');
  if (at < 0) return null;
  const inner = [];
  for (let i = at + 2, depth = 1; i < toks.length; i++) {
    if (toks[i].v === '(') depth++;
    else if (toks[i].v === ')' && --depth === 0) break;
    inner.push(toks[i]);
  }
  if (inner.length === 1 && inner[0].t === 'lit') return { literal: String(inner[0].v).trim().toUpperCase() };
  return inner.length ? { field: inner.map((t) => t.v).join('') } : null;
}

function platformsOf(src, calls) {
  const s = new Set();
  if (/EXEC\s+CICS\b/i.test(src)) s.add('CICS');
  if (/EXEC\s+SQL\b/i.test(src)) s.add('Db2');
  if (/EXEC\s+DLI\b/i.test(src)) s.add('IMS');
  for (const c of calls) {
    if (c.kind !== 'L') continue;
    const n = String(c.name).toUpperCase();
    if (n === 'CBLTDLI' || n === 'AIBTDLI') s.add('IMS');
    if (/^MQ[A-Z0-9]{2,}$/.test(n)) s.add('MQ');
    if (/^CEE[A-Z0-9]+$/.test(n)) s.add('Language Environment');
  }
  return [...s];
}

function kindOf(file, src) {
  if (isProgram(file)) return /PROCEDURE\s+DIVISION|PROGRAM-ID/i.test(src) ? 'program' : 'copybook';
  if (isCopybook(file)) return 'copybook';
  if (isJcl(file)) return /^\/\/\S*\s+PROC\b/m.test(src) && !/^\/\/\S*\s+JOB\b/m.test(src) ? 'proc' : 'jcl';
  if (isBms(file)) return 'bms';
  const ext = extname(file).toLowerCase();
  if (ext === '.csd') return 'csd';
  if (ext === '.ddl' || ext === '.sql') return 'ddl';
  return null;
}

export function sbom(root, opts = {}) {
  const tree = treeFor(root, opts);
  const idx = tree.index;
  const top = resolve(root);
  const within = (p) => resolve(p).startsWith(top + sep);
  // A member outside the tree is named by its file name, and by its directory's digest as well where
  // another library holds a member of the same name.
  const copylibRefs = new Map();
  const claimed = new Map();
  const refOf = (p) => {
    if (within(p)) return relPath(root, p);
    if (!copylibRefs.has(p)) {
      let ref = `copylib:${basename(p)}`;
      if (claimed.has(ref) && claimed.get(ref) !== p) ref = `copylib:${basename(p)}#${sha256(dirname(resolve(p))).slice(0, 8)}`;
      claimed.set(ref, p);
      copylibRefs.set(p, ref);
    }
    return copylibRefs.get(p);
  };

  const entries = [];
  const programIds = new Map();
  const mapsets = new Map();
  const procIds = new Map();
  for (const f of tree.list().filter(inScope(opts)).sort()) {
    let bytes;
    let src = null;
    try { bytes = readFileSync(f); } catch { continue; }
    try { src = readSource(f).text; } catch { /* its bytes are listed; its text could not be decoded */ }
    const kind = src === null ? (isProgram(f) ? 'program' : isCopybook(f) ? 'copybook' : isJcl(f) ? 'jcl' : isBms(f) ? 'bms' : null) : kindOf(f, src);
    if (!kind) continue;
    const entry = { file: f, ref: relPath(root, f), bytes, src: src ?? '', kind, ...(src === null ? { unparsed: true, undecodable: true } : {}) };
    if (src === null) { entries.push(entry); continue; }
    if (kind === 'program') {
      try {
        const res = parseSource(src, f, { format: 'auto', includeDirs: idx.copyDirs, fileIndex: idx.index, mainDir: dirname(f), copyFormat: 'auto', systemDirs: opts.systemDirs || [] });
        entry.programs = res.programs;
        entry.copies = res.copies;
        for (const p of res.programs) {
          if (!p.id) continue;
          const id = String(p.id).toUpperCase();
          if (!programIds.has(id)) programIds.set(id, []);
          if (!programIds.get(id).includes(entry.ref)) programIds.get(id).push(entry.ref);
        }
      } catch { entry.unparsed = true; }
    } else if (kind === 'jcl' || kind === 'proc') {
      try { entry.jcl = parseJcl(src, f); } catch { entry.unparsed = true; }
      if (kind === 'proc') {
        const m = /^\/\/([A-Z0-9#@$]{1,8})\s+PROC\b/im.exec(src);
        procIds.set((m ? m[1] : basename(f, extname(f))).toUpperCase(), entry.ref);
      }
    } else if (kind === 'bms') {
      const m = /^([A-Z0-9#@$]{1,8})\s+DFHMSD\b/im.exec(src);
      mapsets.set((m ? m[1] : basename(f, extname(f))).toUpperCase(), entry.ref);
    }
    entries.push(entry);
  }

  const components = new Map();
  const dependencies = new Map();
  const depend = (from, to) => { if (!dependencies.has(from)) dependencies.set(from, new Set()); dependencies.get(from).add(to); };
  // A program the estate does not hold is a component of its own, so an edge to it is not lost.
  // A PROGRAM-ID two files hold is an edge to each: which one a run loads is the load library's order.
  const runs = (from, name) => {
    const targets = programIds.get(name);
    if (targets) { for (const t of targets) if (t !== from) depend(from, t); return; }
    if (platformRoutine(name)) return;
    const ref = `program:${name}`;
    depend(from, ref);
    if (!components.has(ref)) {
      components.set(ref, { 'bom-ref': ref, type: 'application', name, properties: [{ name: 'cobolwork:kind', value: SYSTEM_PROGRAMS.has(name) ? 'system-program' : 'external-program' }] });
    }
  };

  for (const e of entries) {
    const properties = [{ name: 'cobolwork:kind', value: e.kind }];
    if (e.unparsed) properties.push({ name: 'cobolwork:unparsed', value: 'true' });
    if (e.undecodable) properties.push({ name: 'cobolwork:undecodable', value: 'true' });
    if (e.kind === 'program' && e.programs && e.programs.length) {
      const ids = e.programs.map((p) => p.id).filter(Boolean);
      if (ids.length) properties.push({ name: 'cobolwork:program-id', value: ids.join(',') });
      const twins = [...new Set(ids.flatMap((id) => (programIds.get(String(id).toUpperCase()) || []).filter((r) => r !== e.ref)))].sort(order);
      if (twins.length) properties.push({ name: 'cobolwork:program-id-also-in', value: twins.join(',') });
      properties.push({ name: 'cobolwork:format', value: detectFormat(e.src) });
      const options = optionCards(e.src).flatMap((c) => c.options);
      if (options.length) properties.push({ name: 'cobolwork:options', value: options.join(' ') });
      for (const c of e.copies || []) {
        if (c.status !== 'resolved' || !c.path) continue;
        const ref = refOf(c.path);
        depend(e.ref, ref);
        if (!within(c.path) && !components.has(ref)) {
          let b = null;
          try { b = readFileSync(c.path); } catch { /* read at parse time, gone since */ }
          components.set(ref, { 'bom-ref': ref, type: 'file', name: ref, ...(b ? { hashes: [{ alg: 'SHA-256', content: sha256(b) }] } : {}), properties: [{ name: 'cobolwork:kind', value: 'copybook' }, { name: 'cobolwork:source', value: 'copy library' }, ...(b ? [] : [{ name: 'cobolwork:unread', value: 'true' }])] });
        }
      }
      const calls = e.programs.flatMap((p) => p.calls || []);
      const unresolved = new Set();
      for (const c of calls) {
        if (c.kind !== 'L') { unresolved.add(String(c.name)); continue; }
        runs(e.ref, String(c.name).toUpperCase());
      }
      for (const x of e.programs.flatMap((p) => p.execs || [])) {
        if (x.kind !== 'CICS') continue;
        const words = x.toks.filter((t) => t.t === 'word').map((t) => t.u);
        if (words[0] === 'LINK' || words[0] === 'XCTL') {
          const op = cicsOperand(x.toks, 'PROGRAM');
          if (op && op.literal) runs(e.ref, op.literal); else if (op) unresolved.add(op.field);
        } else if ((words[0] === 'SEND' || words[0] === 'RECEIVE') && words[1] === 'MAP') {
          const op = cicsOperand(x.toks, 'MAPSET') || cicsOperand(x.toks, 'MAP');
          const target = op && op.literal ? mapsets.get(op.literal) : null;
          if (target) depend(e.ref, target);
        }
      }
      if (unresolved.size) properties.push({ name: 'cobolwork:unresolved-call', value: [...unresolved].sort(order).join(',') });
      for (const p of platformsOf(e.src, calls)) {
        const ref = `platform:${p}`;
        depend(e.ref, ref);
        if (!components.has(ref)) components.set(ref, { 'bom-ref': ref, type: 'platform', name: p });
      }
    }
    if (e.jcl) {
      const inStream = new Set((e.jcl.procs || []).map((p) => String(p.name || '').toUpperCase()));
      const missing = new Set();
      for (const step of e.jcl.steps || []) {
        if (step.pgm && /^[A-Z0-9#@$]{1,8}$/i.test(step.pgm)) runs(e.ref, String(step.pgm).toUpperCase());
        for (const name of programsRunBy(step)) runs(e.ref, name);
        if (!step.proc) continue;
        const name = String(step.proc).toUpperCase();
        const proc = procIds.get(name);
        if (proc) { if (proc !== e.ref) depend(e.ref, proc); } else if (!inStream.has(name)) missing.add(name);
      }
      if (missing.size) properties.push({ name: 'cobolwork:unresolved-proc', value: [...missing].sort(order).join(',') });
    }
    components.set(e.ref, { 'bom-ref': e.ref, type: 'file', name: e.ref, hashes: [{ alg: 'SHA-256', content: sha256(e.bytes) }], properties });
  }

  const list = [...components.values()].sort((a, b) => order(a['bom-ref'], b['bom-ref']));
  const digests = list.filter((c) => c.hashes).map((c) => c.hashes[0].content).sort(order);
  const name = opts.name || basename(top);
  let revision = null;
  try { revision = revisionOf(top); } catch { /* not a repository, or git is missing */ }
  const epoch = process.env.SOURCE_DATE_EPOCH;
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: `urn:uuid:${uuidv5(`${name}\n${digests.join('\n')}`)}`,
    version: 1,
    metadata: {
      ...(epoch && /^\d+$/.test(epoch) ? { timestamp: new Date(Number(epoch) * 1000).toISOString() } : {}),
      tools: { components: [{ type: 'application', name: 'cobolwork', version: TOOL_VERSION }] },
      component: {
        'bom-ref': `estate:${name}`, type: 'application', name,
        ...(revision ? { version: revision.commit, properties: [{ name: 'cobolwork:dirty', value: String(revision.dirty) }] } : {}),
      },
    },
    components: list,
    dependencies: [...dependencies.entries()].sort(([a], [b]) => order(a, b)).map(([ref, set]) => ({ ref, dependsOn: [...set].sort(order) })),
  };
}
