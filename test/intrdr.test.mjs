// The internal reader submits whatever it is given as a job. Whether a transient-data queue reaches
// it is written in the CSD and the region's JCL, not in the program, so the rule fires only on a
// queue the estate has declared - and says it did not run over queues nobody declared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from '../lib/sets/flow.mjs';
import { parseCsd, ddOfQueue } from '../lib/csd.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'intrdr');
const reader = (r) => r.findings.filter(f => f.rule.endsWith('-to-internal-reader'));

test('a CSD maps a queue to its DD, following one indirect hop, and says nothing of an intrapartition queue', () => {
  const csd = parseCsd([
    ' DEFINE TDQUEUE(JOBS) GROUP(A)',
    '        DESCRIPTION(SUBMIT JOBS FROM CICS) TYPE(EXTRA) DDNAME(INREADER)',
    '* a comment line is not an attribute: DDNAME(NOTME)',
    ' DEFINE TDQUEUE(SUBQ) GROUP(A) TYPE(INDIRECT) INDIRECTNAME(JOBS)',
    ' DEFINE TDQUEUE(WORK) GROUP(A) TYPE(INTRA)',
    ' DEFINE TRANSACTION(JSUB) GROUP(A) PROGRAM(JOBSUB)',
  ].join('\n'));
  assert.equal(ddOfQueue(csd, 'JOBS'), 'INREADER');
  assert.equal(ddOfQueue(csd, 'SUBQ'), 'INREADER');
  assert.equal(ddOfQueue(csd, 'WORK'), null);
  assert.equal(ddOfQueue(csd, 'NOPE'), null);
  assert.equal(csd.transactions.get('JSUB').program, 'JOBSUB');
});

test('terminal input written to a queue the estate declares as the internal reader is critical', () => {
  const r = scan(join(FIXTURES, 'declared'));
  const f = reader(r);
  assert.equal(f.length, 1, 'the log queue, mapped to another DD, is not the internal reader');
  assert.equal(f[0].rule, 'cics-terminal-to-internal-reader');
  assert.equal(f[0].sev, 'crit');
  assert.equal(f[0].cwe, 'CWE-77');
  assert.equal(f[0].line, 13);
  assert.match(f[0].detail, /QUEUE\('JOBS'\), which the CSD sends to DD INREADER/);
  assert.equal(r.summary.setIncomplete, undefined, 'both queues were decided');
});

test('without a declaration the rule has not run, and the report says so instead of reading clean', () => {
  const r = scan(join(FIXTURES, 'undeclared'));
  assert.deepEqual(reader(r), []);
  assert.equal(r.summary.setIncomplete, true);
  assert.match(r.summary.notLooked[0], /^2 EXEC CICS WRITEQ TD statement\(s\)/);
  assert.match(r.summary.notLooked[0], /internalReaderDds/);
});

test('definitions kept as DFHCSDUP job input count the same as an extract', () => {
  const f = reader(scan(join(FIXTURES, 'sysin')));
  assert.deepEqual(f.map(x => x.rule), ['cics-terminal-to-internal-reader']);
});

test('a batch program writing to a DD its job sends to SYSOUT=(A,INTRDR) needs no declaration', () => {
  const r = scan(join(FIXTURES, 'batch'));
  const f = reader(r);
  assert.equal(f.length, 1);
  assert.equal(f[0].rule, 'argv-or-env-to-internal-reader');
  assert.equal(f[0].path, 'JOBGEN.cbl');
  assert.match(f[0].detail, /\/\/JOBOUT, which step STEP1 of JOBGEN\.jcl sends to the internal reader/);
  assert.equal(r.summary.setIncomplete, undefined);
});
