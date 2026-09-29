// The row shapes the feed ships, and what makes a row well formed. One kind per feed item. These
// are validated before anything else runs, because a malformed row is the cheapest rejection there
// is and the model produces them in bulk.
//
// Every row carries provenance. A row whose claim cannot be traced to a document is not a feed
// row, it is a guess, and the gate in verify.mjs refuses it.
import { CATALOGUE } from './catalogue.mjs';
import { advisoryProblems } from '../lib/advisories.mjs';

const SEVERITIES = ['crit', 'high', 'med', 'low', 'info'];
const FRAMEWORKS = ['dora', 'pci-dss-4', 'ffiec', 'nist-800-53r5', 'sox-itgc'];
const PRODUCTS = ['gnucobol', 'ibm-enterprise-cobol', 'opentext-cobol', 'cics-ts', 'db2-zos'];

const str = (v) => typeof v === 'string' && v.trim().length > 0;
const isoDate = (v) => str(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);

// A quote short enough to be a coincidence is not evidence that the model read the document.
const MIN_QUOTE = 40;

function checkSource(row, problems, { needUrl = false } = {}) {
  const s = row.source;
  if (!s || typeof s !== 'object') return problems.push('source: missing');
  if (!str(s.doc)) problems.push('source.doc: missing');
  if (!isoDate(s.retrieved)) problems.push('source.retrieved: not an ISO date');
  if (!str(s.quote)) problems.push('source.quote: missing');
  else if (s.quote.length < MIN_QUOTE) problems.push('source.quote: shorter than ' + MIN_QUOTE + ' characters');
  if (needUrl && !str(s.url)) problems.push('source.url: missing');
  return undefined;
}

const KINDS = {
  // (1) One rule, one framework clause. ruleId is checked against the engine's own tables, so a
  // mapping cannot name a rule that was renamed or never existed.
  compliance(row, problems) {
    if (!CATALOGUE.has(row.ruleId)) problems.push("ruleId: '" + row.ruleId + "' is not a rule this engine reports");
    if (!FRAMEWORKS.includes(row.framework)) problems.push('framework: not one of ' + FRAMEWORKS.join(', '));
    if (!str(row.clause)) problems.push('clause: missing');
    if (!str(row.title)) problems.push('title: missing');
    if (!str(row.rationale)) problems.push('rationale: missing');
    else if (row.rationale.length < 60) problems.push('rationale: too short to say why the rule satisfies the clause');
    checkSource(row, problems);
  },

  // (2) A shape, not a value. The pack ships what a production-looking name looks like; which
  // names are production is the customer's configuration, so a row hardcoding one is refused.
  recon(row, problems) {
    if (!['hlq', 'lpar', 'vtam-applid', 'hostname', 'ip', 'volser'].includes(row.class)) problems.push('class: unknown');
    if (!str(row.pattern)) problems.push('pattern: missing');
    else { try { new RegExp(row.pattern); } catch (e) { problems.push('pattern: not a regular expression (' + e.message + ')'); } }
    if (!Array.isArray(row.matches) || row.matches.length < 2) problems.push('matches: need at least two examples that match');
    if (!Array.isArray(row.nonMatches) || row.nonMatches.length < 2) problems.push('nonMatches: need at least two near misses that must not match');
    if (typeof row.needsSiteConfig !== 'boolean') problems.push('needsSiteConfig: missing');
    if (!SEVERITIES.includes(row.severity)) problems.push('severity: unknown');
    checkSource(row, problems);
  },

  // (3) One utility, one parameter, one effect. The JCL fragment is what the gate checks against
  // the statement grammar, so it is required even when the row is about a parameter alone.
  utility(row, problems) {
    if (!str(row.utility)) problems.push('utility: missing');
    else if (!/^[A-Z0-9$#@]{1,8}$/.test(row.utility)) problems.push('utility: not a program name of 1 to 8 characters');
    if (!str(row.parameter)) problems.push('parameter: missing');
    if (!str(row.effect)) problems.push('effect: missing');
    if (!SEVERITIES.includes(row.severity)) problems.push('severity: unknown');
    if (!str(row.rationale) || row.rationale.length < 60) problems.push('rationale: missing or too short');
    if (!str(row.jcl)) problems.push('jcl: missing');
    checkSource(row, problems);
  },

  // (4) A version range and the advisory that named it. fixedIn may be null when nothing fixes it.
  advisory(row, problems) {
    problems.push(...advisoryProblems(row, { products: PRODUCTS }));
    checkSource(row, problems, { needUrl: true });
  },

  // (5) One vendor verb and why it is worth seeing. Shipped per product, so a shop that does not
  // run the product never loads the pack.
  vendor(row, problems) {
    if (!str(row.vendor)) problems.push('vendor: missing');
    if (!str(row.product)) problems.push('product: missing');
    if (!str(row.verb)) problems.push('verb: missing');
    if (!str(row.risk)) problems.push('risk: missing');
    if (!SEVERITIES.includes(row.severity)) problems.push('severity: unknown');
    if (!str(row.rationale) || row.rationale.length < 60) problems.push('rationale: missing or too short');
    if (!str(row.example)) problems.push('example: missing');
    checkSource(row, problems);
  },

  // (6) One sink in one program, marked reachable, not reachable or undecidable by a person. The
  // corpus is worth having only because a human decided each row, so provenance is part of the
  // shape and the gate refuses anything else. A model may rank which programs to read. It may not
  // answer.
  corpus(row, problems) {
    if (row.method !== 'human') problems.push("method: must be 'human' - a model-labelled row is not ground truth");
    if (!str(row.labeller)) problems.push('labeller: missing');
    if (!isoDate(row.labelledAt)) problems.push('labelledAt: not an ISO date');
    if (!str(row.repo)) problems.push('repo: missing');
    if (!str(row.program)) problems.push('program: missing');
    if (!str(row.sink)) problems.push('sink: missing');
    if (typeof row.line !== 'number') problems.push('line: missing');
    // Undecidable is an answer the spec asks to count, not a gap to force into true or false.
    if (typeof row.reachable !== 'boolean' && row.reachable !== 'undecidable') problems.push("reachable: must be true, false or 'undecidable'");
    if (!str(row.reasoning) || row.reasoning.length < 40) problems.push('reasoning: missing or too short to review');
  },
};

export const KIND_NAMES = Object.keys(KINDS);

// Kinds a model is allowed to author at all. Everything else it may only triage.
export const GENERABLE = ['compliance', 'recon', 'utility', 'advisory', 'vendor'];

export function validate(row) {
  const problems = [];
  if (!row || typeof row !== 'object') return ['row: not an object'];
  if (!KINDS[row.kind]) return ["kind: '" + row.kind + "' is not one of " + KIND_NAMES.join(', ')];
  KINDS[row.kind](row, problems);
  return problems;
}
