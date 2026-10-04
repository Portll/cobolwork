# Reachability, and the facts that decide it

A design for turning a `path` finding from "a route exists" into "a route someone can reach, and
what reaching it gives them" - without ever claiming more than the estate's own records support.
Status: the fact layer, the reach annotation and a first effect slice landed 2026-09-25
(`lib/reach.mjs`, wired in `lib/scan.mjs`); decisions 1, 2 and the effect shape (4) are made and
built, 3 - the measurement gate - is open. Decision 5, a verdict per path finding that uses the word
exploitable, was made 2026-09-30 and its first slice is built (`lib/exploitability.mjs`, §9).

## 1. The gap

A `path` finding says untrusted input reaches a sensitive operation. It does not say whether an
attacker can supply that input, or what they gain by it. The README states this plainly: *none of
the kinds says exploitable*. Three facts stand between "route" and "exploitable", and the source
holds only the first:

- **Route** - can bytes get from a source to the sink past every check? The source answers this,
  and cobolwork already reports it, with the check model in `lib/control.mjs` crediting a guard
  only where it runs first on every path.
- **Reach** - can an attacker supply those bytes? That is who may start the transaction or submit
  the job that carries the input, and whether the region faces a network. Those answers live in
  RACF, the SIT and the running region, not in a repository.
- **Effect** - does reaching the sink do harm here? That is the authority the entry runs under, and
  what the target (a dataset, a load library) is protected by.

Reach and effect are facts about the customer's running system. This is the same shape as
[`z-sibling-rules.md` §5b](z-sibling-rules.md): a check whose deciding fact lives outside the
repository observes until the fact arrives, and is a defect only once it does.

## 2. What the tool already has

The join is cheap, because reach hangs off machinery that exists:

- **`startedBy`** on every flow finding (`lib/dataflow.mjs`): the transactions and job steps that
  reach the finding's program, by `CALL`, `LINK`, `XCTL`, `START` and `EXEC PGM=`, and the alias
  transaction a server `URIMAP` serves it under (`CWBA` unless the map names one).
- **`summary.byTransaction` and `summary.byJob`** (`lib/sets/flow.mjs`): findings counted by the
  entry that starts them - how a mainframe team already triages.
- **The CSD**, parsed by `lib/csd.mjs`, carrying each transaction's `program`, `ressec` and
  `cmdsec`.

So a finding already names its entry points. The missing half is a statement of which of those
entry points an attacker can actually drive.

## 3. The facts, and where they come from

None is in any source file, and no corpus will ever witness them (the §5b argument). The estate
supplies them, either by naming them in `cobolwork.site.json` beside `apfLibraries` and
`surrogateUsers`, or by bringing an extract the tool reads but never stores - the same shape as the
customer advisory feed, refused if it sits inside the scanned tree:

- **Who may start each entry.** A transaction open to every signed-on user, versus one a RACF
  profile restricts to a named group. From a hand-declared list, or an `IRRDBU00` RACF-database
  unload the estate already runs.
- **Which entries face a network.** A `TCPIPSERVICE`/`URIMAP` transaction, or a region whose SIT
  turns terminal security off (`SEC=NO`, `XTRAN=NO`). From the CSD (already parsed) plus the SIT,
  which the estate declares.
- **The authority each entry runs under.** The region user id, and whether it is one RACF lets do
  what the sink does. From the unload.

## 4. The mechanism

A finding gains a `reach` field derived from its `startedBy` entries against the declared facts:

- `reach: "open"` - at least one entry that reaches it is startable by an unrestricted user, cited
  with the fact and the date it was extracted.
- `reach: "restricted"` - every entry that reaches it is behind a control the estate named.
- `reach: "undeclared"` - the estate has not said, so `factsNotDeclared` names the fact and the
  finding is not re-ranked. This is the default, and it is honest silence, not a clean bill.

`summary.byReach` counts findings the three ways, the way `byTransaction` already counts them. A
finding whose reach is `open` and whose route has no check is the strongest actionable claim the
tool can make from reading alone plus one declared fact - and it still is not a runtime proof.

## 5. What it deliberately does not do

- **No runtime.** Reach is computed from declared records, never by driving the region. A CICS
  route's demonstration stays a test plan for someone with a test region, as the exploitability
  answer already said.
- **No staleness laundering.** `reach` is only as current as the extract, and the finding carries
  the extract's date so a reader can judge it.
- **No new `evidence` kind.** `evidence` is what the tool established by *reading*; reach always
  rests on a fact the estate supplied, so it rides as its own field, the way severity and evidence
  are already separate. The kernel's refusal of an `exploitable` evidence kind
  (`test/findings.test.mjs`) stands; the verdict of §9 is a field of its own for the same reason.

## 6. The first slice, and what needs no decision

The smallest honest step reuses the priv set's site-gated shape exactly (`lib/sets/priv.mjs`):

1. A `cobolwork.site.json` key naming open (or, inversely, restricted) transactions and jobs.
2. `reach` stamped on each flow finding from its `startedBy` against that key.
3. `summary.byReach`, and `factsNotDeclared` naming the key when it is absent.

This needs no new rule, no runtime, and no change to what counts as a finding - only a projection
over facts a finding already carries. It is the same increment as "the APF check states its impact
once the estate names the authorised libraries".

## 7. Decisions, and where they stand

1. **How the estate declares reach — decided: both, the feed authoritative.** A brought
   `COBOLWORK_REACH` extract (a RACF unload plus the SIT, reduced to `{ extract, retrieved,
   transactions, jobs }`) is authoritative; the `openTransactions`/`restrictedTransactions` /
   `openJobs`/`restrictedJobs` keys in `cobolwork.site.json` are the fallback the feed overrides
   per entry. Both are built (`lib/reach.mjs`, `lib/site.mjs`). The feed is refused from inside the
   scanned tree and named in the report, exactly as an advisory feed is.
2. **Re-rank or annotate — decided: annotate.** `reach` rides as its own field on a finding
   (`open` / `restricted` / `undeclared`) and `summary.byReach` counts the three ways; severity is
   untouched, because severity is urgency and reach is who can drive it, and collapsing them would
   hide which fact moved the number. Built.
3. **The measurement gate — open.** No "reachable" claim is called precision without an independent
   witness. The route half (does input reach the sink) can be witnessed on public COBOL, which the
   held-out corpora already provide; the reach half cannot, because public repositories carry no
   RACF facts to be right or wrong about. So a reach *projection over a declared fact* ships now; a
   reach *precision number* waits on machine labels over programs that carry the facts, which only an
   estate's own source and site file hold. See `BACKLOG.md`.
4. **Effect — decided: a separate field, first slice built.** `effect` is its own axis, not nested
   under `reach` - reach is who can drive it, effect is what driving it runs as. Its first slice
   reuses the reach machinery: an entry the estate names privileged
   (`privilegedTransactions`/`privilegedJobs`, or the feed's `privileged`) makes a finding it
   reaches `effect: "privileged"`, and only the positive is claimed - an entry no privileged list
   names is unknown, never called safe. `summary.byEffect` counts it. Fuller effect - the region
   user's full RACF authority, and the target's own protection - is a later increment.
5. **The verdict — decided 2026-09-30: say exploitable, with the facts it rests on.** A client could
   not tell from route, reach and effect kept apart which programs to patch first, so the tool now
   joins them into one verdict per path finding (§9). The word is allowed where the records support
   it and never beyond: `exploitable` needs an estate fact that an entry is open, and each verdict
   lists the facts behind it and names the one it lacks. A `confirmed` verdict needs a witness on
   the running system, which the tool never produces itself; the estate brings it (§9.5).
   `evidence` is unchanged, and the kernel still refuses an `exploitable` evidence kind: evidence is
   what reading established, the verdict is a projection over reading and records.

## 8. Theoretical, and actual

Route, reach and effect are all read from the source and the estate's records. All three saying yes
is *theoretically exploitable* - a route an attacker can reach that runs with authority - not
*actually vulnerable*, which needs a witness the records cannot give. Three honest ways to close
that gap, in the tool's proper lane:

- **Refute what can be refuted, statically.** The check model in `lib/control.mjs` already knows
  what each guard leaves. A route on which the guards are jointly unsatisfiable for the sink - no
  surviving value reaches it - is not a defect, and can be dismissed without running anything. This
  raises the share of theoreticals that are real, and it is pure false-positive reduction.
- **Read the estate's own runtime witnesses**, which the tool does not produce but can be given the
  way it is given a RACF unload: the estate's regression tests (a route its own tests exercise and
  never trip is evidence), and SMF or audit telemetry (who actually drives a transaction, whether it
  abends). Reality refuting a record is stronger than either record.
- **Hand a verification plan to the people who can run it.** The definitive witness is reproducing
  the route in a test region the estate owns, under its own authorisation. The tool's part is to
  name the transaction, the field and the missing guard precisely enough to check; it never drives a
  live system or crafts a payload. That boundary is the same one `SECURITY.md` and the exploitability
  answer already hold. `explain` carries the plan (§9.7).

And the aggregate answer: precision from machine labels (§9.6) measures how often a theoretical claim is
real per rule, so a single unverified finding can carry a *measured* confidence even before anyone
reproduces it. §9 is how the tool states the theoretical claim; `confirmed` is kept for the witness.

## 9. The verdict

Every `path` finding, and every route under `checked`, carries `exploitability`:

```json
"exploitability": {
  "verdict": "exploitable",
  "drivenBy": "A terminal user",
  "because": [
    "A terminal user supplies it: EXEC CICS RECEIVE at INQUIRY.cbl:10",
    "no check is shown to run on every route before the operation at INQUIRY.cbl:13",
    "started by transaction INQ1: open to any user, per reach.json (IRRDBU00 unload, retrieved 2026-09-20)"
  ],
  "unknown": "whether it reproduces: a test on a system the estate owns, under its own authorisation, is the only confirmation",
  "fixAt": {
    "program": "INQUIRY", "path": "INQUIRY.cbl", "line": 11, "item": "WS-ACCT",
    "builtInto": { "item": "WS-STMT", "path": "INQUIRY.cbl", "line": 13 },
    "test": "before the STRING at INQUIRY.cbl:11 that builds WS-STMT, on every route to it, test WS-ACCT against a list of the values allowed (...), or WS-ACCT IS NUMERIC where it is a number, and let only a value that passes reach it; a static statement with host variables needs no test"
  }
}
```

`because` is the facts, each citing where it came from; `unknown` is the one fact that would move the
verdict. `summary.byExploitability` counts findings by verdict, and the report carries the meaning of
each as `exploitabilityVerdicts`.

`fixAt` is where one patch covers every route: immediately before the operation, on the value it
uses. Its `test` is written from what the check model credits as clearing that kind of sink
(`stops()` in `lib/control.mjs`) - `IS NUMERIC` for arithmetic, a bound for an index, an allow-list
for a name - so a patch written to it moves the finding to `refuted` on the next scan, which
`test/exploitability.test.mjs` shows on three benchmark cases. Where no test on the value makes the
operation safe - a key a protected field carries, data leaving the region, a response code - `test`
is null and `why` points to the rule's remedy. A refuted route carries no `fixAt`.

Where a `STRING` built the value the operation uses - an SQL statement, a command - the input is one
part among literals, and no allow-list or class test describes the whole. `fixAt` then names the
field folded in and the `STRING` statement, and `builtInto` names the value and the operation it
reaches; the check model credits a test there the same way.

### 9.1 The verdicts, most urgent first

| `verdict` | Route | Source | Entries |
|---|---|---|---|
| `confirmed` | any: the estate's own test reproduced it (§9.5) | any | any |
| `exploitable` | no check on every route | input the entry's user supplies | at least one declared open (and, for a rule that acts with its own user's authority, declared privileged) |
| `attacker-driven` | no check on every route | input the entry's user supplies | not declared, or nothing in the tree starts the program |
| `restricted` | no check on every route | input the entry's user supplies | every one declared restricted, none unlisted |
| `mitigated` | a check runs first on every route but is not shown to stop the value, or SSRANGE bounds the index | input the entry's user supplies | any |
| `upstream` | any but refuted | a file record or a database row | any: whoever writes the data drives it |
| `refuted` | a check leaves only values the sink can take, or no route reaches the sink | any | any |

Input the entry's user supplies is the command line, a job's `PARM` or in-stream data, a terminal, a
web request, a protected screen field, and a system response the caller provokes and reads back.
`restricted` counts every entry, not every entry that resolved: an entry nobody declared, or one past
the eight `startedBy` lists, may be open, so it leaves the finding `attacker-driven`.

### 9.2 What it does not do

- **No re-ranking.** Severity, tier and what a build blocks are unchanged. The build carries the
  verdict on each finding.
- **No confirmation of its own.** Nothing the tool reads from the source or the access records makes
  a verdict `confirmed`; only the estate's witness feed does (§9.5).
- **No payloads.** The verdict names the entry, the field and the missing check - what a defender
  needs to patch and a tester needs to reproduce - and nothing that would run.
- **No verdict on an abend finding.** The abend set's findings (evidence.md §13.6) carry no
  `exploitability`: a run already shows the input ends the program. If they join the verdict, a
  finding from a subprogram fuzzed at its interface, with no caller run shown to pass the input,
  goes no higher than `caller-dependent`.

### 9.3 Handling

A report with an `exploitable` or `confirmed` finding joins the estate's access records or test
results to routes an attacker can drive, so `summary.handling` asks that it be kept where those
records may go. A SARIF upload to code
scanning shows it to everyone who can read the repository.

### 9.4 The draft

`diag/propose-site.mjs` lists every transaction and job that starts a finding an attacker drives
under `_toClassify.openOrRestrictedTransactions` and `openOrRestrictedJobs`, most findings first,
with the program it runs and any `TCPIPSERVICE` or `URIMAP` that puts it on the network, and leaves
the four reach arrays empty - the same treatment the privilege facts get, because who may start an
entry is a RACF fact.

### 9.5 The witness feed

The estate's own test results, brought as `COBOLWORK_WITNESS` (a path list, as `COBOLWORK_REACH`)
and refused from inside the scanned tree, because a list of what was reproduced is a list of what to
attack:

```json
{ "witness": "UAT regression, release 26.4", "recorded": "2026-09-29",
  "results": { "<fingerprint>": { "outcome": "reproduced", "by": "jsmith", "on": "2026-09-28", "system": "CICSUAT1", "reference": "CHG12345" } } }
```

Those fields are all that is read; what was sent to the system is not recorded here. A result
lacking an outcome, who, when or where is refused and named under `summary.witnessFeedProblems`.

- `reproduced` makes the verdict `confirmed`, whatever the reading said, and cites the result in
  `because`. The finding takes back the severity a check or the reading took off it, since the test
  shows neither held; a route the check model cleared leaves `checked`, is reported as a finding
  again, and is listed under `summary.witnessOverruled` - the check model was wrong about it.
- `not-reproduced` is stated in `because` and leaves the verdict alone: a test that missed a route
  does not show the route safe.
- The newest result per fingerprint wins; on the same day a reproduction does. A result no path
  finding carries - the code changed since the test, or the route is gone - is listed under
  `summary.witnessUnmatched`.

`summary.byWitness` counts the two outcomes. Nothing in it changes what a build blocks.

A result may cite the ironwork run that reproduced it, `"evidence": { "dir", "run" }`, the directory
relative to the feed. The directory must verify (§9 of evidence.md) and its ledger must record the run;
otherwise the result is refused and named. The run's journal must show the marker reaching an
operation, or the run ending with an abend, at the finding's file and line, or the result confirms
nothing and the finding is listed under `summary.witnessUnmatched`. Where it does, `because` names
the run and the record. `bench/witness.mjs` writes such a feed from `bench/label.mjs`'s confirmed
labels, so the confirmation an ironwork run gives is checked again by every scan that uses it.

Over `--repos`, each repository is judged with its own `cobolwork.site.json`. The summary adds the
reach, effect, verdict and witness counts up, gives each repository's verdicts under `perRepo`, and
names in `reachNote` and `effectNote` the repositories that declare nothing. A feed is refused
anywhere inside the scanned root, not only inside the repository being read, and a witness result is
unmatched only where no repository's finding carries it.

### 9.6 Measuring it

Labels are made by machine, execution first. `bench/label.mjs` runs each path finding's
verification plan (§9.7) in ironwork. The marker goes in at the finding's source:
- a batch program reading a file's records or a job's in-stream data: every DD it assigns, and
  SYSIN, with the records shifted through the marker's eight alignments;
- a RECEIVE MAP: typed into the map's unprotected fields, across the pseudo-conversation the
  program's RETURN TRANSID starts;
- a RECEIVE without a map: typed on a cleared screen after the transaction's name;
- GnuCOBOL's command line or environment (`argv-or-env`), which Enterprise COBOL does not have:
  in a copy where each ACCEPT FROM COMMAND-LINE, ARGUMENT-VALUE, ENVIRONMENT-VALUE or ENVIRONMENT
  name is a MOVE of ALL the marker, rotated through its eight alignments, to the same receiver, an
  ACCEPT FROM ARGUMENT-NUMBER moves 1, and a DISPLAY UPON their names displays to SYSOUT, each
  in the columns it held, an END-ACCEPT on the same line with it. Every DD and SYSIN hold the
  control, so no other input carries the marker. An ACCEPT whose variable is on another line, or
  that goes on past its line with an EXCEPTION phrase or END-ACCEPT, is not rewritten. These rows
  record `labelledOn: rewritten` and are their own stratum in `bench/precision.mjs`
  (`execution-rewritten`), never pooled with execution labels.

A file a SELECT assigns from a data item (`dynamic-file-path` at a SELECT) is Micro Focus's and
GnuCOBOL's form, which ironwork runs and traces only under `--compliance extended`: each OPEN takes
the DD name from the item's value and records the sink at the SELECT, the line cobolwork reports.
Those findings compile and run in that mode, whatever their source, and record `labelledOn:
extended` (`rewritten+extended` for command-line input), each its own stratum. The sink's other
form, an EXEC CICS FILE or DATASET option, ironwork does not trace, and those findings are unknown.

ironwork runs with `--trace-marker`. The finding is confirmed where the run's sealed journal has a
`sink` record at its line with the marker in the operand. Two kinds of finding are confirmed by
how the run ends at their line instead, provided the same run with a control input gets past it.
An arithmetic finding needs a data exception where asterisks went in, with digits as the control.
A subscript, reference modification, loop bound or `OCCURS DEPENDING` count needs ironwork's
range abend, U4038, where nines went in, with ones as the control. That run is of a copy with a
`CBL SSRANGE` card before its first line. A program ironwork refuses for a PICTURE of more than 18
digits runs as a copy with `CBL ARITH(EXTEND)`, the only option it compiles under.
Anything else is unknown, with its reason. A run that did not carry the marker to the operation
shows only that these inputs did not, so refuting a finding needs every route to its sink covered
(§9.8).
`bench/seed.mjs` adds planted labels: a flaw or a near-miss put into a real program, labelled by
construction, and whether the scan reported it.
`bench/label-interface.mjs` labels the abend findings of a subprogram fuzzed at its interface
(evidence.md §13.6), source `execution-interface`, from one corpus run that also fuzzed every main
program with `-L` on the repository's program directories. A main-program finding at the same rule,
file and line is a caller running the subprogram and ending there: the interface finding is
confirmed. Otherwise it is unknown with its reason: no program ironwork compiles CALLs it (the
interface manifest lists only callers that compile), callers that CALL a PROGRAM-ID `-L` does not
find by file name, callers that were not fuzzed as main programs or had every run refused, callers
whose runs never started the CALL, or a caller whose runs started the CALL and did not end there.
The last two come from each caller's run coverage (ironwork's `runCoverage`); a caller fuzzed before
ironwork kept it is a caller that ran and did not end there. Its precision is therefore the share
callers confirmed at its low end, and it is never pooled with execution labels.

`bench/precision.mjs` turns the labels into precision per rule, and per verdict where `--corpus`
names the repositories the execution labels came from: each such label is joined by fingerprint to
its finding in a fresh scan, and one that matches no finding is counted as unjoined. Every number
names its label source. A confirmed finding or a reported flaw is right, a refuted finding or a
reported near-miss is wrong, and an unknown is neither: precision is the range from every unknown
being wrong to every unknown being right, one number only where nothing is unknown. Recall comes
from planted labels alone, the only ones where every flaw is known. The table is published with each
release.
`diag/score-corpus.mjs` scores each verdict against the execution labels, with a Wilson interval over
the labels that decided it.

### 9.7 The verification plan

`cobolwork explain <path> <fingerprint>` carries `verify`: the §8 hand-off, for the estate to run in
a test region it owns under its own authorisation (`lib/verify.mjs`). A scan report never carries
it; the packet it rides in already carries source and is handled as the source is.

```json
"verify": {
  "where": "a test region the estate owns, holding test data, under its own authorisation: ...",
  "start": "transaction INQ1",
  "tool": "CEDF at the terminal that runs INQ1, or a debugger such as z/OS Debugger where the operation is not an EXEC command",
  "enter": "field QTY of map INQM in mapset INQS, received at INQUIRY.cbl:10",
  "value": "an asterisk in every position of WS-QTY, whose digits it expects: a letter will not do, since zoned decimal reads a letter as a digit",
  "observe": "stop at INQUIRY.cbl:14 and read WS-QTY holding the asterisks: that is the defect, whatever the operation does next",
  "run": "the task abends ASRA, a data exception (S0C7 in batch), at the operation",
  "record": "bring the result in a COBOLWORK_WITNESS feed under \"<fingerprint>\": ..."
}
```

`observe` is the witness in every plan: the value read at the operation. `run` says what letting the
operation go on shows, where that is harmless - an abend, a record from another test user, a name
that fails to resolve. Where it would act, `run` is null and `stopBefore` says to end the task first:

| Sink | `value` | Let it run |
|---|---|---|
| arithmetic | an asterisk in every position of a numeric field (a letter's low half is a digit, so it passes) | yes: ASRA or S0C7 |
| subscript, loop bound, reference modification, `OCCURS DEPENDING` count | one past the table or field, from the finding where it names the size, or 0 | only under SSRANGE |
| record key, record update | the key of a test record set up for another test user | yes, on test data |
| variable program, transfer, file, SYSID | `CWVRFY01`, after checking nothing by that name is defined | yes: PGMIDERR, S806, file status 35, SYSIDERR |
| web response, screen, log | `CWVRFY01` (`CWVRFY01<>` for a web response) | yes: the marker as sent |
| command, SQL, job, system resource, connection, host, outbound data, queue name, XML, header, storage length | `CWVRFY01`, or a length for storage | no |

A response code is not entered: the plan says to provoke the failure, such as a key that matches no
test record, and read the code on its way back. A protected field is changed under CEDF in the data
the `RECEIVE MAP` returns, not with a modified client. `test/verify.test.mjs` holds every path rule to
a plan and every value to one no interpreter would run.

### 9.8 Negatives from coverage

A finding is refuted by coverage only where runs show that no value from its source reaches its
operation. No such label is made: every coverage label is `unknown`. Four facts are needed, and
what runs record today does not establish them.

1. **Every route.** A finding's `trace` names one route. The flow engine keeps the shortest route
   from each source and merges the sources that reach one sink into one finding, counted in
   `sources`. `--all-routes` adds `routes`: every source, and every statement on any route from one
   of them to the sink, with `complete` false where the walk stopped at its budget or a step has no
   statement to place. The list may name a statement no route takes, and leaves out none on a
   route the engine follows; a route through code it does not read is not in it.
2. **Statements, in order.** `ironwork run --coverage` reports the paragraphs a run entered. An
   entered paragraph does not show that the statement on the route ran, and statements run in
   separate runs are not the route run end to end. Refuting needs one run that executed each route's
   statements in order, with nothing writing the carried item between two of them.
   `--trace-statements` records each start of a listed statement in run order (ironwork
   `docs/evidence.md` §1.2).
3. **Bytes carried.** The marker's absence at the operation means something only where every step
   on the route copies bytes: a MOVE, a group, a REDEFINES, an argument passed or written back. A
   step that converts, edits, inspects or computes changes the bytes, and the value that does arrive
   no longer reads as the marker. `--trace-input` follows input bytes through such steps by taint: a
   sink record's `input` false says no input byte was in the operand in that run, and null says the
   run did something taint does not follow yet, which evidence.md §1.3 lists.
4. **Input everywhere the source writes.** The marker reaches only where §9.6 feeds it: every DD and
   SYSIN through its eight alignments, and every unprotected field of a map. Taint counts every byte
   the source delivers.

A run can satisfy all four as recorded and still miss a route another run takes, because each of
these makes a sink false in one run only:

- **A step that ran without carrying the value.** A statement's start does not show that its step
  moved the value, as an entered paragraph did not show that the statement ran. UNSTRING fills
  receivers only as far as the delimiters reach, ON SIZE ERROR leaves the receiver as it was, READ
  INTO moves nothing at end of file, and a callee may leave a BY REFERENCE argument alone.
- **A source that delivered nothing.** A DD the labeller did not feed fails to open, and no byte is
  input.
- **A write between two steps.** `IF ... MOVE SPACES TO A` between two route statements clears the
  value in a run that takes the branch. The records cover only the route's lines, so they cannot
  show that no other statement wrote the carried item.
- **An element a subscript chooses.** Where input steers a subscript's value through a condition,
  which taint does not follow, another input chooses the element that holds the value.

Taint on each statement record would show the first two: the step after one that carried nothing, or
after a source that delivered nothing, reads no input. It would show a write between two steps too,
unless the later step reads input from another operand. A write between the last step and the
operation, and an element chosen by a subscript, need an argument over every path, which no set of
runs gives. Until that argument exists, no coverage label is `refuted`. `bench/label.mjs
--trace-input` records what taint found at an operation the marker missed, as `inputAtSink` on the
unknown label and counted in the output's `inputAtSink`: the findings such an argument would have to
settle. If one were refuted, `bench/precision.mjs` would count it wrong, as it counts any refuted
label. Fuzzed runs carry no marker: they show which paragraphs ran, never that a value failed to
arrive.
