// Refreshes the advisory and KEV data from their sources, and verifies what is already there.
//
//   node diag/refresh-advisories.mjs            # check the committed data still matches NVD and CISA
//   node diag/refresh-advisories.mjs --write    # rewrite rules/advisories.json and rules/kev-ids.json
//
// The verification is the part that matters. A fabricated CVE identifier in rules/advisories.json
// would be worse than an empty file, because a report citing one destroys the credibility of every
// row beside it. So every identifier is resolved against NVD, and a row that does not resolve is
// an error rather than a warning.
//
// Exit 0 when everything matches, 1 on a mismatch, 2 when the check could not run at all. A
// network failure is exit 2, not exit 0: not checking is not the same as checking and finding
// nothing wrong.
import { readFileSync, writeFileSync } from 'node:fs';
import { ADVISORIES } from '../lib/advisories.mjs';
import { KEV } from '../lib/kev.mjs';

const NVD = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
const write = process.argv.includes('--write');
const today = new Date().toISOString().slice(0, 10);

const get = async (url) => {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
};

let problems = 0;
const fail = (s) => { problems++; console.error('MISMATCH ' + s); };

// --- advisories -------------------------------------------------------------------------------

console.log(`checking ${ADVISORIES.advisories.length} advisories against NVD`);
const fresh = [];
for (const row of ADVISORIES.advisories) {
  let body;
  try { body = await get(`${NVD}?cveId=${encodeURIComponent(row.id)}`); } catch (e) {
    console.error(`could not reach NVD for ${row.id}: ${e.message}`);
    process.exit(2);
  }
  const found = body.vulnerabilities?.[0]?.cve;
  if (!found) { fail(`${row.id} does not resolve at NVD - it may never have existed`); continue; }

  const desc = found.descriptions.find((d) => d.lang === 'en')?.value || '';
  if (desc.trim() !== row.source.quote.trim()) fail(`${row.id} description has changed at NVD`);

  // NVD names the affected versions in its CPE list. Claiming a wider range than the advisory
  // states is the same failure as inventing the advisory, only harder to notice.
  const versions = [...new Set((found.configurations || []).flatMap((c) => c.nodes || [])
    .flatMap((n) => n.cpeMatch || []).map((m) => m.criteria.split(':')[5]).filter((v) => v && v !== '*' && v !== '-'))].sort();
  if (versions.length && row.affected !== versions.join('||')) {
    fail(`${row.id} affects ${versions.join('||')} at NVD, but this file says ${row.affected}`);
  }
  fresh.push({ ...row, source: { ...row.source, retrieved: today, quote: desc } });
  await new Promise((r) => setTimeout(r, 6500));   // NVD rate-limits unauthenticated callers
}

// --- KEV --------------------------------------------------------------------------------------

let kev;
try { kev = await get(KEV_URL); } catch (e) {
  console.error(`could not reach CISA: ${e.message}`);
  process.exit(2);
}
const ids = [...new Set(kev.vulnerabilities.map((v) => v.cveID))].sort();
console.log(`KEV: committed ${KEV.catalogVersion} (${KEV.cves.length} ids), live ${kev.catalogVersion} (${ids.length} ids)`);
if (!write && kev.catalogVersion !== KEV.catalogVersion) {
  console.log(`KEV is behind. Re-run with --write to take ${kev.catalogVersion}.`);
}

// Any advisory that has become known-exploited since the snapshot was taken is the one thing here
// that changes a severity, so it is called out rather than left to the diff.
const nowExploited = ADVISORIES.advisories.filter((a) => ids.includes(a.id) && !KEV.cves.includes(a.id));
for (const a of nowExploited) console.log(`NEW IN KEV: ${a.id} (${a.product} ${a.affected}) is now listed as known to be exploited`);

if (write) {
  writeFileSync(new URL('../rules/advisories.json', import.meta.url),
    JSON.stringify({ ...ADVISORIES, retrieved: today, advisories: fresh }, null, 1) + '\n');
  const existing = JSON.parse(readFileSync(new URL('../rules/kev-ids.json', import.meta.url), 'utf8'));
  writeFileSync(new URL('../rules/kev-ids.json', import.meta.url),
    JSON.stringify({ ...existing, catalogVersion: kev.catalogVersion, dateReleased: kev.dateReleased.slice(0, 10), retrieved: today, count: ids.length, cves: ids }, null, 1) + '\n');
  console.log('wrote rules/advisories.json and rules/kev-ids.json');
}

console.log(problems ? `\n${problems} mismatch(es)` : '\nevery advisory resolves and matches its source');
process.exit(problems ? 1 : 0);
