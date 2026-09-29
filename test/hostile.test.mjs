import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFileIndex, parseSource } from '../lib/parser.mjs';
import { inventory } from '../lib/inventory.mjs';
import { scanAll } from '../lib/scan.mjs';
import { versionRangeProblems } from '../lib/advisories.mjs';
import { REGISTRY } from '../lib/kernel/registry.mjs';
import { toSarif } from '../lib/sarif.mjs';
import { loadSite, classifyPath } from '../lib/site.mjs';
import { loadBaseline, applyBaseline, validateEntry } from '../lib/baseline.mjs';
import { loadPacks } from '../lib/packs.mjs';
import { diffTrees } from '../lib/diff.mjs';
import { stampFingerprints } from '../lib/kernel/identity.mjs';
import { parseJcl } from '../lib/jcl.mjs';
import './pin-machine.mjs';

// What a tree someone else wrote cannot do to a scan, or make its report carry.
const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-hostile-'));
  for (const [name, text] of Object.entries(files)) {
    const p = join(root, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
};
const PROGRAM = (ws) => ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. P.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.', ...ws, '       PROCEDURE DIVISION.', '           GOBACK.', ''].join('\n');

// A copybook that COPYs the next twice doubles at every level: thirty levels is a billion copies.
test('a COPY that doubles at every level stops at a cap, and the coverage says so', () => {
  const files = { 'P.cbl': PROGRAM(['       COPY L0.']) };
  for (let i = 0; i < 30; i++) files[`L${i}.cpy`] = i === 29 ? '       01 X PIC X.\n' : `       COPY L${i + 1}.\n       COPY L${i + 1}.\n`;
  const root = tree(files);
  const idx = buildFileIndex(root);
  const t = Date.now();
  const r = parseSource(files['P.cbl'], join(root, 'P.cbl'), { format: 'fixed', fileIndex: idx.index, includeDirs: idx.copyDirs, mainDir: root });
  assert.ok(Date.now() - t < 20000, 'the parse finished');
  assert.ok(r.copies.some((c) => c.status === 'expansion-limit'));
  const inv = inventory(root);
  assert.ok(inv.summary.copiesOverLimit > 0);
  assert.equal(inv.summary.coverageIncomplete, true);
});

test('REPLACING that doubles at every level of a nest does not compound: an outer COPY leaves the words an inner one produced', () => {
  const files = { 'P.cbl': PROGRAM(['       COPY L0 REPLACING ==ZZ== BY ==ZZ ZZ==.']) };
  for (let i = 0; i < 30; i++) files[`L${i}.cpy`] = i === 29 ? '       01 V PIC X VALUE ZZ.\n' : `       COPY L${i + 1} REPLACING ==ZZ== BY ==ZZ ZZ==.\n`;
  const root = tree(files);
  const t = Date.now();
  const inv = inventory(root);
  assert.ok(Date.now() - t < 20000, `took ${Date.now() - t} ms`);
  assert.ok(!inv.summary.copiesOverLimit);
  assert.equal(inv.summary.coverageIncomplete, false);
});

test('REPLACING that multiplies every word of a copybook stops at a cap, and the coverage says so', () => {
  const tens = `           ${Array(10).fill('ZZ').join(' ')}`;
  const root = tree({
    'P.cbl': PROGRAM(['       COPY L0 REPLACING ==ZZ== BY ==', tens, tens, tens, '           ZZ==.']),
    'L0.cpy': `       01 V PIC X VALUE\n${`${tens}\n`.repeat(2000)}           .\n`,
  });
  const t = Date.now();
  const inv = inventory(root);
  assert.ok(Date.now() - t < 20000, `took ${Date.now() - t} ms`);
  assert.ok(inv.summary.copiesOverLimit > 0);
  assert.equal(inv.summary.coverageIncomplete, true);
});

test('a REPLACE applies to the source after it until the next one, so thirty do not compound, and OFF ends it', () => {
  const src = (ws) => PROGRAM([...ws, '       01 A PIC X(FSIZE).', '       01 V PIC X VALUE ZZ.']);
  const doubling = Array.from({ length: 30 }, (_, i) => ['       REPLACE ==ZZ== BY ==ZZ ZZ==.', `       01 F${i} PIC X.`]).flat();
  const t = Date.now();
  parseSource(src(doubling), 'P.cbl', { format: 'fixed' });
  assert.ok(Date.now() - t < 5000, `took ${Date.now() - t} ms`);
  const size = (ws) => parseSource(src(ws), 'P.cbl', { format: 'fixed' }).programs[0].items.find((i) => i.name === 'A').size;
  assert.equal(size(['       REPLACE ==FSIZE== BY ==80==.']), 80);
  assert.notEqual(size(['       REPLACE ==FSIZE== BY ==80==.', '       01 B PIC X.', '       REPLACE OFF.']), 80);
});

test('a long crafted comment or in-stream line is read in linear time', () => {
  const n = 50000;
  const root = tree({
    'H.cbl': ['      * disregard' + ' '.repeat(n) + 'x', '      * curl ' + '&'.repeat(n), '      * ' + 'curl '.repeat(n / 5), ''].join('\n'),
    'J.jcl': ["//J JOB (X),'T'", '//S1 EXEC PGM=IKJEFT01', '//SYSTSIN DD *', ' PASSPHRASE' + '\t'.repeat(n) + '!', '/*', ''].join('\n'),
  });
  const t = Date.now();
  scanAll(root, { only: ['hidden', 'jcl'] });
  assert.ok(Date.now() - t < 5000, `took ${Date.now() - t} ms`);
});

// The JCL cousin of the COPY above: each SET doubles the symbol before it.
test('JCL symbols that double at every SET stop at the length JCL allows', () => {
  const lines = ["//J JOB (X),'T'", '// SET A0=XX'];
  for (let i = 1; i <= 40; i++) lines.push(`// SET A${i}=&A${i - 1}&A${i - 1}`);
  lines.push('//S1 EXEC PGM=IEFBR14,PARM=&A40', '');
  const t = Date.now();
  const r = parseJcl(lines.join('\n'), 'J.jcl');
  assert.ok(Date.now() - t < 2000, `took ${Date.now() - t} ms`);
  assert.ok(JSON.stringify(r).length < 100000, 'nothing grew');
  assert.ok(r.diags.some((d) => /more than JCL allows/.test(d.text)));
});

test('a fingerprint does not depend on the secret on the flagged line', () => {
  const job = (secret) => ['//J JOB (X),\'T\'', "//S1 EXEC PGM=FTP,PARM='host.example.com (EXIT'", '//INPUT DD *', `USER01 ${secret}`, 'QUIT', '/*', '//S2 EXEC PGM=IKJEFT01',
    '//SYSTSIN DD *', `  LOGON USER01 PASSWORD(${secret})`, '/*', ''].join('\n');
  const prints = (secret) => scanAll(tree({ 'J.jcl': job(secret) }), { only: ['jcl'] }).findings
    .filter((f) => f.rule === 'jcl-instream-credential').map((f) => f.fingerprint).sort();
  const a = prints('SECRET01');
  assert.ok(a.length >= 2, 'both credentials are reported');
  assert.deepEqual(prints('OTHERPW9'), a, 'the password is not an input to the hash');
});

test('a fingerprint of a long crafted line is computed in linear time, and still masks what it must', () => {
  const n = 100000;
  const lines = ['x', 'USERID=(' + ' '.repeat(n), 'PASS '.repeat(n / 5), 'PASS=\'' + 'a'.repeat(n)];
  const root = tree({ 'build.xml': lines.join('\n') + '\n' });
  const findings = [2, 3, 4].map((line) => ({ rule: 'x', path: 'build.xml', line }));
  const t = Date.now();
  stampFingerprints(findings, { root });
  assert.ok(Date.now() - t < 3000, `took ${Date.now() - t} ms`);
  const print = (secret) => {
    const r = tree({ 'P.cbl': PROGRAM([`       01 WS-PASSWORD PIC X(8) VALUE '${secret}'.`]) });
    const f = [{ rule: 'x', path: 'P.cbl', line: 5 }];
    stampFingerprints(f, { root: r });
    return f[0].fingerprint;
  };
  assert.equal(print('SECRET01'), print('OTHERPW9'));
});

test('a finding names the verb, not the rest of an in-stream line or a literal', () => {
  const root = tree({
    'J.jcl': ['//J JOB (X),\'T\'', '//S1 EXEC PGM=IDCAMS', '//SYSIN DD *', '  REPRO INFILE(A) OUTFILE(B) KEY=HUNTER2SECRET REPLACE', '/*', ''].join('\n'),
    'E.cbl': ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. E.', '       PROCEDURE DIVISION.', "           ENTRY 'NOT A NAME HUNTER2SECRET'.", '           GOBACK.', ''].join('\n'),
  });
  const r = scanAll(root, { only: ['jcl', 'opaque'] });
  const out = JSON.stringify(r.findings);
  assert.ok(r.findings.some((f) => f.rule === 'jcl-instream-destructive'), 'the REPRO is reported');
  assert.ok(r.findings.some((f) => f.rule === 'opaque-alternate-entry'), 'the ENTRY is reported');
  assert.equal(out.includes('HUNTER2SECRET'), false);
});

test('a version range is checked in linear time', () => {
  const t = Date.now();
  versionRangeProblems('1' + '.1'.repeat(64000) + '!');
  assert.ok(Date.now() - t < 2000, `took ${Date.now() - t} ms`);
});

// Every set can meet input its author did not imagine. When one throws, the others have still run.
test('a rule set that throws is reported as not having run, and the other sets report as usual', () => {
  const job = ['//J JOB (X),\'T\'', '//S1 EXEC PGM=IKJEFT01', '//SYSTSIN DD *', '  LOGON USER01 PASSWORD(SECRET01)', '/*', ''].join('\n');
  const root = tree({ 'a/J.jcl': job, 'b/J.jcl': job });
  const priv = REGISTRY.find((s) => s.name === 'priv');
  const real = priv.scan;
  priv.scan = () => { throw new Error(`bad input \x1b]52;c;aGk=\x07${'x'.repeat(500)}`); };
  try {
    for (const r of [scanAll(join(root, 'a')), scanAll(root, { repos: ['a', 'b'] })]) {
      assert.ok(r.findings.some((f) => f.rule === 'jcl-instream-credential'), 'the jcl set still reports');
      const s = r.summary.setsIncomplete.filter((x) => x.set === 'priv');
      assert.equal(s.length, r.summary.repos || 1);
      for (const x of s) {
        assert.equal(x.kind, 'coverage');
        assert.match(x.why, /stopped on an error/);
        assert.equal(/[\x00-\x1f]/.test(x.why), false, 'no control characters');
        assert.ok(x.why.length < 320, 'the message is cut');
      }
      assert.equal(r.summary.coverageIncomplete, true);
      assert.ok(toSarif(r).runs[0].invocations[0].toolExecutionNotifications.some((n) => n.properties?.set === 'priv'));
    }
  } finally { priv.scan = real; }
});

// The site file, the baseline and the packs the site names come from the tree too.
test('a site file that is not an object, or will not parse, is a problem the report carries', () => {
  assert.match(loadSite(tree({ 'cobolwork.site.json': 'null' })).problems.join(' '), /not a JSON object/);
  const bad = loadSite(tree({ 'cobolwork.site.json': '\x1b]0;owned\x07{' })).problems.join(' ');
  assert.match(bad, /not readable as JSON/);
  assert.equal(/[\x00-\x1f]/.test(bad), false);
});

test('a production path glob matches in linear time, and a ? in it is one character', () => {
  const site = { productionJobPaths: ['?rod/*.jcl', `${'*a'.repeat(12)}*b`], nonProductionJobPaths: [] };
  assert.equal(classifyPath(site, 'prod/PAY.jcl'), 'production');
  assert.equal(classifyPath(site, 'prod/sub/PAY.jcl'), 'undecided');
  const t = Date.now();
  assert.equal(classifyPath(site, 'a'.repeat(4000)), 'undecided');
  assert.ok(Date.now() - t < 2000, `took ${Date.now() - t} ms`);
});

test('a site file or a baseline in the tree that links out of it is not read', () => {
  const outside = mkdtempSync(join(tmpdir(), 'cw-outside-'));
  writeFileSync(join(outside, 'site.json'), JSON.stringify({ productionQualifiers: ['OUTSIDEQ'] }));
  writeFileSync(join(outside, 'credentials'), '[default]\naws_secret_access_key = X');
  const root = tree({ 'P.cbl': PROGRAM([]) });
  symlinkSync(join(outside, 'site.json'), join(root, 'cobolwork.site.json'));
  symlinkSync(join(outside, 'credentials'), join(root, 'cobolwork.baseline.json'));
  const site = loadSite(root);
  assert.deepEqual(site.productionQualifiers, []);
  assert.match(site.problems.join(' '), /leads outside the tree/);
  const base = loadBaseline(root);
  assert.deepEqual(base.entries, []);
  assert.match(base.problems.join(' '), /leads outside the tree/);
  assert.equal(base.problems.join(' ').includes('aws'), false);
});

test('a suppression lapses by time in whatever offset it is written, and a date not in ISO 8601 is refused', () => {
  const f = { fingerprint: 'a'.repeat(32), rule: 'r1', path: 'P.cbl', line: 1, sev: 'high', evidence: 'defect' };
  const e = { fingerprint: f.fingerprint, rule: 'r1', action: 'accept', reason: 'x', who: 'y', at: '2026-01-01T00:00:00Z', expires: '2026-01-01T12:00-12:00' };
  const r = applyBaseline({ findings: [f], summary: {} }, { path: 'b', source: 'explicit', entries: [e], problems: [] }, { now: '2026-01-01T13:00:00.000Z' });
  assert.equal(r.suppressed.length, 1, 'it has eleven hours to run');
  assert.match(validateEntry({ ...e, expires: 'Tue, 01 Jan 2019 00:00:00 GMT' }).join(' '), /ISO 8601/);
});

test('a pack is found by name in the pack directory, never by a path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-pack-'));
  writeFileSync(join(dir, 'evil.json'), JSON.stringify({ product: 'x', validation: { corpus: { repositories: 500 } }, programs: ['PAYROLL1'], rules: [] }));
  const packDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'rules', 'packs');
  const r = loadPacks([relative(packDir, join(dir, 'evil'))]);
  assert.deepEqual(r.loaded, []);
  assert.match(r.problems.join(' '), /no pack named/);
});

// A pack pattern runs over every in-stream line, and a line is as long as the tree makes it.
test('every shipped pack pattern runs in time linear in the line', () => {
  const packDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'rules', 'packs');
  const packs = loadPacks(['broadcom', 'connectdirect', 'controlm'], { allowUnvalidated: true, packDir }).loaded;
  assert.equal(packs.length, 3);
  const n = 40000;
  const lines = [' '.repeat(n) + '!', 'X'.repeat(n) + '!', 'SNODEID=(' + ','.repeat(n), ' SIGNON USERID=(' + ','.repeat(n), 'TSS ADD ' + ' '.repeat(n)];
  for (const p of packs) {
    for (const r of p.rules) {
      for (const pattern of [r.pattern, r.setsContextPattern].filter(Boolean)) {
        const re = new RegExp(pattern, r.flags || 'i');
        const t = Date.now();
        for (const l of lines) re.test(l);
        assert.ok(Date.now() - t < 500, `${p.name}:${r.id} took ${Date.now() - t} ms`);
      }
    }
  }
});

test('a pack whose rules or programs have the wrong shape is a problem, not a crash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-packs-'));
  writeFileSync(join(dir, 'odd.json'), JSON.stringify({ rules: { a: 1 }, validation: { corpus: { repositories: 1 } } }));
  writeFileSync(join(dir, 'odd2.json'), JSON.stringify({ rules: [], programs: 'X', validation: { corpus: { repositories: 1 } } }));
  const r = loadPacks(['odd', 'odd2'], { packDir: dir });
  assert.deepEqual(r.loaded, []);
  assert.equal(r.problems.length, 2);
});

test('a diff says when the site file or the baseline changed, which moves findings with no source changed', () => {
  const base = tree({ 'P.cbl': PROGRAM([]), 'cobolwork.site.json': JSON.stringify({ productionQualifiers: ['PROD'] }) });
  const head = tree({ 'P.cbl': PROGRAM([]), 'cobolwork.site.json': JSON.stringify({ systemNames: ['SYSA'] }),
    'cobolwork.baseline.json': JSON.stringify({ entries: [{ fingerprint: 'a'.repeat(32), rule: 'r1', action: 'accept', reason: 'x', who: 'y', at: '2026-01-01', expires: '2099-01-01' }] }) });
  const d = diffTrees(base, head);
  const change = Object.fromEntries((d.summary.configurationChanged || []).map((c) => [c.file, c.change]));
  assert.match(change['cobolwork.site.json'] || '', /productionQualifiers -PROD/);
  assert.match(change['cobolwork.baseline.json'] || '', /1 entry added, 1 of them suppressing/);
  const notes = toSarif({ ...d, findings: [...d.findings, ...d.introduced] }).runs[0].invocations[0].toolConfigurationNotifications || [];
  assert.equal(notes.filter((n) => n.descriptor.id === 'cobolwork/configuration-changed').length, 2);
});

test('a SARIF location is a URI reference, and a message cannot write a link', () => {
  const r = { summary: {}, findings: [{ rule: 'jcl-instream-credential', path: 'dir #1/50%.jcl', line: 3, detail: 'see [here](https://example.com)', sev: 'high' }] };
  const res = toSarif(r).runs[0].results[0];
  assert.equal(res.locations[0].physicalLocation.artifactLocation.uri, 'dir%20%231/50%25.jcl');
  assert.equal(res.message.text, 'see \\[here\\](https://example.com)');
});

