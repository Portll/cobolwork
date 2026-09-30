// Write lib/cics-commands.mjs, and the tables ironwork vendors (provenance/cics-commands.tsv,
// dfhresp.tsv and dfhvalue.tsv), from provenance/precompile.json and provenance/words.json, and from
// nothing else, so every direction and number the precompiler uses has a document behind it.
//
// Usage: node diag/generate-precompile.mjs [precompileJson] [wordsJson] [destMjs] [tsvDir]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const at = (p) => fileURLToPath(new URL(p, import.meta.url));
const [provPath = at('../provenance/precompile.json'), wordsPath = at('../provenance/words.json'), dest = at('../lib/cics-commands.mjs'), tsvDir = at('../provenance')] = process.argv.slice(2);
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

const source = (id) => prov.sources[id];
const tsv = (file, header, rows) => {
  writeFileSync(join(tsvDir, file), [...header.map((h) => `# ${h}`), ...rows.map((r) => r.join('\t'))].join('\n') + '\n', 'utf8');
  console.log(`wrote ${join(tsvDir, file)}: ${rows.length} rows`);
};
const generated = "GENERATED from cobolwork's provenance/precompile.json by diag/generate-precompile.mjs; ironwork vendors this file.";

const optionRows = (command, c, doc, page) => {
  const head = [command, c.identify?.join(' ') || '-', c.default ? 'yes' : 'no'];
  const tail = [doc, page ?? '-'];
  const options = Object.entries(c.options).map(([option, [argument, direction]]) => [...head, option, argument, direction, ...tail]);
  if (c.anyOption) options.push([...head, '*', c.anyOption === 'label' ? 'label' : '-', c.anyOption === 'label' ? 'label' : '-', ...tail]);
  return options.length ? options : [[...head, '-', '-', '-', ...tail]];
};
tsv('cics-commands.tsv', [
  `The CICS commands cobolwork's precompiler translates and each option's argument type and direction, from ${source('cics-api-5.3').title}; doc is each command's CICS TS 6.x topic and page the reference's.`,
  generated,
  'A command named in several words is told from its namesakes by an identify option; default marks the one meant when none is written. Command * lists the options every command may carry, option * any condition name, and option - a command with none.',
  'command\tidentify\tdefault\toption\targument\tdirection\tdoc\tpage',
], [
  ...optionRows('*', prov.everyCommand, source(prov.everyCommand.source).url, prov.everyCommand.page),
  ...Object.entries(prov.commands).flatMap(([name, c]) => optionRows(name, c, c.doc, c.page)),
]);

const resp = [
  ...Object.entries(prov.dfhresp.values).map(([name, value]) => [name, value, source(prov.dfhresp.source).url, prov.dfhresp.page]),
  ...Object.entries(prov.dfhresp.also.values).map(([name, value]) => [name, value, source(prov.dfhresp.also.source).url, '-']),
].sort((a, b) => a[1] - b[1]);
tsv('dfhresp.tsv', [
  `The number DFHRESP(condition) stands for, as EIBRESP holds it: ${source(prov.dfhresp.source).title}, page ${prov.dfhresp.page}, and ${source(prov.dfhresp.also.source).title} for what that reference lacks.`,
  generated,
  'condition\tvalue\tsource\tpage',
], resp);

const cvda = prov.dfhvalue;
const cited = (name) => {
  const later = cvda.valueFrom[name] ?? (cvda.since[name] && `cics-cvda-${cvda.since[name]}`);
  return later ? source(later).url : `${source(cvda.source).url} pp. ${cvda.pages.join('-')}`;
};
tsv('dfhvalue.tsv', [
  `The number DFHVALUE(cvda) stands for: ${source(cvda.source).title}, pages ${cvda.pages.join('-')}, then the CVDA tables of CICS TS ${cvda.later.map((id) => id.replace('cics-cvda-', '')).join(', ')} for the names each release adds; since is the first release that lists a name.`,
  cvda.notes,
  generated,
  'cvda\tvalue\tsince\tsource',
], Object.entries(cvda.values).map(([name, value]) => [name, value, cvda.since[name] ?? '≤5.3', cited(name)]));
