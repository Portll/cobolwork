// Write lib/enterprise-options.mjs and provenance/enterprise-options.tsv from
// provenance/enterprise-options.json, and from nothing else, so every compiler-option spelling the
// gate reads, and every one ironwork vendors, has IBM's table behind it.
//
// Usage: node diag/generate-options.mjs [optionsJson] [destMjs] [destTsv]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const [provPath = at('../provenance/enterprise-options.json'), destMjs = at('../lib/enterprise-options.mjs'), destTsv = at('../provenance/enterprise-options.tsv')] = process.argv.slice(2);
const prov = JSON.parse(readFileSync(provPath, 'utf8'));

const turnsOff = (o, s) => s.startsWith('NO') && !o.name.split('/').includes(s);
const spellings = prov.options.flatMap((o) => o.spellings.map((s) => `  ${JSON.stringify(s)}: [${JSON.stringify(o.name)}, ${turnsOff(o, s)}],`));
const placement = prov.options
  .filter((o) => !o.process || o.firstProgramOnly || !o.installationDefault)
  .map((o) => {
    const rules = [!o.process && 'process: false', o.firstProgramOnly && 'firstProgramOnly: true', !o.installationDefault && 'installationDefault: false'].filter(Boolean);
    return `  ${JSON.stringify(o.name)}: { ${rules.join(', ')} },`;
  });

const mjs = `// SPDX-License-Identifier: AGPL-3.0-or-later
// Enterprise COBOL's compiler options: every spelling each one answers to, and where it may be given.
//
// GENERATED - do not edit by hand. Run \`node diag/generate-options.mjs\` to rebuild it from
// provenance/enterprise-options.json, which names the IBM table and page behind each row.

// Each spelling's option, and whether the spelling turns the option off.
export const OPTION_SPELLINGS = {
${spellings.join('\n')}
};

// The options with a rule on where they may be given: not in a CBL or PROCESS statement (process),
// in one only before a batch compilation's first program (firstProgramOnly), or not as an
// installation default (installationDefault). Every other option may be given anywhere.
export const OPTION_PLACEMENT = {
${placement.join('\n')}
};
`;

const yes = (b) => (b ? 'yes' : 'no');
const rows = prov.options.map((o) => [o.name, o.negative || '-', o.spellings.join(' '), yes(o.process), yes(o.firstProgramOnly), yes(o.installationDefault), o.page].join('\t'));
const tsv = `# Enterprise COBOL's compiler options, from ${prov.source.title} (${prov.source.number}), ${prov.source.table}.
# GENERATED from cobolwork's provenance/enterprise-options.json by diag/generate-options.mjs; ironwork vendors this file.
# option\tnegative\tspellings\tprocess\tfirst-program-only\tinstallation-default\tpage
${rows.join('\n')}
`;

writeFileSync(destMjs, mjs);
writeFileSync(destTsv, tsv);
