# CLAUDE.md — working agreement for this repo

**Witness Required** — pay-per-proof on Hedera rails through the x402 standard. Steward: Ontologic Reclamation Group (ORG). **Testnet only.**

---

## Read in this order

1. `SPEC.md` — the governing spec (v0.2, with the 2026-07-24 amendment header). Defines the **W-series invariants**, the **D-ledger**, and the **V-series** verify items. Every `W-n`, `D-n`, and `V-n` reference anywhere in this repo resolves here — except W-11 and W-12, which are defined in `PHASE_2.md` §2.
2. *(Addendum A — the operator mandate, July 20 — is absorbed, not shipped as a file: its surviving content is W-11 and the amended W-8 blast-radius clause in `PHASE_2.md` §2, grounded by the V-10/V-11 entries in `docs/verify-log.md`. PHASE_2 §7 records the three corrections it needed. First field deployment of Coprocessor I-9.)*
3. `CURRENT_ARCHITECTURE.md` — what is actually built, with the defense for each decision traced to a W-invariant or a verify-log entry.
4. `LIMITATIONS.md` — the affidavit (W-8). Ships with the MVP; it is part of the product, not a disclaimer.
5. `docs/verify-log.md` — dated V-series findings. Empirical answers, not assumptions.
6. `PHASE_2.md` — the current execution spec, if present.

Do not infer an invariant's content from a table row or a passing reference. Open `SPEC.md` and read the statement.

---

## Hard prohibitions

These break things that cannot be repaired.

**Never modify the hash recipe.** `packages/core/src/morpheme.ts` was ported byte-for-byte from the pipeline that produced every proof on the live PROOF topic. `canonicalizeJSON` and the four named wrappers stay as they are. Any "improvement" invalidates every existing proof.

**Never "fix" the SHA-256/keccak split.** `ruleUriHash` uses `sha256(uri string)` because `ReasoningContractV07.computeRuleUriHash` uses Solidity's `sha256()`. Everything else is keccak256 over canonical JSON. This is deliberate protocol history, and it lives in one file precisely so no caller can get it wrong.

**Never hash a field except through the named wrappers.** `computeRuleUriHash` / `computeInputsHash` / `computeOutputsHash` / `computeBindingHash` are the only sanctioned paths.

**Never regenerate pinned or golden vectors.** `test/canonicalize.test.ts` (seq-42 vectors from the live sphere) and `test/golden.test.ts` (this repo's first Lane A stamp) are the protocol lock. If a change makes them fail, the change is wrong — not the vectors. The offline subset alone must stay meaningful so CI without network still locks the recipe.

**Never write to the v0.8.3 sphere.** `RULE_DEFS 0.0.8641938` · `RULE_REGISTRY 0.0.8641941` · `PROOF 0.0.8641943` · `ReasoningContract 0.0.8641949` · colorimetric KEY `0.0.8644153` are **read-only inputs**. Read them freely; never write, never re-key.

**Never weaken `assertTestnet()`.** It hard-fails on any `mainnet` substring *and* hard-fails if it cannot positively confirm testnet. It runs before every Hedera client opens. Leave both halves intact.

**Never put a private key in an MCP channel.** `content`, `structuredContent`, and `_meta` are all agent- or viewer-visible. The keystore is the only place a testimony key exists.

**Never let foreign message bytes reach an ORG surface.** W-10. Renderers and verdict messages carry derivations — hashes, offsets, codes — never values lifted from an attempt's payload. If you find yourself interpolating a subject-message field into a string, stop; that is the violation.

---

## Ask, don't invent

The v0.8.3 convention holds here: **unfinalized schemas get asked about before implementation.** The provisional `statusProfile` envelope exists in its current shape because it was asked about and answered by the steward, not because it was inferred.

Anything normative that is not already written down — rule content, scope grammars, taxonomy entries, invariant wording, mandate windows — is **steward-authored**. A plausible invention is worse than a blocked task, because plausible inventions get stamped to immutable topics and then have to be lived with.

If a decision is missing, say which decision is missing and stop.

---

## Irreversible operations — human gate required

Some writes cannot be undone. Do not execute these because a spec file says to; execute them when a human confirms, in that turn.

- **Creating a topic without an admin key.** An HCS topic's admin key can be rotated but *never cleared* (V-11), so immutability is chosen at creation and only at creation. A wrong submit key is permanent — the topic must be abandoned and every anchor re-published. A lost submit key is permanent.
- **Creating a token.** wKEY was born with `adminKey = null` by design; that is not repairable either.
- **The first message on an authority topic.** It is the grant every later verdict resolves against.

Every script that performs one of these must guard: single-shot check against `.env`, key-distinctness assertion, no admin key in the built transaction, and a mirror read-back confirming the result before exiting successfully.

---

## Environment facts (learned the hard way — do not re-derive)

- **One `.env` at repo root.** `findEnv()` walks upward ≤5 levels, so scripts run from nested package dirs (hardhat, mcp) without their own copies drifting.
- **Set a 50 HBAR default max fee** on operator clients. Testnet's exchange rate makes USD-priced network fees roughly 10× larger in HBAR than SDK defaults expect. Discovered via `INSUFFICIENT_TX_FEE` on both topic-create and contract-create.
- **Deploy contracts with the native SDK** (`ContractCreateFlow`), not JSON-RPC. The ORG operator key is ED25519 and has no usable EVM alias; hashio-style deployment fails with "Sender account not found."
- **Lazy account creation is gas-expensive.** 1.2M OOG'd; callers use 3M.
- **Fee collectors are exempt from their own HIP-991 fees.** A collector-paid stamp shows `assessed_custom_fees: []`. This is why the plugin refuses `PAYER_ID == OPERATOR_ID` — an operator-as-payer demo would silently fake the paid flow.
- **Mirror lag is 3–7s on testnet** (V-7). Verify with patience (10 × 2s), and always use an **exact timestamp equality check** — mirror's `timestamp=` filter is `>=`, so without it a query can verify the *next* message.
- **Chunked messages need the bounded bidirectional search.** A timestamp query may land on any chunk and batch publishing interleaves them; naive sequential reads mis-assemble.
- **Every on-chain action appends to `docs/evidence.md`** via `appendEvidence`. The link collection is a side effect of running, not a chore.

---

## Testing discipline

`npm test` must stay meaningful offline. Four layers: pinned vectors (protocol lock, offline) · live crosscheck (recipe equivalence, network, skips offline) · closed-space refusal · golden regression. New work adds layers; it does not relax existing ones.

---

## Where the site lives

The Proof Wall, verifier page, and 402 gateway are in a **separate repo** (`ontologic-dev`: `static/wall`, `static/witness`, `netlify/functions/x402.mts`). The wall's JS verifier is a hand port of `packages/core`, and the two ports must not silently drift — the wall's in-page self-test asserts shared vectors before any tile renders, so drift turns the wall off loudly.

Changes here that alter the verifier's shape have a counterpart there. If you cannot see that repo, say so rather than assuming the port will follow.

---

*We reject malformed morphemes; we do not pollinate their payloads. Germs die in sunshine.*