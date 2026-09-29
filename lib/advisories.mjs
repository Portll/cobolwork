// SPDX-License-Identifier: AGPL-3.0-or-later
// Published advisories against the compilers and runtimes a repository might build with, and the
// version arithmetic to decide whether a pinned version is one of them.
//
// A crafted source file in a pull request targets the compiler that CI runs on it, so the version
// the build pins is part of the repository's attack surface. Every row here was retrieved from the
// issuing advisory and carries the URL it came from: `diag/verify-advisories.mjs` re-queries NVD
// and fails if a row no longer matches, because a fabricated identifier in this file would be
// worse than an empty one.
//
// What the file does not cover is stated in it. An absence of published advisories for a product
// is not an absence of defects in it, and the two must not read the same.
import { readFileSync, realpathSync } from 'node:fs';
import { basename, delimiter, sep } from 'node:path';

export const ADVISORIES = JSON.parse(readFileSync(new URL('../rules/advisories.json', import.meta.url), 'utf8'));

const SEVERITIES = ['crit', 'high', 'med', 'low', 'info'];
const str = (v) => typeof v === 'string' && v.trim().length > 0;
const isoDate = (v) => str(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);

// What makes an advisory row one the version arithmetic can use, whoever supplied it. The feed gate
// (feed/schema.mjs) holds a public row to this, to a product it knows and to a quote found in a
// cached copy of its source; a customer's own extract is held to this alone.
export function advisoryProblems(row, { products = null } = {}) {
  const problems = [];
  if (products) { if (!products.includes(row.product)) problems.push('product: not one of ' + products.join(', ')); }
  else if (!/^[a-z0-9][a-z0-9-]*$/.test(row.product || '')) problems.push('product: not a product name in lower case');
  if (!str(row.id)) problems.push('id: missing');
  if (!str(row.affected)) problems.push('affected: missing');
  if (row.fixedIn !== null && !str(row.fixedIn)) problems.push('fixedIn: must be a version or null');
  if (!SEVERITIES.includes(row.severity)) problems.push('severity: unknown');
  if (!str(row.summary)) problems.push('summary: missing');
  return problems;
}

// A version range the advisory rule can actually evaluate. Deliberately small: a list, a
// comparison, or a closed interval.
export function versionRangeProblems(expr) {
  const ok = expr.split('||').every((part) => /^\s*(<=|>=|<|>|=)?\s*\d+(?:\.\d+)*(?:-[a-z0-9.-]*|[a-z][a-z0-9.-]*)?\s*$/i.test(part) ||
    /^\s*\[\s*\d+(\.\d+)*\s*,\s*\d+(\.\d+)*\s*[\])]\s*$/.test(part));
  return ok ? [] : ["affected: '" + expr + "' is not a version range this rule can evaluate"];
}

// Dotted numeric comparison. Missing components are zero, so 3 and 3.0 are the same version, and a
// non-numeric tail ("3.1-rc1") sorts before the release it precedes.
export function compareVersions(a, b) {
  const parts = (v) => String(v).split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x === y) continue;
    // A numeric component always outranks a textual one: 3.1 is later than 3.1-rc1.
    if (typeof x === 'number' && typeof y === 'string') return 1;
    if (typeof x === 'string' && typeof y === 'number') return -1;
    return x < y ? -1 : 1;
  }
  return 0;
}

// Does `version` fall in `expr`? The grammar is deliberately small, because a range the rule cannot
// evaluate is not a rule input: an exact version, a comparison, a closed or half-open interval, or
// several of those joined by ||.
export function versionMatches(version, expr) {
  return String(expr).split('||').some((raw) => {
    const part = raw.trim();
    const interval = part.match(/^([[(])\s*([\w.-]+)\s*,\s*([\w.-]+)\s*([\])])$/);
    if (interval) {
      const [, lo, from, to, hi] = interval;
      const lower = compareVersions(version, from);
      const upper = compareVersions(version, to);
      return (lo === '[' ? lower >= 0 : lower > 0) && (hi === ']' ? upper <= 0 : upper < 0);
    }
    const cmp = part.match(/^(<=|>=|<|>|=)?\s*([\w.-]+)$/);
    if (!cmp) return false;
    const [, op = '=', v] = cmp;
    const c = compareVersions(version, v);
    return op === '=' ? c === 0 : op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : c >= 0;
  });
}

// Every advisory against this product that names this version, with any a customer feed added.
export function advisoriesFor(product, version, extra = []) {
  return [...ADVISORIES.advisories, ...extra].filter((a) => a.product === product && versionMatches(version, a.affected));
}

// What this file admits it has not looked at, so a scan that finds nothing can say why.
export const COVERAGE = ADVISORIES.coverage;

// The feeds a scan was given: the caller's list, or COBOLWORK_ADVISORIES read when the scan runs.
export function advisoryFeedPaths(opts = {}) {
  if (opts.advisoryFeeds) return opts.advisoryFeeds;
  return (process.env.COBOLWORK_ADVISORIES || '').split(delimiter).filter(Boolean);
}

// A customer's own advisory extract - the IBM Z and LinuxONE Security Portal's, or any other it may
// not redistribute - loaded for one scan and never kept. It is refused from inside the scanned
// tree, where everyone who can read the repository could read it. A row meets the public rows'
// shape; the quote a public row carries cannot be checked against a source nobody may cache, so the
// extract's provenance stands in for it, and the summary names the extract so a scan that used one
// never reads like one that did not.
//
// { schemaVersion, extract, retrieved, coverage: { product: text }, advisories: [row] }, each row
// as in rules/advisories.json with source { doc } naming the bulletin in the extract.
export function loadAdvisoryFeed(path, { root = null } = {}) {
  const feed = { file: basename(path), extract: null, retrieved: null, coverage: {}, advisories: [], refused: [], problem: null };
  let real;
  try { real = realpathSync(path); } catch (e) { feed.problem = `could not be read (${e.code || e.name})`; return feed; }
  if (root) {
    const top = realpathSync(root);
    if (real === top || real.startsWith(top + sep)) { feed.problem = 'is inside the tree being scanned, where anyone who can read the repository can read it, so it was not loaded'; return feed; }
  }
  let doc;
  try { doc = JSON.parse(readFileSync(real, 'utf8')); } catch (e) { feed.problem = `is not JSON (${e.message})`; return feed; }
  if (!str(doc.extract)) feed.problem = 'does not say which extract it is';
  else if (!isoDate(doc.retrieved)) feed.problem = 'does not say when it was retrieved';
  else if (!Array.isArray(doc.advisories)) feed.problem = 'holds no advisories';
  if (feed.problem) return feed;
  feed.extract = doc.extract;
  feed.retrieved = doc.retrieved;
  feed.coverage = doc.coverage && typeof doc.coverage === 'object' ? doc.coverage : {};
  for (const row of doc.advisories) {
    if (!row || typeof row !== 'object') { feed.refused.push({ id: null, problems: ['row: not an object'] }); continue; }
    const problems = advisoryProblems(row);
    if (str(row.affected)) problems.push(...versionRangeProblems(row.affected));
    if (!row.source || !str(row.source.doc)) problems.push('source.doc: missing');
    if (problems.length) feed.refused.push({ id: str(row.id) ? row.id : null, problems });
    else feed.advisories.push({ ...row, feed: { extract: doc.extract, retrieved: doc.retrieved } });
  }
  return feed;
}
