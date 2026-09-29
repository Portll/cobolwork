# Reachability, and the facts that decide it

A design for turning a `path` finding from "a route exists" into "a route someone can reach, and
what reaching it gives them" - without ever claiming more than the estate's own records support.
Status: the fact layer, the reach annotation and a first effect slice landed 2026-09-25
(`lib/reach.mjs`, wired in `lib/scan.mjs`); decisions 1, 2 and the effect shape (4) are made and
built, 3 - the measurement gate - is open.

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
  reach the finding's program, by `CALL`, `LINK`, `XCTL`, `START` and `EXEC PGM=`.
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
  (`test/findings.test.mjs`) stands.

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
   under `reach` - reach is who can drive it, effect is what driving it runs as, and a consumer
   combines the three. Its first slice reuses the reach machinery: an entry the estate names
   privileged (`privilegedTransactions`/`privilegedJobs`, or the feed's `privileged`) makes a
   finding it reaches `effect: "privileged"`, and only the positive is claimed - an entry no
   privileged list names is unknown, never called safe. `summary.byEffect` counts it. Fuller effect
   - the region user's full RACF authority, and the target's own protection - is a later increment.
   Effect, like reach, stays a statement per the records, never "exploitable": that word needs a
   witness on the running system (§8).

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
reproduces it. None of this makes the tool say "exploitable" - it moves a claim as far as records
and refutation allow, then hands off a witness plan.
