// SPDX-License-Identifier: AGPL-3.0-or-later
// What an attacker would want to know first. None of it is a credential, and that is the point:
// an LPAR name, a production dataset qualifier, a VTAM applid or a routable address tells someone
// where to aim before they have anything to aim with.
//
// The rules answer to different authorities. The production rules need the estate to say what
// production means and are silent without it. The address rule is true everywhere and needs
// nothing: a routable address written into source is a routable address whoever reads it.
//
// The silence matters. Without cobolwork.site.json this rule set has not looked, and the summary
// says so rather than reporting a clean result. It says it as setIncomplete rather than
// coverageIncomplete, because "nobody told us what production means" and "a copybook could not be
// read" call for different actions from different people.
import { inScope, isJcl, isProgram, isCopybook, relPath } from '../sources.mjs';
import { report } from '../kernel/ruleset.mjs';
import { treeFor, noteUnread, noteUnparsed } from '../kernel/source-tree.mjs';
import { eachWithinMemory } from '../kernel/memory.mjs';
import { loadSite, classifyPath, productionQualifierOf, SITE_FILE } from '../site.mjs';
import { parseJcl, dispositionOf } from '../jcl.mjs';
import { statementCard } from '../cards.mjs';


// The production-dataset rules claim more than the name rule: that the job acts on production, not
// only that it names it. A test job that creates, extends, overwrites or deletes production data
// changes the system of record from outside production's controls; one that reads it carries the
// data out. Hence two rules, high and medium. Both are constructs, because the site file has
// already said which side of the line the job and the dataset are on, and both are CWE-653: the
// defect is that test and production are not kept apart. MITRE discourages mapping to CWE-668, the
// other candidate. Neither is critical, since naming a dataset is not proof the security product
// lets the job open it.
export const RECON_RULES = {
  'recon-production-name-outside-production': {
    sev: 'med', evidence: 'exposure', cwe: 'CWE-497',
    text: 'A name this estate calls production appears in a file that is not a production job',
    impact: 'A production qualifier or system name appears in a job the estate does not run in production, telling a reader what to aim at',
    remedy: 'Keep production dataset names and system names out of non-production jobs; reference them through a symbolic the environment sets',
  },
  'recon-routable-address-committed': {
    sev: 'low', evidence: 'exposure', cwe: 'CWE-497',
    text: 'A routable network address is written into source',
    impact: 'A routable address written into source tells a reader a real host to reach, and is the first thing someone mapping the estate wants',
    remedy: 'Remove the address from source; reference the host through configuration the environment supplies',
  },
  'recon-nonproduction-job-writes-production-dataset': {
    sev: 'high', evidence: 'construct', cwe: 'CWE-653',
    text: 'A job the estate calls non-production creates, extends, overwrites or deletes a production dataset',
    impact: 'A job the estate calls non-production creates, extends, holds or deletes a production dataset, so test-change authority reaches production data',
    remedy: 'Point the job at non-production datasets, or move it under production change control if it must touch production data',
  },
  'recon-nonproduction-job-reads-production-dataset': {
    sev: 'med', evidence: 'construct', cwe: 'CWE-653',
    text: 'A job the estate calls non-production reads a production dataset',
    impact: 'A job the estate calls non-production reads a production dataset, so production data is exposed to a non-production environment',
    remedy: 'Copy the data through a controlled, de-identified extract, or run the job under production controls',
  },
};

// Addresses that say nothing about anyone's network. Private and loopback ranges are the ordinary
// contents of a test fixture; the documentation ranges exist precisely to be written down.
function isReserved(a, b) {
  if (a === 10 || a === 127 || a === 0 || a >= 224) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;        // carrier-grade NAT
  return false;
}
const DOCUMENTATION = /^(192\.0\.2|198\.51\.100|203\.0\.113)\./;

// In COBOL an address only counts inside a literal: four dotted numbers in open text are as likely
// to be a version or a record layout.
//
// In JCL the whole statement counts, because a dataset name qualifier cannot be purely numeric -
// it must begin with a letter or a national character - so a dotted quad of digits in a job is not
// a dataset name. An address on an in-stream FTP control card is exactly what this rule is for,
// and that is data rather than an operand. Only comments are skipped.
const IN_LITERAL = /'([^']{1,200})'|"([^"]{1,200})"/g;
const IPV4 = /\b((?:\d{1,3})\.(?:\d{1,3})\.(?:\d{1,3})\.(?:\d{1,3}))\b/g;

function collect(value, out) {
  IPV4.lastIndex = 0;
  let ip;
  while ((ip = IPV4.exec(value)) !== null) {
    const parts = ip[1].split('.').map(Number);
    if (parts.some((n) => n > 255)) continue;
    if (isReserved(parts[0], parts[1])) continue;
    if (DOCUMENTATION.test(ip[1])) continue;
    out.push({ address: ip[1] });
  }
}

function routableAddresses(text, jcl) {
  const out = [];
  if (jcl) {
    for (const line of text.split(/\r?\n/)) {
      if (/^\/\/\*/.test(line)) continue;
      collect(statementCard(line).text, out);
    }
    return out;
  }
  IN_LITERAL.lastIndex = 0;
  let m;
  while ((m = IN_LITERAL.exec(text)) !== null) collect(m[1] ?? m[2] ?? '', out);
  return out;
}

// A qualifier matches on a whole dotted component, never on a substring: PROD matches PROD.MASTER
// and PRODLIB.X only if PRODLIB was itself listed. Matching on substrings is how a rule like this
// starts reporting every line in the estate.
// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- q is escaped
const qualifierPattern = (q) => new RegExp('(^|[^A-Z0-9$#@.])' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[.\\s,)\'"]|$)', 'i');

// JOBLIB and STEPLIB are where the system looks for the program, so what they hold is code rather
// than data. A test job running production load modules is left to the name rule.
const PROGRAM_LIBRARIES = new Set(['JOBLIB', 'STEPLIB']);

const WRITES = 'recon-nonproduction-job-writes-production-dataset';
const READS = 'recon-nonproduction-job-reads-production-dataset';

// What the disposition says the step does, in the words the finding uses. SHR is a shared open,
// and a program that writes a dataset it opened SHR - a member through SYSUT2 or SYSLMOD - reads as
// a read here: which DDs a program writes is a property of the program, not of the disposition.
// A disposition that decides nothing is left to the name rule.
const DOES = {
  create: [WRITES, (d, at) => `creates ${d} ${at}`],
  append: [WRITES, (d, at) => `adds records to ${d} ${at}`],
  exclusive: [WRITES, (d, at) => `holds ${d} exclusively ${at}, which is how a step overwrites it or updates it in place`],
  read: [READS, (d, at) => `reads ${d} ${at}`],
};
const REMOVES = { DELETE: 'deletes', UNCATLG: 'uncatalogs' };

function touchOf(dd) {
  const disp = dispositionOf(dd.disp);
  if (!disp) return null;
  const at = `(DISP=${dd.disp})`;
  // On a dataset the step creates, DELETE only removes what the step itself made.
  if (dd.access !== 'create') {
    if (REMOVES[disp.normal]) return { rule: WRITES, verb: `${REMOVES[disp.normal]} ${dd.dsn} when the step ends ${at}` };
    if (REMOVES[disp.abnormal]) return { rule: WRITES, verb: `${REMOVES[disp.abnormal]} ${dd.dsn} if the step fails ${at}` };
  }
  const does = DOES[dd.access];
  return does ? { rule: does[0], verb: does[1](dd.dsn, at) } : null;
}

// The DD statements of a non-production job that act on a production dataset, and the lines each
// takes up, so the name rule does not report the same statement a second time.
function productionTouches(job, qualifiers) {
  const found = [];
  const claimed = new Set();
  let library = null;
  for (const dd of job.dds) {
    if (dd.name) library = PROGRAM_LIBRARIES.has(dd.name.toUpperCase()) ? dd.name : null;
    if (!dd.dsn || dd.temporary || library) continue;
    const qualifier = productionQualifierOf(dd.dsn, qualifiers);
    if (!qualifier) continue;
    const touch = touchOf(dd);
    if (!touch) continue;
    found.push({ ...touch, dd, qualifier });
    for (let l = dd.line; l <= dd.endLine; l++) claimed.add(l);
  }
  return { found, claimed };
}

export function scanRecon(root, opts = {}) {
  const site = loadSite(root, opts.site || null, opts.tree);
  const tree = treeFor(root, opts);
  const files = tree.list().filter(inScope(opts))
    .filter((f) => isJcl(f) || isProgram(f) || isCopybook(f));

  const findings = [];
  const stats = {
    filesScanned: 0, filesUnreadable: 0,
    siteConfigured: site.present,
    siteProblems: site.problems,
    productionQualifiers: site.productionQualifiers.length,
    systemNames: site.systemNames.length,
    pathsUndecided: 0,
    undecidedNamingProduction: 0,
    // Without a site file the production rule has not run at all. That is not the same claim as
    // "a file could not be read", so it travels as setIncomplete rather than coverageIncomplete:
    // the difference is between "we looked and found nothing" and "nothing told us what to look
    // for", and a reader needs to be able to tell them apart.
    setIncomplete: !site.present || site.problems.length > 0,
    notLooked: site.present ? [] : [`no ${SITE_FILE}: the production-name and production-dataset rules did not run, because nothing declares what production means in this estate`],
  };

  const names = [
    ...site.productionQualifiers.map((q) => ({ value: q, kind: 'production qualifier' })),
    ...site.systemNames.map((q) => ({ value: q, kind: 'system name' })),
  ];
  const patterns = names.map((n) => ({ ...n, re: qualifierPattern(n.value) }));

  // This set reads every program, copybook and job in the tree, which is the widest reading any
  // set does, so it is walked inside the guard like the rest.
  const run = eachWithinMemory(files, (f) => {
    let src;
    try { src = tree.text(f).text; } catch (e) { noteUnread(stats, tree, f, e); return 0; }
    stats.filesScanned++;
    const path = relPath(root, f);
    const lines = src.split(/\r?\n/);
    const jcl = isJcl(f);

    if (patterns.length) {
      const where = classifyPath(site, path);
      if (where === 'undecided') {
        stats.pathsUndecided++;
        if (lines.some((l) => !(jcl && /^\/\/\*/.test(l)) && patterns.some((p) => p.re.test(l)))) stats.undecidedNamingProduction++;
      }
      // A production job naming production is the job doing its work. Only a file that is known
      // not to be a production job is a finding: an undecided path is left alone, because the
      // alternative is reporting the entire estate on the first run.
      if (where === 'non-production') {
        let claimed = new Set();
        if (jcl && site.productionQualifiers.length) {
          let job = null;
          try { job = parseJcl(src, f, { symbols: opts.symbols || {} }); } catch (e) { noteUnparsed(stats, tree, f, e); }
          if (job) {
            const touches = productionTouches(job, site.productionQualifiers);
            claimed = touches.claimed;
            for (const t of touches.found) {
              findings.push({
                rule: t.rule, path, line: t.dd.line, step: t.dd.step,
                detail: `${t.dd.step ? `step ${t.dd.step}` : 'the job'} ${t.verb}; ${t.qualifier} is a production qualifier, and ${SITE_FILE} lists ${path} as not a production job`,
              });
            }
          }
        }
        const seen = new Set();
        lines.forEach((line, i) => {
          if (claimed.has(i + 1)) return;
          if (jcl && /^\/\/\*/.test(line)) return;
          for (const p of patterns) {
            if (seen.has(p.value)) continue;
            if (!p.re.test(line)) continue;
            seen.add(p.value);
            findings.push({
              rule: 'recon-production-name-outside-production', path, line: i + 1,
              detail: `${p.kind} ${p.value} appears in ${path}, which ${site.path ? SITE_FILE : 'the site configuration'} lists as not a production job`,
            });
          }
        });
      }
    }

    const seenAddr = new Set();
    for (const a of routableAddresses(src, jcl)) {
      if (seenAddr.has(a.address)) continue;
      seenAddr.add(a.address);
      const line = lines.findIndex((l) => l.includes(a.address)) + 1 || 1;
      findings.push({
        rule: 'recon-routable-address-committed', path, line,
        detail: `${a.address} is a routable address written into ${path}; it is not a credential, and it is the first thing someone would want to know`,
      });
    }
    return src.length;
  }, { label: 'recon', maxBytes: opts.maxSourceBytes ?? Infinity });

  // A file that names production and that the site lists as neither kind of job is the one the name
  // rule leaves alone, so it was not judged. Files that name nothing are not counted: their
  // classification could not have changed a finding.
  if (stats.undecidedNamingProduction) {
    stats.setIncomplete = true;
    stats.notLooked.push(`${stats.undecidedNamingProduction} file(s) name a production qualifier or system name and match neither productionJobPaths nor nonProductionJobPaths in ${SITE_FILE}, so whether each may was not judged`);
  }

  // setIncomplete, set above, is a different claim from coverageIncomplete: nothing declared what
  // production means, as against files going unread. Both travel, and they are not merged.
  return report('recon', { rules: RECON_RULES, findings, stats, run });
}
