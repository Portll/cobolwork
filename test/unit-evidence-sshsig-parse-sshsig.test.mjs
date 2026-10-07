// Parses an SSHSIG blob into its public key, namespace, hash algorithm, and signature fields (lib/evidence/sshsig.mjs parseSshsig).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSshsig } from '../lib/evidence/sshsig.mjs';
import './pin-machine.mjs';

function buildBlob({ magic = 'SSHSIG', version = 1, publicKey = 'pk', namespace = 'ns', hashAlg = 'sha256', signature = 'sig', trailing = '' } = {}) {
  const parts = [];
  parts.push(Buffer.from(magic, 'utf8'));
  const vBuf = Buffer.alloc(4);
  vBuf.writeUInt32BE(version, 0);
  parts.push(vBuf);
  const pkBuf = Buffer.from(publicKey, 'utf8');
  const pkLen = Buffer.alloc(4);
  pkLen.writeUInt32BE(pkBuf.length, 0);
  parts.push(pkLen, pkBuf);
  const nsBuf = Buffer.from(namespace, 'utf8');
  const nsLen = Buffer.alloc(4);
  nsLen.writeUInt32BE(nsBuf.length, 0);
  parts.push(nsLen, nsBuf);
  const dummyBuf = Buffer.from('dummy', 'utf8');
  const dummyLen = Buffer.alloc(4);
  dummyLen.writeUInt32BE(dummyBuf.length, 0);
  parts.push(dummyLen, dummyBuf);
  const haBuf = Buffer.from(hashAlg, 'utf8');
  const haLen = Buffer.alloc(4);
  haLen.writeUInt32BE(haBuf.length, 0);
  parts.push(haLen, haBuf);
  const sigBuf = Buffer.from(signature, 'utf8');
  const sigLen = Buffer.alloc(4);
  sigLen.writeUInt32BE(sigBuf.length, 0);
  parts.push(sigLen, sigBuf);
  if (trailing) parts.push(Buffer.from(trailing, 'utf8'));
  return Buffer.concat(parts);
}

test('parses a valid SSHSIG blob with version 1', () => {
  const blob = buildBlob({ publicKey: 'mykey', namespace: 'myns', hashAlg: 'sha512', signature: 'mysig' });
  const result = parseSshsig(blob);
  assert.deepEqual(result, {
    publicKey: Buffer.from('mykey', 'utf8'),
    namespace: 'myns',
    hashAlg: 'sha512',
    signature: Buffer.from('mysig', 'utf8')
  });
});

test('throws when magic bytes do not match SSHSIG', () => {
  const blob = buildBlob({ magic: 'NOTSSH' });
  assert.throws(() => parseSshsig(blob), /not an SSHSIG blob/);
});

test('throws when version is not 1', () => {
  const blob = buildBlob({ version: 2 });
  assert.throws(() => parseSshsig(blob), /SSHSIG version 2/);
});

test('throws when blob is truncated before magic', () => {
  const blob = Buffer.from('SS');
  assert.throws(() => parseSshsig(blob), /truncated/);
});

test('throws when blob has trailing bytes after signature', () => {
  const blob = buildBlob({ trailing: 'extra' });
  assert.throws(() => parseSshsig(blob), /trailing bytes after the SSHSIG signature/);
});

test('parses empty namespace and hash algorithm strings', () => {
  const blob = buildBlob({ namespace: '', hashAlg: '' });
  const result = parseSshsig(blob);
  assert.equal(result.namespace, '');
  assert.equal(result.hashAlg, '');
});

test('parses empty public key and signature buffers', () => {
  const blob = buildBlob({ publicKey: '', signature: '' });
  const result = parseSshsig(blob);
  assert.deepEqual(result.publicKey, Buffer.alloc(0));
  assert.deepEqual(result.signature, Buffer.alloc(0));
});

test('throws when blob is truncated in version field', () => {
  const magic = Buffer.from('SSHSIG', 'utf8');
  const partialVersion = Buffer.from([0x00, 0x00]);
  const blob = Buffer.concat([magic, partialVersion]);
  assert.throws(() => parseSshsig(blob), /truncated/);
});
