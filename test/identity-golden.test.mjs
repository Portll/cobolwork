// Baselines, diff and commitwork's issue store keep these hashes, so they change only with a new
// FINGERPRINT_VERSION at a major release (STABILITY.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampFingerprints, pairingKeys, FINGERPRINT_VERSION } from '../lib/kernel/identity.mjs';
import './pin-machine.mjs';

const fixed = (lines) => lines.map((l, i) => `${String((i + 1) * 100).padStart(6, '0')} ${l.padEnd(65)}GOLD0001`).join('\n') + '\n';

const FILES = {
  'src/PAYROLL.cbl': fixed([
    'IDENTIFICATION DIVISION.',
    'PROGRAM-ID. PAYROLL.',
    'DATA DIVISION.',
    'WORKING-STORAGE SECTION.',
    '01 WS-REC.',
    '   05 WS-CMD PIC X(80).',
    '   05 WS-PASSWORD PIC X(8) VALUE \'SECRET01\'.',
    'PROCEDURE DIVISION.',
    'MAIN-LINE SECTION.',
    'START-UP.',
    '    ACCEPT WS-CMD FROM COMMAND-LINE',
    '    CALL \'SYSTEM\' USING WS-CMD.',
    '    GOBACK.',
  ]),
  'copy/CUSTREC.cpy': fixed([
    '01 CUST-REC.',
    '   05 CUST-ID PIC X(10).',
    '   05 CUST-BAL PIC S9(7)V99 COMP-3.',
  ]),
  'jcl/NIGHTLY.jcl': [
    '//NIGHTLY  JOB (ACCT),\'NIGHTLY RUN\',CLASS=A',
    '//STEP1    EXEC PGM=PAYROLL',
    '//INPUT    DD DSN=PROD.PAYROLL.INPUT,DISP=SHR',
    '//SYSIN    DD *',
    'USER=BATCH01 PASSWORD=HUNTER2',
    '/*',
    '//FTPSTEP  EXEC PGM=FTP,PARM=\'HOST (EXIT\'',
  ].join('\n') + '\n',
  'build/Dockerfile': 'FROM debian:12\nRUN apt-get install -y gnucobol=3.1\n',
};

const read = (path) => {
  if (!(path in FILES)) throw Object.assign(new Error(`no ${path}`), { code: 'ENOENT' });
  return FILES[path];
};

const FINDINGS = [
  { rule: 'argv-or-env-to-os-command', path: 'src/PAYROLL.cbl', line: 12, program: 'PAYROLL' },
  { rule: 'hardcoded-credential', path: 'src/PAYROLL.cbl', line: 7 },
  { rule: 'compile-options-missing', path: 'src/PAYROLL.cbl', line: 1 },
  { rule: 'packed-field-overflow', path: 'copy/CUSTREC.cpy', line: 3, name: 'CUST-BAL' },
  { rule: 'production-dataset-read', path: 'jcl/NIGHTLY.jcl', line: 3, step: 'STEP1' },
  { rule: 'jcl-instream-credential', path: 'jcl/NIGHTLY.jcl', line: 5 },
  { rule: 'ftp-cleartext', path: 'jcl/NIGHTLY.jcl', line: 7 },
  { rule: 'build-compiler-too-old', path: 'build/Dockerfile', line: 2 },
  { rule: 'no-source', line: 0 },
];

const GOLDEN = [
  '8f08ae92992ff598e818b07f8c9ed70a',
  '8b43d0496d4454287e3cc6e32cdeb898',
  'c1e4e3fd46ea07ef5c06825559a97fdb',
  'd443c2fa227cd8aff37fb8a7732af432',
  'b7bd26ecd671c8e130d29c6039b877b4',
  '62f975509c7fc7b6307115c6357e752a',
  'e3da566b1e5477de34817ccf3c432b87',
  '6d5555e931ed7ecef0a26e21a0f96400',
  '280c5e3ffb22d38a1ea2141f62e04b3f',
];

const GOLDEN_IN_REPO = '96c1bdaf3f9dbca94347a0b541545cba';

const GOLDEN_KEYS = {
  scope: 'a3875b0cd0f72020e452194b1bc623d8',
  route: '0cf0e707cb05c7c577ec9cce063cff0e',
};

test('the fingerprint version is cobolwork/v1', () => {
  assert.equal(FINGERPRINT_VERSION, 'cobolwork/v1');
});

test('each finding keeps the fingerprint cobolwork/v1 gave it', () => {
  const findings = FINDINGS.map((f) => ({ ...f }));
  const { version, shared } = stampFingerprints(findings, { root: '/golden', read });
  assert.equal(version, 'cobolwork/v1');
  assert.equal(shared, 0);
  assert.deepEqual(findings.map((f) => f.fingerprint), GOLDEN);
});

test('a report holding several repositories keeps each fingerprint it gave per repository', () => {
  const [f] = FINDINGS.map((x) => ({ ...x }));
  stampFingerprints([f], { root: '/golden', repo: 'estate/payroll', read });
  assert.equal(f.fingerprint, GOLDEN_IN_REPO);
});

test('a path finding keeps its scope and route pairing keys', () => {
  const f = {
    rule: 'argv-or-env-to-os-command', path: 'src/PAYROLL.cbl', line: 12, program: 'PAYROLL', evidence: 'path',
    related: [{ path: 'src/PAYROLL.cbl', line: 11, detail: 'source' }],
  };
  const [keys] = pairingKeys([f], { root: '/golden', read });
  assert.deepEqual(keys, GOLDEN_KEYS);
});
