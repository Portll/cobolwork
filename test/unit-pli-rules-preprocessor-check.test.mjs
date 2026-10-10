// computes whether preprocessor directives are used and reports first line and list (lib/pli/rules/preprocessor.mjs check).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../lib/pli/rules/preprocessor.mjs';
import './pin-machine.mjs';

test('returns empty findings when there are no statements', () => {
  const program = { path: 'a.cob', statements: [] };
  const findings = check(program);
  assert.deepStrictEqual(findings, []);
});

test('returns empty findings when statements are not parsed or have non parsed status', () => {
  const program = {
    path: 'b.cob',
    statements: [
      { line: 1, parsed: { status: 'error', node: { kind: 'PREPROCESSOR', directive: 'IF' } } },
      { line: 2 }
    ]
  };
  const findings = check(program);
  assert.deepStrictEqual(findings, []);
});

test('returns empty findings when a parsed statement has no node', () => {
  const program = {
    path: 'c.cob',
    statements: [{ line: 3, parsed: { status: 'parsed' } }]
  };
  const findings = check(program);
  assert.deepStrictEqual(findings, []);
});

test('returns empty findings when a parsed node is not a PREPROCESSOR', () => {
  const program = {
    path: 'd.cob',
    statements: [{ line: 4, parsed: { status: 'parsed', node: { kind: 'OTHER' } } }]
  };
  const findings = check(program);
  assert.deepStrictEqual(findings, []);
});

test('returns empty findings when the PREPROCESSOR directive is not in the known set', () => {
  const program = {
    path: 'e.cob',
    statements: [{ line: 5, parsed: { status: 'parsed', node: { kind: 'PREPROCESSOR', directive: 'XYZ' } } }]
  };
  const findings = check(program);
  assert.deepStrictEqual(findings, []);
});

test('detects a single recognised directive case insensitively and reports its line', () => {
  const program = {
    path: 'f.cob',
    statements: [{ line: 6, parsed: { status: 'parsed', node: { kind: 'PREPROCESSOR', directive: 'if' } } }]
  };
  const findings = check(program);
  assert.deepStrictEqual(findings, [
    {
      rule: 'pli-preprocessor-in-use',
      path: 'f.cob',
      line: 6,
      detail: 'preprocessor directives IF alter the source before compilation'
    }
  ]);
});

test('uses the line of the first statement that yields a recognised directive and aggregates later ones', () => {
  const program = {
    path: 'g.cob',
    statements: [
      { line: 7, parsed: { status: 'parsed', node: { kind: 'PREPROCESSOR', directive: 'XYZ' } } },
      { line: 8, parsed: { status: 'parsed', node: { kind: 'PREPROCESSOR', directive: 'do' } } },
      { line: 9, parsed: { status: 'parsed', node: { kind: 'PREPROCESSOR', directive: 'if' } } }
    ]
  };
  const findings = check(program);
  assert.deepStrictEqual(findings, [
    {
      rule: 'pli-preprocessor-in-use',
      path: 'g.cob',
      line: 8,
      detail: 'preprocessor directives DO, IF alter the source before compilation'
    }
  ]);
});

test('collects directives from nested units and removes duplicates', () => {
  const program = {
    path: 'h.cob',
    statements: [
      {
        line: 10,
        parsed: {
          status: 'parsed',
          node: {
            kind: 'PREPROCESSOR',
            directive: 'declare',
            units: [
              { node: { kind: 'PREPROCESSOR', directive: 'IF' } },
              { node: { kind: 'PREPROCESSOR', directive: 'declare' } },
              { node: { kind: 'OTHER' } }
            ]
          }
        }
      }
    ]
  };
  const findings = check(program);
  assert.deepStrictEqual(findings, [
    {
      rule: 'pli-preprocessor-in-use',
      path: 'h.cob',
      line: 10,
      detail: 'preprocessor directives DECLARE, IF alter the source before compilation'
    }
  ]);
});

test('handles units that are null, missing node, or contain non PREPROCESSOR nodes', () => {
  const program = {
    path: 'i.cob',
    statements: [
      {
        line: 11,
        parsed: {
          status: 'parsed',
          node: {
            kind: 'PREPROCESSOR',
            directive: 'go',
            units: [
              null,
              {},
              { node: null },
              { node: { kind: 'PREPROCESSOR', directive: 'goto' } }
            ]
          }
        }
      }
    ]
  };
  const findings = check(program);
  assert.deepStrictEqual(findings, [
    {
      rule: 'pli-preprocessor-in-use',
      path: 'i.cob',
      line: 11,
      detail: 'preprocessor directives GO, GOTO alter the source before compilation'
    }
  ]);
});
