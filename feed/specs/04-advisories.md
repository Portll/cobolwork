# ④ Compiler and runtime advisories

A crafted source file in a pull request can target the compiler that CI runs on it. The rule reads
the compiler version a repository's build pins and compares it against published advisories.

| | |
|---|---|
| Task size | **Small** |
| Client benefit | Small–Medium — true, useful, unglamorous |
| ROI rank | 4 of 6 |
| Estimate | 4–8h |
| Ship it | **First.** Not because it is the most valuable, but because it is the cheapest way to establish that a feed exists and arrives on a cadence |

## What ships

`advisories.jsonl`, plus a rule `build-pins-vulnerable-compiler` that reads what the repository's
build pins — a `Makefile`, a `Dockerfile`, a CI workflow, a `cobc` invocation — and compares.

A subscription is credible only once a customer has seen it update. This is the item that proves
the pipeline works, and it costs a day.

## Row shape

`kind: "advisory"` in [`../schema.mjs`](../schema.mjs): `product`, `id`, `affected`, `fixedIn`,
`severity`, `summary`, `source{doc,url,retrieved,quote}`.

`product` is one of `gnucobol`, `ibm-enterprise-cobol`, `opentext-cobol`, `cics-ts`, `db2-zos`.

`affected` must be a range the rule can evaluate: `<=2.2`, an exact version, a closed interval
`[2.0,2.2]`, or several joined by `||`. Anything a machine cannot compare is not a rule input.

## Source material

| Product | Where | Status |
|---|---|---|
| GnuCOBOL | NVD/CVE, SourceForge bug tracker, release NEWS | Public |
| IBM Enterprise COBOL | IBM Security Bulletins, APAR/PTF lists | Public, IBM copyright |
| OpenText/Micro Focus COBOL | OpenText advisories | Public, requires account for some |
| CICS TS | IBM Security Bulletins | Public |
| Db2 for z/OS | IBM Security Bulletins | Public |

[`../../BACKLOG.md`](../../BACKLOG.md) item 4 records that fuzzing found memory-safety bugs in
GnuCOBOL 2.2 **from memory, not verified** — and says to check the advisories before writing a
rule. That instruction stands: the first row in this feed must be confirmed against NVD, not
against anyone's recollection. It is a reasonable seed for the worklist and nothing more.

## The gate

1. `affected` parses as an evaluable version range (`versionRangeProblems()` in
   [`../verify.mjs`](../verify.mjs)).
2. `source.url` is required — unlike other kinds, an advisory without a link is not citable.
3. `source.quote` appears verbatim in the cached advisory page.
4. A cross-check worth adding once there are rows: `id` matching `CVE-\d{4}-\d{4,}` should resolve
   against NVD's API, and a CVE that does not resolve is fabricated. This is the single highest-value
   additional gate on the whole feed, because a fabricated CVE ID is both the most likely
   hallucination and the most embarrassing one to ship.

## Worklist

Every published advisory for the five products. Realistically **30–60 rows** to start, and a handful
per quarter after that. Seed from an NVD query per product rather than asking the model what exists
— retrieval is the model's job here, recall is not.

## The model's role

Structured extraction from advisory text: pull the version range, the summary and the fix out of a
page and put them in the row shape. At 27B this is comfortably in range and the gates are tight.

**It must not** be asked what advisories exist. That is a recall question, it will confabulate CVE
IDs fluently, and the whole item is worthless if a single fabricated identifier ships. Give it the
page; ask it to read.

## Done when

- Every current advisory for the five products has a row.
- The `build-pins-vulnerable-compiler` rule reads at least: `Makefile`, `Dockerfile`, GitHub Actions
  workflow, and a bare `cobc` invocation in a script.
- A benchmark case pair exists: a repository pinning a vulnerable version, and a near-miss pinning
  the fixed one.
- Every CVE ID in the file resolves against NVD.
- A documented refresh cadence, and one refresh actually run, so the customer has seen it update.

## Risk

Low, with one exception: a fabricated CVE ID is a credibility event out of all proportion to this
item's value. Gate 4 is not optional.
