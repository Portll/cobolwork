// Privilege, and the two checks a repository can never witness.
//
// The load-bearing tests here are the ones about what the set says when the estate has said
// nothing. Two of these rules ask a question only RACF and a PROGxx member can answer, and the
// design is that they observe without asserting until someone answers it. A test that only
// exercised the answered case would let the unanswered one rot into a false positive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { scanPriv, PRIV_RULES } from '../lib/sets/priv.mjs';
import { parseCsd } from '../lib/csd.mjs';
import { ALL_RULES, RULE_SETS } from '../lib/scan.mjs';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BARE = join(HERE, 'fixtures', 'priv');
const SITED = join(HERE, 'fixtures', 'priv-site');
const bare = scanPriv(BARE);
const sited = scanPriv(SITED);
const of = (r) => r.findings.map((f) => [f.rule, f.sev, f.evidence]).sort();

test('a diagnostic transaction defined in the repository is reported whatever the estate has said', () => {
  const f = bare.findings.find((x) => x.rule === 'csd-defines-diagnostic-transaction');
  assert.equal(f.line, 2);
  assert.match(f.detail, /installs CECI/);
  assert.equal(f.sev, 'high');
});

test('command security is judged by what the program issues, not by the flag alone', () => {
  // PAY1 and PAY3 both run a program that issues EXEC CICS SET; only PAY3 sets CMDSEC(YES).
  // PAY2 runs a program that issues nothing CMDSEC governs and is not reported at any setting,
  // which is the whole point: CMDSEC(NO) is the CICS default and reporting it bare reports
  // every transaction in the corpus.
  const hits = bare.findings.filter((x) => x.rule === 'csd-transaction-without-command-security');
  assert.deepEqual(hits.map((f) => f.line), [4]);
  assert.match(hits[0].detail, /PAY1 runs PAYADM, which issues CICS system commands/);
  assert.equal(bare.summary.transactionsDefined, 4, 'four were read, one was reported');
});

test('a CMDSEC(YES) on one transaction does not clear another', () => {
  // The first implementation re-read the file for CMDSEC(YES) within 600 characters of the
  // definition, and PAY3's setting cleared PAY1's. The attribute now comes from the parsed block.
  const csd = parseCsd(['DEFINE TRANSACTION(AAAA) GROUP(G)', '       PROGRAM(P1) CMDSEC(NO)',
    'DEFINE TRANSACTION(BBBB) GROUP(G)', '       PROGRAM(P2) CMDSEC(YES)'].join('\n'));
  assert.equal(csd.transactions.get('AAAA').cmdsec, 'NO');
  assert.equal(csd.transactions.get('BBBB').cmdsec, 'YES');
});

test('with no estate facts the two unwitnessable checks observe and assert nothing', () => {
  assert.deepEqual(of(bare), [
    ['csd-defines-diagnostic-transaction', 'high', 'construct'],
    ['csd-transaction-without-command-security', 'med', 'construct'],
    ['job-reaches-unix-system-services', 'info', 'context'],
    ['job-runs-under-another-user', 'info', 'context'],
    ['job-unloads-the-security-database', 'info', 'context'],
    ['job-writes-diagnostic-output-unrestricted', 'info', 'context'],
    ['job-writes-diagnostic-output-unrestricted', 'info', 'context'],
    ['job-writes-diagnostic-output-unrestricted', 'info', 'context'],
  ]);
  for (const f of bare.findings.filter((x) => x.evidence === 'context')) {
    assert.match(f.detail, /cobolwork\.site\.json/, 'and each says which fact would decide it');
  }
  assert.deepEqual(bare.summary.factsNotDeclared, ['apfLibraries', 'restrictedDatasets', 'surrogateUsers']);
});

// Each finding names its missing fact, but the summary is what a reader counting clean sets reads,
// and without apfLibraries the APF check has nothing to observe, so it says nothing anywhere else.
test('a check with something to judge and no fact to judge it by leaves the set incomplete', () => {
  assert.equal(bare.summary.setIncomplete, true);
  const why = bare.summary.notLooked[0];
  assert.match(why, /^1 job\(s\) name the user they run as and no surrogateUsers are declared; /);
  assert.match(why, /1 step\(s\) unload the security database and no restrictedDatasets are declared; /);
  assert.match(why, /1 STEPLIB or JOBLIB statement\(s\) load programs and no apfLibraries are declared, so those checks were not judged/);
  assert.equal(sited.summary.setIncomplete, false, 'once the estate answers, every check was judged');
});

test('once the estate answers, the same observations become findings with a severity', () => {
  assert.deepEqual(of(sited), [
    ['csd-defines-diagnostic-transaction', 'high', 'construct'],
    ['csd-transaction-without-command-security', 'med', 'construct'],
    ['job-loads-from-an-authorised-library', 'high', 'construct'],
    ['job-reaches-unix-system-services', 'info', 'context'],
    ['job-runs-under-another-user', 'med', 'construct'],
    ['job-unloads-the-security-database', 'high', 'construct'],
    ['job-writes-diagnostic-output-unrestricted', 'med', 'construct'],
    ['job-writes-diagnostic-output-unrestricted', 'med', 'construct'],
  ]);
  const unload = sited.findings.find((f) => f.rule === 'job-unloads-the-security-database');
  // Equality, not a trailing substring: the earlier regex could not fail on over-collection, and
  // the code did over-collect - it named the STEPLIB, the database the utility READS and a later
  // step's output as places the security database had been written.
  assert.equal(unload.detail,
    'this job runs IRRDBU00 and writes the unloaded security database to PUBLIC.RACF.UNLOAD, which is not under any prefix the estate calls restricted');
  assert.deepEqual(sited.summary.factsNotDeclared, [], 'the estate answered all three');
});

test('a dataset prefix matches on whole components, so SYS1A is not SYS1', () => {
  const f = sited.findings.find((x) => x.rule === 'job-loads-from-an-authorised-library');
  assert.match(f.detail, /SYS1\.LINKLIB/);
  // PUBLIC.RACF.UNLOAD is not under SECURE.RACF even though both contain RACF.
  const unload = sited.findings.find((x) => x.rule === 'job-unloads-the-security-database');
  assert.equal(unload.sev, 'high');
});

test('a fact written in the wrong shape is reported as wrong, not as absent', () => {
  // The whole site-gated design rests on the estate supplying facts. An estate that writes a
  // string where an array belongs must be told THAT, not told its facts are undeclared - which
  // would send it looking for the wrong mistake while the checks silently stay at context.
  const root = mkdtempSync(join(tmpdir(), 'cw-priv-'));
  writeFileSync(join(root, 'cobolwork.site.json'), JSON.stringify({
    apfLibraries: 'SYS1.LINKLIB', productionQualifiers: ['PROD'],
  }));
  const r = scanPriv(root);
  assert.equal(r.summary.setIncomplete, true);
  assert.match(r.summary.siteProblems[0], /apfLibraries: expected an array of strings/);
  assert.match(r.summary.notLooked[0], /the privilege facts were not all read/);
  // And a well-formed site file says nothing of the kind.
  assert.equal(sited.summary.setIncomplete, false);
  assert.deepEqual(sited.summary.siteProblems, []);
});

test('opening a file is not scanning it', () => {
  // A CSD is a DFHCSDUP listing and nothing says what it must be called, so every file is opened.
  // But the whole-scan coverage number is the largest filesScanned of any set, and a set that
  // claimed every README and image in the tree as scanned would inflate the one number a reader
  // takes as "how much did you look at". Measured on CardDemo: 372 opened, 67 scanned.
  assert.equal(bare.summary.filesOpened, 6);
  assert.equal(bare.summary.filesScanned, 3, 'one CSD and two JCL');
  assert.ok(bare.summary.filesOpened > bare.summary.filesScanned);
});

test('a file of unbalanced parentheses does not stall the only parser that reads arbitrary bytes', () => {
  // parseCsd is handed any file holding a single DEFINE line, whole. With an unbounded value the
  // engine scanned to the end of the block and backtracked once per following attribute: 5.6s at
  // 100KB, 130s at 400KB. A file nobody chose to scan could stop a scan of the estate.
  const hostile = `DEFINE TRANSACTION(X) GROUP(G)
${'a('.repeat(200 * 512)}`;
  const started = process.hrtime.bigint();
  const csd = parseCsd(hostile);
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(ms < 5000, `400KB of unbalanced parens took ${Math.round(ms)}ms`);
  assert.equal(csd.transactions.get('X').program, null, 'and it still reads the definition it can');
});

test('the priv set is registered and its rules are in the catalogue of all rules', () => {
  assert.ok(RULE_SETS.includes('priv'));
  for (const id of Object.keys(PRIV_RULES)) assert.ok(ALL_RULES[id], `${id} is in ALL_RULES`);
});
