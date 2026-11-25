// SPDX-License-Identifier: AGPL-3.0-or-later
// Screens clones of the CBT Tape mirror (github.com/CBTTape, fetched by diag/cbt-clone.sh) and
// admits their assembler to a corpus: a whole CBT file is excluded when its terms restrict commercial, for-profit or
// personal use or claim proprietary rights; a member is excluded when it carries an IBM or vendor
// notice. Admitted assembler is deduplicated by content against the dev and heldout splits
// of an existing corpus, when one is named, and split by CBT file: file number mod 3 == 0 held out.
//   node diag/cbt-screen.mjs <clones-dir> <out-corpus> [--existing <corpus>] [--dry]
// Writes <out-corpus>/{cbt-dev,cbt-heldout,members} and manifest.json; --dry writes manifest.dry.json only.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, dirname, basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { kindOfBytes } from '../lib/sources.mjs';
import { readHlasm } from '../lib/hlasm.mjs';

const args = process.argv.slice(2);
const dryAt = args.indexOf('--dry');
const dry = dryAt >= 0;
if (dry) args.splice(dryAt, 1);
const existingAt = args.indexOf('--existing');
const EXISTING = existingAt < 0 ? null : args.splice(existingAt, 2)[1];
const [REPOS, OUT] = args;
if (!REPOS || !OUT) { console.error('usage: cbt-screen.mjs <clones-dir> <out-corpus> [--existing <corpus>] [--dry]'); process.exit(2); }

const FILE_RESTRICTIONS = [
  ['non-commercial', /\bnon[- ]?commercial\s+(?:use|purposes?)\b/i],
  ['not-for-profit', /\bnot[- ]for[- ]profit\s+(?:use|purposes?)\b/i],
  ['commercial use barred', /\bcommercial\s+use\s+(?:is\s+)?(?:prohibited|not\s+permitted|forbidden|requires)\b/i],
  ['commercial use priced', /\bfor\s+(?:normal\s+)?commercial\s+use,?\s+the\s+(?:cost|price|fee)\b/i],
  ['not in commercial products', /\b(?:used|included)\s*,?\s*(?:fully\s+or\s+in\s+part\s*,?\s*)?in\s+(?:any\s+other|a\s+commercial|any\s+commercial|commercial|a\s+paid)\s+products?\b|\binto\s+a\s+paid\s+product\b/i],
  ['not to be given to other companies', /\b(?:must|may|shall)\s+not\s+be\s+(?:sold,?\s+)?(?:given|distributed|transferred|provided)[^.]{0,60}?\bother\s+(?:company|companies|data\s+centers?|installations?|organi[sz]ations?)\b/i],
  ['licence to a named party', /\blicen[cs]e\s+is\s+(?:hereby\s+)?granted\s+to\s+(?!(?:distribute|use|copy|modify|anyone|everyone|all|any)\b)[A-Z]/i],
  ['hobbyist licence', /\bhobbyist"?\s+(?:licen[cs]es?|use)\b/i],
  ['reproduction barred', /\bno\s+part\s+of\s+this\s+(?:program|publication|software|code|material)\s+may\s+be\s+reproduced\b/i],
  ['permission for members or internal use only', /\bpermission\s+is\s+(?:hereby\s+)?granted\s+to\s+members\s+of\b|\bsolely\s+for\s+internal\s+(?:distribution|use)\b/i],
  ['personal use only', /\bpersonal\s+use\s+only\b|\bfor\s+personal\s+use\b/i],
  ['property of a third party', /\b(?:is|are)\s+the\s+(?:sole\s+|exclusive\s+)?property\s+of\s+(?!IBM\b)/i],
  ['licensed materials of a third party', /\bLICENSED\s+MATERIALS?[\s,-]+(?:PROGRAM[\s,-]+)?PROPERTY\s+OF\s+(?!IBM\b)/i],
  ['proprietary or confidential', /\b(?:proprietary|confidential)\s+(?:and\s+(?:confidential|proprietary)|information|material|software|program)\b|\btrade\s+secrets?\b/i],
  ['no disassembly or reverse engineering', /\bnot\s+(?:be\s+)?(?:disassembled|decompiled|reverse[- ]engineered)\b/i],
  ['shareware or trial', /\bshareware\b|\btrial\s+(?:period|version|copy)\b|\bevaluation\s+(?:copy|version|only)\b/i],
];

const IBM_NOTICE = /\bPROPERTY\s+OF\s+IBM\b|\bRESTRICTED\s+MATERIALS?\s+OF\s+IBM\b|\bLICENSED\s+MATERIALS?\s*-\s*PROGRAM\s+PROPERTY\b|\bCOPYRIGHT\s+(?:\(C\)\s*)?(?:IBM|INTERNATIONAL\s+BUSINESS\s+MACHINES)\b|\b(?:IBM|INTERNATIONAL\s+BUSINESS\s+MACHINES)\s+CORP(?:ORATION|\.)?,?\s+(?:19|20)\d\d\b|\(C\)\s*(?:COPYRIGHT\s+)?IBM\b|\bCOPYRIGHT\b.{0,40}\bIBM\s+(?:UK|UNITED\s+KINGDOM|DEUTSCHLAND|FRANCE|JAPAN|CANADA|AUSTRALIA|WORLD\s+TRADE)\b/i;
const PROGRAM_NUMBER_NOTICE = /\b5[67]\d\d-[A-Z0-9]{3}\b.{0,80}\b(?:COPYRIGHT|LICENSED|PROPERTY)\b|\b(?:COPYRIGHT|LICENSED|PROPERTY)\b.{0,80}\b5[67]\d\d-[A-Z0-9]{3}\b/i;
const VENDORS = String.raw`(?:COMPUTER\s+ASSOCIATES|CA,?\s+INC|CA\s+TECHNOLOGIES|BROADCOM|BMC\s+SOFTWARE|COMPUWARE|CANDLE\s+CORP(?:ORATION)?|BOOLE\s*&?\s*BABBAGE|LEGENT|STERLING\s+SOFTWARE|SYNCSORT|PRECISELY|ROCKET\s+SOFTWARE|MACRO\s?4|CHICAGO-SOFT|TONE\s+SOFTWARE|SOFTWARE\s+AG|INNOVATION\s+DATA|NEON\s+SYSTEMS|MICRO\s+FOCUS|AMDAHL|SAS\s+INSTITUTE|FUJITSU|HITACHI|UNISYS|STORAGE\s+TECHNOLOGY|STORAGETEK|EMC\s+CORP|ORACLE|MICROSOFT|SUN\s+MICROSYSTEMS|SIEMENS|LANDMARK\s+SYSTEMS|ALLEN\s+SYSTEMS|BETA\s+SYSTEMS|OPENTECH|NEW\s*ERA\s+SOFTWARE|TREHAN|PHOENIX\s+SOFTWARE|MAINSTAR|VANGUARD\s+INTEGRITY|ISIS\s+PAPYRUS|SOFTWARE\s+ENGINEERING\s+OF\s+AMERICA|FUTURITY\s+SOFTWARE|AUTOMATED\s+SOFTWARE\s+TOOLS|YCOS|BANKNET\s+TECHNOLOGIES|MD-PALADIN|CONCENTRATED\s+LOGIC)`;
const VENDOR_NOTICE = new RegExp(String.raw`\bCOPYRIGHT\b[^\n]{0,60}\b${VENDORS}\b|\b${VENDORS}\b[^\n]{0,60}\bCOPYRIGHT\b|\bUSE\s+(?:IS\s+)?PERMISSIBLE\s+BY\s+LICEN[CS]E\s+ONLY\b`, 'i');
const RIGHTS_RESERVED = /\bALL\s+RIGHTS\s+RESERVED\b/i;

const SKIP_DIRS = new Set(['.git', '.zigi']);
const SKIP_NAMES = /^(?:cbt2git\.log|\.gitattributes|\.gitignore)$/i;
const BINARY_EXT = new Set(['.xmi', '.xmit', '.pdf', '.doc', '.docx', '.odt', '.pptx', '.ppt', '.xls', '.xlsx', '.zip', '.gz', '.tgz', '.bin', '.exe', '.dll', '.jpg', '.jpeg', '.png', '.gif', '.aws', '.het', '.load', '.obj']);
const MEMBER = /^[A-Z$#@_][A-Z0-9$#@_]{0,62}$/;
// Admission applies the scanner's extensionless sniff (lib/sources.mjs kindOfHead) to the whole
// member rather than its first 4 KB, because a long prologue hides a program's first section from
// the head; members the head sniff misses are counted. JCL, COBOL, copybooks and IEBUPDTE streams
// that hold assembler stay out.
const OTHER_KINDS = new Set(['jcl', 'program', 'copybook', 'bms']);
const SECTION_OR_MACRO = /^[^*\s]*[ \t]+(?:CSECT|RSECT|START|MACRO)(?=\s|$)/m;
const STORAGE_OR_BASE = /^[^*\s]*[ \t]+(?:USING|DC|DS|BALR|BASR|STM|STMG|MEND)(?=\s|$)/m;
const IEBUPDTE = /^\.\/\s+(?:ADD|REPL|CHANGE|REPRO)\s/m;

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && !SKIP_NAMES.test(e.name)) out.push(p);
  }
  return out;
}

// Notices sit in box comments and on cards, where comment marks, box edges and the sequence field
// in columns 73-80 split a phrase across lines. Matching runs on the text with those removed and
// the lines joined.
const SEQUENCE = /^\s*(?:[A-Z0-9$#@]{1,8}|FILE\s+\d{1,4})?\s*$/i;
function normalise(text) {
  return text.split(/\r?\n/).map((line) => {
    const card = line.length > 72 && SEQUENCE.test(line.slice(72)) ? line.slice(0, 72) : line;
    return card.replace(/\/\*|\*\/|^\s*\/\/\*|^\s*\.\*/g, ' ').replace(/[*|]+/g, ' ');
  }).join(' ').replace(/\s+/g, ' ');
}
const firstLine = (flat, re) => {
  const m = re.exec(flat);
  return m ? flat.slice(Math.max(0, m.index - 60), m.index + 100).trim() : null;
};
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const seen = new Set();
if (EXISTING) for (const split of ['dev', 'heldout']) for (const f of walk(join(EXISTING, split))) seen.add(sha(readFileSync(f)));
const existingHashes = seen.size;

if (!dry) for (const d of ['cbt-dev', 'cbt-heldout', 'members']) rmSync(join(OUT, d), { recursive: true, force: true });

const manifest = {
  built: new Date().toISOString(),
  rule: 'whole file out on restrictive or proprietary terms, member out on an IBM or vendor notice',
  source: 'github.com/CBTTape (cbt2git mirror of cbttape.org), shallow clones',
  dedup: `sha256 against the existing corpus's dev+heldout (${existingHashes} files), then CBT files in name order`,
  split: 'CBT file number mod 3 == 0 -> cbt-heldout, else cbt-dev',
  phrases: { file: FILE_RESTRICTIONS.map(([k, re]) => `${k}: ${re.source}`), member: [IBM_NOTICE.source, PROGRAM_NUMBER_NOTICE.source, VENDOR_NOTICE.source] },
  totals: {},
  excludedFiles: {},
  excludedMembers: {},
  rightsReservedKept: {},
  admitted: { 'cbt-dev': {}, 'cbt-heldout': {} },
};
const t = { repos: 0, members: 0, binary: 0, ebcdic: 0, excludedFiles: 0, membersInExcludedFiles: 0, ibmMembers: 0, vendorMembers: 0, assembler: 0, sniffMissed: 0, sniffMissedExamples: [], iebupdteStreams: 0, duplicates: 0, notHlasm: 0, admitted: 0, admittedBytes: 0 };

for (const repo of readdirSync(REPOS).sort()) {
  const dir = join(REPOS, repo);
  if (!statSync(dir).isDirectory()) continue;
  t.repos++;
  const paths = walk(dir);
  const texts = new Map();
  for (const p of paths) {
    if (BINARY_EXT.has(extname(p).toLowerCase())) { t.binary++; continue; }
    const buf = readFileSync(p);
    if (buf.subarray(0, 4096).includes(0)) { t.binary++; continue; }
    texts.set(p, buf);
  }
  const reasons = [];
  const flats = new Map([...texts].map(([p, buf]) => [p, normalise(buf.toString('latin1'))]));
  for (const [p, text] of flats) {
    for (const [label, re] of FILE_RESTRICTIONS) {
      const line = firstLine(text, re);
      if (line) reasons.push({ label, member: relative(dir, p), line });
    }
  }
  const members = [...texts.keys()].filter((p) => basename(p) !== 'README.md');
  t.members += members.length;
  if (reasons.length) {
    t.excludedFiles++;
    t.membersInExcludedFiles += members.length;
    manifest.excludedFiles[repo] = reasons.slice(0, 5);
    continue;
  }
  const number = Number(repo.replace(/\D/g, ''));
  const split = number % 3 === 0 ? 'cbt-heldout' : 'cbt-dev';
  const kept = [];
  for (const p of members) {
    const text = flats.get(p);
    const ibm = firstLine(text, IBM_NOTICE) || firstLine(text, PROGRAM_NUMBER_NOTICE);
    const vendor = !ibm && firstLine(text, VENDOR_NOTICE);
    if (ibm || vendor) {
      ibm ? t.ibmMembers++ : t.vendorMembers++;
      (manifest.excludedMembers[repo] ||= []).push({ member: relative(dir, p), notice: ibm ? 'ibm' : 'vendor', line: ibm || vendor });
      continue;
    }
    const reserved = firstLine(text, RIGHTS_RESERVED);
    if (reserved) (manifest.rightsReservedKept[repo] ||= []).push({ member: relative(dir, p), line: reserved });
    kept.push(p);
  }
  let admitted = 0;
  let statements = 0;
  for (const p of kept) {
    const buf = texts.get(p);
    const sniffed = kindOfBytes(buf);
    if (OTHER_KINDS.has(sniffed)) continue;
    const whole = buf.toString('latin1');
    if (IEBUPDTE.test(whole)) { t.iebupdteStreams++; continue; }
    if (!SECTION_OR_MACRO.test(whole) || !STORAGE_OR_BASE.test(whole)) continue;
    const r = readHlasm(whole);
    if (r.kind !== 'hlasm') { t.notHlasm++; continue; }
    t.assembler++;
    if (sniffed !== 'hlasm') { t.sniffMissed++; if (t.sniffMissedExamples.length < 12) t.sniffMissedExamples.push(`${repo}/${relative(dir, p)}`); }
    const hash = sha(buf);
    if (seen.has(hash)) { t.duplicates++; continue; }
    seen.add(hash);
    admitted++;
    statements += r.statements;
    t.admittedBytes += buf.length;
    if (!dry) {
      const to = join(OUT, split, repo, `${relative(dir, p)}${extname(p) ? '' : '.asm'}`);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, buf);
    }
  }
  if (!admitted) continue;
  t.admitted += admitted;
  let libraryMembers = 0;
  if (!dry) {
    const lib = join(OUT, 'members', repo);
    mkdirSync(lib, { recursive: true });
    const names = new Set();
    for (const p of kept) {
      const name = basename(p, extname(p)).toUpperCase();
      if (!MEMBER.test(name) || names.has(name)) continue;
      names.add(name);
      writeFileSync(join(lib, `${name}${extname(p).toLowerCase()}`), texts.get(p));
      libraryMembers++;
    }
  }
  manifest.admitted[split][repo] = { files: admitted, statements, members: libraryMembers };
}

manifest.totals = t;
for (const s of ['cbt-dev', 'cbt-heldout']) {
  const rs = Object.values(manifest.admitted[s]);
  manifest.totals[s] = { repos: rs.length, files: rs.reduce((a, r) => a + r.files, 0), statements: rs.reduce((a, r) => a + r.statements, 0) };
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, dry ? 'manifest.dry.json' : 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(JSON.stringify(manifest.totals, null, 1));
console.log('excluded files', Object.keys(manifest.excludedFiles).length, 'files with rights-reserved members kept', Object.keys(manifest.rightsReservedKept).length);
