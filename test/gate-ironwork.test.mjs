// The gate's compiler is ironwork where there is one and cobc otherwise, and `compiled` says which.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import './pin-machine.mjs';
import { gateCompiler, gateRefs, ironworkCompiler } from '../lib/gate.mjs';
import { scanAll } from '../lib/scan.mjs';

function findIronwork() {
  const named = process.env.COBOLWORK_IRONWORK;
  if (named) return existsSync(named) ? named : null;
  for (const dir of String(process.env.PATH || '').split(delimiter)) {
    if (dir && isAbsolute(dir) && existsSync(join(dir, 'ironwork'))) return join(dir, 'ironwork');
  }
  return null;
}
const IRONWORK = findIronwork();
const hasGit = spawnSync('git', ['--version']).status === 0;
const real = { skip: (!IRONWORK && 'no ironwork binary: set COBOLWORK_IRONWORK or put ironwork on PATH') || (!hasGit && 'git is not installed') };
const posix = { skip: process.platform === 'win32' && 'the stand-in ironwork is a shell script' };

const dirWith = (names) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-gate-iw-bin-'));
  for (const n of names) writeFileSync(join(dir, n), '');
  return dir;
};

test('the gate takes --ironwork, then --cobc, then ironwork on PATH, then cobc on PATH', () => {
  const repo = mkdtempSync(join(tmpdir(), 'cw-gate-iw-repo-'));
  const both = dirWith(['ironwork', 'cobc']), cobcOnly = dirWith(['cobc']), none = dirWith([]);
  try {
    const at = (env, opts = {}) => gateCompiler({ repo, env, platform: 'linux', ...opts });
    assert.equal(at({ PATH: none }, { ironwork: join(both, 'ironwork') }).label, 'ironwork check');
    assert.match(at({ PATH: none }, { ironwork: join(repo, 'ironwork') }).why, /^--ironwork .* is not a file outside the repository$/);
    assert.equal(at({ PATH: both }).label, 'ironwork check');
    assert.equal(at({ PATH: both }, { cobc: join(both, 'cobc') }).label, 'cobc -fsyntax-only, named by --cobc');
    assert.equal(at({ PATH: cobcOnly }).label, 'cobc -fsyntax-only, since there is no ironwork on PATH outside the repository');
    const neither = at({ PATH: none });
    assert.equal(neither.run, undefined);
    assert.equal(neither.why, 'no ironwork on PATH outside the repository, and no cobc on PATH outside the repository');
    writeFileSync(join(repo, 'ironwork'), '');
    assert.equal(at({ PATH: repo }).run, undefined, 'an ironwork inside the repository is never run');
  } finally { for (const d of [repo, both, cobcOnly, none]) rmSync(d, { recursive: true, force: true }); }
});

test('ironworkCompiler compiles at 0 and 4, fails on the program\'s own errors, and keeps only E, S and U messages, at their path', posix, () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-gate-iw-stub-'));
  try {
    const stub = join(dir, 'ironwork-stub');
    const say = (id, severity, line, message) => `printf '{"col":${line ? 20 : 'null'},"file":"%s","id":"${id}","line":${line ?? 'null'},"member":null,"message":"${message}","severity":"${severity}"}\\n' "$2" >&2`;
    writeFileSync(stub, [
      '#!/bin/sh',
      'case " $* " in *" --diagnostics json "*) ;; *) exit 2;; esac',
      'case "$2" in',
      `  */W.cbl) ${say('IWC0055', 'W', null, 'no STOP RUN, GOBACK or EXIT PROGRAM in the program: check that it ends')}; exit 4;;`,
      `  */E.cbl) ${say('IWC0101', 'S', 10, 'WS-X is not defined')}; ${say('IWS0065', 'S', 11, "'\\''ABC'\\'' <> 1")}; ${say('IWC0055', 'W', null, 'no STOP RUN')}; exit 12;;`,
      `  */R.cbl) ${say('IWR0001', 'S', 12, 'XML PARSE VALIDATING WITH X')}; exit 12;;`,
      `  */Q.cbl) ${say('IWQ0001', 'S', 13, 'an id of an area this cobolwork does not read')}; exit 12;;`,
      '  */T.cbl) exit 2;;',
      'esac',
      'exit 0',
      '',
    ].join('\n'));
    chmodSync(stub, 0o755);
    const run = ironworkCompiler(stub);
    assert.deepEqual(run(join(dir, 'W.cbl')), { ok: true, messages: [] });
    assert.deepEqual(run(join(dir, 'E.cbl')), { ok: false, messages: [
      `${join(dir, 'E.cbl')}:10: IWC0101-S WS-X is not defined`,
      `${join(dir, 'E.cbl')}:11: IWS0065-S '…' <> 1`,
    ] });
    assert.deepEqual(run(join(dir, 'R.cbl')), { ok: null, messages: [`${join(dir, 'R.cbl')}:12: IWR0001-S XML PARSE VALIDATING WITH X`] });
    assert.equal(run(join(dir, 'Q.cbl')).ok, null);
    assert.deepEqual(run(join(dir, 'T.cbl')), { ok: null, messages: [] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const git = (cwd, args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};
const program = (body) => [
  '       IDENTIFICATION DIVISION.',
  '       PROGRAM-ID. P.',
  '       DATA DIVISION.',
  '       WORKING-STORAGE SECTION.',
  "       01 WS-PASSWORD         PIC X(8) VALUE 'HUNTER22'.",
  '       01 WS-CMD              PIC X(80).',
  '       PROCEDURE DIVISION.',
  ...body.map((l) => `           ${l}`),
].join('\n') + '\n';

test('the gate compiles with ironwork and names it, and a patch that breaks the program carries its message id', real, () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-gate-iw-'));
  try {
    git(root, ['init', '-q']);
    for (const [k, v] of [['user.email', 't@example.com'], ['user.name', 't'], ['core.autocrlf', 'false']]) git(root, ['config', k, v]);
    writeFileSync(join(root, 'P.cbl'), program(['DISPLAY WS-CMD', 'GOBACK.']));
    git(root, ['add', 'P.cbl']);
    git(root, ['commit', '-qm', 'base']);
    const target = scanAll(root).findings.find((f) => f.rule === 'credential-in-source');
    assert.ok(target, 'the base holds a finding to target');

    writeFileSync(join(root, 'P.cbl'), program(["DISPLAY 'READY'", 'DISPLAY WS-CMD', 'GOBACK.']));
    const fine = gateRefs(root, 'HEAD', null, target.fingerprint, { ironwork: IRONWORK });
    assert.equal(fine.checks.compile, true, fine.compiled);
    assert.equal(fine.compiled, '1 program(s) compile under ironwork check');

    writeFileSync(join(root, 'P.cbl'), program(['DISPLAY WS-UNDEFINED', 'GOBACK.']));
    const broken = gateRefs(root, 'HEAD', null, target.fingerprint, { ironwork: IRONWORK });
    assert.equal(broken.checks.compile, false, broken.compiled);
    assert.equal(broken.compiled, '1 program(s) compiled before the patch and do not after under ironwork check');
    assert.ok(broken.reasons.includes('the compiler: P.cbl:8: IWC0001-S WS-UNDEFINED is not defined'), broken.reasons.join('\n'));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
