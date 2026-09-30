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

test('V8.8 An unpinned npx launch is reported', (t) => {
  assert.deepEqual(rules(zoweTree(t, { 'claude_desktop_config.json': { mcpServers: { zowe: { command: 'npx', args: ['@zowe/mcp-server'] } } } })), ['zowe-mcp-unpinned']);
  assert.deepEqual(rules(zoweTree(t, { 'claude_desktop_config.json': { mcpServers: { zowe: { command: 'npx', args: ['@zowe/mcp-server@0.9.0'] } } } })), []);
});

// V6 - V10: built in later steps of spec §16.

const PENDING = {
  V6: 'SLSA provenance (spec §16 step 6)',
  V7: 'cobolwork sbom (spec §16 step 7)',
  V9: 'control-card, shadowing and option lanes (spec §16 step 8)',
  V10: '--equivalence (spec §16 step 9)',
};
const specScenarios = [...SPEC.matchAll(/^#### (V\d+\.\d+) (.+)$/gm)].map((m) => ({ id: m[1], title: m[2].trim() }));
const writtenHere = new Set([...SELF.matchAll(/^test\('(V\d+\.\d+) /gm)].map((m) => m[1]));
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
    assert.ok(SELF.includes(`test('${id} ${title}'`), `${id} is titled as the spec writes it`);
  }
});
