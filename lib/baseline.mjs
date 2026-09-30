// SPDX-License-Identifier: AGPL-3.0-or-later
// Findings a person has already judged, and until when.
//
// An accepted finding that comes back on every run trains its reader to skip the report. A
// suppression that never lapses is worse: the judgement was about the code as it was, and nothing
// asks again once the code or the threat has moved on. So every suppression here carries a reason,
// a person, a time and an expiry, and one without an expiry is refused rather than applied. The
// vocabulary is commitwork's annotation contract (monitor/annotate-lib.mjs), so a judgement can
// move between the two without being reworded.
//
// A suppressed finding is not deleted. It moves out of `findings` and every count into
// `suppressed`, carrying the judgement that moved it, so a report says what it is not showing.
//
// The baseline found inside the scanned tree is the tree's own claim about itself, which is worth
// exactly as much as the rest of the tree. It may accept a defect; it may not hide tampering,
// because the finding it would hide is evidence that the tree is not to be trusted. A baseline
// passed from outside the tree can.
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tally } from './kernel/findings.mjs';
import { resolvesInside } from './kernel/source-tree.mjs';
import { printable } from './kernel/printable.mjs';

export const BASELINE_FILE = 'cobolwork.baseline.json';
export const SUPPRESSING = ['accept', 'false-positive', 'wont-fix', 'incorrect-scan-result'];
export const ACTIONS = [...SUPPRESSING, 'note', 'resolved'];

const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
// ISO 8601 only: other date forms parse differently across engines and readers.
const ISO = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const isTime = (v) => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v));
const time = (v) => Date.parse(v);

// What is wrong with one entry, or nothing.
export function validateEntry(e) {
  const errs = [];
  if (!e || typeof e !== 'object' || Array.isArray(e)) return ['entry is not an object'];
  if (!/^[0-9a-f]{32}$/.test(String(e.fingerprint || ''))) errs.push('fingerprint must be the 32 hex digits a report prints');
  if (!nonEmpty(e.rule)) errs.push('missing rule');
  if (!ACTIONS.includes(e.action)) errs.push(`action must be one of ${ACTIONS.join(', ')}`);
  if (!nonEmpty(e.reason)) errs.push('missing reason');
  if (!nonEmpty(e.who)) errs.push('missing who');
  if (!isTime(e.at)) errs.push('missing at, or not an ISO 8601 date such as 2027-01-31');
  const hasExpiry = e.expires !== undefined && e.expires !== null && e.expires !== '';
  if (hasExpiry && !isTime(e.expires)) errs.push('expires is not an ISO 8601 date such as 2027-01-31');
  else if (!hasExpiry && SUPPRESSING.includes(e.action)) {
    errs.push('a suppression needs an expires date: one that never lapses is never looked at again');
  }
  if (e.action === 'incorrect-scan-result' && !(e.defect && nonEmpty(e.defect.detail))) {
    errs.push('incorrect-scan-result must say what the scanner got wrong, in defect.detail');
  }
  return errs;
}

// { path, source, entries, problems }. An absent file is an empty baseline, not an error; an
// unreadable one is a problem the report carries, never a silent empty.
// A source tree held in memory (a git revision) supplies its own baseline file.
export function loadBaseline(root, { explicit = null, use = true, mayBeAbsent = false, tree = null } = {}) {
  if (!use) return null;
  const held = !explicit && tree && tree.kind !== 'directory';
  const path = explicit || (held ? resolve(tree.root, BASELINE_FILE) : join(root, BASELINE_FILE));
  if (held ? !tree.contains(path) : !existsSync(path)) {
    if (!explicit) return null;
    if (mayBeAbsent) return { path, source: 'explicit', entries: [], problems: [] };
    return { path, source: 'explicit', entries: [], problems: [`${path} does not exist, so nothing was suppressed`] };
  }
  const out = { path, source: explicit ? 'explicit' : 'tree', entries: [], problems: [] };
  // The tree's own baseline is the tree's, and a link out of it is not followed.
  if (!explicit && !held && !resolvesInside(root, path)) {
    out.problems.push(`${BASELINE_FILE} is a link that leads outside the tree, so nothing was suppressed`);
    return out;
  }
  let raw;
  try { raw = JSON.parse(held ? tree.bytes(path).toString('utf8') : readFileSync(path, 'utf8')); } catch (err) {
    out.problems.push(`${path} is not readable as JSON: ${printable(err.message, 120)}`);
    return out;
  }
  const entries = Array.isArray(raw?.entries) ? raw.entries : null;
  if (!entries) { out.problems.push(`${path} has no entries array`); return out; }
  entries.forEach((e, i) => {
    const errs = validateEntry(e);
    if (errs.length) out.problems.push(`entry ${i + 1}${/^[0-9a-f]{32}$/.test(String(e?.fingerprint)) ? ` (${e.fingerprint})` : ''}: ${errs.join('; ')}`);
    else out.entries.push(e);
  });
  return out;
}

// Moves what the baseline suppresses out of `findings`, recounts, and says what it did.
export function applyBaseline(report, baseline, { now = new Date().toISOString() } = {}) {
  if (!baseline) return report;
  // Compared as times: as strings, 2026-01-01T12:00-12:00 sorts before 2026-01-01T13:00Z.
  const at = time(now);
  const byPrint = new Map();
  for (const e of baseline.entries) {
    if (!byPrint.has(e.fingerprint)) byPrint.set(e.fingerprint, []);
    byPrint.get(e.fingerprint).push(e);
  }
  const open = [];
  const suppressed = [];
  const expired = [];
  const refused = [];
  const matched = new Set();
  for (const f of report.findings) {
    const mine = (byPrint.get(f.fingerprint) || []).filter((e) => e.rule === f.rule);
    for (const e of mine) matched.add(e);
    const live = mine.find((e) => SUPPRESSING.includes(e.action) && time(e.at) <= at && time(e.expires) > at);
    if (!live) {
      const lapsed = mine.find((e) => SUPPRESSING.includes(e.action) && time(e.expires) <= at);
      if (lapsed) expired.push({ fingerprint: f.fingerprint, rule: f.rule, path: f.path, line: f.line, expired: lapsed.expires, reason: lapsed.reason, who: lapsed.who });
      open.push(f);
      continue;
    }
    if (baseline.source === 'tree' && f.evidence === 'tampering') {
      refused.push({ fingerprint: f.fingerprint, rule: f.rule, path: f.path, line: f.line });
      open.push(f);
      continue;
    }
    suppressed.push({ ...f, suppressed: { action: live.action, reason: live.reason, who: live.who, at: live.at, expires: live.expires, ...(live.defect ? { defect: live.defect } : {}) } });
  }
  const stale = baseline.entries.filter((e) => !matched.has(e)).length;
  report.findings = open;
  report.suppressed = suppressed;
  const s = report.summary || (report.summary = {});
  s.findings = open.length;
  s.byRule = tally(open);
  if (s.bySeverity) { s.bySeverity = {}; for (const f of open) s.bySeverity[f.sev] = (s.bySeverity[f.sev] || 0) + 1; }
  if (s.byEvidence) { s.byEvidence = {}; for (const f of open) s.byEvidence[f.evidence] = (s.byEvidence[f.evidence] || 0) + 1; }
  if (s.byExploitability) {
    const by = Object.fromEntries(Object.keys(s.byExploitability).map((k) => [k, 0]));
    for (const f of open) if (f.exploitability) by[f.exploitability.verdict]++;
    s.byExploitability = by;
  }
  s.baseline = {
    path: baseline.path,
    source: baseline.source,
    suppressed: suppressed.length,
    // Back in the report because the judgement lapsed; each names the judgement that did.
    expired: expired.length,
    // Entries no finding matched: fixed, or changed enough to be a different finding.
    stale,
    ...(refused.length ? { refused: refused.length, refusedWhy: 'a baseline inside the scanned tree cannot hide tampering; pass one from outside the tree with --baseline' } : {}),
    ...(baseline.problems.length ? { problems: baseline.problems } : {}),
  };
  if (expired.length) report.baselineExpired = expired;
  return report;
}

// Entries accepting every finding in a report, for `cobolwork baseline`. Ones already in the
// baseline are kept as they were, so running it again never rewrites a judgement someone made.
export function baselineEntries(findings, existing = [], { action = 'accept', reason, who, expires, at = new Date().toISOString(), rules = null } = {}) {
  const have = new Set(existing.map((e) => `${e.fingerprint}|${e.rule}`));
  const added = [];
  for (const f of findings) {
    if (!f.fingerprint || (rules && !rules.includes(f.rule))) continue;
    const key = `${f.fingerprint}|${f.rule}`;
    if (have.has(key)) continue;
    have.add(key);
    added.push({ fingerprint: f.fingerprint, rule: f.rule, path: f.path, action, reason, who, at, expires });
  }
  return { entries: [...existing, ...added], added: added.length };
}
