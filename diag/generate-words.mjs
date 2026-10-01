// Write lib/words.mjs from provenance/words.json and from nothing else.
//
// That constraint is the point: if a word is in the emitted file, a document named in the provenance
// record attests it. The previous list is not an input here, so it cannot leak back in.
//
// Usage: node generate-words.mjs <provenanceJson> <destMjs>
import { readFileSync, writeFileSync } from 'node:fs';

const [provPath, dest] = process.argv.slice(2);
if (!provPath || !dest) { console.error('usage: generate-words.mjs <provenanceJson> <destMjs>'); process.exit(2); }

const prov = JSON.parse(readFileSync(provPath, 'utf8'));
const of = (kind) => Object.entries(prov.words).filter(([, v]) => v.kinds.includes(kind)).map(([w]) => w).sort();

// The existing file wraps its word lists near 100 columns; keep that so a diff of a later
// regeneration is readable.
function wrap(words, width = 100) {
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && line.length + 1 + w.length > width) { lines.push(line); line = w; }
    else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

const set = (name, words, comment) =>
  `${comment ? comment + '\n' : ''}export const ${name} = new Set(\`${wrap(words)}\`.split(/\\s+/));\n`;

const layout = prov.structured?.eibLayout?.value;
const dib = prov.structured?.dibFields?.value;
const sqlca = prov.structured?.sqlcaFields?.value;
if (!layout || !dib || !sqlca) {
  console.error('provenance is missing eibLayout / dibFields / sqlcaFields; cannot generate');
  process.exit(3);
}

const layoutLines = [];
{
  let line = 'export const EIB_LAYOUT = [';
  for (const [name, pic] of layout) {
    const piece = `['${name}', '${pic}'], `;
    if (line.length + piece.length > 118) { layoutLines.push(line.trimEnd()); line = '  '; }
    line += piece;
  }
  if (line.trim()) layoutLines.push(line.trimEnd().replace(/,$/, '') + '];');
}

const sourceLines = Object.entries(prov.sources)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([id, s]) => {
    const docs = (s.documents || []).map((d) => d.topic).filter(Boolean);
    const topics = docs.length ? ` - ${[...new Set(docs)].join('; ')}` : '';
    return wrap(`${s.title || id}${topics}`.split(/\s+/), 94).split('\n').map((l, i) => `//${i ? '     ' : '   '}${l}`).join('\n');
  });

// The header test requires this as the first line of every shipped source file.
const SPDX = '// SPDX-License-Identifier: AGPL-3.0-or-later';

const out = `${SPDX}
// Words a program may use where a data name goes without declaring them. A reference the parser
// cannot resolve is checked against these before it is taken for a name nothing declares.
//
// GENERATED - do not edit by hand. Run \`node diag/generate-words.mjs\` to rebuild it from
// provenance/words.json, which records, for every word below, the document that attests it.
//
// Every word here comes from a standard or from a compiler vendor's reference for its own compiler.
// No other implementation's source code was consulted. That matters: it is what lets this file be
// licensed on the project's own terms rather than on another project's. See LICENSING.md.
//
// Attested by, retrieved ${prov.retrieved || prov.generated || 'see provenance/words.json'}:
${sourceLines.join('\n')}

${set('RESERVED_WORDS', of('reserved'))}
${set('SPECIAL_REGISTERS', of('register'))}
${set('SYSTEM_NAMES', of('systemName'))}
${set('INTRINSIC_FUNCTIONS', of('function'), '// A REPOSITORY paragraph can make these callable without the word FUNCTION.')}
${set('CONTEXT_SENSITIVE_WORDS', of('contextSensitive'),
  '// Reserved only inside the construct that gives them meaning (ISO/IEC 1989 clause 8.10). A program\n'
  + '// may legally use one as its own data name elsewhere, so they are kept apart from the words above.')}
${set('DIRECTIVE_WORDS', of('directive'),
  '// Reserved in compiler directives only (clause 8.12).')}
${set('EXCEPTION_CONDITIONS', of('condition'),
  '// Predefined exception-condition names. Not reserved words - the standard lists them separately -\n'
  + '// but a program names them in >>TURN and in EXCEPTION-OBJECT without declaring them.')}
// The EXEC interface block a CICS translator generates ahead of the program, which the program may
// reference without declaring. diag/precompiler.mjs declares these in the translator's place.
${layoutLines.join('\n')}
export const EIB_FIELDS = new Set(EIB_LAYOUT.map(([name]) => name));

// The DL/I interface block the translator generates for EXEC DLI.
${set('DIB_FIELDS', [...dib].sort())}
// The SQLCA as INCLUDE SQLCA declares it in COBOL.
${set('SQLCA_FIELDS', [...sqlca].sort())}`;

writeFileSync(dest, out.replace(/\n{3,}/g, '\n\n'), 'utf8');

console.log(`wrote ${dest}`);
console.log(`  RESERVED_WORDS      ${of('reserved').length}`);
console.log(`  SPECIAL_REGISTERS   ${of('register').length}`);
console.log(`  SYSTEM_NAMES        ${of('systemName').length}`);
console.log(`  INTRINSIC_FUNCTIONS ${of('function').length}`);
console.log(`  CONTEXT_SENSITIVE_WORDS ${of('contextSensitive').length}`);
console.log(`  DIRECTIVE_WORDS      ${of('directive').length}`);
console.log(`  EXCEPTION_CONDITIONS ${of('condition').length}`);
console.log(`  EIB_LAYOUT          ${layout.length}`);
console.log(`  DIB_FIELDS          ${dib.length}`);
console.log(`  SQLCA_FIELDS        ${sqlca.length}`);
console.log(`  sources             ${Object.keys(prov.sources).length}`);
