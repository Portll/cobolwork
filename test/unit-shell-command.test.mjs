// Which environment variables a literal shell command reads, and which only as one quoted argument (lib/shell-command.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environmentReads } from '../lib/shell-command.mjs';
import { classChars, stops } from '../lib/control.mjs';
import './pin-machine.mjs';

const read = (command) => environmentReads(command).map((r) => [r.name, r.parameterised]);

test('a quoted variable that is an argument of a literal program is one argument', () => {
  assert.deepEqual(read('lp -d "$P" -o cpi=10 report.txt'), [['P', true]]);
  assert.deepEqual(read('lp -d "${P}" report.txt'), [['P', true]]);
  assert.deepEqual(read('/usr/bin/lp "--dest=$P"'), [['P', true]]);
  assert.deepEqual(read('X=1 lp -d "$P"'), [['P', true]]);
  assert.deepEqual(read('if true; then lp -d "$P" r; fi'), [['P', true]]);
});

test('a variable the shell splits, runs or redirects to is not', () => {
  assert.deepEqual(read('lp -d $P report.txt'), [['P', false]]);
  assert.deepEqual(read('"$P" -x'), [['P', false]]);
  assert.deepEqual(read('sh -c "$P"'), [['P', false]]);
  assert.deepEqual(read('eval "$P"'), [['P', false]]);
  assert.deepEqual(read('env "$P"'), [['P', false]]);
  assert.deepEqual(read('if true; then sh -c "$P"; fi'), [['P', false]]);
  assert.deepEqual(read('lp > "$P"'), [['P', false]]);
  assert.deepEqual(read('echo "$(cat $P)"'), [['P', false]]);
  assert.deepEqual(read('$(echo; ls) "$P"'), [['P', false]]);
  assert.deepEqual(read('for v in "$P"; do lp -d "$v"; done'), [['P', false], ['v', true]]);
});

test('a single-quoted name is not read', () => {
  assert.deepEqual(read("echo '$P'"), []);
});

test('a class range holds every character ASCII or EBCDIC puts in it', () => {
  assert.equal(classChars([{ from: 'A', to: 'Z' }]).replace(/[A-Z]/g, ''), '\\}');
  assert.equal(classChars([{ from: 'A', to: 'I' }, { from: 'J', to: 'R' }, { from: 'S', to: 'Z' }]), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  assert.equal(classChars([{ lit: 'ab' }, null]), null);
});

test('a quoted argument is safe where its characters hold no shell syntax and it cannot be an option', () => {
  assert.equal(!!stops({ chars: 'AB-_ ', noDash: true }, 'os-command-argument'), true);
  assert.equal(!!stops({ chars: 'AB_ ' }, 'os-command-argument'), true);
  assert.equal(!!stops({ chars: 'AB-' }, 'os-command-argument'), false);
  assert.equal(!!stops({ chars: 'AB;', noDash: true }, 'os-command-argument'), false);
  assert.equal(!!stops({ chars: 'AB', noDash: true }, 'os-command'), false);
});
