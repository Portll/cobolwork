import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { verifyFile, jclProblems, versionRangeProblems, normalizeText } from '../feed/verify.mjs';
import { validate, GENERABLE, KIND_NAMES } from '../feed/schema.mjs';
import { CATALOGUE } from '../feed/catalogue.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'feed', 'fixtures');
const run = () => verifyFile(join(FIXTURES, 'sample-rows.jsonl'), { sourcesDir: join(FIXTURES, 'sources') });

// The gate decides what a person ever sees, so the failures it is supposed to catch are planted in
// the fixture and asserted one by one. A gate that silently stops catching something is worse than
// no gate, because the review it replaced is no longer happening either.
test('the gate accepts the sound rows and refuses each planted failure', () => {
  const { accepted, rejected } = run();
  assert.equal(accepted.length, 4);
  assert.equal(rejected.length, 5);

  const why = (n) => rejected.find((r) => r.line === n).problems.join('; ');
  assert.match(why(2), /is not a rule this engine reports/);
  assert.match(why(3), /does not appear in test-doc/);
  assert.match(why(5), /operation 'EXECUTE' is not a JCL statement/);
  assert.match(why(7), /'SYSB' matches the pattern but must not/);
  assert.match(why(9), /is not a version range this rule can evaluate/);
});

test('a quote is compared with whitespace collapsed and punctuation folded', () => {
  assert.equal(normalizeText('a’b  —  c d'), "a'b - c d");
});

test('the catalogue holds every rule the engine can report', () => {
  assert.equal(CATALOGUE.size, 225);
  assert.equal(CATALOGUE.get('input-selects-program').set, 'abend');
  assert.equal(CATALOGUE.get('zowe-mcp-tier-full').set, 'zowe');
  assert.ok(CATALOGUE.has('cics-commarea-without-length-check'));
  assert.equal(CATALOGUE.get('call-parameter-exceeds-caller-record').set, 'flow');
  assert.ok(CATALOGUE.has('jcl-racf-password'), 'the credential pack counts');
  assert.equal(CATALOGUE.get('jcl-instream-credential').set, 'jcl');
  assert.equal(CATALOGUE.get('database-to-message-queue').set, 'flow');
  assert.equal(CATALOGUE.get('display-echoes-a-credential').set, 'log');
});

test('the feed holds no ground-truth kind, so a labelled row is refused whoever made it', () => {
  assert.ok(!KIND_NAMES.includes('corpus'));
  assert.ok(!GENERABLE.includes('corpus'));
  for (const method of ['model', 'human']) assert.match(validate({ kind: 'corpus', method })[0], /kind: 'corpus' is not one of/);
});

test('the JCL gate refuses what a system would refuse', () => {
  assert.deepEqual(jclProblems('//STEP1    EXEC PGM=IEFBR14'), []);
  assert.match(jclProblems('STEP1 EXEC PGM=X').join(), /must begin with \/\//);
  assert.match(jclProblems('//TOOLONGNAME EXEC PGM=X').join(), /not 1 to 8 characters/);
  assert.match(jclProblems('//A EXEC COND=X').join(), /neither PGM= nor a procedure/);
  assert.match(jclProblems('//A JOB X,').join(), /ends on a continuation/);
  assert.match(jclProblems('//* only a comment').join(), /no statement/);
});

test('a version range is only accepted in a form the rule can evaluate', () => {
  assert.deepEqual(versionRangeProblems('<=2.2'), []);
  assert.deepEqual(versionRangeProblems('[2.0,2.2]'), []);
  assert.deepEqual(versionRangeProblems('<=2.2 || 3.0'), []);
  assert.equal(versionRangeProblems('anything older').length, 1);
});
