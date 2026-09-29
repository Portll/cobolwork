// An index, a reference-modification position or length, or an OCCURS DEPENDING ON count taken
// from input decides where a program reads or writes. Only input from outside - command line,
// terminal, web, job - is followed here: in batch COBOL nearly every subscript descends from a
// file record, and reporting those would be reporting batch COBOL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../lib/sets/flow.mjs';
import { parseFile } from '../lib/parser.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bounds');
const report = scan(FIXTURES);
const at = (file) => report.findings.filter(f => f.path === file && /-to-(subscript|reference-modification|occurs-depending-count)$/.test(f.rule));

test('the parser keeps what a statement indexes with, and where', () => {
  const [p] = parseFile(join(FIXTURES, 'REFMOD.cbl')).programs;
  const move = p.statements.find(s => s.verb === 'MOVE');
  assert.deepEqual(move.indexes.map(x => [x.host.u, x.tok.u, x.kind]), [['WS-BUF', 'WS-LEN', 'refmod-length']]);
  const [q] = parseFile(join(FIXTURES, 'SUBSCR.cbl')).programs;
  assert.deepEqual(q.statements.find(s => s.verb === 'MOVE').indexes.map(x => [x.host.u, x.tok.u, x.kind]), [['WS-ENTRY', 'WS-IDX', 'subscript']]);
});

test('command-line input used as a subscript is reported where it indexes', () => {
  const f = at('SUBSCR.cbl');
  assert.equal(f.length, 1);
  assert.equal(f[0].rule, 'argv-or-env-to-subscript');
  assert.equal(f[0].cwe, 'CWE-129');
  assert.equal(f[0].sev, 'high');
  assert.equal(f[0].line, 10);
  assert.match(f[0].detail, /WS-ENTRY, a table of 10/);
});

test('a bound on the index that ends the run when it fails stops the route', () => {
  assert.equal(at('BOUNDED.cbl').length, 0);
  const [c] = report.checked.filter(x => x.path === 'BOUNDED.cbl');
  assert.equal(c.rule, 'argv-or-env-to-subscript');
  assert.equal(c.guard.line, 10);
});

test('input deciding a reference-modification length is reported', () => {
  const f = at('REFMOD.cbl');
  assert.deepEqual(f.map(x => [x.rule, x.cwe]), [['argv-or-env-to-reference-modification', 'CWE-1285']]);
});

test('input deciding an OCCURS DEPENDING ON count is reported at the table', () => {
  const f = at('ODOCOUNT.cbl');
  assert.deepEqual(f.map(x => [x.rule, x.cwe, x.line]), [['argv-or-env-to-occurs-depending-count', 'CWE-1284', 7]]);
});

test('a subscript from a file record, and a loop counter, are not reported', () => {
  assert.deepEqual(at('FILEIDX.cbl'), []);
  assert.deepEqual(at('LOOPIDX.cbl'), []);
});

test('a loop counter compared with input in its UNTIL test does not receive the input', () => {
  assert.deepEqual(at('MENU.cbl'), []);
});

test('input reaching a table through its INDEXED BY name is followed, and a bound on the index is a check', () => {
  const f = at('INDEXNAME.cbl');
  assert.deepEqual(f.map(x => [x.rule, x.line, x.sev]), [['argv-or-env-to-subscript', 12, 'high']]);
  assert.match(f[0].detail, /TX subscripts WS-ENTRY/);
  // TX > 10 is ruled out and TX = 0 is not: the check is named and lowers the finding, which stays.
  assert.deepEqual(at('INDEXCHECKED.cbl').map(x => [x.rule, x.line, x.sev, x.guard.item, x.guardedFrom]), [['argv-or-env-to-subscript', 15, 'med', 'TX', 'high']]);
  assert.deepEqual(report.checked.filter(x => x.path === 'INDEXCHECKED.cbl'), []);
});

test('a program compiled with SSRANGE abends on a bad index, so the finding says so and is lowered', () => {
  const f = at('CHECKED.cbl');
  assert.equal(f.length, 1);
  assert.equal(f[0].ssrange, true);
  assert.equal(f[0].sev, 'med');
});

test('an estate that states it compiles with SSRANGE lowers every program but one that opts out on its own card', () => {
  const r = scan(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bounds-site'));
  const of = (file) => r.findings.filter(x => x.path === file && x.rule === 'argv-or-env-to-subscript');
  assert.deepEqual(of('ESTATE.cbl').map(x => [x.sev, x.ssrange]), [['med', true]]);
  assert.deepEqual(of('OPTOUT.cbl').map(x => [x.sev, x.ssrange]), [['high', undefined]]);
});
