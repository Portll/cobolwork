# Flow graph: compact storage, and one analysis per distinct program

How the flow engine holds its graph so that the largest repositories finish a full scan within
memory, without leaving out a single route.

Status: proposed, 2026-10-02. Not started.
Written for an engineer coming to it cold. It assumes the codebase, not the discussion that produced
it, and it is measured against `94d6814`, where one pass reads and parses each program for every
rule set (`lib/kernel/shared-pass.mjs`).

Depends on: nothing outside `lib/dataflow.mjs`. `analyze()` returns findings, constructs, entries
and counts, never the graph. Every change below stays inside that file and `lib/control.mjs`.

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
- The walk loops (`canReach`, the per-source walk and `refuse`) read the arrays directly. Building
  findings reads a node through a small accessor, since it touches few nodes.

Expected: the JavaScript objects the graph holds fall from millions to the few tables and sparse
maps, which is what collection pays for. The bytes per node drop from about a kilobyte to a few
dozen plus its share of edges.

### 4.4 One analysis per distinct program

`summarise()` produces a **fragment**: node and edge arrays with ids local to the program, file
references as indices into the fragment's own table (the main file first, then each copybook by
resolved path), the program's interned facts, and its call sites, parameters and entries.
Appending a fragment offsets its ids and maps its file table onto the analysis's own. At
`94d6814` a path reaches `summarise()`'s output only as a field: a node's `file` and the
`{ file, line }` position on edges, sources and sinks. No string it builds embeds one.

Two programs with the same key build one fragment, appended once per path. The key is the SHA-256
of the program's text, of each resolved copybook's text, of the parse options (format, dialect,
defines), and of the program's position within its file.

This is exact because location enters the analysis only where programs are linked: a CALL to the
nearest holder of a program id, a JCL step, a CSD definition, a queue. Linking stays per instance
and global. A copy in another directory links to its own neighbours, exactly as now.

Reach, within one repository, from the 3185 corpus's git blobs: 24,405 of 137,527 program files
duplicate another in the same repository, in 176 of 3,019 repositories. One repository holds 14,500
of them (`ezpzresearch-max_Agentic-C0-Bug`, 15,970 programs), and cnafbadboy holds three copies of
each of its 52.

### 4.5 Build fragments in parallel (later)

Fragments are plain data, typed arrays and tables. Worker threads can build them and transfer
them without copying. Per-program work is independent, and linking and the walk stay on the main
thread. Memory per worker bounds it, and 4.1 to 4.4 are what make that memory small: it follows them.

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
- The worker count, and whether workers ship in the same release as 4.4 (4.5).
