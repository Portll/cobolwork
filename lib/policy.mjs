// SPDX-License-Identifier: AGPL-3.0-or-later
// Which findings stop a build, which run-time checks the compiler must generate, and what an
// incomplete scan means: docs/spec/build-gate.md §4. Two layers - a floor from outside the reviewed
// tree and the repository's own file - and at every key the stricter of the two applies.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ALL_RULES } from './kernel/registry.mjs';
import { resolvesInside } from './kernel/source-tree.mjs';
import { printable } from './kernel/printable.mjs';
import { CLASSES, TIERS, TIER_RANK } from './consequence.mjs';

export const POLICY_FILE = 'cobolwork.policy.json';
export const CHECKS = ['subscript', 'reference-modification', 'numeric-data', 'argument-length'];
export const COMPILERS = ['enterprise', 'gnucobol', 'gcobol'];

export const DEFAULT_POLICY = Object.freeze({
  policyVersion: 1,
  block: 'high',
  always: 'crit',
  classes: [...CLASSES],
  rules: {},
  coverage: 'block',
  options: 'warn',
  waivers: { maxDays: 180 },
  checks: ['subscript', 'reference-modification'],
  forbid: { enterprise: [], gnucobol: [], gcobol: [] },
  requireEquivalence: 'never',
  interface: 'warn',
});

export const EQUIVALENCE_MODES = ['never', 'machineAuthored', 'always'];
// How an abend from a subprogram fuzzed at its interface, with no caller run shown to pass the input,
// is gated: `warn` never blocks on it, `tier` gates it as any other finding.
export const INTERFACE_MODES = ['warn', 'tier'];

const KEYS = Object.keys(DEFAULT_POLICY);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStrings = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string' && x.trim() !== '');

// What is wrong with a policy document, or nothing. A key nobody reads and a rule id nothing
// declares are both refused: either would be a setting that silently does nothing.
export function validatePolicy(raw) {
  if (!isObject(raw)) return ['the policy is not a JSON object'];
  const errs = [];
  for (const k of Object.keys(raw)) if (!KEYS.includes(k) && k !== '_comment') errs.push(`${printable(k, 40)} is not a policy key; the keys are ${KEYS.join(', ')}`);
  if (raw.policyVersion !== 1) errs.push('policyVersion must be 1');
  for (const k of ['block', 'always']) if (k in raw && !TIERS.includes(raw[k])) errs.push(`${k} must be one of ${TIERS.join(', ')}`);
  if ('classes' in raw) {
    if (!Array.isArray(raw.classes) || raw.classes.some((c) => !CLASSES.includes(c))) errs.push(`classes must be a list drawn from ${CLASSES.join(', ')}`);
  }
  for (const k of ['coverage', 'options']) if (k in raw && !['block', 'warn'].includes(raw[k])) errs.push(`${k} must be block or warn`);
  if ('rules' in raw) {
    if (!isObject(raw.rules)) errs.push('rules must be an object of rule id to block or warn');
    else for (const [id, v] of Object.entries(raw.rules)) {
      if (!Object.hasOwn(ALL_RULES, id)) errs.push(`rules: ${printable(id, 60)} is not a rule cobolwork declares`);
      else if (!['block', 'warn'].includes(v)) errs.push(`rules: ${id} must be block or warn`);
    }
  }
  if ('waivers' in raw) {
    const w = raw.waivers;
    if (!isObject(w) || Object.keys(w).some((k) => k !== 'maxDays') || !Number.isInteger(w.maxDays) || w.maxDays < 1) {
      errs.push('waivers must be { "maxDays": <a whole number of days, at least 1> }');
    }
  }
  if ('checks' in raw) {
    if (!isStrings(raw.checks)) errs.push(`checks must be a list drawn from ${CHECKS.join(', ')}`);
    else for (const c of raw.checks) if (!CHECKS.includes(c)) errs.push(`checks: ${printable(c, 40)} is not one of ${CHECKS.join(', ')}`);
  }
  if ('requireEquivalence' in raw && !EQUIVALENCE_MODES.includes(raw.requireEquivalence)) errs.push(`requireEquivalence takes ${EQUIVALENCE_MODES.join(', ')}`);
  if ('interface' in raw && !INTERFACE_MODES.includes(raw.interface)) errs.push(`interface takes ${INTERFACE_MODES.join(', ')}`);
  if ('forbid' in raw) {
    if (!isObject(raw.forbid)) errs.push(`forbid must be an object keyed by ${COMPILERS.join(', ')}`);
    else for (const [c, list] of Object.entries(raw.forbid)) {
      if (!COMPILERS.includes(c)) errs.push(`forbid: ${printable(c, 40)} is not one of ${COMPILERS.join(', ')}`);
      else if (!isStrings(list)) errs.push(`forbid.${c} must be a list of options`);
    }
  }
  return errs;
}

// { path, raw, problems }, or null when the file is absent.
export function readPolicy(path) {
  if (!existsSync(path)) return null;
  let raw;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch (e) {
    return { path, raw: null, problems: [`${path} is not readable as JSON: ${printable(e.message, 120)}`] };
  }
  return { path, raw, problems: validatePolicy(raw).map((p) => `${path}: ${p}`) };
}

// The repository's own policy, from a tree on disk. A link out of the tree is not followed.
export function treePolicy(root) {
  const path = join(root, POLICY_FILE);
  if (!existsSync(path)) return null;
  if (!resolvesInside(root, path)) return { path, raw: null, problems: [`${POLICY_FILE} is a link that leads outside the tree`] };
  return readPolicy(path);
}

// The floor must come from outside the reviewed tree, or the change under review could write it.
export function floorPolicy(file, repo) {
  const path = resolve(file);
  if (!existsSync(path)) return { path, raw: null, problems: [`--policy ${path}: no such file`] };
  if (resolvesInside(repo, path)) return { path, raw: null, problems: [`--policy ${path} is inside the repository; a floor the change can edit is not a floor`] };
  return readPolicy(path);
}

const stricterTier = (a, b) => (TIER_RANK[a] <= TIER_RANK[b] ? a : b);
const union = (a, b) => [...new Set([...a, ...b])].sort();
// A list key the repository can add to and never shrink below the floor, or the defaults without one.
const listKey = (key, f, r, floor) => {
  const base = key in f ? f[key] : DEFAULT_POLICY[key];
  if (!(key in r)) return { value: [...base].sort(), by: key in f ? 'floor' : 'default' };
  if (!floor) return { value: [...r[key]].sort(), by: 'repository' };
  return { value: union(base, r[key]), by: key in f ? 'floor+repository' : 'default+repository' };
};

// { policy, setBy, ignored }. Without a floor the repository's file stands over the defaults. With
// one, a repository key applies only where it is at least as strict as the floor's, and each key it
// could not loosen is named in `ignored`.
export function combinePolicies({ floor = null, repository = null } = {}) {
  const f = floor || {};
  const r = repository || {};
  const setBy = {};
  const ignored = [];
  const pick = (key, stricter) => {
    const base = key in f ? f[key] : DEFAULT_POLICY[key];
    const baseBy = key in f ? 'floor' : 'default';
    if (!(key in r)) { setBy[key] = baseBy; return base; }
    if (!floor) { setBy[key] = 'repository'; return r[key]; }
    const s = stricter(base, r[key]);
    if (JSON.stringify(s) === JSON.stringify(r[key])) { setBy[key] = 'repository'; return r[key]; }
    ignored.push(key);
    setBy[key] = baseBy;
    return base;
  };
  const checks = listKey('checks', f, r, floor);
  const classes = listKey('classes', f, r, floor);
  const policy = {
    policyVersion: 1,
    block: pick('block', stricterTier),
    always: pick('always', stricterTier),
    classes: classes.value,
    coverage: pick('coverage', (a, b) => (a === 'block' || b === 'block' ? 'block' : 'warn')),
    options: pick('options', (a, b) => (a === 'block' || b === 'block' ? 'block' : 'warn')),
    waivers: pick('waivers', (a, b) => ({ maxDays: Math.min(a.maxDays, b.maxDays) })),
    checks: checks.value,
    forbid: Object.fromEntries(COMPILERS.map((c) => [c, union((f.forbid || {})[c] || [], (r.forbid || {})[c] || [])])),
    requireEquivalence: pick('requireEquivalence', (a, b) => (EQUIVALENCE_MODES.indexOf(a) >= EQUIVALENCE_MODES.indexOf(b) ? a : b)),
    interface: pick('interface', (a, b) => (a === 'tier' || b === 'tier' ? 'tier' : 'warn')),
    rules: {},
  };
  setBy.checks = checks.by;
  setBy.classes = classes.by;
  setBy.forbid = r.forbid ? (f.forbid ? 'floor+repository' : 'repository') : f.forbid ? 'floor' : 'default';
  const fr = f.rules || {};
  const rr = r.rules || {};
  for (const id of [...new Set([...Object.keys(fr), ...Object.keys(rr)])].sort()) {
    // block is always the stricter; the repository's warn stands only where the floor also says warn.
    if (rr[id] === 'block' || !floor || !(id in rr) || fr[id] === 'warn') policy.rules[id] = id in rr ? rr[id] : fr[id];
    else { policy.rules[id] = fr[id] || null; ignored.push(`rules.${id}`); }
    if (policy.rules[id] === null) delete policy.rules[id];
  }
  return { policy, setBy, ignored };
}

// Keys sorted at every level, so one policy has one hash however its file was written.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

export const policyHash = (policy) => createHash('sha256').update(canonical(policy)).digest('hex');
