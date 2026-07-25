# rules/ — the witness-layer RuleDefs

**STATUS: DRAFT — steward ratification required before the ceremony (PHASE_2 §6.1 / §6.1a).**
Nothing here has been published. These two files are the exact intended content of the
first two messages on the Witness Rule Registry, and the first message on an immutable
topic is not a place to improvise: read every line before the ceremony.

Both rules block the ceremony, not one (§6.1a). The registry cannot be created-and-populated
until both are ratified, because the first grant (`mandate-morpheme`) needs the delegation
rule's `ruleUri`, and the first mandated verdict needs the conformance rule's.

## Shape

Same `hcs.ontologic.ruleDef` schema as the live colour sphere (RULE_DEFS `0.0.8641938`),
so `resolveRuleDef` works unchanged. Witness rules are distinguished structurally:

- `ruleId` namespace `witness://org/…` (colour rules are `sphere://demo/…`)
- `domain` prefix `witness.` (colour rules are `color.*`) — this prefix is the
  cross-registry impersonation check in `verify.ts` (PHASE_2 §4.3)
- `engineType: "read-time-verifier"` — these rules are executed by every reader's
  verifier, not by an EVM engine; there is no functionSelector to call

## Publish-time fields (filled by `publish-witness-rules.ts`, never hand-edited)

- `author` — the ROOT account ID (exists only after ceremony §3.1)
- `createdAt` — publish instant
- `contentHash` — `keccak256(canonicalizeJSON(ruleDef minus ruleUri/ruleUriHash/contentHash))`,
  computed through the seam's `computeContentHash`; makes the RuleDef self-hashing
- the follow-up `ruleRegistryEntry` message — `ruleUri` (`hcs://<registry>/<consensus ts>`)
  and `ruleUriHash` (sha256 of that URI), the same two-message pattern the colour sphere uses,
  on the ONE witness topic (§6.5, confirmed 2026-07-25)

## Ratification checklist (steward)

- [ ] `witness-lane-conformance.draft.json` — predicates match `judgeMessage`'s real check
      order; each failure names its `ReasonCode`; the success clause says the stamp is the verdict
- [ ] `witness-delegation.draft.json` — carries the three Addendum A constraints (§3.5)
      verbatim in force; grant-validity predicates match `verify.ts`'s W-11 chain
- [ ] rule ids / versions / descriptions read as ORG wants them permanently recorded
