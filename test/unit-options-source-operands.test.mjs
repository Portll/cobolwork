// Computes the list of operands that are source files or unnamed arguments (lib/options.mjs sourceOperands).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceOperands } from '../lib/options.mjs';
import './pin-machine.mjs';

test('ignores options that take a value and skips the following argument', () => {
  const args = ['-o', 'output.cob', '-I', 'include', 'main.cob'];
  const result = sourceOperands(args, 'gnucobol');
  assert.deepEqual(result, ['main.cob']);
});

test('keeps a source file that does not follow a value-taking option', () => {
  const args = ['-I', 'include', 'src.cob', '-L', 'lib'];
  const result = sourceOperands(args, 'gnucobol');
  assert.deepEqual(result, ['src.cob']);
});

test('does not treat a flag starting with - as a source file', () => {
  const args = ['-v', 'program.cob'];
  const result = sourceOperands(args, 'gnucobol');
  assert.deepEqual(result, ['program.cob']);
});

test('includes an argument that matches the source file regex but is not a flag', () => {
  const args = ['-x', 'test.cob'];
  const result = sourceOperands(args, 'gnucobol');
  assert.deepEqual(result, ['test.cob']);
});

test('captures unnamed arguments that contain special characters', () => {
  const args = ['$VAR', 'file.cob', '-D', 'DEBUG'];
  const result = sourceOperands(args, 'gnucobol');
  assert.deepEqual(result, ['$VAR', 'file.cob']);
});
