// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import './pin-machine.mjs';
import { gzipSync } from 'node:zlib';
import { cycloneDx, firstDifference, readTar, sha256, sha256sums } from '../diag/release-artefacts.mjs';

function entry(name, body, type = '0') {
  const head = Buffer.alloc(512);
  head.write(name, 0, 100);
  head.write(body.length.toString(8).padStart(11, '0'), 124);
  head.write(type, 156);
  const pad = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([head, body, pad]);
}
const tgz = (...entries) => gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]));
const manifest = Buffer.from(JSON.stringify({ name: '@portll/cobolwork', version: '1.2.3', license: 'AGPL-3.0-or-later', description: 'd' }));

test('sha256sums sorts by name and matches the sha256sum format', () => {
  const out = sha256sums([{ name: 'b.txt', bytes: Buffer.from('b') }, { name: 'a.txt', bytes: Buffer.from('a') }]);
  assert.equal(out, `${sha256(Buffer.from('a'))}  a.txt\n${sha256(Buffer.from('b'))}  b.txt\n`);
  assert.equal(sha256(Buffer.from('a')), 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
});

test('readTar returns regular files, strips package/, and honours a PAX path', () => {
  const long = `package/${'d'.repeat(120)}/file.mjs`;
  const record = ` path=${long}\n`;
  let n = record.length + 1;
  while (String(n).length + record.length !== n) n = String(n).length + record.length;
  const pax = `${n}${record}`;
  const files = readTar(Buffer.concat([
    entry('package/a.txt', Buffer.from('hello')),
    entry('PaxHeader/x', Buffer.from(pax), 'x'),
    entry('package/truncated', Buffer.from('long')),
    entry('package/dir/', Buffer.alloc(0), '5'),
    Buffer.alloc(1024),
  ]));
  assert.deepEqual(files.map((f) => f.path), ['a.txt', `${'d'.repeat(120)}/file.mjs`]);
  assert.equal(files[1].bytes.toString(), 'long');
});

test('cycloneDx names the package, its licence and the hash of every shipped file', () => {
  const bytes = tgz(entry('package/package.json', manifest), entry('package/lib/z.mjs', Buffer.from('z')), entry('package/bin/a.mjs', Buffer.from('a')));
  const bom = cycloneDx(bytes);
  assert.equal(bom.bomFormat, 'CycloneDX');
  assert.equal(bom.metadata.component.version, '1.2.3');
  assert.equal(bom.metadata.component.purl, 'pkg:npm/%40portll/cobolwork@1.2.3');
  assert.equal(bom.metadata.component.licenses[0].license.id, 'AGPL-3.0-or-later');
  assert.equal(bom.metadata.component.hashes[0].content, sha256(bytes));
  assert.deepEqual(bom.components.map((c) => c.name), ['bin/a.mjs', 'lib/z.mjs', 'package.json']);
  assert.equal(bom.components[0].hashes[0].content, sha256(Buffer.from('a')));
  assert.deepEqual(bom.dependencies[0].dependsOn, []);
  assert.deepEqual(cycloneDx(bytes), bom);
});

test('cycloneDx refuses a tarball without package.json', () => {
  assert.throws(() => cycloneDx(tgz(entry('package/a.txt', Buffer.from('a')))), /no package.json/);
});

test('firstDifference finds the first differing byte, or a length difference, or none', () => {
  assert.equal(firstDifference(Buffer.from('abc'), Buffer.from('abc')), -1);
  assert.equal(firstDifference(Buffer.from('abc'), Buffer.from('abd')), 2);
  assert.equal(firstDifference(Buffer.from('ab'), Buffer.from('abc')), 2);
  assert.equal(firstDifference(Buffer.alloc(0), Buffer.alloc(0)), -1);
});
