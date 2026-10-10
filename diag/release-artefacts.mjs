// SPDX-License-Identifier: AGPL-3.0-or-later
// The release's supply-chain files, made from the npm tarball alone: SHA256SUMS, a CycloneDX SBOM
// of cobolwork (package, version, licence, the hash of every file the tarball ships), and the
// check that two packs of one commit are the same bytes.
//
// Usage:
//   node diag/release-artefacts.mjs sums <file>...        SHA256SUMS on stdout
//   node diag/release-artefacts.mjs sbom <tgz>            CycloneDX JSON on stdout
//   node diag/release-artefacts.mjs same <fileA> <fileB>  exit 1 and name the first difference
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// One "<hash>  <name>" line per file, sorted by name, in the format sha256sum -c reads.
export function sha256sums(files) {
  const lines = files.map((f) => ({ name: f.name, line: `${sha256(f.bytes)}  ${f.name}` }));
  lines.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return lines.map((l) => l.line).join('\n') + '\n';
}

const field = (block, at, len) => {
  const raw = block.subarray(at, at + len);
  const end = raw.indexOf(0);
  return raw.subarray(0, end < 0 ? len : end).toString('utf8');
};

// Regular files of a tar archive, with PAX and GNU long-name headers applied.
export function readTar(tar) {
  const files = [];
  let longName = null;
  for (let at = 0; at + 512 <= tar.length; ) {
    const head = tar.subarray(at, at + 512);
    if (head.every((b) => b === 0)) break;
    const size = parseInt(field(head, 124, 12).trim() || '0', 8);
    const type = String.fromCharCode(head[156] || 48);
    const body = tar.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
      if (m) longName = m[1];
    } else if (type === 'L') {
      longName = field(body, 0, body.length);
    } else if (type === '0') {
      const prefix = field(head, 345, 155);
      const name = longName ?? (prefix ? `${prefix}/` : '') + field(head, 0, 100);
      longName = null;
      files.push({ path: name.replace(/^package\//, ''), bytes: Buffer.from(body) });
    }
  }
  return files;
}

// A serial number taken from the tarball's hash: one tarball always gives one SBOM.
const serialOf = (hash) => `urn:uuid:${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;

export function cycloneDx(tgzBytes) {
  const files = readTar(gunzipSync(tgzBytes));
  const manifest = files.find((f) => f.path === 'package.json');
  if (!manifest) throw new Error('the tarball has no package.json');
  const pkg = JSON.parse(manifest.bytes.toString('utf8'));
  const tgzHash = sha256(tgzBytes);
  const purl = `pkg:npm/${pkg.name.replace('@', '%40')}@${pkg.version}`;
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    serialNumber: serialOf(tgzHash),
    version: 1,
    metadata: {
      component: {
        'bom-ref': purl,
        type: 'application',
        name: pkg.name,
        version: pkg.version,
        description: pkg.description,
        licenses: [{ license: { id: pkg.license } }],
        purl,
        hashes: [{ alg: 'SHA-256', content: tgzHash }],
      },
    },
    components: files
      .map((f) => ({ 'bom-ref': `file:${f.path}`, type: 'file', name: f.path, hashes: [{ alg: 'SHA-256', content: sha256(f.bytes) }] }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    dependencies: [{ ref: purl, dependsOn: [] }],
  };
}

// First byte at which two buffers differ, or -1 when they are the same bytes.
export function firstDifference(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

function main([cmd, ...args]) {
  if (cmd === 'sums' && args.length) {
    process.stdout.write(sha256sums(args.map((p) => ({ name: basename(p), bytes: readFileSync(p) }))));
  } else if (cmd === 'sbom' && args.length === 1) {
    process.stdout.write(JSON.stringify(cycloneDx(readFileSync(args[0])), null, 2) + '\n');
  } else if (cmd === 'same' && args.length === 2) {
    const [a, b] = args.map((p) => readFileSync(p));
    const at = firstDifference(a, b);
    if (at >= 0) {
      console.error(`${args[0]} and ${args[1]} differ at byte ${at} (${a.length} and ${b.length} bytes): the pack is not reproducible`);
      return 1;
    }
    console.log(`identical: ${a.length} bytes, sha256 ${sha256(a)}`);
  } else {
    console.error('usage: release-artefacts.mjs sums <file>... | sbom <tgz> | same <fileA> <fileB>');
    return 2;
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
