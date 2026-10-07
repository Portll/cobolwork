// Computes shell command tokens, handling quotes, escapes, substitutions, comments and separators (lib/options.mjs shellTokens).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shellTokens } from '../lib/options.mjs';
import './pin-machine.mjs';

test('simple command splits words on whitespace', () => {
  const out = shellTokens('echo hello');
  assert.deepEqual(out, [{ word: 'echo' }, { word: 'hello' }]);
});

test('single quotes remove surrounding quotes and keep content', () => {
  const out = shellTokens("echo 'world'");
  assert.deepEqual(out, [{ word: 'echo' }, { word: 'world' }]);
});

test('backslash escape inserts the following character verbatim', () => {
  const out = shellTokens('echo \\$HOME');
  assert.deepEqual(out, [{ word: 'echo' }, { word: '$HOME' }]);
});

test('$(...) substitution is treated as a single word', () => {
  const out = shellTokens('echo $(date)');
  assert.deepEqual(out, [{ word: 'echo' }, { word: '$(date)' }]);
});

test('comment terminates parsing and is ignored', () => {
  const out = shellTokens('echo hello # comment');
  assert.deepEqual(out, [{ word: 'echo' }, { word: 'hello' }]);
});

test('&& and || are returned as separator objects', () => {
  const out = shellTokens('cmd1 && cmd2 || cmd3');
  assert.deepEqual(out, [
    { word: 'cmd1' },
    { sep: '&&' },
    { word: 'cmd2' },
    { sep: '||' },
    { word: 'cmd3' }
  ]);
});

test('batch dialect uses only double quotes for quoting', () => {
  const out = shellTokens('echo "test"', 'batch');
  assert.deepEqual(out, [{ word: 'echo' }, { word: 'test' }]);
});

test('backticks act as quotes in sh dialect', () => {
  const out = shellTokens('echo `date`');
  assert.deepEqual(out, [{ word: 'echo' }, { word: 'date' }]);
});

test('batch escape character ^ inserts the following character', () => {
  const out = shellTokens('echo ^&', 'batch');
  assert.deepEqual(out, [{ word: 'echo' }, { word: '&' }]);
});

test('powershell escape character ` inserts the following character', () => {
  const out = shellTokens('echo `&', 'powershell');
  assert.deepEqual(out, [{ word: 'echo' }, { word: '&' }]);
});
