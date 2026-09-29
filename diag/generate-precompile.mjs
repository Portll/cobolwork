// Write lib/cics-commands.mjs from provenance/precompile.json and provenance/words.json, and from
// nothing else, so every direction and number the precompiler uses has a document behind it.
//
// Usage: node diag/generate-precompile.mjs [precompileJson] [wordsJson] [destMjs]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const [provPath = at('../provenance/precompile.json'), wordsPath = at('../provenance/words.json'), dest = at('../lib/cics-commands.mjs')] = process.argv.slice(2);
const prov = JSON.parse(readFileSync(provPath, 'utf8'));
const { dfhaid, dfhbmsca } = JSON.parse(readFileSync(wordsPath, 'utf8')).structured;

const direction = (o) => Object.fromEntries(Object.entries(o).map(([name, [, dir]]) => [name, dir]));
const commands = Object.entries(prov.commands).map(([name, c]) => {
  const entry = {
    ...(c.identify ? { identify: c.identify } : {}),
    ...(c.default ? { default: true } : {}),
    ...(c.anyOption ? { anyOption: c.anyOption } : {}),
    options: direction(c.options),
    ...(c.defaults ? { defaults: c.defaults } : {}),
  };
  return `  ${JSON.stringify(name)}: ${JSON.stringify(entry)},`;
});
const wrap = (items, indent) => {
  const lines = [];
  let line = '';
  for (const item of items) {
    if (line && line.length + 1 + item.length > 98) { lines.push(indent + line); line = item; } else line = line ? `${line} ${item}` : item;
  }
  if (line) lines.push(indent + line);
  return lines.join('\n');
};
const numbers = (values) => wrap(Object.entries(values).map(([k, v]) => `${k}: ${v},`), '  ');
const words = (list) => `\`\n${wrap(list, '')}\`.split(/\\s+/).filter(Boolean)`;

const out = `// SPDX-License-Identifier: AGPL-3.0-or-later
// The CICS commands lib/precompile.mjs translates, with the direction each option's data moves, and
// the numbers DFHRESP and DFHVALUE stand for.
//
// GENERATED - do not edit by hand. Run \`node diag/generate-precompile.mjs\` to rebuild it from
// provenance/precompile.json, which names the IBM document and page behind each entry, and from
// provenance/words.json for the DFHAID and DFHBMSCA names.

// Per command: the option words that tell it from a namesake (identify), whether it is the one meant
// when none of them is written (default), each option's direction, and the record an omitted option
// defaults to, named from another option's argument (defaults).
export const CICS_COMMANDS = {
${commands.join('\n')}
};

// Options any command may carry.
export const CICS_EVERY_COMMAND = ${JSON.stringify(direction(prov.everyCommand.options))};

export const DFHRESP = {
${numbers({ ...prov.dfhresp.values, ...prov.dfhresp.also.values })}
};

export const DFHVALUE = {
${numbers(prov.dfhvalue.values)}
};

export const DFHAID_NAMES = ${words(dfhaid.value)};
export const DFHBMSCA_NAMES = ${words(dfhbmsca.value)};
`;

writeFileSync(dest, out, 'utf8');
console.log(`wrote ${dest}: ${commands.length} commands, ${Object.keys(prov.dfhresp.values).length + 1} RESP names, ${Object.keys(prov.dfhvalue.values).length} CVDAs`);
