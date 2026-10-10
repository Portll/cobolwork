# Flow graph: compact storage, and one analysis per distinct program

How the flow engine holds its graph so that the largest repositories finish a full scan within
memory, without leaving out a single route.

Status: 4.1, 4.3 and 4.4 are built: fact sets once per content as the facts they hold, in one
buffer per program (`2e512f7`); edges as columns (`b23399b`); one empty list for nodes with no
source or sink, one condition per content; nodes that hold only what differs between them; and
reuse of the control analysis for large copied programs. 4.2 is dropped: measured, it frees a few
megabytes and would renumber nodes. Typed node columns are not built: after the steps above, node
objects are 18.5 MB of a 139 MB heap on one Unieuro program in fifty, and columns would free about
10 MB at the cost of rewriting every node read. 4.5 is built for the control analysis: programs of
32 KiB and more have it built in worker threads (`lib/control-workers.mjs`). The walk loops look
only at a state's own return edge where a node has eight or more, held by call site. What the graph
now costs is the walk: BACKLOG, "Scan time on very large repositories", gives where the bounds stop
it.

Depends on: nothing outside `lib/dataflow.mjs`. `analyze()` returns findings, constructs, entries
and counts, never the graph. Every change below stays inside that file and `lib/control.mjs`, except
4.5, which adds `lib/control-workers.mjs` and the directory tree's `parseSpec`.

---

## 1. Why

Two repositories of the 3185 corpus take far longer than any other:

- `FabioBonazza_test_unieuro_new`, 3,263 SQL programs. The flow set stops at the memory reserve
  after 2,626 of them. **That scan is not a full scan today**: 637 programs are reported unread.
- `joe-tingsanchali-sonarsource_cnafbadboy`, 156 programs of up to 17 MB. The flow set finishes,
  in 1,449 s of a 1,751 s scan at `8a19f3f`. Doubling the programs it reads takes 2.4 times as
  long, because collection walks everything the graph holds.

What the graph holds, measured at `94d6814` when the walk starts:

| | cnafbadboy `Batch/` (26 programs) | Unieuro, one program in ten (328) |
|---|---|---|
| Nodes | 1,013,739 | 1,910,205 |
| Edges | 2,208,762 | 4,130,189 |
| Sources / sinks | 0 / 98,795 | 18,479 / 40,905 |
| Check references held on nodes | 4,690,444 | 1,543,316 |
| Fact bitsets kept, and their bytes | 634,800, 1,565 MB | 1,604,585, 663 MB |
| Of which distinct | 195,549 (31%) | 377,715 (24%) |
| JavaScript heap | 1,725 MB | 1,968 MB |

Two costs, and they are different:

- **Memory.** The fact bitsets are the largest single thing and live outside the JavaScript heap.
  They and the heap together are what the memory reserve measures, and what stops Unieuro.
- **Time.** Collection marks every JavaScript object the graph holds: a node object with three
  arrays, an object per edge, and an array slot per check per node. About a kilobyte of heap per
  node in both samples.

## 2. What must not change

- **Every route is still found and evaluated.** Nothing here removes a node, an edge or a source,
  however unlikely it looks. The rule the precision work follows applies here too: a route may go
  only where no run can take it, and none of these changes decides that.
- **Reports are byte-identical**, `peakHeapBytes` aside: findings, checked routes, constructs,
  entries and every count, on the equivalence set in §5.
- `analyze()` keeps its signature and result. `lib/sets/flow.mjs`, `lib/gate.mjs`,
  `lib/consequence.mjs` and `lib/index.mjs` do not change.

## 3. The graph today

Built per program in `summarise()` while that program's parse is in hand, then kept until the walk
ends:

- **Nodes**: one plain object per data item, token, index name or container that takes part in a
  move, `{ id, pk, program, file, name, off, size, repeats, edgesOut: [], sources: [], sinks: [] }`,
  plus `linkage`, `tableOff`/`tableEnd`, `checks`, `guard`, `screen` and `suffix` where they apply.
- **Edges**: `{ to, why, dir, at?, ...link }` pushed onto the source node's `edgesOut`. `why` is a
  string, or an object naming the verb, file, line and statement point.
- **Checks**: for every check the control analysis finds, one entry object, pushed onto the `checks`
  array of every node whose bytes lie inside the checked field. One check on a record field reaches
  every item under it: `Batch/` holds 4.7 million references.
- **Per program**: `programs[pk]` keeps `facts`, a `Map` from statement point to a `Uint32Array` of
  the checks holding there, and `reached`, plus call sites, parameters and the program's entries.

## 4. Design

Five changes, each committed on its own and each exact.

### 4.1 Intern the fact bitsets

Most statement points hold the same facts as their neighbours: 69% of the bitsets kept in `Batch/`
and 76% in the Unieuro sample duplicate one kept already. Each program keeps one copy of each
distinct bitset, and `facts` maps a point to it.

- Read-only after `buildControl` returns. Before the change is committed, a test run deep-freezes them and must
  produce identical reports, as `94d6814` did for parse results.
- Expected: cnafbadboy `Batch/` 1,565 MB of bitsets to about 480 MB; Unieuro's sample 663 MB to
  about 160 MB.
- Optional, measured first: intern across programs as well. More saving, and one shared table to
  reason about.

### 4.2 Keep each check once, with its record

A check is stored once, against its record and byte span. A node finds the checks that cover it
from its record and its own extent when the walk asks (`creditAt`), in the order `summarise()`
pushes them today. Every credit is computed from the same list in the same order.

Removes the 4.7 million array slots in `Batch/` and the arrays that hold them.

### 4.3 Nodes and edges in typed arrays

- **Nodes** become columns indexed by id: `pk`, `name` and `file` as indices into string tables,
  `off`, `size`, `tableOff` and `tableEnd` as integers with a sentinel for none, and one byte of
  flags for `repeats` and `linkage`. `sources`, `sinks`, `guard`, `screen` and `suffix` are sparse,
  held in maps keyed by id for the few nodes that have them.
- **Edges** are appended to growable typed arrays during the build, `from`, `to` and a meta index,
  and frozen into compressed-row form before the walk: `outStart[id]..outStart[id + 1]` indexes
  `outTo` and `outMeta`. `outMeta` points into an interned table of `{ why, dir, at, link }`,
  which repeats heavily: one verb at one line moves many fields.
- The walk loops (`canReach` and `innerReach`, the walk per start node and reach class, and
  `refuse`) read the arrays directly. Building
  findings reads a node through a small accessor, since it touches few nodes.

Expected: the JavaScript objects the graph holds fall from millions to the few tables and sparse
maps, which is what collection pays for. The bytes per node drop from about a kilobyte to a few
dozen plus its share of edges.

### 4.4 One control analysis per distinct program

A program whose text another program file in the repository repeats keeps its control analysis,
`buildControl`'s result, for the copies (`lib/control-reuse.mjs`). `summarise()` still runs for
every copy: the copy's nodes, edges, sinks, `pk` and paths are its own, built as they always were.
Only the control analysis, the expensive and pure part, is not repeated.

Not the whole fragment. `summarise()` writes identifiers into text, a sink's group is the string
`${pk}|${key}`, and paths into fields. A replayed fragment would need every such field rewritten,
and the list of them goes stale as `lib/dataflow.mjs` changes.

How a kept analysis is carried to a copy:

- It refers to objects of the program's parse: statements, items, tokens. Each reference is kept as
  the object's position in a walk of the parse that visits it in one fixed order, breadth first over
  array elements, Map entries, Set values and own properties. The copy's parse, walked the same way,
  supplies the copy's objects.
- A string equal to one of the program's files, its own or a copybook it resolved, is kept as that
  file's place in the list and becomes the copy's file. A path inside a longer string, or a value
  that is not plain data, means the analysis is not kept, and the copy is analysed afresh.
- The key is the program's text, its position in its file, and each copybook's resolution status
  and text. It holds within one repository's analysis, where the BMS maps and the site's facts that
  `summarise()` reads are fixed. Found by an audit of `summarise()`'s free variables with a
  JavaScript parser at `150a9c4`: it reads the graph it builds, constants, pure helpers, and three
  repository-level inputs: `site.compilerOptions`, `bmsMaps` and `rel`, which only fills `file`
  fields.

Gates, and how each is met:

- **Equal to the program's own.** `COBOLWORK_VERIFY_REUSE=1` computes every reused analysis afresh
  as well and stops the flow set if the two differ, objects of the parse compared as themselves.
  The tests and the equivalence run use it.
- **Location.** A test puts one caller in two directories, each beside a different callee, and
  requires each copy's findings to follow its own callee. A second puts copies of a caller and its
  callee in two directories and requires each finding to carry its own paths.
- **Equivalence.** The run in §5 adds the repositories whose copies sit in different directories:
  cnafbadboy, `ezpzresearch-max_Agentic-C0-Bug`, `infinityabundance_gnucobol-rs` and
  `rishalab_COBug`. A wrong key gives wrong findings without an error: the verify run matters
  more than the test suite.

What reuse covers, and what it does not:

- The flow engine's control analysis only. Every other set's results carry the program's path, and
  their cost is mostly the parse, which `94d6814` already reads once.
- Copies only. The first copy of a program still pays the arithmetic rounds of `5d76dbd`.
- Few repositories. Within one repository, from the 3185 corpus's git blobs: 24,405 of 137,527
  program files duplicate another, in 176 of 3,019 repositories. One repository holds 14,500 of
  them (`ezpzresearch-max_Agentic-C0-Bug`, 15,970 programs), and cnafbadboy holds three copies of
  each of its 52. Most estates gain nothing.
- Large programs only, 256 KiB of text and more (`reuseMinBytes`). On
  `ezpzresearch-max_Agentic-C0-Bug`, 14,500 copies of small programs, keeping and restoring took
  longer than analysing: 140 s against 85 s for the whole scan. With the bound it does not engage
  there. On cnafbadboy, three copies of each of 52 programs of up to 17 MB, a full scan took 589 s
  against 928 s.
- Every program file is read once more before the pass, to find the copies. Every repository pays
  that read, copies or not.

### 4.5 Build control analyses in worker threads

A worker runs `buildControl`, the pure per-program part of the flow set and most of its time on large
programs. `summarise()` writes the shared graph and numbers its nodes in program order, so it stays on
the main thread, and so do linking and the walk.

- **What a worker does.** It reads and parses the file as the directory tree does, from
  `tree.parseSpec` (`parseInDirectory`), runs `buildControl` and the fact interning on each program,
  and posts each analysis kept as 4.4 keeps a copy's: references into the parse as positions in a
  fixed walk of it. The main thread restores it onto its own parse of the same file. A parse is never
  sent: it is an object graph that clones slowly, and its identity is what the analysis refers to.
- **Which programs.** 32 KiB of text and more (`controlWorkerMinBytes`). Below that, walking the
  parse and restoring cost the main thread about what building does: on ACAS, 410 programs, moving
  every one saved 1 s of 3.3 s. A later copy that 4.4 restores is not sent, and neither is a PL/I
  program, which its own parser reads rather than the tree's.
- **Order and waiting.** The main thread asks for the files after the one it is reading, at most one
  more than there are workers at a time, since an answer waiting to be taken holds the whole
  analysis: up to 217 MB serialised on cnafbadboy. A file no worker has started when the main thread
  reaches it is taken back and analysed there; a started one is waited for. The scan stays
  synchronous: the wait blocks on a counter the workers raise (`Atomics.wait`), and answers are read
  with `receiveMessageOnPort`.
- **A worker that fails.** Every failure a worker can catch is answered, and the main thread then
  analyses the program itself. One that runs out of heap dies without answering, and nothing the
  main thread can read while it waits says so. A worker's heap is the main thread's size, so that
  program would exhaust the main thread's too: the wait for a started analysis ends at 30 minutes.
- **Trees.** Directory trees only. A tree held in memory (a git revision, a PDS export, a test's)
  has no `parseSpec`, and its programs are analysed on the main thread as before.
- **How many.** `COBOLWORK_CONTROL_WORKERS`, or `controlWorkers` in the options; by default one fewer
  than the machine's threads, at most four. 0 turns them off.
- **Memory.** A worker holds one program's parse and analysis at a time: 0.8 to 1.3 GB at its peak
  on cnafbadboy's programs of 9 to 17 MB. That memory is the machine's, which the memory guard reads,
  so on a machine short of memory the flow set can stop reading sooner with workers than without.

Gates, and how each is met:

- **Equal to the program's own.** With `COBOLWORK_VERIFY_REUSE=1` every analysis a worker built is
  built again on the main thread and compared, as a reused one is.
- **Equivalence.** The run in §5 with verify on: CardDemo, CABS, CobolCraft, GenApp, CobolSharp,
  LASA, ACAS, one Unieuro program in ten, cnafbadboy's `Batch/`, `rishalab_COBug` and
  `infinityabundance_gnucobol-rs`, reports identical to `main`.

Full scans, 0 workers against 4, reports identical. Single runs except where marked, on a shared
18-thread machine at load 25 to 67, so each figure is good to about a fifth:

| | 0 workers | 4 workers | Peak resident, 0 / 4 |
|---|---|---|---|
| cnafbadboy `Batch/`, 26 programs of up to 17 MB | 314 s | 109 s | 1.6 / 4.1 GB |
| CobolSharp | 151 s | 78 s | 0.4 / 1.3 GB |
| LASA | 293 s | 199 s | 1.1 / 1.0 GB |
| `infinityabundance_gnucobol-rs` | 103 s | 50 s | 0.6 / 1.6 GB |
| ACAS, run twice, alternating | 129, 205 s | 123, 156 s | 1.1 / 1.1 GB |
| One Unieuro program in ten, run twice, alternating | 452, 435 s | 305, 313 s | 1.3 / 2.9 GB |

The flow set alone on the Unieuro sample took 371 s with no workers and 204 s with four: the main
thread's share of the control analysis fell from 204 s to 34 s, and it waited 41 s in 25 waits for
analyses a worker had started. What remains on the main thread is the parse, `summarise()` and the
walk.

### 4.6 Every source gets a walk

Measured at `b0deb6e` on the whole Unieuro estate, the first eleven walks, from fields of ATTRIB,
CALC3 and LEGGIPN that programs throughout the estate read, each reach millions of states, eight
are cut at the 79 million edges one walk may take, and those walks with the refusals of their
credited findings spend the 2.1 billion edges all walks share before a twelfth source is walked,
and 167,365 sources are never walked. The bounds were set for ACAS, whose largest walk
needs 78.7 million, and they give every edge to whichever walks come first.

Each walk now leaves the walks still to come a reserve, `minWalkEdges` apiece, of the total: a walk
may take `walkEdges`, but no more than what is left of the total once the reserve is set aside, and
never less than `minWalkEdges`. A refusal walk (the second search that drops a credit) takes the
same at the time it runs. The walks to come are counted first, one per start node and reach class,
which is how `b0deb6e` walks. A walk that takes less than its share, which is nearly every walk,
leaves the rest to those after it, so an estate within the total is walked as before, byte for
byte: volume-10k, ezpz, apac and a tenth of Unieuro give the same reports. An estate past it walks
every source and cuts its largest walks instead of leaving its last sources unwalked: ACAS, which
had 303 sources unwalked and 1,603 findings, now walks every source with 70 walks cut at the floor
and reports 1,845, the findings an unbounded walk gives it. Unieuro walks every source, 55,064 walks cut at the
floor, and reports 96,668 flow findings where it reported 77,198, in 1,414 s against 2,613.

The three are `flowWalk.walkEdges`, `flowWalk.totalEdges` and `flowWalk.minWalkEdges` in
`cobolwork.site.json`, defaulting to 79 million, 2.1 billion and 20,000. The floor is what nine
walks in ten on a tenth of Unieuro have found their last finding within; at 166,586 Unieuro
sources it reserves 1.26 billion of the 2.1. The summary reports `edgesWalked` and
`walkEdgesLeast`, the least any walk was given, and `readInPart` names it.

### 4.7 Sharing work across call contexts

The first giant walk of Unieuro, from ATTRIB's FC-RECORD, holds 6,807,751 states over 533,350
nodes: 3,941,958 carry one of 388,672 call contexts, 1,085,602 carry none, and 4,009,979 are partial
(a byte range of a group). A node is visited about nine times, once per context that reaches it,
and inside a shared subprogram the states under one context repeat the states under another,
differing only in which caller the value returns to. That repetition is what summaries remove.

**Design: a summary per callee entry.** When a walk crosses a call edge into a callee's parameter
`p` with taint `π` (whole, or a byte range), it asks for the summary of `(p, π, reach)` instead of
walking the callee under its context. The summary is one breadth-first walk from `p` confined to
the callee and what it calls, using summaries for those in turn, never returning past `p`'s own
level, and records in order: every state at a node with sinks (an arrival, with its chain of hops
from `p`), and every state at a linkage item that has a return edge (an exit, with its chain and
its taint). The caller's walk then reports each arrival for its source, hops being the caller's
chain to the call followed by the summary's chain, and enqueues each exit under its own context,
from which the return edge crosses as it does today. A summary is computed once per `(p, π,
reach)` and kept for the analysis; a callee that is being summarised when it is reached again (a
recursive call) is walked plainly under its context, as now.

**What stays the same.** Which sinks each source reaches, so the set of findings; the credit
levels, since the credited route's checks are on the summary's chain and the refusal walk uses
summaries the same way; the budget rule of 4.6, counted in edges the summaries and the walks
examine together.

**What changes.** The route a finding shows. Today it is the first route breadth-first search
finds, the shortest in hops; with summaries it is the caller's first route to the call followed by
the summary's first route inside, which is a route but not always the shortest, and where two
routes tie the one shown may differ. `guard` names the check on the route shown, so it may name a
different check of the same level. `hops` may be larger. A report comparison must therefore
compare findings by rule, source, sink and credit level, not byte for byte, and count the routes
that differ.

**What it cannot reach.** The 1,085,602 states without a context are a value that has rested in a
subprogram's own storage, from which the walk returns to every caller (the resting-storage rule):
they are one state per caller continuation and no summary collapses them. Nor the 779,844 sink
arrivals of that walk, each a finding to report. The giant walks therefore shrink by the context
share, which the probe puts at about four fifths of their states, not to nothing; with the floor
of 4.6 they still take what the reserve leaves them. The measure that decides whether to build it
is the whole-estate walk time and the count of routes that differ on the 500 corpus, cnafbadboy
and ACAS.

**Refusals.** The refusal walk re-walks from the source refusing to leave a node where a credit
holds. With summaries it must carry the same refusal into the callee: a summary computed for a
refusal is keyed by the credit level and kind as well, or the refusal walks plainly within its
budget as today. The second is simpler and bounded by 4.6; the first is exact to today's credits.
The operator's ruling decides which.

## 5. How each change is committed

One change per commit, in the order above. Each must pass, before it is committed:

1. `node --test --test-concurrency=1`.
2. **Equivalence**: full-scan reports byte-identical with `main` (`peakHeapBytes` aside) on
   CardDemo, CABS, CobolCraft, GenApp, CobolSharp, LASA, ACAS, one Unieuro program in ten,
   cnafbadboy's `Batch/`, and 200 corpus repositories with flow findings chosen by a fixed seed.
3. **Measure**: full scans of cnafbadboy and Unieuro, wall time, peak resident memory, and whether
   the flow set read every program.

The harness that checked `94d6814` does steps 2 and 3: `freeze-audit.mjs` (scan with `FREEZE=0`,
or with every parse frozen) and `same2.mjs` (compare, naming the first difference). It belongs in
`diag/` when 4.1 starts.

## 6. Risks

- **`lib/dataflow.mjs` is the most edited file in the repository**, 19 commits in the three days
  to 2026-10-02, mostly flow precision. Each phase is small, claimed in SPINE before it starts, and
  rebased onto `main` immediately before it is committed, with the equivalence run repeated there.
- **An invariant the old shape gave for free**: an object per node made identity the key. Every
  `Map` and `Set` keyed by a node object (visit stamps, the call context, `byItem`) is listed and
  rekeyed by id in 4.3 before any column replaces a field.
- **Fragments and the arithmetic rounds**: `buildControl` repeats its analysis up to 12 times on
  a large program since `5d76dbd`. 4.4 removes that cost for each copy of a program, not for the
  first. Whether to cap the rounds is a precision decision, not this specification's.

## 7. Decisions

- Facts interned within each program, or across all of them (4.1).
- Whether 4.4's key includes the program's directory, which would make it exact without relying
  on the claim that location enters only at linking. It would lose cnafbadboy's three copies,
  which sit in different directories.
- The default worker count (4.5): one fewer than the machine's threads, at most four.
- Whether to build 4.7, and whether its refusals carry the refusal into summaries (exact credits,
  more summaries) or walk plainly within the budget (simpler, credits may be lost where the budget
  ends). Operator 2026-10-10: build it; the refusal choice is open.
