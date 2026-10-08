// SPDX-License-Identifier: AGPL-3.0-or-later
// Each command, run as a caller runs it, exits with each status STABILITY.md gives it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from '../lib/exit.mjs';
import { scanAll } from '../lib/scan.mjs';
import './pin-machine.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cobolwork.mjs');
const { pass, fail, couldNotRun, undecided, compilerFailed } = EXIT;

const env = { ...process.env };
delete env.COBOLWORK_EVIDENCE;
const have = (cmd) => !spawnSync(cmd, ['-V'], { timeout: 5000 }).error;
const GIT = have('git') ? {} : { skip: 'git is not on PATH' };
const SSH = have('ssh-keygen') ? {} : { skip: 'ssh-keygen is not on PATH' };

function exits(args, want) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env, timeout: 120000 });
  assert.equal(r.status, want, `cobolwork ${args.join(' ')}: ${r.stderr}`);
  return r;
}

const program = (body, ws = []) => [
  '       IDENTIFICATION DIVISION.',
  '       PROGRAM-ID. P.',
  '       DATA DIVISION.',
  '       WORKING-STORAGE SECTION.',
  '       01 WS-IN               PIC X(8).',
  '       01 WS-CMD              PIC X(80).',
  ...ws.map((l) => `       ${l}`),
  '       PROCEDURE DIVISION.',
  ...body.map((l) => `           ${l}`),
].join('\n') + '\n';
const FINDING = program(['ACCEPT WS-IN FROM COMMAND-LINE', 'MOVE WS-IN TO WS-CMD', "CALL 'SYSTEM' USING WS-CMD", 'GOBACK.']);
const ALLOW = ['EVALUATE WS-IN', "   WHEN 'DAILY'", '      CONTINUE', '   WHEN OTHER', '      GOBACK', 'END-EVALUATE'];
const GUARDED = ['ACCEPT WS-IN FROM COMMAND-LINE', ...ALLOW, 'MOVE WS-IN TO WS-CMD', "CALL 'SYSTEM' USING WS-CMD", 'GOBACK.'];
const FIXED = program(GUARDED);
const UNREAD = program(GUARDED, ['COPY NOSUCHBOOK.']);
const QUIET = program(['GOBACK.']);

function dir(t) {
  const d = mkdtempSync(join(tmpdir(), 'cw-exit-'));
  t.after(() => rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  return d;
}
function tree(t, text) {
  const root = join(dir(t), 'repo');
  mkdirSync(root);
  writeFileSync(join(root, 'P.cbl'), text);
  return root;
}
const git = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
};
function repo(t, text) {
  const root = tree(t, text);
  git(root, ['init', '-q']);
  for (const [k, v] of [['user.email', 't@example.invalid'], ['user.name', 't'], ['core.autocrlf', 'false'], ['commit.gpgsign', 'false']]) git(root, ['config', k, v]);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'base']);
  return root;
}
const fingerprintIn = (root) => scanAll(root).findings.find((f) => f.rule === 'argv-or-env-to-os-command').fingerprint;

test('with no command: --version, --help and --rules-path exit 0, and anything else 2', () => {
  exits(['--version'], pass);
  exits(['--help'], pass);
  exits(['--rules-path', 'gitleaks'], pass);
  exits(['--rules-path', 'nosuch'], couldNotRun);
  exits([], couldNotRun);
  exits(['nosuch'], couldNotRun);
});

test('scan exits 0 whatever it finds, and 2 when it cannot run', (t) => {
  const root = tree(t, FINDING);
  assert.equal(JSON.parse(exits(['scan', root, '--quiet'], pass).stdout).summary.findings > 0, true);
  exits(['scan', root, '--only', 'nosuch'], couldNotRun);
  exits(['scan', join(root, 'none'), '--repos'], couldNotRun);
});

test('flow, inventory, sbom, parse and advise exit 0 when they ran, and 2 when they cannot', (t) => {
  const root = tree(t, FINDING);
  for (const command of ['flow', 'inventory', 'sbom', 'advise']) exits([command, root], pass);
  for (const command of ['flow', 'inventory', 'sbom']) exits([command, root, '--format', 'sarif'], couldNotRun);
  exits(['advise', root, '--full-trace'], couldNotRun);
  exits(['parse', join(root, 'P.cbl')], pass);
  exits(['parse', join(root, 'NONE.cbl')], couldNotRun);
});

test('capabilities exits 0, and 2 for a form it does not have', () => {
  exits(['capabilities'], pass);
  exits(['capabilities', '--format', 'sarif'], couldNotRun);
});

test('baseline and explain exit 0 when they ran, and 2 when they cannot', (t) => {
  const root = tree(t, FINDING);
  exits(['baseline', root, '--reason', 'r', '--who', 'w', '--expires', '2099-01-01', '--out', join(dirname(root), 'b.json')], pass);
  exits(['baseline', root, '--reason', 'r', '--expires', '2099-01-01'], couldNotRun);
  exits(['explain', root, fingerprintIn(root)], pass);
  exits(['explain', root, 'nosuch'], couldNotRun);
});

// tui's 0 needs a terminal, which a test process does not have.
test('tui exits 2 without a terminal', (t) => {
  exits(['tui', tree(t, FINDING)], couldNotRun);
});

test('diff exits 0 when it ran, and 2 when it cannot', GIT, (t) => {
  const root = repo(t, FINDING);
  writeFileSync(join(root, 'P.cbl'), FIXED);
  exits(['diff', root, '--base', 'HEAD'], pass);
  exits(['diff', root], couldNotRun);
});

test('gate exits 0 whenever it ran, its verdict with --exit-code, and 2 when it cannot run', GIT, (t) => {
  const root = repo(t, FINDING);
  const fp = fingerprintIn(root);
  const gate = (text, ...extra) => {
    writeFileSync(join(root, 'P.cbl'), text);
    return ['gate', root, '--base', 'HEAD', '--target', fp, '--cobc', join(root, 'none'), ...extra];
  };
  assert.equal(JSON.parse(exits(gate(FINDING), pass).stdout).verdict, 'fail');
  assert.equal(JSON.parse(exits(gate(FINDING, '--exit-code'), fail).stdout).verdict, 'fail');
  assert.equal(JSON.parse(exits(gate(FIXED, '--exit-code'), pass).stdout).verdict, 'pass');
  assert.equal(JSON.parse(exits(gate(UNREAD, '--exit-code'), undecided).stdout).verdict, 'undecided');
  exits(['gate', root, '--base', 'HEAD', '--exit-code'], couldNotRun);
});

test('build exits with its verdict, 4 for a compiler that fails after a pass, and 2 when it cannot run', (t) => {
  exits(['build', tree(t, QUIET)], pass);
  exits(['build', tree(t, FINDING)], fail);
  exits(['build', tree(t, UNREAD)], undecided);
  exits(['build', tree(t, QUIET), '--', process.execPath, '-e', 'process.exit(1)'], compilerFailed);
  exits(['build', tree(t, QUIET), '--head', 'HEAD'], couldNotRun);
});

test('evidence verify exits 3 undetermined, 1 broken, and 2 when it cannot run; seal and anchor 0 or 2', (t) => {
  const d = dir(t);
  const ev = join(d, 'ev');
  exits(['scan', tree(t, FINDING), '--quiet', '--evidence', ev], pass);
  exits(['evidence', 'seal', '--evidence', join(d, 'empty')], couldNotRun);
  exits(['evidence', 'seal', '--evidence', ev], pass);
  exits(['evidence', 'anchor', '--evidence', ev], couldNotRun);
  exits(['evidence', 'anchor', '--evidence', ev, '--tsq', join(d, 'req.tsq')], pass);
  exits(['evidence', 'verify', '--evidence', ev], undecided);
  exits(['evidence', 'verify'], couldNotRun);
  const runs = join(ev, 'runs');
  const journal = join(runs, readdirSync(runs).find((n) => n.endsWith('.jsonl')));
  const lines = readFileSync(journal, 'utf8').split('\n');
  const i = lines.findIndex((l) => l.includes('"kind":"finding"'));
  lines[i] = lines[i].replace(/"line":(\d+)/, (_, n) => `"line":${Number(n) + 1}`);
  writeFileSync(journal, lines.join('\n'));
  exits(['evidence', 'verify', '--evidence', ev], fail);
});

test('evidence verify exits 0 for a signed seal its witness holds; sign exits 0 or 2', { ...SSH, ...GIT }, (t) => {
  const d = dir(t);
  const ev = join(d, 'ev');
  const key = join(d, 'key');
  const made = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'ci', '-f', key], { timeout: 20000 });
  assert.equal(made.status, 0, String(made.stderr));
  const [type, base64] = readFileSync(`${key}.pub`, 'utf8').trim().split(/\s+/);
  writeFileSync(join(d, 'allowed'), `ci@example.invalid namespaces="cobolwork-evidence" ${type} ${base64}\n`);
  const witness = join(d, 'witness');
  mkdirSync(witness);
  git(witness, ['init', '-q']);
  for (const [k, v] of [['user.email', 't@example.invalid'], ['user.name', 't'], ['commit.gpgsign', 'false']]) git(witness, ['config', k, v]);
  git(witness, ['commit', '-q', '--allow-empty', '-m', 'init']);
  exits(['scan', tree(t, FINDING), '--quiet', '--evidence', ev], pass);
  exits(['evidence', 'seal', '--evidence', ev, '--ssh-key', key, '--anchor-git', witness], pass);
  exits(['evidence', 'verify', '--evidence', ev, '--allowed-signers', join(d, 'allowed'), '--anchor-git', witness, '--ref', 'HEAD'], pass);
  writeFileSync(join(d, 'statement.json'), '{}\n');
  exits(['evidence', 'sign', join(d, 'statement.json'), '--ssh-key', key, '--out', join(d, 'signed.json')], pass);
  exits(['evidence', 'sign', '--ssh-key', key], couldNotRun);
});

test('a reader that closes standard output early leaves 2, never a fail', { skip: process.platform === 'win32' && 'a closed pipe on Windows is not EPIPE at the writer' }, async () => {
  const child = spawn(process.execPath, [CLI, 'capabilities'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.destroy();
  let said = '';
  child.stderr.on('data', (b) => { said += b; });
  const status = await new Promise((done) => child.on('close', done));
  assert.equal(status, couldNotRun, said);
});
