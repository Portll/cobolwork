import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPli } from '../lib/pli/lex.mjs';
import { parseStatement } from '../lib/pli/statements.mjs';
import { layout, structuresOf } from '../lib/pli/layout.mjs';
import { storageOf, pictureBytes } from '../lib/pli/storage.mjs';
import './pin-machine.mjs';

const items = (src) => parseStatement(readPli(src).statements[0]).node.items;
const offsets = (src) => {
  const { roots } = layout(items(src));
  const out = {};
  const walk = (n) => { out[n.name] = n.bitOffset ? [n.offset, n.bitOffset] : n.offset; n.children.forEach(walk); };
  roots.forEach(walk);
  return { out, roots };
};

// The worked example of the Enterprise PL/I Language Reference, "Example of structure mapping".
const LRM_EXAMPLE = ` declare 1 A aligned,
            2 B fixed bin(31),
            2 C,
              3 D float decimal(14),
              3 E,
                4 F entry,
                4 G,
                  5 H character(2),
                  5 I float decimal(13),
                4 J fixed binary(31,0),
              3 K character(2),
              3 L fixed binary(20,0),
            2 M,
              3 N,
                4 P fixed binary(15),
                4 Q character(5),
                4 R float decimal(2),
              3 S,
                4 T float decimal(15),
                4 U bit(3),
                4 V char(1),
              3 W fixed bin(31),
            2 X picture '$9V99';`;

test('the Language Reference example maps to the offsets its final table gives', () => {
  const { out, roots } = offsets(LRM_EXAMPLE);
  assert.deepEqual(out, { A: 0, B: 0, C: 4, D: 4, E: 16, F: 16, G: 26, H: 26, I: 28, J: 36, K: 40, L: 44, M: 48, N: 48, P: 48, Q: 50, R: 56, S: 60, T: 60, U: 68, V: 69, W: 72, X: 76 });
  assert.equal(roots[0].total, 80);
});

test('logical levels follow nesting, not the level numbers written', () => {
  const [a] = structuresOf(items(' dcl 1 A, 4 B, 5 C, 5 D, 3 E, 8 F, 7 G;'));
  const levels = [];
  const walk = (n) => { levels.push(`${n.name}${n.logical}`); n.children.forEach(walk); };
  walk(a);
  assert.deepEqual(levels, ['A1', 'B2', 'C3', 'D3', 'E2', 'F3', 'G3']);
});

test('character, picture and packed decimal data is unaligned by default; binary is aligned', () => {
  const { out, roots } = offsets(" dcl 1 R, 2 A char(3), 2 B fixed bin(31), 2 C fixed dec(7,2), 2 D pic '(5)9V99', 2 E fixed bin(15);");
  assert.deepEqual(out, { R: 0, A: 0, B: 3, C: 7, D: 11, E: 19 });
  assert.equal(roots[0].total, 21);
});

test('the first member moves toward the second, so the padding goes in front of the structure', () => {
  const { out, roots } = offsets(' dcl 1 R, 2 A char(1), 2 B fixed bin(31);');
  assert.deepEqual(out, { R: 0, A: 0, B: 1 });
  assert.equal(roots[0].total, 5);
});

test('UNALIGNED on a structure reaches every member that does not say otherwise, and bits pack', () => {
  const { out, roots } = offsets(' dcl 1 R unaligned, 2 F1 bit(1), 2 F2 bit(3), 2 B fixed bin(31), 2 C char(1);');
  assert.deepEqual([out.F1[0], out.F2[0], out.B, out.C], [0, 0, 1, 5]);
  assert.equal(out.F2[1] - out.F1[1], 1);
  assert.equal(roots[0].total, 6);
});

test('an explicitly ALIGNED member of an UNALIGNED structure keeps its boundary', () => {
  const { roots } = offsets(' dcl 1 R unaligned, 2 A char(1), 2 B fixed bin(31), 2 C aligned, 3 D fixed bin(31);');
  // A and B shift three bytes toward C, so C at offset 5 sits on a fullword.
  assert.deepEqual(roots[0].children.map((n) => n.offset), [0, 1, 5]);
});

test('an array of structures pads each element to the structure alignment', () => {
  const { roots } = offsets(' dcl 1 T, 2 E(3), 3 B fixed bin(31), 3 C char(1), 2 Z char(1);');
  const e = roots[0].children[0];
  assert.deepEqual([e.size, e.occurs, roots[0].children[1].offset, roots[0].total], [8, 3, 24, 25]);
});

test('a union overlays its members, each placed on its own alignment', () => {
  const { out } = offsets(' dcl 1 A union, 2 B, 3 C char(1), 3 D fixed bin(31), 2 E, 3 F char(2), 3 G fixed bin(31), 2 H char(8);');
  assert.deepEqual([out.B, out.C, out.E, out.F, out.H], [3, 3, 2, 2, 0]);
});

test('an extent that is not a constant is named, not guessed', () => {
  const { problems } = layout(items(' dcl 1 R, 2 A char(N), 2 B(M) fixed bin(15);'));
  assert.deepEqual(problems.map((p) => p.name), ['A', 'B']);
});

test('element storage follows the alignment table', () => {
  const s = (src) => { const x = storageOf(items(src)[0].attributes); return [x.bits / 8, x.align / 8]; };
  assert.deepEqual(s(' dcl X fixed bin(7);'), [1, 1]);
  assert.deepEqual(s(' dcl X fixed bin(8) unsigned;'), [1, 1]);
  assert.deepEqual(s(' dcl X fixed bin(15);'), [2, 2]);
  assert.deepEqual(s(' dcl X fixed bin(63);'), [8, 8]);
  assert.deepEqual(s(' dcl X fixed;'), [3, 1]);
  assert.deepEqual(s(' dcl X float bin(53);'), [8, 8]);
  assert.deepEqual(s(' dcl X float dec(33);'), [16, 8]);
  assert.deepEqual(s(' dcl X char(10) varying aligned;'), [12, 2]);
  assert.deepEqual(s(' dcl X char(10) varying;'), [12, 1]);
  assert.deepEqual(s(' dcl X char(10) varyingz;'), [11, 1]);
  assert.deepEqual(s(' dcl X widechar(4);'), [8, 1]);
  assert.deepEqual(s(' dcl X pointer;'), [4, 4]);
  assert.deepEqual(s(' dcl X entry variable;'), [8, 4]);
  assert.deepEqual(s(' dcl X area(100);'), [116, 8]);
  assert.deepEqual(s(' dcl X bit(12) aligned;'), [2, 1]);
});

test('a picture takes a byte per character except V, K and the F scaling factor', () => {
  assert.equal(pictureBytes('$9V99'), 4);
  assert.equal(pictureBytes('(5)9V(2)9'), 7);
  assert.equal(pictureBytes('ZZ9.99CR'), 8);
  assert.equal(pictureBytes('99F(-2)'), 2);
});

test('builtin and generic names take no storage, file attributes declare a file, and a bare name takes the RULES(IBM) default', () => {
  const s = (src) => { const it = items(src)[0]; return storageOf(it.attributes, { name: it.name }); };
  assert.deepEqual([s(' dcl SUBSTR builtin;').storage, s(' dcl SUBSTR builtin;').known], [false, true]);
  assert.equal(s(' dcl INFILE record input;').type, 'FILE');
  assert.deepEqual([s(' dcl COUNT static;').type, s(' dcl COUNT static;').implicit], ['FLOAT DECIMAL', true]);
  assert.equal(s(' dcl K init(0);').type, 'FIXED BINARY');
  assert.equal(s(' dcl T type ACCOUNT_T;').known, false);
});
