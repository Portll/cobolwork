# cobolwork

[![CI](https://github.com/Portll/cobolwork/actions/workflows/ci.yml/badge.svg)](https://github.com/Portll/cobolwork/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-informational)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-informational)](package.json)
[![Licence](https://img.shields.io/badge/licence-AGPL--3.0--or--later-informational)](LICENSE)

Cobolwork offers security analysis for COBOL, JCL and CICS, with no runtime dependencies. It reads
the source the way a compiler does and follows untrusted data across program boundaries.

It runs on its own. It can also run as a lane inside commitwork, Portll's CI and security runner.

## Why it exists

Nothing open source reads COBOL for security. Measured 2026-09-16: Semgrep, CodeQL, SonarQube
Community Edition and PMD ship no COBOL rules; gitleaks and TruffleHog have no rule for a RACF
password, a JCL `PASSWORD=` or a TSO logon; NIST's SARD holds zero COBOL cases. The one open-source
COBOL scanner, VisualCodeGrepper, matches regular expressions within a single file.

Meanwhile a Semgrep run over a COBOL-only repository loads three thousand rules, reads none of its
COBOL, exits zero and reports a clean result.

## Install

    npm install -g @portll/cobolwork
    pip install cobolwork

Either installs the command `cobolwork`; the PyPI package runs the same files with the Node.js on
your PATH. The same package is attached to each
[release](https://github.com/Portll/cobolwork/releases) as `cobolwork-<version>.tgz`, which is the
one to pin, and as `cobolwork.tgz`, which
`npm install -g https://github.com/Portll/cobolwork/releases/latest/download/cobolwork.tgz`
follows. To run from a checkout instead:

    git clone https://github.com/Portll/cobolwork && cd cobolwork && npm link

Node 22 or later. No dependencies, runtime or development. `npm link` puts `cobolwork` on your PATH;
adding `bin/` to PATH does the same thing. GnuCOBOL is needed only to regrade the parser or validate
benchmark cases. In a GitHub workflow, `uses: Portll/cobolwork@main` runs the build gate on a pull
request and writes SARIF for code scanning: [docs/github-action.md](docs/github-action.md).

## What it does

| Command | Information |
|---|---|
| `cobolwork scan <path>` | every rule set below, as JSON or SARIF |
| `cobolwork inventory <path>` | inventory (and what couldn't be read) |
| `cobolwork flow <path>` | where untrusted data reaches a sensitive operation, with the path it took and whether an attacker can use it |
| `cobolwork diff <repo> --base <ref>` | what a change reaches: layouts it moves in programs nobody edited, new call targets, findings it adds or removes |
| `cobolwork build <repo> [--base <ref>] [-- <compiler> …]` | the build gate: every finding ranked LOW to KNOWN-EXPLOITABLE, the build stopped on the ones the policy blocks and on compiler options that let a bad index corrupt storage, and the compiler run only on a pass |
| `cobolwork parse <file>` | one file's structure, for debugging |

## What it finds

| Area | What is reported |
|---|---|
| Data flow | untrusted input - the command line, a job's `PARM` or in-stream data, a CICS terminal or web request - reaching an OS command, dynamic SQL, a dynamic `CALL`, `LINK` or `XCTL`, a file name, the internal reader, a subscript or length, decimal arithmetic, a record key or a log, across programs |
| Checks | a check counts only where it runs first, on every route; one that leaves the value safe for the sink clears the route |
| Screen fields | a field the BMS map protects, read back and used to choose a record: the 3270 hidden form field |
| Exfiltration | database rows and file records leaving through web calls, sockets, MQ, extrapartition queues or service calls |
| CICS and CALL | a communication area read without `EIBCALEN`, a transfer to a variable program, a length longer than the area or the callee, a route around a sign-on |
| Privilege and logs | diagnostic transactions installed, command security off where it is used, credentials or personal data written to a log, input forging a log line, system error codes sent to a web client |
| JCL | credentials and security commands in in-stream data, destructive statements, `DLM=` tricks, FTP in cleartext or sending production data, production data touched by a test job |
| The source | names nothing declares (code that cannot compile), shadowed copybooks, payloads hidden in columns 73-80 or aimed at AI readers |
| The estate | production names outside production jobs, routable addresses, compiler and runtime versions with published advisories |
| Assembler | a switch to key zero or supervisor state, an instruction run through `EX`, cross-memory calls, the security product called directly, and the CSECT or ENTRY a COBOL `CALL` or a job step reaches |
| Cryptography | a single-length DES key, an MD5 or SHA-1 hash, or a fixed initialization vector asked of ICSF, read from IBM's parameter lists; an outbound CICS connection asking for HTTP |
| Secrets | a credential written into a program or copybook: a literal `VALUE` on an item named for one, or a literal password in `EXEC SQL CONNECT` or `EXEC CICS SIGNON` |

HLASM is read, not assembled: its statements are read from the cards and its operations looked up
in a table that cites the IBM manual for each (`rules/hlasm-operations.json`). Macros are not
expanded and conditional assembly is not evaluated, so an operation a site macro issues is seen
where the macro is defined, and not where it is used.

[docs/rule-sets.md](docs/rule-sets.md) describes each in full, with what it deliberately leaves out.
Vendor packs for CA ACF2 and Top Secret, Control-M and Connect:Direct load only for estates that
name them, and `rules/gitleaks-mainframe.toml` gives gitleaks the mainframe credential shapes it
lacks.

## What a finding looks like

The flaw is in neither file on its own: one program reads the command line and hands it on, the
other runs what it was handed. Both commands below run against this repository, so every number
here can be checked.

    $ cobolwork flow test/fixtures/dataflow

```json
{
  "rule": "argv-or-env-to-os-command",
  "sev": "crit",
  "cwe": "CWE-78",
  "path": "pos/P2.cbl",
  "line": 10,
  "program": "P2",
  "crossProgram": true,
  "hops": 4,
  "detail": "Command-line or environment input reaches an operating-system command routine: ACCEPT ... FROM COMMAND-LINE at pos/P1.cbl:8 reaches CALL 'SYSTEM' USING WS-LOCAL",
  "trace": [
    { "program": "P1", "item": "WS-IN",    "file": "pos/P1.cbl", "via": "source" },
    { "program": "P1", "item": "WS-CMD",   "file": "pos/P1.cbl", "via": "MOVE at pos/P1.cbl:9" },
    { "program": "P2", "item": "LK-CMD",   "file": "pos/P2.cbl", "via": "CALL 'P2' argument 1 at pos/P1.cbl:10" },
    { "program": "P2", "item": "WS-LOCAL", "file": "pos/P2.cbl", "via": "MOVE at pos/P2.cbl:9" }
  ],
  "related": [{ "path": "pos/P1.cbl", "line": 8, "detail": "ACCEPT ... FROM COMMAND-LINE" }],
  "sources": 1,
  "evidence": "path",
  "fingerprint": "45e55b502c397a499cc29212c0c28329"
}
```

`crossProgram` marks a path that left the file it started in. A value a CALL writes back through a
parameter returns only to the call it came in through: in another caller's CALL the parameter is
that caller's storage. A value the subprogram keeps in its own storage can reach any later caller.
Findings carry no source text, so a report can be stored and passed on without carrying the code
with it.

`trace` is one route, the shortest, and sources that reach one sink are merged into one finding,
counted in `sources`. With `--all-routes`, `scan` and `flow` give each path finding `routes`: every
source, and every statement on any route from one of them to the sink, by verb, file and line.
`complete` is false where the walk stopped at its budget or a step has no statement the engine can
place. It leaves out no statement on a route the engine follows, and may name one no route takes:
what a reader needs before saying a run covered every route (`docs/spec/reach.md` §9.8). Routes
through what the engine does not read, such as an unparsed program or a caller written in another
language, are not in it.

`fingerprint` is what the finding is, rather than where it is printed today: the rule, the program
and the paragraph or section it sits in (the job, step and DD for JCL), and the flagged statement's
own text. No line number goes into it, so code added above a finding does not change it. `diff`
compares findings by it, and SARIF carries it as `partialFingerprints["cobolwork/v1"]`. Two findings
that only their position tells apart share one, and `summary.identity.shared` counts them.

### Findings and Claim Severity

Severity says how urgent a finding is. `evidence` says what the tool actually established, which
decides who acts on it. Every rule declares one of nine finding types:

| `evidence` | What the finding claims | Who acts |
|---|---|---|
| `path` | untrusted input was traced to a sensitive operation, and `trace` is the route | the program's owner |
| `construct` | the construct is a defect wherever it sits; no input has to reach it | the owner, or whoever can rotate a credential |
| `tampering` | the source is arranged so a reader or resolver sees something other than what runs | a reviewer, before merge |
| `advisory` | a pinned compiler or runtime matches a published advisory | whoever owns the build |
| `exposure` | information about the estate is written into source | the owner |
| `change` | a change moves an interface or adds a call target (`diff` only) | the reviewer of that change |
| `execution` | a run of the program on a recorded input ended this way, and the run's verified journal is the record | the program's owner |
| `coverage` | the analysis stopped following here | nobody's code; read more, or accept the limit |
| `context` | describes the estate (an entry point, a product in use) | nobody; it asserts no defect |

`coverage` and `context` are exactly the `info` rules (not defects). A consumer that counts these
findings should leave them out of its counts.

`path` is a route found by reading the code, not by running it. Its precision has been measured on
benchmark cases this project wrote, not yet on an independently labelled corpus.

### Can an attacker use it?

Every `path` finding carries a verdict, the facts it rests on, and the one fact that would change it:

| `exploitability` | What it means | What to do |
|---|---|---|
| `confirmed` | the estate's own test reproduced it, and brought the result as a witness feed | patch now |
| `exploitable` | input an attacker supplies reaches the operation with no check on every route, and the estate declares a transaction or job that carries it open to any user | patch first |
| `attacker-driven` | the same route, but nobody has declared who may start its entries | patch, or declare the entries |
| `restricted` | the same route, behind a control the estate named on every entry | patch; the control is not a check |
| `mitigated` | a check runs first but is not shown to stop the value, or SSRANGE turns an overrun into an abend | confirm the check |
| `upstream` | the value is a file record or database row, so whoever can write it drives it | review who writes the data |
| `refuted` | a check leaves only safe values, or no route reaches the operation | nothing |

For the terminal route to dynamic SQL in `test/fixtures/entry`, scanned with a site file that
declares its transaction open:

```json
"exploitability": {
  "verdict": "exploitable",
  "drivenBy": "A terminal user",
  "because": [
    "A terminal user supplies it: EXEC CICS RECEIVE at INQUIRY.cbl:10",
    "no check is shown to run on every route before the operation at INQUIRY.cbl:13",
    "started by transaction INQ1: open to any user, per cobolwork.site.json"
  ],
  "unknown": "whether it reproduces: a test on a system the estate owns, under its own authorisation, is the only confirmation",
  "fixAt": {
    "program": "INQUIRY", "path": "INQUIRY.cbl", "line": 11, "item": "WS-ACCT",
    "builtInto": { "item": "WS-STMT", "path": "INQUIRY.cbl", "line": 13 },
    "test": "before the STRING at INQUIRY.cbl:11 that builds WS-STMT, on every route to it, test WS-ACCT against a list of the values allowed (...), or WS-ACCT IS NUMERIC where it is a number, and let only a value that passes reach it; a static statement with host variables needs no test"
  }
}
```

`fixAt` is where one patch covers every route, with a test the analysis credits: patch it there, scan
again, and the finding moves to `refuted`. Where no test makes the operation safe, `why` says so and
the rule's remedy is the fix.

Who may start a transaction lives in RACF, not in a repository, so without it the strongest verdict is
`attacker-driven`, and `summary.reachNote` says how many that is. Name the entries in
`cobolwork.site.json` (`openTransactions`, `restrictedTransactions`, `openJobs`, `restrictedJobs`), or
bring a reduced RACF unload as `COBOLWORK_REACH`, which is refused from inside the scanned tree.
`node diag/propose-site.mjs <path>` lists the transactions and jobs to ask about, most findings
first, with the program each runs and any listener or URI map that puts it on the network; it
proposes none of them as open or restricted.

The tool never confirms a finding from reading: that needs a test on the running system. The estate
brings its own results as `COBOLWORK_WITNESS`, keyed by fingerprint with the outcome, who ran the
test, when and on which system, and refused from inside the tree like `COBOLWORK_REACH`. A reproduced
finding becomes `confirmed`; one the estate's test did not reproduce keeps its verdict and says so,
since a test that missed the route does not show it safe.
`summary.byExploitability` counts the verdicts, and a report holding an `exploitable` finding carries
`summary.handling`, because it is then a list of what to attack first. Upload it only where the RACF
facts behind it may go. [docs/spec/reach.md](docs/spec/reach.md) §9 is the full specification.

`COBOLWORK_EXECUTION` names reports `ironwork run --coverage` wrote from runs of the estate's own
tests. A finding inside a paragraph they cover carries `executed`, the paragraph and how often the
runs entered it, and `summary.byExecution` counts the findings in paragraphs entered and never
entered ([docs/spec/evidence.md](docs/spec/evidence.md) §13.5).

`COBOLWORK_ABENDS` names fuzz runs ironwork's harness wrote. Each abend an input caused becomes a
finding at the line it happened, with the input and the run's journal, once that journal verifies:
`input-causes-abend-s0c7`, `-s0c4` (in a CICS task, the ASRA whose message names that check),
`-subscript-range`, `input-causes-hang` for an input that keeps a loop running past the statement limit (S322), `input-selects-program`
for an S806 whose journal shows the input reaching the CALL, or `input-causes-abend` for any other
code ([docs/spec/evidence.md](docs/spec/evidence.md) §13.6). It reads manifests in format
`ironwork-fuzz/v1`, and reports one in any other format as a problem instead of guessing at it.

### What each finding lets someone do, and the fix

A defect finding carries two more facts, the same for every finding of its rule: what someone can do
once the route or construct is present, and the standard fix. They are what makes a `path` or
`construct` finding read as a hole to act on rather than a location. A report carries them once per
rule, keyed by rule id beside `ruleText` and `ruleCwe`, so a finding does not repeat them. For the
finding above:

```json
"ruleImpact": { "argv-or-env-to-os-command": "Whoever sets the program's command line or environment runs an arbitrary operating-system command with the program's authority" },
"ruleRemedy": { "argv-or-env-to-os-command": "Build the command only from fixed literals; never place input in the argument of CALL 'SYSTEM' or BPXWDYN. If it must vary, choose from an allow-list of known commands" }
```

The `who` is the finding's own — the entry points it carries in `startedBy` — and the impact
completes it. SARIF puts the impact in each rule's `fullDescription` and the fix in its `help`, which
is where GitHub code scanning shows a recommendation. The `info` kinds carry neither, because a fix
would assert a defect they do not claim; a site-gated rule carries them once the estate's fact turns
it into a defect, and not before.

### What it could not read

A scan says what each rule set read, not only what it found:

    $ cobolwork scan bench/cases --quiet

```json
"summary": {
  "findings": 127,
  "bySeverity": { "high": 28, "crit": 16, "med": 16, "low": 9, "info": 58 },
  "byEvidence": { "tampering": 6, "path": 31, "advisory": 1, "construct": 31, "coverage": 6, "context": 52 },
  "bySet": {
    "inventory": { "filesScanned":  83, "filesUnreadable": 0 },
    "flow":      { "filesScanned":  83, "filesUnreadable": 0 },
    "cics":      { "filesScanned":  42, "filesUnreadable": 0 },
    "hidden":    { "filesScanned": 116, "filesUnreadable": 0 },
    "copybook":  { "filesScanned":  88, "filesUnreadable": 0 },
    "jcl":       { "filesScanned":  28, "filesUnreadable": 0 },
    "build":     { "filesScanned":   2, "filesUnreadable": 0 },
    "recon":     { "filesScanned": 116, "filesUnreadable": 0 },
    "vendor":    { "filesScanned":   0, "filesUnreadable": 0 },
    "opaque":    { "filesScanned":  83, "filesUnreadable": 0 },
    "web":       { "filesScanned":   9, "filesUnreadable": 0 },
    "compile":   { "filesScanned":  83, "filesUnreadable": 0 },
    "priv":      { "filesScanned": 234, "filesUnreadable": 0 },
    "log":       { "filesScanned":  13, "filesUnreadable": 0 }
  },
  "coverageIncomplete": false,
  "setsIncomplete": [
    { "set": "flow", "kind": "configuration",
      "why": "6 EXEC CICS WRITEQ TD statement(s) write to an extrapartition queue, and nothing says whether it reaches the internal reader: name the region's INTRDR DDs as internalReaderDds (or the queues as internalReaderQueues) in cobolwork.site.json" },
    { "set": "jcl", "kind": "configuration",
      "why": "5 FTP transfer(s) send a named dataset, and cobolwork.site.json names no production qualifier, so the production-data rule did not run on them" },
    { "set": "recon", "kind": "configuration",
      "why": "no cobolwork.site.json: the production-name and production-dataset rules did not run, because nothing declares what production means in this estate" }
  ],
  "flowModel": "byte-range",
  "toolVersion": "0.2.90"
}
```

`coverageIncomplete` is the field to read first. An unresolved copybook, an unreadable file or a
symlink leading out of the tree sets it, because a finding count over source nobody read is not a
clean result.

Some rules need facts no repository holds: which dataset qualifiers are production, which DDs reach
the internal reader, the compiler options and runtime versions in use, which libraries are
authorised. They go in `cobolwork.site.json`, and `node diag/propose-site.mjs <path>` drafts one from
the estate's own JCL for a person to correct. Without a fact, the rule that needs it says it did not
run, under `setsIncomplete`, rather than reporting a clean result. The benchmark tree has no site
file, which is why three sets say so above. `advisoryCoverage` names the products the advisory rules
searched, so a scan with no advisory finding says what that silence covers.

### Findings someone has already judged

    $ cobolwork baseline . --reason "replaced by a fixed command table in Q1" --who jsmith --expires 2027-03-31

writes `cobolwork.baseline.json`, one entry per finding keyed by fingerprint: `accept`,
`false-positive` or `wont-fix`, with the reason, who, and until when. A later scan moves what it
covers into `suppressed`. Every suppression expires, and the finding comes back when it does. A
baseline inside the scanned tree cannot hide tampering - a hidden payload, or an instruction aimed
at an AI reader - so that takes `--baseline <file>` from outside the tree. `--no-baseline` applies
none.

## Stopping a build

`cobolwork build` is a CI step, and its exit status is its verdict: 0 pass, 1 fail, 3 undecided, 4 the
compiler failed after a pass, 2 it could not run. No model is asked anything; every check is the
engine's reading of the tree.

    cobolwork build . --base origin/main -- cobc -x -o payroll PAYROLL.cbl

By default HIGH, CRIT and KNOWN-EXPLOITABLE findings block, and so does any finding, at any tier,
that would let its author escalate privilege or change data: input choosing a command, a program, an
SQL statement or a job, or choosing which record is rewritten or where in storage a write lands. MED
and LOW findings outside those two classes are reported and do not block. With `--base`, a finding
blocks only if the change introduced it, except CRIT and KNOWN-EXPLOITABLE, which block wherever they
are; the change is judged by the policy, waivers and site file of its base, so it cannot relax its own
gate. An incomplete scan is undecided, never a pass.

The compiler options are held to the policy too. A program compiled without `SSRANGE`, or with
`SSRANGE(MSG)`, which reports a bad subscript and carries on, fails; for `cobc` the missing `-fec`
checks are added to the command, and for GCC's `gcobol` the missing `-fcobol-exceptions`. `cobolwork.policy.json` changes any of this, and `--policy <file>`
names an organisation's floor, which a repository can tighten and never loosen.
[docs/spec/build-gate.md](docs/spec/build-gate.md) is the full specification.

## How accurate it is

The parser is graded against GnuCOBOL's own listing (`cobc -t -Xref -ftsymbols`), which reports every
data item with the size the compiler computed, every label, called programs, and which references
write to a field. `diag/grade-against-gnucobol.mjs` runs that comparison over a corpus, on
repositories never used while building the parser. The 100 and 300 sets were measured 2026-09-18,
the 500 set 2026-09-26:

| Corpus | Files the compiler accepted | Data items | Sizes | Labels and calls |
|---|---|---|---|---|
| 100 repositories, held out | 489 | 100% recall, 100% precision | 0 disagree of 15,888 | 100% |
| 300 repositories, held out | 2,210 | 99.9% / 100% | 8 disagree of 94,786 | 100% / 99.7% |
| 500 repositories, held out | 21,624 | 99.98% / 99.998% | 5,881 disagree of 733,835 | 100% / 100% |

On the 500 set, 5,643 of the 5,881 size disagreements come from one repository that vendors a COBOL
research dataset; the other repositories disagree on 238 of 343,444. The grade covers only programs
GnuCOBOL accepts, so a program with EXEC SQL or EXEC CICS is graded only through the precompiler
stand-in in `diag/precompiler.mjs`, which rewrites what the parser would otherwise have to read. The
tests compare the parser with the compiler's answers kept in `test/fixtures/parser/*.golden.json`,
so they run without GnuCOBOL.

`bench/cases/` holds 102 CWE-labelled cases, each paired with a near-miss negative: the same shape
with the flaw removed. `node bench/run.mjs` scores any scanner's findings against them, by rule and
file, never by line, and `npm test` fails if any case scores differently from its declaration.
`--validate` compiles every COBOL case with GnuCOBOL and checks every JCL case against the
statement grammar, a weaker witness, and says so.

## Coverage on a busy machine

A scan stops before it exhausts memory, reports how much of the tree it read, and sets
`coverageIncomplete`. **Read that before the finding count.** On one 4,086-file repository a starved
run reported 26 findings and a clean one 2,890.

The number it watches is the lesser of the heap's headroom and the machine's free memory, and the
second is the whole machine. On a build agent running other jobs, or in a container whose limit is
smaller than the host, that means a scan's coverage is decided by what else is running. Say what your
share is and it will use that instead:

```sh
COBOLWORK_FREE_MEMORY_MB=4096 cobolwork .
```

It is a statement, not a limit: the heap is still watched, so an over-generous number does not turn
the guard off, it just stops the host's load from deciding. A spawned scan inherits this property.

## Compliance

Every rule is mapped to the clause of each framework that makes it an obligation, quoted verbatim,
and to a COBIT 2019 practice by identifier alone:

| File | Instrument | Rules mapped |
|---|---|---|
| `rules/compliance-dora.json` | Regulation (EU) 2022/2554 (DORA) | 207 |
| `rules/compliance-ffiec.json` | FFIEC IT Examination Handbook | 205, and 2 recorded as unmapped |
| `rules/compliance-nist80053.json` | NIST SP 800-53 Rev. 5.2.0 | 205, and 2 recorded as unmapped |
| `rules/compliance-cobit2019.json` | COBIT 2019 (ISACA), identifiers only | 205, and 2 recorded as unmapped |

A COBIT 2019 row names the objective or practice and gives this project's own rationale; no ISACA
text is reproduced, so reading what a practice says needs a copy of the framework. The practice is
chosen at the NIST control, through a crosswalk in `diag/map-compliance.mjs`, so it cannot drift
from the rule's NIST clause.

`node diag/map-compliance.mjs` refuses to write a quote the cached instrument does not contain, and
every scan carries the mapping as `ruleCompliance`. The clause choice is a judgement that no
qualified assessor has reviewed. Where no control genuinely covers a rule, as for committing an LPAR
name to a repository, the rule is recorded as unmapped with a reason rather than mapped to the
nearest control that reads plausibly. What else the mapping does not claim is in
[docs/rule-sets.md](docs/rule-sets.md#compliance).

## Tests

    npm test

Tests that need a tool which is absent record a skip naming it. A skipped check is not a passing one.
Open work is in [BACKLOG.md](BACKLOG.md).

## Security

Vulnerabilities in cobolwork itself go through [SECURITY.md](SECURITY.md), privately. A false
positive or a missed finding is an ordinary issue, and a wanted one: precision and recall are
measured and published here, so a report that moves either is the most useful thing you can send.

## Licence

AGPL-3.0-or-later. See [LICENSE](LICENSE) and [NOTICE](NOTICE). That covers this project's own work; material belonging to
others — AWS CardDemo fixtures, IBM interface layouts, quoted regulatory clauses — is listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) with its own licence.

If your organisation's policy refuses AGPL, [LICENSING.md](LICENSING.md) says what else is available
and what has to be true first. Running the scanner over your own source triggers nothing in the AGPL
that unmodified internal use does not already satisfy; that page explains why, which is often the
whole of the objection.
