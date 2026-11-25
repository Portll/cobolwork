// SPDX-License-Identifier: AGPL-3.0-or-later
// Screens the decoded MVS 3.8j source and admits its assembler to an HLASM corpus root, in the
// layout diag/hlasm-oracle.mjs reads: <out>/mvs-dev, <out>/mvs-heldout, <out>/members and a manifest.
//   node diag/mvs38j-screen.mjs <text-dir> <out-dir> [--prior <corpus-root>]...
// <text-dir> is what diag/mvs38j-decode.mjs wrote. A member with an IBM notice is out. A file whose
// sha256 is already in a --prior corpus is not admitted twice. Every third PDS in name order is held out.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, basename, extname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { kindOfBytes } from '../lib/sources.mjs';
import { readHlasm } from '../lib/hlasm.mjs';
import { noticeIn } from './mvs38j-notice.mjs';

const args = process.argv.slice(2);
const prior = [];
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--prior') prior.push(resolve(args[++i]));
  else positional.push(resolve(args[i]));
}
const [SRC, OUT] = positional;
if (!SRC || !OUT) {
  console.error('usage: node diag/mvs38j-screen.mjs <text-dir> <out-dir> [--prior <corpus-root>]...');
  process.exit(2);
}

const OTHER_KINDS = new Set(['jcl', 'program', 'copybook', 'bms']);
const SECTION_OR_MACRO = /^[^*\s]*[ \t]+(?:CSECT|RSECT|START|MACRO)(?=\s|$)/m;
const STORAGE_OR_BASE = /^[^*\s]*[ \t]+(?:USING|DC|DS|BALR|BASR|STM|STMG|MEND)(?=\s|$)/m;
const IEBUPDTE = /^\.\/\s+(?:ADD|REPL|CHANGE|REPRO)\s/m;
const NOT_A_SPLIT = new Set(['members', 'oracle']);

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

const seen = new Set();
for (const root of prior) for (const split of readdirSync(root)) {
  if (NOT_A_SPLIT.has(split) || !statSync(join(root, split)).isDirectory()) continue;
  for (const f of walk(join(root, split))) seen.add(sha(readFileSync(f)));
}
const priorHashes = seen.size;

for (const d of ['mvs-dev', 'mvs-heldout', 'members']) rmSync(join(OUT, d), { recursive: true, force: true });
const pdses = readdirSync(SRC).filter((d) => statSync(join(SRC, d)).isDirectory()).sort();
const manifest = {
  built: new Date().toISOString(),
  source: 'jaymoseley.com/hercules/downloads/archives/mvssrc.tgz (MD5 c56ee75d5621de2e3c52658bcd02511d), volume MVSSRC, unloaded raw with dasdpdsu and decoded as fixed 80-byte EBCDIC records',
  screen: 'a member carrying an IBM notice or program number is excluded',
  dedup: `sha256 against ${prior.length} prior corpus root(s) (${priorHashes} files)`,
  split: 'by PDS: index mod 3 == 0 in name order -> mvs-heldout',
  heldoutPdses: pdses.filter((_, i) => i % 3 === 0),
  totals: {},
  excludedMembers: [],
  admitted: { 'mvs-dev': {}, 'mvs-heldout': {} },
};
const t = { members: 0, ibmMembers: 0, assembler: 0, sniffMissed: 0, duplicates: 0, notHlasm: 0, admitted: 0 };
pdses.forEach((pds, i) => {
  const split = i % 3 === 0 ? 'mvs-heldout' : 'mvs-dev';
  const lib = join(OUT, 'members', pds);
  mkdirSync(lib, { recursive: true });
  let files = 0;
  let statements = 0;
  for (const p of walk(join(SRC, pds)).sort()) {
    t.members++;
    const buf = readFileSync(p);
    const whole = buf.toString('latin1');
    const notice = noticeIn(whole);
    if (notice) { t.ibmMembers++; manifest.excludedMembers.push({ member: `${pds}/${basename(p)}`, line: notice }); continue; }
    writeFileSync(join(lib, `${basename(p, extname(p)).toUpperCase()}${extname(p).toLowerCase()}`), buf);
    const sniffed = kindOfBytes(buf);
    if (OTHER_KINDS.has(sniffed)) continue;
    if (IEBUPDTE.test(whole) || !SECTION_OR_MACRO.test(whole) || !STORAGE_OR_BASE.test(whole)) continue;
    const r = readHlasm(whole);
    if (r.kind !== 'hlasm') { t.notHlasm++; continue; }
    t.assembler++;
    if (sniffed !== 'hlasm') t.sniffMissed++;
    const hash = sha(buf);
    if (seen.has(hash)) { t.duplicates++; continue; }
    seen.add(hash);
    mkdirSync(join(OUT, split, pds), { recursive: true });
    writeFileSync(join(OUT, split, pds, `${basename(p, extname(p))}.asm`), buf);
    files++;
    statements += r.statements;
  }
  t.admitted += files;
  if (files) manifest.admitted[split][pds] = { files, statements };
});
manifest.totals = t;
for (const s of ['mvs-dev', 'mvs-heldout']) {
  const rs = Object.values(manifest.admitted[s]);
  manifest.totals[s] = { pdses: rs.length, files: rs.reduce((a, r) => a + r.files, 0), statements: rs.reduce((a, r) => a + r.statements, 0) };
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(JSON.stringify(manifest.totals, null, 1));
