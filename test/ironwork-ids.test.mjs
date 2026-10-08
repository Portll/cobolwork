// The ids cobolwork reads from ironwork: the run endings held to ironwork's table, the message areas
// held to its catalogue, and the ironwork releases capabilities names for each format.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './pin-machine.mjs';
import { IRONWORK_FORMATS, IRONWORK_MINIMUM, MESSAGE_AREAS, MESSAGE_IDS, NOT_RUN_ABENDS, RUN_ENDINGS, UNDEFINED_NAME } from '../lib/ironwork-ids.mjs';
import { EQUIVALENCE_PREDICATE } from '../lib/equivalence.mjs';
import { capabilities } from '../lib/capabilities.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const VENDORED = join(HERE, 'fixtures', 'ironwork', 'run-endings.tsv');
const CATALOGUE = JSON.parse(readFileSync(join(HERE, '..', 'rules', 'ironwork-messages.json'), 'utf8'));
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

// The ids read apart from their area.
const NAMED_IDS = [...Object.keys(MESSAGE_IDS), UNDEFINED_NAME];

test('the message areas cobolwork reads are those of the catalogue, and each id it names is catalogued', () => {
  assert.deepEqual(Object.keys(MESSAGE_AREAS).sort(), Object.keys(CATALOGUE.counts.byArea).sort());
  const ids = new Set(CATALOGUE.messages.map((m) => m.id));
  for (const id of NAMED_IDS) assert.ok(ids.has(id), id);
});

test("the message areas and named ids are ironwork's", { skip: !ironwork && 'COBOLWORK_IRONWORK_DIR names no ironwork checkout' }, () => {
  const doc = lf(join(ironwork, 'docs', 'messages.md'));
  const areas = [...doc.slice(doc.indexOf('## Areas'), doc.indexOf('## Messages')).matchAll(/^\| ([A-Z]) \|/gm)].map((m) => m[1]);
  assert.deepEqual(areas.sort(), Object.keys(MESSAGE_AREAS).sort(), 'an area ironwork lists that MESSAGE_AREAS does not read, or the reverse');
  for (const id of NAMED_IDS) assert.match(doc, new RegExp(`^\\| ${id} \\|`, 'm'), id);
});

test('capabilities names the first ironwork release of each format it reads', () => {
  assert.ok(Object.hasOwn(IRONWORK_FORMATS, EQUIVALENCE_PREDICATE));
  for (const since of Object.values(IRONWORK_FORMATS)) assert.match(since, /^\d+\.\d+\.\d+$/);
  assert.equal(IRONWORK_FORMATS['run-endings'], IRONWORK_MINIMUM, 'the run endings set the minimum');
  assert.deepEqual(capabilities().ironwork, { minimum: IRONWORK_MINIMUM, formats: IRONWORK_FORMATS, runEndings: RUN_ENDINGS, notRunAbends: NOT_RUN_ABENDS });
});
