// A tree's classifier answers for paths under its root however many separators end the root (lib/sources.mjs classifyUnder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sep } from 'node:path';
import { classifyUnder, sniffKind } from '../lib/sources.mjs';
import './pin-machine.mjs';

test('a root ending in several separators classifies the paths under it', () => {
  const root = `${sep}cw-classify-under-trailing`;
  const kindOf = () => 'program';
  classifyUnder(`${root}${sep}${sep}${sep}`, kindOf);
  assert.strictEqual(sniffKind(`${root}${sep}MAIN`), 'program');
});

test('a root holding a long run of separators not at its end is stored in linear time', () => {
  const root = `${sep}cw-classify-under-long${'/'.repeat(200_000)}x`;
  const kindOf = () => 'jcl';
  const started = process.hrtime.bigint();
  classifyUnder(root, kindOf);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 500, `took ${ms} ms`);
  assert.strictEqual(sniffKind(`${root}${sep}RUN`), 'jcl');
});
