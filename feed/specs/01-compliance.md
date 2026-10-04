# ① Compliance mappings

Each of the 53 rules cobolwork reports, mapped to the clause of each framework that makes it
someone's obligation. This is what turns a SARIF file into an audit exhibit, and it is the only
item on this list paid for out of a compliance budget rather than a tooling budget.

| | |
|---|---|
| Task size | Medium |
| Client benefit | **Big** |
| ROI rank | **1 of 5** |
| Estimate | 20–30h for all four frameworks |
| Start with | DORA. Ship it, charge, fund the rest |

## What ships

`compliance.jsonl`, one row per (rule, framework, clause) triple, plus a rendered matrix
per framework. A finding in a report gains a `compliance:` block naming the clauses it bears on.

The rendered artifact is the thing a customer actually forwards to their auditor, so it needs to
read as a control document rather than as tool output: clause, obligation, the rule that evidences
it, and what the absence of findings does and does not demonstrate.

## Row shape

`kind: "compliance"` in [`../schema.mjs`](../schema.mjs). Fields: `ruleId`, `framework`, `clause`,
`title`, `rationale`, `source{doc,retrieved,quote}`.

`framework` is one of `dora`, `ffiec`, `nist-800-53r5`, `sox-itgc`.

## Source material, and its licence

| Framework | Document | May we cache it? | May we redistribute the text? |
|---|---|---|---|
| DORA | Regulation (EU) 2022/2554, EUR-Lex | Yes | Yes — EU law, reproduction authorised |
| FFIEC | IT Examination Handbook | Yes | Yes — US Government work |
| NIST 800-53r5 | NIST | Yes | Yes — US Government work |
| SOX ITGC | No canonical text; derive from PCAOB AS 2201 + COBIT mappings | Partly | **No** for COBIT |

This is why `feed/sources/` is gitignored and the feed ships **citations, not text**. Shipping a
quote of a clause for identification is ordinary fair dealing; shipping the corpus is not. Keep
quotes short, and never assemble enough of any standard that the feed substitutes for it.

## The gate

1. Schema: `ruleId` must exist in [`../catalogue.mjs`](../catalogue.mjs), so a mapping cannot
   name a rule that was renamed or never existed.
2. **Verbatim**: `source.quote`, whitespace-normalised, must appear in the cached document.
   This is the load-bearing check — it does not prove the mapping is *right*, but it proves the
   document *says what the row claims it says*, which is the failure a language model produces in
   volume and a reviewer is worst at catching.
3. `rationale` at least 60 characters, so "satisfies the control" cannot pass as reasoning.

There is no machine check for semantic correctness. **Every accepted row still needs human review**
before it ships. The gate's job is to make that review about judgement rather than about
fact-checking citations.

## Worklist

`feed/worklists/compliance.json`, one target per (rule, framework) pair the framework plausibly
touches — not the full Cartesian product, which would be 212 rows of which most are empty.

Pre-filter by rule set:

| Rule set | Rules | DORA | FFIEC | NIST | SOX |
|---|---|---|---|---|---|
| flow | 31 | ✓ | ✓ | ✓ | — |
| cics | 4 | ✓ | ✓ | ✓ | — |
| copybook | 2 | ✓ | ✓ | — | ✓ |
| hidden | 5 | ✓ | ✓ | ✓ | ✓ |
| diff | 5 | ✓ | ✓ | — | ✓ |
| credential | 6 | ✓ | ✓ | ✓ | ✓ |

≈ 120 targets across four frameworks.

Each target carries `documentText`: the chunk of the regulation the model may quote from. Chunk by
article or requirement, not by token count — a clause split across two chunks produces a quote that
exists in neither.

## The model's role

Draft the mapping and find the clause. At 27B this is a retrieval-and-justify task, which is well
within range, and the verbatim gate contains the one failure mode that would be expensive.

**It must not** choose which framework applies, decide severity, or reach for a near-miss clause
when none fits — the brief in [`../generate.mjs`](../generate.mjs) instructs it to return an empty
`clause` instead, and an empty clause is a signal to a human, not a failure.

## Done when

- Every target has an accepted row or a recorded "no clause covers this".
- A human has reviewed every row's *semantics* (not its citations — the gate did those).
- The rendered per-framework matrix exists and reads as a control document.
- A named auditor or compliance officer has read one and said it would be accepted. Without that
  last step this is a guess about what auditors want.

## Risk

A wrong clause number in an audit exhibit is worse than no mapping at all: it transfers your error
onto the customer's filing. This is the one feed item where the correct response to uncertainty is
to ship fewer rows. Resist the temptation to fill the matrix.
