// SPDX-License-Identifier: AGPL-3.0-or-later
// Who can reach a finding, and what reaching it runs as - the halves a repository cannot show.
//
// A path finding names a route. Whether an attacker can drive it is who may start the transaction
// or submit the job that carries the input (reach); what driving it gives them is the authority
// that entry runs under (effect). Both live in RACF and the region's SIT, never in the source. The
// estate supplies them: authoritatively, as an extract it brings for one scan and the tool never
// keeps - a RACF unload reduced to who-starts-what and who-runs-as-what - or, as a fallback, by
// naming the entries in cobolwork.site.json. Until it supplies either, reach is undeclared and
// effect is unstated, and the scan says so rather than ranking anything. See docs/spec/reach.md.
//
// Both are annotations, not re-rankings: severity is urgency, reach is who can drive it, effect is
// what driving it runs as. Three axes kept apart so each names the fact that moved it;
// lib/exploitability.mjs joins them with the route into a verdict.
import { readFileSync, realpathSync } from 'node:fs';
import { basename, sep, delimiter } from 'node:path';

const str = (v) => typeof v === 'string' && v.length > 0;
const isoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const up = (s) => String(s || '').toUpperCase();
const ACCESS = new Set(['open', 'restricted']);
const arr = (v) => (Array.isArray(v) ? v.filter(str).map(up) : []);

// The feeds a scan was given: the caller's list, or COBOLWORK_REACH read when the scan runs.
export function reachFeedPaths(opts = {}) {
  if (opts.reachFeeds) return opts.reachFeeds;
  return (process.env.COBOLWORK_REACH || '').split(delimiter).filter(Boolean);
}

// A customer's own reachability extract, loaded for one scan and never kept, refused from inside the
// scanned tree the way an advisory feed is. Shape:
//   { extract, retrieved, transactions: { NAME: "open"|"restricted" }, jobs: { NAME: ... },
//     privileged: { transactions: [NAME], jobs: [NAME] } }
// derived from a RACF unload (who may start each transaction, and which run with elevated authority)
// and the SIT (which face a network).
export function loadReachFeed(path, { root = null } = {}) {
  const feed = { file: basename(path), extract: null, retrieved: null, transactions: {}, jobs: {}, privileged: { transactions: [], jobs: [] }, refused: [], problem: null };
  let real;
  try { real = realpathSync(path); } catch (e) { feed.problem = `could not be read (${e.code || e.name})`; return feed; }
  if (root) {
    const top = realpathSync(root);
    if (real === top || real.startsWith(top + sep)) { feed.problem = 'is inside the tree being scanned, where anyone who can read the repository can read it, so it was not loaded'; return feed; }
  }
  let doc;
  try { doc = JSON.parse(readFileSync(real, 'utf8')); } catch (e) { feed.problem = `is not JSON (${e.message})`; return feed; }
  if (!str(doc.extract)) { feed.problem = 'does not say which extract it is'; return feed; }
  if (!isoDate(doc.retrieved)) { feed.problem = 'does not say when it was retrieved'; return feed; }
  feed.extract = doc.extract;
  feed.retrieved = doc.retrieved;
  for (const kind of ['transactions', 'jobs']) {
    const m = doc[kind];
    if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
    for (const [name, access] of Object.entries(m)) {
      if (ACCESS.has(access)) feed[kind][up(name)] = access;
      else feed.refused.push({ name: up(name), why: `${kind.slice(0, -1)} ${up(name)} says access ${JSON.stringify(access)}, not "open" or "restricted"` });
    }
  }
  const pv = doc.privileged;
  if (pv && typeof pv === 'object' && !Array.isArray(pv)) { feed.privileged.transactions = arr(pv.transactions); feed.privileged.jobs = arr(pv.jobs); }
  return feed;
}

// Resolve an entry point to its access ('open' | 'restricted' | null) and its authority (privileged
// or not). A loaded feed is authoritative; the site keys fill what no feed names. `declared` and
// `effectDeclared` are whether the estate has stated anything at all - the difference between
// "nothing is reachable / privileged" and "nobody said".
export function reachResolver({ feeds = [], site = {} } = {}) {
  const good = feeds.filter((f) => !f.problem);
  const set = (k) => new Set((site[k] || []).map(up));
  const openTx = set('openTransactions'), resTx = set('restrictedTransactions');
  const openJob = set('openJobs'), resJob = set('restrictedJobs');
  const privTx = new Set([...set('privilegedTransactions'), ...good.flatMap((f) => f.privileged.transactions)]);
  const privJob = new Set([...set('privilegedJobs'), ...good.flatMap((f) => f.privileged.jobs)]);
  const declared = good.some((f) => Object.keys(f.transactions).length + Object.keys(f.jobs).length) || openTx.size + resTx.size + openJob.size + resJob.size > 0;
  const effectDeclared = privTx.size + privJob.size > 0;
  const accessOf = (kind, name) => {
    const n = up(name);
    for (const f of good) { const a = f[`${kind}s`][n]; if (a) return a; }
    if (kind === 'transaction') return openTx.has(n) ? 'open' : resTx.has(n) ? 'restricted' : null;
    if (kind === 'job') return openJob.has(n) ? 'open' : resJob.has(n) ? 'restricted' : null;
    return null;
  };
  const privilegedOf = (kind, name) => (kind === 'transaction' ? privTx.has(up(name)) : kind === 'job' ? privJob.has(up(name)) : false);
  // Which record said so, for a verdict to cite: the feed with its extract and date, or the site file.
  const siteName = site.path ? basename(site.path) : 'the site file';
  const cite = (f) => `${f.file} (${f.extract}, retrieved ${f.retrieved})`;
  const accessFrom = (kind, name) => {
    const f = good.find((x) => x[`${kind}s`][up(name)]);
    return f ? cite(f) : accessOf(kind, name) ? siteName : null;
  };
  const privilegedFrom = (kind, name) => {
    const f = good.find((x) => x.privileged[`${kind}s`].includes(up(name)));
    return f ? cite(f) : privilegedOf(kind, name) ? siteName : null;
  };
  return { declared, effectDeclared, accessOf, privilegedOf, accessFrom, privilegedFrom };
}

export const entryKind = (e) => (e.transaction ? 'transaction' : e.job !== undefined ? 'job' : null);
const entryKey = (e) => (e.transaction ? e.transaction : e.job || '');
export const entryName = (e) => (e.transaction ? `transaction ${e.transaction}` : `job ${e.job || '?'} step ${e.step || '(unnamed)'}`);

// The access of one startedBy entry, whichever kind it is.
export const accessOfEntry = (e, resolver) => (entryKind(e) ? resolver.accessOf(entryKind(e), entryKey(e)) : null);
export const accessFromEntry = (e, resolver) => (entryKind(e) ? resolver.accessFrom(entryKind(e), entryKey(e)) : null);
export const privilegedFromEntry = (e, resolver) => (entryKind(e) ? resolver.privilegedFrom(entryKind(e), entryKey(e)) : null);

// Stamp `reach` on every finding an entry point reaches, and count the three ways. `open` if any
// entry that reaches it is open; `restricted` only if every entry is restricted and none went
// unlisted, since an entry nobody declared may be open; otherwise `undeclared`. A finding no entry
// reaches carries no reach - there is nothing to say.
export function stampReach(findings, resolver) {
  const by = { open: 0, restricted: 0, undeclared: 0 };
  for (const f of findings) {
    const entries = f.startedBy || [];
    if (!entries.length) continue;
    const access = entries.map((e) => accessOfEntry(e, resolver));
    f.reach = access.includes('open') ? 'open' : !f.startedByMore && access.every((a) => a === 'restricted') ? 'restricted' : 'undeclared';
    by[f.reach]++;
  }
  return by;
}

// Stamp `effect: 'privileged'` on a finding an entry the estate flags as elevated-authority reaches.
// Only the positive is claimed: an entry a privileged allow-list does not name is unknown, not
// ordinary, so it is left unstamped rather than called safe.
export function stampEffect(findings, resolver) {
  const by = { privileged: 0 };
  for (const f of findings) {
    const entries = f.startedBy || [];
    if (!entries.length) continue;
    if (entries.some((e) => entryKind(e) && resolver.privilegedOf(entryKind(e), entryKey(e)))) {
      f.effect = 'privileged';
      by.privileged++;
    }
  }
  return by;
}
