// SPDX-License-Identifier: AGPL-3.0-or-later
// Builds the MVS 3.8j macro library diag/hlasm-oracle.mjs takes as --maclib, from the DLIB tape.
//   node diag/mvs38j-maclib.mjs <zdlib1.het> <out-dir>
// The tape is tape/zdlib1.het (MD5 71c587807a8caf90b02fe7f56ba47303) inside
// https://www.jaymoseley.com/hercules/downloads/archives/vs2DistributionTapes.tar.gz (17,002,758
// bytes, MD5 ec9f1c8672bd406a4ff7bc00f139f5bc). It is standard-labelled, so RELFILE n is tape file
// 3n-2. Each RELFILE that is an IEBCOPY unload gives its members; one whose first statement is MACRO
// and that carries no IBM notice is written to <out-dir>/<NAME>.mac, a later RELFILE's over an earlier one's.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { readArchive } from '../lib/kernel/pds-archive.mjs';
import { decodeEbcdic } from '../lib/sources.mjs';
import { noticeIn } from './mvs38j-notice.mjs';

const [tape, out] = process.argv.slice(2).map((p) => resolve(p));
if (!tape || !out) {
  console.error('usage: node diag/mvs38j-maclib.mjs <zdlib1.het> <out-dir>');
  process.exit(2);
}

const TAPEMARK = 0x40;
const END_OF_BLOCK = 0x20;
const ZLIB = 0x01;
const BZIP2 = 0x02;

// A HET image is AWSTAPE chunks, each under a 6-byte header, with a block's data compressed whole.
function tapeFiles(buf) {
  const files = [[]];
  let chunks = [];
  for (let at = 0; at + 6 <= buf.length;) {
    const length = buf.readUInt16LE(at);
    const flags = buf[at + 4];
    at += 6;
    if (flags & TAPEMARK) { files.push([]); continue; }
    if (flags & BZIP2) throw new Error(`bzip2 block at offset ${at - 6}: not read`);
    chunks.push(buf.subarray(at, at + length));
    at += length;
    if (flags & END_OF_BLOCK) {
      const block = Buffer.concat(chunks);
      chunks = [];
      files.at(-1).push(flags & ZLIB ? inflateSync(block) : block);
    }
  }
  return files.map((blocks) => Buffer.concat(blocks));
}

const files = tapeFiles(readFileSync(tape));
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const t = { relfiles: 0, notPartitioned: 0, members: 0, macros: 0 };
const dropped = [];
const kept = new Set();
for (let n = 1; 3 * n - 2 < files.length; n++) {
  const relfile = files[3 * n - 2];
  if (!relfile.length) continue;
  t.relfiles++;
  const archive = readArchive(relfile);
  if (!archive.members) { t.notPartitioned++; continue; }
  for (const m of archive.members) {
    t.members++;
    const text = decodeEbcdic(m.bytes);
    const first = text.split('\n').find((l) => l.trim() && !/^\*|^\.\*/.test(l)) || '';
    if (!/^\S*\s+MACRO\b/.test(first)) continue;
    t.macros++;
    if (noticeIn(text)) { dropped.push(m.name); continue; }
    writeFileSync(join(out, `${m.name}.mac`), text, 'latin1');
    kept.add(m.name);
  }
}
console.log(JSON.stringify({ ...t, files: kept.size, dropped }, null, 1));
