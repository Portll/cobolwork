# ③ JCL as an attack surface

Most of the mainframe's privileged surface lives in JCL rather than in COBOL. The 2026-09-18
evaluation counted 27 JCL files carrying RACF or IDCAMS commands in-stream, and IDCAMS 172,
IKJEFT01 58, SORT 39 and IEBGENER 26 steps across its corpus. cobolwork currently recognises JCL
by extension ([`../../lib/sources.mjs:14`](../../lib/sources.mjs#L14)) and reads it as free-format
text for the hidden-content rules. Nothing parses it.

| | |
|---|---|
| Task size | **Large** |
| Client benefit | **Big** — every mainframe person understands it in one sentence |
| ROI rank | 2 of 6 |
| Estimate | 15–25h. Comparable to the flow engine, because it adds a parser |
| Splits into | A: parser (open, AGPL). B: utility knowledge base (feed) |

## The split that matters

The **parser** is engine work and belongs in `lib/`, open, under AGPL. It is [`../../BACKLOG.md`](../../BACKLOG.md)
item 1 and it should not be held back — it is the credibility half.

The **utility knowledge base** is data, perishable, and belongs in the feed: which parameter of
which utility does something worth seeing, and why. That is the half that renews, because vendors
ship new utilities and new parameters and nobody's list stays current.

Build A first. B is worthless without it and A is publishable without B.

## A. The parser — `lib/jcl.mjs`

### What it must read

- **Statements.** `//name op operands`, name field 1–8 characters in columns 3–10, operation in a
  fixed set, operands to column 72. Columns 73–80 are the sequence area and are not the statement.
- **Comments** (`//*`), **delimiters** (`/*`), the **null statement** (`//`).
- **Continuation.** An operand field ending in a comma continues on the next statement, resuming
  between columns 4 and 16. This is where naive readers break, and a payload hidden across a
  continuation boundary is exactly what a hidden-content rule should catch.
- **In-stream data.** `DD *` and `DD DATA` open a data stream that runs to `/*` or the next
  statement — and `DLM=` changes the delimiter, which is how in-stream RACF commands hide.
- **Procedures.** `PROC`/`PEND`, symbolic parameters and their substitution, `INCLUDE` members.
- **Steps.** `EXEC PGM=` and `EXEC procname`, with `PARM=`, `COND=`, and the DD statements that
  belong to each step.

### What it must produce

```
{ jobs: [ { name, operands, steps: [ { name, pgm, proc, parm, dds: [ { name, dsn, disp,
            sysout, inStream: [lines], dlm } ], line } ], line } ],
  symbols: {...}, includes: [...], unresolved: [...] }
```

Shaped like [`../../lib/parser.mjs`](../../lib/parser.mjs)'s output: positions on everything, and
whatever could not be resolved named rather than dropped. `INCLUDE` of a member not in the tree is
a coverage gap and sets `coverageIncomplete`, exactly as an unresolved `COPY` does.

### Rules it unlocks

| Rule | Severity | Why |
|---|---|---|
| `jcl-parm-to-os-command` | crit | `PARM=` is an untrusted source reaching a program's LINKAGE |
| `jcl-instream-racf` | crit | RACF commands in `SYSIN DD *` — credentials and privilege in plain text |
| `jcl-instream-idcams-delete` | high | Destructive dataset operations in-stream |
| `jcl-test-job-touches-production` | high | Needs ② for what "production" means |
| `jcl-dlm-hides-instream` | med | A non-default `DLM=` conceals what follows from a naive reader |
| `jcl-exec-pgm-unresolved` | info | A step runs a program no source in the tree defines |

`PARM=` and in-stream `SYSIN` become **sources** in [`../../lib/dataflow.mjs`](../../lib/dataflow.mjs),
and `EXEC PGM=` links a step to the program it runs, so taint crosses from JCL into COBOL. That is
the payoff: the flow engine currently starts at the program boundary, and the real entry point is
one level above it.

### Gate

The parser is graded the way the COBOL parser is: against an oracle, on held-out repositories.
There is no free JCL compiler, so the oracle is weaker — use three in combination:

1. **Round trip.** Reserialise the parsed statement and compare to the original, modulo whitespace.
   Anything that does not round-trip was misread.
2. **The 500-repo corpus.** Every `.jcl` file in it must parse without an internal error, and the
   step and DD counts are compared against a conservative regex counter; disagreements are read by
   hand and become test cases.
3. **Hand-built fixtures** for continuation, `DLM=`, symbolic substitution and nested `PROC`.

A statement the parser cannot read is reported, never skipped silently.

## B. The utility knowledge base — feed

`kind: "utility"` in [`../schema.mjs`](../schema.mjs): `utility`, `parameter`, `effect`,
`severity`, `rationale`, `jcl`, `source`.

**Source material:** IBM's *z/OS DFSMS Access Method Services Commands* (IDCAMS), *z/OS MVS JCL
Reference*, *DFSORT Application Programming Guide*, *TSO/E Command Reference* (IKJEFT01). All
copyright IBM — cache under `feed/sources/`, gitignored, ship citations only.

**Worklist:** ~14 utilities × ~10–20 parameters ≈ **180–220 targets**. Start with the five the
evaluation actually counted: IDCAMS, IKJEFT01, SORT/DFSORT, IEBGENER, IEFBR14.

**Gate:** the `jcl` fragment in every row is checked against the statement grammar. Until `lib/jcl.mjs`
lands this is `jclProblems()` in [`../verify.mjs`](../verify.mjs); after it lands, the real parser
replaces it and the gate keeps working because the shape of the answer is the same.

This is the best fit on the whole list for a local model: enumerable, documented, repetitive, and
every output is mechanically checkable.

## Done when

- `lib/jcl.mjs` parses every `.jcl` in the 500-repo corpus without an internal error.
- Continuation, `DLM=`, symbolics and nested `PROC` have fixtures and pass.
- `PARM=` is a source in the flow engine and a taint path from JCL into COBOL is demonstrated in
  `bench/cases/`, with its near-miss negative.
- Six new rules, each with a benchmark case pair, scoring as declared.
- The utility knowledge base covers the five counted utilities.

## Risk

Scope. JCL is a bigger language than it looks — symbolic substitution and procedure overrides are
where it gets genuinely hard, and it is tempting to chase completeness. Read the corpus first and
implement what the corpus actually contains; report the rest as unread rather than guessing. The
project's existing discipline about coverage is exactly the right instinct here.
