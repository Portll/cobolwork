// Sweeps the public record for the mainframe itself and says what feed/worklists/z-attack-classes.json
// does not yet hold.
//
//   node diag/sweep-z.mjs [--out candidates.json]
//
// IBM publishes z/OS product vulnerabilities through the IBM Z and LinuxONE Security Portal, which
// needs registration and treats what it shows as confidential. That is not the whole record: NVD
// holds 64 CVEs under the z/OS CPE alone, and 160 across the products a COBOL estate runs on. This
// tool is how that number is kept current, and how a new advisory becomes a rule proposal rather
// than a surprise.
//
// The CPE for z/OS is cpe:2.3:o:ibm:z\/os - the backslash is part of the CPE, not an escape, and
// a query that loses it returns 404 rather than nothing, so a lost backslash reads as an outage.
//
// Exit 0 when every query answered, 2 when one did not: not looking is not the same as looking and
// finding nothing.
import { readFileSync, writeFileSync } from 'node:fs';

const NVD = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const WORKLIST = new URL('../feed/worklists/z-attack-classes.json', import.meta.url);
const out = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : null;

const worklist = JSON.parse(readFileSync(WORKLIST, 'utf8'));
const held = new Set(worklist.advisories.map((a) => a.id));
// A CVE with no z CPE still reaches the estate, so the keyword half of the sweep is kept, and its
// results are filtered to what names a mainframe product.
const Z_CPE = /ibm:(z..?os|zos|cics|ims|integration_bus_for_z|app_connect_enterprise|z..?vm|z..?vse)/i;
const Z_TEXT = /\b(z\/OS|CICS|RACF|IMS |JES2|ACF2|TN3270|3270|zSeries|System z|IBM Z)\b/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let unreachable = 0;

async function query(param, value) {
  const rows = [];
  let total = null;
  for (let start = 0; start === 0 || start < total; start += 100) {
    const url = `${NVD}?${param}=${encodeURIComponent(value)}&resultsPerPage=100&startIndex=${start}`;
    let ok = false;
    for (let attempt = 0; attempt < 4 && !ok; attempt++) {
      const res = await fetch(url, { headers: { accept: 'application/json' } }).catch((e) => ({ ok: false, status: e.message }));
      if (!res.ok) { console.error(`  ${value}: HTTP ${res.status}`); await sleep(12000); continue; }
      const j = await res.json();
      total = j.totalResults;
      for (const { cve } of j.vulnerabilities || []) {
        const metric = (cve.metrics.cvssMetricV31 || cve.metrics.cvssMetricV30 || cve.metrics.cvssMetricV2 || [])[0];
        rows.push({
          id: cve.id,
          published: cve.published.slice(0, 10),
          desc: (cve.descriptions.find((d) => d.lang === 'en') || {}).value || '',
          cwe: [...new Set((cve.weaknesses || []).flatMap((w) => w.description.map((d) => d.value)))].filter((c) => c.startsWith('CWE-')),
          cvss: metric ? metric.cvssData.baseScore : null,
          cpes: [...new Set((cve.configurations || []).flatMap((n) => (n.nodes || []).flatMap((x) => (x.cpeMatch || []).map((m) => m.criteria))))],
        });
      }
      ok = true;
    }
    if (!ok) { unreachable++; return { total: null, rows }; }
    await sleep(7000);
  }
  return { total, rows };
}

const found = new Map();
for (const cpe of worklist.sources.cpe) {
  const { total, rows } = await query('virtualMatchString', cpe);
  console.log(`${cpe}: ${total === null ? 'unreachable' : total + ' result(s)'}`);
  for (const r of rows) found.set(r.id, r);
}
for (const kw of worklist.sources.keyword) {
  const { total, rows } = await query('keywordSearch', kw);
  console.log(`keyword ${kw}: ${total === null ? 'unreachable' : total + ' result(s)'}`);
  for (const r of rows) if (r.cpes.some((c) => Z_CPE.test(c)) || Z_TEXT.test(r.desc)) found.set(r.id, r);
}

const added = [...found.values()].filter((r) => !held.has(r.id)).sort((a, b) => (a.published < b.published ? 1 : -1));
const gone = [...held].filter((id) => !found.has(id));

console.log(`\n${found.size} mainframe advisor${found.size === 1 ? 'y' : 'ies'} on the public record, ${held.size} held.`);
if (gone.length) console.log(`${gone.length} held row(s) no longer match a query: ${gone.join(', ')}`);
if (!added.length) console.log('Nothing new. The worklist is current.');
for (const r of added) {
  console.log(`\n${r.id}  ${r.published}  ${r.cwe.join(',') || 'no CWE'}  ${r.cvss ?? '-'}`);
  console.log(`  ${r.desc.replace(/\s+/g, ' ').slice(0, 200)}`);
  console.log('  verdict: covered | new <rule> | patch  <- decide this, then add the row');
}
if (out) writeFileSync(out, JSON.stringify({ retrieved: new Date().toISOString().slice(0, 10), added, gone }, null, 1));
process.exit(unreachable ? 2 : 0);
