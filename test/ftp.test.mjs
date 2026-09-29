import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanJcl } from '../lib/sets/jcl.mjs';
import './pin-machine.mjs';

const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-ftp-'));
  for (const [name, text] of Object.entries(files)) {
    const p = join(root, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, typeof text === 'string' ? text : JSON.stringify(text));
  }
  return root;
};
const job = (lines) => lines.join('\n') + '\n';
const SITE = { productionQualifiers: ['PROD'] };
const ftp = (r) => r.findings.filter((f) => f.rule.startsWith('jcl-ftp-')).map((f) => [f.rule, f.line]);

// The shape of CardDemo's FTPJCL: no PARM, the host and the logon as the first lines of SYSIN.
const CARDDEMO = job([
  "//FTPJCLS  JOB 'FTP JCL',CLASS=A,MSGCLASS=H",
  '//STEP1 EXEC PGM=FTP,REGION=2048K',
  "//*          PARM='10.81.148.4 (EXIT TIMEOUT 20'",
  '//SYSIN DD *',
  ' 172.31.21.124',
  ' carddemousr',
  ' ftpdemo1',
  ' ASCII',
  ' cd /ftpfolder',
  " PUT 'AWS.M2.CARDEMO.FTP.TEST' welcome.txt",
  ' QUIT',
  '//*',
]);

test('an FTP step with no TLS option is a cleartext session, reported on its EXEC', () => {
  const r = scanJcl(tree({ 'FTPJCL.jcl': CARDDEMO }));
  assert.deepEqual(ftp(r), [['jcl-ftp-cleartext', 2]]);
  const f = r.findings.find((x) => x.rule === 'jcl-ftp-cleartext');
  assert.equal(f.sev, 'med');
  assert.match(f.detail, /runs FTP to 172\.31\.21\.124/, 'the host is the first line of the input when PARM has none');
  assert.match(f.detail, /its logon, from its input,/);
  assert.match(f.detail, /it sends AWS\.M2\.CARDEMO\.FTP\.TEST$/);
});

// Without production qualifiers the transfer rule has not looked, and the set says so.
test('a transfer nobody can call production or not leaves the set incomplete, not clean', () => {
  const r = scanJcl(tree({ 'FTPJCL.jcl': CARDDEMO }));
  assert.equal(r.summary.setIncomplete, true);
  assert.match(r.summary.notLooked[0], /^1 FTP transfer\(s\) send a named dataset, and cobolwork\.site\.json names no production qualifier/);
  const quiet = scanJcl(tree({ 'FTPJCL.jcl': CARDDEMO, 'cobolwork.site.json': SITE }));
  assert.equal(quiet.summary.setIncomplete, undefined, 'with qualifiers declared the rule ran, and AWS is not one of them');
  assert.deepEqual(ftp(quiet), [['jcl-ftp-cleartext', 2]]);
});

test('subcommands kept in a data set are named, and the logon from NETRC is said to be', () => {
  const r = scanJcl(tree({
    'CRPT.jcl': job([
      '//CRPT0350 EXEC PGM=FTP,',
      "//             PARM='FTPHOST.EXAMPLE.COM 21 (EXIT',",
      '//             COND=(4,LT)',
      '//NETRC    DD DSN=SEC.PROTECT.VAULT(FTPBTCH3),DISP=SHR',
      '//INPUT    DD DSN=PAY.PROD.FTPCARD,DISP=SHR',
      '//OUTPUT   DD SYSOUT=*',
    ]),
  }));
  assert.deepEqual(ftp(r), [['jcl-ftp-cleartext', 1]]);
  const { detail } = r.findings[0];
  assert.match(detail, /runs FTP to FTPHOST\.EXAMPLE\.COM/);
  assert.match(detail, /its logon, from NETRC,/);
  assert.match(detail, /its subcommands are in PAY\.PROD\.FTPCARD, which this reader cannot see$/);
  assert.equal(r.summary.ftpInputUnread, 1);
});

test('TLS asked for on PARM or in an in-stream SYSFTPD is not cleartext; a SYSFTPD out of sight is not called either way', () => {
  const step = (parm, extra = []) => job([
    '//J JOB (X)', `//S1 EXEC PGM=FTP,PARM='${parm}'`, ...extra,
    '//INPUT DD *', " PUT 'PAY.EXTRACT'", ' QUIT', '/*',
  ]);
  const scan = (text) => ftp(scanJcl(tree({ 'J.jcl': text })));
  const unseen = scanJcl(tree({ 'J.jcl': step('FTPHOST (EXIT', ['//SYSFTPD DD DSN=SYS1.TCPPARMS(FTPSEC),DISP=SHR']) }));
  assert.equal(unseen.summary.ftpConfigUnread, 1, 'and the count says how many steps were left undecided that way');
  assert.deepEqual(scan(step('-r TLS FTPHOST (EXIT')), []);
  assert.deepEqual(scan(step('-a tls FTPHOST (EXIT')), []);
  assert.deepEqual(scan(step('FTPHOST (EXIT', ['//SYSFTPD DD *', 'SECURE_MECHANISM TLS', 'SECURE_FTP REQUIRED', '/*'])), []);
  assert.deepEqual(scan(step('FTPHOST (EXIT', ['//SYSFTPD DD DSN=SYS1.TCPPARMS(FTPSEC),DISP=SHR'])), [],
    'a configuration this reader cannot see may ask for TLS, so the step is not called cleartext');
  assert.deepEqual(scan(step('-a NEVER FTPHOST (EXIT', ['//SYSFTPD DD DSN=SYS1.TCPPARMS(FTPSEC),DISP=SHR'])), [['jcl-ftp-cleartext', 2]],
    'NEVER on PARM is cleartext whatever the configuration says');
});

test('a production dataset sent by PUT, MPUT or APPEND is reported on the line that sends it', () => {
  const r = scanJcl(tree({
    'cobolwork.site.json': SITE,
    'SEND.jcl': job([
      '//J JOB (X)',
      "//S1 EXEC PGM=FTP,PARM='-r TLS PARTNER.EXAMPLE.COM (EXIT'",
      '//NETRC DD DSN=SEC.NETRC,DISP=SHR',
      '//EXTRACT DD DSN=PROD.PAYROLL.EXTRACT,DISP=SHR',
      '//INPUT DD *',
      " PUT 'PROD.PAYROLL.MASTER' master.dat",
      ' put //DD:EXTRACT extract.dat',
      " MPUT 'PROD.GL.JAN' 'PROD.GL.FEB'",
      ' PUT RELATIVE.NAME',
      " LCD 'PROD.HR'",
      ' APPEND STAFF staff.dat',
      " PUT 'PRODUCTS.CATALOG' catalog.dat",
      " GET inbound.dat 'PROD.PAYROLL.RATES'",
      ' QUIT',
      '/*',
    ]),
  }));
  assert.deepEqual(ftp(r), [
    ['jcl-ftp-sends-production-dataset', 6],
    ['jcl-ftp-sends-production-dataset', 7],
    ['jcl-ftp-sends-production-dataset', 8],
    ['jcl-ftp-sends-production-dataset', 11],
  ], 'PRODUCTS is not PROD, a GET brings data in, and TLS was asked for');
  const on = (l) => r.findings.find((f) => f.line === l).detail;
  assert.match(on(6), /sends PROD\.PAYROLL\.MASTER to PARTNER\.EXAMPLE\.COM by FTP PUT, and PROD is a production qualifier$/);
  assert.match(on(7), /sends PROD\.PAYROLL\.EXTRACT/, '//DD: names a DD of the step');
  assert.match(on(8), /sends PROD\.GL\.JAN, PROD\.GL\.FEB .* by FTP MPUT/, 'one line is one finding');
  assert.match(on(11), /sends PROD\.HR\.STAFF .* by FTP APPEND/, 'a quoted LCD fixes the names after it');
  assert.equal(r.summary.ftpSendsUndecided, 1, 'a relative name with no LCD hangs off a prefix the job does not show');
  assert.equal(r.summary.setIncomplete, true, 'and a send the rule cannot judge is not a clean result');
  assert.match(r.summary.notLooked[0], /^1 FTP transfer\(s\) name the local dataset relative to a prefix the job does not show/);
  assert.equal(r.findings.find((f) => f.line === 6).sev, 'high');
});

test('the shortest spellings IBM gives the subcommands are read as the subcommands', () => {
  const r = scanJcl(tree({
    'cobolwork.site.json': SITE,
    'SHORT.jcl': job([
      '//J JOB (X)', "//S1 EXEC PGM=FTP,PARM='-r TLS PARTNER (EXIT'", '//INPUT DD *',
      " pu 'PROD.A' a.dat", " mp 'PROD.B'", " ap 'PROD.C' c.dat", ' quit', '/*',
    ]),
  }));
  assert.deepEqual(ftp(r).map(([, l]) => l), [4, 5, 6]);
});

test('production data over a cleartext session carries both findings, each on its own line', () => {
  const r = scanJcl(tree({
    'cobolwork.site.json': SITE,
    'BOTH.jcl': job(['//J JOB (X)', "//S1 EXEC PGM=FTP,PARM='PARTNER (EXIT'", '//INPUT DD *', " PUT 'PROD.PAYROLL.MASTER'", ' QUIT', '/*']),
  }));
  assert.deepEqual(ftp(r), [['jcl-ftp-cleartext', 2], ['jcl-ftp-sends-production-dataset', 4]]);
  assert.match(r.findings.find((f) => f.line === 4).detail, /, over a session with no TLS option$/);
});

const logons = (r) => r.findings.filter((f) => f.rule === 'jcl-instream-credential').map((f) => f.line);
const input = (lines, dds = []) => job(['//XFER JOB', "//S1 EXEC PGM=FTP,PARM='partner.example.com (EXIT'", ...dds, '//INPUT DD *', ...lines, '/*']);

// IBM's batch client asks for a user and a password and reads both from its input, after the host.
test('the password an FTP step logs on with is a credential, on its own line or after the user', () => {
  const r = scanJcl(tree({ 'FTPJCL.jcl': CARDDEMO }));
  assert.deepEqual(logons(r), [7], 'the line after the lone user ID, not the user ID');
  assert.match(r.findings.find((f) => f.rule === 'jcl-instream-credential').detail, /password for carddemousr that step STEP1 logs on to 172\.31\.21\.124 with/);
  assert.doesNotMatch(r.findings.find((f) => f.rule === 'jcl-instream-credential').detail, /ftpdemo1/, 'the finding does not repeat the password');
  assert.deepEqual(logons(scanJcl(tree({ 'A.jcl': input(['USER01 SECRET01', 'PUT X Y', 'QUIT']) }))), [4]);
  assert.deepEqual(logons(scanJcl(tree({ 'A.jcl': input(['BINARY', 'USER USER01 SECRET01', 'QUIT']) }))), [5], 'the USER subcommand');
  assert.deepEqual(logons(scanJcl(tree({ 'A.jcl': input(['BINARY', 'User USER01', 'SECRET01', 'QUIT']) }))), [6], 'USER prompts for the password on the next line');
  assert.deepEqual(logons(scanJcl(tree({ 'A.jcl': input(['BINARY', 'PASS SECRET01', 'QUIT']) }))), [5]);
});

test('a logon that NETRC or a placeholder answers is not a credential', () => {
  assert.deepEqual(logons(scanJcl(tree({ 'A.jcl': input(['USER01 SECRET01', 'QUIT'], ['//NETRC DD DSN=SEC.NETRC,DISP=SHR']) }))), [],
    'with NETRC the client does not ask, so the first line is not a logon');
  assert.deepEqual(logons(scanJcl(tree({ 'A.jcl': input(['BINARY', "PUT 'A.B' c", 'QUIT']) }))), [], 'a first line that is a subcommand is not a user ID');
  assert.deepEqual(logons(scanJcl(tree({ 'A.jcl': input(['USER01 &PASSWD', 'QUIT']) }))), []);
  assert.deepEqual(logons(scanJcl(tree({ 'A.jcl': input(['USER01', '********', 'QUIT']) }))), []);
  assert.deepEqual(logons(scanJcl(tree({ 'A.jcl': input(['USERID PASSWD', 'QUIT']) }))), [], "IBM's own example");
});

test("FTP's DELETE removes a remote file and is not read as a utility deleting a dataset", () => {
  const r = scanJcl(tree({ 'A.jcl': input(['BINARY', 'DELETE old.file', 'QUIT'], ['//NETRC DD DSN=SEC.NETRC,DISP=SHR']) }));
  assert.equal(r.findings.filter((f) => f.rule === 'jcl-instream-destructive').length, 0);
  const idcams = scanJcl(tree({ 'B.jcl': job(['//B JOB', '//S1 EXEC PGM=IDCAMS', '//SYSIN DD *', '  DELETE PROD.OLD.FILE', '/*']) }));
  assert.equal(idcams.findings.filter((f) => f.rule === 'jcl-instream-destructive').length, 1);
});
