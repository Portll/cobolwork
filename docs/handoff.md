# Maintainer notes

For someone picking up cobolwork's analysis work: where it stands, what was measured and how, the
things that will bite you, and a researched plan for what to build next. [`BACKLOG.md`](../BACKLOG.md)
is the record of what is open; this is the context that makes it readable. Written in September
2026, after the vulnerability work of the 21st to the 24th.

---

## Where it stands

At this file's last commit, **516 tests pass run serially, and all 93 bench cases score as declared** -
but read the first trap before you believe a failure or a pass.

Thirteen rule sets - the nine below, plus `web`, `compile`, `priv` and `log` - and 156 rules in the
catalogue, which also counts the gitleaks credential rules and `diff`'s.

### What September 24 added

A list of gaps in the engine and the tooling around it was worked through that day. What landed:

| Row | Commits | On real code |
|---|---|---|
| Statement order through `PERFORM`; allow-lists as checks | `de71880`, `f9781e5` | CardDemo: three subscripts and `CORPT00C`'s job submission move to `checked`, stopped by checks that run on every route |
| The AID-key sign-on bypass | `a76c35f` | 5 distinct sign-on programs in the corpus; none has a route around its check; CardDemo's is rightly quiet |
| Transactions as entry points | `54c28a7` | every finding names the transaction or job step that starts its program |
| Non-numeric input into arithmetic; loop bounds from input | `7b69942` | 3 arithmetic findings over the 57 repositories read completely |
| BMS maps, and a protected field used as a record key | `bfc7f14`, `21eb1df` and the commit after it | names match all 5,265 in CardDemo's generated copybooks; 3 findings in CardDemo, each a list row's ID carried to the program that views (medium), or updates or deletes (high), that record |
| Code that cannot compile | `a03c601`, `4c6a44e` | see BACKLOG's measurement |
| Production data in non-production jobs | `55cb9d7` | - |
| Dataset lineage through utilities | `232b7da` | 6 of the 34 worklist targets, each citing its IBM page |
| More outbound channels | `2d30235`, `1915eb1`, `cd4b500` | CardDemo's `FTPJCL` logs on with a password in its input, now reported |
| `COPY` resolved as the build resolves it | `00cfcc7` | seeded recall 75 of 75; 224 resolutions moved, every one from a program to a copybook |
| Stable finding identity; baselines that expire | `dfcefc8`, `c67cc84` | commitwork's lane keys on the fingerprint |
| Precision tools; A/B measurement; estate facts from JCL | `33b08b2`, `bb9d5bb`, `6b8829d`, `d5c1b71` | the labelling itself is not started |
| A customer advisory feed | `ca25481`, `818ce14` | - |
| N-LOG's taint half (from the z-sibling list) | "feat: terminal or web input written unchecked to a log, and a system response code sent to a web client, are reported" | outside input written unchecked to a log: GenApp's `LGSTSQ` writes terminal input to CSMT; a system response code sent to a web client: no witness, as nothing in the corpus uses the CICS web API |

Not done, and why: change review in pull requests (`cobolwork diff --format sarif` is ready; the
review lane that would post it is not); the parser re-grade (it needs GnuCOBOL); MCP and HTTP. The
terminal UI and `cobolwork explain` have their first slices in (`5fb1f65`), and the remediation
pipeline's deterministic step is `cobolwork gate`
([`docs/spec/remediation-gate.md`](spec/remediation-gate.md)); the pipeline around it is
commitwork's and is not built.

### What the September 21 round added

That work turned cobolwork from a tool that found injection into one that catches the classes COBOL
actually has, each measured over a 125-repository public corpus before it landed:

| Commit | What it catches | On the corpus |
|---|---|---|
| `0ac960b` | A callee declaring a parameter longer than its caller passes | 251 past the caller's record, 250 of them generated code; the hand-written defects stay inside the record |
| `3a87b25` | Input written into a job the internal reader submits - batch `SYSOUT=(c,INTRDR)`, or `WRITEQ TD` to a queue the CSD maps to a DD the estate declares | 16 repositories write to queues nobody declared, and report the rule has not run |
| `ed81206` | Input deciding a subscript, a reference-modification start or length, or an `OCCURS DEPENDING ON` count | 22 distinct findings, 18 lowered by a real bound or class test |
| `39c1799`, `f0049fc` | A path through a checked field is lowered one step and names the check - including checks written as `EVALUATE`/`SEARCH` branches | lowers 1 of 125 injection findings; its value is in the bounds rules, where checks are the norm |
| `c28f46f` | Taint in a group reaches a table inside it | what makes AWS CardDemo's job submission visible; +10 findings in ACAS |
| `0904731` | Input reaching a table through an `INDEXED BY` name | nothing: 103 repositories read completely by both engines, no finding changed. The corpus does not index a table by what the user typed; an estate might |
| `7c3126a` | The estate states its compiler options (`compilerOptions`); `SSRANGE` lowers bounds findings | - |
| `6b29404` | `bench/seed.mjs`: plants a flaw in a real program and asks whether the rule sees it | 72 of 75 |
| `6f7e983` | `measure-rules` counts each finding once per file content and prints the top repository's share | - |

The flagship result: CardDemo's `CORPT00C` builds a job from dates the user typed and submits it
through the internal reader. With the estate's `INREADER` DD declared, cobolwork reports it at
`CORPT00C.cbl:517` as `cics-terminal-to-internal-reader`, lowered from critical to high because the
dates are tested `IS NOT NUMERIC` at `:329` - a validated path to a submitted job, reported and
credited. The evaluation that planned all of this, with every count it used, is
[`evaluations/2026-09-21-vulnerability-extensions.bifocal.json`](../evaluations/2026-09-21-vulnerability-extensions.bifocal.json).

---

## Traps

Each one is here because it already cost time.

### The machine is part of the test

The rule sets walk the tree inside a memory guard, and `available` is `min(heap headroom, freemem)` -
**the whole machine's free memory**, not the process's. The measurements in this file were taken on
a machine with **0.1 to 0.4 GB** free, and at that level scans stop early: a corpus run had 21 and
then 42 of 125 repositories stop at the memory reserve, and the whole-benchmark test
(`test/review.test.mjs`) failed 21 cases that pass alone.

- Always `node --test --test-concurrency=1 test/*.test.mjs`. `npm test` is parallel.
- One heavy job at a time. A corpus measurement and a test run side by side poison both.
- A failing test that runs a scan: rerun it alone before believing it. A test that must not depend
  on free memory gives the guard nothing to stop: a tree with no file a set reads.
- A corpus number: check how many repositories stopped (`coverageIncomplete`, `stoppedBy`) before
  quoting it, and compare two engines only on repositories both read completely.
- Comparing two versions of the engine: run each in its own process, one after the other. Both in
  one process doubles the memory, and the second one's repositories stop early.

### The corpus has three kinds of population artefact, not one

1. **Generated volume repositories.** `JMRoldanF__volume-100k` is 80% of the corpus by file count and
   `JMRoldanF__volume-10k` is a second; `--skip volume` catches both.
2. **Copies.** AWS CardDemo is in **12 of 126** repositories. Its report program is the only public
   internal-reader case, and its menus dominated the first bounds count.
3. **Generated directories inside real repositories.** One repository's directory of generated
   programs held 300 of the CALL-size rule's 340 findings.

`diag/measure-rules.mjs` now prints each rule's distinct count (byte-identical files counted once)
and its top repository's share. Read those before the raw count. And count witnesses in COBOL files,
not all files: two of this round's counts were wrong because language-server grammars and a Java
test suite in the corpus mention `SSRANGE` and `SPOOLOPEN`.

### The parser has not been re-graded since these changes

`diag/grade-against-gnucobol.mjs` needs GnuCOBOL, which the machine this work was done on did not
have, so the parser changes of this round were checked against the committed goldens (18 cases,
captured from `cobc` listings), not re-graded. Every change was additive to the parsed statement - `indexes`,
`ops`, `WHEN` conditions, `options`, `dependingOn` - except two that change what flows: a
`PERFORM`'s `UNTIL` test is no longer read as data moving into its `VARYING` variable, and a `COPY`
prefers a copybook to a program of the same name. The second was compared with its parent over
9,005 programs instead (BACKLOG, under seeded recall). Re-grade on a machine with `cobc` before
anyone quotes the parser's accuracy again.

### The flow graph has order now, and one approximation remains

- **A check counts where it has run on every route before the use** (`lib/control.mjs`), through
  `PERFORM` ranges and `GO TO`. Still not read: a flag a failed check sets and a later test reads,
  which lowers a route rather than clearing it, and control entered by `EXEC CICS HANDLE` or a
  declarative, which is entered knowing nothing.
- **A table element stands for every element.** When taint enters a table, the trace names the
  element without saying which occurrence. ACAS's ten new findings each show a 20-hop trace through
  its file-definition table; the route is real, the trace is the weakest kind the tool prints.

### The public advisory record is large, and it is not the same record as the loaded one

`rules/advisories.json` holds the advisories against products a build file pins a version of, which
is what version arithmetic can act on. The mainframe's own record is separate and much larger: 161
advisories across z/OS, CICS TS, CICS TX, TXSeries, Integration Bus for z/OS, App Connect
Enterprise, WebSphere on z/OS, IBM HTTP Server and the CICS Transaction Gateway, swept by
`diag/sweep-z.mjs` and held with a verdict each in `feed/worklists/z-attack-classes.json`. Nothing
in a COBOL repository pins a z/OS version, so those rows drive rule design rather than version
matching - see [`docs/spec/z-sibling-rules.md`](spec/z-sibling-rules.md).

What the IBM Z and LinuxONE Security Portal adds is the part that is not public, for an estate that
has registered access to it. That is a feed the customer brings, never one this repository ships.

### Estate facts decide whether three rules run

`cobolwork.site.json` now carries production names (recon), internal-reader DDs and queues (flow),
and compiler options (bounds severity). Without the relevant facts a rule reports that it has not
run - `setIncomplete`, surfaced as `setsIncomplete` - rather than a clean result. That is by design.
Do not "fix" it by guessing.

### Older, and still true

- **A CI run that fails every job in seconds may not have run at all.** `gh api
  repos/Portll/cobolwork/check-runs/<id>/annotations` tells a refusal to start - an exhausted
  Actions budget, as on this repository from 2026-09-20 - from a real failure.
- **`lib/diff.mjs` deliberately does not use `git archive`**, which applies `export-ignore`.
  `test/sources.test.mjs:144` guards it.
- **Containment is a filesystem fact and a vulnerability class.** `realpathSync` in `lib/parser.mjs`;
  six tests pin it. The new CSD reader reads through the source tree, so it inherits containment -
  keep any new input type the same way.
- **The source budget is cumulative per repository**, so which files survive depends on sort order.
- **Structural tests go vacuous when you move files.** Plant a violation and watch the test fail.
  Every rule this round was checked that way.
- **A fixture must not be able to graduate** (`test/fixtures/packs/unmeasured.json`).

---

## What is measured, and what is not

**Measured, over the corpus with volume repositories and test paths out:** each new rule's count,
distinct count and repository spread (the table above); seeded recall, 75 of 75 across three
operators since a `COPY` prefers a copybook to a program of the same name (72 of 75 before, the
three misses one program the wrong resolution made a host);
the volume the bounds rules would carry if file records were followed, at least 1,439 subscript
findings against 22 from outside input.

**Not measured, and stated as such:**

- **Precision on real code.** Every rule's precision is still measured on cases this project wrote.
  A hand-labelled corpus is the only independent witness. The tools for it exist
  (`diag/label-sheet.mjs`, `diag/score-corpus.mjs`); the labelling is not started.
- **The 2026-09-24 rules over the whole corpus.** The arithmetic and loop-bound rules were counted
  over the 57 repositories a loaded machine read completely, the protected-field rule over CardDemo,
  and the sign-on bypass with the CICS set alone.
- **The internal reader on a real estate.** The one positive is CardDemo with a declaration written
  here. No public estate ships its region JCL.
- **The vendor packs and the recon production-name rule**, as before: they need a practitioner or a
  private estate.
- **The parser against GnuCOBOL** since this round's changes (above).

---

## What to do next

In order. Each item says what it is worth and what it costs.

1. **Run CI again.** Nothing since 2026-09-20 has been through it; the serial suite and the bench
   were run by hand on every change instead. A trimmed matrix (ubuntu on Node 18 and 24, windows on
   18) costs about a thirteenth of the matrix as written, if minutes are ever short again.

2. **Label the corpus.** `diag/label-sheet.mjs` writes a blind worksheet and a sealed answer key;
   `diag/score-corpus.mjs` turns labelled rows into precision and recall per rule. The labelling is
   20-35 hours of a person and cannot be compressed, and until it is done no rule's precision has an
   independent witness.

3. **Re-measure on a quiet machine.** The 2026-09-24 rules were counted on partial runs (above).
   `diag/measure-rules.mjs --baseline` compares two runs over what both read completely.

4. **Install GnuCOBOL and re-grade the parser** - the `UNTIL` and `COPY` changes stand on corpus
   comparisons until then.

5. **A review lane that posts `cobolwork diff --format sarif` on a pull request.** The cobolwork
   half exists.

6. **What the protected-field rule does not read yet**: an attribute a program sets at run time by
   moving `DFHBMPRO` or the like into `NAMEA`, and a key used in an SQL `WHERE` rather than as
   `RIDFLD`. `cics-transfer-to-variable-program` could now also say which program the variable
   holds.

7. **The remaining rules** in [`docs/spec/z-sibling-rules.md`](spec/z-sibling-rules.md), in the
   order its section 6 gives. `N-PRIV` and both halves of `N-LOG` have landed.

---

## New functions, researched

Sources: the categories OpenText Fortify ships for COBOL (18, taken from the Sonar bridge plugin's
`rules-cobol.xml`); NetSPI's "Conquering CICS: 7 Ways to Hack Mainframe Applications"; the SHARE
article "CICS Vulnerabilities Uncovered"; what `hack3270` and `CICSpwn` do to a CICS application;
IBM's Enterprise COBOL and CICS documentation; NVD. Witness counts are over COBOL and BMS source in
the corpus, with volume repositories and test paths out; the figure in brackets leaves out CardDemo's
12 copies, which dominate several of them.

### Rules

| | Function | Class | Where the idea comes from | Witnesses | Needs | Verdict |
|---|---|---|---|---|---|---|
| N1 | **Unvalidated numeric input into arithmetic.** Terminal or web input reaching `COMPUTE`/`ADD`/... on a numeric field with no `IS NUMERIC` test on the path. Non-numeric data in a numeric field abends the transaction (S0C7, ASRA in CICS). | CWE-1287, CWE-754 | `hack3270` sends non-numeric data to numeric fields; IBM on S0C7 | BMS `NUM` fields in 27 repositories (16 outside CardDemo); `IS NUMERIC` tests in 86 (74). The rule's own count waits for the rule | A sink kind on arithmetic operands; the guard model's class tests; `NUMPROC` from `compilerOptions` | **Do first.** Small. CardDemo tests `IS NOT NUMERIC`, so it is the negative case already. |
| N2 | **A trusted hidden or protected screen field.** A `DFHMDF` field defined `DRK`, `PROT` or `ASKIP` whose received value decides a sink, a write, or a transfer. A modified 3270 client edits any of them. | CWE-472, CWE-602, CWE-642 | NetSPI ways 3 and 4; SHARE; `hack3270`, `wc3270_hacked` | BMS fields in 28 (17); `DRK` fields in 23 (12) | A BMS reader: map field attributes joined to the symbolic map the program receives | **Highest value.** Medium-large, because of the reader. |
| N3 | **Input choosing a record key.** Terminal or web input as `RIDFLD`, an SQL `WHERE` host variable, a DL/I SSA key or an MQ queue name, with no authorization check in the program. | CWE-639 | Fortify: Access Control - Database, DLI, MQ | `RIDFLD` in 26 (14); DL/I calls in 16 (7); `QUERY SECURITY` and `ASSIGN USERID` in none | Sink kinds only. The hard part is "authorized", and `QUERY SECURITY` appears nowhere in the corpus | **Ship as `context`, not as a defect.** A list of what input selects is what a reviewer wants; a defect claim would fire on every CICS inquiry program. |
| N4 | **A program that checks passwords itself.** A password field read from a file or table compared with terminal input; worse if folded with `UPPER-CASE` first. | CWE-256, CWE-287, CWE-178 | NetSPI way 2; Fortify: Password Management | Password comparisons in 24 (12); `UPPER-CASE` of a password in 14 (2) | Source kinds that exist; field names containing `PASS`/`PWD`, which is a name heuristic | Medium value. Say it is a heuristic. |
| N5 | **Entry points.** Which transaction (CSD `DEFINE TRANSACTION ... PROGRAM`) or job step reaches each finding; programs nothing starts. | - (enumeration) | The original proposal's P5 | CSD in 20 repositories, 9 independent of CardDemo | `lib/csd.mjs` already parses transactions | **Do early.** Changes how findings are read, not what is found. |
| N6 | **A diagnostic leaked to the screen.** `SQLCODE`, `SQLERRMC` or an EIB response reaching `SEND MAP`, `SEND TEXT` or a web response. | CWE-209, CWE-497 | Fortify: System Information Leak | `MOVE SQLCODE`/`SQLERRMC` in 31 (22), moved somewhere - not yet counted reaching a screen | A source kind for SQLCA and EIB fields; screen sinks | Small. Low severity; most are harmless. |
| N7 | **A loop bound from input.** `PERFORM VARYING I ... UNTIL I > N` with `N` from input and `I` subscripting a table. | CWE-129 | This round's `UNTIL` fix gave it up | - | A sink on relational `UNTIL` operands when the counter subscripts | Small. Completes the bounds rules. |
| N8 | **Routing by input.** Input deciding `SYSID(...)`, or the resource of an `EXEC CICS SET`. | CWE-15 | Fortify: Setting Manipulation | `SYSID(variable)` in 14 (2); `EXEC CICS SET` in 10 (10) | Sink kinds only | Small. |
| N9 | **An ignored condition.** `NOHANDLE` with no `RESP`, `IGNORE CONDITION`. | CWE-252, CWE-391 | Fortify: Poor Condition Handling | `NOHANDLE` in 14 (2) | Construct rule | Low severity, high volume. Last. |

By 2026-09-24, N1, N2, N5 and N7 had landed (above). N3 landed in part, as N2's record-key sink for
a key a program kept in a protected field, where a key the user typed stays unreported as the table
advises. N4, N6, N8 and N9 are not started.

**Researched and not worth writing now:**

- **XML external entities.** IBM's documentation says the Enterprise COBOL parser processes neither
  the internal nor the external DTD subset and has no entity resolver. Not a COBOL problem.
- **Cross-site scripting and header manipulation through CICS web** (Fortify's categories).
  `WEB SEND`, `DOCUMENT CREATE`/`INSERT` and `WEB WRITE HTTPHEADER` appear in no COBOL file in the
  corpus. Unmeasurable here.
- **Job submission through `SPOOLOPEN`/`SPOOLWRITE`** (NetSPI way 7). Real, and a third route to the
  internal reader, but no COBOL program in the corpus uses the spool API. The one match is a Java
  test suite. Cheap to add beside the existing rule once an estate needs it.
- **Log forging** was on this list because `DISPLAY` is everywhere. Restricted to terminal and web
  input, which a batch job's own log never holds, it landed as `cics-terminal-to-log` and
  `cics-web-to-log`, and over the witness repositories it found one program: GenApp's `LGSTSQ`.
- **Weak cryptography.** No ICSF call (`CSNB*`, `CSNE*`, `CSFP*`) anywhere in the corpus.
- **Authentication bypass through AID keys** (NetSPI way 6: PF2 before sign-on) was on this list
  for want of statement order. It landed with order, as `cics-signon-bypassed`.

### Tools

| | Function | Why |
|---|---|---|
| T1 | `diag/measure-rules.mjs --baseline <old.json>`: print, per rule, what a change added and removed, only over repositories both runs read completely. | Every engine change this round needed an A/B, and the only honest one compares complete runs. Landed, `6b8829d`. |
| T2 | `diag/measure-rules.mjs --list <rule>`: every finding for a rule, distinct by content, with its trace. | Reading findings is how every wrong conclusion this round was caught. Landed, `6b8829d`. |
| T3 | `diag/label-sheet.mjs` and `diag/score-corpus.mjs` | The labelling tools of next step 2. Landed, `bb9d5bb`. |
| T4 | `diag/propose-site.mjs` extended to draft `internalReaderDds` from region JCL and `compilerOptions` from compile PROCs, for a person to confirm. | The three estate facts are what make three rules run. Landed, `d5c1b71`. |
| T5 | A customer advisory feed: an import for the estate's own IBM Z Security Portal extract, checked by the same gate, never committed. | Reaches the non-public half of the record. Landed as "feat: a customer's own advisory extract is loaded for a scan, held to the published rows' shape, and named in the report": `--advisories` (`893ae5d`), `COBOLWORK_ADVISORIES` or `advisoryFeeds`. |
| T6 | SARIF `partialFingerprints` | So a finding keeps its identity across runs and `diff` can say fixed or new. Landed, `dfcefc8`, with baselines in `c67cc84`. |

---

## Decisions

Open: **where the parser is re-graded**, which needs a machine with GnuCOBOL.

Decided on 2026-09-24, and recorded so they are not reopened by accident:

- **BMS is the first language read after COBOL, JCL and the CSD**, because N2 was waiting for it.
- **`COPY` resolution** prefers a file that is not itself a program ("feat: a COPY takes a
  copybook over a program of the same name"). It departs from `cobc` run from the source's
  directory only where `cobc` would paste one program into another, which does not compile, so no
  graded program changes.
- **Equality counts as a check where it limits the value**: an `EVALUATE` whose `WHEN OTHER`
  rejects, or a test whose failing branch leaves, stops a route for the sinks a literal set is safe
  for. Equality that only chooses a branch still does not.
- **Checks are ordered** through `PERFORM` and `GO TO` (`lib/control.mjs`); a check counts only
  where it has run on every route before the use.

---

## How to check any claim in here

`node diag/measure-rules.mjs <corpus> --skip volume --exclude-paths
tests/,test/,/fixtures/,conformance/,/nist/,/samples/,/examples/ --max-source-bytes 268435456`
reproduces the per-rule counts, `node bench/seed.mjs <corpus> --per-operator 25 --skip volume` the
seeded recall, and `node bench/run.mjs` the bench. `--baseline` and `--list` on the first do what
the scratch scripts behind the older A/B comparisons did. If a number here disagrees with the tree,
the tree is right.
