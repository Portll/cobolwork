# Backlog

Open work, most useful first within each section. Each item says what was measured, where it
came from, and what finishing it would show. Items leave this file when they land, with the commit.

## Defences against automated intrusion

1. **Advisories the public record does hold.** `rules/advisories.json` holds fifteen, over the
   products a build file pins, and `advisoryCoverage` names which products were searched so a clean
   result over an unsearched one cannot read as a clean bill of health.

   The mainframe itself is a separate and much larger record: 161 advisories swept on 2026-09-24
   across z/OS, CICS TS, CICS TX, TXSeries, Integration Bus for z/OS, App Connect Enterprise,
   WebSphere on z/OS, IBM HTTP Server, the CICS Transaction Gateway and Tivoli NetView, held in
   [`feed/worklists/z-attack-classes.json`](feed/worklists/z-attack-classes.json) with a verdict
   each. None of them is loaded into `rules/advisories.json`, because nothing in a COBOL repository
   pins a z/OS version - they are input to rule design, not to version arithmetic, and
   [`docs/spec/z-sibling-rules.md`](docs/spec/z-sibling-rules.md) is what they were read for.
   `diag/sweep-z.mjs` re-runs the sweep and prints what the worklist does not hold;
   `diag/refresh-advisories.mjs` re-resolves what is loaded and exits non-zero on a mismatch.

2. **What is left of the twelve rules the public z record justifies, and what can witness them.**
   83 of 187 publicly named z vulnerabilities have a sibling in customer artefacts, and
   [`docs/spec/z-sibling-rules.md`](docs/spec/z-sibling-rules.md) designs the twelve rules that
   would report them. Two landed as the `web` set, and `N-BMS` as
   `cics-protected-field-to-record-key` ("feat: a key the program kept in a protected screen field
   is reported where it chooses a record"). `N-LOG`'s taint half landed as `cics-terminal-to-log`,
   `cics-web-to-log` and `system-response-to-web-response`: over the 16 repositories that write a
   log from a CICS program, one program writes terminal input to a log unchecked (IBM GenApp's
   `LGSTSQ`, to CSMT), and the response-code rule has no witness, since no repository uses the CICS
   web API. `N-RECVLIMIT`, `N-XXE`, `N-CONNSTR` and `N-CSRF` landed in "feat: the z/OS-derived rules
   the corpus left unbuilt, and N4, N6, N8, N9", all over fixtures with no measured rate:
   `*-to-storage-length` (a `GETMAIN` length or `CEEGTST` size from input), `*-to-xml-document`
   (input reaching `XML PARSE`, low, since whether a DTD is honoured is the `XMLPARSE` option's and
   that is not read), `*-to-connection-target` (a Db2 location or MQ queue manager from input; one
   CGI program in the 500-repository corpus), and the CSRF rule now counting SQL changes and started
   transactions. The handoff's `N4`, `N6`, `N8` and `N9` landed with them. Open: the `WEB RECEIVE`
   half of `N-RECVLIMIT`, which nothing in the corpus reads; `TRANSFORM XMLTODATA`; and the rest of
   `N-IDENTITY` and `N-CRYPTO`, ordered in section 6 of the design.

   Its section 5a is the constraint on all of them: no repository in the 127-repository corpus uses
   `EXEC CICS WEB` at all, against 42 that use `EXEC CICS` and 34 that send BMS maps, so every rule
   over the CICS web API - `N-COOKIE`, `N-HEADERS`, `N-CSRF` and `N-XXE` - has a benchmark case and
   no false-positive rate. That is the same gap already recorded for `BPXWDYN` and `DISPLAY UPON
   CONSOLE` below, and it wants a practitioner's estate, not more public repositories. `N-BMS` is
   the opposite case and the best-witnessed rule of the twelve: 31 repositories commit BMS map
   source, 25,701 `DFHMDF` definitions in all, and 34 send maps from COBOL, so its join was measured
   before it was written. In CardDemo, of 362 named fields in the maps its programs receive, 204 are
   read back and 137 of those are protected or dark - nearly all list-screen rows - so reading a
   protected field back is not the defect. Using it as a record key is: 3 findings, each a row ID a
   list program kept in an `ASKIP,FSET` field and passed on to the program that views a transaction
   (medium), or reads a user for update and then rewrites or deletes it (high:
   `cics-protected-field-to-record-update`, split out because a `REWRITE` or `DELETE` carries no
   key, so the `READ UPDATE` before it is where the record is chosen). Not yet read: an attribute a
   program sets at run time by moving `DFHBMPRO` or the like into `NAMEA`; a key used in an SQL
   `WHERE` rather than as `RIDFLD`; and the corpus beyond CardDemo, because corpus runs stopped at
   the memory reserve on the machine it was measured on.

## Exploitability: from verdict to witness

A prospective client could not tell from a report which programs an attacker could actually use, so
every path finding now carries an `exploitability` verdict ([`docs/spec/reach.md`](docs/spec/reach.md)
§9). On `bench/cases` with no site file it labels 23 findings `attacker-driven` and 8 `upstream`, and
none `exploitable`, because no repository says who may start a transaction. Each carries `fixAt`, a
test the check model credits placed before the operation. It names the value at the operation, not
the input before it was folded into a statement, so for a built SQL or command string the test it
names is on the whole string; naming the input field instead is open. `diag/propose-site.mjs` lists
the transactions and jobs to classify, with any listener or URI map in front of each; a program a
server `URIMAP` serves is started by its alias transaction. The estate's own test results, brought
as `COBOLWORK_WITNESS`, make a verdict `confirmed`. `explain` carries a verification plan per finding
(reach.md §9.7): the entry, the map and field, a harmless value, and what to watch for; for a sink
that acts it reads a marker at the operation and ends the task before it runs. What is left:

1. **A measured rate per verdict.** `diag/score-corpus.mjs` gives one from the sealed key, which now
   records each site's verdict, over the route half a public corpus can witness. The labels are
   what is missing: the hand-labelled corpus below is not started, and until it is a verdict is a
   claim over reading and records with no independent precision.

## Vulnerability classes, in the order they can be measured

Planned 2026-09-21 and evaluated in
[`evaluations/2026-09-21-vulnerability-extensions.bifocal.json`](evaluations/2026-09-21-vulnerability-extensions.bifocal.json).
The order is what a public corpus can measure, not what is cheapest to build: the first draft of
this plan was ordered by cost, and two of its claims failed on the first look at the corpus. Every
new rule declares an evidence kind and a compliance mapping, or an unmapped entry with a reason
(`test/compliance.test.mjs` refuses one without).

All five planned items landed on 2026-09-21. What they left open:

1. **A hand-labelled flow corpus**, as below under precision - still the only thing that would
   make any of these rules' precision a number with an independent witness. Seeded recall
   (`bench/seed.mjs`) measures the other direction, against the planter's idea of the bug.

2. **Bounds from data at rest - measured, and kept out.** Letting file records and database values
   into the bounds sinks produces at least 1,439 subscript findings and 75 reference-modification
   findings from file records alone, against 22 distinct from outside input - a lower bound, since
   21 repositories stopped at the memory reserve on a loaded machine. That is the size of batch
   COBOL, not a defect rate, and the exclusion stands until something can tell a record field that
   is validated upstream from one that is not.

3. **Checks in the order they run: what is left.** "feat: a check counts where it runs first, and
   clears a route where what it leaves is safe for the sink" reads each program's control flow, so a
   check is credited only where it has run on every route before the use, and a route it stops -
   an allow-list, digits for a command or a job, a bound for an index - moves to `checked`. On
   CardDemo it stopped three subscripts a `PERFORM VARYING ... UNTIL I > 7` bounds, and the
   report program's job submission: the typed dates are tested numeric on every route before they
   are built into the job, and a failing date returns to CICS first. Still not read: a flag a
   failed check sets and a later test reads (such a route is lowered, not cleared); and control
   entered by `EXEC CICS HANDLE` or a declarative, which is entered knowing nothing. The value a
   `MOVE` of a constant leaves is read ("feat: a constant a statement assigns counts as what the field
   holds"), so a length clamped to `LENGTH OF` its field is bounded and a field refilled with a
   literal before its use holds the literal. The
   AID-key sign-on bypass is written on top of it ("feat: a route to where a sign-on leads that skips
   the password check is reported"), with the sign-on read from field names. Measured on
   2026-09-24 with the CICS set alone, which read 111 of 125 repositories completely: no finding.
   Five distinct programs compare a password-named field with another field (32 copies). CardDemo's
   `COSGN00C` reaches its two menus only past the comparison and is rightly quiet. The other four -
   CardDemo's `COUSR02C`, two versions of BankDemo's `SBANK10P`, and `ESONP` - send nowhere that
   only the signed route reaches, so there is no granted target to bypass; BankDemo's sign-on
   signals success in a way the rule does not follow (a flag or a returned area, not a transfer).

4. **Non-numeric input into arithmetic, measured on half a corpus.** "feat: input reaching decimal
   arithmetic or the bound of a subscripting loop is reported" follows outside input to a zoned or
   packed operand, and a loop bound to its counter's table. Over the 125 repositories it found 3
   distinct arithmetic findings and no loop bound, but 68 of the 125 stopped at the memory reserve on
   a machine with 0.3 GB free, so it is a count over 57 repositories, not the corpus. Of the three,
   one was an INSPECT TALLYING count, now read as computed; the other two are CardDemo's date
   routine, whose year test does not run on the route where the year is blank, which leaves by an
   earlier GO TO; with checks ordered it is reported with the check it did not get. Re-measure on a
   quiet machine.

The estate can now state its compiler options (`compilerOptions` in `cobolwork.site.json`); the one
corpus repository that sets `SSRANGE` in a compile step does it in a PROC driven by `&MEMBER`, and
the earlier count of five was four syntax-grammar files and that one. Index names carry taint, and
EVALUATE and SEARCH branches are read as checks.

**Not measurable on the public corpus, and not queued.** Counted over the 126 repositories with the
generated ones out: `BPXWDYN` 0, `BPX1SPN`/`BPX1EXC` 0, a user id compared with a literal 0 in COBOL
(the one hit is PL/I), `DISPLAY UPON CONSOLE` 4, `EXEC CICS WRITE OPERATOR` 5. A rule over any of
these would ship with no measured rate, which is where the vendor packs already are; each needs a
private estate or a practitioner before it is worth writing. A date-triggered destructive branch is
the same, with the added problem that `CURRENT-DATE` appears in 71 repositories for ordinary
reasons.

## Precision and coverage, measured

**Execution labels, 2026-10-01 (roadmap 2.1, `bench/label.mjs`).** Over the 500 held-out
repositories with `COBOLWORK_FREE_MEMORY_MB=12288` (without it five repositories stop on the memory
guard), 3,591 path findings in 42 repositories, 2,889 of them in the research dataset: 34
confirmed, every one `cics-terminal-to-log` and two programs underneath (GenApp's LGSTSQ and the
health-API sample's HCAZERRS, in 8 repositories' copies). The rest are unknown, and why is what
to build next:
- 2,606 sinks ironwork has no trace for: `dynamic-file-path` 2,369 (ASSIGN to a data item, which
  ironwork does not run), then the storage sinks (`occurs-depending-count` 76,
  `reference-modification` 66, `subscript` 52, `loop-bound` 23), which wait on ironwork giving an
  SSRANGE violation its own abend code (ironwork-roadmap 5.8); `message-queue` 11 (no MQ).
- 384 sources not fed: `jcl-instream` 250, all in one repository, through `ironwork job`;
  `argv-or-env` 114, GnuCOBOL's ACCEPT FROM COMMAND-LINE and ENVIRONMENT, which ironwork refuses
  as not Enterprise COBOL; 12 `cics-protected-field`, which a terminal cannot type into.
- 323 in programs ironwork does not compile; 86 BMS maps not in the repository.
- 109 operations that ran without the marker in the operand, and 42 `cics-terminal-to-arithmetic`
  that ran through without a data exception, not yet read.

Found on the way: `lib/sets/flow.mjs`'s `scan()` given a relative root returns no findings and
reports its coverage complete (the CLI resolves roots, bench tools must); cobolwork reads no
symbolic map from a `.bms` where ironwork builds one, so a program that copies a mapset with only
its BMS source compiles in ironwork and has no terminal source in the scan.

**The 500-repository run, 2026-09-26.** Every set over all 500 held-out repositories, with
`COBOLWORK_FREE_MEMORY_MB=12288`; without it the same run read 156,184 of 274,087 files, because the
memory guard watches the whole machine and other jobs shared it. What is left open:

- **The grade's last misses.** 205 items missed and 13 invented of 862,929; 5,643 of the 5,881 size
  disagreements are one repository vendoring a research dataset. The rest, each read:
  - 184 receiving references missed, most of them a screen's `USING` field that an `ACCEPT` writes.
  - The 12 calls missed and 7 invented are two spellings of the same call: the listing prints
    `CALL x"AF"` as the byte and `CALL "BIN/OPEN-ACCOUNT"` as its last segment.
  - Reference states: 990 of 796,118 disagree. 881 are a listing quirk in `Grandez_Serendipity`,
    where every program writes `CALL TRAP OF Sxxx USING … Sxxx`: when a name's first use on a line
    is a qualifier it does not need, cobc drops that line's reference to it altogether, so the
    group reads as referenced only by its child. The parser is right there and is left so. The
    other 109 are not read.
- **Programs the compiler refuses: 21,214 files in 238 repositories.** 17,237 are three generated
  repositories: `volume-10k` (10,023, `PICTURE clause required` in 7,923), the research dataset
  (5,829) and `jcf608_PacificNationalBank` (1,385). The rescue probe now retries every one through
  the precompiler stand-in, with stand-in `DFHAID`, `DFHBMSCA` and `SQLCA` copybooks and symbolic
  maps generated from the tree's own BMS, and then the IBM, Micro Focus and format variants: 3,809
  compile, 110 only because of the stand-in copybooks and 21 only because of the maps. The
  grade over them has the compiler read the stand-in, or for embedded SQL the translator, and the
  parser the file as written: 2,464 graded, items, labels and calls 100%, sizes 2 of 483,034
  disagreeing. 1,342 produce a listing too thin to witness anything, most through the
  variable-format retry, 58 because a fixed-form program read as free form lets its AUTHOR
  comment-entry run to the end of the file. Open:
  - Reference states on stand-in rows: 60 of 398,938 disagree, most of them `CCARD-AID` in the
    CardDemo copies, referenced for the listing and through its parent for the parser; neither an
    88 set TO TRUE nor one tested is the cause.
  - The translator now turns EXEC CICS into CALLs as well, which the grade does not yet use for a
    CICS-only program. In the mixed programs it already translates, 135 states disagree: the
    parser does not read a CICS option's argument as a reference, and the grade still counts the
    translator's `CW-CICS-*` calls. The option directions are in `provenance/precompile.json`.
  - SQL statements other than SELECT and FETCH INTO write host variables too, as Db2 13 documents
    them: VALUES INTO, SET and GET DIAGNOSTICS their `:v =` targets, CALL its lone-variable
    arguments (OUT and INOUT are the procedure's own definition), and ASSOCIATE LOCATORS its list.
    A SET from a special register is not data at rest, so these are not all database sources.
  - An undeclared host variable is not reported by `compile-undefined-name`. Whether it should is a
    decision: the precompiler refuses one, but most come from a DCLGEN member the tree lacks.
  - Generated symbolic maps cover named fields only. A mapset with GRPNAME or OCCURS fields is
    laid out differently and is not generated, so 21 of the 42 programs missing only a mapset the
    tree defines still do not compile.
  - GnuCOBOL's relaxations (`-flarger-redefines=ok`, `-frelax-level-hierarchy`,
    `-findirect-redefines`, `-facucomment`) bring in none: every file refused for one is refused for
    something else too.
  The rest are application copybooks the tree does not hold (984 files) and source with errors in
  it, which is `compile-undefined-name`'s ground rather than the grade's.
- **What the cited documents' terms allow, 2026-09-27.** `provenance/sources.json` records each
  publisher's terms, quoted, and `diag/sync-sources.mjs` keeps a copy only where they allow one; 62
  of the documents cited are not kept. Open, each needing a decision rather than code:
  - Rocket bought the Micro Focus COBOL business in 2024, so copyright in the ACUCOBOL-GT, RM/COBOL
    and Visual COBOL manuals may be Rocket's now, and its terms forbid automated extraction. The
    copies the words were read from are served by supportline.microfocus.com and microfocus.com under
    OpenText's terms; no word source cites Rocket's own site.
  - Four Visual COBOL 9.0 pages cited in `words.json` (`HRLHLHCLANU005`, `HRLHLHCLANU020`,
    `HRLHLHPDF790`, `HRLHLHPDF205`) no longer resolve, and no Wayback capture matches the hash
    recorded for them.
  - The three FFIEC booklets are downloaded by hand, since the site CAPTCHA-blocks scripts; add them
    with `--import`. How `feed/sources/ffiec.txt` and `nist80053.txt` were made from their sources is
    not recorded.
  - Bull's terms have not been read, so the Bull manual behind two word sources is not kept.
  - `--archive` finds or requests a Wayback capture of each document cited: 118 of 120 are held, in
    `provenance/captures.json`. Save Page Now answers 520 for two IBM Docs pages, the IMS DIB and the
    CICS EIB fields; retry them, or cite the PDF they belong to.
  - After launch: ask each publisher whose terms forbid a copy for leave to keep, and where it will
    agree to republish, an archival copy of the documents cited, unmodified, notices kept, not for
    profit and removed on request. Rocket first, since its answer also settles the manuals it now
    owns.
  - After launch: place the manuals with an institution that can hold them under its own standing:
    bitsavers for scanned manuals, the Computer History Museum or the Internet Archive for the rest.

**Programs that cannot compile, 2026-09-24.** The backlog item landed as `feat: report a program
that uses names nothing declares, once every copybook it copies is found`, measured one repository
at a time: 56 of them, and a 1-in-20 and a 1-in-200 sample of the two volume repositories.

- Counted before any filter, nearly every program has an unresolved word - 42 of 42 in CardDemo,
  981 of 981 in `stephenwaite__cms` - because reserved words, EIB fields and paragraph names resolve
  to no item. That is what "all 5,000 programs in the generated corpus" measured. After the filter
  the volume repositories report nothing: no finding and nothing undecided over 502 programs of
  `volume-10k` and 501 of `volume-100k`.
- 131 findings in 11 repositories; 116 were read, and every one of those programs cannot compile.
  IBM's course labs built to fail with `IGYPS2121-S` (2, and 2 copies), exercise start files (6),
  `EIBUSERID`, a field the EIB does not have (2), a copybook's fields used under names it does not
  declare (40 in one repository, 36 of them generated clones), CICS map
  fields with no map copied (8), programs written against a copybook that has since changed (13 in
  `stephenwaite__cms`), and 28 test fixtures in the Che4z language server. The 15 unread are in
  `stephenwaite__cms`.
- What the iteration removed, each where it appeared: IMS DIB fields (3, CardDemo), the ASSIGN
  operand Micro Focus declares for itself (32, `Carachato__Teste_Scan`), IBM compile listings kept
  as `.cbl` (10, Che4z), a copybook resolved to one of two same-named files when the build takes the
  other (6, `cosgroveb__COBOLLM`), a `REPLACING ==<<SCRN>>==` the parser does not apply (11, Rocket
  BankDemo) and GnuCOBOL's `INCLUDE` (9, `nigromante__cobol`). Each now leaves a program undecided.
- Undecided is common, and the set says why: 7 of 42 programs in CardDemo, 24 of 44 in Bank of Z,
  38 of 48 in the RM/COBOL repository, most behind a copybook the tree does not hold. A tree without
  its copy library reads as incomplete coverage, never as clean.

**The 2026-09-21 corpus run.** 127 repositories, 558,281 files, 49 minutes, all nine rule sets plus
the three vendor packs. **No rule set threw on any repository**, which is what the run was for: it
is the acceptance test the seventeen structural commits had not had, and 253 unit tests over 48
synthetic cases is not the same evidence. Three things it surfaced:

- **The corpus holds at least two generated volume repositories, and they drove every number.**
  `JMRoldanF__volume-100k` is 100,032 of the corpus's 125,455 COBOL files — 80% by file count —
  and `JMRoldanF__volume-10k` is a second one that was missed on the first pass because the skip
  was written as the exact name rather than the substring `volume`. Between them they produced
  almost everything that looked alarming. `opaque-pointer-addressing` went 97,373 → 10,341 when the
  first came out, 9,904 when test and conformance paths came out, and **1,181 when the second came
  out.** The rule was never the problem. Nothing was narrowed and nothing needed to be.
  The lesson is about the measurement rather than the rules: three conclusions in a row were
  drawn from generated data, and each was corrected only by looking at where the findings came
  from. `--skip volume --exclude-paths tests/,conformance/,/nist/,/fixtures/` is the honest
  invocation, and the excluded set is now recorded in the output so a number cannot be read
  without it.

- **The opaque set, measured honestly: 4,483 findings over 36 of 126 repositories.**
  `opaque-altered-control-flow` 2,967, `opaque-pointer-addressing` 1,181, `opaque-alternate-entry`
  335, `opaque-procedure-pointer` 0. That is a reasonable rate for an `info`-severity analysability
  marker, and `SET ADDRESS OF` being common in MQ and CICS adapter code is the expected shape
  rather than a false positive — those programs genuinely are ones the flow engine follows less of.
  One thing worth considering rather than doing: the set reports per statement, at 4.4 statements
  per file, while its own header says it exists "so that a reviewer knows which programs deserve a
  person". Per-program reporting would turn 4,483 into about 1,020. That is a granularity choice,
  not a correctness one, and the per-statement locations are what a reviewer follows.

- **Seeded recall, first run: 72 of 75.** `bench/seed.mjs` plants three flaws into real programs -
  command-line input to `CALL 'SYSTEM'`, a program's own first literal `CALL` given a command-line
  target, and a CICS program's `EIBCALEN` check removed - and asks whether the rule sees them.
  25 hosts per flaw, round-robin across repositories, byte-identical copies used once. It is
  seeded recall, measured against the planter's idea of the bug. The three misses are one program,
  `BNK1CCA` in three forks of IBM's Bank of Z, and the cause is not the CICS rule: `COPY INQACCCU`
  resolves to the *program* `INQACCCU.cbl` beside it rather than the copybook in `cics/copy`,
  because the parser searches the source's own directory first, as `cobc` run from that
  directory does. The program is pasted into working storage, the parser sees two programs in one
  file, and the communication area belongs to the wrong one. A real build's copy library would
  not hold the program, and "feat: a COPY takes a copybook over a program of the same name" now
  prefers the copybook. With it `BNK1CCA` is one program that declares `DFHCOMMAREA` and never
  reads it, so it is not a host at all: the three were not misses by the rule but hosts the wrong
  parse made. Re-run on 2026-09-24: 75 of 75. The departure from `cobc` cannot change a program
  `cobc` compiles, since a program pasted into another does not compile; a COPY with no other
  candidate still takes the program, which is how a nested program is copied in. Compared with its
  parent over 9,005 programs in the 125 repositories (independently of the change's author): 170
  programs change and 224 resolutions move, every one from a program to a copybook; none is lost
  and none newly resolves; the 658 copy records that disappear are the COPYs inside the programs
  that were pasted in; no changed source holds nested programs; 52s against 53s. Keyed on
  name, via and file:line - pairing the parser's `copies` positionally reports false moves, because
  one changed resolution shifts every later index. The GnuCOBOL re-grade is still owed.

- **Seeded false alarms, and planted labels: 2026-09-30.** Each `bench/seed.mjs` operator now
  plants near-misses beside its flaws, into the same host: the flaw's change with the property that
  makes it a flaw taken away. Every planted program is a label record (`labels` in `--out`, source
  `planted`) for per-rule precision from machine labels. Over the 500-repository corpus, 25 hosts
  per operator, `--skip volume`: 225 labels, 100 flaws and 125 near-misses. The first run found 67
  flaws and reported 13 near-misses; with the three gaps below fixed, 100 and 1.

  | Operator | Variant | Label | First run | Fixed |
  |---|---|---|---|---|
  | command line to `CALL 'SYSTEM'` | the command read from the command line | flaw | 25 of 25 | 25 of 25 |
  | | an EVALUATE lets two commands through (bench 062) | near-miss | 0 of 25 | 0 of 25 |
  | | the command line read, a literal command run (bench 002) | near-miss | 0 of 25 | 0 of 25 |
  | command line to the first literal `CALL` | the target read from the command line | flaw | 25 of 25 | 25 of 25 |
  | | read, and `GOBACK` unless it names the program the call made | near-miss | 13 of 25 | 1 of 25 |
  | | the call through a field holding that program's name | near-miss | 0 of 25 | 0 of 25 |
  | `EIBCALEN` check removed | every test of it gone | flaw | 17 of 25 | 25 of 25 |
  | | gone, and `EIBCALEN` copied to a field nothing tests | flaw | 0 of 25 | 25 of 25 |
  | | gone, and a return on entry unless the whole area was passed | near-miss | 0 of 25 | 0 of 25 |

  Three rule gaps, fixed:
  - `cics-commarea-without-length-check` exempted a program that points `DFHCOMMAREA` at its own
    storage by finding `ADDRESS OF DFHCOMMAREA` anywhere in a `SET` (`pointsItself`,
    `lib/sets/cics.mjs`), so `SET WS-ADDR-DFHCOMMAREA TO ADDRESS OF DFHCOMMAREA`, which takes the
    caller's area's address, exempted it too. All 8 misses were GenApp's `LGACDB01`, `LGACDB02` and
    `LGACUS01` in five forks. Only the receiving side, before `TO`, exempts now. The 10 corpus
    repositories holding that `SET` (volume-10k skipped) give the same findings before and after,
    all 10 read completely, since every such program tests `EIBCALEN`.
  - The same rule took any mention of `EIBCALEN` for a test of it, so a copy that nothing tests hid
    the flaw in every host. It counts now where `EIBCALEN` bounds the read: a condition tests it or
    a field it was moved or computed into, it is the start or length of a reference modification,
    or what an `OCCURS DEPENDING ON` counts by; a `CALL` handed it or the whole EIB counts too. Over
    the corpus: 40 new findings, all in three programs - GenApp's `LGICVS01` and `LGSTSQ` and the
    health sample's `HCAZERRS`, in forks and copies - each of which, started by a program, moves
    its area's 90 or 80 bytes whole and only copies `EIBCALEN` into the length of a later write.
    Conditions read by the statement's own tokens, since its sources leave out what parentheses
    wrap: `IF (EIBCALEN > 0)` in `CPAT400` and `CINT` would otherwise have been two false findings.
  - The first-literal-`CALL` near-miss was reported in 13 hosts, and not for its `IF`: every loop
    between a check and a `CALL` through the checked field lost the check, because the control
    analysis took the field naming the program for one the callee may write (`writtenBy`,
    `lib/control.mjs`). The call's first pass removed the fact and the loop's back edge carried the
    loss to the next. Bench 062's `EVALUATE` form failed the same way inside a loop. The name, and
    what goes `BY CONTENT` or `BY VALUE`, is no longer written by a call unless it is `EXTERNAL`.
    Over the corpus: 2 findings fewer, both `file-record-to-dynamic-program-load` in
    `pingleware_apac-accounting-code`'s `JOB001`, whose program number is forced into five values
    before a loop calls it. The one near-miss still reported calls from a paragraph nothing
    performs (`CGS100`, `S7200-LINK-IG`); the analysis holds no facts where it cannot say the code
    runs.

  Harness faults found on the way, each of which made a plant something other than its label:
  - The rule reports a communication area where it is declared, and a finding in a copybook of the
    host did not count (`GAM0VII`, reported at `GAM0BCA.cpy`). Every staged file is the host or its
    copybook, so any finding in the staging directory now counts.
  - Staging did not follow `EXEC SQL INCLUDE`, and an area declared through one had size 0, which
    the rule skips (`LGACDB01`).
  - A program's first literal `CALL` could sit in a second program in the same file, which cannot
    see the planted field (`Tlgicdb0`). A file holding more than one program is no longer a host.
  - A program whose `EIBCALEN` is named where no plant reaches - a translated program's
    `DFHEIBLK`, an area that `OCCURS DEPENDING ON` it, a copybook it includes - may still check the
    length after the plant, and is no longer a host for the length check.
  - A skipped host's staging directory could be reused by a later host from the same repository.
  - A program whose procedure division opens with `DECLARATIVES` took its plants ahead of them,
    which is not COBOL (`parserjs`). Such a program is no longer a host.

  The earlier 25 of 25 for the removed check was over a host set these filters change.

- **The source budget is cumulative across a repository rather than per file**, so a repository
  stops being read partway through and which files survive depends on sort order. At the 64 MB
  default this hid 29% of real programs; at 256 MB, 9%; with the generated repositories out, 715
  files. Reading the extra programs produced zero additional findings in any rule.

- **Every rule count is identical across runs** once population is held constant. The same
  repositories read three different ways produce the same findings, which is the strongest
  evidence available that the structural work changed no behaviour.

- **Vendor packs, measured and still half-unknown.** All three now carry a corpus measurement and load
  with the missing half named: `broadcom` fired 0 of 8 rules, `controlm` 0 of 7, `connectdirect` 1
  of 7. The two rules feared over-broad - `ctm-autoedit-variable-in-command`, which matches any
  `%%NAME`, and `cd-copy-outbound`, which fires on every ordinary transfer by design - fired zero
  times, which is the opposite of the concern and is not yet evidence against it.
  **What is still missing is the half that matters more.** Only 45 of 127 repositories contain any
  JCL, and public teaching material contains essentially no estate running ACF2, Control-M or
  Connect:Direct. A rule that cannot fire for want of the product is not a rule that sees the
  product and stays quiet. Each pack needs a practitioner: someone who has administered it reading
  the risk statements. No corpus will substitute.
  Not written: Syncsort/Precisely, BMC AMI/Compuware, Tivoli.

- **The recon rules' false-positive rate.** `diag/measure-rules.mjs` reports per-rule prevalence
  with repository share, which is the measurement. A public corpus has no site file, so only the
  address rule can fire over it; the production-name rule's rate needs a real estate, and no public
  measurement will substitute for it. The same holds for the two rules that pair it with what a
  JCL step does to the dataset, from "feat: a test job touching a production dataset is reported":
  they read the direction from `DISP`, so a step writing a member it opened `SHR` counts as a read.
  The utility table knows better for the utilities it covers, and the rules do not consult it yet.

- **Hand-labelled flow corpus.** Flow precision is measured on benchmark cases this project wrote.
  Fifty real programs from the 300-repository set, with reachability marked per sink by hand, would
  make it a number with an independent witness. Not started. It gates any public precision claim.

- **Outbound channels: what is read, and what is not followed.** "feat: data at rest leaving through
  an extrapartition queue or a service call is followed" added the queues the CSD sends to a DD and
  the containers `EXEC CICS INVOKE SERVICE` sends. Neither has a witness in the corpus: no COBOL file
  there issues `INVOKE SERVICE` or `INVOKE WEBSERVICE`, and the one extrapartition queue a
  repository's own CSD defines is CardDemo's `JOBS`, which its report program fills with job text
  built from terminal input - the internal-reader rules' case, not data at rest leaving. FTP steps
  in JCL are read by "feat: an FTP step is reported when its session is cleartext or it sends
  production data", as a session and the datasets it sends, but not as a flow sink: a record a
  program writes that a later FTP step sends is not followed there. The corpus holds 14 distinct FTP
  steps: CardDemo's one, in ten forks, and thirteen in one estate's PROCs, nine of them in `.txt`
  files the scanner does not read as JCL.

- **A COPY naming a path from the project root reads as missing.** One 3,700-file repository
  writes `copy "a/b/c"` from `root/a/x/y/`, and the copybook is `root/a/b/c`. The base is `root`,
  which holds no copybook of its own and is therefore in neither `mainDir` nor `includeDirs`, so
  **all 49,705 of that repository's COPY statements read as missing** and the
  scan reports incomplete coverage over source that is in the tree. Trying each ancestor of the
  program's directory as a base would resolve them. That changes what the graded parser produces,
  so it needs the GnuCOBOL grade rather than the identical-output argument `3eaf084` rested on, and
  that needs a machine with GnuCOBOL.

- **What those misses cost, before `3eaf084`.** A name with a separator skips the file-name index
  and tries every include directory under every extension — 148 by 11, per COPY, per program.
  Measured on that repository, with the opaque set alone: **577s, and the memory guard stopped it after 352
  of 3,700 files**, reporting 24 findings. It now reads all 3,700 in 153s and reports 2,740. The
  repositories whose COPY names carry no separator are unchanged, 99s against 101s side by side.
  A whole scan of it was 1,911s before; it has not been re-measured whole, because the flow
  set exhausts a 16 GB machine with under a gigabyte free and stops early whichever parser it uses.

- **Index findings the check model still cannot settle**, left when roadmap 1.4 closed on
  2026-10-01, each read on the corpus:
  - `dc-http.cob:335` in `ReoShiozawa_discord.cob`: the true bound, `LINE-END <= RAW-LEN - 1 <= 8191`,
    needs a lower bound on `WS-LINE-END`, which comes from sums the model treats as able to overflow.
  - `StReImMt` `SUB-1`: about 80 writes, some of them a transient 0 (`MOVE 0` then a `PERFORM` or
    `ADD`) that a flow-insensitive invariant cannot express. Whether `SCROLL-NEXT` reads `SUB-1 = 0`
    decides the verdicts; neither real nor false is confirmed.
  - A length checked only after it is computed, `COMPUTE L = E - S` then `IF L > 0`, as in
    `cobolcc.cob:7394` and `dc-http.cob:359`: the unsigned result may be an absolute value, so the
    span `S + L = E` holds only with an order `S < E` before the statement.
  - A bound through a third field, `IF S + L - 1 > B`, credits nothing unless `B` itself is bounded
    at the test. In `dc-websocket.cob:298` it is not: the caller supplies the buffer length.
- **Format: 118 files read as free that compile only as fixed** (column-72 census of 314,910 corpus
  files, cobc 3.2 as the oracle). Not yet read one by one.

## Structure

The rule-set contract landed over 2026-09-20/21, specified in
[`docs/spec/ruleset-contract.md`](docs/spec/ruleset-contract.md) and carried out in seventeen
commits from `89b42ea` to `5a580a8`. Adding a rule set went from nine edits across four files to
two lines in one; a scan walks the tree once rather than ten times; severity belongs to the rule
that declares it rather than to whoever merged the findings. What that specification leaves open:

- **What still writes a revision to disk.** `diff` reads both revisions out of git through
  `gitTree` (roadmap 3.1, see [`docs/execution-plan.md`](docs/execution-plan.md) §3.1). `build` and
  `gate` still write them out through `withRefs`, because the compiler and ironwork read files.
  `scan --pds-export` reads a Zowe all-members download or data-set-named directories through
  `pdsExportTree` (roadmap 3.2). `diff`, `build` and the other commands do not take it yet, and
  XMIT and IEBCOPY unload files are not read.

- **Scan time on very large programs.** A 1.6 GB repository of 17 MB programs
  (joe-tingsanchali-sonarsource_cnafbadboy) does not finish a scan in 900 s and reaches 3.9 GB
  resident, read from disk or from git. One of its programs parses in 1.25 s; there are 156 of them,
  and more than one rule set parses each. Before this change `diff` refused it outright, because
  `git cat-file` overflowed a 256 MB buffer.

- **The three extractions the language plan needs are built.** `lib/cards.mjs` holds the column model
  (COBOL's fixed and variable areas, the 72-column statement) and operand splitting, used by the JCL,
  BMS, utility, FTP and explain readers and the hidden, copybook and recon rule sets; `lib/layout.mjs`
  holds picture and usage sizes, record offsets and report layout, out of `lib/parser.mjs`;
  `lib/embedded-sql.mjs` holds Db2's host-variable roles, which the parser, the flow engine and the
  precompiler now share. Still in `lib/jcl.mjs`: continuation folding, which has one dialect until
  HLASM gives it a second to be shaped against. Still in `lib/parser.mjs`: reference-format
  detection, which two branches in flight edit.

## Language coverage

[`docs/spec/language-coverage.md`](docs/spec/language-coverage.md) plans BMS, IMS DBD/PSB, DB2 DDL,
HLASM and PL/I — 9 rule sets to 14, estimated 112–160 hours against roughly 14 for the engine as it
stands. Its Phase 0 gate was the rule-set contract, which is now passed; its three extractions are
not built (above). **This is a decision, not a queued item.** Two things settled while it was
written: z390 ships neither IBM's `DFH` nor its IMS macro libraries, so BMS and IMS have no external
oracle and fall back to round-trip and `BYTES=` self-consistency, while HLASM keeps z390 and is the
only one of the five that does.

## Feed items still open

- **Compliance.** DORA, NIST SP 800-53 and the FFIEC IT Examination Handbook ship. FFIEC's booklets
  refuse automated requests, so the PDFs were fetched by hand and extracted to `feed/sources/`;
  three of ten booklets are mapped and the other seven place obligations no static analysis can
  evidence. PCI DSS and COBIT are different: their *text* cannot be redistributed (PCI SSC's terms
  permit use "solely for your own personal, non-commercial" purposes and forbid preparing derivative
  works), but a mapping of requirement numbers plus our own rationale is our work and can ship. The
  blocker there is this project's own gate, which requires a verbatim quote. The way out is to ship
  those mappings without quotes and have the customer drop their licensed copy into `feed/sources/`,
  where the gate verifies locally against it.
  COBIT 2019 now ships that way, as identifiers only (`rules/compliance-cobit2019.json`), on the
  operator's ruling of 2026-09-30; its practice numbers have not yet been checked against a licensed
  copy. PCI is still open: its permitted use says non-commercial, so caching it to build a mapping we
  sell may itself need an arrangement with the Council. Ask them.

- **Utility knowledge base.** `feed/worklists/utility.json` holds 34 targets and no rows have been
  generated. `feed/generate.mjs` has never been run against a real model. Ten of the targets'
  data movement is written by hand in `lib/utilities.mjs`, each entry citing the IBM page it came
  from, by "feat: a dataset flow says which program wrote it, and what a utility copied in":
  `IEBGENER/SYSUT2`, `SORT/OUTFIL`, `IDCAMS/REPRO`, `IEBCOPY/COPY`, `ADRDSSU/DUMP` and
  `ADRDSSU/RESTORE`, plus ICEGENER, SORTINnn merges and IEBCOPY's COPYGRP, and since then
  `IDCAMS/EXPORT`, `IDCAMS/IMPORT`, `IEBCOPY/COPYMOD` and `ADRDSSU/COPY`, with IEBPTPCH, IEBUPDTE
  and ICETOOL's COPY, SORT and MERGE, which the worklist does not list, and `IDCAMS/PRINT` (to
  OUTFILE, else SYSPRINT) and `IDCAMS/ALTER` NEWNAME. Of the other 22, none moves data from one
  data set to another the table could follow: `IDCAMS/DELETE`, `DEFINE`, `LISTCAT`, `VERIFY` and
  `SETCACHE` and `IEFBR14/DISP` create, delete or describe; `SORT/INCLUDE`, `OMIT`, `INREC` and
  `OUTREC` and `IEBGENER/SYSIN` choose or reshape records between the DDs the copy already names;
  `IKJEFT01/ADDUSER`, `ALTUSER`, `PERMIT`, `SETROPTS` and `RDEFINE` are RACF commands that
  `jcl-instream-security-command` reports. `IKJEFT01/ALLOC` and `CALL` are read by `tsoCommands`:
  an ALLOCATE is a DD of the step, and a program TSO CALL or DSN RUN starts gets the step's DDs and
  its parameter string as PARM. `FTP/PUT`, `GET` and `SITE` are read by `lib/ftp.mjs`: each transfer is
  a copy to or from a remote end naming the host and file, and a FILETYPE=JES or SQL from a SIte
  marks the transfers after it. Open: `IKJEFT01/EXEC`, whose CLIST or REXX is in a library the job
  does not hold.

## Build and release

- **CI runs on Linux and Windows.** `.github/workflows/ci.yml` runs `npm test` on ubuntu with Node
  22 and 24 and on windows with Node 22, and scans the benchmark on ubuntu. Every platform-specific
  failure so far has been a Windows one, which is why one Windows job stays in the matrix.

- **The test suite is not reproducible across machines.** `npm test` runs `node --test`, which is
  parallel. `test/memory.test.mjs` asserted on real machine state, and `available` is the lesser of
  the heap's headroom and the whole machine's free memory, so its verdict depended on what else the
  machine was doing: two runs on the same commit saw 206/206 and 189/206. The readers are injectable
  now and the tests declare their machine, which fixes it — but the general point stands, so a
  report of "all tests pass" should say how and where it was run.

## Integration

- **The remediation gate has a caller: commitwork's `cobolwork-remediate`** (commitwork 43217458,
  `lib/cobolwork-remediation.mjs`). `cobolwork gate` passes a drafted patch only where the engine
  says why its target left: a check that stops the route, or the statement or source gone and not
  written back. It fails a patch that adds a finding, moves a layout another program reads, adds a
  call target or edits the site file or baseline, and leaves a route cut mid-trace, or a scan the
  memory guard stopped, to a person ([`docs/spec/remediation-gate.md`](docs/spec/remediation-gate.md)).
  The caller builds each draft through a private index and gates `--head <sha>`, fences `reasons`
  as untrusted text before a model sees them, stops at three attempts or a repeated draft, and
  resweeps with `--target-only`. On 2026-09-30 the gate met a real compiler (GnuCOBOL 3.2.0 on
  PATH): a batch fix that tests the value first passed with `compile` true, the same fix with a
  misspelt scope terminator failed with `compile` false, and `--target-only` passed the fix on a
  later revision where someone else had added a finding the full gate fails. No draft has run end to
  end: commitwork's remediation policy is in report mode until an operator sets `hitl-item`, and its
  drafter sends Qwen 3.8 no reasoning setting.
- The mainframe credential rules are ready to offer upstream to gitleaks. The pull request is not
  drafted, and cobolwork itself only prints their path.
