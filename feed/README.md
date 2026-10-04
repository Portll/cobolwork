# The feed

cobolwork's engine is AGPL and stays that way. The feed is the part that **expires**: mappings to
regulations that get amended, utilities that vendors keep shipping, advisories that appear, naming
conventions that belong to one customer. A forked scanner with this year's rules is worthless in
two years, which is the only durable thing a security tool sells.

Five items, specified in [`specs/`](specs/), ordered by benefit against cost:

| | Item | Task | Benefit | ROI | Estimate |
|---|---|---|---|---|---|
| ① | [Compliance mappings](specs/01-compliance.md) | Medium | **Big** | **1** | 20–30h |
| ③ | [JCL as an attack surface](specs/03-jcl.md) | Large | **Big** | 2 | 15–25h |
| ⑤ | [Vendor rule packs](specs/05-vendor-packs.md) | Medium | Medium | 3 | 12–18h |
| ④ | [Compiler advisories](specs/04-advisories.md) | Small | Small–Med | 4 | 4–8h |
| ② | [Site reconnaissance](specs/02-recon.md) | Med–Large | Medium | 5 | 14–20h |

≈ 90 hours against roughly 14 hours of engineering time in the engine so far. **The feed is about
eight times the tool.** That is the argument for selling it before building all of it: ship ④ and
half of ①, charge, and let the first customer fund ③.

## Nothing here is taken on trust

A language model writes fluent, coherent, plausible security rules that are wrong, and coherence is
the one thing it is best at faking. So the model never judges its own work. It proposes; a
deterministic gate disposes.

```
     worklist ──▶ generate.mjs ──▶ verify.mjs ──┬─▶ accepted  ──▶ human review
                       ▲                        │
                       └──── rejection reasons ─┘
```

[`verify.mjs`](verify.mjs) checks, in increasing cost:

1. **Shape** — [`schema.mjs`](schema.mjs). Cheapest rejection there is, and the model produces
   these in bulk.
2. **Verbatim quote** — the quoted text, whitespace-normalised, must appear in the cached source
   document. This is the load-bearing check. It cannot establish that a mapping is *correct* — no
   machine can — but it establishes that the document *says what the row claims it says*, which is
   the failure a model produces in volume and a reviewer is worst at catching.
3. **Whatever else the kind admits** — JCL statement grammar, regex behaviour against its own
   declared near misses, evaluable version ranges, `ruleId` against the engine's own tables.

Everything that survives still gets read by a person. The gate's job is to make that review about
judgement rather than about fact-checking citations.

## Running it

```
lms load qwen3-27b                                  # anything with an OpenAI-compatible endpoint
node feed/generate.mjs --kind utility --worklist feed/worklists/utility.json
node feed/verify.mjs feed/out/utility.jsonl
```

`generate.mjs` is resumable and hands-off: each target gets up to `--attempts` tries, the gate's
rejection reasons are fed back verbatim as the next attempt's instruction, and a run that is
interrupted picks up where it stopped. It exits non-zero while any target is unanswered, so
"complete" is a property of the worklist rather than a claim about the run.

Read `feed/out/<kind>.rejects.jsonl` to fix **the brief, not the gate**. If a gate is rejecting
good rows, that is a finding about the gate; if it is rejecting bad ones, the brief in
[`generate.mjs`](generate.mjs) is what needs the work.

## What the model may not do

`GENERABLE` in [`schema.mjs`](schema.mjs) names the kinds a model may author, and the feed holds no
kind that carries a precision label. Precision labels are made by machine, in `bench/`: execution
labels from ironwork, negatives from coverage, planted flaws, and two models agreeing. A model's
opinion of one finding is never a label on its own.

The model *may* triage: ranking which programs deserve a person's attention changes no label.

## Licensing

The tooling here is AGPL with the rest of cobolwork — it has no standalone value and publishing it
is good for the project. The **generated rows** are the licensed artifact and belong under separate
terms; `feed/out/` is gitignored accordingly.

Source documents are other people's copyright. The utility manuals are IBM's. They are cached under `feed/sources/` for the gate to check quotes against, that directory
is gitignored, and **the feed ships citations, not text**. Quoting a clause to identify it is
ordinary; assembling enough that the feed substitutes for the standard is not.

## One firm rule about the open side

Everything already in the repository stays AGPL permanently — the 53 rules, the 26 benchmark cases,
the engine. Moving existing open functionality into the paid tier later is the Elastic/Redis move,
and it buys a hostile fork from exactly the community this project needs. **The feed is net-new or
it is nothing.**
