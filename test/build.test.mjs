import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build, buildSummaryLine } from '../lib/build.mjs';
import { scanAll } from '../lib/scan.mjs';
import { classesOf, classesOfRule, kindsOf } from '../lib/consequence.mjs';
import { ALL_RULES } from '../lib/kernel/registry.mjs';
import { SINK_KINDS } from '../lib/dataflow.mjs';
import { KEV } from '../lib/kev.mjs';
import { compilerTasks } from '../lib/options.mjs';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'bin', 'cobolwork.mjs');
const SPEC = readFileSync(join(HERE, '..', 'docs', 'spec', 'build-gate.md'), 'utf8');

const hasGit = spawnSync('git', ['--version']).status === 0;
const skip = !hasGit && 'git is not installed';
const posix = process.platform === 'win32' && 'the stand-in compiler is a shell script';
const git = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

const cobol = (lines) => lines.map((l) => {
  if (l.length > 72) throw new Error(`past column 72: ${l}`);
  return l;
}).join('\n') + '\n';
const program = (id, ws, body, cards = []) => cobol([
  ...cards.map((c) => `       ${c}`),
  '       IDENTIFICATION DIVISION.',
  `       PROGRAM-ID. ${id}.`,
  '       DATA DIVISION.',
  '       WORKING-STORAGE SECTION.',
  ...ws.map((l) => `       ${l}`),
  '       PROCEDURE DIVISION.',
  ...body.map((l) => `           ${l}`),
]);

// CRIT, both classes: command-line input reaches CALL 'SYSTEM'.
const OS_COMMAND = program('P', ['01 WS-IN PIC X(8).', '01 WS-CMD PIC X(80).'],
  ['ACCEPT WS-IN FROM COMMAND-LINE', 'MOVE WS-IN TO WS-CMD', "CALL 'SYSTEM' USING WS-CMD", 'GOBACK.']);
// HIGH, both classes: command-line input reaches EXECUTE IMMEDIATE.
const dynamicSql = (id, stmt = 'EXEC SQL EXECUTE IMMEDIATE :WS-SQL END-EXEC') => program(id, ['01 WS-IN PIC X(80).', '01 WS-SQL PIC X(80).'],
  ['ACCEPT WS-IN FROM COMMAND-LINE', 'MOVE WS-IN TO WS-SQL', stmt, 'GOBACK.']);
// MED, neither class: a transfer to a program a variable holding a literal names.
const XCTL = program('X', ["01 WS-PGM PIC X(8) VALUE 'NEXTPGM'."], ['EXEC CICS XCTL PROGRAM(WS-PGM) END-EXEC', 'GOBACK.']);
// MED, privilege escalation: a file opened for output under a name a record read from another file chose.
const FILE_NAME = cobol([
  '       IDENTIFICATION DIVISION.',
  '       PROGRAM-ID. F.',
  '       ENVIRONMENT DIVISION.',
  '       INPUT-OUTPUT SECTION.',
  '       FILE-CONTROL.',
  "           SELECT INF ASSIGN TO 'CONTROL.DAT'",
  '               ORGANIZATION IS LINE SEQUENTIAL.',
  '           SELECT OUTF ASSIGN TO WS-FNAME',
  '               ORGANIZATION IS LINE SEQUENTIAL.',
  '       DATA DIVISION.',
  '       FILE SECTION.',
  '       FD INF.',
  '       01 IN-REC PIC X(40).',
  '       FD OUTF.',
  '       01 OUT-REC PIC X(40).',
  '       WORKING-STORAGE SECTION.',
  '       01 WS-FNAME PIC X(40).',
  '       PROCEDURE DIVISION.',
  '           OPEN INPUT INF',
  '           READ INF',
  '           MOVE IN-REC TO WS-FNAME',
  '           OPEN OUTPUT OUTF',
  '           WRITE OUT-REC',
  '           GOBACK.',
]);
// HIGH, data mutation: command-line input subscripts a table.
const SUBSCRIPT = (cards = []) => program('S', ['01 WS-I PIC 99.', '01 T.', '   05 E PIC X OCCURS 3.'],
  ['ACCEPT WS-I FROM COMMAND-LINE', "MOVE 'Z' TO E(WS-I)", 'GOBACK.'], cards);
// MED, neither class: an FTP step with no TLS option.
const FTP = [
  "//FTPSEND  JOB 'FTP JCL',CLASS=A,MSGCLASS=H",
  '//STEP1    EXEC PGM=FTP',
  '//SYSIN    DD *',
  ' reports.example.com',
  ' ASCII',
  " PUT 'PAY.EXTRACT.DAILY' daily.txt",
  ' QUIT',
  '/*',
].join('\n') + '\n';
const QUIET = program('Q0', ['01 WS-A PIC X.'], ['GOBACK.']);

const site = (over = {}) => JSON.stringify({ compilerOptions: ['SSRANGE'], ...over });
const policy = (over = {}) => JSON.stringify({ policyVersion: 1, ...over });

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'cw-build-'));
  git(root, ['init', '-q']);
  for (const [k, v] of [['user.email', 't@example.com'], ['user.name', 't'], ['core.autocrlf', 'false']]) git(root, ['config', k, v]);
  patch(root, { 'cobolwork.site.json': site(), ...files });
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'base']);
  return root;
}
function patch(root, files) {
  for (const [name, text] of Object.entries(files)) {
    const to = join(root, name);
    if (text === null) { rmSync(to, { force: true }); continue; }
    mkdirSync(dirname(to), { recursive: true });
    writeFileSync(to, text);
  }
}
const outside = (name, text) => {
  const p = join(mkdtempSync(join(tmpdir(), 'cw-build-out-')), name);
  writeFileSync(p, text);
  return p;
};
// A compiler named cobc, or `name`, outside every repository, that records its arguments and exits
// as told.
function standInCobc(name = 'cobc') {
  const dir = mkdtempSync(join(tmpdir(), 'cw-cobc-'));
  const path = join(dir, name);
  writeFileSync(path, '#!/bin/sh\nprintf "%s\\n" "$@" > "$0.args"\nexit ${STAND_IN_STATUS:-0}\n');
  chmodSync(path, 0o755);
  return { path, args: () => (existsSync(`${path}.args`) ? readFileSync(`${path}.args`, 'utf8').trim().split('\n') : null) };
}
// An ironwork, outside every repository, that answers check as ironwork would for a few marked
// programs and records each run's arguments on a line of its own.
function standInIronwork() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-ironwork-'));
  const path = join(dir, 'ironwork');
  writeFileSync(path, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then echo "ironwork for COBOL 0.1.1"; exit 0; fi',
    'printf "%s " "$@" >> "$0.args"; echo >> "$0.args"',
    'if grep -q BADNAME "$2"; then echo "$2:7:12: \'NOPE\' is not a data name" >&2; exit 12; fi',
    'if grep -q CORRESPONDING "$2"; then echo "$2:9:12: MOVE CORRESPONDING is not supported yet" >&2; exit 12; fi',
    'if grep -q GONEMARK "$2"; then echo "$2:6:8: COPY GONE: no such member in the copy libraries" >&2; exit 12; fi',
    'if grep -q ENTRYMARK "$2"; then echo "$2:9:12: a statement, found ENTRY" >&2; exit 12; fi',
    'if grep -q DIBMARK "$2"; then echo "$2:9:12: DIBSTAT is not defined" >&2; exit 12; fi',
    'if grep -q DLIMARK "$2"; then echo "$2:9:12: EXEC DLI GU is not supported: ironwork for COBOL does not run IMS DL/I calls" >&2; echo "$2:10:12: DIBSTAT is not defined" >&2; exit 12; fi',
    'if grep -q WORDMARK "$2"; then echo "$2:9:12: a statement, found DIVISION" >&2; exit 12; fi',
    'if grep -q WARNMARK "$2"; then echo "$2:3:8: warning: THREAD is not on the CBL card" >&2; exit 4; fi',
    'if grep -q EMARK "$2"; then echo "$2:8:12: \'NOPE\' is not a data name" >&2; echo "$2: warning: THREAD is not on the CBL card" >&2; echo "informational: 1 program" >&2; exit 8; fi',
    'exit 0',
  ].join('\n') + '\n');
  chmodSync(path, 0o755);
  return { path, runs: () => (existsSync(`${path}.args`) ? readFileSync(`${path}.args`, 'utf8').trim().split('\n') : null) };
}
const cli = (args, env = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
const ratchet = (root, opts = {}) => build(root, { base: 'HEAD', ...opts }).doc;
const absolute = (root, opts = {}) => build(root, opts).doc;
const blockingRules = (doc) => doc.blocking.map((f) => f.rule).sort();
const DAY = 24 * 60 * 60 * 1000;
const waiver = (f, { atDays = -1, expiresDays = 30 } = {}) => ({
  fingerprint: f.fingerprint, rule: f.rule, path: f.path, action: 'accept', reason: 'accepted for the test', who: 'tester',
  at: new Date(Date.now() + atDays * DAY).toISOString(), expires: new Date(Date.now() + expiresDays * DAY).toISOString(),
});
const baseline = (entries) => JSON.stringify({ entries });
const findingOf = (root, rule) => {
  const f = scanAll(root).findings.find((x) => x.rule === rule);
  assert.ok(f, `the tree holds ${rule}`);
  return f;
};

// B1 - The policy

test('B1.1 With no policy the defaults apply', { skip }, () => {
  const doc = absolute(repo({ 'Q.cbl': dynamicSql('Q') }));
  assert.equal(doc.verdict, 'fail');
  assert.deepEqual(blockingRules(doc), ['argv-or-env-to-dynamic-sql']);
  assert.equal(doc.blocking[0].tier, 'high');
  assert.equal(doc.policy.setBy.block, 'default');
});

test('B1.2 A policy that does not validate stops the gate', { skip }, () => {
  const root = repo({ 'Q0.cbl': QUIET, 'cobolwork.policy.json': policy({ block: 'severe' }) });
  const r = cli(['build', root]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /block must be one of/);
  assert.equal(r.stdout, '');
});

test('B1.3 The repository cannot loosen the floor', { skip }, () => {
  const root = repo({ 'Q.cbl': dynamicSql('Q'), 'cobolwork.policy.json': policy({ block: 'crit' }) });
  const doc = absolute(root, { policy: outside('floor.json', policy({ block: 'high' })) });
  assert.equal(doc.verdict, 'fail');
  assert.ok(doc.policy.ignored.includes('block'));
  assert.equal(doc.policy.applied.block, 'high');
});

test('B1.4 A floor inside the repository is refused', { skip }, () => {
  const root = repo({ 'Q0.cbl': QUIET, 'org/floor.json': policy() });
  assert.throws(() => absolute(root, { policy: join(root, 'org', 'floor.json') }), /inside the repository/);
  assert.equal(cli(['build', root, '--policy', join(root, 'org', 'floor.json')]).status, 2);
});

test('B1.5 A rule set to block blocks below the threshold', { skip }, () => {
  const root = repo({ 'Q0.cbl': QUIET, 'cobolwork.policy.json': policy({ rules: { 'jcl-ftp-cleartext': 'block' } }) });
  patch(root, { 'FTPSEND.jcl': FTP });
  const doc = ratchet(root);
  assert.equal(doc.verdict, 'fail');
  assert.equal(doc.blocking[0].rule, 'jcl-ftp-cleartext');
  assert.equal(doc.blocking[0].because, 'rule');
});

test('B1.6 A rule set to warn never blocks', { skip }, () => {
  const doc = absolute(repo({ 'Q.cbl': dynamicSql('Q'), 'cobolwork.policy.json': policy({ rules: { 'argv-or-env-to-dynamic-sql': 'warn' } }) }));
  assert.equal(doc.verdict, 'pass');
  assert.equal(doc.findings.find((f) => f.rule === 'argv-or-env-to-dynamic-sql').blocking, false);
});

test('B1.7 A MED finding in no consequence class is advisory', { skip }, () => {
  const doc = absolute(repo({ 'FTPSEND.jcl': FTP }));
  const f = doc.findings.find((x) => x.rule === 'jcl-ftp-cleartext');
  assert.equal(f.tier, 'med');
  assert.deepEqual(f.classes, []);
  assert.equal(f.blocking, false);
  assert.equal(doc.verdict, 'pass');
});

// B2 - The modes

test('B2.1 Ratchet mode passes an old finding and fails a new one', { skip }, () => {
  const root = repo({ 'Q.cbl': dynamicSql('Q') });
  patch(root, { 'R.cbl': dynamicSql('R') });
  const doc = ratchet(root);
  assert.equal(doc.verdict, 'fail');
  assert.deepEqual(doc.blocking.map((f) => f.path), ['R.cbl']);
  assert.equal(doc.findings.find((f) => f.path === 'Q.cbl').blocking, false);
});

test('B2.2 Rewording a flagged line does not make its finding new', { skip }, () => {
  const root = repo({ 'Q.cbl': dynamicSql('Q') });
  patch(root, { 'Q.cbl': dynamicSql('Q', 'EXEC SQL  EXECUTE IMMEDIATE  :WS-SQL  END-EXEC') });
  const doc = ratchet(root);
  assert.equal(doc.verdict, 'pass');
  assert.equal(doc.findings.find((f) => f.path === 'Q.cbl').introduced, false);
});

test('B2.3 A finding at the always severity blocks wherever it is', { skip }, () => {
  const root = repo({ 'P.cbl': OS_COMMAND });
  patch(root, { 'Q0.cbl': QUIET });
  const doc = ratchet(root);
  assert.equal(doc.verdict, 'fail');
  assert.equal(doc.blocking[0].rule, 'argv-or-env-to-os-command');
  assert.equal(doc.blocking[0].introduced, false);
});

test('B2.4 The change is judged by the base\'s policy', { skip }, () => {
  const root = repo({ 'Q0.cbl': QUIET });
  patch(root, { 'cobolwork.policy.json': policy({ block: 'crit', classes: [] }), 'Q.cbl': dynamicSql('Q') });
  const doc = ratchet(root);
  assert.equal(doc.verdict, 'fail');
  assert.ok(doc.configurationChanged.includes('cobolwork.policy.json'));
  assert.equal(doc.policy.applied.block, 'high');
});

test('B2.5 A waiver the change adds does not cover the change', { skip }, () => {
  const root = repo({ 'Q0.cbl': QUIET });
  patch(root, { 'Q.cbl': dynamicSql('Q') });
  patch(root, { 'cobolwork.baseline.json': baseline([waiver(findingOf(root, 'argv-or-env-to-dynamic-sql'))]) });
  const doc = ratchet(root);
  assert.equal(doc.verdict, 'fail');
  assert.deepEqual(doc.waived, []);
  assert.ok(doc.configurationChanged.includes('cobolwork.baseline.json'));
});

test('B2.6 A site-file change does not switch a rule off for the change that makes it', { skip }, () => {
  const estate = { productionQualifiers: ['PROD'], productionJobPaths: ['P*.jcl'], nonProductionJobPaths: ['T*.jcl'] };
  const root = repo({ 'cobolwork.site.json': site(estate) });
  const job = [
    "//TPAYCLN  JOB (ACCT),'PAYROLL CLEAR-DOWN',CLASS=A,MSGCLASS=X",
    '//CLEANUP  EXEC PGM=IEFBR14',
    '//MASTER   DD DSN=PROD.PAYROLL.MASTER,DISP=(OLD,DELETE)',
  ].join('\n') + '\n';
  patch(root, { 'cobolwork.site.json': site({ ...estate, productionQualifiers: [] }), 'TPAYCLN.jcl': job });
  const doc = ratchet(root);
  assert.deepEqual(blockingRules(doc), ['recon-nonproduction-job-writes-production-dataset']);
  assert.ok(doc.configurationChanged.includes('cobolwork.site.json'));
});

test('B2.7 Absolute mode blocks every finding at the threshold', { skip }, () => {
  const doc = absolute(repo({ 'Q.cbl': dynamicSql('Q'), 'R.cbl': dynamicSql('R') }));
  assert.equal(doc.mode, 'absolute');
  assert.equal(doc.blocking.length, 2);
});

// B3 - Waivers

const waived = (w, opts = {}) => {
  const root = repo({ 'Q.cbl': dynamicSql('Q') });
  patch(root, { 'cobolwork.baseline.json': baseline([waiver(findingOf(root, 'argv-or-env-to-dynamic-sql'), w)]) });
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'waiver']);
  return absolute(root, opts);
};

test('B3.1 A live waiver covers its finding', { skip }, () => {
  const doc = waived({ expiresDays: 30 });
  assert.equal(doc.verdict, 'pass');
  assert.equal(doc.waived[0].rule, 'argv-or-env-to-dynamic-sql');
  assert.equal(doc.waived[0].who, 'tester');
});

test('B3.2 An expired waiver covers nothing', { skip }, () => {
  const doc = waived({ atDays: -60, expiresDays: -1 });
  assert.equal(doc.verdict, 'fail');
  assert.equal(doc.expired[0].rule, 'argv-or-env-to-dynamic-sql');
});

test('B3.3 A waiver written further out than maxDays covers nothing', { skip }, () => {
  const doc = waived({ atDays: -1, expiresDays: 730 });
  assert.equal(doc.verdict, 'fail');
  assert.equal(doc.overlong[0].rule, 'argv-or-env-to-dynamic-sql');
  assert.ok(doc.reasons.some((r) => /runs past the policy's 180 days/.test(r)));
});

test('B3.4 --no-baseline makes every waiver inert', { skip }, () => {
  const doc = waived({ expiresDays: 30 }, { noBaseline: true });
  assert.equal(doc.verdict, 'fail');
  assert.deepEqual(doc.waived, []);
});

// B4 - Coverage

const MISSING_COPY = program('M', ['COPY NOSUCHBOOK.'], ['GOBACK.']);

test('B4.1 Incomplete coverage is undecided under the default policy', { skip }, () => {
  const root = repo({ 'M.cbl': MISSING_COPY });
  const doc = absolute(root);
  assert.equal(doc.checks.coverage, null);
  assert.equal(doc.verdict, 'undecided');
  assert.equal(cli(['build', root]).status, 3);
});

test('B4.2 coverage warn lets the verdict be decided', { skip }, () => {
  const doc = absolute(repo({ 'M.cbl': MISSING_COPY, 'cobolwork.policy.json': policy({ coverage: 'warn' }) }));
  assert.equal(doc.checks.coverage, true);
  assert.equal(doc.verdict, 'pass');
  assert.ok(doc.reasons.some((r) => /^coverage is incomplete/.test(r)));
});

test('B4.3 A floor that blocks on coverage wins', { skip }, () => {
  const root = repo({ 'M.cbl': MISSING_COPY, 'cobolwork.policy.json': policy({ coverage: 'warn' }) });
  const doc = absolute(root, { policy: outside('floor.json', policy({ coverage: 'block' })) });
  assert.equal(doc.verdict, 'undecided');
});

test('B4.4 A copy library from outside the tree completes the coverage', { skip }, () => {
  const root = repo({ 'M.cbl': MISSING_COPY });
  const lib = dirname(outside('NOSUCHBOOK.cpy', '       01 WS-FROM-LIB PIC X(8).\n'));
  const r = build(root, { copylibs: [lib] });
  assert.equal(r.doc.checks.coverage, true);
  assert.equal(r.doc.verdict, 'pass');
  assert.deepEqual(r.provenance.copylibs, [lib]);
  const out = cli(['build', root, '--copylib', lib]);
  assert.equal(out.status, 0, out.stderr);
});

test('B4.5 A copy library that is not a directory is refused', { skip }, () => {
  const r = cli(['build', repo({ 'Q0.cbl': QUIET }), '--copylib', join(tmpdir(), 'cw-no-such-library')]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /is not a directory/);
});

// B5 - Run-time checks and compiler options

// The options reader is tested under a policy that blocks on options, as the default does not.
const strict = (root) => { patch(root, { 'cobolwork.policy.json': policy({ options: 'block' }) }); return root; };

const withCards = (cards, siteOver) => {
  const root = repo({ 'Q0.cbl': program('Q0', ['01 WS-A PIC X.'], ['GOBACK.'], cards) });
  if (siteOver !== undefined) {
    patch(root, { 'cobolwork.site.json': siteOver });
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'site']);
  }
  return root;
};

test('B5.1 NOSSRANGE in a CBL statement fails the options check', { skip }, () => {
  const doc = absolute(strict(withCards(['CBL NOSSRANGE'], JSON.stringify({}))));
  assert.equal(doc.checks.options, false);
  assert.ok(doc.reasons.some((r) => /^Q0\.cbl: .*NOSSRANGE is set by the CBL statement at line 1$/.test(r)), doc.reasons.join('\n'));
});

test('B5.2 A CBL statement overrides the estate default', { skip }, () => {
  const doc = absolute(withCards(['CBL SSRANGE'], site({ compilerOptions: ['NOSSRANGE'] })));
  assert.equal(doc.checks.options, true);
});

test('B5.3 SSRANGE(MSG) does not satisfy the subscript check', { skip }, () => {
  const doc = absolute(strict(withCards(['CBL SSRANGE(NOZLEN,MSG)'])));
  assert.equal(doc.checks.options, false);
});

test('B5.4 A bare PARMCHECK does not satisfy the argument-length check', { skip }, () => {
  const root = withCards(['CBL SSRANGE,PARMCHECK']);
  patch(root, { 'cobolwork.policy.json': policy({ checks: ['subscript', 'argument-length'], options: 'block' }) });
  const doc = absolute(root);
  assert.equal(doc.checks.options, false);
  assert.ok(doc.reasons.some((r) => /PARMCHECK .*\(MSG\)/.test(r)));
});

test('B5.5 A program with no known options is undecided', { skip }, () => {
  const doc = absolute(strict(withCards([], JSON.stringify({}))));
  assert.equal(doc.checks.options, null);
  assert.equal(doc.verdict, 'undecided');
});

test('B5.6 A missing GnuCOBOL check is added as its -fec option', { skip: skip || posix }, () => {
  const cobc = standInCobc();
  const doc = absolute(repo({ 'Q0.cbl': QUIET }), { compiler: [cobc.path, '-x', 'Q0.cbl'] });
  assert.deepEqual(doc.optionsAdded, ['-fec=EC-BOUND-REF-MOD', '-fec=EC-BOUND-SUBSCRIPT']);
  assert.deepEqual(cobc.args(), ['-x', 'Q0.cbl', '-fec=EC-BOUND-REF-MOD', '-fec=EC-BOUND-SUBSCRIPT']);
  assert.equal(doc.checks.compile, true);
});

test('B5.7 -debug satisfies every GnuCOBOL check', { skip: skip || posix }, () => {
  const cobc = standInCobc();
  const doc = absolute(repo({ 'Q0.cbl': QUIET }), { compiler: [cobc.path, '-debug', 'Q0.cbl'] });
  assert.deepEqual(doc.optionsAdded, []);
  assert.equal(doc.checks.options, true);
});

test('B5.8 A forbidden GnuCOBOL option is refused, not removed', { skip: skip || posix }, () => {
  const cobc = standInCobc();
  const doc = absolute(strict(repo({ 'Q0.cbl': QUIET })), { compiler: [cobc.path, '-fno-ec', 'EC-BOUND', 'Q0.cbl'] });
  assert.equal(doc.checks.options, false);
  assert.equal(cobc.args(), null, 'the compiler did not run');
});

test('B5.9 A check the pinned GnuCOBOL cannot generate fails', { todo: 'the pinned-version check is not built (spec §15, step 5)' }, () => {});

const NO_SITE = { 'cobolwork.site.json': JSON.stringify({}) };

test('B5.10 A JCL compile step\'s PARM decides the options of the member it compiles', { skip }, () => {
  const jcl = ['//CMP      JOB 1', "//C        EXEC PGM=IGYCRCTL,PARM='NOSSRANGE,LIB'", '//SYSIN    DD DSN=MY.SRC(P),DISP=SHR'].join('\n') + '\n';
  const doc = absolute(strict(repo({ ...NO_SITE, 'P.cbl': program('P', ['01 WS-A PIC X.'], ['GOBACK.']), 'CMP.jcl': jcl })));
  assert.equal(doc.checks.options, false);
  assert.ok(doc.reasons.some((r) => /^P\.cbl: .*NOSSRANGE is set by the compile step at CMP\.jcl:2$/.test(r)), doc.reasons.join('\n'));
});

test('B5.11 A compile procedure\'s PARM.COBOL applies to the member COBOL.SYSIN names', { skip }, () => {
  const jcl = ['//CMP      JOB 1', "//C        EXEC IGYWCL,PARM.COBOL='SSRANGE'", '//COBOL.SYSIN DD DSN=MY.SRC(P),DISP=SHR'].join('\n') + '\n';
  const doc = absolute(repo({ ...NO_SITE, 'P.cbl': program('P', ['01 WS-A PIC X.'], ['GOBACK.']), 'CMP.jcl': jcl }));
  assert.equal(doc.checks.options, true);
});

test('B5.18 A compile step silent on SSRANGE leaves it to the installation\'s default', { skip }, () => {
  const jcl = ['//CMP      JOB 1', "//C        EXEC PGM=IGYCRCTL,PARM='LIB'", '//SYSIN    DD DSN=MY.SRC(P),DISP=SHR'].join('\n') + '\n';
  const doc = absolute(strict(repo({ ...NO_SITE, 'P.cbl': program('P', ['01 WS-A PIC X.'], ['GOBACK.']), 'CMP.jcl': jcl })));
  assert.equal(doc.checks.options, null);
});

test('B5.19 A procedure in the tree takes its member from the caller, and PARM=(…) is a list', { skip }, () => {
  const proc = ['//DB2PROC  PROC', "//COBL     EXEC PGM=IGYCRCTL,PARM='LIB'", '//SYSIN    DD DISP=SHR,DSN=SRC.LIB(&MEM)', '//         PEND'].join('\n') + '\n';
  const job = ['//J        JOB 1', '//S        EXEC DB2PROC,MEM=P,PARM.COBL=(LIB,NOSSRANGE)'].join('\n') + '\n';
  const doc = absolute(strict(repo({ ...NO_SITE, 'P.cbl': program('P', ['01 WS-A PIC X.'], ['GOBACK.']), 'DB2PROC.jcl': proc, 'RUN.jcl': job })));
  assert.equal(doc.checks.options, false);
  assert.ok(doc.reasons.some((r) => /^P\.cbl: .*NOSSRANGE is set by the compile step at RUN\.jcl:2$/.test(r)), doc.reasons.join('\n'));
});

test('B5.12 A build script\'s cobc command without the checks fails the options check', { skip }, () => {
  const make = ['COBC = cobc', 'FLAGS = -x -free', 'prog: prog.cbl', '\t$(COBC) $(FLAGS) -o prog prog.cbl', ''].join('\n');
  const doc = absolute(strict(repo({ ...NO_SITE, 'prog.cbl': QUIET, Makefile: make })));
  assert.equal(doc.checks.options, false);
  assert.ok(doc.reasons.some((r) => /^Makefile:4: subscript needs -fec=EC-BOUND-SUBSCRIPT or -debug/.test(r)), doc.reasons.join('\n'));
});

test('B5.13 A build script\'s cobc command with -debug passes', { skip }, () => {
  const doc = absolute(repo({ ...NO_SITE, 'prog.cbl': QUIET, 'build.sh': '#!/bin/sh\ncobc -x -debug prog.cbl\n' }));
  assert.equal(doc.checks.options, true);
});

test('B5.15 options warn decides a build whose options nothing declares', { skip }, () => {
  const doc = absolute(repo({ ...NO_SITE, 'Q0.cbl': QUIET, 'cobolwork.policy.json': policy({ options: 'warn' }) }));
  assert.equal(doc.checks.options, true);
  assert.ok(doc.reasons.some((r) => /options of some programs are unknown, and the policy says warn/.test(r)));
  assert.equal(doc.verdict, 'pass');
});

test('B5.16 Under the default policy a build without the checks passes relaxed', { skip }, () => {
  const make = ['COBC = cobc', 'prog: prog.cbl', '\t$(COBC) -x -free -o prog prog.cbl', ''].join('\n');
  const root = repo({ ...NO_SITE, 'prog.cbl': QUIET, Makefile: make, 'P.cbl': program('P', ['01 WS-A PIC X.'], ['GOBACK.'], ['CBL NOSSRANGE']) });
  const doc = absolute(root);
  assert.equal(doc.verdict, 'pass');
  assert.deepEqual(doc.relaxed, ['options']);
  assert.equal(doc.checks.options, true);
  assert.ok(doc.reasons.some((r) => /^Makefile:3: subscript needs/.test(r)), doc.reasons.join('\n'));
  assert.ok(doc.reasons.some((r) => /built without a check the policy names, and the policy says warn/.test(r)));
  assert.match(buildSummaryLine(doc), /^cobolwork build: pass \(relaxed: options\)/);
  assert.equal(cli(['build', root]).status, 0);
});

test('B5.20 An option the policy forbids fails under warn', { skip }, () => {
  const root = withCards(['CBL NOSSRANGE'], JSON.stringify({}));
  patch(root, { 'cobolwork.policy.json': policy({ forbid: { enterprise: ['NOSSRANGE'] } }) });
  const doc = absolute(root);
  assert.equal(doc.checks.options, false);
  assert.equal(doc.verdict, 'fail');
  assert.deepEqual(doc.relaxed, []);
});

test('B5.21 A change that removes a check the base generated fails under warn', { skip }, () => {
  const root = repo({ ...NO_SITE, 'prog.cbl': QUIET, 'build.sh': '#!/bin/sh\ncobc -x -debug prog.cbl\n' });
  patch(root, { 'build.sh': '#!/bin/sh\ncobc -x prog.cbl\n' });
  const doc = ratchet(root);
  assert.equal(doc.verdict, 'fail');
  assert.equal(doc.checks.options, false);
  assert.ok(doc.reasons.some((r) => /^build\.sh: the subscript check was generated before the change and is not after it$/.test(r)), doc.reasons.join('\n'));
  patch(root, { 'build.sh': '#!/bin/sh\ncobc -x -debug prog.cbl\ncobc -x other.cbl\n', 'other.cbl': QUIET });
  assert.equal(ratchet(root).verdict, 'fail', 'a script whose every command generated the check no longer does');
});

test('B5.22 A build with no checks that the change leaves alone passes relaxed in ratchet mode', { skip }, () => {
  const root = repo({ ...NO_SITE, 'prog.cbl': QUIET, 'build.sh': '#!/bin/sh\ncobc -x prog.cbl\n' });
  patch(root, { 'build.sh': '#!/bin/sh\ncobc -x -O prog.cbl\n' });
  const doc = ratchet(root);
  assert.equal(doc.verdict, 'pass');
  assert.deepEqual(doc.relaxed, ['options']);
});

test('B5.17 A floor that blocks on unknown options wins', { skip }, () => {
  const root = repo({ ...NO_SITE, 'Q0.cbl': QUIET, 'cobolwork.policy.json': policy({ options: 'warn' }) });
  const doc = absolute(root, { policy: outside('floor.json', policy({ options: 'block' })) });
  assert.equal(doc.verdict, 'undecided');
  assert.ok(doc.policy.ignored.includes('options'));
});

test('B5.14 An editor\'s task file and a script with no extension are build scripts', { skip }, () => {
  const tasks = JSON.stringify({ version: '2.0.0', tasks: [{ label: 'Build', type: 'shell', command: 'cobc', args: ['-x', '${file}'] }] }, null, 1);
  const doc = absolute(strict(repo({ ...NO_SITE, 'prog.cbl': QUIET, '.vscode/tasks.json': tasks, 'scripts/run': 'cobc -x -debug prog.cbl\n./prog\n' })));
  assert.equal(doc.checks.options, false);
  assert.ok(doc.reasons.some((r) => /^\.vscode\/tasks\.json:\d+: subscript needs/.test(r)), doc.reasons.join('\n'));
  assert.ok(!doc.reasons.some((r) => /^scripts\/run/.test(r)), 'the script with -debug generates the checks');
});

test('B5.23 A task\'s command line is read command by command, with its arguments and its Windows variant', { skip }, () => {
  const tasks = [
    '{',
    '  // the build',
    '  "version": "2.0.0",',
    '  "tasks": [{',
    '    "label": "Build", "type": "shell",',
    '    "command": "mkdir -p bin && cobc -x -free -o bin/prog",',
    '    "args": ["${workspaceFolder}/prog.cbl"],',
    '    "windows": { "command": "if (!(Test-Path bin)) { New-Item -ItemType Directory bin }; cobc -x -free -o bin\\\\prog.exe ${workspaceFolder}\\\\prog.cbl" },',
    '  }],',
    '}',
  ].join('\n');
  const doc = absolute(strict(repo({ ...NO_SITE, 'prog.cbl': QUIET, '.vscode/tasks.json': tasks })));
  assert.equal(doc.checks.options, false);
  assert.ok(doc.reasons.some((r) => /^\.vscode\/tasks\.json:6: subscript needs/.test(r)), doc.reasons.join('\n'));
  assert.ok(doc.reasons.some((r) => /^\.vscode\/tasks\.json:8: subscript needs/.test(r)), doc.reasons.join('\n'));
});

test('A task\'s argument keeps its backslashes, quotes and backquotes in the dialect its shell reads', () => {
  const task = (variant) => JSON.stringify({ version: '2.0.0', tasks: [{ label: 'B', type: 'shell', ...variant }] });
  const args = (variant) => compilerTasks(task(variant)).map((c) => c.args);
  assert.deepEqual(args({ command: 'cobc', args: ['-o', 'out dir\\\\', '-DNAME=a \\"b\\"', 'p.cbl'] }), [['-o', 'out dir\\\\', '-DNAME=a \\"b\\"', 'p.cbl']]);
  assert.deepEqual(args({ windows: { command: 'cobc' }, args: ['-o', 'my `dir "x"', 'p.cbl'] }), [['-o', 'my `dir "x"', 'p.cbl']]);
});

test('B5.24 A Makefile\'s compiler and options reach the command through the variables it assigns', { skip }, () => {
  const make = ['COBC ?= cobc', 'COBC ?= gcobol', 'FLAGS := -x', 'FLAGS += -debug', 'prog: prog.cbl', '\tPATH="/usr/local/bin:$$PATH" ${COBC} $(FLAGS) prog.cbl', ''].join('\n');
  const doc = absolute(strict(repo({ ...NO_SITE, 'prog.cbl': QUIET, Makefile: make })));
  assert.equal(doc.checks.options, true, doc.reasons.join('\n'));
  assert.deepEqual(doc.relaxed, []);
});

test('B5.25 A cobc command that names no source compiles nothing', { skip }, () => {
  const script = ['#!/bin/sh', 'if ! command -v cobc >/dev/null 2>&1; then', '  echo "cobc is not on PATH: install GnuCOBOL"', '  exit 1', 'fi', 'cobc --version', 'cobc -x -debug prog.cbl', ''].join('\n');
  const doc = absolute(strict(repo({ ...NO_SITE, 'prog.cbl': QUIET, 'build.sh': script })));
  assert.equal(doc.checks.options, true, doc.reasons.join('\n'));
});

test('B5.26 A missing gcobol check is added as its -fcobol-exceptions option', { skip: skip || posix }, () => {
  const gcobol = standInCobc('gcobol');
  const doc = absolute(repo({ 'Q0.cbl': QUIET }), { compiler: [gcobol.path, '-o', 'q0', 'Q0.cbl'] });
  assert.deepEqual(doc.optionsAdded, ['-fcobol-exceptions=EC-BOUND-REF-MOD', '-fcobol-exceptions=EC-BOUND-SUBSCRIPT']);
  assert.deepEqual(gcobol.args(), ['-o', 'q0', 'Q0.cbl', '-fcobol-exceptions=EC-BOUND-REF-MOD', '-fcobol-exceptions=EC-BOUND-SUBSCRIPT']);
  assert.equal(doc.checks.compile, true);
});

test('B5.27 gcobol\'s -fno-cobol-exceptions withdraws only the conditions it covers', { skip: skip || posix }, () => {
  const kept = standInCobc('gcobol');
  const on = absolute(strict(repo({ 'Q0.cbl': QUIET })), { compiler: [kept.path, '-fcobol-exceptions', 'EC-BOUND', '-fno-cobol-exceptions', 'EC-BOUND-SUBSCRIPT', 'Q0.cbl'] });
  assert.equal(on.checks.options, true, on.reasons.join('\n'));
  assert.deepEqual(on.optionsAdded, []);
  const withdrawn = standInCobc('gcobol');
  const off = absolute(strict(repo({ 'Q0.cbl': QUIET })), { compiler: [withdrawn.path, '-fcobol-exceptions', 'EC-ALL', '-fno-cobol-exceptions', 'EC-ALL', '-fcobol-exceptions', 'EC-BOUND-REF-MOD', 'Q0.cbl'] });
  assert.equal(off.checks.options, false);
  assert.ok(off.reasons.some((r) => /^-fno-cobol-exceptions EC-ALL turns off the subscript check$/.test(r)), off.reasons.join('\n'));
  assert.equal(withdrawn.args(), null, 'the compiler did not run');
});

test('B5.28 A check gcobol does not implement fails, and is not added', { skip: skip || posix }, () => {
  const gcobol = standInCobc('gcobol');
  const root = repo({ 'Q0.cbl': QUIET, 'cobolwork.policy.json': policy({ checks: ['subscript', 'numeric-data'], options: 'block' }) });
  const doc = absolute(root, { compiler: [gcobol.path, '-fcobol-exceptions=EC-ALL', 'Q0.cbl'] });
  assert.equal(doc.checks.options, false);
  assert.ok(doc.reasons.some((r) => /numeric-data needs EC-DATA-INCOMPATIBLE, which gcobol does not implement/.test(r)), doc.reasons.join('\n'));
  assert.deepEqual(doc.optionsAdded, []);
});

test('B5.29 A build script\'s gcobol command is read as cobc\'s is', { skip }, () => {
  const make = ['CBLC ?= gcobol-16', 'prog: prog.cbl', '\t$(CBLC) -o prog prog.cbl', ''].join('\n');
  const script = ['#!/bin/sh', 'aarch64-linux-gnu-gcobol -fcobol-exceptions ec-bound -o prog prog.cbl', ''].join('\n');
  const doc = absolute(strict(repo({ ...NO_SITE, 'prog.cbl': QUIET, Makefile: make, 'build.sh': script })));
  assert.equal(doc.checks.options, false);
  assert.ok(doc.reasons.some((r) => /^Makefile:3: subscript needs -fcobol-exceptions=EC-BOUND-SUBSCRIPT, and the command does not give it$/.test(r)), doc.reasons.join('\n'));
  assert.ok(!doc.reasons.some((r) => r.startsWith('build.sh')), doc.reasons.join('\n'));
});

test('B5.30 An option forbid.gcobol names is refused', { skip: skip || posix }, () => {
  const gcobol = standInCobc('gcobol');
  const root = repo({ 'Q0.cbl': QUIET, 'cobolwork.policy.json': policy({ forbid: { gcobol: ['-fdefaultbyte'] } }) });
  const doc = absolute(root, { compiler: [gcobol.path, '-fdefaultbyte=0', '-fcobol-exceptions=EC-BOUND', 'Q0.cbl'] });
  assert.equal(doc.checks.options, false);
  assert.ok(doc.reasons.some((r) => /^-fdefaultbyte=0 is on the command line, and the policy forbids it$/.test(r)), doc.reasons.join('\n'));
  assert.equal(gcobol.args(), null, 'the compiler did not run');
});

// B6 - The compiler

test('B6.1 A compiler inside the repository is refused', { skip: skip || posix }, () => {
  const root = repo({ 'Q0.cbl': QUIET });
  patch(root, { 'tools/cobc': '#!/bin/sh\nexit 0\n' });
  chmodSync(join(root, 'tools', 'cobc'), 0o755);
  assert.throws(() => absolute(root, { compiler: ['cobc', 'Q0.cbl'], env: { PATH: join(root, 'tools') } }), /no cobc on PATH outside the repository/);
  assert.throws(() => absolute(root, { compiler: [join(root, 'tools', 'cobc'), 'Q0.cbl'] }), /not a file outside the repository/);
});

test('B6.2 A fail compiles nothing', { skip: skip || posix }, () => {
  const cobc = standInCobc();
  const doc = absolute(repo({ 'P.cbl': OS_COMMAND }), { compiler: [cobc.path, 'P.cbl'] });
  assert.equal(doc.verdict, 'fail');
  assert.equal(cobc.args(), null);
  assert.equal(doc.compiled, null);
});

test('B6.3 A compiler that fails after a pass exits 4', { skip: skip || posix }, () => {
  const cobc = standInCobc();
  const root = repo({ 'Q0.cbl': QUIET });
  const r = build(root, { compiler: [cobc.path, 'Q0.cbl'], env: { ...process.env, STAND_IN_STATUS: '1' } });
  assert.equal(r.doc.verdict, 'pass');
  assert.equal(r.exit, 4);
  assert.equal(r.doc.compiled.status, 1);
  assert.equal(r.doc.checks.compile, false);
});

test('B6.4 No shell reads the arguments', { skip: skip || posix }, () => {
  const cobc = standInCobc();
  const marker = join(mkdtempSync(join(tmpdir(), 'cw-marker-')), 'marker');
  absolute(repo({ 'Q0.cbl': QUIET }), { compiler: [cobc.path, `; touch ${marker}`, `$(touch ${marker})`] });
  assert.equal(existsSync(marker), false);
  assert.ok(cobc.args().includes(`; touch ${marker}`));
});

test('B6.5 ironwork checks every program after a pass, with the tree\'s copy directories', { skip: skip || posix }, () => {
  const iw = standInIronwork();
  const root = repo({ 'Q0.cbl': QUIET, 'Q1.cbl': program('Q1', ['COPY QREC.'], ['GOBACK.']), 'copy/QREC.cpy': '       01 Q-REC PIC X.\n' });
  const r = build(root, { ironwork: iw.path });
  assert.equal(r.doc.verdict, 'pass');
  assert.equal(r.exit, 0);
  assert.equal(r.doc.checks.compile, true);
  assert.equal(r.doc.compiled.tool, 'ironwork');
  assert.equal(r.doc.compiled.version, 'ironwork for COBOL 0.1.1');
  assert.deepEqual([r.doc.compiled.programs, r.doc.compiled.accepted], [2, 2]);
  assert.deepEqual(r.doc.compiled.argv.slice(0, 2), ['check', '<program>']);
  assert.match(r.doc.compiled.argv.slice(2).join(' '), /(^| )-I copy( |$)/);
  const runs = iw.runs();
  assert.equal(runs.length, 2);
  for (const run of runs) assert.match(run, /^check \S+\.cbl (-I \S+ )*-I \S+\/copy\s*$/);
  assert.equal(r.provenance.compiler.tool, 'ironwork');
  assert.match(r.provenance.compiler.sha256, /^[0-9a-f]{64}$/);
});

test('B6.6 A program ironwork rejects exits 4, and its message quotes no literal', { skip: skip || posix }, () => {
  const iw = standInIronwork();
  const root = repo({ 'Q0.cbl': QUIET, 'B.cbl': program('B', ['01 WS-BADNAME PIC X.'], ['GOBACK.']) });
  const r = build(root, { ironwork: iw.path });
  assert.equal(r.doc.verdict, 'pass');
  assert.equal(r.exit, 4);
  assert.equal(r.doc.checks.compile, false);
  assert.equal(r.doc.compiled.status, 12);
  assert.deepEqual(r.doc.compiled.failed, [{ path: 'B.cbl', line: 7, col: 12, message: "'…' is not a data name", errors: 1 }]);
  assert.ok(r.doc.reasons.includes("B.cbl:7:12: '…' is not a data name"));
  assert.equal(JSON.stringify(r.doc).includes('NOPE'), false);
  assert.match(buildSummaryLine(r.doc), /ironwork: 1 of 2 programs do not compile/);
});

test('B6.7 A construct ironwork does not model yet leaves the build undecided', { skip: skip || posix }, () => {
  const iw = standInIronwork();
  const corr = program('C', ['01 A.', '   05 X PIC X.', '01 B.', '   05 X PIC X.'], ['MOVE CORRESPONDING A TO B', 'GOBACK.']);
  const strict = build(repo({ 'C.cbl': corr }), { ironwork: iw.path });
  assert.equal(strict.exit, 3);
  assert.equal(strict.doc.checks.compile, null);
  assert.equal(strict.doc.compiled.notModelled[0].message, 'MOVE CORRESPONDING is not supported yet');
  assert.ok(strict.doc.reasons.some((x) => /1 program\(s\) use what ironwork does not model yet/.test(x)));
  const warned = build(repo({ 'C.cbl': corr, 'cobolwork.policy.json': policy({ coverage: 'warn' }) }), { ironwork: iw.path });
  assert.equal(warned.exit, 0);
  assert.deepEqual(warned.doc.relaxed, ['compile']);
  assert.match(buildSummaryLine(warned.doc), /pass \(relaxed: compile\); .*ironwork: 1 program not decided/);
  // A field the DL/I translator declares is its gap too; a statement it stops at is the program's
  // error, now that ironwork reads ENTRY and ALTER.
  const quiet = (id, name) => program(id, [`01 WS-${name} PIC X.`], ['GOBACK.']);
  const r = build(repo({ 'E.cbl': quiet('E', 'ENTRYMARK'), 'D.cbl': quiet('D', 'DIBMARK'), 'L.cbl': quiet('L', 'DLIMARK'), 'W.cbl': quiet('W', 'WORDMARK') }), { ironwork: iw.path });
  assert.deepEqual(r.doc.compiled.notModelled.map((x) => x.path).sort(), ['D.cbl', 'L.cbl']);
  assert.deepEqual(r.doc.compiled.failed.map((x) => x.path).sort(), ['E.cbl', 'W.cbl']);
  assert.equal(r.exit, 4);
});

test('B6.8 A fail runs no ironwork', { skip: skip || posix }, () => {
  const iw = standInIronwork();
  const r = build(repo({ 'P.cbl': OS_COMMAND }), { ironwork: iw.path });
  assert.equal(r.doc.verdict, 'fail');
  assert.equal(iw.runs(), null);
  assert.equal(r.doc.compiled, null);
  assert.equal(r.doc.checks.compile, null);
});

test('B6.9 An ironwork inside the repository is refused, and so is naming a compiler too', { skip: skip || posix }, () => {
  const root = repo({ 'Q0.cbl': QUIET });
  patch(root, { 'tools/ironwork': '#!/bin/sh\nexit 0\n' });
  chmodSync(join(root, 'tools', 'ironwork'), 0o755);
  assert.throws(() => absolute(root, { ironwork: join(root, 'tools', 'ironwork') }), /--ironwork: .* is not a file outside the repository/);
  assert.throws(() => absolute(root, { ironwork: 'ironwork', env: { PATH: join(root, 'tools') } }), /no ironwork on PATH outside the repository/);
  const iw = standInIronwork();
  const cobc = standInCobc();
  assert.throws(() => absolute(root, { ironwork: iw.path, compiler: [cobc.path, 'Q0.cbl'] }), /one compiler per build/);
  assert.equal(cli(['build', root, '--ironwork', iw.path, '--', cobc.path, 'Q0.cbl']).status, 2);
});

test('B6.11 A program with warnings only compiles; errors are read past warning and informational lines', { skip: skip || posix }, () => {
  const iw = standInIronwork();
  const quiet = (id, name) => program(id, [`01 WS-${name} PIC X.`], ['GOBACK.']);
  const r = build(repo({ 'W.cbl': quiet('W', 'WARNMARK'), 'E.cbl': quiet('E', 'EMARK') }), { ironwork: iw.path });
  assert.deepEqual([r.doc.compiled.accepted, r.doc.compiled.warned], [1, 1]);
  assert.deepEqual(r.doc.compiled.failed, [{ path: 'E.cbl', line: 8, col: 12, message: "'…' is not a data name", errors: 1 }]);
  assert.equal(r.exit, 4);
});

test('B6.10 A copybook no library holds leaves the program unresolved, not failed', { skip: skip || posix }, () => {
  const iw = standInIronwork();
  const r = build(repo({ 'G.cbl': program('G', ['01 WS-GONEMARK PIC X.'], ['GOBACK.']) }), { ironwork: iw.path });
  assert.equal(r.exit, 3);
  assert.equal(r.doc.checks.compile, null);
  assert.deepEqual(r.doc.compiled.failed, []);
  assert.equal(r.doc.compiled.unresolved[0].path, 'G.cbl');
  assert.ok(r.doc.reasons.some((x) => /copy a member the copy libraries do not hold; name the estate's with --copylib/.test(x)));
});

// B7 - What the gate emits

test('B7.1 No output carries source text', { skip }, () => {
  const MARK = 'ZQXMARKER77';
  const root = repo({ 'P.cbl': program('P', ['01 WS-IN PIC X(8).', '01 WS-CMD PIC X(80).'],
    ['ACCEPT WS-IN FROM COMMAND-LINE', `DISPLAY '${MARK}'`, 'MOVE WS-IN TO WS-CMD', "CALL 'SYSTEM' USING WS-CMD", 'GOBACK.']) });
  const r = build(root);
  assert.equal(r.doc.verdict, 'fail');
  assert.doesNotMatch(JSON.stringify(r.doc), new RegExp(MARK));
  assert.doesNotMatch(JSON.stringify(r.provenance), new RegExp(MARK));
});

test('B7.2 The same inputs give the same bytes', { skip }, () => {
  const root = repo({ 'P.cbl': OS_COMMAND, 'FTPSEND.jcl': FTP });
  const env = { PATH: process.env.PATH };
  const one = build(root, { env });
  const two = build(root, { env });
  assert.equal(JSON.stringify(one.doc), JSON.stringify(two.doc));
  assert.equal(JSON.stringify(one.provenance), JSON.stringify(two.provenance));
  assert.equal(one.provenance.builtAt, undefined);
  assert.equal(build(root, { env: { ...env, SOURCE_DATE_EPOCH: '1790000000' } }).provenance.builtAt, new Date(1790000000 * 1000).toISOString());
});

test('B7.3 SARIF marks the blocking findings as errors', { skip }, () => {
  const root = repo({ 'P.cbl': OS_COMMAND, 'FTPSEND.jcl': FTP });
  const r = cli(['build', root, '--format', 'sarif']);
  assert.equal(r.status, 1);
  const results = JSON.parse(r.stdout).runs[0].results;
  const os = results.find((x) => x.ruleId === 'argv-or-env-to-os-command');
  const ftp = results.find((x) => x.ruleId === 'jcl-ftp-cleartext');
  assert.equal(os.level, 'error');
  assert.equal(os.properties.tier, 'crit');
  assert.equal(os.properties.blocking, true);
  assert.notEqual(ftp.level, 'error');
  assert.equal(ftp.properties.blocking, false);
});

test('B7.4 The exit status is the verdict', { skip }, () => {
  assert.equal(cli(['build', repo({ 'Q0.cbl': QUIET })]).status, 0);
  assert.equal(cli(['build', repo({ 'P.cbl': OS_COMMAND })]).status, 1);
  assert.equal(cli(['build', repo({ 'M.cbl': MISSING_COPY })]).status, 3);
});

test('B7.5 The spec and the suite name the same scenarios', () => {
  const specIds = [...SPEC.matchAll(/^#### (B\d+\.\d+) /gm)].map((m) => m[1]);
  assert.ok(specIds.length >= 40, 'the spec holds scenarios');
  assert.equal(new Set(specIds).size, specIds.length, 'no scenario id is used twice');
  const testIds = [...readFileSync(fileURLToPath(import.meta.url), 'utf8').matchAll(/^test\((['"])(B\d+\.\d+) /gm)].map((m) => m[2]);
  assert.equal(new Set(testIds).size, testIds.length, 'no test id is used twice');
  assert.deepEqual(specIds.filter((id) => !testIds.includes(id)), [], 'every scenario has a test');
  assert.deepEqual(testIds.filter((id) => !specIds.includes(id)), [], 'every test has a scenario');
});

// B8 - The new rules, each a todo until its rule lands (spec §11)

const RULE_NOT_BUILT = { todo: 'the rule is specified in §11 and not built yet' };
test('B8.1 A FILE STATUS never tested before the record is read is reported', RULE_NOT_BUILT, () => {});
test('B8.2 A FILE STATUS tested on every route is not', RULE_NOT_BUILT, () => {});
test('B8.3 A status test made before the I/O does not count after it', RULE_NOT_BUILT, () => {});
test('B8.4 A file with no FILE STATUS is not reported', RULE_NOT_BUILT, () => {});
test('B8.5 A USE AFTER ERROR declarative covers its file', RULE_NOT_BUILT, () => {});
test('B8.6 An EXEC SQL whose SQLCODE is never tested is reported', RULE_NOT_BUILT, () => {});
test('B8.7 WHENEVER SQLERROR GO TO covers what follows it, and CONTINUE does not', RULE_NOT_BUILT, () => {});
test('B8.8 An untested RESP is reported and a command without RESP is not', RULE_NOT_BUILT, () => {});
test('B8.9 cics-signon-bypassed is unchanged by killable facts', RULE_NOT_BUILT, () => {});
test('B8.10 A STRING of terminal input with no ON OVERFLOW is reported', RULE_NOT_BUILT, () => {});
test('B8.11 A MOVE of input into fewer integer digits is reported', RULE_NOT_BUILT, () => {});
test('B8.12 An EVALUATE of input with no WHEN OTHER is reported', RULE_NOT_BUILT, () => {});
test('B8.13 A password in a VALUE clause is reported, and the gitleaks file holds the same shapes', RULE_NOT_BUILT, () => {});

// B9 - Tiers and consequences

test('B9.1 A vulnerability CISA lists as exploited is KNOWN-EXPLOITABLE and blocks wherever it is', { skip }, () => {
  const cve = KEV.cves[0];
  const feed = outside('feed.json', JSON.stringify({
    schemaVersion: 1, extract: 'estate extract', retrieved: '2026-09-01', coverage: { 'cics-ts': 'every bulletin for CICS TS 5' },
    advisories: [{ kind: 'advisory', product: 'cics-ts', id: cve, affected: '[5.5,5.6]', fixedIn: '6.1', severity: 'high', summary: 'A crafted request to a CICS region corrupts storage.', source: { doc: 'bulletin' } }],
  }));
  const root = repo({ 'cobolwork.site.json': site({ runtimeVersions: { 'cics-ts': '5.6' } }), 'Q0.cbl': QUIET });
  patch(root, { 'Q1.cbl': program('Q1', ['01 WS-A PIC X.'], ['GOBACK.']) });
  const doc = ratchet(root, { advisoryFeeds: [feed] });
  const f = doc.blocking.find((x) => x.rule === 'site-declares-vulnerable-runtime');
  assert.ok(f, 'the runtime finding blocks');
  assert.equal(f.tier, 'known-exploitable');
  assert.equal(f.introduced, false);
  assert.equal(doc.summary.byTier['known-exploitable'], 1);
  assert.equal(doc.verdict, 'fail');
});

test('B9.2 A MED file name taken from a file record blocks as privilege escalation', { skip }, () => {
  const root = repo({ 'Q0.cbl': QUIET });
  patch(root, { 'F.cbl': FILE_NAME });
  const doc = ratchet(root);
  const f = doc.blocking.find((x) => x.rule === 'file-record-to-dynamic-file-path');
  assert.ok(f, JSON.stringify(doc.findings));
  assert.equal(f.tier, 'med');
  assert.deepEqual(f.classes, ['privilege-escalation']);
  assert.equal(f.because, 'class');
});

test('B9.3 Input that chooses a table row mutates data until SSRANGE abends', { skip }, () => {
  const classesUnder = (cards) => {
    const root = repo({ 'S.cbl': SUBSCRIPT(cards), 'cobolwork.site.json': JSON.stringify({}) });
    return classesOf(findingOf(root, 'argv-or-env-to-subscript'));
  };
  assert.deepEqual(classesUnder([]), ['data-mutation']);
  assert.deepEqual(classesUnder(['CBL SSRANGE']), []);
  assert.deepEqual(classesUnder(['CBL SSRANGE(NOZLEN,MSG)']), ['data-mutation']);
});

test('B9.4 Every defect rule has a consequence decision', () => {
  const unclassified = Object.keys(ALL_RULES).filter((r) => classesOfRule(r) === undefined);
  assert.deepEqual(unclassified, []);
  for (const rule of Object.keys(ALL_RULES)) {
    if (ALL_RULES[rule].evidence !== 'path') continue;
    assert.ok(kindsOf(rule), `${rule} spells a source and a sink`);
  }
  for (const sink of Object.keys(SINK_KINDS)) {
    const any = Object.keys(ALL_RULES).find((r) => kindsOf(r)?.sink === sink);
    if (any) assert.ok(Array.isArray(classesOfRule(any)), `sink ${sink} has a decision`);
  }
});

test('B9.5 A repository without a floor can make the classes advisory', { skip }, () => {
  const root = repo({ 'Q0.cbl': QUIET, 'cobolwork.policy.json': policy({ classes: [] }) });
  patch(root, { 'F.cbl': FILE_NAME });
  const doc = ratchet(root);
  assert.equal(doc.verdict, 'pass');
  assert.equal(doc.findings.find((f) => f.rule === 'file-record-to-dynamic-file-path').blocking, false);
});

test('B9.8 A vendored SQLCA laid out as IBM\'s is in neither class, and a doctored one escalates', { skip }, () => {
  const sqlca = (codeAt) => cobol([
    '       01  SQLCA.',
    "           05  SQLCAID            PIC X(8) VALUE 'SQLCA   '.",
    '           05  SQLCABC            PIC S9(9) COMP-4 VALUE 136.',
    ...(codeAt === 'late' ? [] : ['           05  SQLCODE            PIC S9(9) COMP-4.']),
    '           05  SQLERRM.',
    '               49 SQLERRML        PIC S9(4) COMP-4.',
    '               49 SQLERRMC        PIC X(70).',
    ...(codeAt === 'late' ? ['           05  SQLCODE            PIC S9(9) COMP-4.'] : []),
    '           05  SQLERRP            PIC X(8).',
    '           05  SQLERRD OCCURS 6 TIMES PIC S9(9) COMP-4.',
    '           05  SQLWARN.',
    ...'0123456789A'.split('').map((c) => `               10  SQLWARN${c}       PIC X(1).`),
    '           05  SQLSTATE           PIC X(5).',
  ]);
  const user = program('U', ['EXEC SQL INCLUDE SQLCA END-EXEC.'], ['GOBACK.']);
  const shadow = (codeAt) => classesOfCopy(repo({ 'U.cbl': user, 'SQLCA.cpy': sqlca(codeAt) }));
  const classesOfCopy = (root) => {
    const f = findingOf(root, 'copybook-shadows-system');
    return { sev: f.sev, classes: classesOf(f), detail: f.detail };
  };
  const same = shadow('ibm');
  assert.equal(same.sev, 'low');
  assert.deepEqual(same.classes, []);
  assert.match(same.detail, /its layout is the system's, field for field$/);
  const moved = shadow('late');
  assert.deepEqual(moved.classes, ['privilege-escalation']);
  assert.match(moved.detail, /SQLCODE is 4 byte\(s\) at offset 84, where the system's is 4 at 12$/);
});

test('B9.9 A command-line file name escalates only under an entry the estate names privileged', { skip }, () => {
  const opener = cobol([
    '       IDENTIFICATION DIVISION.', '       PROGRAM-ID. OPENER.', '       ENVIRONMENT DIVISION.', '       INPUT-OUTPUT SECTION.', '       FILE-CONTROL.',
    '           SELECT OUTF ASSIGN TO WS-FNAME', '               ORGANIZATION IS LINE SEQUENTIAL.', '       DATA DIVISION.', '       FILE SECTION.', '       FD OUTF.',
    '       01 OUT-REC PIC X(40).', '       WORKING-STORAGE SECTION.', '       01 WS-FNAME PIC X(40).', '       PROCEDURE DIVISION.',
    '           ACCEPT WS-FNAME FROM COMMAND-LINE', '           OPEN OUTPUT OUTF', '           WRITE OUT-REC', '           GOBACK.',
  ]);
  const job = ['//NIGHTLY  JOB 1', '//RUN      EXEC PGM=OPENER'].join('\n') + '\n';
  const fileFinding = (siteOver) => findingOf(repo({ 'OPENER.cbl': opener, 'RUN.jcl': job, 'cobolwork.site.json': site(siteOver) }), 'argv-or-env-to-dynamic-file-path');
  const own = fileFinding({});
  assert.equal(own.sev, 'low');
  assert.deepEqual(classesOf(own), []);
  const privileged = fileFinding({ privilegedJobs: ['NIGHTLY'] });
  assert.equal(privileged.effect, 'privileged');
  assert.equal(privileged.sev, 'high');
  assert.deepEqual(classesOf(privileged), ['privilege-escalation']);
});

test('B9.7 A transfer to a program a variable names blocks only when input chooses the name', { skip }, () => {
  const root = repo({ 'Q0.cbl': QUIET });
  patch(root, { 'X.cbl': XCTL });
  const doc = ratchet(root);
  const f = doc.findings.find((x) => x.rule === 'cics-transfer-to-variable-program');
  assert.equal(f.tier, 'med');
  assert.deepEqual(f.classes, []);
  assert.equal(f.blocking, false);
  assert.equal(doc.verdict, 'pass');
});

test('B9.6 The CI line names the verdict and counts blocking and advisory findings by tier', { skip }, () => {
  const r = cli(['build', repo({ 'P.cbl': OS_COMMAND, 'FTPSEND.jcl': FTP })]);
  assert.match(r.stderr, /^cobolwork build: fail; blocking 1 CRIT; advisory 1 MED$/m);
});
