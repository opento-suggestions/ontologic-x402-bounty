# CURRENT_ARCHITECTURE.md — Witness Required, as built

**State of the codebase as of 2026-07-28** (post Phase 2 ceremony, post the rectification pass: challenge-consumption fix, KEY supersession, three-layer refactor). Every significant chunk of code is listed here with what it does and *why it is shaped that way* — each defense traces to the spec (`SPEC.md`, v0.2 as amended: W-invariants, D-decisions, V-verify items; W-11/W-12 in `PHASE_2.md` §2) or to an empirical verdict recorded in `docs/verify-log.md`. Where the build diverges from spec v0.2, the divergence is stated in §9, not papered over. Read `CLAUDE.md` first for the working agreement and hard prohibitions.

---

## 1. System at a glance

```
payer-agent (goose + witness-mcp)                    ORG (operator scripts)
  │ assert claim (W-9 closed space)                    │
  │ GET ontologic.dev/x402/vend  ──► literal HTTP 402  │
  │ pay: exact-scheme TransferTransaction ──────────►  │ redeem.ts: mirror memo-scan
  │        (settled transfer = receipt)                │   └─► vend() on 0.0.9815452
  │ ◄─── genesis + 1 wKEY delivered (one atomic call) ─┘
  │ stamp: TopicMessageSubmit, payer/newborn-signed
  ▼
Lane A 0.0.9645621 (0.01 HBAR fee)   Lane B 0.0.9645622 (1 wKEY fee → contract treasury → burn)
  │                                    │
  └────────── public mirror REST ──────┴──► /wall tiles · /witness verifier · witness_verify
```

**Live testnet entities (all created by this build; the v0.8.3 sphere topics are read-only inputs):**

| Entity | ID | Custody |
|---|---|---|
| Lane A topic `WITNESS_HBAR` | `0.0.9645621` | admin+feeSchedule key = operator; **no submit key** |
| Lane B topic `WITNESS_KEY` | `0.0.9645622` | same; fee = 1 wKEY (current issue), collector = the contract |
| WitnessVendingMachine | `0.0.9815452` | successor issue 2026-07-28; operator holds admin relationship only |
| witness-KEY (wKEY) | `0.0.9815453` | treasury = contract, supply key = contract, **admin key = null**; memo = plain purpose + the terms URI |
| Vending terms topic `WITNESS_TERMS` | `0.0.9815434` | submit = operator, **admin = NONE (immutable at birth)**; message one is the terms the token memo resolves to |
| First issue (superseded) | contract `0.0.9645863` · wKEY `0.0.9645864` | on-chain untouched; decision-log shorthand in its frozen memo — see LIMITATIONS.md |
| ORG operator | `0.0.8641261` | the ONE ORG key (W-2 carve-out) |
| payer-agent (demo) | `0.0.9646033` | the agent's funding account, distinct from operator AND root by boot-check |
| Read-only inputs | RULE_DEFS `0.0.8641938` · RULE_REGISTRY `0.0.8641941` · PROOF `0.0.8641943` | untouched, v0.8.3 sphere |
| ORG root (Phase 2) | `0.0.9794226` | the SECOND ORG key; registry submit key; writes mandates/revocations/witness rules, never verdicts |
| Witness Rule Registry `WITNESS_RULES` | `0.0.9794232` | submit = root, **admin = NONE (immutable at birth, mirror-confirmed)**; witness RuleDefs + mandates + revocations |
| Verdict Topic `WITNESS_VERDICTS` | `0.0.9794234` | submit = operator, **admin = NONE**, no fee; all ORG rejection attestations from the mandate era (first mandate: `1785172221.348657104`) |

**Repo map (three layers):** `packages/core` (the pure seam — zero Hedera SDK, no keys) · `packages/ops` (the keyed engine — persona-typed clients + the recurring lane operations) · thin frontends: `packages/mcp` (the goose plugin — the payer-agent's process; tools are adapters over ops), `scripts/` (CLI entries and guarded ceremony one-shots), `probes/` (re-runnable falsifiability instruments) · `packages/contracts` (KEY custody) · site pages live in the separate `ontologic-dev` repo (`static/witness`, `static/wall`, `netlify/functions/x402.mts`).

---

## 2. Invariant enforcement map

The spec's W-series is enforced by *structure*, not by policy, wherever possible. This table is the audit index; the sections below defend each cell.

| Invariant | Where enforced | Mechanism |
|---|---|---|
| W-1 no payment, no stamp | HIP-991 topics (network) | fee charged in the same consensus event as the message; not our code at all — that is the point |
| W-2 keyless testimony | `mcp/src/env.ts` boot check; keystore; `vend()` shape; `ops/src/contexts.ts` persona types | plugin refuses `PAYER_ID == OPERATOR_ID`; newborn keys never leave the keystore; no contract function touches testimony; customer-path ops signatures accept only payer/newborn contexts (operator identity is a compile error there) |
| W-3 lane equality | `core/verify.ts`, `wall/js/data.js` | one verdict function for both topics; lane is metadata, never a trust input |
| W-4 unit semantics | `scripts/peg.ts` (`laneB.feeKey = 1`), `vend()` mints exactly 1 | the premium exists only in `vending.priceUsd` |
| W-5 open native door | `create-topics.ts` drops `setSubmitKey` | anyone can pay Lane A's published fee and write |
| W-6 deterministic rendering | `wall/js/tiles.js` | every visual parameter indexes into bindingHash bytes; zero `Math.random` (grep-auditable) |
| W-7 published price list | `packages/ops/src/peg.ts` → `npm run peg` | ONE price authority emits both the machine config and the site JSON; the plugin CONSUMES the published challenge instead of re-deriving terms |
| W-8 the affidavit | `LIMITATIONS.md` | every disclosure sourced from the phase that generated it |
| W-9 closed claim space | `core/claims.ts` | claims outside the space throw before any network write is possible |
| W-10 no payload pollination | `core/schema.ts` (rejection carries hash only), `core/reasons.ts` (closed code space), `wall/js/wall.js` (invalid → no DOM node) | structural: the data types cannot carry foreign bytes to a renderer |
| W-11 mandated verdicts | disjoint submit keys (ceremony §3); `schema.buildMandateMorpheme` (self-grant unconstructible); `verify.ts` W-11 chain; `reject-attest.ts` in-window refusal | the operator cannot write a mandate; a verdict resolves grant → window → scope or judges invalid + `mandate.*` |
| W-12 anchor sufficiency | `core/anchors.ts` + `resolve.verifyAnchors` + `timestamps.ts` exact arithmetic | every verdict input is a topic message or immutable topic config; no `/accounts`, no `/transactions`, no floats at boundaries |

---

## 3. `packages/core` — the seam

### 3.1 `src/morpheme.ts` (ported verbatim from ontologic-hello-world)

The hash recipe, and the single most defended decision in the build: **it was ported byte-for-byte, then proven equivalent to the live protocol by test, not assertion.**

- `canonicalizeJSON` (line 19) — RFC 8785 subset: sorted keys, no whitespace, `Number(x).toString()` normalization. This exact function produced every hash on the live PROOF topic; any "improvement" here breaks every existing proof.
- `keccak256Canonical` (43) / `sha256Utf8` (48) — the two primitives. The **SHA-256-vs-keccak split is deliberate protocol history**: `ruleUriHash = sha256(uri string)` because `ReasoningContractV07.computeRuleUriHash` uses Solidity's `sha256()`; everything else is keccak256 over canonical JSON. The split lives in exactly one file so no caller can get it wrong.
- `computeRuleUriHash`/`computeInputsHash`/`computeOutputsHash`/`computeBindingHash` (54–80) — named wrappers are **the only sanctioned way to hash a field**. `computeBindingHash` (73) seals `{ruleUri, inputsHash, outputsHash}` — R and M ride inside the ruleUri, so h(R‖I‖O‖M) is one keccak over three fields.
- Provenance chain (92–130) — `nextRoot = keccak256(prevRoot ‖ entryHash)` hash-chain, carried for compatibility with v0.8.3 token-metadata stamping. `buildProvenanceEntry` takes `timestamp` as a **required input, never generated** — so a keyless verifier can rebuild the identical entry (same reason `claims.buildStampForClaim` takes `createdAt` as a parameter).

**Defense of the port-verbatim decision:** two candidate sources existed (hello-world's `morpheme.ts`, v0.8.3's `canonicalize.js`). Same recipe; the TypeScript one has enforced wrappers and shipping vectors. `test/crosscheck.test.ts` settles the equivalence question empirically: it fetches **every** MorphemeProof from live topic `0.0.8641943` and recomputes every `bindingHash` and `ruleUriHash`. All pass.

### 3.2 `src/config.ts`

- `assertTestnet()` — the mainnet kill-switch, ported from hello-world and **never weakened**: hard-fails on any `mainnet` substring, and *also* hard-fails if it cannot positively confirm `testnet`. Baked non-optionally into every ops context constructor (`packages/ops/src/operator.ts`, `customer.ts`) — no path opens a Hedera client without it — plus the module-top call in `mcp/src/index.ts` before the stdio transport connects.
- `isPlaceholder()` / `required()` — `.env.example`-shaped placeholders (`<...>` stubs, runs of x/X like `0.0.XXXXXXX`) fail at step 0 with a clear message, never deep in the SDK as `failed to parse entity id`. This is also how a customer clone is *detected*: `getOperatorConfig()` throwing on the placeholder is what flips mcp-smoke into customer posture.
- `findEnv()` walks upward from `cwd` (≤5 levels) — one `.env` at repo root is the single source of truth, and scripts run from nested package dirs (hardhat, mcp) without their own env copies drifting.
- `getSphereConfig()` defaults to the live v0.8.3 topic IDs — these are *read-only inputs*; nothing in this codebase writes to them.

### 3.3 `src/mirror.ts`

The canonical read path is public mirror REST (spec §3.3: reads are free; direct rail access is the demonstration). `fetchMessageAtTimestamp` reimplements the v0.8.3 chunked-message strategy (bounded bidirectional search around the timestamp hit, ≤8 queries): a timestamp query may land on any chunk and batch publishing interleaves chunks, so naive sequential reads mis-assemble. Ported from `ontologicv0.5_clean/scripts/v0.7/lib/resolve.js`, where this exact bug was found and fixed against real data.

### 3.4 `src/resolve.ts`

TypeScript port of the v0.8.3 registry algorithms: 11.1 (`resolveRuleDef`: ruleUri → RuleDef with `ruleUriHash` and `contentHash` self-verification — a RuleDef that fails its own hashes throws) and 11.2 (`resolveLatestRule`: registry scan filtered to `schema == ruleRegistryEntry && ruleId match && status == "active"`, preferring `isLatest`). `resolveEvidence` fills entity-bundle evidence (`bindingHash: null` slots) from the **latest** matching proof on the live PROOF topic — the same auto-resolution the v0.8.3 producer used, so our bundles hash identically to what that pipeline would produce.

### 3.5 `src/schema.ts` — the envelopes

- `MorphemeProof` (23) reproduces the v0.8 message schema **unchanged** — a Witness stamp's inner proof is byte-compatible with the live sphere's proofs.
- **statusProfile (42–81), the steward-gated decision:** the Sorensen schema is not finalized (v0.8.3 CLAUDE.md: "ask before implementing" — asked, answered 2026-07-19). Implementation: provisional `{schemaVersion: "0.1-mvp", status: declared|missing|vague|blurred|stale|timed-out|withheld, note?}` carried **beside** the proof in the `WitnessStamp` wrapper and **never sealed into any hash**. The placement is the load-bearing choice: when the real schema lands, it supersedes the envelope without invalidating one stamp or golden vector. `schema.test.ts` proves the property directly (changing the envelope does not move `bindingHash`). `readStatusProfile` (70) defaults absence to `status: "missing"` — verifier-side semantics, so even bare v0.8 proofs get an honest reading.
- `RejectionAttestation` (106) — the bounded fail-write. **W-10 is enforced by the type**: its fields are `subjectTopicId/ConsensusTimestamp/SequenceNumber/subjectMessageHash/reasons` — derivations only. `reasons` is `ReasonCode[]` from the closed reason space (`src/reasons.ts`, Phase 2a): `buildRejectionAttestation` refuses empty `reasons` and anything outside the space — the claims.ts refusal applied to verdicts, so the type-level defense ("no field that could carry the attempt's payload") holds for `reasons` too, not just the subject fields.

### 3.6 `src/claims.ts` — W-9 as code

The closed claim space is a two-entry constant map (`CLAIMS`, light/paint WHITE traces), not a validation layer over an open input: **anything outside the space fails at construction because there is nothing to construct with.** `buildWhiteTraceClaim` (102):
1. resolves the rule from the **live registry** (active + latest — so the claim tracks protocol upgrades, not a frozen copy),
2. cross-checks resolved `domain` against the template (a registry compromise cannot silently redirect a claim),
3. resolves evidence bindingHashes from the live PROOF topic,
4. computes the three hashes through the seam wrappers.
Bundle shapes are copied from `ontologicv0.5_clean/examples/v07/bundle-white-entity.json` / `bundle-white-paint-entity.json` — the v0.8.3 producer's own shapes, hence hash-compatible. Evidence templates are cloned per call (`.map(e => ({...e}))`) so resolution never mutates the space.

`buildStampForClaim` (156) assembles proof + statusProfile; `proofMode: "registry"` because the Witness path is RegistryProof (no contract in the *stamp* path — the vending contract is payment-side only, and HIP-991 needs no contract).

### 3.7 `src/verify.ts` — one verifier, three callers

`judgeMessage` (50) produces the three-way verdict `valid | rejection | invalid` used by the MCP verify tool, the reject-attest script, and (as a JS port) the wall. Check order is deliberate: parse → schema dispatch → structural fields → hash well-formedness → **Peirce** (bindingHash recomputes from parts) → **the split holds** (ruleUriHash = sha256) → **Floridi** (ruleUri dereferences to a self-verifying RuleDef). Failures carry `reasons: ReasonCode[]` from the closed space in `src/reasons.ts` (Phase 2a) — verdicts are explanations, not booleans, because the reject-attest script stamps those reasons on-chain, and codes-not-text is what keeps that stamp free of subject content (W-10; the pre-fix interpolation and its one live attestation are recorded in the verify-log, 2026-07-24). Display text is a renderer-side `reasonText` lookup; the wall's port of that lookup is cross-repo work (PHASE_2 §8). Invalid messages yield only `messageHash` (keccak of the raw bytes) — a derivation the wall can safely mention, never the bytes.

### 3.8 `test/` — the lock, seven layers

1. `canonicalize.test.ts` — **pinned seq-42 vectors** from the live sphere (protocol lock, offline).
2. `crosscheck.test.ts` — every live proof on `0.0.8641943` recomputes (recipe equivalence, network, skips offline).
3. `claims.test.ts` — the closed space refuses outsiders; both WHITE claims build deterministically against the live registry.
4. `golden.test.ts` — this repo's own first Lane A stamp (regression anchor, offline).
5. `reasons.test.ts` — the closed reason space refuses unknown codes; no template carries an interpolation site (offline).
6. `mandate.test.ts` — grant lifecycle: self-grant unconstructible, window boundaries at nanosecond precision, revocation never retroactive, wrong-topic/forged grants judged out (offline).
7. `attestation.test.ts` — the v0.2 attestation is a real morpheme; mandateHash unsealed in M; the live v0.1 attestation stands as history (offline).

Plus, outside core: `packages/mcp/test/payment-terms.test.ts` (the challenge → config → fail resolution order, including the placeholder-`OPERATOR_ID`-never-consulted regression), `packages/mcp/test/keystore.test.ts` (the challenge handoff preserves newborn state), `packages/core/test/config.test.ts` (placeholder shapes fail at step 0). 74 tests; the offline subset alone locks the recipe, so CI without network stays meaningful.

### 3.9 The authority layer in core (Phase 2b, PHASE_2 §4)

- **`src/anchors.ts`** — `TRUST_ANCHORS`: the two authority topic IDs + the first mandate's timestamp, **null until the ceremony pins them**; the verifier's off-chain root of trust (W-12), and deliberately so — changing them is a verifier-release event (disclosed in LIMITATIONS.md).
- **`src/timestamps.ts`** — exact consensus-timestamp comparison (BigInt seconds, nanos padded to nine digits). No floats: two honest readers can never disagree at a window boundary.
- **`src/schema.ts` additions** — `MandateMorpheme` (I = principal/grantee/scope/window/nonce, O = `granted`; **`mandateHash` IS its `bindingHash`** — no new hash primitive, same seam wrappers), `MandateRevocation`, and `RejectionAttestationV2` (a full morpheme: I = subject derivations, O = verdict + `ReasonCode[]`, M carries `mandateHash` + statusProfile **unsealed** — the statusProfile placement pattern, applied to authority; tested: changing `mandateHash` never moves `bindingHash`). Builders refuse self-grants, empty nonces, empty windows, out-of-space scopes/reasons — the claims.ts refusal, everywhere.
- **`src/resolve.ts` additions** — `resolveMandate` (registry scan; a claimed `mandateHash` is **never believed** — the grant's hashes recompute or it does not exist) and `verifyAnchors` (W-12(b) executable: `admin_key: null` + expected submit key, throws on violation).
- **`src/verify.ts`** — `judgeMessage` gains `mandate`/`revocation` kinds and the W-11 chain on v0.2 attestations in spec order (wrong-topic → resolves → in-window → in-scope), each failure `invalid` + the specific `mandate.*` code behind the single `outOfMandateKind()` predicate (§6.2). Cross-registry impersonation defense on both R lookups (witness rules must live on the witness registry AND declare `witness.*` domains). The pre-mandate v0.1 attestation stands as history (§4.4 temporal clause). **Signature unchanged** — see §9.8.

---

## 4. `packages/contracts` — `WitnessVendingMachine.sol`

**Scope defense first:** per verify-log **V-1b (CLOSED: NO)** — the Hedera x402 exact scheme settles as a *plain native TransferTransaction*; the scheme spec explicitly forbids wrapping it in any other transaction type. Therefore this contract is **not** a payment endpoint. It is the custody answer to exactly one question: *who holds the KEY supply key so that mint-on-vend and burn-on-stamp live in the same neutral place?* (spec D-3). Answer: code.

- `constructor` (112): `operator = msg.sender`, immutable. The operator's blast radius is the admin *relationship* (calling vend/burn/create), never testimony — matching the LIMITATIONS.md disclosure (slander-not-forge).
- `createKeyToken` (122): the contract creates wKEY **itself** through the HTS system contract (`0x167`), because a token whose treasury is a contract must be created by that contract (treasury must sign; contracts sign by executing). Configuration defended field-by-field: `treasury = address(this)` (fees collect into code); supply key = `contractId: address(this)` (only vend/burn move supply); **no admin key** → the token is born immutable — nobody, ORG included, can ever re-key it (`AlreadyCreated` guard makes creation single-shot); `tokenSupplyType: false` (infinite — supply discipline comes from the burn loop, not a cap); decimals 0 (W-4: 1 KEY = 1 stamp; fractional KEY is meaningless). The frozen memo (98 bytes) states the machine's purpose in plain language and resolves to the published terms — `hcs://0.0.9815434/1785270170.307828104`, message one on the immutable WITNESS_TERMS topic. That memo is WHY the current contract/token are a successor issue: the first issue's memo carried internal decision-log shorthand, memos are immutable, and `AlreadyCreated` makes the token one-shot per contract — so the correction was a new deploy, disclosed in LIMITATIONS.md, with the first issue left untouched on-chain.
- `vend(address payable to)` (166): **the delivery leg, one atomic call** — (1) forward `msg.value` to the alias, which **lazy-creates the newborn account** (HIP-583; empirically verified — V-3/V-5); (2) mint exactly 1 wKEY to treasury; (3) `transferToken` to the newborn (received via auto-association, no association tx — verified). Any leg fails → whole call reverts → no partial state (observed in the wild: the out-of-gas attempt left no account, no mint). `onlyOperator` because *the payment settled elsewhere* (V-1b): delivery is ORG honoring a receipt, and the receipt+redeemable-right model (LIMITATIONS.md, W-1 Lane B wording) is exactly what makes an operator-triggered delivery safe — failure is re-executable, no funds strand. Empirical gas note: lazy creation is expensive; 1.2M gas OOG'd, callers use 3M.
- `burnCollected(int64)` (190): D-3's sink. The Lane B topic's fee collector **is this contract** (set via `repeg-lane-b.ts`; the network accepted a contract collector without a collector signature on the topic update — empirically verified), so stamp fees flow to the treasury-in-code and `burnToken` burns from treasury by definition. Live demonstration: wKEY `total_supply` returned to 0 after the first full loop. Self-executing neutrality is *structural*: there is no code path by which collected KEY exits except burning.
- Deliberately absent: pause, drain, upgrade hooks — spec §5 "testnet-MVP-light, noted for the mainnet story", noted in LIMITATIONS.md.

Deploy path (`scripts/deploy.ts`) uses the **native SDK** (`ContractCreateFlow`), not JSON-RPC — the ORG operator key is ED25519, which has no usable EVM alias, so hashio-style deployment is impossible with this key. Discovered empirically ("Sender account not found"), recorded in verify-log.

---

## 5. `packages/mcp` — witness-mcp, the payer-agent's process

Structural successor to hologlass-mcp v0.3.2 (same skeleton: `McpServer` + stdio + three-channel returns + Windows orphan watchdog for the Node #25131 stdin-event gap).

### 5.1 `src/env.ts` — the credential model (W-2's sharpest edge)

The plugin holds the **agent's** identity and nothing of ORG's. `getPayerConfig` refuses to run when `PAYER_ID == OPERATOR_ID`, for two independent reasons: (a) W-2 — no ORG key may enter the agent's process; (b) demo integrity — the fee collector is exempt from its own HIP-991 fees (empirically confirmed: collector-paid stamps show `assessed_custom_fees: []`), so an operator-as-payer demo would *silently fake* the paid flow. The boot check makes the honest configuration the only configuration.

### 5.2 `src/channels.ts` + `src/state/keystore.ts` + `src/payment-terms.ts`

Three-channel separation (hologlass anatomy): `content` = agent-visible verdicts and next-steps; `structuredContent` = full record for a viewer; `_meta` = timestamps, never hash-input. **Private keys are banned from all three** — the keystore (flat JSON in the agent's state dir) is the only place a testimony key exists; `newbornKey()` is consumed solely by the stamp tool's signer.

**`payment-terms.ts` — the challenge-consumption seam (added 2026-07-28 after a customer-posture failure).** The original tools resolved the payment destination from `OPERATOR_ID` — the deployer's identity answering a payer-path question, which broke every customer clone (placeholder env → `failed to parse entity id`). Now the terms (payTo/amount/asset) resolve in a declared order: **(a)** the last 402 challenge `witness_requirements` fetched, persisted in the keystore exactly as genesis state is (`recordChallenge`/`latestChallenge`), refetched past the challenge's own `maxTimeoutSeconds`; **(b)** `config.witness.json`, the deploy-time artifact the peg CLI writes, for offline operation; **(c)** one instructive error naming both paths. Every input is injectable, so the whole order is pinned by offline tests (`test/payment-terms.test.ts`), including the placeholder-never-consulted regression.

### 5.3 The seven tools (registered `index.ts:50–116`, each `witness_*` with zod schemas)

| Tool | Defense |
|---|---|
| `requirements` | Demo beat 2, W-7. Prefers `WITNESS_REQUIREMENTS_URL` — the **live production gateway** `ontologic.dev/x402/vend`, treating an HTTP **402** response as the success case (that status *is* the conformance surface) — and **persists the fetched challenge to the keystore** so `pay` consumes THESE terms. Local fallback serves `config.witness.json` (the deploy-time artifact); the operator's env is never consulted at runtime. |
| `assert_claim` | Thin wrapper over `core/claims` — W-9 lives in core, not the tool, so no alternative caller can bypass it. Failure responses include `allowedClaims()` so the agent learns the space instead of flailing. |
| `genesis` | Generates in-process, stores in keystore, returns **only the alias**. "Theirs, never ours" as code. |
| `pay` | The x402 leg per the real scheme (V-1), as an adapter: terms from `resolvePaymentTerms` (challenge → config → fail; source disclosed as `paymentTermsSource` in every response), settlement via ops `settleVendPayment`, whose signature accepts **only a `PayerContext`**. Facilitator mode: partial signature (fee payer open), base64, POST `/settle` — the official template's wire flow. Direct mode: the payer self-sponsors the *same conformant transfer*. Both return the **settled transfer as the receipt**; the memo `x402:witness-required:vend:<alias>` is the machine-readable redemption claim. The tool cannot deliver — delivery is ORG's, by design (V-1b branch). |
| `redeem_status` | Pure keyless mirror read: alias → account? funded? holds 1 wKEY? Also records the newborn's real account ID into the keystore for the stamp tool. Polling the *public record* for delivery is the redeemable-right model made tangible. |
| `stamp` | The witness itself, adapting ops `stampLane` — the same engine the smokes and the fresh-clone path drive. Lane A signer = payer (`openPayerContext`); Lane B signer = **the newborn** (`openNewbornContext` from the keystore; W-2: the testifier signs, always). Max-custom-fee protection from the published peg — a re-peg cannot ambush anyone. Claim is rebuilt fresh from the live taxonomy at stamp time (no stale-claim replay from tool state). |
| `verify` | ops `verifyStampOnMirror` over both lane topics — `core.judgeMessage` with mirror-lag patience (10 × 2s — V-7 measured 3–7s) and exact-timestamp match only (mirror's `timestamp=` filter is `>=`; without the equality check a query could verify the *next* message). |

---

## 6. `packages/ops` + `scripts/` + `probes/` — the keyed engine and its thin frontends

**`packages/ops` is where keys live** (core stays pure; frontends stay thin). Its pieces:

- **Persona contexts (`contexts.ts` / `operator.ts` / `customer.ts`)** — `OperatorContext` / `RootContext` / `PayerContext` / `NewbornContext` as disjoint types (distinct persona literals and field names), constructors split by side of the counter: ORG CLIs import `operator.ts`; customer tools import `customer.ts` and supply their own creds. `assertTestnet()` is baked into every open, with the **50 HBAR default max fee** (testnet's ~6.6¢/HBAR exchange rate makes USD-priced network fees ~10× larger in HBAR than SDK defaults expect — discovered via `INSUFFICIENT_TX_FEE`). `openRootContext` asserts ROOT≠OPERATOR on every open (W-11). The payoff: `settleVendPayment(ctx: PayerContext, …)` makes the deployer-identity-as-payTo bug a **compile error**, not a runtime discovery.
- **Plumbing (`plumbing.ts`)** — ONE `waitForMirror` (exact-timestamp equality; replaced nine hand-rolled poll loops), one `hashscanTx` (replaced three copies), `appendEvidence` (every on-chain action appends to `docs/evidence.md` — the bounty's link collection is a **side effect of running**, not a chore), `updateEnv` (entity IDs persist to `.env` so later operations compose).
- **`peg.ts` — the single price authority** (W-7). Constants: Lane A fee = 0.01 HBAR = exactly the D-1 margin (at-cost is the network fee the payer already pays); Lane B fee = **1 KEY** (W-4 — the premium lives *only* in `vending.priceUsd` = $0.50, D-2 as amended 2026-07-27: itemized as funding $0.30 + delivery network allowance $0.15 + visible margin $0.05); testnet HBAR notionally $0.10 (demo semantics, W-8). `priceEras` records the reprice boundary so receipts are always judged at their own era's price. `buildPaymentRequirements` emits Hedera exact-scheme objects: CAIP-2 `hedera:testnet`, `asset: "0.0.0"` for HBAR, Circle testnet USDC `0.0.429274` (mirror-confirmed live).
- **Lane operations** — `stampLane` (one engine for both lanes and every frontend: claim built fresh through core, peg-derived fee-limit protection, signer = the context), `verifyStampOnMirror`, `settleVendPayment`, `redeemPass`, `repegLaneB`.

**`scripts/` are CLI entries** (parse → open context → call ops → print) **plus the guarded ceremony one-shots**, which remain visible as liturgy — they use ops plumbing without dissolving into it:

- `peg.ts` — the price authority's CLI: prints prices and emits `config.witness.json` AND the site's `payment-requirements.json` (`npm run peg`). One source, two artifacts; the published list *cannot* drift from the charged fees.
- `create-topics.ts` — descendant of v0.8.3 `create_sphere.js` with three deliberate divergences: `setCustomFees` + `setFeeScheduleKey` (HIP-991 must be set at creation — why these are new sibling topics, not modifications of `0.0.8641943`); **no `setSubmitKey`** (the open door *is* W-5's cheap public door); Lane B created with a provisional HBAR fee because wKEY did not exist yet (see §9.3).
- `repeg-lane-b.ts` — the retained fee schedule key exercised (twice now: the original HBAR→wKEY flip, and the 2026-07-28 flip to the successor wKEY). **Collector = the contract**; fallback-to-operator branch exists but was never needed.
- `stamp-lane-a.ts` — the fresh-clone stranger path (W-5), kept as its own thin entry: friendly placeholder errors, ORG-identity refusals, then the same `stampLane` + `verifyStampOnMirror` everything else drives.
- `lane-a-smoke.ts` — ORG's floor test on the same engine, plus V-7 latency measurement and the golden-vector block print. `lane-b-smoke.ts` — the single-process full-chain Lane B E2E (vend → newborn self-stamp → burn), kept until an equivalent exists post-refactor.
- `redeem.ts` — CLI over ops `redeemPass`: flags, the 5s watch loop with graceful stop. The pass itself: mirror memo-scan at each receipt's own era price, count-based netting (receipts-ever vs deliveries-ever — the balance-based version double-delivered once a customer spent their wKEY, 2026-07-27, disclosed), vend what is owed, burn what the fees collected (D-3's sink — the watcher is the burn cadence). One operational rule from the 2026-07-28 supersession: deliveries count against the CURRENT contract, so **retire all watchers before rolling `VENDING_CONTRACT_ID`** (verify-log).
- `reject-attest.ts` — lazy attestation for the mandate era: refuses to run unless its own mandate currently resolves in-window; builds the v0.2 full-morpheme attestation; writes to the **Verdict Topic**, not the subject's lane; read-back runs the full W-11 chain on its own verdict. Still lazy, still manual, still refuses foreign topics.
- **Ceremony one-shots (executed 2026-07-27, steward-confirmed in-turn; single-shot guards now refuse re-runs):** `create-root.ts` · `create-authority-topics.ts` (all five §3.4 guards, no-admin-key asserted in the built transaction, `verifyAnchors` read-back) · `publish-witness-rules.ts` (publishes `rules/` — now the published source-of-record — with self-hashing `contentHash`, two-message pattern, keyless round-trip before success; idempotent by public state) · `grant-mandate.ts` · `revoke-mandate.ts`.
- **Terms one-shots (executed 2026-07-28):** `create-terms-topic.ts` (WITNESS_TERMS `0.0.9815434`, admin-null at birth, submit = operator, mirror read-back) · `publish-terms.ts` (message one = the steward-ratified `docs/vending-terms.json`; prints the token-memo candidate with a 100-byte assertion — the successor wKEY's frozen memo resolves to this message).
- `create-payer.ts` / `mcp-smoke.ts` — demo provisioning and the full storyline through the plugin's own handlers. mcp-smoke **auto-detects posture**: real operator env → single-process (in-process redeem pass); placeholder operator env (a customer clone) → waits on the operator's external `redeem:watch`, polling `witness_redeem_status`. The customer posture is the fix's verification standard — it is the exact posture that exposed the payTo bug.

**`probes/`** — `probe-batch.ts`, the re-runnable falsifiability instrument for V-9 (an empirical network answer HIP-551 evolution could change), relocated out of the operational scripts.

---

## 7. Site (in `ontologic-dev` repo) — `/witness`, `/wall`, the gateway

### 7.1 `static/witness/` — the orchestrator

Zero keys on the page (W-2). `js/witness.js` renders the price list **from the deployed `payment-requirements.json`** (the peg's artifact — the page displays what the topics charge because both come from one source) and offers verify-by-timestamp backed by the same browser verifier the wall uses. Exact-timestamp equality check, both lanes searched, results link to HashScan (raw bytes live under HashScan's brand, per W-10) and to the wall.

### 7.2 `static/wall/` — the Proof Wall

- `js/canonicalize.js` — hand port of the seam (keccak via vendored js-sha3 UMD → `window.keccak_256`; SHA-256 via WebCrypto). **Vendored, not CDN** — deterministic deploys, no runtime supply chain.
- `js/verify.js` — the JS `judgeMessage` + **in-page self-test**: `runSelfTest()` asserts the shared vectors (pinned seq-42 + this repo's golden Lane A stamp) **before any tile renders**. The two ports (TS seam, JS port) cannot silently drift — drift turns the wall off loudly. Also validated headlessly under Node against the live topics.
- `js/data.js` — fetch both lanes, merge by consensus timestamp (**lane-agnostic**, spec §3.3: the topic a stamp landed on is free payment-provenance; renderer and verifier take no trust input from lane). Valid stamps group by `bindingHash` → duplicates collapse to one tile with a count (D-8: multiplicity badge, the spec's own predicted resolution — W-6 *guarantees* duplicates render identically, so showing two would read as a bug).
- `js/tiles.js` — **W-6 as arithmetic.** `tileParams` maps the 32 bindingHash bytes to every visual decision: byte 0 → hue, 1 → complement hue (drifted by the golden angle), 2–3 → chroma/lightness, 4 → petal count, 5 → ring count, 6 → rotation, 7 → core radius, 8–23 → sixteen radial perturbations. The renderer contains **zero `Math.random`** — the file says so and `grep` confirms it; any observer reproduces the wall from the topics alone. Lane appears only as a small arc keyed to fee denomination (provenance display, not trust). `renderVerdictTile` draws rejections as a seal (flat ring + bar) — visually a *judgment*, deterministic from the subject's message hash.
- `js/wall.js` — **W-10 structural**: only verdict objects reach the DOM. `invalid` verdicts produce *no node* — not hidden, absent — and surface solely as a count in the ledger line ("N nonconforming — bytes visible only on HashScan"). Rejection attestations render as verdict-tiles; the attempts they judge still get nothing.

### 7.3 `netlify/functions/x402.mts` — the literal-402 gateway

V-1a (CLOSED: YES — literal HTTP 402 is the conformance surface) made this required; V-1's other finding (the resource side can be keyless) made it safe. The function holds **zero secrets**, settles **nothing**: it re-serves the static price list with status 402, both as JSON body and as the base64 `PAYMENT-REQUIRED` header, CORS-open. Live in production: `GET ontologic.dev/x402/vend` → 402. The plugin's `requirements` tool consumes it directly — the demo's *Payment Required* moment is a real HTTP 402 from the real domain.

---

## 8. The x402 conformance story, as built

1. **Literal 402**: production gateway (above).
2. **Exact scheme shapes**: PaymentRequirements per the official `scheme_exact_hedera.md` — CAIP-2 `hedera:testnet`, entity-ID assets (`0.0.0` HBAR / HTS token IDs), tinybar amounts, `payTo` account, `maxTimeoutSeconds`.
3. **Settlement**: a plain native `TransferTransaction` — never a contract call (the scheme forbids wrapping). Facilitator mode implements the partial-signature wire flow; direct mode self-sponsors the same transfer. Mode is disclosed in every `pay` response.
4. **HIP-991 leg**: on Lane A the x402 *story* is strongest — payment and testimony are literally the same transaction, fee assessed in the same consensus event (mirror-verifiable `assessed_custom_fees`).
5. **Receipt model**: settled transfer = receipt; delivery + stamp = redeemable rights (W-1 Lane B final wording, per V-1b + V-9).

---

## 9. Divergences from spec v0.2 (stated, not papered over)

1. **The vending machine is not the payment endpoint** (spec §2 imagined settle+mint one atomic boundary). Falsified by V-1b: the exact scheme forbids contract-call settlement. The spec pre-authorized this branch ("the one place genuine design work may still hide"); the receipt/redeemable-right model is the answer, and `vend()` keeps the *delivery* leg atomic.
2. **V-9 = NO (practical)**: the alias-payer inner batch transaction stalls at the SDK layer; Lane B is two-step (auto-create, then newborn self-stamps). Cost: nothing extra — V-1b had already forced the payment out of any batch. The two-step is proven live.
3. **Lane B fee was provisionally HBAR for a window** (creation-time HIP-991 requirement vs. contract-created token ordering). Re-pegged to 1 wKEY via the retained fee schedule key ~90 minutes later; no third-party stamps occurred in the window (topic history shows only ORG's own).
4. **The x402 payer needs a funded account** — a truly account-less agent cannot sign a debit. Lane B's product is re-stated precisely: the vend delivers the genesis of the *testimony* account. Disclosed in LIMITATIONS.md; "this agent did not exist on Hedera ninety seconds ago" remains true of the account that signs the stamp.
5. **statusProfile** is the provisional 0.1-mvp envelope (steward-approved), unsealed by construction (§3.5).
6. **D-5 resolved off-menu**: repo is `opento-suggestions/ontologic-x402-bounty` (user-created), Apache-2.0. D-8 resolved: multiplicity badge.
7. **Not built (cut-safe, spec-sanctioned)**: self-hosted facilitator deployment (pay tool supports it; direct mode is the demo default), HashPack human lane (secondary, "non-blocking for the agent demo"), read-side convenience metering (explicitly out of scope §7).
8. **`judgeMessage`'s signature did not change** — PHASE_2 §4.4 predicted a three-caller break, but the judge already carried `topicId` (its §9 coverage note suspected exactly this). Authority context arrived as optional fields defaulting from `TRUST_ANCHORS`; all callers compile unchanged and the wall pass was additive.
9. **The single witness registry retains the two-message pattern** (`ruleDef` + `ruleRegistryEntry`) — PHASE_2 §3.2 listed three schema-discriminated classes, but registry entries are a necessary fourth: they carry `ruleUri`/`ruleUriHash` (unknowable before the ruleDef's own consensus timestamp) and let `resolveLatestRule` work unchanged against the witness topic.
10. **The wall reads FOUR topics post-ceremony, not three** (PHASE_2 §8's count): two lanes + the Verdict Topic + the registry, because the registry is both a rendering source (lineage roots) and the mandate-resolution context.

---

## 10. Verification state

- 74/74 vitest (pinned + golden + crosscheck + claims + schema + reasons + mandate + attestation + payment-terms + keystore + config); `canonicalize.test.ts` and `golden.test.ts` byte-unmodified through every change since the first stamp — the additivity proof.
- Both lanes end-to-end through the MCP tool handlers in **three postures** (2026-07-28): operator (single-process regression), **customer** (fresh env, `OPERATOR_ID` left as the placeholder, live gateway, ORG's redeem watcher running separately — the posture that exposed the payTo bug, now the fix's standard), and offline fallback (no gateway URL → `config.witness.json` serves both tools).
- The successor chain verified live the same day: terms message keyless-resolvable, token memo mirror-confirmed at 98 bytes, Lane B re-pegged and a full vend → newborn-stamp → keyless-verify chain green on the new KEY (newborn `0.0.9815538`).
- Full burn loop observed on-chain (first issue): mint-on-vend → fee-to-treasury → `total_supply: 0`.
- ~40 HashScan links in `docs/evidence.md`, appended by the operations that created them.
- Invariant audit: `grep -r "Math.random" static/wall/js/` → only the comment asserting its absence; no payload-rendering path exists in wall code; live v0.8.3 topics and KEY `0.0.8644153` untouched (read-only fetches throughout).
