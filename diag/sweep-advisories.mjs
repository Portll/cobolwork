// Sweeps the public record for the components in feed/worklists/components.json and prints rows in
// the shape rules/advisories.json holds. It proposes; a person decides what lands, and
// diag/refresh-advisories.mjs then re-resolves every identifier that did.
//
//   node diag/sweep-advisories.mjs [--product name] [--out candidates.json]
//
// Two sources, because neither covers the estate alone. NVD is matched by CPE rather than keyword:
// "Db2 Connect" as a keyword returns 218 results, most of them DB2 UDB from 2005, while the CPE
// returns 17. OSV covers what NVD does not: Zowe's CVEs carry no CPE data at all, because its CNA
// does not add it, so a CPE sweep finds none of them and the npm packages find all of them.
//
// NVD stays the record even for what OSV finds. A row carries its NVD URL, summary and score, and
// source.foundVia names the package that led to it, so refresh-advisories.mjs can re-resolve every
// row. An OSV advisory with no CVE identifier cannot be loaded at all, and belongs in coverage.
//
// Exit 0 when every component was swept, 2 when a source could not be reached: not looking is not
// the same as looking and finding nothing.
import { readFileSync, writeFileSync } from 'node:fs';

const NVD = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const OSV = 'https://api.osv.dev/v1/query';
const WORKLIST = new URL('../feed/worklists/components.json', import.meta.url);
const args = process.argv.slice(2);
const only = args.includes('--product') ? args[args.indexOf('--product') + 1] : null;
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const today = new Date().toISOString().slice(0, 10);

const SEV = { CRITICAL: 'crit', HIGH: 'high', MEDIUM: 'med', LOW: 'low' };
// NVD asks for 6 seconds between requests without a key.
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

async function post(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

// An NVD configuration says which versions a CPE matched, as a start and an end with their own
// inclusivity. The interval grammar in lib/advisories.mjs says the same thing.
function affectedFromNvd(cve, cpePrefix) {
  const parts = [];
  for (const node of cve.configurations || []) {
    for (const n of node.nodes || []) {
      for (const m of n.cpeMatch || []) {
        if (!m.vulnerable || !String(m.criteria).startsWith(cpePrefix)) continue;
        const from = m.versionStartIncluding || m.versionStartExcluding;
        const to = m.versionEndIncluding || m.versionEndExcluding;
        const exact = String(m.criteria).split(':')[5];
        if (from && to) parts.push(`${m.versionStartIncluding ? '[' : '('}${from},${to}${m.versionEndIncluding ? ']' : ')'}`);
        else if (to) parts.push(`${m.versionEndIncluding ? '<=' : '<'}${to}`);
        else if (from) parts.push(`${m.versionStartIncluding ? '>=' : '>'}${from}`);
        else if (exact && exact !== '*' && exact !== '-') parts.push(exact);
      }
    }
  }
  return [...new Set(parts)].join('||');
}

function affectedFromOsv(vuln, name) {
  const parts = [];
  for (const a of vuln.affected || []) {
    if (a.package && a.package.name !== name) continue;
    for (const r of a.ranges || []) {
      let introduced = null;
      for (const e of r.events || []) {
        if (e.introduced) introduced = e.introduced === '0' ? null : e.introduced;
        else if (e.fixed) parts.push(introduced ? `[${introduced},${e.fixed})` : `<${e.fixed}`);
        else if (e.last_affected) parts.push(introduced ? `[${introduced},${e.last_affected}]` : `<=${e.last_affected}`);
      }
    }
    for (const v of a.versions || []) if (!parts.length) parts.push(v);
  }
  return [...new Set(parts)].join('||');
}

const worklist = JSON.parse(readFileSync(WORKLIST, 'utf8'));
const rows = [];
const swept = [];
let unreachable = 0;

for (const c of worklist.components) {
  if (only && c.product !== only) continue;
  const found = [];
  if (c.nvdCpe) {
    try {
      const j = await get(`${NVD}?virtualMatchString=${encodeURIComponent(c.nvdCpe)}&resultsPerPage=200`);
      for (const { cve } of j.vulnerabilities || []) {
        const metric = (cve.metrics.cvssMetricV31 || cve.metrics.cvssMetricV30 || [])[0];
        const summary = (cve.descriptions.find((d) => d.lang === 'en') || {}).value || '';
        found.push({
          kind: 'advisory', product: c.product, id: cve.id,
          affected: affectedFromNvd(cve, c.nvdCpe) || null,
          fixedIn: null,
          severity: metric ? SEV[metric.cvssData.baseSeverity] || null : null,
          cvss: metric ? metric.cvssData.baseScore : null,
          summary: summary.trim(),
          source: { doc: `nvd-${c.product}`, url: `https://nvd.nist.gov/vuln/detail/${cve.id}`, retrieved: today, quote: summary.trim() },
        });
      }
      swept.push(`${c.product}: NVD CPE ${c.nvdCpe}, ${j.totalResults} result(s)`);
    } catch (e) {
      unreachable++;
      swept.push(`${c.product}: NVD unreachable (${e.message})`);
    }
    await pause(6500);
  }
  for (const pkg of c.osv || []) {
    try {
      const j = await post(OSV, { package: { name: pkg.name, ecosystem: pkg.ecosystem } });
      for (const v of j.vulns || []) {
        const cve = (v.aliases || []).find((a) => a.startsWith('CVE-'));
        if (!cve) { swept.push(`${c.product}: ${v.id} has no CVE identifier, so it cannot be loaded - record it in coverage`); continue; }
        const sev = (v.database_specific || {}).severity;
        const score = (v.severity || []).find((s) => s.type === 'CVSS_V3');
        found.push({
          kind: 'advisory', product: c.product, id: cve || v.id,
          affected: affectedFromOsv(v, pkg.name) || null,
          fixedIn: null,
          severity: sev ? SEV[String(sev).toUpperCase()] || null : null,
          cvss: score ? null : null,
          summary: (v.summary || '').trim(),
          source: { doc: `osv-${pkg.ecosystem}-${pkg.name}`, url: `https://osv.dev/vulnerability/${v.id}`, retrieved: today, quote: (v.summary || '').trim() },
          osvPackage: `${pkg.ecosystem}:${pkg.name}`,
        });
      }
      swept.push(`${c.product}: OSV ${pkg.ecosystem}:${pkg.name}, ${(j.vulns || []).length} result(s)`);
    } catch (e) {
      unreachable++;
      swept.push(`${c.product}: OSV unreachable for ${pkg.name} (${e.message})`);
    }
  }
  rows.push(...found);
}

for (const line of swept) console.log(line);
console.log(`\n${rows.length} candidate row(s). Rows without an affected range need one written by hand: a`);
console.log('row the version arithmetic cannot evaluate would match every version or none.\n');
for (const r of rows) {
  console.log(`${r.id}  ${r.product}  ${r.severity || '-'}  ${r.affected || 'NO RANGE'}`);
  console.log(`    ${r.summary.slice(0, 120)}`);
}
if (out) writeFileSync(out, JSON.stringify({ retrieved: today, swept, rows }, null, 1));
process.exit(unreachable ? 2 : 0);
