// Parses a COBOL source file within a directory tree, restoring the file index root if needed. (lib/kernel/source-tree.mjs parseInDirectory).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInDirectory } from '../lib/kernel/source-tree.mjs';
import './pin-machine.mjs';

test('restores fileIndex root when it differs from indexRoot', () => {
  const fileIndex = { root: '/original' };
  const spec = { fileIndex, indexRoot: '/restored', copyDirs: [], systemDirs: [] };
  const file = '/restored/src/PROG.cbl';
  const text = 'IDENTIFICATION DIVISION.\nPROGRAM-ID. TEST.';
  const result = parseInDirectory(spec, file, text);
  assert.equal(fileIndex.root, '/restored');
  assert.equal(result.file, '/restored/src/PROG.cbl');
  assert.equal(result.programs[0].id, 'TEST');
});

test('does not modify fileIndex root when it already matches indexRoot', () => {
  const fileIndex = { root: '/same' };
  const spec = { fileIndex, indexRoot: '/same', copyDirs: [], systemDirs: [] };
  const file = '/same/src/PROG.cbl';
  const text = 'IDENTIFICATION DIVISION.\nPROGRAM-ID. TEST.';
  const result = parseInDirectory(spec, file, text);
  assert.equal(fileIndex.root, '/same');
  assert.equal(result.file, '/same/src/PROG.cbl');
  assert.equal(result.programs[0].id, 'TEST');
});

test('uses provided text when text parameter is given', () => {
  const fileIndex = { root: '/root' };
  const spec = { fileIndex, indexRoot: '/root', copyDirs: [], systemDirs: [] };
  const file = '/root/src/PROG.cbl';
  const text = 'IDENTIFICATION DIVISION.\nPROGRAM-ID. MYPROG.';
  const result = parseInDirectory(spec, file, text);
  assert.equal(result.file, '/root/src/PROG.cbl');
  assert.equal(result.programs[0].id, 'MYPROG');
});

test('uses provided text when text is empty string', () => {
  const fileIndex = { root: '/root' };
  const spec = { fileIndex, indexRoot: '/root', copyDirs: [], systemDirs: [] };
  const file = '/root/src/PROG.cbl';
  const text = '';
  const result = parseInDirectory(spec, file, text);
  assert.equal(result.file, '/root/src/PROG.cbl');
  assert.equal(result.programs.length, 0);
});

test('passes copyDirs as includeDirs to parser', () => {
  const fileIndex = { root: '/root' };
  const copyDirs = ['/root/includes', '/root/common'];
  const spec = { fileIndex, indexRoot: '/root', copyDirs, systemDirs: [] };
  const file = '/root/src/PROG.cbl';
  const text = 'IDENTIFICATION DIVISION.\nPROGRAM-ID. TEST.';
  const result = parseInDirectory(spec, file, text);
  assert.equal(result.file, '/root/src/PROG.cbl');
  assert.equal(result.programs[0].id, 'TEST');
});

test('passes systemDirs to parser', () => {
  const fileIndex = { root: '/root' };
  const systemDirs = ['/usr/local/cobol', '/opt/cobol'];
  const spec = { fileIndex, indexRoot: '/root', copyDirs: [], systemDirs };
  const file = '/root/src/PROG.cbl';
  const text = 'IDENTIFICATION DIVISION.\nPROGRAM-ID. TEST.';
  const result = parseInDirectory(spec, file, text);
  assert.equal(result.file, '/root/src/PROG.cbl');
  assert.equal(result.programs[0].id, 'TEST');
});

test('handles empty copyDirs and systemDirs arrays', () => {
  const fileIndex = { root: '/root' };
  const spec = { fileIndex, indexRoot: '/root', copyDirs: [], systemDirs: [] };
  const file = '/root/src/PROG.cbl';
  const text = 'IDENTIFICATION DIVISION.\nPROGRAM-ID. TEST.';
  const result = parseInDirectory(spec, file, text);
  assert.equal(result.file, '/root/src/PROG.cbl');
  assert.equal(result.programs[0].id, 'TEST');
});

test('parses multiple programs from text', () => {
  const fileIndex = { root: '/root' };
  const spec = { fileIndex, indexRoot: '/root', copyDirs: [], systemDirs: [] };
  const file = '/root/src/PROG.cbl';
  const text = 'IDENTIFICATION DIVISION.\nPROGRAM-ID. FIRST.\nIDENTIFICATION DIVISION.\nPROGRAM-ID. SECOND.';
  const result = parseInDirectory(spec, file, text);
  assert.equal(result.programs.length, 2);
  assert.equal(result.programs[0].id, 'FIRST');
  assert.equal(result.programs[1].id, 'SECOND');
});
