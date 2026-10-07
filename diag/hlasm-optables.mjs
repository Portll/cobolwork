// SPDX-License-Identifier: AGPL-3.0-or-later
// Writes rules/hlasm-optables.json: the operation code tables (OPTABLE) each machine-instruction
// mnemonic belongs to, read from IBM's HLASM 1.6 Programmer's Guide "Table of all supported
// instructions", and the MACHINE suboption each table answers to.
//   node diag/hlasm-optables.mjs [out]
import { writeFileSync } from 'node:fs';

const BASE = 'https://www.ibm.com/docs/api/v1/content/SSENW6_1.6.0/asma100';
const fetchText = async (page) => {
  const res = await fetch(`${BASE}/${page}`, { headers: { 'user-agent': 'curl/8.7.1' } });
  if (!res.ok) throw new Error(`${page}: HTTP ${res.status}`);
  return res.text();
};
const cell = (html) => html.replace(/<[^>]+>/g, '').replace(/®|&reg;/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#[0-9]+;/g, '').replace(/\s+/g, ' ').trim();
const rowsOf = (html) => [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => cell(c[1])));

const LEVELS = ['DOS', '370', 'XA', 'ESA', 'ZOP', 'YOP', 'Z9', 'Z10', 'Z11', 'Z12', 'Z13', 'Z14', 'Z15', 'Z16', 'Z17'];

const table = rowsOf(await fetchText('table_of_supported_instructions.html'));
const header = table[0];
const at = (name) => header.indexOf(name);
const mnemonics = {};
for (const row of table.slice(1)) {
  const [mnemonic, optables, format] = [row[at('Mnemonic')], row[at('Optables')], row[at('Fmt')]];
  if (!mnemonic || !optables || format === 'HLASM') continue;
  (mnemonics[mnemonic] ||= []).includes(optables) || mnemonics[mnemonic].push(optables);
}

const synonyms = {};
const machines = {};
for (const [optable, machine] of rowsOf(await fetchText('machtab.html')).slice(1)) {
  const [level, synonym] = [/^\S+/.exec(optable)[0], /synonym for (\S+)\)/.exec(optable)?.[1]];
  if (synonym) synonyms[level] = synonym;
  for (const name of machine.split(',').map((m) => m.trim().toUpperCase()).filter((m) => m && m !== '(NONE)')) machines[name] = synonym || level;
}

const out = {
  _comment: 'The operation code tables (OPTABLE) each machine-instruction mnemonic is in, as ranges of levels (UNI is the universal table; X- is X and later; X-Y a range), and the MACHINE suboption each table answers to. Facts read from IBM HLASM 1.6 Programmer\'s Guide; no IBM prose is copied. Written by diag/hlasm-optables.mjs.',
  schemaVersion: 1,
  retrieved: new Date().toISOString().slice(0, 10),
  source: {
    doc: 'High Level Assembler for z/OS & z/VM & z/VSE 1.6 Programmer\'s Guide',
    topics: ['Table of all supported instructions', 'MACHINE'],
    url: 'https://www.ibm.com/docs/en/hla-and-tf/1.6.0',
  },
  levels: LEVELS,
  synonyms,
  machines,
  mnemonics,
};
writeFileSync(process.argv[2] || new URL('../rules/hlasm-optables.json', import.meta.url), `${JSON.stringify(out, null, 1)}\n`);
console.log(`${Object.keys(mnemonics).length} mnemonics, ${Object.keys(synonyms).length} synonyms, ${Object.keys(machines).length} machine names`);
