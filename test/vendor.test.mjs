import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanVendor, VENDOR_RULES } from '../lib/sets/vendor.mjs';
import { loadPacks, readPack, validationOf, availablePacks, packProblems, SCOPES } from '../lib/packs.mjs';
import { ALL_RULES, RULE_SETS } from '../lib/scan.mjs';
import './pin-machine.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-vendor-'));
  for (const [name, text] of Object.entries(files)) {
    const p = join(root, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, typeof text === 'string' ? text : JSON.stringify(text, null, 1));
  }
  return root;
};

// The validation gate is tested against a pack that is deliberately unvalidated and stays that
// way, not against a shipped one. These three tests used to name `broadcom`, so the day it was
// measured over a corpus - the exact thing the gate exists to encourage - they failed, and not
// because anything had broken. A fixture must not be able to graduate.
const FIXTURE_PACKS = join(HERE, 'fixtures', 'packs');

const EXAMPLE_JOB = [
  '//SECADM   JOB (ACCT)',
  '//STEP010  EXEC PGM=IKJEFT01',
  '//SYSTSIN  DD *',
  '  INSERT EXAMPLE NAME(BATCH OPERATOR)',
  '/*',
].join('\n');

const ACF2_JOB = [
  '//SECADM   JOB (ACCT)',
  '//STEP010  EXEC PGM=IKJEFT01',
  '//SYSTSIN  DD *',
  '  SET LID',
  '  INSERT BATCHOP NAME(BATCH OPERATOR)',
  '/*',
].join('\n');

test('a pack nobody asked for does not load, so a shop without the product sees nothing', () => {
  const root = tree({ 'j/SECADM.jcl': ACF2_JOB });
  const r = scanVendor(root);
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.summary.packsLoaded, []);
  assert.equal(r.summary.setIncomplete, false, 'not asking for a pack is not incomplete coverage');
});

test('an unvalidated pack is refused, and the refusal says what is unknown', () => {
  const root = tree({
    'cobolwork.site.json': { vendorPacks: ['unmeasured'], productionQualifiers: ['PROD'] },
    'j/SECADM.jcl': EXAMPLE_JOB,
  });
  const r = scanVendor(root, { packDir: FIXTURE_PACKS });
  assert.deepEqual(r.findings, []);
  assert.equal(r.summary.packsRefused.length, 1);
  assert.match(r.summary.packsRefused[0].why, /neither a corpus measurement nor a practitioner review/);
  assert.equal(r.summary.setIncomplete, true, 'a pack asked for and not loaded is not full coverage');
});

test('accepting the risk loads it, and every missing half is still named', () => {
  const root = tree({
    'cobolwork.site.json': { vendorPacks: ['unmeasured'], allowUnvalidatedPacks: true, productionQualifiers: ['PROD'] },
    'j/SECADM.jcl': EXAMPLE_JOB,
  });
  const r = scanVendor(root, { packDir: FIXTURE_PACKS });
  assert.deepEqual(r.summary.packsLoaded, ['unmeasured']);
  assert.equal(r.summary.packCaveats.length, 2, 'corpus and practitioner are separate claims');
  assert.ok(r.summary.packCaveats.some((c) => /no corpus measurement/.test(c)));
  assert.ok(r.summary.packCaveats.some((c) => /no practitioner review/.test(c)));
  assert.equal(r.summary.setIncomplete, true, 'loading on partial validation is still partial');

  const f = r.findings.filter((x) => x.rule === 'vendor-privileged-command');
  assert.equal(f.length, 1);
  assert.equal(f[0].packRule, 'ex-privileged-insert');
  assert.equal(f[0].sev, 'high', 'severity comes from the pack rule, not the rule set');
  assert.match(f[0].detail, /Example/);
});

// Corpus measurement and practitioner review answer different questions, and neither implies the
// other. A pack measured over a thousand repositories is quiet; that says nothing about whether
// its risk statements are true.
test('the two forms of validation are tracked separately', () => {
  const base = readPack('unmeasured', FIXTURE_PACKS);
  assert.equal(validationOf(base).any, false);
  assert.equal(validationOf(base).missing.length, 2);

  const measured = { ...base, validation: { corpus: { repositories: 800, firedOn: 3 } } };
  const v1 = validationOf(measured);
  assert.ok(v1.any);
  assert.equal(v1.missing.length, 1);
  assert.match(v1.missing[0], /no practitioner review/);

  const reviewed = { ...base, validation: { practitioner: { by: 'someone', date: '2026-09-20' } } };
  const v2 = validationOf(reviewed);
  assert.equal(v2.missing.length, 1);
  assert.match(v2.missing[0], /no corpus measurement/);

  const both = { ...base, validation: { corpus: { repositories: 800, firedOn: 3 }, practitioner: { by: 'someone', date: '2026-09-20' } } };
  assert.deepEqual(validationOf(both).missing, []);
});

test('a pack that does not exist is a problem, not a silence', () => {
  const root = tree({
    'cobolwork.site.json': { vendorPacks: ['nosuchpack'], productionQualifiers: ['PROD'] },
    'j/SECADM.jcl': ACF2_JOB,
  });
  const r = scanVendor(root);
  assert.match(r.summary.problems[0], /no pack named 'nosuchpack'/);
  assert.equal(r.summary.setIncomplete, true);
});

test('a job with no vendor commands produces nothing even with the pack loaded', () => {
  const root = tree({
    'cobolwork.site.json': { vendorPacks: ['broadcom'], allowUnvalidatedPacks: true, productionQualifiers: ['PROD'] },
    'j/ORD.jcl': '//J JOB (X)\n//S EXEC PGM=IDCAMS\n//SYSIN DD *\n  LISTCAT ENTRIES(A.B)\n/*\n',
  });
  assert.deepEqual(scanVendor(root).findings, []);
});

test('the pack ships every rule with a rationale and a severity', () => {
  const pack = readPack('broadcom');
  assert.ok(pack.rules.length >= 8);
  for (const r of pack.rules) {
    assert.ok(r.id && r.verb && r.pattern && r.risk, `${r.id} is complete`);
    assert.ok(['crit', 'high', 'med', 'low', 'info'].includes(r.severity), r.id);
    assert.ok(r.rationale.length >= 60, `${r.id} says why, at length`);
    assert.doesNotThrow(() => new RegExp(r.pattern), `${r.id} compiles`);
  }
});

test('the vendor set is registered and catalogued', () => {
  assert.ok(RULE_SETS.includes('vendor'));
  assert.ok(availablePacks().includes('broadcom'));
  for (const id of Object.keys(VENDOR_RULES)) assert.ok(ALL_RULES[id], `${id} is in ALL_RULES`);
});

// A rule scoped to something no scanner reads can never fire, and a rule that never fires is
// indistinguishable from one that is admirably quiet. cd-batch-interface shipped that way once:
// it matched the batch interface program while scoped to in-stream data, where a program name
// never appears. The scope is now checked rather than trusted.
test('every rule in every pack is scoped to something a scanner reads', () => {
  for (const name of availablePacks()) {
    const pack = readPack(name);
    assert.deepEqual(packProblems(pack), [], `${name} has no unreachable or malformed rules`);
    for (const r of pack.rules) {
      assert.ok((r.appliesTo || []).every((s) => SCOPES.includes(s)), `${name}:${r.id}`);
    }
  }
});

test('a rule scoped to nothing a scanner reads is refused, not loaded quietly', () => {
  const problems = packProblems({ name: 'x', rules: [{ id: 'r', pattern: 'A', appliesTo: ['cobol-call'] }] });
  assert.match(problems[0], /unknown scope 'cobol-call'/);
});

test('the step scope matches the program a step runs', () => {
  const root = tree({
    'cobolwork.site.json': { vendorPacks: ['connectdirect'], allowUnvalidatedPacks: true, productionQualifiers: ['PROD'] },
    'j/XFER.jcl': '//X JOB (A)\n//S EXEC PGM=DMBATCH\n//SYSIN DD *\n  STEP01 RUN TASK (PGM=BPXBATCH)\n/*\n',
  });
  const f = scanVendor(root).findings;
  assert.ok(f.some((x) => x.packRule === 'cd-batch-interface'), 'the EXEC statement is read');
  assert.ok(f.some((x) => x.packRule === 'cd-run-task'), 'and the stream below it');
});

test('remote execution through a transfer product is critical', () => {
  const root = tree({
    'cobolwork.site.json': { vendorPacks: ['connectdirect'], allowUnvalidatedPacks: true, productionQualifiers: ['PROD'] },
    'j/XFER.jcl': [
      '//X JOB (A)', '//S EXEC PGM=DMBATCH', '//SYSIN DD *',
      '  SIGNON USERID=(BATCHOP,HUNTER26)',
      '  STEP01 RUN TASK (PGM=BPXBATCH)',
      '  STEP02 RUN JOB (DSN=PROD.JCLLIB(X))',
      '/*', '',
    ].join('\n'),
  });
  const byRule = Object.fromEntries(scanVendor(root).findings.map((f) => [f.packRule, f.sev]));
  assert.equal(byRule['cd-run-task'], 'crit');
  assert.equal(byRule['cd-run-job'], 'crit');
  assert.equal(byRule['cd-signon-password'], 'crit', 'a password in the process text is a credential in the repository');
});

test('a scheduler pack reads what is committed and says what is not', () => {
  const pack = readPack('controlm');
  assert.match(pack.coverage, /NOT covered: the scheduling definitions themselves/,
    'most of a scheduler’s authority is outside any repository, and the pack says so');
  const root = tree({
    'cobolwork.site.json': { vendorPacks: ['controlm'], allowUnvalidatedPacks: true, productionQualifiers: ['PROD'] },
    'j/SCHED.jcl': '//S JOB (A)\n//E EXEC PGM=CTMAPI\n//SYSIN DD *\n  FORCE JOB PAYCALC\n/*\n',
  });
  const rules = scanVendor(root).findings.map((f) => f.packRule).sort();
  assert.deepEqual(rules, ['ctm-order-force', 'ctm-utility-step']);
});

test('an info pack rule is context, though its rule id is a construct', () => {
  const root = tree({
    'cobolwork.site.json': { vendorPacks: ['controlm'], allowUnvalidatedPacks: true, productionQualifiers: ['PROD'] },
    'j/SCHED.jcl': '//S JOB (A)\n//E EXEC PGM=CTMAPI\n//SYSIN DD *\n  FORCE JOB PAYCALC\n/*\n',
  });
  const by = Object.fromEntries(scanVendor(root).findings.map((f) => [f.packRule, `${f.sev}/${f.evidence}`]));
  assert.equal(by['ctm-utility-step'], 'info/context');
  assert.equal(by['ctm-order-force'], 'high/construct');
  assert.equal(VENDOR_RULES['vendor-privileged-command'].evidence, 'construct');
});
