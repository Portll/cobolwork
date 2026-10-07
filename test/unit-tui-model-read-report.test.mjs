// Validates that a document is a cobolwork findings report (lib/tui/model.mjs readReport).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readReport } from '../lib/tui/model.mjs';
import './pin-machine.mjs';

test('accepts a minimal valid report with empty findings', () => {
  const doc = { tool: 'cobolwork', findings: [], summary: {} };
  assert.deepEqual(readReport(doc), doc);
});

test('rejects null input', () => {
  assert.throws(() => readReport(null), /not a cobolwork findings report: it is not a JSON object/);
});

test('rejects non-object input', () => {
  assert.throws(() => readReport('string'), /not a cobolwork findings report: it is not a JSON object/);
});

test('rejects tool that does not start with cobolwork', () => {
  const doc = { tool: 'other', findings: [], summary: {} };
  assert.throws(() => readReport(doc), /not a cobolwork findings report: its tool is "other"/);
});

test('rejects missing findings array', () => {
  const doc = { tool: 'cobolwork', summary: {} };
  assert.throws(() => readReport(doc), /not a cobolwork findings report: it has no findings list/);
});

test('rejects missing summary object', () => {
  const doc = { tool: 'cobolwork', findings: [] };
  assert.throws(() => readReport(doc), /not a cobolwork findings report: it has no summary/);
});

test('rejects finding with non-string rule', () => {
  const doc = { tool: 'cobolwork', findings: [{ rule: 123 }], summary: {} };
  assert.throws(() => readReport(doc), /not a cobolwork findings report: finding 1 has a rule that is not text/);
});

test('rejects finding with non-array related', () => {
  const doc = { tool: 'cobolwork', findings: [{ related: 'notarray' }], summary: {} };
  assert.throws(() => readReport(doc), /not a cobolwork findings report: finding 1 has a related that is not a list of entries/);
});

test('rejects finding with guardedFrom but no guard', () => {
  const doc = { tool: 'cobolwork', findings: [{ guardedFrom: 'x' }], summary: {} };
  assert.throws(() => readReport(doc), /not a cobolwork findings report: finding 1 says a check lowered it but names no check/);
});

test('rejects incomplete sets that are not named entries', () => {
  const doc = { tool: 'cobolwork', findings: [], summary: { setsIncomplete: [42] } };
  assert.throws(() => readReport(doc), /not a cobolwork findings report: its incomplete sets are not named/);
});
