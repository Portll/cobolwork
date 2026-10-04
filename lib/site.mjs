// SPDX-License-Identifier: AGPL-3.0-or-later
// What this particular installation calls production.
//
// No rule about reconnaissance leakage can be written without this. A dataset high-level qualifier
// appears on every JCL line in every estate; whether `PAYR.PROD.MASTER` is a production name is a
// fact about the customer's naming convention, not about COBOL. Ship the mechanism open, and let
// the estate supply the facts.
//
// It is also the only part of cobolwork that is inherently per-customer and inherently recurring:
// conventions drift, environments are renamed, estates are acquired.
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolvesInside } from './kernel/source-tree.mjs';
import { printable } from './kernel/printable.mjs';

export const SITE_FILE = 'cobolwork.site.json';
export const SITE_VERSION = 1;

const EMPTY = {
  present: false,
  productionQualifiers: [],
  productionJobPaths: [],
  nonProductionJobPaths: [],
  systemNames: [],
  vendorPacks: [],
  allowUnvalidatedPacks: false,
  runtimeVersions: {},
  internalReaderDds: [],
  internalReaderQueues: [],
  compilerOptions: [],
  apfLibraries: [],
  restrictedDatasets: [],
  surrogateUsers: [],
  superuserIds: [],
  openTransactions: [],
  restrictedTransactions: [],
  openJobs: [],
  restrictedJobs: [],
  privilegedTransactions: [],
  privilegedJobs: [],
  problems: [],
  warnings: [],
};

// A key opening with an underscore is a note for people, as diag/propose-site.mjs writes them.
const KNOWN_KEYS = new Set(['$schema', 'version', ...Object.keys(EMPTY).filter((k) => !['present', 'problems', 'warnings'].includes(k))]);

// A configuration that is absent is not a configuration that says "nothing is production". The
// difference is the whole point: without it the recon rules have not looked, and a scan must say
// it has not looked rather than report a clean result.
// `tree` is the scan's source tree: one held in memory (a git revision) supplies the site file
// itself, and on disk the file is read from `root`.
export function loadSite(root, explicit = null, tree = null) {
  const held = !explicit && tree && tree.kind !== 'directory';
  const path = explicit || (held ? resolve(tree.root, SITE_FILE) : join(root, SITE_FILE));
  let read;
  if (held) {
    if (!tree.contains(path)) return { ...EMPTY, path };
    read = () => tree.bytes(path).toString('utf8');
  } else {
    if (!existsSync(path)) return { ...EMPTY, path };
    // A site file in the tree is not read through a link out of it; one the caller names is.
    if (!explicit && !resolvesInside(root, path)) return { ...EMPTY, path, problems: [`${SITE_FILE} is a link that leads outside the tree, so it was not read`] };
    read = () => readFileSync(path, 'utf8');
  }

  let raw;
  try { raw = JSON.parse(read()); } catch (e) {
    return { ...EMPTY, path, problems: [`${SITE_FILE} is not readable as JSON: ${printable(e.message, 120)}`] };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY, path, problems: [`${SITE_FILE} is not a JSON object`] };

  // A file with no version predates versioning and is read as version 0, which holds the same keys.
  const version = raw.version === undefined ? 0 : raw.version;
  if (!Number.isInteger(version) || version < 0) {
    return { ...EMPTY, path, problems: [`${SITE_FILE} has version ${printable(JSON.stringify(version), 40)}, which is not a whole number from 0, so it was not read`] };
  }
  if (version > SITE_VERSION) {
    return { ...EMPTY, path, problems: [`${SITE_FILE} is version ${version}, and this cobolwork reads up to version ${SITE_VERSION}; upgrade cobolwork, so the file was not read`] };
  }
  const warnings = Object.keys(raw).filter((k) => !KNOWN_KEYS.has(k) && !k.startsWith('_')).sort()
    .map((k) => `${SITE_FILE}: ${printable(JSON.stringify(k), 80)} is not a key this cobolwork reads, so it was ignored`);

  const problems = [];
  const list = (name) => {
    const v = raw[name];
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
      problems.push(`${name}: expected an array of strings`);
      return [];
    }
    return v;
  };

  const site = {
    present: true,
    path,
    productionQualifiers: list('productionQualifiers').map((s) => s.toUpperCase()),
    productionJobPaths: list('productionJobPaths'),
    nonProductionJobPaths: list('nonProductionJobPaths'),
    systemNames: list('systemNames').map((s) => s.toUpperCase()),
    vendorPacks: list('vendorPacks'),
    allowUnvalidatedPacks: raw.allowUnvalidatedPacks === true,
    // Which version of each runtime this estate runs. A compiler is pinned in a build file; a
    // transaction manager or a database is not, so the only way an advisory against one becomes
    // actionable is if someone writes down what is installed.
    runtimeVersions: (raw.runtimeVersions && typeof raw.runtimeVersions === 'object' && !Array.isArray(raw.runtimeVersions)
      && Object.values(raw.runtimeVersions).every((v) => typeof v === 'string' || typeof v === 'number'))
      ? raw.runtimeVersions : (raw.runtimeVersions === undefined ? {} : (problems.push('runtimeVersions: expected an object of product to version'), {})),
    // Which DDs in the CICS region's own JCL are SYSOUT=(class,INTRDR), and which transient-data
    // queues reach the internal reader when no CSD extract is in the repository. The region's
    // startup JCL is rarely committed beside the programs it runs, so this is a fact the estate
    // states rather than one the source can show.
    internalReaderDds: list('internalReaderDds').map((s) => s.toUpperCase()),
    internalReaderQueues: list('internalReaderQueues').map((s) => s.toUpperCase()),
    // A program sets its own options on a CBL or PROCESS card; the estate's default lives in a
    // compile PROC, applied to whatever members its callers pass it, which is not in the source.
    compilerOptions: list('compilerOptions').map((s) => s.toUpperCase()),
    // Which libraries are APF-authorised, which dataset prefixes only a privileged user may read,
    // and which users a job may legitimately run as. None of these is in any source file: APF
    // authorisation is a property of a running system's PROGxx member, and a repository cannot
    // show it. Without them the privilege rules report what a job does and assert no defect; with
    // them the same finding becomes one.
    apfLibraries: list('apfLibraries').map((s) => s.toUpperCase()),
    restrictedDatasets: list('restrictedDatasets').map((s) => s.toUpperCase()),
    surrogateUsers: list('surrogateUsers').map((s) => s.toUpperCase()),
    // Which ids the estate treats as privileged in UNIX System Services: UID 0, or a holder of
    // BPX.SUPERUSER. A repository shows a step reaching the shell, never the UID it runs under.
    superuserIds: list('superuserIds').map((s) => s.toUpperCase()),
    // The fallback for reachability: which transactions and jobs an unrestricted user can start,
    // and which a control restricts. A brought reachability extract (COBOLWORK_REACH) is
    // authoritative over these; see lib/reach.mjs and docs/spec/reach.md.
    openTransactions: list('openTransactions').map((s) => s.toUpperCase()),
    restrictedTransactions: list('restrictedTransactions').map((s) => s.toUpperCase()),
    openJobs: list('openJobs').map((s) => s.toUpperCase()),
    restrictedJobs: list('restrictedJobs').map((s) => s.toUpperCase()),
    // Which entries run with elevated authority - the effect axis (lib/reach.mjs). A brought
    // COBOLWORK_REACH extract can name these too, and is authoritative over these keys.
    privilegedTransactions: list('privilegedTransactions').map((s) => s.toUpperCase()),
    privilegedJobs: list('privilegedJobs').map((s) => s.toUpperCase()),
    problems,
    warnings,
  };

  if (site.present && !site.productionQualifiers.length && !site.systemNames.length) {
    problems.push('the file names neither a production qualifier nor a system name, so the recon rules still have nothing to compare against');
  }
  return site;
}

// Does this path look like a job that is allowed to touch production? A path listed as production
// is; a path listed as non-production is not; anything else is undecided, and an undecided path is
// not a finding, because guessing here is what makes this rule set noisy.
// The production qualifier a dataset name falls under, matched as whole leading components so
// PRODUCTS is not PROD, or null.
export function productionQualifierOf(dsn, qualifiers) {
  const name = dsn.replace(/\(.*$/, '').toUpperCase();
  return qualifiers.find((q) => name === q || name.startsWith(q + '.')) || null;
}

// Whole-path glob match by dynamic programming; `**` crosses directories, `*` and `?` do not.
function globMatches(glob, path) {
  const toks = [];
  for (let i = 0; i < glob.length; i++) {
    if (glob[i] === '*' && glob[i + 1] === '*') { toks.push('**'); i++; } else toks.push(glob[i]);
  }
  let prev = new Array(path.length + 1).fill(false);
  prev[0] = true;
  for (const t of toks) {
    const cur = new Array(path.length + 1).fill(false);
    let run = false;
    for (let j = 0; j <= path.length; j++) {
      if (t === '**') run = cur[j] = run || prev[j];
      else if (t === '*') run = cur[j] = prev[j] || (j > 0 && run && path[j - 1] !== '/');
      else cur[j] = j > 0 && prev[j - 1] && (t === '?' ? path[j - 1] !== '/' : path[j - 1] === t);
    }
    prev = cur;
  }
  return prev[path.length];
}

export function classifyPath(site, path) {
  const p = path.replace(/\\/g, '/').toLowerCase();
  const hit = (globs) => globs.some((g) => {
    const glob = g.replace(/\\/g, '/').toLowerCase();
    return globMatches(glob, p) || p.includes(glob.replace(/\*/g, ''));
  });
  if (hit(site.productionJobPaths)) return 'production';
  if (hit(site.nonProductionJobPaths)) return 'non-production';
  return 'undecided';
}
