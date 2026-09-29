// Proposes a draft cobolwork.site.json by reading the estate's own JCL and CSD.
//
//   node diag/propose-site.mjs <path> [--write]
//
// The recon rules cannot run until someone says what production means here, and asking a customer
// to write that from a blank page is how onboarding stalls. This reads what is actually in the
// tree and proposes an answer for them to correct, which is a far shorter conversation.
//
// It proposes. It does not decide. Every qualifier it suggests is a guess from a naming
// convention, and the file it writes says so at the top, because a configuration nobody read is
// how a rule set starts reporting the entire estate.
//
// The internal-reader rules and the severity of the bounds rules need facts of the same kind: the
// DDs a CICS region sends to the internal reader, the transient-data queues the CSD writes to
// those DDs, and the options the estate compiles with. Those are read from jobs and definitions
// rather than guessed, and each is printed with the job, step or definition it came from, because
// the jobs in a repository need not be the ones production runs.
//
// The privilege facts are a third kind, and this file proposes none of them. An APF list lives in a
// running system's PROGxx member, and which datasets are restricted and which users a job may run
// as live in RACF; no repository holds any of the three. They are printed as candidates with where
// each was seen, and written to _toClassify with the arrays left empty, because a guess there turns
// three checks from silent into wrong.
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildFileIndex } from '../lib/parser.mjs';
import { isJcl, readSource, relPath } from '../lib/sources.mjs';
import { parseJcl } from '../lib/jcl.mjs';
import { parseCsd, ddOfQueue } from '../lib/csd.mjs';
import { SITE_FILE } from '../lib/site.mjs';

const root = process.argv[2];
const write = process.argv.includes('--write');
if (!root || !existsSync(root)) {
  console.error('usage: node diag/propose-site.mjs <path> [--write]');
  process.exit(2);
}

// Conventions that usually mean production, and the ones that usually do not. Both lists are
// starting points for a conversation, not knowledge about anyone's estate.
const LOOKS_PRODUCTION = /^(PROD|PRD|P|LIVE|PRODUCTION)$/i;
const LOOKS_OTHERWISE = /^(TEST|TST|T|DEV|D|QA|UAT|SIT|SANDBOX|SBX|TRAIN|TRN)$/i;
const NONPROD_DIR = /(^|\/)(test|tests|dev|development|qa|uat|sit|sandbox|training)(\/|$)/i;
const PROD_DIR = /(^|\/)(prod|production|live)(\/|$)/i;

const idx = buildFileIndex(root);
const files = [...idx.index.values()].sort();
const jcl = files.filter(isJcl);

const qualifiers = new Map();     // first component of every DSN, and how often
const secondLevel = new Map();    // second component, where the first is a constant like PAYR
const paths = new Set();
let steps = 0;

// Gathered as the jobs are read and judged once every procedure in the tree is known, because a
// job may run a procedure whose file sorts after its own.
const procs = new Map();          // procedure name -> [{ name, pgm }] of its steps
const readerDds = [];
const compileSteps = [];
const overrides = [];             // a PARM= or PARM.step= on an EXEC of a procedure
const csdJobInput = [];

// The privilege facts are different in kind from every other fact this file proposes, and the
// difference is why nothing below proposes a value for them. Whether a library is APF-authorised
// lives in a running system's PROGxx member; whether a dataset is restricted and which users a job
// may run as live in RACF. A repository cannot show any of the three, so proposing one would be
// inventing it. What a repository CAN do is hand over the candidates, so the person answering ticks
// a list instead of facing a blank page - which is what this whole file exists to avoid.
const libraries = new Map();      // a DSN a step loads from -> where it was seen
const jobUsers = new Map();       // a USER= on a JOB card -> where
const securityOutputs = new Map(); // a DSN a security utility writes -> where
const SECURITY_UTILITY = /^(IRRDBU00|IRRUT200|IRRUT400|IRRXUTIL|ICHUT400)$/;
const note = (m, k, where) => { if (!m.has(k)) m.set(k, []); m.get(k).push(where); };

const stepAt = (path, line, job, step) => {
  const owner = step.inProc ? `procedure ${step.inProc}` : `job ${job.jobs.find((j) => j.steps.includes(step))?.name || '(unnamed)'}`;
  return `${path}:${line} (${owner}, step ${step.name || '(unnamed)'})`;
};

for (const f of jcl) {
  let src;
  try { src = readSource(f).text; } catch { continue; }
  let job;
  try { job = parseJcl(src, f); } catch { continue; }
  const path = relPath(root, f);
  paths.add(path);
  steps += job.steps.length;
  for (const dd of job.dds) {
    if (!dd.dsn || dd.temporary) continue;
    const parts = dd.dsn.split('.');
    if (parts.length < 2) continue;
    const bump = (m, k) => m.set(k.toUpperCase(), (m.get(k.toUpperCase()) || 0) + 1);
    bump(qualifiers, parts[0]);
    bump(secondLevel, parts[1]);
  }
  for (const p of job.procs) {
    if (p.name && !procs.has(p.name.toUpperCase())) procs.set(p.name.toUpperCase(), p.steps.map((s) => ({ name: (s.name || '').toUpperCase(), pgm: (s.pgm || '').toUpperCase() })));
  }
  for (const j of job.jobs) {
    const user = j.keywords && j.keywords.get('USER');
    if (user) note(jobUsers, String(user).toUpperCase(), `${path}, job ${j.name || '(unnamed)'}`);
  }
  for (const step of job.steps) {
    const pgm = (step.pgm || '').toUpperCase();
    const proc = step.proc ? step.proc.toUpperCase() : null;
    if (pgm === 'IGYCRCTL') compileSteps.push({ at: stepAt(path, step.line, job, step), parm: step.keywords.get('PARM') ?? null });
    // A DFHCSDUP step's input is CSD definitions, kept in a job rather than an extract.
    if (pgm === 'DFHCSDUP') {
      for (const dd of step.dds) {
        if ((dd.name || '').toUpperCase() !== 'SYSIN' || !dd.inStream) continue;
        const lines = dd.inStream;
        csdJobInput.push({ text: lines.map((l) => l.text).join('\n'), at: (n) => `${path}:${lines[n - 1]?.line ?? dd.line}` });
      }
    }
    if (proc) {
      for (const [k, v] of step.keywords) {
        const m = /^PARM(?:\.(\S+))?$/.exec(k);
        if (m) overrides.push({ at: stepAt(path, step.line, job, step), proc, procStep: m[1] || null, parm: v });
      }
    }
    for (const dd of step.dds) {
      const name = (dd.name || '').toUpperCase().split('.').pop();
      if (dd.dsn && !dd.temporary && /^(STEPLIB|JOBLIB)$/.test(name)) {
        note(libraries, dd.dsn.toUpperCase(), stepAt(path, dd.line, job, step));
      }
      // What a security utility touches is the one candidate a job states outright - the database
      // it reads is as restricted as the unload it writes.
      if (dd.dsn && !dd.temporary && SECURITY_UTILITY.test(pgm) && !/^(STEPLIB|JOBLIB|SYSPRINT|SYSIN|SYSUT1)$/.test(name)) {
        note(securityOutputs, dd.dsn.toUpperCase(), `${stepAt(path, dd.line, job, step)} running ${pgm}`);
      }
    }
    for (const dd of step.dds) {
      if (!dd.name || !dd.sysout || !/\bINTRDR\b/i.test(dd.sysout)) continue;
      // //CICS.INRDR overrides or adds DD INRDR in step CICS of the procedure the step runs.
      const [procStep, name] = dd.name.includes('.') ? dd.name.toUpperCase().split('.') : [null, dd.name.toUpperCase()];
      readerDds.push({ dd: name, at: stepAt(path, dd.line, job, step), pgm, proc, procStep });
    }
  }
}

// What a step runs, one procedure deep where the tree defines the procedure: a region is as often
// an EXEC of a startup procedure as a PGM=DFHSIP. A DD with no step qualifier on an EXEC of a
// procedure belongs to its first step.
function runs(pgm, proc, procStep) {
  if (pgm) return { pgm, how: `runs ${pgm}` };
  const body = proc && procs.get(proc);
  const target = body && (procStep ? body.find((s) => s.name === procStep) : body[0]);
  if (!target) return { pgm: null, how: proc ? `runs procedure ${proc}, which this tree does not define` : 'runs nothing this reader could name' };
  return { pgm: target.pgm || null, how: `runs procedure ${proc}, whose step ${target.name || '(unnamed)'} runs ${target.pgm || 'another procedure'}` };
}

// Extracts first, then job input, and the first definition of a queue wins: the order
// lib/dataflow.mjs reads them in, so the proposal describes the queues the rules will see.
const csdFiles = [];
for (const f of files.filter((p) => /\.csd$/i.test(p))) {
  let text;
  try { text = readSource(f).text; } catch { continue; }
  csdFiles.push({ text, at: (n) => `${relPath(root, f)}:${n}` });
}
const csd = { tdqueues: new Map(), transactions: new Map() };
const definedAt = new Map();
for (const src of [...csdFiles, ...csdJobInput]) {
  for (const [q, def] of parseCsd(src.text).tdqueues) {
    if (csd.tdqueues.has(q)) continue;
    csd.tdqueues.set(q, def);
    definedAt.set(q, src.at(def.line));
  }
}

// Only a region's DD is a declaration the rules need: a batch job's is read from the job itself.
for (const d of readerDds) {
  const r = runs(d.pgm, d.proc, d.procStep);
  d.region = r.pgm === 'DFHSIP';
  d.how = r.how;
}
const proposedDds = [...new Set(readerDds.filter((d) => d.region).map((d) => d.dd))];
const batchDds = readerDds.filter((d) => !d.region && !proposedDds.includes(d.dd));
const proposedQueues = [...csd.tdqueues.keys()].filter((q) => proposedDds.includes(ddOfQueue(csd, q))).sort();
const otherQueues = [...csd.tdqueues.keys()].filter((q) => ddOfQueue(csd, q) && !proposedQueues.includes(q)).sort();
const queueWhy = (q) => {
  const def = csd.tdqueues.get(q);
  const via = def.type === 'INDIRECT' ? `TYPE(INDIRECT) INDIRECTNAME(${def.indirect}), which is ` : 'TYPE(EXTRA) ';
  return `${definedAt.get(q)}: ${via}DDNAME(${ddOfQueue(csd, q)})`;
};

// A procedure's compile step is counted once, where it is defined. A job running the procedure
// states options of its own only when it overrides that step's PARM. IBM's compile procedures,
// IGYWC and its relatives, are rarely in the tree and name their compile step COBOL.
for (const o of overrides) {
  const compiles = procs.has(o.proc) ? runs(null, o.proc, o.procStep).pgm === 'IGYCRCTL'
    : (o.procStep ? ['COBOL', 'COB'].includes(o.procStep) : /^IGYW/.test(o.proc));
  if (compiles) compileSteps.push({ at: `${o.at}, PARM${o.procStep ? `.${o.procStep}` : ''} of ${o.proc}`, parm: o.parm });
}

// PARM='SSRANGE,NUMPROC(PFD)' or PARM=(SSRANGE,'NUMPROC(PFD)'), with commas or blanks between
// options. Within one step the last word on an option is the one the compiler takes. An option
// built from a symbolic this tree gives no value cannot be read, and is set aside and named.
function optionsOf(parm) {
  let s = String(parm).replace(/''/g, '\u0000').replace(/'/g, '').replace(/\u0000/g, "'").trim().toUpperCase();
  const wraps = (t) => {
    let depth = 0;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === '(') depth++;
      else if (t[i] === ')' && --depth === 0 && i < t.length - 1) return false;
    }
    return true;
  };
  if (s.startsWith('(') && s.endsWith(')') && wraps(s)) s = s.slice(1, -1);
  const words = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if ((c === ',' || c === ' ') && depth === 0) { if (cur) words.push(cur); cur = ''; continue; }
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    cur += c;
  }
  if (cur) words.push(cur);
  const last = new Map();
  for (const w of words.filter((x) => !x.includes('&'))) {
    const name = w.replace(/\(.*$/, '').replace(/^NO(?=.)/, '');
    last.delete(name);
    last.set(name, w);
  }
  return { options: [...last.values()], unresolved: words.filter((x) => x.includes('&')) };
}
const stated = new Map();
for (const c of compileSteps) {
  Object.assign(c, c.parm === null ? { options: [], unresolved: [] } : optionsOf(c.parm));
  for (const o of c.options) {
    if (!stated.has(o)) stated.set(o, []);
    stated.get(o).push(c.at);
  }
}
// Only what every compile step states. Where they disagree the disagreement is listed rather than
// settled: which step builds production is a fact about the estate, not about the JCL.
const proposedOptions = [...stated].filter(([, at]) => at.length === compileSteps.length).map(([o]) => o);
const disputed = [...stated].filter(([, at]) => at.length < compileSteps.length);

const rank = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
// A production marker can be the first component or the second: PROD.PAYROLL.MASTER and
// PAYR.PROD.MASTER are both ordinary, and a proposal that only looked at one would miss half.
const proposed = [
  ...rank(qualifiers).filter(([q]) => LOOKS_PRODUCTION.test(q)).map(([q]) => q),
  ...rank(secondLevel).filter(([q]) => LOOKS_PRODUCTION.test(q)).map(([q]) => q),
];
const clearlyNot = [
  ...rank(qualifiers).filter(([q]) => LOOKS_OTHERWISE.test(q)).map(([q, n]) => `${q} (${n})`),
  ...rank(secondLevel).filter(([q]) => LOOKS_OTHERWISE.test(q)).map(([q, n]) => `${q} (${n})`),
];

const nonProd = [...paths].filter((p) => NONPROD_DIR.test(p));
const prod = [...paths].filter((p) => PROD_DIR.test(p));
const undecided = [...paths].filter((p) => !NONPROD_DIR.test(p) && !PROD_DIR.test(p));

console.log(`read ${jcl.length} JCL files, ${steps} steps`);
console.log(`distinct first-level qualifiers: ${qualifiers.size}, second-level: ${secondLevel.size}`);
console.log(`\nmost common first-level qualifiers:`);
for (const [q, n] of rank(qualifiers).slice(0, 12)) console.log(`  ${String(n).padStart(5)}  ${q}`);
console.log(`\nproposed as production: ${proposed.length ? proposed.join(', ') : '(none matched a production naming convention)'}`);
if (clearlyNot.length) console.log(`clearly not production: ${clearlyNot.slice(0, 8).join(', ')}`);
console.log(`\njob paths: ${prod.length} look production, ${nonProd.length} look non-production, ${undecided.length} undecided`);
if (undecided.length) {
  console.log('undecided paths are left alone by the rules - classify them or they are never checked:');
  for (const p of undecided.slice(0, 8)) console.log(`  ${p}`);
  if (undecided.length > 8) console.log(`  ... and ${undecided.length - 8} more`);
}

console.log(`\nDD statements sent to SYSOUT=(class,INTRDR): ${readerDds.length}`);
for (const d of readerDds) console.log(`  ${d.dd.padEnd(8)}  ${d.at}, which ${d.how}${d.region ? ': a CICS region' : ''}`);
console.log(`proposed as internalReaderDds: ${proposedDds.length ? proposedDds.join(', ') : '(none: no step running DFHSIP sends a DD there)'}`);
if (batchDds.length) console.log('a batch job\'s DD is not proposed: the flow rules read that job directly and need no declaration');
console.log(`\ntransient-data queues defined: ${csd.tdqueues.size}, from ${csdFiles.length} CSD extract(s) and ${csdJobInput.length} DFHCSDUP job input(s)`);
for (const q of proposedQueues) console.log(`  ${q.padEnd(8)}  ${queueWhy(q)}`);
console.log(`proposed as internalReaderQueues: ${proposedQueues.length ? proposedQueues.join(', ') : '(none)'}`);
if (otherQueues.length) {
  console.log('extrapartition queues whose DD nothing here sends to the internal reader - the region\'s JCL decides whether one of these does:');
  for (const q of otherQueues.slice(0, 12)) console.log(`  ${q.padEnd(8)}  DD ${ddOfQueue(csd, q)}, ${definedAt.get(q)}`);
  if (otherQueues.length > 12) console.log(`  ... and ${otherQueues.length - 12} more`);
}
console.log(`\ncompile steps: ${compileSteps.length}`);
for (const c of compileSteps) {
  console.log(`  ${c.at}: ${c.options.length ? c.options.join(' ') : '(states no options)'}${c.unresolved.length ? `; ${c.unresolved.join(' ')} has no value in this tree` : ''}`);
}
console.log(`proposed as compilerOptions, stated by every compile step: ${proposedOptions.length ? proposedOptions.join(', ') : '(none)'}`);
if (disputed.length) {
  console.log('not proposed, because the compile steps disagree:');
  for (const [o, at] of disputed) console.log(`  ${o.padEnd(14)}  ${at.length} of ${compileSteps.length}`);
}

// Candidates, never proposals. Each of the three asks a question only a running system can answer,
// so the lists below are what to ask about, and the arrays in the draft stay empty on purpose: an
// APF list this file guessed would turn three checks from silent into wrong.
const topN = (m, n) => [...m.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, n);
console.log(`\nlibraries a step loads from: ${libraries.size}. Which of these are APF-authorised is`);
console.log('a fact about the running system, so none is proposed - mark the authorised ones as apfLibraries:');
for (const [dsn, at] of topN(libraries, 12)) console.log(`  ${dsn.padEnd(44)} ${at.length} step(s), first ${at[0]}`);
if (libraries.size > 12) console.log(`  ... and ${libraries.size - 12} more`);

console.log(`\nusers a job names on its JOB card: ${jobUsers.size}. Which may legitimately be run as is a`);
console.log('RACF fact - mark the permitted ones as surrogateUsers:');
for (const [u, at] of topN(jobUsers, 12)) console.log(`  ${u.padEnd(12)} ${at.length} job(s), first ${at[0]}`);

console.log(`\ndatasets a security utility reads or writes: ${securityOutputs.size}. These are the security`);
console.log('database and its unload, so the prefix each sits under almost certainly belongs in restrictedDatasets:');
for (const [dsn, at] of topN(securityOutputs, 12)) console.log(`  ${dsn.padEnd(44)} ${at[0]}`);
if (!securityOutputs.size) console.log('  (none: no job here runs one)');

const draft = {
  _comment: 'PROPOSED, NOT CONFIRMED. Generated by diag/propose-site.mjs from this tree\'s own JCL and CSD. The production qualifiers are guesses from a naming convention. The internal-reader DDs and queues and the compiler options were read from the jobs and definitions listed under _from, which need not be the ones production runs. Correct it before relying on any finding it enables: an entry listed here wrongly makes the rules noisy, and one omitted makes them silent.',
  _generated: new Date().toISOString().slice(0, 10),
  productionQualifiers: [...new Set(proposed)],
  productionJobPaths: prod,
  nonProductionJobPaths: nonProd,
  systemNames: [],
  internalReaderDds: proposedDds,
  internalReaderQueues: proposedQueues,
  compilerOptions: proposedOptions,
  // Left empty deliberately. See _toClassify: a guess here makes three checks wrong rather than
  // quiet, and the checks are built to stay quiet until a person answers.
  apfLibraries: [],
  restrictedDatasets: [],
  surrogateUsers: [],
  _undecidedPaths: undecided,
  _toClassify: {
    apfLibraries: Object.fromEntries(topN(libraries, 40).map(([dsn, at]) => [dsn, `loaded by ${at.length} step(s), first ${at[0]}`])),
    surrogateUsers: Object.fromEntries([...jobUsers].map(([u, at]) => [u, `named by ${at.length} job(s), first ${at[0]}`])),
    restrictedDatasets: Object.fromEntries([...securityOutputs].map(([dsn, at]) => [dsn, at[0]])),
  },
  _from: {
    internalReaderDds: Object.fromEntries(proposedDds.map((dd) => [dd, readerDds.filter((d) => d.region && d.dd === dd).map((d) => `${d.at}, which ${d.how}`)])),
    internalReaderQueues: Object.fromEntries(proposedQueues.map((q) => [q, queueWhy(q)])),
    compilerOptions: Object.fromEntries(compileSteps.map((c) => [c.at, c.options])),
  },
  _notProposed: {
    internalReaderDds: Object.fromEntries([...new Set(batchDds.map((d) => d.dd))].map((dd) => [dd, batchDds.filter((d) => d.dd === dd).map((d) => `${d.at}, which ${d.how}: not a CICS region`)])),
    compilerOptions: Object.fromEntries(disputed.map(([o, at]) => [o, `stated by ${at.length} of ${compileSteps.length} compile steps`])),
  },
};

if (write) {
  const out = join(root, SITE_FILE);
  if (existsSync(out)) { console.error(`\n${out} already exists; refusing to overwrite a configuration someone may have corrected`); process.exit(1); }
  writeFileSync(out, JSON.stringify(draft, null, 1) + '\n');
  console.log(`\nwrote ${out} - read it before trusting anything it produces`);
} else {
  console.log('\n(dry run; pass --write to emit ' + SITE_FILE + ')');
}
