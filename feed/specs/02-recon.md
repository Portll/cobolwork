# ② Site-specific reconnaissance

Committed LPAR and system names, dataset high-level qualifiers, VTAM application IDs, host names
and addresses. None of these is a credential. Each is what an attacker wants to know first, and
none of them appears in any open rule set because what counts as "production" is a fact about the
customer, not about COBOL.

| | |
|---|---|
| Task size | Medium–Large |
| Client benefit | Medium as an abstraction, **Big the moment they see their own LPAR names** |
| ROI rank | 5 of 6 |
| Estimate | 14–20h: ~10h for the false-positive pass, ~4h for the site-config tooling |
| Note | **Ranks 5th to build, 1st as a revenue shape** — the only item that is inherently per-customer and therefore inherently recurring |

## Why it is a feed item and not a rule

[`../../BACKLOG.md`](../../BACKLOG.md) item 2 already states the problem: dataset names appear in
every JCL file, so the rule is about production-looking qualifiers *outside* production jobs, not
about any qualifier at all. That distinction cannot be shipped open, because it needs the
customer's naming convention.

So the open engine gets the mechanism, and the feed gets two things: a **shape library** that is
generic, and a **site configuration** that is not. The second is what renews.

## What ships

1. `recon-patterns.jsonl` — the generic shape library. What an HLQ, an applid, a volser, an LPAR
   name look like across the shops we have seen. Ships with the feed.
2. `site.json` — per customer. Which of their qualifiers are production, which jobs are permitted
   to touch them, which applids are external-facing. Written during onboarding, revised when they
   acquire something or rename an environment. **This is the recurring artifact.**

## Row shape

`kind: "recon"` in [`../schema.mjs`](../schema.mjs). Fields: `class`
(`hlq`/`lpar`/`vtam-applid`/`hostname`/`ip`/`volser`), `pattern`, `matches[]`, `nonMatches[]`,
`needsSiteConfig`, `severity`, `source`.

`needsSiteConfig: true` means the pattern is necessary but not sufficient — it recognises the
shape, and only `site.json` decides whether a match is a finding. Most rows are `true`. A row that
is `false` is claiming to be universally true, which for this class of rule is almost always wrong.

## The gate

1. `pattern` compiles as a regular expression.
2. **Every string in `matches` matches; every string in `nonMatches` does not.** This is the whole
   game for this item. A pattern is only as good as the near misses it refuses, and the near misses
   are what the model is worst at choosing, so they are what the gate checks hardest.
3. The pattern does not match the empty string.
4. No nested quantifier of the `(x+)+` form — this rule set runs over every line of every JCL file
   in the estate and a backtracking pattern is a denial of service against the scan itself.

## Worklist

Six classes × roughly 8–12 shape variants each ≈ **60–70 targets**. Variants come from real
conventions: `PROD`/`PRD`/`P` prefixes, environment infix (`.PRD.`), numeric suffix, four-character
SMF IDs, `CICSP*` applid conventions, and so on.

Seed the `nonMatches` lists from the held-out 500-repo corpus: take real qualifiers that are
demonstrably *not* production and require the pattern to refuse them. That turns the corpus you
already have into a false-positive oracle, which is the expensive part of this item done cheaply.

## The model's role

Expand the shape library. Generating regex variants with matching and non-matching examples is
mechanical and well gated, so this part is genuinely hands-off.

**It must not** set the false-positive threshold, decide what "production-looking" means for a
given customer, or write `site.json`. Those are calibration against real data and a conversation
with the customer respectively.

## Done when

- The pattern library covers all six classes with measured behaviour on the 500-repo corpus.
- A measured false-positive rate exists per class, over that corpus, written down.
- `site.json` has a documented schema, a worked example, and an onboarding script that proposes a
  draft from the customer's own JCL for them to correct.
- The rule fires on a planted production name in a test job and stays silent on 500 repos of
  ordinary ones.

## Risk

This is the item most likely to make the tool look stupid. Every JCL file is wall-to-wall dataset
names; a rule that is 2% wrong produces hundreds of findings on first run and the customer stops
reading the report. **Do not ship this before the false-positive number exists**, and prefer
silence to coverage. The backlog already says as much — it is right.
