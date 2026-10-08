# The advice document

A specification for `cobolwork advise`, the one document that tells a repository in the COBOL
ecosystem what to remediate and which practices it misses, and for the catalogue every item in it
points into. `schema/cobolwork-advice.schema.json` is the shape; `test/advice.test.mjs` holds the
document to it.

Status: in progress, 2026-10-08 (cobolwork-roadmap 16, for 1.0).

## 1. Why one document

A scan report carries findings and, once per rule, an impact and a remedy. The compliance clauses a
rule bears on sit in four files joined by rule id. The fix location lives inside a finding's
exploitability. The build gate reads compiler options. The inventory says what could not be read.
ironwork says what compiles and under which forms. Each is right, and a reader who wants to know
what to do about a repository has to read all of them and join them by hand.

The advice document is that join, done once, by the tool, with every item naming the id it rests on.

## 2. What it carries

- `estate`: what is in the repository by kind, what the compiler made of every program, the dialect
  census and the compiler options observed on CBL and PROCESS cards, with the policy in force.
- `catalogue`: every rule with its set, severity, CWE, text, impact, remedy, steps, references and
  compliance clauses; every practice; every ironwork message the document may cite.
- `items`: one per thing to act on, of five kinds. A `finding` item is a scan finding with its
  fingerprint, verdict and typed fix location. A `practice` item is a best practice the repository
  misses. A `compile` item is an ironwork message about a program. An `option` item is a compiler
  option a program lacks or sets against policy. An `inventory` item is a copybook, file or encoding
  the tools could not take in.
- `summary`: counts by kind, severity, verdict, program and framework, and every item id in order.
- `unmeasured`: every part that could not be measured, and why. An empty list is a claim.

## 3. Rules the document keeps

1. **Every item names its id.** `ref` is a rule id from `lib/sets`, a practice id, a pack rule id
   or an ironwork message id. A reader can look each one up in `catalogue`.
2. **Unmeasured is a state.** Without ironwork, `estate.programs`, `estate.compiler` and
   `estate.dialect` are null, no `compile` item exists, and `unmeasured` says so. A scan that
   stopped early says so. Nothing is reported clean that was not read.
3. **A remediation without a checkable place says why.** `remediation.fixAt` is typed; where no test
   makes the operation safe, `test` is null and `why` points back to the rule's remedy.
4. **ironwork is read by id.** Compile items and the dialect census key on message ids, never on
   wording.
5. **The order is the order.** Items sort by severity, then verdict strength, then kind, then path
   and line, then id. Two runs over one tree give one byte sequence.
6. **Additive.** Formats were frozen at 0.9.0; this is a new document at version 1, and no other
   document changes shape for it. The one change elsewhere types `fixAt` in the finding schema,
   which every finding written since 0.5.0 already satisfies.

## 4. Where ironwork is the compiler

`advise --ironwork <path>` runs `ironwork check` over every program it can resolve, as
`build --ironwork` does. Its W, E, O, R and X messages become `compile` items keyed by id with the
remedy the catalogue gives that id; the same run fills `estate.programs` and `estate.dialect`.
`cobolwork gate` compiles its candidate with ironwork when it is present and names
`cobc -fsyntax-only` as the fallback it used otherwise.

## 5. The renders

SARIF and Markdown are rendered from the document's bytes and add nothing: SARIF carries the
catalogue as rules and the items as results, with the remedy in `help`; Markdown is the document a
person reads, ordered as `summary.ordered` is.
