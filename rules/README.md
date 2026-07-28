# rules/ — the witness-layer RuleDefs

**STATUS: PUBLISHED — ceremony executed 2026-07-27. These files are the source-of-record.**

Both rules are live on the Witness Rule Registry (`0.0.9794232`, submit key = root, admin key null forever):

| Rule | ruleId | Live ruleUri |
|------|--------|--------------|
| Lane conformance | `witness://org/verdict/lane-conformance` | `hcs://0.0.9794232/1785171951.953336104` (3 chunks) |
| Delegation | `witness://org/authority/delegation` | `hcs://0.0.9794232/1785172139.525106079` |

The files here are the exact steward-ratified content those messages carry (minus the
publish-time fields below, which `publish-witness-rules.ts` filled at the ceremony).
Editing them changes nothing on-chain — a change would be a **new version** published
through the same script, which is idempotent by public state: a ruleId that already
resolves on the registry is skipped, never re-published.

## Shape

Same `hcs.ontologic.ruleDef` schema as the live colour sphere (RULE_DEFS `0.0.8641938`),
so `resolveRuleDef` works unchanged. Witness rules are distinguished structurally:

- `ruleId` namespace `witness://org/…` (colour rules are `sphere://demo/…`)
- `domain` prefix `witness.` (colour rules are `color.*`) — this prefix is the
  cross-registry impersonation check in `verify.ts` (PHASE_2 §4.3)
- `engineType: "read-time-verifier"` — these rules are executed by every reader's
  verifier, not by an EVM engine; there is no functionSelector to call

## Publish-time fields (filled by `publish-witness-rules.ts` at the ceremony, never hand-edited)

- `author` — the ROOT account ID (`0.0.9794226`)
- `createdAt` — publish instant
- `contentHash` — `keccak256(canonicalizeJSON(ruleDef minus ruleUri/ruleUriHash/contentHash))`,
  computed through the seam's `computeContentHash`; makes the RuleDef self-hashing
- the follow-up `ruleRegistryEntry` message — `ruleUri` (`hcs://<registry>/<consensus ts>`)
  and `ruleUriHash` (sha256 of that URI), the same two-message pattern the colour sphere uses,
  on the ONE witness topic (§6.5, confirmed 2026-07-25)
