// SPDX-License-Identifier: AGPL-3.0-or-later
// What the build pins, and whether anyone has published an advisory against it.
//
// A crafted source file in a pull request targets the compiler that CI runs on it. Every GnuCOBOL
// advisory on record is exactly that shape - "via crafted COBOL source code" - so the version a
// repository's build pins is part of its attack surface, and it is written down in files no COBOL
// rule set reads.
import { inScope, relPath } from '../sources.mjs';
import { byText } from '../kernel/findings.mjs';
import { report } from '../kernel/ruleset.mjs';
import { treeFor, noteUnread } from '../kernel/source-tree.mjs';
import { eachWithinMemory } from '../kernel/memory.mjs';
import { advisoriesFor, advisoryFeedPaths, loadAdvisoryFeed, COVERAGE } from '../advisories.mjs';
import { isKnownExploited, kevAge } from '../kev.mjs';
import { loadSite } from '../site.mjs';
import { basename } from 'node:path';


export const BUILD_RULES = {
  'build-pins-vulnerable-compiler': {
    sev: 'high', evidence: 'advisory', cwe: 'CWE-1395',
    text: 'The build pins a compiler version with a published advisory against it',
    impact: 'The build compiles every pull request with a compiler version a published advisory affects, so a crafted source file can exploit it in CI',
    remedy: 'Upgrade the pinned compiler to a fixed version, or pin one no listed advisory affects',
  },
  'build-pins-exploited-compiler': {
    sev: 'crit', evidence: 'advisory', cwe: 'CWE-1395',
    text: 'The build pins a compiler version with a vulnerability CISA lists as known to be exploited',
    impact: 'The pinned compiler has a vulnerability CISA lists as known to be exploited, and CI compiles untrusted source with it',
    remedy: 'Upgrade the pinned compiler to a fixed version now; this one is being exploited in the wild',
  },
  'site-declares-vulnerable-runtime': {
    sev: 'high', evidence: 'advisory', cwe: 'CWE-1395',
    text: 'The estate declares a runtime version with a published advisory against it',
    impact: 'The estate runs a runtime version a published advisory affects',
    remedy: "Upgrade the runtime to a fixed version, or apply the vendor's fix for the named advisory",
  },
  'build-pins-vulnerable-component': {
    sev: 'high', evidence: 'advisory', cwe: 'CWE-1395',
    text: 'The build pins a component version with a published advisory against it',
    impact: 'The build pins a component version a published advisory affects',
    remedy: 'Upgrade the pinned component to a fixed version, or pin one no listed advisory affects',
  },
  'build-pins-exploited-component': {
    sev: 'crit', evidence: 'advisory', cwe: 'CWE-1395',
    text: 'The build pins a component version with a vulnerability CISA lists as known to be exploited',
    impact: 'The pinned component has a vulnerability CISA lists as known to be exploited',
    remedy: 'Upgrade the pinned component to a fixed version now; this one is being exploited in the wild',
  },
};

// A compiler turns the source into what runs; a component is something the estate talks to the
// mainframe through. The advisory arithmetic is the same, the person who acts on it is not.
const COMPILERS = new Set(['gnucobol', 'opentext-cobol', 'ibm-enterprise-cobol']);

// Files that decide what the build runs. A repository states this in one of a small number of
// conventional places, and reading only those keeps the rule from matching prose in a README.
export function isBuildFile(path) {
  const name = basename(path);
  const p = path.replace(/\\/g, '/').toLowerCase();
  if (/^(dockerfile|containerfile)(\..+)?$/i.test(name)) return true;
  if (/^(gnu)?makefile$/i.test(name) || /\.mk$/i.test(name)) return true;
  if (/^(\.tool-versions|\.gnucobol-version|\.cobc-version)$/i.test(name)) return true;
  if (/^(jenkinsfile|azure-pipelines\.ya?ml|\.gitlab-ci\.ya?ml|docker-compose\.ya?ml)$/i.test(name)) return true;
  if (p.includes('/.github/workflows/') && /\.ya?ml$/i.test(name)) return true;
  if (/\.(sh|bash)$/i.test(name)) return true;
  // Where the off-mainframe half of the estate is pinned: the driver, gateway and tooling a COBOL
  // repository talks to the mainframe through.
  if (/^(package\.json|pom\.xml)$/i.test(name) || /^build\.gradle(\.kts)?$/i.test(name)) return true;
  return false;
}

// How a pinned version is written. Each pattern names the product, so a version number on its own
// is never a finding: this rule reports what the build pins, not every number in a Makefile.
const PINS = [
  // ARG GNUCOBOL_VERSION=3.2  /  gnucobol-version: 3.2  /  apt-get install gnucobol=3.2
  { product: 'gnucobol', re: /gnucobol[-_ ]?(?:version)?\s*[:=]+\s*["']?v?(\d+(?:\.\d+)+)/gi },
  // gnucobol-3.2.tar.gz, gnucobol_3.2_amd64.deb
  { product: 'gnucobol', re: /gnucobol[-_](\d+(?:\.\d+)+)[._-]/gi },
  // FROM ghcr.io/example/gnucobol:3.2
  { product: 'gnucobol', re: /from\s+\S*gnucobol\S*:v?(\d+(?:\.\d+)+)/gi },
  // .tool-versions: "gnucobol 3.2"
  { product: 'gnucobol', re: /^gnucobol\s+v?(\d+(?:\.\d+)+)\s*$/gim },

  // The OpenText line shares one version across Visual COBOL, COBOL Server, Enterprise Developer
  // and Enterprise Server, which is why an advisory against one names all of them.
  { product: 'opentext-cobol', re: /(?:visual[-_ ]?cobol|cobol[-_ ]?server|enterprise[-_ ](?:server|developer|test[-_ ]server))[-_ ]?(?:version)?\s*[:=]+\s*["']?v?(\d+(?:\.\d+)+)/gi },
  { product: 'opentext-cobol', re: /from\s+\S*(?:microfocus|opentext)\S*:v?(\d+(?:\.\d+)+)/gi },

  // "@zowe/cli": "^7.18.0" in package.json, or a CLI version pinned in a pipeline.
  { product: 'zowe', re: /"@zowe\/[\w-]+"\s*:\s*"[^\d"]*(\d+(?:\.\d+)+)/g },
  { product: 'zowe', re: /zowe[-_ ]?cli[-_ ]?(?:version)?\s*[:=]+\s*["']?v?(\d+(?:\.\d+)+)/gi },

  // ctgclient.jar is the gateway's client; Maven and Gradle name it beside its version.
  { product: 'cics-transaction-gateway', re: /ctgclient[-_](\d+(?:\.\d+)+)\.jar/gi },
  { product: 'cics-transaction-gateway', re: /com\.ibm\.ctg[\s\S]{0,200}?<version>\s*v?(\d+(?:\.\d+)+)/gi },
  { product: 'cics-transaction-gateway', re: /com\.ibm\.ctg:[\w-]+:v?(\d+(?:\.\d+)+)/gi },
  { product: 'cics-transaction-gateway', re: /from\s+\S*cics[-_]?transaction[-_]?gateway\S*:v?(\d+(?:\.\d+)+)/gi },
];

// Every product version the text pins, once each, with the text that pins it.
export function pinsIn(src) {
  const out = [];
  const seen = new Set();
  for (const { product, re } of PINS) {
    for (const m of src.matchAll(re)) {
      const key = `${product}@${m[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ product, version: m[1], text: m[0] });
    }
  }
  return out;
}

function withMavenProperties(src) {
  const block = src.match(/<properties>([\s\S]*?)<\/properties>/i);
  if (!block) return src;
  const props = new Map();
  for (const m of block[1].matchAll(/<([\w.-]+)>\s*([^<\s][^<]*?)\s*<\/\1>/g)) props.set(m[1], m[2]);
  return src.replace(/\$\{([\w.-]+)\}/g, (all, name) => (props.has(name) ? props.get(name) : all));
}

// A customer feed's rows are named as the customer's, never as published: their source is an
// extract nobody else can check.
const relatedOf = (a) => (a.feed ? { id: a.id, feed: a.feed.extract } : { id: a.id, url: a.source.url });
function fromFeeds(hits) {
  const byFeed = new Map();
  for (const a of hits) if (a.feed) { const k = `${a.feed.extract}, retrieved ${a.feed.retrieved}`; byFeed.set(k, [...(byFeed.get(k) || []), a.id]); }
  return [...byFeed].map(([k, ids]) => `; ${ids.sort(byText).join(', ')} ${ids.length === 1 ? 'is' : 'are'} from the customer feed ${k}`).join('');
}
// "Published" only when every advisory is: a customer extract is not.
const countOf = (hits) => { const p = hits.some((a) => a.feed) ? '' : 'published '; return hits.length === 1 ? (p ? 'has a published advisory' : 'has an advisory') : `has ${hits.length} ${p}advisories`; };
const feedSummary = (f) => ({ file: f.file, extract: f.extract, retrieved: f.retrieved, loaded: f.advisories.length, refused: f.refused.length, ...(f.problem ? { problem: f.problem } : {}) });
// What each loaded feed says it covered, after what the published record covers.
function withFeeds(coverage, feeds) {
  const out = { ...coverage };
  for (const f of feeds) {
    if (f.problem) continue;
    const products = new Set([...Object.keys(f.coverage), ...f.advisories.map((a) => a.product)]);
    for (const p of products) {
      const said = f.coverage[p] || `${f.advisories.filter((a) => a.product === p).length} advisories`;
      out[p] = `${out[p] ? `${out[p]}; ` : ''}customer feed ${f.extract}, retrieved ${f.retrieved}: ${said}`;
    }
  }
  return out;
}

export function scanBuild(root, opts = {}) {
  const site = loadSite(root, opts.site || null, opts.tree);
  const tree = treeFor(root, opts);
  const files = tree.list().filter(inScope(opts)).filter(isBuildFile);
  const findings = [];
  const age = kevAge();
  const feeds = advisoryFeedPaths(opts).map((p) => loadAdvisoryFeed(p, { root }));
  const extra = feeds.flatMap((f) => f.advisories);
  const stats = {
    filesScanned: 0, filesUnreadable: 0, pinsFound: 0,
    kevCatalogVersion: age.catalogVersion, kevAgeDays: age.days, kevStale: age.stale,
    // Which products this scan could have found anything for. A clean result over a product
    // nobody has searched advisories for is not a clean result.
    advisoryCoverage: withFeeds(COVERAGE, feeds),
    ...(feeds.length ? { advisoryFeeds: feeds.map(feedSummary) } : {}),
    runtimesDeclared: Object.keys(site.runtimeVersions || {}).length,
    // CICS and Db2 are not pinned in a build file - they are what the code runs on, not what
    // compiles it - so an advisory against them can only be acted on once the estate says which
    // version it runs. Without that declaration these advisories are inert, and the summary says
    // so rather than letting an empty result read as a clean one.
    runtimesNotDeclared: ['cics-ts', 'db2-zos', 'ibm-enterprise-cobol']
      .filter((p) => !(site.runtimeVersions || {})[p]),
  };

  // A feed asked for and not loaded, or a row the gate refused, is an advisory this scan was told to
  // check and did not.
  const notLoaded = feeds.flatMap((f) => (f.problem ? [`the advisory feed ${f.file} ${f.problem}`]
    : f.refused.length ? [`the advisory feed ${f.file} (${f.extract}) had ${f.refused.length} of ${f.refused.length + f.advisories.length} rows refused by the advisory gate, the first ${f.refused[0].id || 'unnamed'}: ${f.refused[0].problems[0]}`] : []));
  if (notLoaded.length) { stats.setIncomplete = true; stats.notLooked = notLoaded; }

  // What the estate says it runs, checked against the same advisory table the build pins are.
  for (const [product, version] of Object.entries(site.runtimeVersions || {})) {
    const hits = advisoriesFor(product, String(version), extra);
    if (!hits.length) continue;
    const ids = hits.map((a) => a.id).sort(byText);
    const exploited = ids.filter(isKnownExploited);
    findings.push({
      rule: 'site-declares-vulnerable-runtime', path: site.path ? 'cobolwork.site.json' : '(site configuration)', line: 1,
      detail: `the estate declares ${product} ${version}, which ${countOf(hits)}: ${ids.join(', ')}${fromFeeds(hits)}`,
      related: hits.map(relatedOf),
      sev: exploited.length ? 'crit' : undefined,
      ...(exploited.length ? { knownExploited: exploited } : {}),
    });
  }

  // Build files are small and few, so this set is the least likely of the nine to exhaust a heap.
  // It walks inside the guard anyway: the budget is a property of the scan, not of one rule set's
  // opinion of its own appetite, and a set that opts out is a set nobody notices has opted out.
  const run = eachWithinMemory(files, (f) => {
    let src;
    try { src = tree.text(f).text; } catch (e) { noteUnread(stats, tree, f, e); return 0; }
    stats.filesScanned++;
    const path = relPath(root, f);
    // Maven states a version as a property more often than inline, and the pin is what it resolves
    // to. Substituting in place keeps every line where it was.
    if (/pom\.xml$/i.test(path)) src = withMavenProperties(src);
    const lines = src.split(/\r?\n/);

    for (const { product, version, text } of pinsIn(src)) {
      stats.pinsFound++;

      const hits = advisoriesFor(product, version, extra);
      if (!hits.length) continue;

      // A pin written across lines, as Maven writes one, is reported at its version.
      const needle = text.includes('\n') ? text.split('\n').pop().trim() : text;
      const line = lines.findIndex((l) => l.includes(needle)) + 1 || 1;
      const exploited = hits.filter((a) => isKnownExploited(a.id));
      const ids = hits.map((a) => a.id).sort(byText);

      const kind = COMPILERS.has(product) ? 'compiler' : 'component';
      if (exploited.length) {
        findings.push({
          rule: `build-pins-exploited-${kind}`, path, line,
          detail: `${path} pins ${product} ${version}, which ${exploited.map((a) => a.id).sort(byText).join(', ')} affects and CISA lists as known to be exploited${fromFeeds(hits)}`,
          related: hits.map(relatedOf),
          knownExploited: exploited.map((a) => a.id).sort(byText),
        });
      } else {
        findings.push({
          rule: `build-pins-vulnerable-${kind}`, path, line,
          detail: `${path} pins ${product} ${version}, which ${countOf(hits)}: ${ids.join(', ')}${fromFeeds(hits)}` +
            (age.stale ? `. The KEV snapshot is ${age.days} days old, so whether any of these is now known to be exploited was not checked against a current catalogue` : ''),
          related: hits.map(relatedOf),
        });
      }
    }
    return src.length;
  }, { label: 'build', maxBytes: opts.maxSourceBytes ?? Infinity });

  return report('build', { rules: BUILD_RULES, findings, stats, run });
}
