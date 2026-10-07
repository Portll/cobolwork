// Dispatches evidence verbs to seal, anchor, sign, or verify (lib/evidence/cli.mjs evidenceCommand).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evidenceCommand } from '../lib/evidence/cli.mjs';
import './pin-machine.mjs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('rejects unknown verbs with a refusal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evidenceCommand-'));
  try {
    assert.throws(
      () => evidenceCommand('bogus', {}, { toolVersion: '1', write: () => {}, env: {} }),
      (err) => err.message === 'evidence takes verify, seal, anchor, sign; got bogus'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rejects empty verb with a refusal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evidenceCommand-'));
  try {
    assert.throws(
      () => evidenceCommand('', {}, { toolVersion: '1', write: () => {}, env: {} }),
      (err) => err.message === 'evidence takes verify, seal, anchor, sign; got nothing'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sign requires a statement file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evidenceCommand-'));
  try {
    assert.throws(
      () => evidenceCommand('sign', { _: ['evidence', 'sign'] }, { toolVersion: '1', write: () => {}, env: {} }),
      (err) => err.message === 'evidence sign needs the statement file to sign'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sign rejects invalid json in statement file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evidenceCommand-'));
  try {
    const file = join(dir, 'bad.json');
    writeFileSync(file, 'not json');
    assert.throws(
      () => evidenceCommand('sign', { _: ['evidence', 'sign', file] }, { toolVersion: '1', write: () => {}, env: {} }),
      (err) => err instanceof SyntaxError
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify requires evidence dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evidenceCommand-'));
  try {
    assert.throws(
      () => evidenceCommand('verify', {}, { toolVersion: '1', write: () => {}, env: {} }),
      (err) => err.message === 'evidence needs --evidence <dir> or COBOLWORK_EVIDENCE'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('seal requires evidence dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evidenceCommand-'));
  try {
    assert.throws(
      () => evidenceCommand('seal', {}, { toolVersion: '1', write: () => {}, env: {} }),
      (err) => err.message === 'evidence needs --evidence <dir> or COBOLWORK_EVIDENCE'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('anchor requires anchor-git or tsq', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evidenceCommand-'));
  try {
    const evDir = join(dir, 'ev');
    mkdirSync(evDir, { recursive: true });
    assert.throws(
      () => evidenceCommand('anchor', { evidence: evDir }, { toolVersion: '1', write: () => {}, env: {} }),
      (err) => err.message === 'anchor needs --anchor-git <repo> or --tsq <file>'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify rejects negative max-unsealed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evidenceCommand-'));
  try {
    const evDir = join(dir, 'ev');
    mkdirSync(evDir, { recursive: true });
    assert.throws(
      () => evidenceCommand('verify', { evidence: evDir, maxUnsealed: -1 }, { toolVersion: '1', write: () => {}, env: {} }),
      (err) => err.message === '--max-unsealed takes a whole number; got -1'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify rejects non-integer max-unsealed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evidenceCommand-'));
  try {
    const evDir = join(dir, 'ev');
    mkdirSync(evDir, { recursive: true });
    assert.throws(
      () => evidenceCommand('verify', { evidence: evDir, maxUnsealed: 1.5 }, { toolVersion: '1', write: () => {}, env: {} }),
      (err) => err.message === '--max-unsealed takes a whole number; got 1.5'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify rejects anchor-pin without anchor-git', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evidenceCommand-'));
  try {
    const evDir = join(dir, 'ev');
    mkdirSync(evDir, { recursive: true });
    assert.throws(
      () => evidenceCommand('verify', { evidence: evDir, anchorPin: 'abc123' }, { toolVersion: '1', write: () => {}, env: {} }),
      (err) => err.message === '--anchor-pin names a commit of the --anchor-git witness'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
