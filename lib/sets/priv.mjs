// SPDX-License-Identifier: AGPL-3.0-or-later
// Privilege: what a transaction, a job or a library is allowed to do that nothing in the repository
// says it needs.
//
// The trap this set is built around is that CICS' defaults are permissive. RESSEC(NO) and
// CMDSEC(NO) are what a transaction gets when nobody says otherwise, so reporting them on their own
// reports 1,330 of the corpus' 1,330 transaction definitions and means nothing. What makes a
// missing CMDSEC a finding is that the transaction's program actually issues the commands CMDSEC
// governs - the same lesson the BMS rule learned, that the discriminator is the use and not the
// declaration.
//
// Two of the checks here can never be witnessed by a repository, and that is a property of the
// facts rather than of this corpus. Whether a library is APF-authorised lives in a running system's
// PROGxx member; whether a dataset is readable by everyone lives in RACF. No amount of public COBOL
// will ever show either. They are therefore written as `context` - which asserts no defect - until
// cobolwork.site.json supplies the fact, at which point the same finding becomes a defect with a
// severity. A rule that cannot be wrong until someone supplies ground truth has a false-positive
// rate of zero by construction, which is a better answer than not writing it.
import { inScope, isProgram, relPath } from '../sources.mjs';
import { report } from '../kernel/ruleset.mjs';
import { treeFor, noteUnread, noteUnparsed } from '../kernel/source-tree.mjs';
import { drive, loopOver } from '../kernel/shared-pass.mjs';
import { parseCsd } from '../csd.mjs';
import { parseJcl } from '../jcl.mjs';
import { loadSite } from '../site.mjs';
import { basename } from 'node:path';
import { IBM } from '../kernel/manuals.mjs';


export const PRIV_RULES = {
  'csd-defines-diagnostic-transaction': {
    sev: 'high', evidence: 'construct', cwe: 'CWE-250',
    text: 'A definition in this repository installs one of the CICS diagnostic transactions',
    impact: 'This repository installs a CICS diagnostic transaction (CECI, CEMT, CEDA, ...) that runs commands a terminal types rather than a program the estate wrote, so anyone who can reach it drives the region',
    remedy: 'Do not install the diagnostic transactions in an application region, or restrict them by transaction security to named administrators',
  },
  'csd-transaction-without-command-security': {
    sev: 'med', evidence: 'construct', cwe: 'CWE-862',
    text: 'A transaction whose program issues system commands runs without command security',
    impact: "The transaction's program issues CICS system commands and its definition does not set CMDSEC(YES), so the region checks nobody's authority to issue them",
    remedy: "Set CMDSEC(YES) on the transaction, so the region checks the user's authority for the system commands the program issues",
    references: [IBM.commandSecurity],
  },
  'job-writes-diagnostic-output-unrestricted': { sev: 'info', evidence: 'context', cwe: 'CWE-532', text: 'A job writes a dump, trace, log or unload to a dataset the estate has not called restricted' },
  'job-reaches-unix-system-services': { sev: 'info', evidence: 'context', cwe: 'CWE-250', text: 'A job runs a shell through UNIX System Services' },
  'job-runs-under-another-user': { sev: 'info', evidence: 'context', cwe: 'CWE-269', text: 'A job names the user it runs as' },
  'job-unloads-the-security-database': { sev: 'info', evidence: 'context', cwe: 'CWE-522', text: 'A job unloads the security database' },
  // Unlike its two neighbours this one is declared as what it is rather than as an observer. A job
  // unloading the security database, or naming the user it runs as, is worth reporting on its own;
  // a job loading from a STEPLIB is not, because every job does. So this check says nothing at all
  // until apfLibraries is declared, and `notLooked` reports that it did not judge - which is a
  // different claim from observing without asserting, and needs a different declaration.
  'job-loads-from-an-authorised-library': {
    sev: 'high', evidence: 'construct', cwe: 'CWE-250',
    text: 'A job loads from a library the estate calls authorised',
    impact: 'The job loads programs from a library the estate names as APF-authorised, so anything written into that library runs with supervisor authority and can bypass every check RACF makes',
    remedy: 'Restrict write access to the authorised library to the change process that owns it, and load from an unauthorised copy where the job does not need authority',
  },
};

// CECI runs any CICS command the terminal types, CEMT changes the region's state, CEDA installs
// definitions, CEDF steps another transaction and CESF signs a terminal off. Every published
// account of breaking out of a CICS application reaches one of these five.
const DIAGNOSTIC = new Set(['CECI', 'CEMT', 'CEDA', 'CEDF', 'CESF', 'CECS', 'CEBR']);

// The commands CMDSEC governs. A transaction whose program issues none of them loses nothing by
// running with CMDSEC(NO), which is why the flag alone is not the finding.
const SPI_VERBS = new Set(['SET', 'DISCARD', 'PERFORM', 'COLLECT', 'CREATE', 'INQUIRE', 'ENABLE', 'DISABLE', 'RESYNC']);

const looksLikeCsd = (src) => /^\s*DEFINE\s+(TRANSACTION|PROGRAM|TDQUEUE|FILE|TCPIPSERVICE)\s*\(/im.test(src);
// A DEFINE quoted in a README is documentation, not an estate's configuration. Prose files are
// counted and not reported, so the difference is visible rather than silently folded in.
const isProse = (path) => /\.(md|markdown|rst|adoc|txt)$/i.test(path) && !/\bcsd\b/i.test(path);

// JCL is read through lib/jcl.mjs rather than by regex here. The regexes this replaced anchored
// DSN= to the same physical line as its //DD, which standard continuation breaks, and bounded a
// step's DDs by byte offset rather than by step - so a job whose output sat on a continuation card
// was affirmatively cleared, and one whose next step wrote a report had that report named as where
// the security database went. diag/propose-site.mjs reads the same facts the same way.
const HOUSEKEEPING = /^(STEPLIB|JOBLIB|SYSPRINT|SYSIN|SYSOUT|SYSUDUMP|SYSABEND|SYSTSPRT|SYSTSIN)$/;
// The utilities that read the security database and write it out somewhere ordinary.
const SECURITY_UTILITY = /^(IRRDBU00|IRRUT200|IRRUT400|IRRXUTIL|ICHUT400)$/;
// A dataset whose own name says it holds diagnostic output. The name is the estate saying what
// is in it, which is better evidence than guessing from the step that wrote it.
const DIAGNOSTIC_DSN = /(^|\.)(DUMP|TRACE|LOG|LOGS|AUDIT|AUDITLG|UNLOAD|UNLOADED|SNAP|ABEND)(\.|$)/i;
// Reaching the shell. BPXBATCH runs it as a step; the rest are how a program gets there.
const USS_PROGRAM = /^(BPXBATCH|BPXBATSL)$/;
const USS_CALL = /\b(BPXWUNIX|BPX1SPN|BPX1EXC)\b/;
// DISP says which way a DD goes. SHR and OLD read; NEW and MOD write. A DD with no DISP at all is
// not claimed either way, because guessing is what produced the sentence this replaced.
const written = (dd) => /^\(?\s*(NEW|MOD)\b/i.test(String(dd.disp || ''));

const isJcl = (path) => /\.(jcl|job|prc|proc|cntl)$/i.test(path);
const upper = (s) => String(s || '').toUpperCase();

// Is this dataset under one of the prefixes the estate named, matched as whole components so
// PRODUCTS does not match PROD?
function under(dsn, prefixes) {
  const parts = upper(dsn).split('.');
  return prefixes.some((p) => {
    const want = upper(p).split('.');
    return want.every((w, i) => parts[i] === w);
  });
}

export function* scanPrivSteps(root, opts = {}) {
  const site = loadSite(root, opts.site || null, opts.tree);
  const tree = treeFor(root, opts);
  const files = tree.list().filter(inScope(opts));
  const findings = [];
  const stats = {
    filesScanned: 0, filesUnreadable: 0, filesUnparsed: 0,
    // Every file in the tree is opened, because a CSD is a DFHCSDUP listing and nothing says what
    // it must be called - the same reason a BMS count came out as zero once. But opening a file is
    // not scanning it: filesScanned counts what this set could find something in, because the
    // whole-scan coverage number is the largest filesScanned of any set, and a set that claimed
    // every README and PNG in the tree would inflate it. That number reads as "how much did you
    // look at", and inflating it errs in the flattering direction.
    filesOpened: 0,
    csdFiles: 0, csdInProse: 0, transactionsDefined: 0, jobsRead: 0,
    // What the estate has not said. Two of the five checks assert nothing without these, and a
    // reader has to be able to tell "nothing to report" from "nothing to report it against".
    factsNotDeclared: ['apfLibraries', 'restrictedDatasets', 'surrogateUsers']
      .filter((k) => !(site[k] || []).length),
    // A fact written in the wrong shape is not a fact nobody wrote. Without this line an estate
    // that put a string where an array belongs is told its facts are undeclared, which sends it
    // looking for the wrong mistake, and the three checks above silently stay at `context`.
    siteConfigured: site.present,
    siteProblems: site.problems,
    setIncomplete: site.problems.length > 0,
    notLooked: site.problems.length
      ? [`cobolwork.site.json has ${site.problems.length} problem(s), so the privilege facts were not all read: ${site.problems[0]}`]
      : [],
  };

  // Transaction name to the program it runs, across every CSD in the tree.
  const runs = new Map();
  const csdSeen = [];
  const jobUsers = [];
  const authorisedLoads = [];
  const securityUnloads = [];
  const diagnostics = [];
  const uss = [];

  const run = yield loopOver(files, (f) => {
    let src;
    try { src = tree.text(f).text; } catch (e) { noteUnread(stats, tree, f, e); return 0; }
    const path = relPath(root, f);
    stats.filesOpened++;
    const csdish = looksLikeCsd(src);
    const jcl = isJcl(path);
    if (csdish || jcl) stats.filesScanned++;

    if (csdish) {
      if (isProse(path)) { stats.csdInProse++; } else {
        stats.csdFiles++;
        const csd = parseCsd(src);
        stats.transactionsDefined += csd.transactions.size;
        for (const [name, t] of csd.transactions) {
          csdSeen.push({ name, path, line: t.line, program: t.program, cmdsec: t.cmdsec });
          if (t.program) runs.set(name, upper(t.program));
        }
      }
    }

    if (jcl) {
      stats.jobsRead++;
      let job;
      try { job = parseJcl(src, f); } catch (e) { noteUnparsed(stats, tree, f, e); return src.length; }

      for (const j of job.jobs) {
        const user = j.keywords && j.keywords.get('USER');
        if (user) jobUsers.push({ path, line: j.line || 1, user: upper(user) });
      }
      for (const step of job.steps) {
        const pgm = upper(step.pgm);
        if (!SECURITY_UTILITY.test(pgm)) continue;
        // The step's own DDs, and only the ones it writes. Reading the rest of the file from the
        // step's byte offset named a STEPLIB, the database the utility reads and a later step's
        // output as places the unloaded security database was written, at high severity.
        const outputs = (step.dds || [])
          .filter((d) => d.dsn && !HOUSEKEEPING.test(upper((d.name || '').split('.').pop())))
          .filter((d) => written(d))
          .map((d) => upper(d.dsn));
        securityUnloads.push({ path, line: step.line || 1, pgm, outputs: [...new Set(outputs)] });
      }
      for (const step of job.steps) {
        const pgm = upper(step.pgm);
        if (USS_PROGRAM.test(pgm)) uss.push({ path, line: step.line || 1, how: `runs ${pgm}` });
        for (const d of step.dds || []) {
          if (!d.dsn || d.temporary || !written(d)) continue;
          if (!DIAGNOSTIC_DSN.test(upper(d.dsn))) continue;
          diagnostics.push({ path, line: d.line || step.line || 1, dsn: upper(d.dsn) });
        }
      }
      // A library a step loads from, wherever the DD sits and however its DSN is continued.
      for (const step of job.steps) {
        for (const d of step.dds || []) {
          const name = upper((d.name || '').split('.').pop());
          if (!/^(STEPLIB|JOBLIB)$/.test(name) || !d.dsn) continue;
          authorisedLoads.push({ path, line: d.line || step.line || 1, dsn: upper(d.dsn) });
        }
      }
    }
    return src.length;
  }, { label: 'priv', maxBytes: opts.maxSourceBytes ?? Infinity });

  // Which programs issue the commands CMDSEC governs. Only the programs a CSD actually names are
  // parsed, which is a handful rather than the tree.
  const wanted = new Set([...runs.values()]);
  const issuesSpi = new Set();
  if (wanted.size) {
    for (const f of files.filter(isProgram)) {
      const name = upper(basename(f).replace(/\.[^.]+$/, ''));
      if (!wanted.has(name)) continue;
      let src;
      try { src = tree.text(f).text; } catch { continue; }
      if (!/EXEC\s+CICS/i.test(src)) continue;
      let r;
      try { r = tree.parse(f, src); } catch (e) { noteUnparsed(stats, tree, f, e); continue; }
      for (const p of r.programs) {
        for (const e of p.execs) {
          if (e.kind !== 'CICS') continue;
          const w = e.toks.filter((t) => t.t === 'word').map((t) => t.u);
          if (w.length >= 2 && SPI_VERBS.has(w[0]) && /^[A-Z]+$/.test(w[1])) { issuesSpi.add(upper(p.id) || name); issuesSpi.add(name); }
        }
      }
    }
  }

  for (const t of csdSeen) {
    if (DIAGNOSTIC.has(upper(t.name))) {
      findings.push({
        rule: 'csd-defines-diagnostic-transaction', path: t.path, line: t.line,
        detail: `this repository installs ${upper(t.name)}, which runs CICS commands a terminal types rather than a program the estate wrote`,
      });
      continue;
    }
    const pgm = runs.get(t.name);
    if (!pgm || !issuesSpi.has(pgm)) continue;
    // CMDSEC(NO) is also what a definition gets when it says nothing, so the absent case counts.
    if (upper(t.cmdsec) === 'YES') continue;
    findings.push({
      rule: 'csd-transaction-without-command-security', path: t.path, line: t.line,
      detail: `transaction ${upper(t.name)} runs ${pgm}, which issues CICS system commands, and its definition does not set CMDSEC(YES) - so the region checks nobody's authority to issue them`,
    });
  }

  // The two the repository cannot witness. Without the estate's facts these assert nothing; with
  // them the same observation is a defect, and the severity comes from the table below.
  for (const j of jobUsers) {
    const declared = (site.surrogateUsers || []).includes(j.user);
    findings.push({
      rule: 'job-runs-under-another-user', path: j.path, line: j.line,
      ...(site.surrogateUsers?.length && !declared ? { sev: 'med', evidence: 'construct' } : {}),
      detail: site.surrogateUsers?.length
        ? (declared
          ? `this job runs as ${j.user}, which the estate names as a surrogate it permits`
          : `this job runs as ${j.user}, which the estate does not name among the users a job may run as`)
        : `this job runs as ${j.user}. Name the users a job may run as in cobolwork.site.json as surrogateUsers, and this becomes a finding or a clearance rather than an observation`,
    });
  }

  for (const u of securityUnloads) {
    const restricted = (site.restrictedDatasets || []).length;
    const bad = u.outputs.filter((d) => !under(d, site.restrictedDatasets || []));
    findings.push({
      rule: 'job-unloads-the-security-database', path: u.path, line: u.line,
      ...(restricted && bad.length ? { sev: 'high', evidence: 'construct' } : {}),
      detail: restricted
        ? (bad.length
          ? `this job runs ${u.pgm} and writes the unloaded security database to ${bad.join(', ')}, which is not under any prefix the estate calls restricted`
          : `this job runs ${u.pgm} and writes only to prefixes the estate calls restricted`)
        : `this job runs ${u.pgm}, which unloads the security database. Name the prefixes only a privileged user may read in cobolwork.site.json as restrictedDatasets, and where its output lands becomes a finding or a clearance`,
    });
  }

  for (const d of diagnostics) {
    const restricted = (site.restrictedDatasets || []).length;
    const covered = restricted && under(d.dsn, site.restrictedDatasets);
    if (restricted && covered) continue;
    findings.push({
      rule: 'job-writes-diagnostic-output-unrestricted', path: d.path, line: d.line,
      ...(restricted ? { sev: 'med', evidence: 'construct' } : {}),
      detail: restricted
        ? `this job writes ${d.dsn}, whose name says it holds diagnostic output, to a prefix the estate does not call restricted`
        : `this job writes ${d.dsn}, whose name says it holds diagnostic output. Name the prefixes only a privileged user may read in cobolwork.site.json as restrictedDatasets, and where it lands becomes a finding or a clearance`,
    });
  }

  for (const u of uss) {
    const declared = (site.superuserIds || []).length;
    findings.push({
      rule: 'job-reaches-unix-system-services', path: u.path, line: u.line,
      detail: declared
        ? `this job ${u.how}, and the estate names ${site.superuserIds.length} id(s) it treats as privileged: check the one this step runs under is not among them`
        : `this job ${u.how}, so a shell runs with whatever UID the step carries. Name the ids the estate treats as privileged in cobolwork.site.json as superuserIds`,
    });
  }

  for (const a of authorisedLoads) {
    if (!(site.apfLibraries || []).length) continue;   // with no fact there is nothing to observe
    if (!under(a.dsn, site.apfLibraries)) continue;
    findings.push({
      rule: 'job-loads-from-an-authorised-library', path: a.path, line: a.line,
      detail: `this job loads from ${a.dsn}, which the estate names as APF-authorised, so anything written into that library runs with authority`,
    });
  }

  // A check that had something to judge and no fact to judge it by has not run as a defect check.
  // Each finding says so, but a reader deciding whether the scan came back clean reads the summary,
  // and the APF check, which has nothing to observe without its fact, says nothing anywhere else.
  const unjudged = [
    [jobUsers.length, 'surrogateUsers', 'job(s) name the user they run as'],
    [securityUnloads.length, 'restrictedDatasets', 'step(s) unload the security database'],
    [authorisedLoads.length, 'apfLibraries', 'STEPLIB or JOBLIB statement(s) load programs'],
  ].filter(([n, fact]) => n && !(site[fact] || []).length);
  if (unjudged.length) {
    stats.setIncomplete = true;
    stats.notLooked.push(`${unjudged.map(([n, fact, what]) => `${n} ${what} and no ${fact} are declared`).join('; ')}, so ${unjudged.length === 1 ? 'that check was' : 'those checks were'} not judged: name them in cobolwork.site.json`);
  }

  return report('priv', { rules: PRIV_RULES, findings, stats, run });
}

export const scanPriv = (root, opts = {}) => drive(scanPrivSteps(root, opts));
