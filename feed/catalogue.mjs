// Every rule cobolwork can report, from the registry plus diff and the credential pack,
// as one map. The feed verifiers use it to refuse a row naming a rule the engine does not have, and
// it answers how many rules there are without anyone counting by hand.
//   node feed/catalogue.mjs [--json]
import { readFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REGISTRY } from '../lib/kernel/registry.mjs';
import { DIFF_RULES } from '../lib/diff.mjs';

// The rule sets come from the registry, so a set added there appears here without anyone
// remembering to add it. diff is not a rule set - it has no scan function and never runs as
// part of one - so its table is named separately.
const TABLES = [...REGISTRY.map((s) => [s.name, s.rules]), ['diff', DIFF_RULES]];

// The credential rules are gitleaks' own format, so they are read from the TOML rather than
// imported. Only the ids matter here; gitleaks owns their meaning.
function credentialRules() {
  const toml = readFileSync(new URL('../rules/gitleaks-mainframe.toml', import.meta.url), 'utf8');
  const out = {};
  for (const m of toml.matchAll(/^\s*id\s*=\s*"([^"]+)"/gm)) {
    out[m[1]] = { sev: 'crit', cwe: 'CWE-798', text: `Credential pattern: ${m[1].replace(/-/g, ' ')}` };
  }
  return out;
}

export const CATALOGUE = new Map([...TABLES, ['credential', credentialRules()]]
  .flatMap(([set, t]) => Object.entries(t).map(([id, r]) => [id, { ...r, set, id }])));

// What the two tools' evidence holds, for the compliance mapping (diag/map-compliance.mjs): the
// run journal and its chain are one format both write and `evidence verify` reads; the options in
// force and the assumptions register are ironwork's alone.
export const EVIDENCE = new Map([
  { id: 'journal-records', tools: ['cobolwork', 'ironwork'], text: "a run journal's records, one per event: what ran and with which arguments, the inputs and DD files it read, the programs it called, where data left it, and how and when it ended" },
  { id: 'journal-chain', tools: ['cobolwork', 'ironwork'], text: 'the SHA-256 chain through each run journal and the ledger that names every run, which `cobolwork evidence verify` recomputes, so a record changed, removed or reordered after it was written is found' },
  { id: 'provenance', tools: ['cobolwork', 'ironwork'], text: 'the in-toto SLSA provenance statement of a run, naming its output and the sources it was built from by digest, the tool, and the tip of its journal' },
  { id: 'options-in-force', tools: ['ironwork'], text: "the options a compile or run used, its compliance level and dialect among them, in the provenance statement's optionsInForce and the journal's open record" },
  { id: 'assumptions-register', tools: ['ironwork'], text: "ironwork's assumptions register: for each behaviour the language leaves to the implementation, the choice made, its basis and the oracle that checks it" },
].map((e) => [e.id, e]));

export const setsOf = () => {
  const counts = new Map();
  for (const r of CATALOGUE.values()) counts.set(r.set, (counts.get(r.set) || 0) + 1);
  return counts;
};

const isMain = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMain) {
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify([...CATALOGUE.values()], null, 1));
  } else {
    for (const [set, n] of setsOf()) console.log(`${set.padEnd(12)} ${n}`);
    console.log(`${'total'.padEnd(12)} ${CATALOGUE.size}`);
  }
}
