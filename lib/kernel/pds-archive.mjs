// SPDX-License-Identifier: AGPL-3.0-or-later
// Data sets brought off z/OS whole: a TSO TRANSMIT (XMIT) file, and an IEBCOPY unload data set, alone
// or inside one. Each partitioned data set's members come back as their records, in EBCDIC, ended by
// NL (X'15'), as a z/OSMF record download gives them; a sequential data set comes back as one file.
//
// The layouts are IBM's: z/OS TSO/E Customization, "Format of transmitted data", "Control record
// formats" and "Numeric values" (the text units); z/OS DFSMSdfp Utilities, "Unload partitioned data
// set format" (COPYR1, COPYR2, directory and member data records); z/OS DFSMSdfp Advanced Services,
// "Data Extent Block (DEB) Fields" and "Device Characteristics Information" (DEVTYPE), which turn a
// member block's MBBCCHHR into the TTR its directory entry holds.
import { ebcdicByte } from '../sources.mjs';

const EOR = 0x15;
const UNLOAD_ID = [0xca, 0x6d, 0x0f];
const ebcdic = (s) => Buffer.from([...s].map((c) => ebcdicByte(c)));
const INMR = (n) => ebcdic(`INMR0${n}`);

const KEY = { INMDSNAM: 0x0002, INMDSORG: 0x003c, INMLRECL: 0x0042, INMRECFM: 0x0049, INMUTILN: 0x1028, INMNUMF: 0x102f };
const DSORG_PO = 0x0200;

const textOf = (buf) => [...buf].map((b) => EBCDIC_TEXT[b]).join('');
const EBCDIC_TEXT = (() => {
  const t = new Array(256).fill('?');
  for (let c = 0x20; c < 0x7f; c++) {
    const b = ebcdicByte(String.fromCharCode(c));
    if (b !== null) t[b] = String.fromCharCode(c);
  }
  return t;
})();
const uint = (buf) => buf.reduce((n, b) => n * 256 + b, 0);
const isUnloadId = (buf, at) => buf.length >= at + 3 && UNLOAD_ID.every((b, i) => buf[at + i] === b);

// What a file holds, from its first bytes: an XMIT file's first segment is its INMR01 header record;
// an unload's COPYR1 carries X'CA6D0F' after its flag byte, with a BDW and SDW, an RDW, or nothing
// before it.
export function archiveKind(head) {
  if (head.length >= 8 && (head[1] & 0xa0) === 0xa0 && head.subarray(2, 8).equals(INMR(1))) return 'xmit';
  for (const at of [1, 5, 9]) if (isUnloadId(head, at)) return 'unload';
  return null;
}

// The transmission's logical records, each from its segments: a length byte counting itself and the
// flag byte, the flags (X'80' first, X'40' last, X'20' control record) and up to 253 bytes.
function xmitRecords(buf) {
  const records = [];
  let parts = null;
  let control = false;
  for (let at = 0; at < buf.length;) {
    const n = buf[at];
    if (n < 2 || at + n > buf.length) break;
    const flags = buf[at + 1];
    if (flags & 0x80) { parts = []; control = (flags & 0x20) !== 0; }
    if (parts) parts.push(buf.subarray(at + 2, at + n));
    if (flags & 0x40 && parts) {
      const bytes = Buffer.concat(parts);
      records.push({ control, bytes });
      parts = null;
      if (control && bytes.subarray(0, 6).equals(INMR(6))) break;
    }
    at += n;
  }
  return records;
}

// Text units from `at`: a key, a count, and that many length and data pairs.
function textUnits(bytes, at) {
  const units = new Map();
  while (at + 4 <= bytes.length) {
    const key = bytes.readUInt16BE(at);
    const count = bytes.readUInt16BE(at + 2);
    at += 4;
    const fields = [];
    for (let i = 0; i < count && at + 2 <= bytes.length; i++) {
      const len = bytes.readUInt16BE(at);
      fields.push(bytes.subarray(at + 2, at + 2 + len));
      at += 2 + len;
    }
    units.set(key, fields);
  }
  return units;
}

function readXmit(buf) {
  const records = xmitRecords(buf);
  const last = records[records.length - 1];
  if (!last?.control || !last.bytes.subarray(0, 6).equals(INMR(6))) return { why: 'the transmission ends before its INMR06 trailer' };
  const header = textUnits(records[0].bytes, 6);
  const files = header.get(KEY.INMNUMF)?.[0];
  if (files && uint(files) > 1) return { why: `the transmission holds ${uint(files)} files, and cobolwork reads one` };
  const utilities = records.filter((r) => r.control && r.bytes.subarray(0, 6).equals(INMR(2))).map((r) => textUnits(r.bytes, 10));
  const named = utilities.find((u) => u.has(KEY.INMDSNAM));
  const dataSet = named ? named.get(KEY.INMDSNAM).map(textOf).join('.') : null;
  const start = records.findIndex((r) => r.control && r.bytes.subarray(0, 6).equals(INMR(3)));
  if (start < 0) return { why: 'the transmission has no INMR03 data control record' };
  const data = records.slice(start + 1, -1).filter((r) => !r.control).map((r) => r.bytes);
  const unloaded = utilities.some((u) => textOf(u.get(KEY.INMUTILN)?.[0] || Buffer.alloc(0)) === 'IEBCOPY');
  if (unloaded) return { ...readUnloadRecords(data), kind: 'xmit', dataSet };
  const dsorg = utilities.map((u) => u.get(KEY.INMDSORG)?.[0]).find(Boolean);
  if (dsorg && uint(dsorg) === DSORG_PO) return { why: 'a partitioned data set transmitted without IEBCOPY' };
  return { kind: 'xmit', dataSet, sequential: true, members: [{ name: null, bytes: joined(data) }], aliases: [] };
}

// An unload stored with its descriptors: each block a BDW, then segments, each an SDW whose third
// byte's low two bits say whether it is a whole record (0), its first (1), last (2) or middle (3)
// part; or each record after an RDW; or the records with nothing between them, COPYR1 and COPYR2 at
// their fixed lengths and everything after them one stream.
function unloadRecords(buf) {
  if (isUnloadId(buf, 9)) {
    const records = [];
    let parts = [];
    for (let at = 0; at + 4 <= buf.length;) {
      const end = at + buf.readUInt16BE(at);
      if (end <= at || end > buf.length) break;
      for (let s = at + 4; s + 4 <= end;) {
        const len = buf.readUInt16BE(s);
        if (len < 4) break;
        const code = buf[s + 2] & 0x03;
        parts.push(buf.subarray(s + 4, s + len));
        if (code === 0 || code === 2) { records.push(Buffer.concat(parts)); parts = []; }
        s += len;
      }
      at = end;
    }
    return records;
  }
  if (isUnloadId(buf, 5)) {
    const records = [];
    for (let at = 0; at + 4 <= buf.length;) {
      const len = buf.readUInt16BE(at);
      if (len < 4 || at + len > buf.length) break;
      records.push(buf.subarray(at + 4, at + len));
      at += len;
    }
    return records;
  }
  return [buf.subarray(0, COPYR1_LENGTH), buf.subarray(COPYR1_LENGTH, COPYR1_LENGTH + COPYR2_LENGTH), buf.subarray(COPYR1_LENGTH + COPYR2_LENGTH)];
}

const COPYR1_LENGTH = 56;
const COPYR2_LENGTH = 276;
const DIRECTORY_BLOCK = 276;
const BLOCK_HEADER = 12;

export function readArchive(buf) {
  const kind = archiveKind(buf.subarray(0, 16));
  if (kind === 'xmit') return readXmit(buf);
  if (kind === 'unload') return { ...readUnloadRecords(unloadRecords(buf)), kind: 'unload', dataSet: null };
  return { why: 'neither an XMIT file nor an IEBCOPY unload' };
}

// COPYR1 and COPYR2, then the directory blocks and every member's blocks, which run on across
// records: a directory block is a 12-byte count, the 8-byte key and 256 bytes of entries, and the
// directory ends with 12 bytes of zeros; a member's blocks are each a flag byte, MBB, CCHHR, key
// length, data length, key and data, and its last is one with no key and no data.
function readUnloadRecords(records) {
  const [r1, r2] = records;
  if (!r1 || !isUnloadId(r1, 1)) return { why: 'the unload has no COPYR1 record' };
  const format = r1[0] >> 6;
  if (format === 2) return { why: 'IEBCOPY marked the unload incomplete or in error' };
  if (format !== 0 || r1[0] & 0x01) return { why: 'a PDSE unload, whose attribute records cobolwork does not read yet' };
  const headers = r1.length >= 38 ? r1.readUInt16BE(36) || 2 : 2;
  if (headers !== 2) return { why: `the unload has ${headers} header records, and cobolwork reads two` };
  if (!r2 || r2.length < 16 + 16) return { why: 'the unload has no COPYR2 record' };
  const lrecl = r1.readUInt16BE(8);
  const recfm = r1[10] >> 6;
  const tracksPerCylinder = r1.readUInt16BE(26);
  const extents = [];
  for (let at = 16; at + 16 <= r2.length && extents.length < 16; at += 16) {
    extents.push({ cyl: cylinder(r2.readUInt16BE(at + 6), r2.readUInt16BE(at + 8)), trk: r2.readUInt16BE(at + 8) & 0x0f, tracks: r2[at + 5] * 0x10000 + r2.readUInt16BE(at + 14) });
  }
  const stream = Buffer.concat(records.slice(2));
  let at = 0;
  const entries = [];
  for (;;) {
    if (at + BLOCK_HEADER > stream.length) return { why: 'the directory runs past the end of the unload' };
    if (stream.subarray(at, at + BLOCK_HEADER).every((b) => b === 0)) { at += BLOCK_HEADER; break; }
    const block = stream.subarray(at + BLOCK_HEADER + 8, at + DIRECTORY_BLOCK);
    const used = Math.min(block.readUInt16BE(0), block.length);
    for (let e = 2; e + 12 <= used;) {
      const name = block.subarray(e, e + 8);
      if (name.every((b) => b === 0xff)) break;
      const c = block[e + 11];
      entries.push({ name: textOf(name).trimEnd(), ttr: uint(block.subarray(e + 8, e + 11)), alias: (c & 0x80) !== 0 });
      e += 12 + (c & 0x1f) * 2;
    }
    at += DIRECTORY_BLOCK;
  }
  const byTtr = new Map(entries.filter((e) => !e.alias).map((e) => [e.ttr, e.name]));
  const members = [];
  let unmatched = 0;
  while (at + BLOCK_HEADER <= stream.length) {
    let ttr = null;
    const blocks = [];
    for (;;) {
      if (at + BLOCK_HEADER > stream.length) return { why: 'a member runs past the end of the unload' };
      const h = stream.subarray(at, at + BLOCK_HEADER);
      const keyLength = h[9];
      const dataLength = h.readUInt16BE(10);
      at += BLOCK_HEADER;
      if (keyLength === 0 && dataLength === 0) break;
      if (ttr === null) ttr = relativeTrack(extents, tracksPerCylinder, h) * 256 + h[8];
      blocks.push(stream.subarray(at + keyLength, at + keyLength + dataLength));
      at += keyLength + dataLength;
    }
    if (!blocks.length) continue;
    const name = byTtr.get(ttr);
    if (name === undefined) { unmatched++; continue; }
    members.push({ name, bytes: joined(blocks.flatMap((b) => recordsOf(b, recfm, lrecl))) });
  }
  const held = new Set(members.map((m) => m.name));
  return {
    members,
    aliases: entries.filter((e) => e.alias).map((e) => e.name),
    ...(unmatched ? { unmatched } : {}),
    ...(entries.some((e) => !e.alias && !held.has(e.name)) ? { missing: entries.filter((e) => !e.alias && !held.has(e.name)).map((e) => e.name) } : {}),
  };
}

// A cylinder number from CC and HH, whose high 12 bits hold the cylinder's high bits on an extended
// address volume (DEBSTRHH).
const cylinder = (cc, hh) => (hh >> 4) * 0x10000 + cc;

// The track's number from the start of the data set: the tracks of the extents before extent M, then
// the cylinders and tracks into M.
function relativeTrack(extents, tracksPerCylinder, h) {
  const m = h[1];
  const e = extents[m];
  if (!e) return -1;
  const before = extents.slice(0, m).reduce((n, x) => n + x.tracks, 0);
  const hh = h.readUInt16BE(6);
  return before + (cylinder(h.readUInt16BE(4), hh) - e.cyl) * tracksPerCylinder + ((hh & 0x0f) - e.trk);
}

// A physical block's records: fixed-length records LRECL at a time, variable ones after the BDW each
// by its RDW, an undefined block as one record. RECFM's first two bits: 10 fixed, 01 variable, 11
// undefined.
function recordsOf(block, recfm, lrecl) {
  if (recfm === 2 && lrecl > 0) {
    const out = [];
    for (let i = 0; i + lrecl <= block.length; i += lrecl) out.push(block.subarray(i, i + lrecl));
    return out;
  }
  if (recfm === 1) {
    const out = [];
    for (let i = 4; i + 4 <= block.length;) {
      const len = block.readUInt16BE(i);
      if (len < 4) break;
      out.push(block.subarray(i + 4, i + len));
      i += len;
    }
    return out;
  }
  return [block];
}

const joined = (records) => Buffer.concat(records.flatMap((r) => [r, Buffer.from([EOR])]));
