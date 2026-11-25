// SPDX-License-Identifier: AGPL-3.0-or-later
// Decodes a raw dasdpdsu unload of the MVS 3.8j source volume (fixed 80-byte EBCDIC records) to text.
//   node diag/mvs38j-decode.mjs <unload-dir> <text-dir>
// <unload-dir> holds one directory per PDS. The volume is dasd/mvssrc.3380 inside
// https://www.jaymoseley.com/hercules/downloads/archives/mvssrc.tgz (147,333,334 bytes, MD5
// c56ee75d5621de2e3c52658bcd02511d), and each of its 21 partitioned data sets unloads with Hercules:
//   (cd <unload-dir>/<PDS> && dasdpdsu <dasd>/mvssrc.3380 MVSSRC.<PDS>)
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodeEbcdic } from '../lib/sources.mjs';

const [from, to] = process.argv.slice(2).map((p) => resolve(p));
if (!from || !to) {
  console.error('usage: node diag/mvs38j-decode.mjs <unload-dir> <text-dir>');
  process.exit(2);
}
let members = 0;
let ragged = 0;
for (const pds of readdirSync(from, { withFileTypes: true })) {
  if (!pds.isDirectory()) continue;
  mkdirSync(join(to, pds.name), { recursive: true });
  for (const f of readdirSync(join(from, pds.name))) {
    const buf = readFileSync(join(from, pds.name, f));
    if (buf.length % 80) ragged++;
    const text = decodeEbcdic(buf).split('\n').map((l) => l.replace(/\s+$/, '')).join('\n') + '\n';
    writeFileSync(join(to, pds.name, f), text, 'latin1');
    members++;
  }
}
console.log(JSON.stringify({ members, notMultipleOf80Bytes: ragged }));
