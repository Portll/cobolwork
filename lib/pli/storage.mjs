// SPDX-License-Identifier: AGPL-3.0-or-later
// The storage a PL/I element takes and the boundary it needs, from its DECLARE attributes, as the
// Enterprise PL/I Language Reference's alignment table gives them (LP(32), OFFSETSIZE(4)). Sizes
// and alignments are in bits so unaligned bit strings pack.

const STRING_TYPES = new Set(['CHARACTER', 'BIT', 'GRAPHIC', 'WIDECHAR', 'UCHAR']);
const UNALIGNED_BY_DEFAULT = new Set([...STRING_TYPES, 'PICTURE']);
const ARITHMETIC = new Set(['FIXED', 'FLOAT', 'BINARY', 'DECIMAL', 'PRECISION', 'SIGNED', 'UNSIGNED', 'REAL', 'COMPLEX']);
const UNIT = { CHARACTER: 8, BIT: 1, GRAPHIC: 16, WIDECHAR: 16, UCHAR: 32 };
// Program-control data: bytes and alignment in bytes.
const CONTROL = { POINTER: [4, 4], HANDLE: [4, 4], OFFSET: [4, 4], FILE: [4, 4], ENTRY: [8, 4], LABEL: [8, 4], FORMAT: [8, 4], TASK: [16, 4] };

// Names that occupy no storage of their own.
const NO_STORAGE = new Set(['BUILTIN', 'GENERIC', 'CONDITION']);
// File description attributes declare a file even when FILE itself is not written.
const FILE_DESCRIPTION = new Set(['STREAM', 'RECORD', 'INPUT', 'OUTPUT', 'UPDATE', 'SEQUENTIAL', 'DIRECT', 'TRANSIENT', 'KEYED', 'PRINT', 'ENVIRONMENT', 'BUFFERED', 'UNBUFFERED', 'BACKWARDS', 'EXCLUSIVE']);
// Attributes that say nothing about the data type, so a name carrying only these takes the default.
const NOT_TYPE = new Set(['STATIC', 'AUTOMATIC', 'BASED', 'CONTROLLED', 'DEFINED', 'POSITION', 'PARAMETER', 'EXTERNAL', 'INTERNAL', 'INITIAL', 'ALIGNED', 'UNALIGNED', 'NORMAL', 'ABNORMAL', 'ASSIGNABLE', 'NONASSIGNABLE', 'CONNECTED', 'NONCONNECTED', 'BYADDR', 'BYVALUE', 'OPTIONAL', 'INONLY', 'OUTONLY', 'INOUT', 'RESERVED', 'VALUE']);

const plainNumber = (toks) => (toks && toks.length === 1 && toks[0].t === 'num' && /^\d+$/.test(toks[0].v) ? Number(toks[0].v) : null);

function precisionOf(args) {
  if (!args || !args.length) return null;
  const parts = [[]];
  for (const t of args) { if (t.t === 'op' && t.v === ',') parts.push([]); else parts[parts.length - 1].push(t); }
  const signed = (p) => (p.length === 2 && p[0].t === 'op' && p[0].v === '-' ? -plainNumber([p[1]]) : plainNumber(p));
  return { p: plainNumber(parts[0]), q: parts[1] ? signed(parts[1]) : 0 };
}

// Bytes a PICTURE occupies: every picture character except V, K and the F scaling factor, a
// repetition factor (n) multiplying the character after it, CR and DB two characters each.
export function pictureBytes(pic) {
  const s = pic.toUpperCase().replace(/F\(\s*[+-]?\d+\s*\)/g, '');
  let n = 0;
  for (const m of s.matchAll(/\((\d+)\)(CR|DB|.)|(CR|DB)|([^VK])|[VK]/g)) {
    if (m[2]) n += Number(m[1]) * (m[2].length === 2 ? 2 : m[2] === 'V' || m[2] === 'K' ? 0 : 1);
    else if (m[3]) n += 2;
    else if (m[4]) n += 1;
  }
  return n;
}

// { type, bits, align (bits), aligned, varying, base, scale, precision, known } for one element.
// bits is null when an extent is not a constant (CHAR(*), CHAR(N), REFER). align is what the
// element needs once ALIGNED or UNALIGNED is settled; `inherited` is the containing structure's
// explicit choice, used when the element makes none of its own.
export function storageOf(attributes, { inherited = null, name = null } = {}) {
  const has = (n) => attributes.find((a) => a.name === n);
  if (attributes.some((a) => NO_STORAGE.has(a.name))) return { type: attributes.find((a) => NO_STORAGE.has(a.name)).name, bits: 0, align: 8, aligned: null, known: true, storage: false };
  if (has('TYPE')) return { type: 'TYPE', typeName: has('TYPE').args?.[0]?.u ?? null, bits: null, align: 8, aligned: null, known: false };
  if (!has('FILE') && attributes.some((a) => FILE_DESCRIPTION.has(a.name))) attributes = [...attributes, { name: 'FILE', args: null }];
  // RULES(IBM): a name with no data attribute is FIXED BINARY(15) when it starts with I to N, else
  // FLOAT DECIMAL(6).
  if (name && attributes.every((a) => NOT_TYPE.has(a.name))) {
    const implicit = /^[I-N]/.test(name) ? [{ name: 'FIXED', args: null }, { name: 'BINARY', args: null }] : [{ name: 'FLOAT', args: null }, { name: 'DECIMAL', args: null }];
    return { ...storageOf([...attributes, ...implicit], { inherited }), implicit: true };
  }
  const explicit = has('ALIGNED') ? true : has('UNALIGNED') ? false : null;
  const alignedN = has('ALIGNED') && plainNumber(has('ALIGNED').args);
  let type = null;
  let bits = null;
  let aligned;
  let alignAligned = 8;
  let alignUnaligned = 8;
  const out = {};

  const stringType = attributes.find((a) => STRING_TYPES.has(a.name));
  const varying = has('VARYING') ? 'VARYING' : has('VARYINGZ') ? 'VARYINGZ' : has('VARYING4') ? 'VARYING4' : null;
  if (stringType) {
    type = stringType.name;
    const n = stringType.args ? plainNumber(stringType.args) : 1;
    const unit = UNIT[type];
    aligned = explicit ?? inherited ?? !UNALIGNED_BY_DEFAULT.has(type);
    if (n != null) {
      if (type === 'BIT' && !varying) bits = aligned ? Math.ceil(n / 8) * 8 : n;
      else if (type === 'BIT') bits = (varying === 'VARYING4' ? 32 : 16) + (aligned ? Math.ceil(n / 8) * 8 : n);
      else bits = n * unit + (varying === 'VARYING' ? 16 : varying === 'VARYING4' ? 32 : varying === 'VARYINGZ' ? (type === 'CHARACTER' || type === 'UCHAR' ? 8 : 16) : 0);
    }
    alignAligned = varying === 'VARYING' ? 16 : varying === 'VARYING4' ? 32 : 8;
    alignUnaligned = type === 'BIT' && !varying ? 1 : 8;
    Object.assign(out, { length: n, varying });
  } else if (has('PICTURE')) {
    type = 'PICTURE';
    aligned = explicit ?? inherited ?? false;
    bits = has('PICTURE').picture != null ? pictureBytes(has('PICTURE').picture) * 8 : null;
    out.picture = has('PICTURE').picture ?? null;
  } else if (has('AREA')) {
    type = 'AREA';
    aligned = true;
    const n = has('AREA').args ? plainNumber(has('AREA').args) : 1000;
    bits = n == null ? null : (16 + n) * 8;
    alignAligned = alignUnaligned = 64;
  } else if (Object.keys(CONTROL).some((k) => has(k))) {
    type = Object.keys(CONTROL).find((k) => has(k));
    aligned = explicit ?? inherited ?? true;
    const limited = type === 'ENTRY' && has('LIMITED');
    const [bytes, align] = limited ? [4, 4] : CONTROL[type];
    bits = bytes * 8;
    alignAligned = align * 8;
  } else if (attributes.some((a) => ARITHMETIC.has(a.name))) {
    const last = (names) => [...attributes].reverse().find((a) => names.includes(a.name) && a.args);
    const scale = has('FIXED') ? 'FIXED' : 'FLOAT';
    const base = has('BINARY') ? 'BINARY' : 'DECIMAL';
    const prec = precisionOf(last(['FIXED', 'FLOAT', 'BINARY', 'DECIMAL', 'PRECISION'])?.args);
    const unsigned = !!has('UNSIGNED');
    const p = prec?.p ?? (scale === 'FIXED' ? (base === 'BINARY' ? 15 : 5) : base === 'BINARY' ? 21 : 6);
    type = `${scale} ${base}`;
    aligned = explicit ?? inherited ?? true;
    Object.assign(out, { scale, base, precision: p, fraction: prec?.q ?? 0, signed: !unsigned });
    if (prec && prec.p == null) bits = null;
    else if (scale === 'FIXED' && base === 'DECIMAL') { bits = Math.ceil((p + 1) / 2) * 8; alignAligned = 8; }
    else if (scale === 'FIXED') {
      const q = unsigned ? p - 1 : p;
      const bytes = q <= 7 ? 1 : q <= 15 ? 2 : q <= 31 ? 4 : 8;
      bits = bytes * 8;
      alignAligned = bytes * 8;
    } else {
      const short = base === 'BINARY' ? p <= 21 : p <= 6;
      const long = base === 'BINARY' ? p <= 53 : p <= 16;
      bits = short ? 32 : long ? 64 : 128;
      alignAligned = short ? 32 : 64;
    }
    if (has('COMPLEX') && bits != null) bits *= 2;
  } else {
    return { type: null, bits: null, align: 8, aligned: explicit ?? inherited ?? null, known: false };
  }
  const align = alignedN ? alignedN * 8 : aligned ? alignAligned : alignUnaligned;
  return { type, bits, align, aligned, known: bits != null, ...out };
}
