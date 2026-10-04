// SPDX-License-Identifier: AGPL-3.0-or-later
// Vendor rule packs: the verbs a particular product brings to an estate, loaded only by the shops
// that run it.
//
// Per-product loading is the feature. The commonest complaint about enterprise static analysis is
// noise from rules for things the shop does not have, so a pack that nobody names does not load,
// and a scan without it is identical to a scan from before it existed.
//
// The second control is about honesty rather than noise, and it has two halves that are commonly
// confused:
//
//   corpus measurement       answers "is this quiet?"  - run the pack over hundreds of real
//                            repositories and count how often each rule fires. An over-broad
//                            pattern shows up immediately as a rule that fires everywhere.
//
//   practitioner review      answers "is this true?"   - someone who has administered the product
//                            confirms the verb does what the rationale says it does.
//
// A corpus cannot establish the second. If a rule asserts that a GSO record is an installation-wide
// option and that is wrong, a thousand repositories will report it quietly and wrongly all day. A
// practitioner cannot cheaply establish the first. So a pack records both, loads on either, and
// the summary always names which one it is missing.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { printable } from './kernel/printable.mjs';

const PACK_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'rules', 'packs');

// Where packs are read from. Overridable, and the reason is worth stating: the tests for the
// validation gate used the shipped packs as their fixture, so the day a pack was measured and
// became validated, three tests of the refusal mechanism failed - not because the mechanism broke
// but because its fixture had graduated. A gate has to be testable independently of what happens
// to be standing in front of it.
export function availablePacks(packDir = PACK_DIR) {
  if (!existsSync(packDir)) return [];
  return readdirSync(packDir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
}

// The site file naming a pack is the tree's to write, so a name must be a file in the pack directory.
export function readPack(name, packDir = PACK_DIR) {
  const path = join(packDir, name + '.json');
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(name) || !existsSync(path)) return { name, problems: [`no pack named '${printable(name, 60)}'; available: ${availablePacks(packDir).join(', ') || 'none'}`] };
  try {
    const pack = JSON.parse(readFileSync(path, 'utf8'));
    if (!pack || typeof pack !== 'object' || Array.isArray(pack)) return { name, problems: [`pack '${name}' is not a JSON object`] };
    return { ...pack, name, problems: [] };
  } catch (e) {
    return { name, problems: [`pack '${name}' is not readable as JSON: ${printable(e.message, 120)}`] };
  }
}

// What a pack has been through, in the terms that matter. Neither form of validation implies the
// other, so both are reported and the missing one is always named.
export function validationOf(pack) {
  const v = pack.validation || {};
  const corpus = v.corpus && v.corpus.repositories > 0 ? v.corpus : null;
  const practitioner = v.practitioner && v.practitioner.by ? v.practitioner : null;
  const missing = [];
  if (!corpus) missing.push('no corpus measurement: how often these rules fire on real code is unknown, so their noise is unknown');
  if (!practitioner) missing.push(`no practitioner review: nobody who has administered ${pack.product || pack.name} has confirmed the risk statements, so their correctness is unknown`);
  return { corpus, practitioner, missing, any: !!(corpus || practitioner) };
}

// What loaded, what did not, and why. A caller that asked for a pack and silently got nothing
// would scan less than it thinks it scanned, which is the failure this whole project is about.
export function loadPacks(names = [], { allowUnvalidated = false, packDir = PACK_DIR } = {}) {
  const loaded = [];
  const refused = [];
  const problems = [];
  const caveats = [];

  for (const name of names) {
    const pack = readPack(name, packDir);
    if (pack.problems.length) { problems.push(...pack.problems); continue; }
    const bad = packProblems(pack);
    if (bad.length) { problems.push(...bad); continue; }
    const v = validationOf(pack);
    if (!v.any && !allowUnvalidated) {
      refused.push({
        name,
        why: `pack '${name}' has had neither a corpus measurement nor a practitioner review, so nothing is known about either its noise or its correctness. `
          + 'Set allowUnvalidatedPacks in the site configuration to load it anyway.',
      });
      continue;
    }
    // Loading on partial validation is allowed, and never silent.
    for (const m of v.missing) caveats.push(`${name}: ${m}`);
    loaded.push({ ...pack, validation: v });
  }
  return { loaded, refused, problems, caveats };
}

// Where a pack rule may match. A utility that reaches the product is named on the EXEC statement;
// what it is told to do is in the stream below it. Both are needed, and a rule scoped to only one
// of them cannot match the other.
export const SCOPES = ['jcl-step', 'jcl-instream'];

// A rule scoped to something no scanner reads can never fire, and a rule that never fires looks
// exactly like a rule that is admirably quiet. One shipped that way already - a pattern matching
// the batch interface program, scoped to in-stream data where a program name never appears - so
// the scope is checked rather than trusted.
export function packProblems(pack) {
  const problems = [];
  if (pack.rules !== undefined && !(Array.isArray(pack.rules) && pack.rules.every((r) => r && typeof r === 'object' && typeof r.pattern === 'string'
    && (r.appliesTo === undefined || (Array.isArray(r.appliesTo) && r.appliesTo.every((x) => typeof x === 'string')))))) {
    return [`${pack.name}: rules must be an array of objects, each with a pattern`];
  }
  if (pack.programs !== undefined && !(Array.isArray(pack.programs) && pack.programs.every((x) => typeof x === 'string'))) {
    return [`${pack.name}: programs must be an array of names`];
  }
  for (const r of pack.rules || []) {
    const scopes = r.appliesTo || ['jcl-instream'];
    for (const sc of scopes) if (!SCOPES.includes(sc)) problems.push(`${pack.name}:${r.id}: unknown scope '${sc}'`);
    if (!scopes.length) problems.push(`${pack.name}:${r.id}: no scope, so it can never match anything`);
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- a shipped pack's pattern, checked here to compile
    try { new RegExp(r.pattern, r.flags || 'i'); } catch (e) { problems.push(`${pack.name}:${r.id}: ${e.message}`); }
    if (r.setsContext && !r.setsContextPattern) problems.push(`${pack.name}:${r.id}: setsContext without a pattern that sets it`);
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- a shipped pack's pattern, checked here to compile
    if (r.setsContextPattern) { try { new RegExp(r.setsContextPattern, 'i'); } catch (e) { problems.push(`${pack.name}:${r.id}: setsContextPattern ${e.message}`); } }
    // A rule that waits for a context nothing in the pack sets can never fire, which is the same
    // failure as an unknown scope and is caught the same way.
    if (r.requiresContext && !(pack.rules || []).some(x => x.setsContext === r.requiresContext)) {
      problems.push(`${pack.name}:${r.id}: requires context '${r.requiresContext}' that no rule in this pack sets`);
    }
  }
  return problems;
}

// The programs a loaded pack's product supplies. A step running one of these is running the
// vendor's own utility, not a program the repository forgot to include, so the unresolved-program
// rule should be quiet about it - but only for an estate that actually loaded the pack.
export function programsOf(packs) {
  return new Set(packs.flatMap((p) => (p.programs || []).map((x) => x.toUpperCase())));
}

// A pack's rules compiled once.
export function compilePack(pack) {
  return (pack.rules || []).map((r) => ({
    ...r,
    pack: pack.name,
    vendor: pack.vendor,
    product: pack.product,
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- a shipped pack's pattern; test/hostile times each one
    re: new RegExp(r.pattern, r.flags || 'i'),
    appliesTo: r.appliesTo || ['jcl-instream'],
    // A rule may declare that it only means what it says once an earlier line has put the stream
    // into a mode, and a rule may be the thing that sets that mode.
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- a shipped pack's pattern; test/hostile times each one
    setsContextRe: r.setsContext && r.setsContextPattern ? new RegExp(r.setsContextPattern, 'i') : null,
  }));
}
