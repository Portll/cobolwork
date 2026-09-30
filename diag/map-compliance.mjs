// Maps every rule this engine reports to the clause of each framework that makes it an obligation,
// and refuses to write a framework's file unless every row passes the feed gate.
//
//   node diag/map-compliance.mjs [--write] [--framework dora|ffiec|nist80053]
//
// Three frameworks ship openly here because their instruments may be reproduced: DORA is EU law,
// and NIST SP 800-53 and the FFIEC IT Examination Handbook are US Government works. PCI DSS and the
// COBIT-derived SOX material may not be redistributed and belong in the licensed feed. That is a
// licensing fact before it is a product decision, and it happens to make the free matrices the
// argument for the paid ones.
//
// The clause each rule maps to is a judgement, written down here rather than inferred. The gate
// checks that the document says what the row claims it says; it cannot check that the mapping is
// apt. What it removes from a reviewer is the fact-checking, not the thinking.
//
// A rule that no clause genuinely covers is recorded as unmapped, with a reason. Reaching for a
// near miss to fill the matrix is the failure mode this file is built to avoid.
import { writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOGUE } from '../feed/catalogue.mjs';
import { verifyRow } from '../feed/verify.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCES = join(HERE, '..', 'feed', 'sources');
const write = process.argv.includes('--write');
const only = process.argv.includes('--framework') ? process.argv[process.argv.indexOf('--framework') + 1] : null;
const RETRIEVED = '2026-09-20';

// The channel sinks are about data leaving; everything else in the flow set is about a flaw being
// reachable. All three frameworks separate those, so the mapping does too.
const EXFIL = /-to-(outbound-http|socket-send|message-queue|extrapartition-queue)$/;
const isExfil = (r) => r.set === 'flow' && EXFIL.test(r.id);

// Frameworks that are wanted, decided on, and blocked on getting the instrument. Empty today.
// FFIEC was here: its booklets refuse automated requests, so the text had to be fetched by hand
// before any of it could be mapped. Nothing was written from memory in the meantime, because
// inventing a section number to fill a matrix is the exact failure the gate exists to prevent.
const BLOCKED = {};

const FRAMEWORKS = {
  dora: {
    id: 'dora',
    doc: 'dora',
    instrument: 'Regulation (EU) 2022/2554',
    source: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32022R2554',
    out: 'compliance-dora.json',
    coverage: 'Articles 8 and 9 only. DORA Chapters III to V (incident reporting, resilience testing, third-party risk) place obligations that no static analysis of source code can evidence, and no row claims otherwise.',
    clauses: {
      '8(2)': { title: 'Identification', quote: 'identify all sources of ICT risk, in particular the risk exposure to and from other financial entities, and assess cyber threats and ICT vulnerabilities relevant to their ICT supported business functions' },
      '8(3)': { title: 'Identification', quote: 'perform a risk assessment upon each major change in the network and information system infrastructure, in the processes or procedures affecting their ICT supported business functions, information assets or ICT assets' },
      '8(4)': { title: 'Identification', quote: 'map the configuration of the information assets and ICT assets and the links and interdependencies between the different information assets and ICT assets' },
      '8(6)': { title: 'Identification', quote: 'maintain relevant inventories and update them periodically and every time any major change as referred to in paragraph 3 occurs' },
      '8(7)': { title: 'Identification', quote: 'conduct a specific ICT risk assessment on all legacy ICT systems and, in any case before and after connecting technologies, applications or systems' },
      '9(3)(a)': { title: 'Protection and prevention', quote: 'ensure the security of the means of transfer of data' },
      '9(3)(b)': { title: 'Protection and prevention', quote: 'minimise the risk of corruption or loss of data, unauthorised access and technical flaws that may hinder business activity' },
      '9(3)(c)': { title: 'Protection and prevention', quote: 'prevent the lack of availability, the impairment of the authenticity and integrity, the breaches of confidentiality and the loss of data' },
      '9(4)(c)': { title: 'Protection and prevention', quote: 'implement policies that limit the physical or logical access to information assets and ICT assets to what is required for legitimate and approved functions and activities only' },
      '9(4)(d)': { title: 'Protection and prevention', quote: 'implement policies and protocols for strong authentication mechanisms, based on relevant standards and dedicated control systems, and protection measures of cryptographic keys' },
    },
    documentLevel: ['8(7)'],
    prefix: 'Article ',
    perRule: {
      'jcl-instream-credential': '9(4)(d)',
      'jcl-instream-security-command': '9(4)(c)',
      'jcl-instream-destructive': '9(3)(c)',
      'jcl-dlm-hides-instream': '9(3)(b)',
      'jcl-parm-is-an-entry-point': '8(2)',
      'jcl-exec-pgm-unresolved': '8(6)',
      'jcl-ftp-cleartext': '9(3)(a)',
      'jcl-ftp-sends-production-dataset': '9(3)(a)',
      // The name rule maps an interdependency; these two are the job acting on production data.
      'recon-nonproduction-job-writes-production-dataset': '9(3)(c)',
      'recon-nonproduction-job-reads-production-dataset': '9(3)(b)',
    },
    perSet: {
      flow: '9(3)(b)', cics: '9(3)(b)', hidden: '9(3)(b)', copybook: '8(4)', diff: '8(3)',
      build: '8(2)', credential: '9(4)(d)', recon: '8(4)', vendor: '9(4)(c)', opaque: '8(4)',
      web: '9(3)(b)', priv: '9(4)(c)', log: '9(3)(c)',
      // 8(6) would be the inventory, but its frame speaks of a job; source nobody can build is a
      // risk found by reading the source, which is 8(2)'s.
      compile: '8(2)',
      // A result that depends on the generated code, or loses digits, is data corrupted by a flaw.
      semantics: '9(3)(b)',
    },
    exfil: '9(3)(a)',
    frame: {
      '8(2)': 'That is a source of ICT risk in a business-supporting function, identified by reading the source rather than by asking the team that maintains it.',
      '8(3)': 'That is what a change reaches, which is the assessment this clause requires on each major change, performed per change rather than per year.',
      '8(4)': 'That is an interdependency between assets which no single file records, and mapping it is what this clause asks for.',
      '8(6)': 'That is an inventory gap - the job runs something the inventory does not account for - and this clause requires the inventory be kept current.',
      '9(3)(a)': 'That is data leaving through a channel the program opened itself, which bears directly on the security of the means of transfer.',
      '9(3)(b)': 'That is a technical flaw permitting unauthorised access or data corruption, which this clause requires be minimised.',
      '9(3)(c)': 'That risks the loss of data and the impairment of its integrity, which this clause requires be prevented.',
      '9(4)(c)': 'That grants or alters access rights outside the policy controls this clause requires be soundly administered.',
      '9(4)(d)': 'That exposes an authentication secret in a file, defeating the authentication mechanisms and key protection this clause requires.',
    },
    unmapped: {},
  },

  ffiec: {
    id: 'ffiec',
    doc: 'ffiec',
    instrument: 'FFIEC IT Examination Handbook',
    source: 'https://ithandbook.ffiec.gov/it-booklets - Development, Acquisition, and Maintenance (Aug 2024); Information Security (Sep 2016); Architecture, Infrastructure, and Operations (Jun 2021)',
    out: 'compliance-ffiec.json',
    coverage: 'Three booklets of ten: Development, Acquisition, and Maintenance; Information Security; and Architecture, Infrastructure, and Operations. The other seven - Audit, Business Continuity Management, Management, Outsourcing Technology Services, Retail and Wholesale Payment Systems, Supervision of Technology Service Providers - place obligations no static analysis of source code can evidence.',
    // Section numbers repeat across booklets - II.C.7 exists in more than one and means something
    // different in each - so every clause identifier here names its booklet.
    clauses: {
      'DA&M V.C': { title: 'Testing', quote: 'Static analysis: Personnel detect software vulnerabilities by examining the application source code and binary code and attempting to analyze and identify all possible behaviors that might arise at runtime.' },
      'DA&M V': { title: 'Development', quote: 'Secure coding practices help developers minimize the potential for known source code-related vulnerabilities in the development phase.' },
      'DA&M IV': { title: 'Common Development, Acquisition, and Maintenance Practices', quote: 'Inventory of all systems and components (e.g., open-source, proprietary, application programming interfaces [API], and container images and registries), including related licenses, and data as part of IT asset management (ITAM).' },
      'DA&M VII.B.3': { title: 'Additional Control Considerations in Change Management', quote: 'To prevent unauthorized access to or modification of code, access to code repositories should be role-based, follow the principle of least privilege, and limit access to authorized personnel, tools, and services.' },
      'IS II.C.19': { title: 'Encryption', quote: 'Encryption is used to secure communications and data storage, particularly authentication credentials and the transmission of sensitive information.' },
      'IS II.C.7': { title: 'User Security Controls', quote: 'Principle of least privilege, which recommends minimum user profile privileges for both physical and logical access based on job necessity.' },
      'AIO VI.C.3': { title: 'Vulnerability and Patch Management', quote: 'Management should establish procedures to stay abreast of system vulnerabilities and software vendor patches, test the patches in a segregated environment, and install them when appropriate.' },
      'DA&M VII.B.2(a)': { title: 'Data Controls in the Testing Environment', quote: 'Use of production data in test environments should be accompanied by appropriate controls.' },
    },
    // The booklet names static analysis as a control and describes what it does. That is the tool,
    // not any one rule, so it is claimed once.
    documentLevel: ['DA&M V.C'],
    prefix: '',
    perRule: {
      'jcl-instream-credential': 'IS II.C.19',
      'jcl-instream-security-command': 'IS II.C.7',
      'jcl-instream-destructive': 'IS II.C.7',
      'jcl-dlm-hides-instream': 'DA&M V',
      'jcl-parm-is-an-entry-point': 'DA&M V',
      'jcl-exec-pgm-unresolved': 'DA&M IV',
      'jcl-ftp-cleartext': 'IS II.C.19',
      'jcl-ftp-sends-production-dataset': 'IS II.C.19',
      // Unlike the name rule, these are not about disclosure: the booklets do cover a test job
      // reaching production data, and authority exercised beyond the job's necessity.
      'recon-nonproduction-job-writes-production-dataset': 'IS II.C.7',
      'recon-nonproduction-job-reads-production-dataset': 'DA&M VII.B.2(a)',
    },
    perSet: {
      flow: 'DA&M V', cics: 'DA&M V', hidden: 'DA&M V', copybook: 'DA&M IV',
      diff: 'DA&M VII.B.3', build: 'AIO VI.C.3', credential: 'IS II.C.19', vendor: 'IS II.C.7', opaque: 'DA&M IV',
      web: 'DA&M V', priv: 'IS II.C.7', log: 'IS II.C.19',
      compile: 'DA&M IV',
      semantics: 'DA&M V',
    },
    exfil: 'IS II.C.19',
    frame: {
      'DA&M V': 'That is a source code-related vulnerability of the kind secure coding practices exist to minimise.',
      'DA&M IV': 'That is a component or dependency the inventory does not accurately account for, which this practice requires be catalogued.',
      'DA&M VII.B.3': 'That is an unreviewed modification reaching code nobody edited, which is what change control over the repository exists to prevent.',
      'IS II.C.19': 'That is an authentication credential or sensitive data left unprotected, which this control requires be encrypted in storage and in transit.',
      'IS II.C.7': 'That is authority granted or exercised beyond job necessity, which the principle of least privilege exists to constrain.',
      'AIO VI.C.3': 'That is a known vulnerability in software the entity runs, which this control requires be tracked and patched.',
      'DA&M VII.B.2(a)': 'That is production data put to use outside production, which this section requires be accompanied by appropriate controls.',
    },
    // Declined for the same reason as NIST: no booklet has a control about disclosing internal
    // system naming in source. DA&M IV is about maintaining an inventory, not about where its
    // contents appear. Mapping to it would read plausibly and be wrong.
    unmapped: {
      'recon-production-name-outside-production': 'No FFIEC booklet covers the disclosure of internal system naming in source. DA&M IV concerns maintaining an inventory of components, not where the names of those components appear; IS II.C.19 concerns encrypting sensitive data, not naming conventions. Mapping to either would be a near miss.',
      'recon-routable-address-committed': 'As above. The nearest candidates govern the network boundary or the inventory, not the disclosure of an address inside a repository.',
    },
  },

  nist80053: {
    id: 'nist-800-53r5',
    doc: 'nist80053',
    instrument: 'NIST SP 800-53 Rev. 5.2.0',
    source: 'https://github.com/usnistgov/oscal-content (NIST_SP-800-53_rev5_catalog.json)',
    out: 'compliance-nist80053.json',
    coverage: 'Control statements only, from the OSCAL catalogue. Assessment procedures, control enhancements not listed here, and the parameter values an organisation chooses are outside it.',
    clauses: {
      'SA-11(1)': { title: 'Static Code Analysis', quote: 'Require the developer of the system, system component, or system service to employ static code analysis tools to identify common flaws and document the results of the analysis.' },
      'SI-10': { title: 'Information Input Validation', quote: 'Check the validity of the following information inputs' },
      'SC-7': { title: 'Boundary Protection', quote: 'Monitor and control communications at the external managed interfaces to the system and at key internal managed interfaces within the system' },
      'SI-2': { title: 'Flaw Remediation', quote: 'Identify, report, and correct system flaws' },
      'CM-3': { title: 'Configuration Change Control', quote: 'Review proposed configuration-controlled changes to the system and approve or disapprove such changes with explicit consideration for security and privacy impact analyses' },
      'CM-8': { title: 'System Component Inventory', quote: 'Develop and document an inventory of system components' },
      'IA-5': { title: 'Authenticator Management', quote: 'Establishing initial authenticator content for any authenticators issued by the organization' },
      'AC-6': { title: 'Least Privilege', quote: 'Employ the principle of least privilege, allowing only authorized accesses for users (or processes acting on behalf of users) that are necessary to accomplish assigned organizational tasks.' },
      'SC-23': { title: 'Session Authenticity', quote: 'Protect the authenticity of communications sessions.' },
      'SC-8': { title: 'Transmission Confidentiality and Integrity', quote: 'Protect the {{ insert: param, sc-08_odp }} of transmitted information.' },
      'SI-11': { title: 'Error Handling', quote: 'Generate error messages that provide information necessary for corrective actions without revealing information that could be exploited' },
      'SA-3(2)': { title: 'Use of Live or Operational Data', quote: 'Approve, document, and control the use of live data in preproduction environments for the system, system component, or system service' },
      'IA-5(1)': { title: 'Password-based Authentication', quote: 'Transmit passwords only over cryptographically-protected channels' },
    },
    // SA-11(1) is the control this entire tool answers. Mapping it per rule would be padding.
    documentLevel: ['SA-11(1)'],
    prefix: '',
    perRule: {
      'jcl-instream-credential': 'IA-5',
      'jcl-instream-security-command': 'AC-6',
      'jcl-instream-destructive': 'AC-6',
      'jcl-dlm-hides-instream': 'SI-10',
      'jcl-parm-is-an-entry-point': 'SI-10',
      'jcl-exec-pgm-unresolved': 'CM-8',
      // Plain FTP's first cleartext secret is the logon, which is what IA-5(1)(c) is about.
      'jcl-ftp-cleartext': 'IA-5(1)',
      'jcl-ftp-sends-production-dataset': 'SC-7',
      'cics-listener-accepts-cleartext': 'SC-8',
      'recon-nonproduction-job-writes-production-dataset': 'AC-6',
      'recon-nonproduction-job-reads-production-dataset': 'SA-3(2)',
    },
    perSet: {
      flow: 'SI-10', cics: 'SI-10', hidden: 'SI-10', copybook: 'CM-8', diff: 'CM-3',
      build: 'SI-2', credential: 'IA-5', vendor: 'AC-6', opaque: 'CM-8',
      web: 'SC-23', priv: 'AC-6', log: 'SI-11',
      compile: 'CM-8',
      semantics: 'SI-2',
    },
    exfil: 'SC-7',
    frame: {
      'SI-10': 'That is an information input reaching an operation without its validity having been checked, which is what this control requires.',
      'SC-7': 'That is information crossing a managed interface through a channel the program opened itself, which this control requires be monitored and controlled.',
      'SI-2': 'That is a known system flaw present in the build, which this control requires be identified, reported and corrected.',
      'CM-3': 'That is the security impact of a proposed change, which this control requires be considered explicitly before the change is approved.',
      'CM-8': 'That is a component the inventory does not accurately account for, which this control requires be documented.',
      'IA-5': 'That is authenticator content established in a file rather than managed, which is what this control governs.',
      'AC-6': 'That is authority granted or exercised beyond what the task requires, which this control exists to prevent.',
      'SC-23': 'That is a session another origin can frame, keep a handle on or read off a cleartext hop, which is the authenticity of the session this control requires be protected.',
      'SC-8': 'That is information crossing a network with nothing protecting it, which this control requires be protected in transit.',
      'SI-11': 'That is the system emitting information that could be exploited, to a destination read by people the record was never for, which this control requires it not do.',
      'SA-3(2)': 'That is live data put to use outside production, which this control requires be approved, documented and controlled.',
      'IA-5(1)': 'That is a password sent over a channel with no cryptographic protection, which this control does not allow.',
    },
    // Recorded rather than stretched. NIST 800-53 has no control that genuinely covers committing
    // an LPAR name or a production qualifier to a repository: the nearest candidates are about
    // inventory or boundary protection, and neither is what these rules find.
    unmapped: {
      'recon-production-name-outside-production': 'No control in SP 800-53 covers the disclosure of internal system naming in source. CM-8 is about maintaining an inventory, not about where its contents appear; SC-7 is about interfaces. Mapping to either would be a near miss.',
      'recon-routable-address-committed': 'As above. The nearest control, SC-7, governs the interface rather than the disclosure of its address in a repository.',
    },
  },
};

if (!existsSync(join(SOURCES, 'dora.txt'))) {
  console.error('feed/sources/ is not populated. Without the instruments there is nothing to verify a quote against.');
  process.exit(2);
}

let anyBad = 0;
for (const key of Object.keys(FRAMEWORKS)) {
  if (only && only !== key) continue;
  const F = FRAMEWORKS[key];
  if (!existsSync(join(SOURCES, F.doc + '.txt'))) {
    console.error(`${key}: feed/sources/${F.doc}.txt is not cached; skipping`);
    anyBad++;
    continue;
  }

  const rows = [];
  const unmapped = [];
  for (const rule of [...CATALOGUE.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (F.unmapped[rule.id]) { unmapped.push({ ruleId: rule.id, why: F.unmapped[rule.id] }); continue; }
    const clause = F.perRule[rule.id] || (isExfil(rule) ? F.exfil : null) || F.perSet[rule.set];
    if (!clause) { unmapped.push({ ruleId: rule.id, why: `no clause decided for rule set '${rule.set}'` }); continue; }
    const c = F.clauses[clause];
    if (!c) { console.error(`${key}: ${rule.id} maps to ${clause}, which is not declared`); anyBad++; continue; }
    rows.push({
      kind: 'compliance',
      ruleId: rule.id,
      framework: F.id,
      clause: F.prefix + clause,
      title: c.title,
      rationale: `The rule reports: ${rule.text}. ${F.frame[clause]}`,
      source: { doc: F.doc, retrieved: RETRIEVED, quote: c.quote },
    });
  }

  // A clause declared and never used is the shape of a mapping intended and then forgotten - it
  // happened once with the channel sinks, which sat under the wrong clause while the one written
  // for them went unused. Declaring one now costs a failure, not a silence.
  const used = new Set([...rows.map((r) => r.clause.replace(F.prefix, '')), ...F.documentLevel]);
  const orphans = Object.keys(F.clauses).filter((c) => !used.has(c));
  if (orphans.length) { console.error(`${key}: clause(s) declared but mapped to nothing: ${orphans.join(', ')}`); anyBad++; continue; }

  let bad = 0;
  for (const row of rows) {
    const problems = verifyRow(row, { sourcesDir: SOURCES });
    if (problems.length) { bad++; console.error(`${key}: REJECTED ${row.ruleId}: ${problems.join('; ')}`); }
  }

  const byClause = {};
  for (const r of rows) byClause[r.clause] = (byClause[r.clause] || 0) + 1;
  console.log(`\n${key} (${F.instrument}): ${rows.length} rows, ${rows.length - bad} pass the gate, ${unmapped.length} deliberately unmapped`);
  for (const [c, n] of Object.entries(byClause).sort()) console.log(`  ${c.padEnd(20)} ${n}`);
  for (const u of unmapped) console.log(`  unmapped: ${u.ruleId}`);

  if (bad) { anyBad += bad; continue; }

  if (write) {
    const doc = {
      schemaVersion: 1,
      framework: F.id,
      instrument: F.instrument,
      source: F.source,
      retrieved: RETRIEVED,
      verified: 'Every quote was matched verbatim against the cited instrument. The choice of clause is a human judgement and has not been reviewed by a qualified assessor.',
      coverage: F.coverage,
      appliesToTool: F.documentLevel.map((c) => ({ clause: F.prefix + c, title: F.clauses[c].title, quote: F.clauses[c].quote })),
      // Rules this framework does not cover, and why. A matrix that hides its gaps invites the
      // reader to assume it has none.
      unmapped,
      rows,
    };
    writeFileSync(join(HERE, '..', 'rules', F.out), JSON.stringify(doc, null, 1) + '\n');
    console.log(`  wrote rules/${F.out}`);
  }
}

for (const [name, b] of Object.entries(BLOCKED)) {
  if (only && only !== name) continue;
  console.log(`\n${name} (${b.instrument}): NOT STARTED`);
  console.log(`  booklets:  ${b.booklets.join('; ')}`);
  console.log(`  licensing: ${b.licensing}`);
  console.log(`  blocked:   ${b.obstacle}`);
  console.log(`  to start:  ${b.toStart}`);
}

if (!write) console.log('\n(dry run; pass --write to emit the mapping files)');
process.exit(anyBad ? 1 : 0);
