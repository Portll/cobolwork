// SPDX-License-Identifier: AGPL-3.0-or-later
// SSHSIG signatures (OpenSSH PROTOCOL.sshsig) checked with node:crypto against an allowed_signers
// file, for ssh-ed25519 and ecdsa-sha2-nistp256 keys. Anything else is reported, not guessed at.
import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';

const MAGIC = Buffer.from('SSHSIG');
const VERIFIED_TYPES = new Set(['ssh-ed25519', 'ecdsa-sha2-nistp256']);
const KEY_TYPE = /^(?:ssh-(?:ed25519|rsa|dss)|ecdsa-sha2-nistp(?:256|384|521)|sk-(?:ssh-ed25519|ecdsa-sha2-nistp256)@openssh\.com|[a-z0-9-]+-cert-v01@openssh\.com)$/;

class Reader {
  constructor(buf) { this.buf = buf; this.at = 0; }
  u32() {
    if (this.at + 4 > this.buf.length) throw new Error('truncated');
    const v = this.buf.readUInt32BE(this.at);
    this.at += 4;
    return v;
  }
  bytes(n) {
    if (this.at + n > this.buf.length) throw new Error('truncated');
    const out = this.buf.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }
  string() { return this.bytes(this.u32()); }
  text() { return this.string().toString('utf8'); }
  get done() { return this.at === this.buf.length; }
}

const sshString = (b) => {
  const buf = Buffer.isBuffer(b) ? b : Buffer.from(b, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(buf.length);
  return Buffer.concat([len, buf]);
};

export const fingerprint = (keyBlob) => `SHA256:${createHash('sha256').update(keyBlob).digest('base64').replace(/=+$/, '')}`;

export function dearmor(text) {
  const m = /-----BEGIN SSH SIGNATURE-----([\s\S]*?)-----END SSH SIGNATURE-----/.exec(String(text));
  if (!m) throw new Error('no SSH SIGNATURE armour');
  const text64 = m[1].replace(/\s+/g, '');
  const blob = Buffer.from(text64, 'base64');
  if (blob.toString('base64') !== text64) throw new Error('the SSH SIGNATURE armour is not canonical base64');
  return blob;
}

export function parseSshsig(blob) {
  const r = new Reader(blob);
  if (!r.bytes(6).equals(MAGIC)) throw new Error('not an SSHSIG blob');
  const version = r.u32();
  if (version !== 1) throw new Error(`SSHSIG version ${version}`);
  const publicKey = Buffer.from(r.string());
  const namespace = r.text();
  r.string();
  const hashAlg = r.text();
  const signature = Buffer.from(r.string());
  if (!r.done) throw new Error('trailing bytes after the SSHSIG signature');
  return { publicKey, namespace, hashAlg, signature };
}

// What the signer signed: the preamble, the namespace, the hash algorithm and H(message).
export function signedData(namespace, hashAlg, message) {
  if (hashAlg !== 'sha256' && hashAlg !== 'sha512') throw new Error(`SSHSIG hash ${hashAlg}`);
  const digest = createHash(hashAlg).update(message).digest();
  return Buffer.concat([MAGIC, sshString(namespace), sshString(''), sshString(hashAlg), sshString(digest)]);
}

const b64url = (b) => Buffer.from(b).toString('base64url');

function publicKeyOf(blob) {
  const r = new Reader(blob);
  const type = r.text();
  if (type === 'ssh-ed25519') {
    const pk = r.string();
    if (pk.length !== 32 || !r.done) throw new Error('malformed ssh-ed25519 key');
    return { type, key: createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b64url(pk) }, format: 'jwk' }) };
  }
  if (type === 'ecdsa-sha2-nistp256') {
    if (r.text() !== 'nistp256') throw new Error('malformed ecdsa-sha2-nistp256 key');
    const q = r.string();
    if (q.length !== 65 || q[0] !== 4 || !r.done) throw new Error('malformed ecdsa-sha2-nistp256 point');
    return { type, key: createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64url(q.subarray(1, 33)), y: b64url(q.subarray(33)) }, format: 'jwk' }) };
  }
  return { type, key: null };
}

// An SSH mpint to a fixed-width unsigned big-endian integer.
function unsignedFixed(mpint, width) {
  let b = mpint;
  if (b.length && (b[0] & 0x80)) throw new Error('ECDSA component is negative');
  while (b.length > 1 && b[0] === 0) b = b.subarray(1);
  if (b.length > width) throw new Error('ECDSA component too wide');
  return Buffer.concat([Buffer.alloc(width - b.length), b]);
}

function checkSignature(type, key, sigBlob, data) {
  const r = new Reader(sigBlob);
  const sigType = r.text();
  const sig = r.string();
  if (!r.done) return false;
  if (type === 'ssh-ed25519') return sigType === 'ssh-ed25519' && sig.length === 64 && cryptoVerify(null, data, key, sig);
  if (type === 'ecdsa-sha2-nistp256') {
    if (sigType !== 'ecdsa-sha2-nistp256') return false;
    const rs = new Reader(sig);
    const p1363 = Buffer.concat([unsignedFixed(rs.string(), 32), unsignedFixed(rs.string(), 32)]);
    if (!rs.done) return false;
    return cryptoVerify('sha256', data, { key, dsaEncoding: 'ieee-p1363' }, p1363);
  }
  return false;
}

// Splits an allowed_signers line on blanks outside double quotes.
function fields(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') { quoted = !quoted; cur += ch; } else if (!quoted && (ch === ' ' || ch === '\t')) { if (cur) { out.push(cur); cur = ''; } } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

export function parseAllowedSigners(text) {
  const entries = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const f = fields(line);
    if (f.length < 3) continue;
    const principals = f[0].split(',');
    let i = 1;
    const optionFields = [];
    while (i < f.length && !KEY_TYPE.test(f[i])) optionFields.push(f[i++]);
    const options = optionFields.join(',');
    const keyType = f[i];
    let keyBlob;
    try { keyBlob = Buffer.from(f[i + 1] || '', 'base64'); } catch { continue; }
    if (!keyType || !keyBlob.length) continue;
    const opts = new Map();
    for (const o of fields(options.replace(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g, ' '))) {
      const eq = o.indexOf('=');
      opts.set((eq < 0 ? o : o.slice(0, eq)).toLowerCase(), eq < 0 ? true : o.slice(eq + 1).replace(/^"|"$/g, ''));
    }
    entries.push({
      principals,
      keyType,
      keyBlob,
      certAuthority: opts.has('cert-authority'),
      namespaces: typeof opts.get('namespaces') === 'string' ? opts.get('namespaces').split(',') : null,
    });
  }
  return entries;
}

// { valid: true|false|null, reason, keyType, keyid, principals } for one SSHSIG blob over `message`.
export function verifySshsig({ blob, message, namespace, allowed }) {
  let sig;
  try { sig = parseSshsig(blob); } catch (e) { return { valid: false, reason: `not a signature: ${e.message}` }; }
  const keyid = fingerprint(sig.publicKey);
  let pk;
  try { pk = publicKeyOf(sig.publicKey); } catch (e) { return { valid: false, keyid, reason: e.message }; }
  const base = { keyType: pk.type, keyid };
  if (sig.namespace !== namespace) return { ...base, valid: false, reason: `signed for namespace ${sig.namespace}, not ${namespace}` };
  const matches = (allowed || []).filter((a) => !a.certAuthority && a.keyBlob.equals(sig.publicKey) && (!a.namespaces || a.namespaces.includes(namespace)));
  if (!matches.length) return { ...base, valid: false, reason: 'the signing key is not in allowed signers for this namespace' };
  const principals = matches.flatMap((m) => m.principals);
  if (!VERIFIED_TYPES.has(pk.type) || !pk.key) return { ...base, principals, valid: null, reason: `${pk.type} signatures are not verified here` };
  let ok = false;
  try { ok = checkSignature(pk.type, pk.key, sig.signature, signedData(namespace, sig.hashAlg, message)); } catch (e) { return { ...base, principals, valid: false, reason: e.message }; }
  return { ...base, principals, valid: ok, reason: ok ? null : 'the signature does not match the signed bytes' };
}
