# ⑤ Vendor rule packs

Every shop runs a different stack on top of z/OS, and each product brings verbs that do privileged
things. A pack is loaded only by a customer who runs that product, which is what keeps the rule set
quiet for everyone else.

| | |
|---|---|
| Task size | Medium overall; **Small per pack** after the first |
| Client benefit | Big if they run the product, zero if they do not — averages Medium |
| ROI rank | 3 of 6 |
| Estimate | 12–18h for three packs: ~6h harness and the first pack, ~3h each after |
| Shape | Incremental and individually shippable — the only item that can be sold before it is finished |

## Packs, in the order worth building

| Pack | Why first | Rows |
|---|---|---|
| **Broadcom/CA** | ACF2 and Top Secret are security products; their commands are privilege | ~40 |
| **Control-M (BMC)** | Scheduler — decides what runs as what, everywhere | ~30 |
| **Connect:Direct** | Moves data off the platform. Exfiltration, by design | ~25 |
| Syncsort/Precisely | Sort and replication utilities with dataset reach | ~25 |
| BMC AMI / Compuware | Development and abend tooling with broad dataset access | ~30 |
| Tivoli / IBM Automation | Automation with operator authority | ~20 |

Start with Broadcom because the security products are where a misconfiguration is unambiguously a
finding, so the first pack is the one least likely to produce arguments about severity.

## What ships

One file per pack — `vendor-broadcom.jsonl`, `vendor-controlm.jsonl` — loaded by name. A customer's
`site.json` (see [02-recon](02-recon.md)) lists which packs apply; nothing else is read.

That per-product loading is itself a selling point. The commonest complaint about enterprise SAST
is noise from rules for things the shop does not run.

## Row shape

`kind: "vendor"` in [`../schema.mjs`](../schema.mjs): `vendor`, `product`, `verb`, `risk`,
`severity`, `rationale`, `example`, `source`.

`example` is a fragment showing the verb in use — in JCL, in a `SYSIN` stream, or in a COBOL `CALL`
depending on how the product is invoked.

## Source material

Each vendor's command reference. All copyright their vendor; cache under `feed/sources/`,
gitignored, ship citations. Some references are behind a support login — a customer who runs the
product can generally supply theirs, which is a reasonable thing to ask for during onboarding and
turns a licensing obstacle into a conversation.

## The gate

1. Schema, including a `rationale` of at least 60 characters.
2. `source.quote` verbatim in the cached reference.
3. Where `example` is JCL, it goes through the same statement grammar as ③.

Weaker than ③'s gate, because there is no grammar for a Control-M calendar expression or an ACF2
command. Compensate on the human side: vendor packs need **per-pack review by someone who has run
the product**. A rule about ACF2 written by someone who has never administered ACF2 will be
plausible and wrong, and no gate here will catch it.

That is a genuine constraint on this item. It may be the one to build with a design partner rather
than speculatively.

## The model's role

Enumerate verbs from the reference and draft the risk statement. Highly repetitive, well suited.

**It must not** assign severity without review, or infer how a product behaves from its name.
Vendor documentation is the only admissible source; the model's background knowledge of Control-M
is exactly the kind of confident half-memory that produces a rule nobody can defend on a call.

## Done when

Per pack:
- Every verb in the product's command reference has a row or a recorded decision to skip it.
- Someone who has administered the product has reviewed the pack.
- At least three benchmark case pairs exercise the pack's highest-severity rules.
- The pack loads only when `site.json` names it, and a scan without it is byte-identical to a scan
  before the pack existed.

## Risk

Breadth without depth. Six shallow packs are worth less than two that a practitioner respects, and
the shallow version is easy to produce quickly with a model — which is precisely why this item
needs a human gate rather than a tighter machine one.
