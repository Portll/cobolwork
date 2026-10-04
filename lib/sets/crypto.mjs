// SPDX-License-Identifier: AGPL-3.0-or-later
// What a program asks ICSF for. A COBOL program reaches z/OS cryptography by CALLing an ICSF
// callable service with positional arguments, and the strength it gets is in those arguments: the
// key length it generates, the hash it names in a rule array, the initialization vector it passes.
// rules/icsf-services.json holds each service's parameters in order, from IBM's manual, and which
// keywords each rule reports and why.
//
// An argument is judged by the literals that can reach it (lib/constants.mjs). One a computation, a
// read or another program fills is not judged, and is counted as undecided rather than passed.
import { readFileSync } from 'node:fs';
import { inScope, isProgram, relPath } from '../sources.mjs';
import { report } from '../kernel/ruleset.mjs';
import { treeFor, noteUnread, noteUnparsed } from '../kernel/source-tree.mjs';
import { eachWithinMemory } from '../kernel/memory.mjs';
import { constantsReaching, keywordsOf } from '../constants.mjs';

const TABLE = JSON.parse(readFileSync(new URL('../../rules/icsf-services.json', import.meta.url), 'utf8'));

export const CRYPTO_RULES = {
  'icsf-single-length-des-key': {
    sev: 'high', evidence: 'construct', cwe: 'CWE-327',
    text: 'A program generates a single-length DES key through ICSF',
    impact: 'The key is 56 bits, which exhaustive search recovers, and every later encipher with it runs single DES, so the data it protects is readable by anyone who takes the ciphertext',
    remedy: 'Generate an AES key (key_type_1 AESDATA with KEYLN16 or longer, or CSNBKGN2) and encipher with CSNBSAE or CSNBSYE and AES',
  },
  'icsf-weak-hash': {
    sev: 'med', evidence: 'construct', cwe: 'CWE-328',
    text: 'A program hashes with MD5 or SHA-1 through ICSF',
    impact: 'Collisions are practical for both, so a digest no longer shows the text was not changed, and an MD5 or SHA-1 of a password is quick to reverse for a short one',
    remedy: 'Name SHA-256 or longer in the rule array, or BCRYPT for a password',
  },
  'icsf-fixed-initialization-vector': {
    sev: 'med', evidence: 'construct', cwe: 'CWE-1204',
    text: 'A program enciphers through ICSF with an initialization vector that never changes',
    impact: 'Equal messages encipher to equal ciphertext, and under CUSP or IPS a message shorter than a block is XORed with the same keystream every time, so whoever sees the ciphertexts learns which are equal and can recover short ones',
    remedy: 'Pass a vector generated for each message (CSNBRNG, or CSNBRNGL) and send it with the ciphertext',
  },
};

// Every name a service answers to, 31- and 64-bit, CSF and ALET forms, to its entry.
const SERVICES = new Map();
for (const s of TABLE.services) {
  const a = s.entry_points || {};
  const names = [s.name, ...(a['31-bit'] || []), ...(a['64-bit'] || []), ...((a.alet && a.alet['31-bit']) || []), ...((a.alet && a.alet['64-bit']) || [])];
  for (const n of names) SERVICES.set(n.toUpperCase(), s);
}
const F = TABLE.findings;
const ruleFor = { 'single-length-des-key': 'icsf-single-length-des-key', 'weak-hash': 'icsf-weak-hash' };
const isIcsf = (c) => SERVICES.has(String(c.name || '').toUpperCase());

const argument = (call, service, parameter) => {
  const i = service.parameters.indexOf(parameter);
  return i >= 0 && call.using[i] && call.using[i].word ? call.using[i].word : null;
};
const shown = (values) => [...new Set(values.map((v) => (/^[A-Z-]+$/.test(v) ? v : `'${v.trim()}'`)))].join(', ');

export function scanCrypto(root, opts = {}) {
  const tree = treeFor(root, opts);
  const files = tree.list().filter(isProgram).filter(inScope(opts));
  const findings = [];
  const stats = { filesScanned: 0, filesUnreadable: 0, filesUnparsed: 0, icsfCalls: 0, argumentsUndecided: 0 };

  const run = eachWithinMemory(files, (f) => {
    let src;
    try { src = tree.text(f).text; } catch (e) { noteUnread(stats, tree, f, e); return 0; }
    if (!/CALL\s+['"]?CS[NF]/i.test(src)) return src.length;
    let r;
    try { r = tree.parse(f, src); } catch (e) { noteUnparsed(stats, tree, f, e); return src.length; }
    stats.filesScanned++;
    const path = relPath(root, f);
    for (const p of r.programs) {
      for (const c of p.calls || []) {
        const service = SERVICES.get(String(c.name || '').toUpperCase());
        if (!service || c.kind !== 'L') continue;
        stats.icsfCalls++;
        const at = { path: c.file ? relPath(root, c.file) : path, line: c.line || 1, program: p.id };
        const read = (parameter) => {
          const name = argument(c, service, parameter);
          if (!name) return null;
          const got = constantsReaching(p, name, { ignoreCall: isIcsf });
          return { name, ...got, keywords: keywordsOf(got.values) };
        };

        for (const [key, rule] of Object.entries(ruleFor)) {
          const fd = F[key];
          if (!fd.services.includes(service.name)) continue;
          const arg = read(fd.parameter);
          if (!arg) continue;
          const weak = fd.keywords.filter((k) => arg.keywords.has(k));
          if (!weak.length) { if (arg.open || !arg.values.length) stats.argumentsUndecided++; continue; }
          findings.push({ rule, ...at,
            detail: `CALL '${c.name}' passes ${arg.name} as ${fd.parameter}, and ${arg.name} can hold ${weak.join(' or ')}` });
        }

        const iv = F['fixed-initialization-vector'];
        if (!iv.services.includes(service.name)) continue;
        const rules = read('rule_array');
        if (rules && iv.withoutVector.some((k) => rules.keywords.has(k))) continue;
        const vector = read(iv.parameter);
        if (!vector) continue;
        if (vector.open || !vector.values.length) { stats.argumentsUndecided++; continue; }
        findings.push({ rule: 'icsf-fixed-initialization-vector', ...at,
          detail: `CALL '${c.name}' passes ${vector.name} as its initialization vector, and nothing but ${shown(vector.values)} is ever put in it` });
      }
    }
    return src.length;
  }, { label: 'crypto', maxBytes: opts.maxSourceBytes ?? Infinity });

  return report('crypto', { rules: CRYPTO_RULES, findings, stats, run });
}
