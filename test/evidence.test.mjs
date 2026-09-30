// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, makeRecord, newChain, recordHash } from '../lib/evidence/record.mjs';
import { EvidenceRefusal, createExclusive, openAppend, prepareDir, readLines, syncClose, writeAll } from '../lib/evidence/store.mjs';
import { LEDGER, LOCK, openJournal } from '../lib/evidence/journal.mjs';
import { PAYLOAD_TYPE, SEAL_PREDICATE, STATEMENT_TYPE, anchorGit, seal, timeStampRequest } from '../lib/evidence/seal.mjs';
import { parseAllowedSigners } from '../lib/evidence/sshsig.mjs';
import { verifyEvidence } from '../lib/evidence/verify.mjs';
import { ZOWE_RULES, scanZowe } from '../lib/sets/zowe.mjs';
import { scanJcl } from '../lib/sets/jcl.mjs';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'bin', 'cobolwork.mjs');
const SPEC = readFileSync(join(HERE, '..', 'docs', 'spec', 'evidence.md'), 'utf8');
const SELF = readFileSync(fileURLToPath(import.meta.url), 'utf8');

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const tmp = (t) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-evidence-'));
  t.after(() => rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  return d;
};
const have = (cmd) => !spawnSync(cmd, ['-V'], { timeout: 5000 }).error;
const SSH = have('ssh-keygen') ? {} : { skip: 'ssh-keygen is not on PATH' };
const GIT = have('git') ? {} : { skip: 'git is not on PATH' };

const FINDING = { fingerprint: 'fp1', rule: 'r1', tier: 'high', path: 'A.cbl', line: 10 };
function run(dir, findings = [FINDING]) {
  const j = openJournal(dir, { command: 'scan', argv: ['scan'], roots: ['src'], toolVersion: '0.0.0' });
  for (const f of findings) j.append('finding', f);
  const r = j.close({ exit: 0 });
  return { ...j, result: r };
}

function sshKey(dir, type = 'ed25519', name = `key-${type}`) {
  const path = join(dir, name);
  const args = ['-q', '-t', type, '-N', '', '-C', name, '-f', path];
  if (type === 'ecdsa') args.splice(3, 0, '-b', '256');
  const r = spawnSync('ssh-keygen', args, { timeout: 20000 });
  assert.equal(r.status, 0, String(r.stderr));
  const [keyType, base64] = readFileSync(`${path}.pub`, 'utf8').trim().split(/\s+/);
  return { path, line: `${keyType} ${base64}` };
}
const allowedFor = (...entries) => parseAllowedSigners(entries.map(([who, key]) => `${who} namespaces="cobolwork-evidence" ${key.line}`).join('\n'));

function gitRepo(dir) {
  const run = (...args) => {
    const r = spawnSync('git', ['-C', dir, ...args], { timeout: 20000 });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return String(r.stdout).trim();
  };
  mkdirSync(dir, { recursive: true });
  run('init', '-q');
  run('config', 'user.name', 'evidence-test');
  run('config', 'user.email', 'evidence-test@example.invalid');
  run('config', 'commit.gpgsign', 'false');
  run('commit', '-q', '--allow-empty', '-m', 'init');
  return run;
}
const ledgerChainOf = (s) => s.statement.subject[0].name.slice('ledger:'.length);

function cli(args, env = {}) {
  const e = { ...process.env, ...env };
  delete e.COBOLWORK_EVIDENCE;
  Object.assign(e, env);
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: e, timeout: 120000 });
}

// V1 - Records and journals

test('V1.1 Without an evidence directory nothing is written', (t) => {
  const d = tmp(t);
  const src = join(d, 'src');
  mkdirSync(src);
  writeFileSync(join(src, 'P.cbl'), '       IDENTIFICATION DIVISION.\n       PROGRAM-ID. P.\n       PROCEDURE DIVISION.\n           GOBACK.\n');
  const before = readdirSync(d).sort();
  const r = cli(['scan', src, '--quiet']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readdirSync(d).sort(), before);
  assert.deepEqual(readdirSync(src), ['P.cbl']);
});

test('V1.2 A run journal opens, records inputs and findings, and closes', (t) => {
  const d = tmp(t);
  const src = join(d, 'src');
  mkdirSync(src);
  writeFileSync(join(src, 'RUNJ.jcl'), '//RUNJ JOB 1\n//S1 EXEC PGM=FTP,PARM=\'host.example.com\'\n//INPUT DD *\nuser anon anon\nput A.B\n/*\n');
  const r = cli(['scan', src, '--quiet', '--evidence', join(d, 'ev')]);
  assert.equal(r.status, 0, r.stderr);
  const [file] = readdirSync(join(d, 'ev', 'runs'));
  const kinds = readLines(join(d, 'ev', 'runs', file)).lines.map((l) => JSON.parse(l).kind);
  assert.equal(kinds[0], 'open');
  assert.equal(kinds[kinds.length - 1], 'close');
  assert.ok(kinds.includes('input'), 'the file read is recorded');
  assert.ok(kinds.includes('finding'), 'the finding is recorded');
  const order = ['open', 'input', 'finding', 'output', 'close'];
  const firsts = order.map((k) => kinds.indexOf(k));
  assert.deepEqual([...firsts].sort((a, b) => a - b), firsts, `kinds in order: ${kinds.join(',')}`);
});

test('V1.3 Every record hashes over its canonical form', (t) => {
  const d = tmp(t);
  const j = run(d);
  for (const path of [j.path, join(d, LEDGER)]) {
    for (const line of readLines(path).lines) {
      const rec = JSON.parse(line);
      assert.equal(line, canonical(rec));
      assert.equal(recordHash(rec), rec.hash);
      const { hash, ...body } = rec;
      assert.equal(hash, sha256(`cobolwork-evidence/v1\n${canonical(body)}`));
    }
  }
});

test('V1.4 A record carries no source text and no secret value', (t) => {
  const d = tmp(t);
  const src = join(d, 'src');
  mkdirSync(src);
  writeFileSync(join(src, 'LOGON.jcl'), "//LOGON JOB 1\n//S1 EXEC PGM=FTP,PARM='host.example.com'\n//INPUT DD *\nuser alice ZQ7VXWPD\nput A.B\n/*\n");
  writeFileSync(join(src, 'PW.cbl'), [
    '       IDENTIFICATION DIVISION.', '       PROGRAM-ID. PW.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
    "       01 WS-RACF-PASSWORD PIC X(8) VALUE 'KJ4MNB7Q'.", '       PROCEDURE DIVISION.', '           GOBACK.', '',
  ].join('\n'));
  const r = cli(['scan', src, '--quiet', '--evidence', join(d, 'ev')]);
  assert.equal(r.status, 0, r.stderr);
  const dump = [join(d, 'ev', LEDGER), ...readdirSync(join(d, 'ev', 'runs')).map((f) => join(d, 'ev', 'runs', f))].map((p) => readFileSync(p, 'utf8')).join('');
  assert.ok(dump.includes('"kind":"finding"'), 'the scan found something to record');
  assert.ok(dump.includes('jcl-instream-credential'), 'the credential finding is recorded');
  for (const secret of ['ZQ7VXWPD', 'KJ4MNB7Q', 'WORKING-STORAGE', 'user alice']) assert.ok(!dump.includes(secret), `${secret} is not in the evidence`);
});

test('V1.5 An evidence directory inside the scanned tree is refused', (t) => {
  const d = tmp(t);
  const src = join(d, 'src');
  mkdirSync(src);
  const r = cli(['scan', src, '--quiet', '--evidence', join(src, 'ev', 'deeper')]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /inside/);
  assert.ok(!existsSync(join(src, 'ev')), 'nothing is created in the tree');
  assert.throws(() => prepareDir(join(src, 'x'), [src]), EvidenceRefusal);
});

test('V1.6 An evidence file reached through a symbolic link is refused', (t) => {
  const d = tmp(t);
  const target = join(d, 'elsewhere.jsonl');
  writeFileSync(target, 'untouched\n');
  const ev = join(d, 'ev');
  prepareDir(ev);
  try { symlinkSync(target, join(ev, LEDGER)); } catch (e) { t.skip(`this platform will not create a symbolic link here (${e.code})`); return; }
  const j = openJournal(ev, { command: 'scan', argv: [], roots: [], toolVersion: '0.0.0' });
  const r = j.close({ exit: 0 });
  assert.equal(r.ledger, 'unrecorded');
  assert.match(r.reason, /symbolic link/);
  assert.equal(readFileSync(target, 'utf8'), 'untouched\n');
  assert.throws(() => openAppend(join(ev, LEDGER)), EvidenceRefusal);
});

test('V1.7 A record with an unknown key is refused by the writer', () => {
  assert.throws(() => makeRecord({ chain: newChain(), prev: null, kind: 'finding', fields: { ...FINDING, snippet: 'MOVE X TO Y' }, at: '2026-09-30T00:00:00.000Z' }), /no field snippet/);
});

test('V1.8 A non-integer number is refused by the writer', () => {
  assert.throws(() => makeRecord({ chain: newChain(), prev: null, kind: 'finding', fields: { ...FINDING, line: 1.5 }, at: '2026-09-30T00:00:00.000Z' }), TypeError);
  assert.throws(() => canonical({ n: 1.5 }), /integers only/);
});

test('V1.9 An ironwork run journal verifies with the same verifier', (t) => {
  const d = tmp(t);
  prepareDir(d);
  const chain = newChain();
  const at = '2026-09-30T03:39:36.241Z';
  const records = [
    ['open', { tool: 'ironwork', toolVersion: '0.1.1', command: 'run', argv: ['run', 'PAYROLL.cbl'], roots: ['src'], platform: 'macos' }],
    ['input', { root: 0, path: 'PAYROLL.cbl', sha256: 'a'.repeat(64), bytes: 701 }],
    ['dd', { dd: 'INFILE', event: 'open', mode: 'INPUT', sha256: 'b'.repeat(64), bytes: 11 }],
    ['call', { program: 'HELPER', from: 'HELPER.cbl', sha256: 'c'.repeat(64) }],
    ['dd', { dd: 'INFILE', event: 'end', sha256: 'b'.repeat(64), bytes: 11 }],
    ['abend', { code: 'S0C7', file: 'PAYROLL.cbl', line: 42 }],
    ['close', { exit: 16, counts: { dd: 2 }, durationMs: 5, ledger: 'unrecorded' }],
  ];
  let prev = null;
  let text = '';
  for (const [kind, fields] of records) {
    const r = makeRecord({ chain, prev, kind, fields, at });
    text += r.line;
    prev = r.record;
  }
  const id = '20260930T033936Z-dddddddddddddddd';
  writeFileSync(join(d, 'runs', `${id}.jsonl`), text);
  let v = verifyEvidence(d);
  assert.equal(v.verified, true, JSON.stringify(v.broken));
  assert.deepEqual(v.unrecorded, [id]);
  assert.throws(() => makeRecord({ chain, prev, kind: 'dd', fields: { dd: 'X', event: 'rewind' }, at }), TypeError);
});

// V2 - The ledger

test('V2.1 Each closed run adds one ledger record carrying its tip', (t) => {
  const d = tmp(t);
  const j = run(d);
  const recs = readLines(join(d, LEDGER)).lines.map((l) => JSON.parse(l));
  assert.deepEqual(recs.map((r) => r.kind), ['genesis', 'run']);
  const last = recs[1];
  assert.equal(last.run, j.id);
  assert.equal(last.runChain, j.chain);
  assert.equal(last.runLength, j.tip.seq + 1);
  assert.equal(last.runTip, j.tip.hash);
});

test('V2.2 A held lock leaves the run unrecorded, not lost', (t) => {
  const d = tmp(t);
  prepareDir(d);
  writeFileSync(join(d, LOCK), `${process.pid} ${Date.now()}\n`);
  const j = openJournal(d, { command: 'scan', argv: [], roots: [], toolVersion: '0.0.0', lock: { waitMs: 100 } });
  j.append('finding', FINDING);
  const r = j.close({ exit: 0 });
  assert.equal(r.ledger, 'unrecorded');
  const close = JSON.parse(readLines(j.path).lines.at(-1));
  assert.equal(close.kind, 'close');
  assert.equal(close.ledger, 'unrecorded');
  assert.ok(!existsSync(join(d, LEDGER)));
});

test('V2.4 A ledger whose last line is no record is not extended', (t) => {
  const d = tmp(t);
  run(d);
  const good = readFileSync(join(d, LEDGER), 'utf8');
  const last = JSON.parse(good.trimEnd().split('\n').at(-1));
  for (const bad of [{ ...last, chain: undefined }, { ...last, runTip: '0'.repeat(64) }]) {
    const tail = `${good}${JSON.stringify(bad)}\n`;
    writeFileSync(join(d, LEDGER), tail);
    assert.equal(run(d).result.ledger, 'unrecorded');
    assert.equal(readFileSync(join(d, LEDGER), 'utf8'), tail);
  }
});

test('V2.3 A stale lock is broken and the break is recorded', (t) => {
  const d = tmp(t);
  prepareDir(d);
  const dead = spawnSync(process.execPath, ['-e', '0']).pid;
  writeFileSync(join(d, LOCK), `${dead} ${Date.now() - 120000}\n`);
  const j = run(d);
  assert.equal(j.result.ledger, 'recorded');
  const kinds = readLines(join(d, LEDGER)).lines.map((l) => JSON.parse(l));
  const broken = kinds.findIndex((r) => r.kind === 'lock-broken');
  assert.ok(broken >= 0);
  assert.equal(kinds[broken].holderPid, dead);
  assert.ok(broken < kinds.findIndex((r) => r.kind === 'run'));
});

// V3 - Verify

test('V3.1 An untouched evidence directory verifies', (t) => {
  const d = tmp(t);
  run(d);
  run(d, []);
  const v = verifyEvidence(d);
  assert.equal(v.verified, true);
  assert.deepEqual(v.broken, []);
  assert.deepEqual(v.unrecorded, []);
  assert.deepEqual(v.open, []);
});

test('V3.2 An edited field breaks the chain at that record', (t) => {
  const d = tmp(t);
  const j = run(d);
  const lines = readLines(j.path).lines;
  const i = lines.findIndex((l) => JSON.parse(l).kind === 'finding');
  const rec = JSON.parse(lines[i]);
  rec.line = 11;
  lines[i] = canonical(rec);
  writeFileSync(j.path, `${lines.join('\n')}\n`);
  const v = verifyEvidence(d);
  assert.equal(v.verified, false);
  assert.deepEqual(v.broken[0], { file: `runs/${j.id}.jsonl`, line: i + 1, check: 'hash' });
  assert.equal(v.exit, 1);
});

test('V3.3 A deleted record breaks the chain at the next one', (t) => {
  const d = tmp(t);
  const j = run(d, [FINDING, { ...FINDING, fingerprint: 'fp2', line: 20 }]);
  const lines = readLines(j.path).lines;
  lines.splice(1, 1);
  writeFileSync(j.path, `${lines.join('\n')}\n`);
  const v = verifyEvidence(d);
  const b = v.broken.find((x) => x.file === `runs/${j.id}.jsonl`);
  assert.equal(b.line, 2);
  assert.ok(['seq', 'prev'].includes(b.check), b.check);
});

test('V3.4 A record spliced from another journal is caught by chain', (t) => {
  const d = tmp(t);
  const a = run(d);
  const b = run(d, [{ ...FINDING, fingerprint: 'other' }]);
  const la = readLines(a.path).lines;
  la[1] = readLines(b.path).lines[1];
  writeFileSync(a.path, `${la.join('\n')}\n`);
  const v = verifyEvidence(d);
  assert.ok(v.broken.some((x) => x.file === `runs/${a.id}.jsonl` && x.line === 2 && x.check === 'chain'), JSON.stringify(v.broken));
});

test('V3.5 A run journal the ledger does not name is unrecorded', (t) => {
  const d = tmp(t);
  run(d);
  const id = '20260930T000000Z-aaaaaaaaaaaaaaaa';
  const chain = newChain();
  const open = makeRecord({ chain, prev: null, kind: 'open', fields: { tool: 'cobolwork', toolVersion: '0', command: 'scan', argv: [], roots: [] }, at: '2026-09-30T00:00:00.000Z' });
  const close = makeRecord({ chain, prev: open.record, kind: 'close', fields: { exit: 0 }, at: '2026-09-30T00:00:01.000Z' });
  const fd = createExclusive(join(d, 'runs', `${id}.jsonl`));
  try { writeAll(fd, open.line + close.line); } finally { syncClose(fd); }
  const v = verifyEvidence(d);
  assert.deepEqual(v.unrecorded, [id]);
  assert.equal(v.verified, true);
});

test('V3.6 A journal with no close is open, not broken', (t) => {
  const d = tmp(t);
  run(d);
  const id = '20260930T000000Z-bbbbbbbbbbbbbbbb';
  const chain = newChain();
  const open = makeRecord({ chain, prev: null, kind: 'open', fields: { tool: 'cobolwork', toolVersion: '0', command: 'scan', argv: [], roots: [] }, at: '2026-09-30T00:00:00.000Z' });
  const finding = makeRecord({ chain, prev: open.record, kind: 'finding', fields: FINDING, at: '2026-09-30T00:00:01.000Z' });
  const fd = createExclusive(join(d, 'runs', `${id}.jsonl`));
  try { writeAll(fd, open.line + finding.line); } finally { syncClose(fd); }
  const v = verifyEvidence(d);
  assert.deepEqual(v.open, [id]);
  assert.equal(v.verified, true);
});

test('V3.7 A ledger rewritten from genesis verifies but is not sealed', GIT, (t) => {
  const d = tmp(t);
  const first = run(d);
  const second = run(d);
  const s = seal(d, { toolVersion: '0.0.0' });
  const repo = join(d, 'anchor');
  gitRepo(repo);
  anchorGit(s.path, { repo, chain: ledgerChainOf(s), seq: s.seq });
  // Rewritten consistently, under the same chain, with the second run removed.
  const recs = readLines(join(d, LEDGER)).lines.map((l) => JSON.parse(l));
  const g = makeRecord({ chain: recs[0].chain, prev: null, kind: 'genesis', fields: { createdAt: recs[0].createdAt }, at: recs[0].at });
  const r1 = recs.find((r) => r.run === first.id);
  const one = makeRecord({ chain: recs[0].chain, prev: g.record, kind: 'run', fields: { run: r1.run, runChain: r1.runChain, runLength: r1.runLength, runTip: r1.runTip }, at: r1.at });
  writeFileSync(join(d, LEDGER), g.line + one.line);
  unlinkSync(join(d, 'runs', `${second.id}.jsonl`));
  rmSync(join(d, 'seals'), { recursive: true });
  const v = verifyEvidence(d, { anchorGit: repo, anchorRef: 'HEAD' });
  assert.equal(v.verified, true, JSON.stringify(v.broken));
  assert.equal(v.sealed, false);
  assert.equal(v.exit, 1);
});

test('V3.8 A truncated ledger is caught by the seal', GIT, (t) => {
  const d = tmp(t);
  run(d);
  run(d);
  const s = seal(d, { toolVersion: '0.0.0' });
  const repo = join(d, 'anchor');
  gitRepo(repo);
  anchorGit(s.path, { repo, chain: ledgerChainOf(s), seq: s.seq });
  const lines = readLines(join(d, LEDGER)).lines;
  writeFileSync(join(d, LEDGER), `${lines.slice(0, -1).join('\n')}\n`);
  const v = verifyEvidence(d, { anchorGit: repo, anchorRef: 'HEAD' });
  assert.equal(v.sealed, false);
  assert.match(v.sealedReason, /records/);
});

test('V3.9 No witness leaves sealed null and the exit status 3', (t) => {
  const d = tmp(t);
  run(d);
  seal(d, { toolVersion: '0.0.0' });
  const v = verifyEvidence(d);
  assert.equal(v.sealed, null);
  assert.equal(v.anchored, true);
  assert.match(v.sealedReason, /witness/);
  assert.equal(v.exit, 3);
});

// V4 - Seals and signatures

test('V4.1 A seal is an in-toto statement over the ledger tip in a DSSE envelope', (t) => {
  const d = tmp(t);
  run(d);
  const s = seal(d, { toolVersion: '0.0.0' });
  const env = JSON.parse(readFileSync(s.path, 'utf8'));
  assert.equal(env.payloadType, PAYLOAD_TYPE);
  const st = JSON.parse(Buffer.from(env.payload, 'base64').toString('utf8'));
  const tip = JSON.parse(readLines(join(d, LEDGER)).lines.at(-1));
  assert.equal(st._type, STATEMENT_TYPE);
  assert.equal(st.predicateType, SEAL_PREDICATE);
  assert.deepEqual(st.subject, [{ name: `ledger:${tip.chain}`, digest: { sha256: tip.hash } }]);
  assert.equal(st.predicate.ledgerLength, tip.seq + 1);
  assert.deepEqual(env.signatures, []);
});

test('V4.2 A seal names the seal before it', (t) => {
  const d = tmp(t);
  run(d);
  const first = seal(d, { toolVersion: '0.0.0' });
  run(d);
  const second = seal(d, { toolVersion: '0.0.0' });
  assert.equal(first.statement.predicate.previousSeal, null);
  assert.equal(second.statement.predicate.previousSeal.sha256, sha256(readFileSync(first.path)));
});

test('V4.3 An SSH-signed seal verifies against allowed signers', SSH, (t) => {
  for (const type of ['ed25519', 'ecdsa']) {
    const d = tmp(t);
    const key = sshKey(d, type);
    run(d);
    const s = seal(d, { sshKey: key.path, toolVersion: '0.0.0' });
    assert.equal(s.signed, true);
    const v = verifyEvidence(d, { allowed: allowedFor(['ci@example.invalid', key]) });
    const [sig] = v.signatures[0].results;
    assert.equal(sig.valid, true, `${type}: ${sig.reason}`);
    assert.deepEqual(sig.principals, ['ci@example.invalid']);
  }
});

test('V4.4 A signature over a different ledger does not verify', SSH, (t) => {
  const d = tmp(t);
  const key = sshKey(d);
  run(d);
  const s = seal(d, { sshKey: key.path, toolVersion: '0.0.0' });
  const env = JSON.parse(readFileSync(s.path, 'utf8'));
  const st = JSON.parse(Buffer.from(env.payload, 'base64').toString('utf8'));
  st.subject[0].digest.sha256 = 'f'.repeat(64);
  env.payload = Buffer.from(canonical(st)).toString('base64');
  writeFileSync(s.path, `${canonical(env)}\n`);
  const v = verifyEvidence(d, { allowed: allowedFor(['ci', key]) });
  assert.equal(v.signatures[0].results[0].valid, false);
  assert.equal(v.anchored, false);
});

test('V4.5 A signer outside allowed signers does not seal', { ...SSH, ...GIT }, (t) => {
  const d = tmp(t);
  const trusted = sshKey(d, 'ed25519', 'trusted');
  const other = sshKey(d, 'ed25519', 'other');
  run(d);
  const s = seal(d, { sshKey: other.path, toolVersion: '0.0.0' });
  const repo = join(d, 'anchor');
  gitRepo(repo);
  anchorGit(s.path, { repo, chain: ledgerChainOf(s), seq: s.seq });
  const v = verifyEvidence(d, { allowed: allowedFor(['ci', trusted]), anchorGit: repo, anchorRef: 'HEAD' });
  assert.equal(v.signatures[0].results[0].valid, false);
  assert.equal(v.sealed, false);
});

test('V4.6 A signer program is run with the PAE on standard input', process.platform === 'win32' ? { skip: 'the signer here is a shell script' } : SSH, (t) => {
  const d = tmp(t);
  const key = sshKey(d);
  const signer = join(d, 'signer.sh');
  writeFileSync(signer, `#!/bin/sh\n[ "$1" = cobolwork-evidence ] || exit 9\nexec ssh-keygen -Y sign -f '${key.path}' -n "$1"\n`);
  chmodSync(signer, 0o755);
  run(d);
  const s = seal(d, { signer, toolVersion: '0.0.0' });
  assert.equal(s.signed, true);
  const v = verifyEvidence(d, { allowed: allowedFor(['kms', key]) });
  assert.equal(v.signatures[0].results[0].valid, true);
  assert.throws(() => seal(d, { signer, expectKeyid: 'SHA256:not-this-key', toolVersion: '0.0.0' }), /expected/);
});

test('V4.7 A deleted seal breaks the seal chain', (t) => {
  const d = tmp(t);
  run(d);
  const first = seal(d, { toolVersion: '0.0.0' });
  run(d);
  const second = seal(d, { toolVersion: '0.0.0' });
  unlinkSync(first.path);
  const v = verifyEvidence(d);
  assert.ok(v.broken.some((b) => b.file === `seals/${second.seq}.dsse.json` && b.check === 'seal-chain'), JSON.stringify(v.broken));
});

// V5 - Witnesses

test('V5.1 A git anchor commits the envelope to the anchor repository', GIT, (t) => {
  const d = tmp(t);
  run(d);
  const s = seal(d, { toolVersion: '0.0.0' });
  const repo = join(d, 'anchor');
  const git = gitRepo(repo);
  const a = anchorGit(s.path, { repo, chain: ledgerChainOf(s), seq: s.seq });
  assert.equal(a.pushed, false);
  assert.equal(git('show', `HEAD:${ledgerChainOf(s)}/${s.seq}.dsse.json`), readFileSync(s.path, 'utf8').trim());
  assert.throws(() => anchorGit(s.path, { repo, chain: '../escape', seq: 0 }), EvidenceRefusal);
});

test('V5.2 An anchor not pushed does not seal', { ...SSH, ...GIT }, (t) => {
  const d = tmp(t);
  const key = sshKey(d);
  run(d);
  const s = seal(d, { sshKey: key.path, toolVersion: '0.0.0' });
  const repo = join(d, 'anchor');
  const git = gitRepo(repo);
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
  git('remote', 'add', 'origin', join(d, 'nowhere.git'));
  git('update-ref', `refs/remotes/origin/${branch}`, 'HEAD');
  git('config', `branch.${branch}.remote`, 'origin');
  git('config', `branch.${branch}.merge`, `refs/heads/${branch}`);
  anchorGit(s.path, { repo, chain: ledgerChainOf(s), seq: s.seq });
  const v = verifyEvidence(d, { allowed: allowedFor(['ci', key]), anchorGit: repo });
  assert.equal(v.sealed, null);
  assert.match(v.sealedReason, /not on @\{upstream\}/);
});

test('V5.3 An RFC 3161 request is DER over the envelope digest', () => {
  const bytes = Buffer.from('an envelope');
  const req = timeStampRequest(bytes);
  const der = req.der;
  // SEQUENCE { INTEGER 1, SEQUENCE { SEQUENCE { OID sha256, NULL }, OCTET STRING digest }, INTEGER nonce, BOOLEAN TRUE }
  assert.equal(der[0], 0x30);
  const body = der.subarray(2);
  assert.deepEqual([...body.subarray(0, 3)], [0x02, 0x01, 0x01]);
  const digest = createHash('sha256').update(bytes).digest();
  assert.ok(body.includes(Buffer.from([0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01])), 'SHA-256 OID');
  assert.ok(body.includes(Buffer.concat([Buffer.from([0x04, 0x20]), digest])), 'the digest as an OCTET STRING');
  assert.deepEqual([...der.subarray(-3)], [0x01, 0x01, 0xff]);
  assert.equal(req.digest, digest.toString('hex'));
  assert.notEqual(timeStampRequest(bytes).nonce, req.nonce);
});

test('V5.4 A time-stamp response for another digest does not seal', { todo: 'verify --tsr is not built (spec §16 step 4)' }, () => {});

// V6 - Provenance

function buildTree(t) {
  const d = tmp(t);
  const src = join(d, 'repo');
  mkdirSync(join(src, 'copy'), { recursive: true });
  writeFileSync(join(src, 'PAY.cbl'), ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. PAY.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.', '       COPY PAYREC.', '       PROCEDURE DIVISION.', '           GOBACK.', ''].join('\n'));
  writeFileSync(join(src, 'copy', 'PAYREC.cpy'), '       01 PAY-REC PIC X(10).\n');
  writeFileSync(join(src, 'PAY.obj'), 'object bytes');
  return { d, src };
}
const buildWith = (src, args, env = {}) => cli(['build', src, '--quiet', ...args], env);

test('V6.1 SLSA provenance is a Statement v1 with the SLSA v1 predicate', (t) => {
  const { d, src } = buildTree(t);
  const r = buildWith(src, ['--provenance', join(d, 'prov.json'), '--provenance-format', 'slsa', '--artifact', join(src, 'PAY.obj'), '--out', join(d, 'build.json')]);
  assert.ok([0, 3].includes(r.status), r.stderr);
  const st = JSON.parse(readFileSync(join(d, 'prov.json'), 'utf8'));
  assert.equal(st._type, 'https://in-toto.io/Statement/v1');
  assert.equal(st.predicateType, 'https://slsa.dev/provenance/v1');
  assert.deepEqual(st.subject[0], { name: 'build.json', digest: { sha256: sha256(readFileSync(join(d, 'build.json'))) } });
  assert.deepEqual(st.subject[1], { name: 'PAY.obj', digest: { sha256: sha256('object bytes') } });
  assert.equal(st.predicate.buildDefinition.buildType, 'https://github.com/Portll/cobolwork/blob/main/docs/spec/evidence.md#build-v1');
  assert.equal(st.predicate.runDetails.builder.id, 'https://github.com/Portll/cobolwork/local');
  assert.ok(!JSON.stringify(st).includes(d), 'no absolute path of this machine');
});

test('V6.2 Every source read is a resolved dependency with its digest', (t) => {
  const { d, src } = buildTree(t);
  buildWith(src, ['--provenance', join(d, 'plain.json')]);
  buildWith(src, ['--provenance', join(d, 'slsa.json'), '--provenance-format', 'slsa']);
  const plain = JSON.parse(readFileSync(join(d, 'plain.json'), 'utf8'));
  const deps = JSON.parse(readFileSync(join(d, 'slsa.json'), 'utf8')).predicate.buildDefinition.resolvedDependencies;
  assert.ok(plain.sources.length >= 2, 'the program and its copybook were hashed');
  for (const s of plain.sources) assert.ok(deps.some((x) => x.uri === `file:${s.path}` && x.digest.sha256 === s.sha256), s.path);
  assert.ok(deps.some((x) => x.name === 'copy/PAYREC.cpy'));
});

test("V6.3 The run journal's tip is a byproduct", (t) => {
  const { d, src } = buildTree(t);
  buildWith(src, ['--provenance', join(d, 'slsa.json'), '--provenance-format', 'slsa', '--evidence', join(d, 'ev')]);
  const st = JSON.parse(readFileSync(join(d, 'slsa.json'), 'utf8'));
  const [run] = readdirSync(join(d, 'ev', 'runs'));
  const records = readLines(join(d, 'ev', 'runs', run)).lines.map((l) => JSON.parse(l));
  const [byproduct] = st.predicate.runDetails.byproducts;
  assert.equal(byproduct.name, `evidence:run:${run.replace(/\.jsonl$/, '')}`);
  assert.ok(records.some((r) => r.hash === byproduct.digest.sha256), 'the byproduct names a record of the run');
  const out = records.find((r) => r.kind === 'output' && r.name === 'provenance');
  assert.equal(out.sha256, sha256(readFileSync(join(d, 'slsa.json'))), 'and the journal records the statement by digest');
});

test('V6.4 The default provenance record is unchanged', (t) => {
  const { d, src } = buildTree(t);
  buildWith(src, ['--provenance', join(d, 'plain.json')], { SOURCE_DATE_EPOCH: '1790700000' });
  const plain = JSON.parse(readFileSync(join(d, 'plain.json'), 'utf8'));
  assert.equal(plain.tool, 'cobolwork-build-provenance');
  assert.ok(Array.isArray(plain.sources));
  assert.equal(plain.builtAt, new Date(1790700000 * 1000).toISOString());
  const r = cli(['build', src, '--provenance-format', 'slsa']);
  assert.equal(r.status, 2, 'a format with no --provenance file is refused');
});

// V7 - The bill of materials

function estate(t) {
  const d = tmp(t);
  const src = join(d, 'estate');
  mkdirSync(join(src, 'copy'), { recursive: true });
  mkdirSync(join(src, 'jcl'), { recursive: true });
  writeFileSync(join(src, 'PAYMAIN.cbl'), ['       CBL TRUNC(OPT),ARITH(EXTEND)', '       IDENTIFICATION DIVISION.', '       PROGRAM-ID. PAYMAIN.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.', '       COPY PAYREC.', "       01 WS-PGM PIC X(8) VALUE 'PAYCALC'.", '       PROCEDURE DIVISION.', "           CALL 'PAYCALC' USING PAY-REC.", '           CALL WS-PGM USING PAY-REC.', '           EXEC CICS RETURN END-EXEC.', '           GOBACK.', ''].join('\n'));
  writeFileSync(join(src, 'PAYCALC.cbl'), ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. PAYCALC.', '       DATA DIVISION.', '       LINKAGE SECTION.', '       COPY PAYREC.', '       PROCEDURE DIVISION USING PAY-REC.', '           GOBACK.', ''].join('\n'));
  writeFileSync(join(src, 'copy', 'PAYREC.cpy'), '       01 PAY-REC PIC X(10).\n');
  writeFileSync(join(src, 'jcl', 'PAYJOB.jcl'), '//PAYJOB JOB 1\n//S1 EXEC PGM=PAYMAIN\n');
  return { d, src };
}
const bomOf = (src, env = {}) => JSON.parse(cli(['sbom', src, '--quiet'], env).stdout);
const comp = (bom, ref) => bom.components.find((c) => c['bom-ref'] === ref);
const prop = (c, name) => (c.properties || []).find((p) => p.name === name)?.value;
const deps = (bom, ref) => (bom.dependencies.find((x) => x.ref === ref) || { dependsOn: [] }).dependsOn;

test('V7.1 The SBOM is CycloneDX 1.6 with one file component per source', (t) => {
  const { src } = estate(t);
  const bom = bomOf(src);
  assert.equal(bom.bomFormat, 'CycloneDX');
  assert.equal(bom.specVersion, '1.6');
  assert.match(bom.serialNumber, /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  for (const [ref, kind] of [['PAYMAIN.cbl', 'program'], ['PAYCALC.cbl', 'program'], ['copy/PAYREC.cpy', 'copybook'], ['jcl/PAYJOB.jcl', 'jcl']]) {
    const c = comp(bom, ref);
    assert.equal(c.type, 'file', ref);
    assert.equal(prop(c, 'cobolwork:kind'), kind, ref);
    assert.deepEqual(c.hashes, [{ alg: 'SHA-256', content: sha256(readFileSync(join(src, ref))) }], ref);
  }
  assert.equal(prop(comp(bom, 'PAYMAIN.cbl'), 'cobolwork:options'), 'TRUNC(OPT) ARITH(EXTEND)');
});

test('V7.2 A COPY is a dependency from the program to the copybook it resolved to', (t) => {
  const { src } = estate(t);
  const bom = bomOf(src);
  assert.ok(deps(bom, 'PAYMAIN.cbl').includes('copy/PAYREC.cpy'));
  assert.ok(deps(bom, 'PAYCALC.cbl').includes('copy/PAYREC.cpy'));
  assert.ok(deps(bom, 'PAYMAIN.cbl').includes('PAYCALC.cbl'), 'a static CALL is an edge');
  assert.deepEqual(deps(bom, 'jcl/PAYJOB.jcl'), ['PAYMAIN.cbl'], 'a job depends on the program its step runs');
});

test('V7.3 A dynamic CALL is a property, not a dependency', (t) => {
  const { src } = estate(t);
  const bom = bomOf(src);
  assert.equal(prop(comp(bom, 'PAYMAIN.cbl'), 'cobolwork:unresolved-call'), 'WS-PGM');
  assert.ok(!deps(bom, 'PAYMAIN.cbl').some((r) => /WS-PGM/.test(r)));
});

function runEstate(t) {
  const d = tmp(t);
  const src = join(d, 'estate');
  for (const dir of ['jcl', 'proc', 'bms']) mkdirSync(join(src, dir), { recursive: true });
  const program = (id, lines) => ['       IDENTIFICATION DIVISION.', `       PROGRAM-ID. ${id}.`, '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
    "       01 WS-NEXT PIC X(8) VALUE 'PAYCALC'.", '       PROCEDURE DIVISION.', ...lines, '           GOBACK.', ''].join('\n');
  writeFileSync(join(src, 'PAYMAIN.cbl'), program('PAYMAIN', []));
  writeFileSync(join(src, 'PAYCALC.cbl'), program('PAYCALC', []));
  writeFileSync(join(src, 'PAYMENU.cbl'), program('PAYMENU', [
    "           EXEC CICS XCTL PROGRAM('PAYMAIN') END-EXEC",
    '           EXEC CICS LINK PROGRAM(WS-NEXT) END-EXEC',
    "           EXEC CICS SEND MAP('PAYM1') MAPSET('PAYSET') END-EXEC",
    "           CALL 'EXTPGM'",
    "           CALL 'MQPUT1'",
  ]));
  writeFileSync(join(src, 'bms', 'PAYSET.bms'), 'PAYSET   DFHMSD TYPE=MAP,LANG=COBOL\nPAYM1    DFHMDI SIZE=(24,80)\n         DFHMSD TYPE=FINAL\n         END\n');
  writeFileSync(join(src, 'jcl', 'TSO.jcl'), '//TSO JOB 1\n//S1 EXEC PGM=IKJEFT01\n//SYSTSIN DD *\n  DSN SYSTEM(DB2A)\n  RUN PROGRAM(PAYMAIN) PLAN(PAYPLAN)\n/*\n');
  writeFileSync(join(src, 'jcl', 'IMS.jcl'), "//IMS JOB 1\n//S1 EXEC PGM=DFSRRC00,PARM='BMP,PAYCALC,PAYPSB'\n");
  writeFileSync(join(src, 'jcl', 'PROCJOB.jcl'), '//PROCJOB JOB 1\n//S1 EXEC PAYPROC\n//S2 EXEC NOSUCH\n');
  writeFileSync(join(src, 'proc', 'PAYPROC.prc'), '//PAYPROC PROC\n//S EXEC PGM=IDCAMS\n');
  return src;
}

test('V7.6 A job depends on the program a TSO batch step or an IMS region runs, and on the procedure it calls', (t) => {
  const bom = bomOf(runEstate(t));
  assert.deepEqual(deps(bom, 'jcl/TSO.jcl'), ['PAYMAIN.cbl', 'program:IKJEFT01']);
  assert.deepEqual(deps(bom, 'jcl/IMS.jcl'), ['PAYCALC.cbl', 'program:DFSRRC00']);
  assert.deepEqual(deps(bom, 'jcl/PROCJOB.jcl'), ['proc/PAYPROC.prc']);
  assert.equal(prop(comp(bom, 'jcl/PROCJOB.jcl'), 'cobolwork:unresolved-proc'), 'NOSUCH');
  assert.deepEqual(deps(bom, 'proc/PAYPROC.prc'), ['program:IDCAMS']);
});

test('V7.7 A program outside the estate is a component, marked system or external; a platform routine is not', (t) => {
  const bom = bomOf(runEstate(t));
  assert.equal(comp(bom, 'program:IDCAMS').type, 'application');
  assert.equal(prop(comp(bom, 'program:IDCAMS'), 'cobolwork:kind'), 'system-program');
  assert.equal(prop(comp(bom, 'program:EXTPGM'), 'cobolwork:kind'), 'external-program');
  assert.ok(deps(bom, 'PAYMENU.cbl').includes('program:EXTPGM'));
  assert.equal(comp(bom, 'program:MQPUT1'), undefined, 'MQPUT1 is the MQ platform');
  assert.ok(deps(bom, 'PAYMENU.cbl').includes('platform:MQ'));
});

test('V7.8 CICS XCTL and LINK by literal are edges, through a field a property; SEND MAP depends on its mapset', (t) => {
  const bom = bomOf(runEstate(t));
  const d = deps(bom, 'PAYMENU.cbl');
  assert.ok(d.includes('PAYMAIN.cbl'), 'XCTL PROGRAM literal');
  assert.ok(d.includes('bms/PAYSET.bms'), 'SEND MAP MAPSET');
  assert.ok(!d.includes('PAYCALC.cbl'), 'LINK through a field is not an edge');
  assert.equal(prop(comp(bom, 'PAYMENU.cbl'), 'cobolwork:unresolved-call'), 'WS-NEXT');
});

test('V7.9 The estate carries the commit it was read at, and no version outside a repository', (t) => {
  const src = runEstate(t);
  assert.equal(bomOf(src).metadata.component.version, undefined);
  const git = (args) => spawnSync('git', ['-C', src, ...args], { encoding: 'utf8' });
  git(['init', '-q']);
  for (const [k, v] of [['user.email', 't@example.com'], ['user.name', 't'], ['core.autocrlf', 'false']]) git(['config', k, v]);
  git(['add', '-A']);
  git(['commit', '-qm', 'estate']);
  const head = git(['rev-parse', 'HEAD']).stdout.trim();
  const c = bomOf(src).metadata.component;
  assert.equal(c.version, head);
  assert.deepEqual(c.properties, [{ name: 'cobolwork:dirty', value: 'false' }]);
});

test('V7.4 The same tree gives the same SBOM bytes', (t) => {
  const { src } = estate(t);
  const a = cli(['sbom', src], { SOURCE_DATE_EPOCH: '1790700000' }).stdout;
  const b = cli(['sbom', src], { SOURCE_DATE_EPOCH: '1790700000' }).stdout;
  assert.equal(a, b);
  assert.equal(JSON.parse(a).metadata.timestamp, new Date(1790700000 * 1000).toISOString());
  assert.equal(JSON.parse(cli(['sbom', src]).stdout).metadata.timestamp, undefined, 'no clock without SOURCE_DATE_EPOCH');
});

test('V7.5 A platform has no version', (t) => {
  const { src } = estate(t);
  const bom = bomOf(src);
  assert.deepEqual(comp(bom, 'platform:CICS'), { 'bom-ref': 'platform:CICS', type: 'platform', name: 'CICS' });
  assert.ok(deps(bom, 'PAYMAIN.cbl').includes('platform:CICS'));
  assert.ok(!deps(bom, 'PAYCALC.cbl').includes('platform:CICS'));
});

// V8 - Zowe and agent configuration

function zoweTree(t, files) {
  const d = tmp(t);
  for (const [name, value] of Object.entries(files)) {
    mkdirSync(dirname(join(d, name)), { recursive: true });
    writeFileSync(join(d, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  }
  return scanZowe(d);
}
const zosmf = (properties, secure) => ({ profiles: { lpar1: { profiles: { zosmf: { type: 'zosmf', properties: { host: 'lpar1.example.invalid', port: 443, ...properties }, secure } } } } });
const mcp = (server) => ({ mcpServers: { zowe: { command: 'npx', args: ['@zowe/mcp-server@0.9.0', '--stdio', '--native', '--system', 'OPER@lpar1.example.invalid'], ...server } } });
const rules = (r) => r.findings.map((f) => f.rule).sort();

test('V8.1 A team-config password outside secure is reported and not echoed', (t) => {
  const r = zoweTree(t, { 'zowe.config.json': zosmf({ user: 'OPER', password: 'TW9XQ2RP' }, ['user']) });
  assert.deepEqual(rules(r), ['zowe-config-secret-in-clear']);
  assert.match(r.findings[0].detail, /lpar1\.zosmf.*properties\.password/);
  assert.ok(!JSON.stringify(r).includes('TW9XQ2RP'));
});

test('V8.2 A password listed in secure is not reported', (t) => {
  assert.deepEqual(rules(zoweTree(t, { 'zowe.config.json': zosmf({ user: 'OPER', password: 'TW9XQ2RP' }, ['user', 'password']) })), []);
});

test('V8.3 rejectUnauthorized false is reported', (t) => {
  assert.deepEqual(rules(zoweTree(t, { 'zowe.config.user.json': `// comments and a trailing comma, as JSONC allows\n${JSON.stringify(zosmf({ rejectUnauthorized: false }, ['user', 'password'])).replace(/}$/, ',}')}` })), ['zowe-config-tls-verify-off']);
});

test('V8.4 A Zowe MCP password in an MCP client env block is reported', (t) => {
  const r = zoweTree(t, {
    '.mcp.json': mcp({ env: { ZOWE_MCP_PASSWORD_OPER_LPAR1_EXAMPLE_INVALID: 'R8KD3VNQ' } }),
    '.vscode/mcp.json': { servers: { zowe: { type: 'stdio', command: 'npx', args: ['@zowe/mcp-server@0.9.0'], env: { ZOWE_MCP_PASSWORD_OPER_LPAR1: '${input:zowePassword}' } } } },
  });
  assert.deepEqual(rules(r), ['zowe-mcp-password-in-config']);
  assert.equal(r.findings[0].path, '.mcp.json');
  assert.match(r.findings[0].detail, /server zowe sets ZOWE_MCP_PASSWORD_OPER_LPAR1_EXAMPLE_INVALID/);
  assert.ok(!JSON.stringify(r).includes('R8KD3VNQ'));
});

test('V8.5 A capability tier of full is high', (t) => {
  const r = zoweTree(t, { '.cursor/mcp.json': mcp({ args: ['@zowe/mcp-server@0.9.0', '--capability-tier', 'full'] }), '.vscode/settings.json': { 'zoweMCP.capabilityTier': 'update' } });
  assert.deepEqual(rules(r), ['zowe-mcp-tier-full', 'zowe-mcp-tier-writes']);
  assert.equal(ZOWE_RULES['zowe-mcp-tier-full'].sev, 'high');
});

test('V8.6 read-strict and read are not reported', (t) => {
  assert.deepEqual(rules(zoweTree(t, { '.mcp.json': mcp({ env: { ZOWE_MCP_CAPABILITY_TIER: 'read' } }), '.vscode/settings.json': { 'zoweMCP.capabilityTier': 'read-strict' } })), []);
});

test('V8.7 Data marking turned off is reported', (t) => {
  assert.deepEqual(rules(zoweTree(t, { '.mcp.json': mcp({ env: { ZOWE_MCP_DATA_MARKING: '0' } }) })), ['zowe-mcp-data-marking-off']);
});

test('V8.9 A comment after a trailing comma does not hide the file', (t) => {
  const text = `{ "mcpServers": { "zowe": ${JSON.stringify(mcp({ env: { ZOWE_MCP_DATA_MARKING: '0' } }).mcpServers.zowe)},\n  // reserved\n  /* and a block */\n} }`;
  assert.deepEqual(rules(zoweTree(t, { '.mcp.json': text })), ['zowe-mcp-data-marking-off']);
});

test('V8.10 The server is known by its ZOWE_MCP_ variables and by any registry runner', (t) => {
  const r = zoweTree(t, {
    '.mcp.json': { mcpServers: { local: { command: 'node', args: ['/opt/agents/server/index.js'], env: { ZOWE_MCP_CAPABILITY_TIER: 'full' } }, bun: { command: 'bunx', args: ['@zowe/mcp-server'] } } },
  });
  assert.deepEqual(rules(r), ['zowe-mcp-tier-full', 'zowe-mcp-unpinned']);
});

test('V8.11 native-config.json is read for passwords and TLS verification', (t) => {
  const r = zoweTree(t, { 'server/native-config.json': { systems: [{ host: 'lpar1.example.invalid', password: 'Q7WX2KPL', rejectUnauthorized: false }, { host: 'lpar2.example.invalid', password: '${env:PW}' }] } });
  assert.deepEqual(rules(r), ['zowe-config-secret-in-clear', 'zowe-config-tls-verify-off']);
  assert.ok(!JSON.stringify(r).includes('Q7WX2KPL'));
});

// V9 - Control cards, shadowing and options

function jclRules(t, text) {
  const d = tmp(t);
  writeFileSync(join(d, 'JOB.jcl'), text);
  return scanJcl(d).findings;
}

test('V9.1 SYSTSIN from a cataloged data set is reported', (t) => {
  const f = jclRules(t, '//J1 JOB 1\n//S1 EXEC PGM=IKJEFT01\n//SYSTSPRT DD SYSOUT=*\n//SYSTSIN DD DSN=PROD.CNTL(RUNDSN),DISP=SHR\n').filter((x) => x.rule === 'control-cards-from-dataset');
  assert.equal(f.length, 1);
  assert.equal(f[0].line, 4);
  assert.match(f[0].detail, /step S1 runs IKJEFT01 with its SYSTSIN commands in PROD\.CNTL\(RUNDSN\)/);
});

test('V9.2 In-stream SYSTSIN is not control-cards-from-dataset', (t) => {
  const f = jclRules(t, '//J1 JOB 1\n//S1 EXEC PGM=IKJEFT01\n//SYSTSIN DD *\n DSN SYSTEM(DB2P)\n RUN PROGRAM(DSNTEP2) PLAN(DSNTEP2)\n END\n/*\n//SYSIN DD *\n SELECT 1 FROM SYSIBM.SYSDUMMY1;\n/*\n');
  assert.deepEqual(f.filter((x) => x.rule === 'control-cards-from-dataset'), []);
  const runs = f.filter((x) => x.rule === 'tso-batch-runs-program');
  assert.equal(runs.length, 1);
  assert.match(runs[0].detail, /RUN/);
  const sql = jclRules(t, '//J1 JOB 1\n//S1 EXEC PGM=IKJEFT01\n//SYSTSIN DD *\n RUN PROGRAM(DSNTIAD)\n/*\n//SYSIN DD DSN=PROD.SQL(GRANTS),DISP=SHR\n').filter((x) => x.rule === 'control-cards-from-dataset');
  assert.equal(sql.length, 1, 'SYSIN read by DSNTIAD under RUN PROGRAM is commands too');
});

test('V9.3 A DFSORT MODS statement naming an exit is reported', (t) => {
  const f = jclRules(t, '//J1 JOB 1\n//S1 EXEC PGM=SORT\n//SORTIN DD DSN=A.B,DISP=SHR\n//SORTOUT DD DSN=A.C,DISP=OLD\n//SYSIN DD *\n  SORT FIELDS=(1,10,CH,A)\n  MODS E15=(XIT15,4096,EXITLIB,C),E35=(XIT35,4096,EXITLIB)\n/*\n');
  assert.deepEqual(f.filter((x) => x.rule === 'sort-exit-named').map((x) => [x.line, x.detail.match(/E\d\d exit \w+/)[0]]), [[7, 'E15 exit XIT15'], [7, 'E35 exit XIT35']]);
  assert.deepEqual(jclRules(t, '//J1 JOB 1\n//S1 EXEC PGM=SORT\n//SYSIN DD *\n  SORT FIELDS=(1,10,CH,A)\n/*\n').filter((x) => x.rule === 'sort-exit-named'), []);
});

test('V9.4 A copybook in two copy directories is shadowed', (t) => {
  const d = tmp(t);
  const src = join(d, 'estate');
  const prog = (id) => ['       IDENTIFICATION DIVISION.', `       PROGRAM-ID. ${id}.`, '       DATA DIVISION.', '       WORKING-STORAGE SECTION.', '       COPY CUSTREC.', '       PROCEDURE DIVISION.', '           GOBACK.', ''].join('\n');
  for (const [dir, layout, id] of [['north', 'PIC X(10)', 'NPROG'], ['south', 'PIC X(20)', 'SPROG']]) {
    mkdirSync(join(src, dir), { recursive: true });
    writeFileSync(join(src, dir, 'CUSTREC.cpy'), `       01 CUST-REC ${layout}.\n`);
    writeFileSync(join(src, dir, `${id}.cbl`), prog(id));
  }
  const scan = JSON.parse(cli(['scan', src, '--only', 'copybook', '--quiet']).stdout);
  assert.equal(scan.summary.byRule['copybook-shadowed'], 1);
  const bom = bomOf(src);
  assert.ok(deps(bom, 'north/NPROG.cbl').includes('north/CUSTREC.cpy'));
  assert.ok(deps(bom, 'south/SPROG.cbl').includes('south/CUSTREC.cpy'));
});

function gitWithProgram(t, base, head) {
  const d = tmp(t);
  const repo = join(d, 'repo');
  const git = gitRepo(repo);
  writeFileSync(join(repo, 'PAY.cbl'), base);
  git('add', 'PAY.cbl');
  git('commit', '-q', '-m', 'base');
  writeFileSync(join(repo, 'PAY.cbl'), head);
  git('commit', '-q', '-am', 'head');
  return repo;
}
const payProgram = (card, statement = 'GOBACK') => [...(card ? [`       ${card}`] : []), '       IDENTIFICATION DIVISION.', '       PROGRAM-ID. PAY.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.', '       01 WS-AMT PIC S9(4) COMP.', '       PROCEDURE DIVISION.', `           ${statement}.`, ''].join('\n');

test('V9.5 An option card changing TRUNC between base and head is reported', GIT, (t) => {
  const repo = gitWithProgram(t, payProgram('CBL TRUNC(STD),ARITH(C)'), payProgram('CBL TRUNC(OPT),AR(COMPAT)'));
  const doc = JSON.parse(cli(['build', repo, '--base', 'HEAD~1', '--head', 'HEAD', '--quiet']).stdout);
  assert.deepEqual(doc.optionsChanged, [{ path: 'PAY.cbl', option: 'TRUNC', base: 'TRUNC(STD)', head: 'TRUNC(OPT)', line: 1 }], 'ARITH(C) and AR(COMPAT) are one setting');
  assert.ok(doc.reasons.some((r) => /changes TRUNC from TRUNC\(STD\) to TRUNC\(OPT\)/.test(r)));
});

test('V9.6 A change that leaves the options alone reports nothing', GIT, (t) => {
  const repo = gitWithProgram(t, payProgram('PROCESS NUMPROC(PFD)'), payProgram('PROCESS NUMPROC(PFD)', 'MOVE 1 TO WS-AMT GOBACK'));
  const doc = JSON.parse(cli(['build', repo, '--base', 'HEAD~1', '--head', 'HEAD', '--quiet']).stdout);
  assert.deepEqual(doc.optionsChanged, []);
});

// V10 - Change assurance in the build

function changeRepo(t) {
  const d = tmp(t);
  const repo = join(d, 'repo');
  const git = gitRepo(repo);
  writeFileSync(join(repo, 'cobolwork.policy.json'), JSON.stringify({ policyVersion: 1, requireEquivalence: 'always' }));
  writeFileSync(join(repo, 'PAY.cbl'), payProgram(null, 'COMPUTE WS-AMT ROUNDED = WS-AMT * 1 GOBACK'));
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  const base = sha256(readFileSync(join(repo, 'PAY.cbl')));
  writeFileSync(join(repo, 'PAY.cbl'), payProgram(null, 'COMPUTE WS-AMT = WS-AMT * 1 GOBACK'));
  git('commit', '-q', '-am', 'head');
  const head = sha256(readFileSync(join(repo, 'PAY.cbl')));
  return { d, repo, base, head };
}
function statementFile(d, name, { base, head, verdict = 'equivalent', coverage = { paragraphs: 1, reached: 1, unreached: [] }, inconclusive = [] }) {
  const st = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: 'base:PAY.cbl', digest: { sha256: base } }, { name: 'head:PAY.cbl', digest: { sha256: head } }],
    predicateType: 'https://github.com/Portll/ironwork/blob/main/docs/evidence.md#equivalence-v1',
    predicate: { verdict, coverage, inconclusive, results: [], inputs: [], limit: 'test' },
  };
  const path = join(d, name);
  writeFileSync(path, JSON.stringify(st));
  return path;
}
const buildChange = (repo, extra) => {
  const r = cli(['build', repo, '--base', 'HEAD~1', '--head', 'HEAD', '--quiet', ...extra]);
  return { status: r.status, doc: JSON.parse(r.stdout || '{}'), stderr: r.stderr };
};

test('V10.1 An equivalence statement for other sources is refused', GIT, (t) => {
  const { d, repo, base } = changeRepo(t);
  const other = statementFile(d, 'other.json', { base, head: 'f'.repeat(64) });
  const { doc } = buildChange(repo, ['--equivalence', other]);
  assert.equal(doc.checks.equivalence, false);
  assert.equal(doc.verdict, 'fail');
  assert.ok(doc.reasons.some((r) => /match no program this change edits/.test(r)), doc.reasons.join('\n'));
});

test('V10.2 An inconclusive statement does not satisfy requireEquivalence always', GIT, (t) => {
  const { d, repo, base, head } = changeRepo(t);
  const unmeasured = statementFile(d, 'unmeasured.json', { base, head, coverage: null });
  let { doc } = buildChange(repo, ['--equivalence', unmeasured]);
  assert.equal(doc.checks.equivalence, false);
  assert.match(doc.equivalence.programs[0].because, /measured no coverage/);
  const unreached = statementFile(d, 'unreached.json', { base, head, coverage: { paragraphs: 3, reached: 2, unreached: ['CALC-INTEREST'] } });
  ({ doc } = buildChange(repo, ['--equivalence', unreached]));
  assert.equal(doc.verdict, 'fail');
  assert.ok(doc.reasons.some((r) => /never reached CALC-INTEREST/.test(r)), doc.reasons.join('\n'));
  ({ doc } = buildChange(repo, []));
  assert.equal(doc.checks.equivalence, false, 'no statement at all fails a requirement of always');
});

test('V10.3 An equivalent, signed statement satisfies requireEquivalence always', { ...SSH, ...GIT }, (t) => {
  const { d, repo, base, head } = changeRepo(t);
  const key = sshKey(d);
  writeFileSync(join(d, 'allowed'), `assurance namespaces="cobolwork-evidence" ${key.line}\n`);
  const plain = statementFile(d, 'plain.json', { base, head });
  const signed = join(d, 'signed.json');
  const r = cli(['evidence', 'sign', plain, '--ssh-key', key.path, '--out', signed]);
  assert.equal(r.status, 0, r.stderr);
  const { doc } = buildChange(repo, ['--equivalence', signed, '--allowed-signers', join(d, 'allowed')]);
  assert.equal(doc.checks.equivalence, true, doc.reasons.join('\n'));
  assert.deepEqual(doc.equivalence.programs[0].signer, ['assurance']);
  const unsigned = buildChange(repo, ['--equivalence', plain, '--allowed-signers', join(d, 'allowed')]).doc;
  assert.equal(unsigned.checks.equivalence, false, 'an unsigned statement does not satisfy a build that names signers');
});

test('V10.4 A change to a copybook alone needs a statement for each program that copies it', GIT, (t) => {
  const d = tmp(t);
  const repo = join(d, 'repo');
  const git = gitRepo(repo);
  writeFileSync(join(repo, 'cobolwork.policy.json'), JSON.stringify({ policyVersion: 1, requireEquivalence: 'always' }));
  writeFileSync(join(repo, 'RATES.cpy'), '       01 WS-RATE PIC 9V999 VALUE 1.035.\n');
  writeFileSync(join(repo, 'PAY.cbl'), ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. PAY.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.', '       COPY RATES.', '       PROCEDURE DIVISION.', '           GOBACK.', ''].join('\n'));
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  writeFileSync(join(repo, 'RATES.cpy'), '       01 WS-RATE PIC 9V999 VALUE 1.045.\n');
  git('commit', '-q', '-am', 'the rate changes and no program does');
  const { doc } = buildChange(repo, []);
  assert.equal(doc.checks.equivalence, false);
  assert.deepEqual(doc.equivalence.programs.map((p) => [p.path, p.via]), [['PAY.cbl', ['RATES.cpy']]]);
  assert.match(doc.equivalence.programs[0].because, /copybook RATES\.cpy the change edits/);
});

test('V8.8 An unpinned npx launch is reported', (t) => {
  assert.deepEqual(rules(zoweTree(t, { 'claude_desktop_config.json': { mcpServers: { zowe: { command: 'npx', args: ['@zowe/mcp-server'] } } } })), ['zowe-mcp-unpinned']);
  assert.deepEqual(rules(zoweTree(t, { 'claude_desktop_config.json': { mcpServers: { zowe: { command: 'npx', args: ['@zowe/mcp-server@0.9.0'] } } } })), []);
});

// V6 - V10: built in later steps of spec §16.

const PENDING = {
};
const specScenarios = [...SPEC.matchAll(/^#### (V\d+\.\d+) (.+)$/gm)].map((m) => ({ id: m[1], title: m[2].trim() }));
const writtenHere = new Set([...SELF.matchAll(/^test\(['"](V\d+\.\d+) /gm)].map((m) => m[1]));
for (const s of specScenarios) {
  const group = s.id.split('.')[0];
  if (!writtenHere.has(s.id) && PENDING[group]) test(`${s.id} ${s.title}`, { todo: PENDING[group] }, () => {});
}

test('V0.1 The spec and the suite name the same scenarios', () => {
  const ids = specScenarios.map((s) => s.id);
  assert.ok(ids.length >= 50, 'the spec holds scenarios');
  assert.equal(new Set(ids).size, ids.length, 'no scenario id is used twice');
  const covered = new Set([...writtenHere, ...specScenarios.filter((s) => PENDING[s.id.split('.')[0]] && !writtenHere.has(s.id)).map((s) => s.id)]);
  assert.deepEqual(ids.filter((id) => !covered.has(id)), [], 'every scenario has a test or a registered todo');
  assert.deepEqual([...writtenHere].filter((id) => id !== 'V0.1' && !ids.includes(id)), [], 'every test has a scenario');
  for (const id of writtenHere) {
    if (id === 'V0.1') continue;
    const title = specScenarios.find((s) => s.id === id).title;
    assert.ok(SELF.includes(`test('${id} ${title}'`) || SELF.includes(`test("${id} ${title}"`), `${id} is titled as the spec writes it`);
  }
});
