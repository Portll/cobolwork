// SPDX-License-Identifier: AGPL-3.0-or-later
// CISA's Known Exploited Vulnerabilities catalogue, as identifiers. One question is asked of it -
// is this CVE known to be exploited in the wild - and the answer changes a finding from a
// theoretical defect into an observed one, which is the difference between a ticket and a page.
//
// Only the identifiers are kept. The full catalogue is 1.7MB of prose to answer a set-membership
// question, and this repository has no dependencies and intends to stay small.
//
// It is also the clearest example of why a feed exists at all: this file is stale the week after
// it is written, and a scanner that reports against a two-year-old KEV snapshot is reporting
// against nothing. Refresh with `node diag/refresh-kev.mjs`.
import { readFileSync } from 'node:fs';

export const KEV = JSON.parse(readFileSync(new URL('../rules/kev-ids.json', import.meta.url), 'utf8'));

const IDS = new Set(KEV.cves);

export const isKnownExploited = (cve) => IDS.has(String(cve).toUpperCase());

// CISA publishes roughly weekly. A snapshot older than this is reported alongside any finding that
// depended on it, because "not in KEV" from a stale file is not an answer.
const STALE_AFTER_DAYS = 30;

export function kevAge(now = new Date()) {
  const days = Math.floor((now - new Date(KEV.dateReleased + 'T00:00:00Z')) / 86400000);
  return { days, stale: days > STALE_AFTER_DAYS, catalogVersion: KEV.catalogVersion, dateReleased: KEV.dateReleased };
}
