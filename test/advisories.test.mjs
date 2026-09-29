import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareVersions, versionMatches, advisoriesFor, ADVISORIES } from '../lib/advisories.mjs';
import { isKnownExploited, kevAge, KEV } from '../lib/kev.mjs';
import { scanBuild, BUILD_RULES } from '../lib/sets/build.mjs';
import { ALL_RULES, RULE_SETS } from '../lib/scan.mjs';
import './pin-machine.mjs';

const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-build-'));
  for (const [name, text] of Object.entries(files)) {
    const p = join(root, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
};

test('versions compare by component, with a numeric release outranking its own pre-release', () => {
  assert.equal(compareVersions('3.2', '3.2.0'), 0, 'missing components are zero');
  assert.equal(compareVersions('2.2', '3.0') < 0, true);
  assert.equal(compareVersions('3.10', '3.9') > 0, true, 'components are numbers, not decimals');
  assert.equal(compareVersions('3.1', '3.1-rc1') > 0, true);
});

test('a range is matched only in a form the rule can evaluate', () => {
  assert.ok(versionMatches('2.2', '2.2'));
  assert.ok(!versionMatches('2.2.1', '2.2'), 'an exact pin does not match a later patch');
  assert.ok(versionMatches('2.1', '[2.0,2.2]'));
  assert.ok(!versionMatches('2.2', '[2.0,2.2)'), 'a half-open interval excludes its end');
  assert.ok(versionMatches('1.9', '<=2.2 || 4.0'));
  assert.ok(versionMatches('4.0', '<=2.2 || 4.0'));
  assert.ok(!versionMatches('3.0', '<=2.2 || 4.0'));
  assert.ok(!versionMatches('2.2', 'anything older'), 'an unevaluable range matches nothing');
});

// Every row in this file was retrieved from NVD. These assertions are the offline half of the
// check; diag/refresh-advisories.mjs is the online half and resolves each identifier for real.
test('the advisory file is traceable, and claims exactly what its source claims', () => {
  assert.ok(ADVISORIES.advisories.length > 0);
  for (const a of ADVISORIES.advisories) {
    assert.match(a.id, /^CVE-\d{4}-\d{4,}$/, `${a.id} is shaped like a CVE identifier`);
    assert.match(a.source.url, /^https:\/\/nvd\.nist\.gov\/vuln\/detail\/CVE-/, `${a.id} links to its advisory`);
    assert.ok(a.source.url.endsWith(a.id), `${a.id} links to its own record`);
    assert.equal(a.summary, a.source.quote, `${a.id} summarises by quoting, so nothing is paraphrased into it`);
    assert.equal(a.fixedIn, null, `${a.id}: NVD records no fixed version, and a guess would be a fabrication`);
  }
});

test('the advisory file states what it has not looked at', () => {
  // A clean result over a product nobody searched is not a clean result, so the gaps are named.
  for (const product of ['gnucobol', 'ibm-enterprise-cobol', 'opentext-cobol', 'cics-ts', 'db2-zos',
    'cics-transaction-gateway', 'zowe', 'db2-connect', 'ibm-mq', 'che4z']) {
    assert.ok(ADVISORIES.coverage[product], `${product} says what is known about it`);
  }
  assert.match(ADVISORIES.coverage['ibm-enterprise-cobol'], /not an absence of defects/);
});

test('KEV answers set membership and knows how old it is', () => {
  assert.ok(isKnownExploited('CVE-2021-44228'), 'log4shell is in the catalogue');
  assert.ok(!isKnownExploited('CVE-0000-0000'));
  assert.equal(KEV.mainframeEntries, 0);
  const age = kevAge(new Date(KEV.dateReleased + 'T00:00:00Z'));
  assert.equal(age.days, 0);
  assert.equal(kevAge(new Date('2099-01-01')).stale, true, 'a snapshot this old cannot answer the question');
});

test('a build pinning an affected compiler is a finding; a later one is not', () => {
  const bad = tree({ 'Dockerfile': 'FROM debian:12\nARG GNUCOBOL_VERSION=2.2\nRUN build.sh\n' });
  const f = scanBuild(bad).findings;
  assert.equal(f.length, 1);
  assert.equal(f[0].rule, 'build-pins-vulnerable-compiler');
  assert.match(f[0].detail, /6 published advisories/);
  assert.match(f[0].detail, /CVE-2019-14468/);
  assert.equal(f[0].related.length, 6, 'the finding carries every advisory it rests on');

  const ok = tree({ 'Dockerfile': 'FROM debian:12\nARG GNUCOBOL_VERSION=3.2\nRUN build.sh\n' });
  assert.deepEqual(scanBuild(ok).findings, []);
});

test('a pin is recognised however the build writes it', () => {
  for (const [name, text] of [
    ['Dockerfile', 'FROM ghcr.io/example/gnucobol:2.2'],
    ['Makefile', 'GNUCOBOL_VERSION = 2.2'],
    ['.tool-versions', 'gnucobol 2.2'],
    ['build.sh', 'wget https://example.invalid/gnucobol-2.2.tar.gz'],
    ['.github/workflows/ci.yml', 'jobs:\n  b:\n    steps:\n      - run: apt-get install -y gnucobol=2.2'],
  ]) {
    const root = tree({ [name]: text });
    assert.equal(scanBuild(root).findings.length, 1, `${name}: ${text}`);
  }
});

test('a version number that is not a compiler pin is not a finding', () => {
  const root = tree({
    'Makefile': 'VERSION = 2.2\nCFLAGS = -O2\n',
    'README.md': 'We used to build against gnucobol 2.2 but no longer do.',
  });
  // README is not a build file, and a bare VERSION names no product.
  assert.deepEqual(scanBuild(root).findings, []);
});

test('the scan reports the KEV snapshot it judged against, and what it never searched', () => {
  const root = tree({ 'Dockerfile': 'ARG GNUCOBOL_VERSION=2.2' });
  const s = scanBuild(root).summary;
  assert.equal(s.kevCatalogVersion, KEV.catalogVersion);
  assert.equal(typeof s.kevAgeDays, 'number');
  assert.ok(s.advisoryCoverage['opentext-cobol'], 'a product nobody searched is named in the summary');
});

test('the build set is registered and its rules are in the catalogue of all rules', () => {
  assert.ok(RULE_SETS.includes('build'));
  for (const id of Object.keys(BUILD_RULES)) assert.ok(ALL_RULES[id], `${id} is in ALL_RULES`);
});

test('an advisory listed in KEV escalates the finding above a merely published one', () => {
  // Proved against the rule rather than against data: no mainframe CVE is in KEV today, which is
  // itself recorded in rules/kev-ids.json. The escalation must still work when one appears.
  assert.equal(BUILD_RULES['build-pins-exploited-compiler'].sev, 'crit');
  assert.equal(BUILD_RULES['build-pins-vulnerable-compiler'].sev, 'high');
  assert.ok(ADVISORIES.advisories.every((a) => !isKnownExploited(a.id)),
    'if this fails, a compiler advisory has entered KEV and the crit path now has live coverage');
});

test('a component the estate talks to the mainframe through is pinned, found and reported as one', () => {
  const r = scanBuild(tree({
    'package.json': ['{', '  "dependencies": {', '    "@zowe/cli": "^7.18.0",', '    "@zowe/imperative": "5.7.0"', '  }', '}'].join('\n'),
    'pom.xml': ['<project><dependencies><dependency>', '<groupId>com.ibm.ctg</groupId>', '<artifactId>ctgclient</artifactId>',
      '<version>9.3</version>', '</dependency></dependencies></project>'].join('\n'),
    Dockerfile: 'FROM ghcr.io/example/gnucobol:3.9\n',
  }));
  const of = (rule) => r.findings.filter(f => f.rule === rule).map(f => f.path + ':' + f.line).sort();
  assert.deepEqual(of('build-pins-vulnerable-component'), ['package.json:3', 'package.json:4', 'pom.xml:4']);
  // The compiler in the same tree is a later one than any advisory names, so it is not a finding,
  // and a component never reports under the compiler's rule: who acts on each is a different person.
  assert.deepEqual(of('build-pins-vulnerable-compiler'), []);
  assert.equal(r.summary.pinsFound, 4);
});

test('what the sweep found and did not load is written down, not left as silence', () => {
  assert.match(ADVISORIES.coverage['db2-connect'], /17 advisories found and none loaded/);
  assert.match(ADVISORIES.coverage['ibm-mq'], /48 advisories found and none loaded/);
  assert.match(ADVISORIES.coverage.zowe, /no CVE identifier cannot be loaded/);
});

test('a Maven version written as a property is the version that is pinned', () => {
  const r = scanBuild(tree({
    'pom.xml': ['<project>', '<properties><cics.tg.version>9.3.0</cics.tg.version></properties>', '<dependencies><dependency>',
      '<groupId>com.ibm.ctg</groupId>', '<artifactId>ctgclient</artifactId>', '<version>${cics.tg.version}</version>',
      '</dependency></dependencies></project>'].join('\n'),
  }));
  assert.deepEqual(r.findings.map(f => [f.rule, f.line]), [['build-pins-vulnerable-component', 6]]);
  assert.match(r.findings[0].detail, /cics-transaction-gateway 9\.3\.0/);
});
