# CURRENT_ARCHITECTURE.md — Witness Required, as built

**State of the codebase as of 2026-07-24.** Every significant chunk of code is listed here with what it does and *why it is shaped that way* — each defense traces to the spec (`bounty-build-info.md` v0.2: W-invariants, D-decisions, V-verify items) or to an empirical verdict recorded in `docs/verify-log.md`. Where the build diverges from spec v0.2, the divergence is stated in §9, not papered over.

---

## 1. System at a glance

```
payer-agent (goose + witness-mcp)                    ORG (operator scripts)
  │ assert claim (W-9 closed space)                    │
  │ GET ontologic.dev/x402/vend  ──► literal HTTP 402  │
  │ pay: exact-scheme TransferTransaction ──────────►  │ redeem.ts: mirror memo-scan
  │        (settled transfer = receipt)                │   └─► vend() on 0.0.9645863
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
| Lane B topic `WITNESS_KEY` | `0.0.9645622` | same; fee = 1 wKEY, collector = the contract |
| WitnessVendingMachine | `0.0.9645863` | operator holds admin relationship only |
| witness-KEY (wKEY) | `0.0.9645864` | treasury = contract, supply key = contract, **admin key = null** |
| ORG operator | `0.0.8641261` | the ONE ORG key (W-2 carve-out) |
| payer-agent (demo) | `0.0.9646033` | the agent's funding account, distinct from operator by boot-check |
| Read-only inputs | RULE_DEFS `0.0.8641938` · RULE_REGISTRY `0.0.8641941` · PROOF `0.0.8641943` | untouched, v0.8.3 sphere |

**Repo map:** `packages/core` (the seam — zero Hedera SDK) · `packages/mcp` (the goose plugin — the payer-agent's process) · `packages/contracts` (KEY custody) · `scripts/` (ORG-side testnet operations) · site pages live in the separate `ontologic-dev` repo (`static/witness`, `static/wall`, `netlify/functions/x402.mts`).

---

## 2. Invariant enforcement map

The spec's W-series is enforced by *structure*, not by policy, wherever possible. This table is the audit index; the sections below defend each cell.

| Invariant | Where enforced | Mechanism |
|---|---|---|
| W-1 no payment, no stamp | HIP-991 topics (network) | fee charged in the same consensus event as the message; not our code at all — that is the point |
| W-2 keyless testimony | `mcp/src/env.ts` boot check; keystore; `vend()` shape | plugin refuses `PAYER_ID == OPERATOR_ID`; newborn keys never leave the keystore; no contract function touches testimony |
| W-3 lane equality | `core/verify.ts`, `wall/js/data.js` | one verdict function for both topics; lane is metadata, never a trust input |
| W-4 unit semantics | `scripts/peg.ts` (`laneB.feeKey = 1`), `vend()` mints exactly 1 | the premium exists only in `vending.priceUsd` |
| W-5 open native door | `create-topics.ts` drops `setSubmitKey` | anyone can pay Lane A's published fee and write |
| W-6 deterministic rendering | `wall/js/tiles.js` | every visual parameter indexes into bindingHash bytes; zero `Math.random` (grep-auditable) |
| W-7 published price list | `scripts/peg.ts` → `emit-requirements.ts` | ONE price authority emits both the machine config and the site JSON |
| W-8 the affidavit | `LIMITATIONS.md` | every disclosure sourced from the phase that generated it |
| W-9 closed claim space | `core/claims.ts` | claims outside the space throw before any network write is possible |
| W-10 no payload pollination | `core/schema.ts` (rejection carries hash only), `wall/js/wall.js` (invalid → no DOM node) | structural: the data types cannot carry foreign bytes to a renderer |

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

- `assertTestnet()` — the mainnet kill-switch, ported from hello-world and **never weakened**: hard-fails on any `mainnet` substring, and *also* hard-fails if it cannot positively confirm `testnet`. Called before every Hedera client opens (scripts via `ops.openOperatorClient`, plugin at module top of `mcp/src/index.ts:35` — before the stdio transport connects).
- `findEnv()` walks upward from `cwd` (≤5 levels) — one `.env` at repo root is the single source of truth, and scripts run from nested package dirs (hardhat, mcp) without their own env copies drifting.
- `getSphereConfig()` defaults to the live v0.8.3 topic IDs — these are *read-only inputs*; nothing in this codebase writes to them.

### 3.3 `src/mirror.ts`

The canonical read path is public mirror REST (spec §3.3: reads are free; direct rail access is the demonstration). `fetchMessageAtTimestamp` reimplements the v0.8.3 chunked-message strategy (bounded bidirectional search around the timestamp hit, ≤8 queries): a timestamp query may land on any chunk and batch publishing interleaves chunks, so naive sequential reads mis-assemble. Ported from `ontologicv0.5_clean/scripts/v0.7/lib/resolve.js`, where this exact bug was found and fixed against real data.

### 3.4 `src/resolve.ts`

TypeScript port of the v0.8.3 registry algorithms: 11.1 (`resolveRuleDef`: ruleUri → RuleDef with `ruleUriHash` and `contentHash` self-verification — a RuleDef that fails its own hashes throws) and 11.2 (`resolveLatestRule`: registry scan filtered to `schema == ruleRegistryEntry && ruleId match && status == "active"`, preferring `isLatest`). `resolveEvidence` fills entity-bundle evidence (`bindingHash: null` slots) from the **latest** matching proof on the live PROOF topic — the same auto-resolution the v0.8.3 producer used, so our bundles hash identically to what that pipeline would produce.

### 3.5 `src/schema.ts` — the envelopes

- `MorphemeProof` (23) reproduces the v0.8 message schema **unchanged** — a Witness stamp's inner proof is byte-compatible with the live sphere's proofs.
- **statusProfile (42–81), the steward-gated decision:** the Sorensen schema is not finalized (v0.8.3 CLAUDE.md: "ask before implementing" — asked, answered 2026-07-19). Implementation: provisional `{schemaVersion: "0.1-mvp", status: declared|missing|vague|blurred|stale|timed-out|withheld, note?}` carried **beside** the proof in the `WitnessStamp` wrapper and **never sealed into any hash**. The placement is the load-bearing choice: when the real schema lands, it supersedes the envelope without invalidating one stamp or golden vector. `schema.test.ts` proves the property directly (changing the envelope does not move `bindingHash`). `readStatusProfile` (70) defaults absence to `status: "missing"` — verifier-side semantics, so even bare v0.8 proofs get an honest reading.
- `RejectionAttestation` (106) — the bounded fail-write. **W-10 is enforced by the type**: its fields are `subjectTopicId/ConsensusTimestamp/SequenceNumber/subjectMessageHash/reasons` — derivations only. There is no field that *could* carry the attempt's payload; `buildRejectionAttestation` (120) additionally refuses empty `reasons`.

### 3.6 `src/claims.ts` — W-9 as code

The closed claim space is a two-entry constant map (`CLAIMS`, light/paint WHITE traces), not a validation layer over an open input: **anything outside the space fails at construction because there is nothing to construct with.** `buildWhiteTraceClaim` (102):
1. resolves the rule from the **live registry** (active + latest — so the claim tracks protocol upgrades, not a frozen copy),
2. cross-checks resolved `domain` against the template (a registry compromise cannot silently redirect a claim),
3. resolves evidence bindingHashes from the live PROOF topic,
4. computes the three hashes through the seam wrappers.
Bundle shapes are copied from `ontologicv0.5_clean/examples/v07/bundle-white-entity.json` / `bundle-white-paint-entity.json` — the v0.8.3 producer's own shapes, hence hash-compatible. Evidence templates are cloned per call (`.map(e => ({...e}))`) so resolution never mutates the space.

`buildStampForClaim` (156) assembles proof + statusProfile; `proofMode: "registry"` because the Witness path is RegistryProof (no contract in the *stamp* path — the vending contract is payment-side only, and HIP-991 needs no contract).

### 3.7 `src/verify.ts` — one verifier, three callers

`judgeMessage` (50) produces the three-way verdict `valid | rejection | invalid` used by the MCP verify tool, the reject-attest script, and (as a JS port) the wall. Check order is deliberate: parse → schema dispatch → structural fields → hash well-formedness → **Peirce** (bindingHash recomputes from parts) → **the split holds** (ruleUriHash = sha256) → **Floridi** (ruleUri dereferences to a self-verifying RuleDef). Failures accumulate `reasons` — verdicts are explanations, not booleans, because the reject-attest script stamps those reasons on-chain. Invalid messages yield only `messageHash` (keccak of the raw bytes) — a derivation the wall can safely mention, never the bytes.

### 3.8 `test/` — the lock, four layers

1. `canonicalize.test.ts` — **pinned seq-42 vectors** from the live sphere (protocol lock, offline).
2. `crosscheck.test.ts` — every live proof on `0.0.8641943` recomputes (recipe equivalence, network, skips offline).
3. `claims.test.ts` — the closed space refuses outsiders; both WHITE claims build deterministically against the live registry.
4. `golden.test.ts` — this repo's own first Lane A stamp (regression anchor, offline).

21 tests; the offline subset alone locks the recipe, so CI without network stays meaningful.

---

## 4. `packages/contracts` — `WitnessVendingMachine.sol`

**Scope defense first:** per verify-log **V-1b (CLOSED: NO)** — the Hedera x402 exact scheme settles as a *plain native TransferTransaction*; the scheme spec explicitly forbids wrapping it in any other transaction type. Therefore this contract is **not** a payment endpoint. It is the custody answer to exactly one question: *who holds the KEY supply key so that mint-on-vend and burn-on-stamp live in the same neutral place?* (spec D-3). Answer: code.

- `constructor` (112): `operator = msg.sender`, immutable. The operator's blast radius is the admin *relationship* (calling vend/burn/create), never testimony — matching the LIMITATIONS.md disclosure (slander-not-forge).
- `createKeyToken` (122): the contract creates wKEY **itself** through the HTS system contract (`0x167`), because a token whose treasury is a contract must be created by that contract (treasury must sign; contracts sign by executing). Configuration defended field-by-field: `treasury = address(this)` (fees collect into code); supply key = `contractId: address(this)` (only vend/burn move supply); **no admin key** → the token is born immutable — nobody, ORG included, can ever re-key it (`AlreadyCreated` guard makes creation single-shot); `tokenSupplyType: false` (infinite — supply discipline comes from the burn loop, not a cap); decimals 0 (W-4: 1 KEY = 1 stamp; fractional KEY is meaningless).
- `vend(address payable to)` (166): **the delivery leg, one atomic call** — (1) forward `msg.value` to the alias, which **lazy-creates the newborn account** (HIP-583; empirically verified — V-3/V-5); (2) mint exactly 1 wKEY to treasury; (3) `transferToken` to the newborn (received via auto-association, no association tx — verified). Any leg fails → whole call reverts → no partial state (observed in the wild: the out-of-gas attempt left no account, no mint). `onlyOperator` because *the payment settled elsewhere* (V-1b): delivery is ORG honoring a receipt, and the receipt+redeemable-right model (LIMITATIONS.md, W-1 Lane B wording) is exactly what makes an operator-triggered delivery safe — failure is re-executable, no funds strand. Empirical gas note: lazy creation is expensive; 1.2M gas OOG'd, callers use 3M.
- `burnCollected(int64)` (190): D-3's sink. The Lane B topic's fee collector **is this contract** (set via `repeg-lane-b.ts`; the network accepted a contract collector without a collector signature on the topic update — empirically verified), so stamp fees flow to the treasury-in-code and `burnToken` burns from treasury by definition. Live demonstration: wKEY `total_supply` returned to 0 after the first full loop. Self-executing neutrality is *structural*: there is no code path by which collected KEY exits except burning.
- Deliberately absent: pause, drain, upgrade hooks — spec §5 "testnet-MVP-light, noted for the mainnet story", noted in LIMITATIONS.md.

Deploy path (`scripts/deploy.ts`) uses the **native SDK** (`ContractCreateFlow`), not JSON-RPC — the ORG operator key is ED25519, which has no usable EVM alias, so hashio-style deployment is impossible with this key. Discovered empirically ("Sender account not found"), recorded in verify-log.

---

## 5. `packages/mcp` — witness-mcp, the payer-agent's process

Structural successor to hologlass-mcp v0.3.2 (same skeleton: `McpServer` + stdio + three-channel returns + Windows orphan watchdog for the Node #25131 stdin-event gap).

### 5.1 `src/env.ts` — the credential model (W-2's sharpest edge)

The plugin holds the **agent's** identity and nothing of ORG's. `getPayerConfig` refuses to run when `PAYER_ID == OPERATOR_ID`, for two independent reasons: (a) W-2 — no ORG key may enter the agent's process; (b) demo integrity — the fee collector is exempt from its own HIP-991 fees (empirically confirmed: collector-paid stamps show `assessed_custom_fees: []`), so an operator-as-payer demo would *silently fake* the paid flow. The boot check makes the honest configuration the only configuration.

### 5.2 `src/channels.ts` + `src/state/keystore.ts`

Three-channel separation (hologlass anatomy): `content` = agent-visible verdicts and next-steps; `structuredContent` = full record for a viewer; `_meta` = timestamps, never hash-input. **Private keys are banned from all three** — the keystore (flat JSON in the agent's state dir) is the only place a testimony key exists; `newbornKey()` is consumed solely by the stamp tool's signer.

### 5.3 The seven tools (registered `index.ts:50–116`, each `witness_*` with zod schemas)

| Tool | Defense |
|---|---|
| `requirements` | Demo beat 2, W-7. Prefers `WITNESS_REQUIREMENTS_URL` — currently the **live production gateway** `ontologic.dev/x402/vend`, and treats an HTTP **402** response as the success case (that status *is* the conformance surface). Local fallback rebuilds from the same peg constants — either path serves the one price authority. |
| `assert_claim` | Thin wrapper over `core/claims` — W-9 lives in core, not the tool, so no alternative caller can bypass it. Failure responses include `allowedClaims()` so the agent learns the space instead of flailing. |
| `genesis` | Generates in-process, stores in keystore, returns **only the alias**. "Theirs, never ours" as code. |
| `pay` | The x402 leg per the real scheme (V-1). Facilitator mode: builds the exact-scheme `TransferTransaction`, signs **partially** (fee payer open), base64s, POSTs to `/settle` — the wire flow of the official template. Direct mode (no facilitator configured): the payer self-sponsors the *same conformant transfer*. Both return the **settled transfer as the receipt**; the memo `x402:witness-required:vend:<alias>` is the machine-readable redemption claim. The tool cannot deliver — delivery is ORG's, by design (V-1b branch). |
| `redeem_status` | Pure keyless mirror read: alias → account? funded? holds 1 wKEY? Also records the newborn's real account ID into the keystore for the stamp tool. Polling the *public record* for delivery is the redeemable-right model made tangible. |
| `stamp` | The witness itself. Lane A signer = payer; Lane B signer = **the newborn** (W-2: the testifier signs, always). Both lanes set `CustomFeeLimit` at published-price ×2 — the spec's "max-fee protection means a re-peg cannot ambush anyone", as a default nobody has to remember. Claim is rebuilt fresh from the live taxonomy at stamp time (no stale-claim replay from tool state). |
| `verify` | `core.judgeMessage` over both lane topics with mirror-lag patience (10 × 2s — V-7 measured 3–7s). Exact-timestamp match only (mirror's `timestamp=` filter is `>=`; without the equality check a query could verify the *next* message). |

---

## 6. `scripts/` — ORG-side operations

Shared plumbing `lib/ops.ts`: `openOperatorClient` (assertTestnet → client → **50 HBAR default max fee**, because testnet's ~6.6¢/HBAR exchange rate makes USD-priced network fees ~10× larger in HBAR than SDK defaults expect — discovered via `INSUFFICIENT_TX_FEE` on both topic-create and contract-create); `appendEvidence` (every on-chain action appends to `docs/evidence.md` — the bounty's link collection is a **side effect of running**, not a chore); `updateEnv` (entity IDs persist to `.env` so later scripts compose).

- `peg.ts` — the **single price authority** (W-7). Constants: Lane A fee = 0.01 HBAR = exactly the D-1 margin (at-cost is the network fee the payer already pays); Lane B fee = **1 KEY** (W-4 — the premium lives *only* in `vending.priceUsd` = $0.01, D-2); testnet HBAR notionally $0.10 (demo semantics, W-8). `buildPaymentRequirements` emits Hedera exact-scheme objects: CAIP-2 `hedera:testnet`, `asset: "0.0.0"` for HBAR, Circle testnet USDC `0.0.429274` (mirror-confirmed live).
- `emit-requirements.ts` — peg → `config.witness.json` AND the site's `payment-requirements.json`. One source, two artifacts; the published list *cannot* drift from the charged fees.
- `create-topics.ts` — descendant of v0.8.3 `create_sphere.js` with three deliberate divergences: `setCustomFees` + `setFeeScheduleKey` (HIP-991 must be set at creation — why these are new sibling topics, not modifications of `0.0.8641943`); **no `setSubmitKey`** (the open door *is* W-5's cheap public door; W-9 binds reading, not writing); Lane B created with a provisional HBAR fee because wKEY did not exist yet (see §9.3).
- `repeg-lane-b.ts` — the retained fee schedule key exercised: Lane B fee → 1 wKEY, **collector = the contract**. Fallback-to-operator branch exists but was not needed.
- `lane-a-smoke.ts` / `lane-b-smoke.ts` — the two lanes end-to-end; every claim built through core; V-7 latency measured on each run; first Lane A run emitted the golden vectors.
- `redeem.ts` — ORG honoring receipts: scans the treasury's incoming transfers on mirror for `x402:witness-required:vend:` memos at the published price, then `vend(alias)`. **Idempotent by public state** (alias already holding wKEY → skip), so the watcher can run hot during the demo without double-delivery. This is the ONE ORG-signed action on the delivery path, and it signs no testimony.
- `reject-attest.ts` — lazy attestation (D-6/D-7): judges at read time exactly as any reader would; only `invalid` verdicts proceed; attests **derivations only**; pays the lane's own published fee (the economics that kill the drain-attack: durability is funded by the party who wants it durable — here, ORG, manually). Refuses to attest about non-lane topics. Live: first attestation covers Lane A seq 2 (probe garbage), and the wall renders the attestation while the attempt still has no tile.
- `probe-vending.ts` / `probe-batch.ts` — Phase 0 falsifier probes, kept in-tree as the executable form of the verify-log entries (V-5 all-proven; V-9 practical-NO with the two-step fallback demonstrated).
- `create-payer.ts` / `mcp-smoke.ts` — demo provisioning and the full storyline driven through the plugin's own handlers (the rehearsal script).

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

---

## 10. Verification state

- 21/21 vitest (pinned + golden + crosscheck + claims + schema).
- Both lanes end-to-end **twice**: raw scripts, then again through the MCP tool handlers (`mcp-smoke.ts`).
- Wall + browser verifier validated headlessly against live topics: 2 tiles (×4, ×2), 1 verdict-tile, 2 invalid → no tile.
- Full burn loop observed on-chain: mint-on-vend → fee-to-treasury → `total_supply: 0`.
- ~25 HashScan links in `docs/evidence.md`, appended by the scripts that created them.
- Invariant audit: `grep -r "Math.random" static/wall/js/` → only the comment asserting its absence; no payload-rendering path exists in wall code; live v0.8.3 topics and KEY `0.0.8644153` untouched (read-only fetches throughout).
