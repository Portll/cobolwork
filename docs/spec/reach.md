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
   reach *precision number* waits on a labelled corpus that has the facts, which only a practitioner
   estate holds. See `BACKLOG.md`.
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
  answer already hold.

And the aggregate answer: the hand-labelled corpus (§7.3) measures how often a theoretical claim is
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
    "program": "INQUIRY", "path": "INQUIRY.cbl", "line": 13, "item": "WS-STMT",
    "test": "before the operation at INQUIRY.cbl:13, on every route to it, test WS-STMT against a list of the values allowed (...), and let only a value that passes reach it; a static statement with host variables needs no test"
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

### 9.6 Measuring it

The sealed answer key `diag/label-sheet.mjs` writes records each site's verdict, and
`diag/score-corpus.mjs` gives a rate per verdict against blind human labels
(`feed/specs/06-corpus.md`): how often a verdict that names a route sits at a reachable site, and how
often `refuted` sits at one that is not. That is the route half, the part §7.3 says a public corpus
can witness; the reach half still needs an estate's facts. The labels are not started, so no rate is
published.
