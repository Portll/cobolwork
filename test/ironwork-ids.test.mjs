// The ids cobolwork reads from ironwork: the run endings held to ironwork's table, and the ironwork
// releases capabilities names for each format.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './pin-machine.mjs';
import { IRONWORK_FORMATS, IRONWORK_MINIMUM, NOT_RUN_ABENDS, RUN_ENDINGS } from '../lib/ironwork-ids.mjs';
import { EQUIVALENCE_PREDICATE } from '../lib/equivalence.mjs';
import { capabilities } from '../lib/capabilities.mjs';

const VENDORED = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ironwork', 'run-endings.tsv');
const lf = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const rows = lf(VENDORED).split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'));

test('the run endings are those ironwork lists', () => {
  const statuses = Object.fromEntries(rows.filter(([kind]) => kind === 'status').map(([, id, outcome]) => [id, outcome]));
  assert.deepEqual(statuses, Object.fromEntries(Object.entries(RUN_ENDINGS).map(([k, v]) => [String(k), v])));
  assert.deepEqual(rows.filter(([kind, , outcome]) => kind === 'abend' && outcome === 'not-run').map(([, id]) => id), NOT_RUN_ABENDS);
  assert.deepEqual(rows.filter(([kind]) => kind !== 'status' && kind !== 'abend'), []);
});

const ironwork = process.env.COBOLWORK_IRONWORK_DIR;
test("the vendored run endings are ironwork's", { skip: !ironwork && 'COBOLWORK_IRONWORK_DIR names no ironwork checkout' }, () => {
  assert.equal(lf(VENDORED), lf(join(ironwork, 'docs', 'run-endings.tsv')), "copy ironwork's docs/run-endings.tsv to test/fixtures/ironwork/");
});

test('capabilities names the first ironwork release of each format it reads', () => {
  assert.ok(Object.hasOwn(IRONWORK_FORMATS, EQUIVALENCE_PREDICATE));
  for (const since of Object.values(IRONWORK_FORMATS)) assert.match(since, /^\d+\.\d+\.\d+$/);
  assert.equal(IRONWORK_FORMATS['run-endings'], IRONWORK_MINIMUM, 'the run endings set the minimum');
  assert.deepEqual(capabilities().ironwork, { minimum: IRONWORK_MINIMUM, formats: IRONWORK_FORMATS, runEndings: RUN_ENDINGS, notRunAbends: NOT_RUN_ABENDS });
});
