# Verify-at-build log (V-series)

Dated findings for the spec's V-series items. Each entry names the design branch the answer selects. Nothing in Phases 3–6 is coded against an unanswered falsifier (V-1, V-5, V-9).

| Item | Question | Status | Branch selected |
|------|----------|--------|-----------------|
| V-1a | Does x402 conformance require a literal HTTP 402 roundtrip? | **CLOSED 2026-07-19: YES** | 402 gateway required (keyless resource side); facilitator required (fee-payer key) |
| V-1b | Can settlement occur inside the resource contract call (exact scheme)? | **CLOSED 2026-07-19: NO** | facilitator-first: settled transfer = receipt; vend delivery = separate leg; W-1 Lane B asymmetric |
| V-2 | HIP-991 fee-list semantics: conjunctive vs payer's choice | open (desk note only) | two-topic design adopted regardless |
| V-3 | Auto-create by public-key alias: funding minimum, HIP-904 auto-association | **CLOSED 2026-07-19: works** | lazy creation from contract value-transfer; newborn auto-associates wKEY |
| V-4 | HashPack/WalletConnect: TopicMessageSubmit with max custom fee | open | — |
| V-5 | Vending contract: mint + alias funding + burn + revert behavior | **CLOSED 2026-07-19: all proven** | delivery leg atomic; x402 settle stays outside (per V-1b) |
| V-5b | Existing KEY 0.0.8644153 key audit | **CLOSED (moot)** | fresh witness-KEY `0.0.9645864` created by contract; 0.0.8644153 untouched |
| V-7 | Mirror REST propagation latency on testnet | **CLOSED 2026-07-19: ~3s** | money shot fine; HashScan fallback unneeded |
| V-9 | HIP-551 batch: can a newborn inner account pay/sign an inner tx? | **CLOSED 2026-07-19: NO (practical)** | two-step stands; W-1 Lane B asymmetric (already forced by V-1b) |
| V-10 | Can mirror REST attribute a topic message to a signing key (signer set / historical key state)? | **CLOSED 2026-07-24: NO** | transport attribution cannot carry authority → immutable submit-keyed topics + read-time mandate window (Phase 2) |
| V-11 | Can an HCS topic's admin key be cleared after creation? | **CLOSED 2026-07-24: NO** | rotate-only; immutability must be chosen at creation → authority topics born without admin keys (Phase 2 §3) |

---

## Entries

### 2026-07-24 — V-10 / V-11 (Phase 2 falsifiers) — primary records

### V-10 — Can a keyless verifier bind a topic message to an ORG account from mirror REST alone?

**Answered 2026-07-24 · NO**

**Question.** W-11 requires the verifier to establish that a verdict was rendered by the mandated grantee. Can a client with no private keys, reading only public mirror REST, bind a topic message to a specific ORG account and its key structure?

**Finding — what mirror exposes.** On `/api/v1/topics/{id}/messages`: `payer_account_id`, `consensus_timestamp`, `sequence_number`, `message` (base64), `running_hash`, `running_hash_version`, and chunk fields. From the message alone you cannot see the transaction's signature map, its public keys, or the account's key structure at submission time.

**Finding — how far you can go.** Following the transaction back via `/api/v1/transactions?timestamp=...` may expose `transaction_bytes` (base64 protobuf) **depending on mirror implementation and version**. Decoding that locally yields `sig_map.sig_pair[].pub_key_prefix` and the signatures, which can be prefix-matched against `/api/v1/accounts/{id}`'s `key` field.

**Finding — the three defects.** (1) Mirrors do not re-expose a decoded `SignatureMap` or a resolved signer set as a REST field; the client must decode protobuf itself. (2) `/accounts/{id}` returns the account's **current** key, not its historical key state — so a verdict judged weeks later would be checked against whatever key the account holds *at query time*, and a key rotation silently rewrites history. (3) `transaction_bytes` availability is not portable across mirror implementations.

**Consequence.** `payer_account_id` alone is a reference to who paid for a transaction, not a cryptographic binding. Transport-level attribution cannot carry authority. This falsified the in-payload-signature-optional branch and forced attribution into either message content or network-enforced write access — see V-11.

**Cross-reference.** W-6's reproducibility clause ("any observer reproduces the wall from the topics alone") independently forbids a verdict that depends on `/accounts` or `/transactions`, since those answers can differ between two honest readers at different times. Promoted to **W-12 (anchor sufficiency)** in PHASE_2 §2.

---

### V-11 — Can an HCS topic's admin key be cleared after creation?

**Answered 2026-07-24 · NO**

**Question.** Topic-membership attribution is only trustworthy if the submit key cannot be rotated. Can a topic be made permanently immutable after the fact?

**Finding.** `ConsensusTopicUpdateTransaction` permits changing the admin key to a different key, or leaving it unchanged by not setting it. There is **no supported operation** to set the admin key to null or otherwise remove it after creation. HIP-540's key-removal behavior applies to tokens; topics do not mirror that capability.

**Consequence.** Immutability must be chosen at creation: a topic created **without** an admin key can never be updated or deleted, and its submit key is therefore permanent. A topic created **with** an admin key can never become immutable — the admin key can only be rotated, never removed.

This makes the authority topics a one-shot ceremony. It also makes their key state the one piece of topic configuration that is temporally stable and self-certifying: a reader sees `admin_key: null` on `/topics/{id}` and knows no operation exists that could change it.

**Accepted cost (MVP, declared in LIMITATIONS.md).** A permanent submit key is unrotatable and unrecoverable. Loss means no further writes on that topic, ever; compromise means the attacker retains write access indefinitely, though every write after revocation is machine-detectably out-of-mandate. Recovery is abandon-and-re-anchor, which is the same ceremony a pinned-key rotation would have required, since the anchor was always off-chain.

**Related fork.** Exact attribution and rotatability are mutually exclusive here: a KeyList submit key would allow operator rotation without touching the topic, but V-10 means mirror cannot reveal *which* listed key signed — attribution would degrade from "the operator wrote this" to "one of N wrote this." Single-key was chosen for the MVP.

---

### 2026-07-24 — the §4.1 reasons finding

**§4.1 finding — `reasons` is currently a payload carrier (W-10 violated in the verdict path).** Confirmed against the code and the live record, 2026-07-24:
- `packages/core/src/verify.ts` constructs reasons by string interpolation of subject-message fields — the schema-dispatch branch pushes `` `unknown schema: ${String(payload.schema)}` ``.
- `scripts/reject-attest.ts` stamps `verdict.reasons` on-chain inside the rejection attestation.
- The wall's `wall.js` renders `rejection.reasons` as verdict-tile text on an ORG surface.
- The live Lane A attestation (subject seq 2) carries `reasons: ["unknown schema: undefined"]` — `String(undefined)` from an absent field, which is the benign form of the hole. A subject message carrying `{"schema": "<attacker text>"}` would place that text, verbatim, into an ORG-signed on-chain attestation and onto the wall.

The type-level W-10 defense ("no field that could carry the attempt's payload") holds for the *subject fields* (hash/topic/timestamp/seq — derivations only) but NOT for `reasons`. The mechanism shipped before the reason space was closed; disclosed in LIMITATIONS.md. Fix is PHASE_2 §4.1's closed `ReasonCode` enum — codes on the wire, display templates in the renderer, pointers by hash or offset, never by value.

**Addendum, 2026-07-24 (Phase 2a) — primary record of the live attestation, read from public mirror REST (keyless; no transaction signed):**

- Attestation: Lane A `0.0.9645621` **seq 7**, consensus `1784518459.756961931`, payer `0.0.8641261` (operator). Full message body, verbatim:

  ```json
  {"createdAt":"2026-07-20T03:34:19.691Z","operatorAccountId":"0.0.8641261","reasons":["unknown schema: undefined"],"schema":"hcs.ontologic.witness.rejection","schemaVersion":"0.1","subjectConsensusTimestamp":"1784493351.903971104","subjectMessageHash":"0x784712708a8b6930b2a311d48ee4b8ff4953a6413ad6052366a613d37bdee6ae","subjectSequenceNumber":2,"subjectTopicId":"0.0.9645621","verdict":"rejected"}
  ```

- Subject: Lane A seq 2, consensus `1784493351.903971104` — the V-9 probe stamp, whose payload has **no `schema` field at all**. The live `"unknown schema: undefined"` is therefore `String(undefined)` from an absent field, exactly as predicted from `verify.ts`'s schema-dispatch branch. The interpolation finding above is confirmed against the live record, not just the code.
- **Second interpolation site**, missed by the original entry: `verify.ts`'s Floridi branch pushes `` `ruleUri does not dereference: ${(e as Error).message}` ``, and the resolver's error text embeds subject content — `resolve.ts` throws `` `Invalid ruleUri format: ${ruleUri}. Expected: hcs://<topicId>/<timestamp>` `` (and similar). `ruleUri` is an attacker-chosen field: a message that passes the Peirce and split checks over its own crafted `ruleUri` (both hashes are computable by the author) reaches this branch and lands its `ruleUri` text in `reasons`. Both sites close together under the `ReasonCode` enum: `floridi.rule-unresolvable` carries no error text.

### 2026-07-24 — facilitator contradiction resolved (direct mode is ground truth)

The affidavit and the architecture doc briefly disagreed about the facilitator: LIMITATIONS.md carried the V-1 entry's forward-looking sentence ("ORG runs this for the demo") while CURRENT_ARCHITECTURE §9.7 said self-hosted facilitator deployment was not built and direct mode is the demo default. Ground truth, determined from the code:

- `packages/mcp/src/tools/pay.ts` gates facilitator mode on `FACILITATOR_URL`; unset, it settles in **direct mode** (payer fully signs and self-sponsors the same conformant transfer). `.env.example` ships `FACILITATOR_URL` empty.
- No facilitator deployment, Docker config, or facilitator key exists anywhere in this repo.

**Resolution:** the 2026-07-19 V-1 sentence recorded an intention Phase 1 never built. CURRENT_ARCHITECTURE §9.7 was right. LIMITATIONS.md was corrected in commit `9b707e0` ("The facilitator (x402 fee sponsor) — implemented, not deployed"); the V-1 entry below now carries a superseded marker rather than a rewrite — dated records stay dated.

### 2026-07-19 — Lane A live; HIP-991 confirmed end-to-end

Topics created with HIP-991 fixed fees at creation (fee schedule key retained = the re-peg lever): **WITNESS_HBAR `0.0.9645621`**, **WITNESS_KEY `0.0.9645622`** (Lane B fee provisional in HBAR until witness-KEY exists; re-peg to 1 KEY after token creation). No submit keys — the open door is deliberate (W-5/W-9). Note: revenue-generating topic creation is priced far above the SDK default max fee; scripts set an explicit 50-HBAR cap.

First paid stamp (WHITE trace, light) landed and verified keyless in **~3.0s submit→mirror (V-7)**. Fee-collector self-exemption confirmed: a stamp paid by the collector shows `assessed_custom_fees: []`, while the newborn probe account `0.0.9645672`'s stamp shows the fee really flowing: `{amount: 1000000, collector: 0.0.8641261, effective_payer: 0.0.9645672}` — payment and stamp one atomic consensus event (W-1, Lane A). Demo must therefore stamp from a non-collector payer account (it will — the payer-agent is distinct).

### 2026-07-19 — V-5 / V-9 / V-3 closed; Lane B delivery chain proven on-chain

**V-5 — all mechanics proven** by deploy + live smoke (contract `0.0.9645863`):
- Contract created its own token via the HTS system contract: **wKEY `0.0.9645864`**, treasury = contract, supply key = contract, **admin key = null (born immutable)**.
- `vend(alias)` in ONE atomic call: value transfer to a non-existent EVM alias **lazy-created the newborn account** (V-3 — HIP-583 path; auto-association delivered the wKEY without any association tx), minted 1 wKEY, delivered it. Gas note: lazy creation is gas-heavy — 1.2M was OOG-adjacent, 3M is comfortable.
- The newborn `0.0.9645912` then **signed its own Lane B stamp** (W-2 held: no ORG key near testimony), and the HIP-991 fee assessed as `{amount: 1, token: 0.0.9645864, collector: 0.0.9645863}` — **the fee flows to the treasury-in-code**.
- `burnCollected(1)` executed; mirror shows `total_supply: 0`. **Mint-on-vend, burn-on-stamp, zero reserve — D-3 is structural and demonstrated.**
- Revert behavior: a failing leg reverts the whole delivery (observed: the OOG attempt left no partial state — no account, no mint). The redeemable right survives re-execution.
- Lane B re-peg via the retained fee schedule key worked, **with the contract as collector** (no collector signature demanded on the topic update).
- Lane B mirror latency ~6.3s (V-7 range: 3–7s).

**V-9 — NO (practical).** Attempt A (HIP-551 batch whose inner stamp is fee-paid by the alias-form account the batch itself creates) stalls in SDK retry — the transaction-ID-needs-a-real-payer problem is real at the SDK layer; no clean network acceptance was observed. Attempt B (two-step: transfer-to-alias auto-create via child receipt, then the newborn self-signs) is proven live. **Branch: two-step stands.** This costs nothing extra: V-1b already forced the payment leg outside any batch, so Lane B was already receipt + redeemable right. Final W-1 wording (LIMITATIONS.md): *no stamp without payment* unconditional on both lanes; on Lane B the settled x402 transfer is the receipt, and delivery (genesis + KEY) and the stamp are redeemable rights — a payer can transiently hold KEY without a stamp, but no funds strand and every right remains redeemable.

### 2026-07-19 — V-1 (desk study, official sources)

**Sources:** x402 spec repo (`x402-foundation/x402`, formerly `coinbase/x402`) — `specs/schemes/exact/scheme_exact_hedera.md`; official Hedera template `hedera-dev/scaffold-hbar@templates/x402-pay-per-use`; reference example `matevszm/x402-hedera-example`; hedera.com x402 blog.

**V-1a — YES, literal HTTP 402.** The conformance surface is the HTTP flow: server returns `402` with a payment challenge header; client retries with the signed-payment header; settlement receipt returns in a `PAYMENT-RESPONSE` header. The official template implements exactly this. **Branch:** the thin 402 gateway ships. The resource-server side stays keyless (precedent: the reference example — "the server holds no Hedera key"), preserving W-2's keyless-gateway posture.

**Hedera exact scheme (spec):** `network` is CAIP-2 — **`hedera:testnet`**. `asset` is an entity ID: `"0.0.0"` for HBAR or an HTS token ID. Amounts in tinybar / token smallest unit. `extra.feePayer` names the fee-sponsoring account. The PaymentPayload carries a Base64 **partially signed native `TransferTransaction`** — client signs the debit; the **facilitator co-signs as fee payer and submits**. Spec: the decompiled transaction "MUST be a `TransferTransaction` directly. It MUST NOT be wrapped in a `ScheduleCreateTransaction` or any other transaction type."

**V-1b — NO in-call settlement.** Per the scheme, x402 settlement on Hedera is a plain native transfer — contract calls are explicitly excluded ("Hedera x402 payments are native transfers, not EVM contract calls" — official template README). Revert-protects-payer semantics therefore CANNOT couple payment to KEY delivery in one transaction. **Branch (the spec's anticipated "genuine design work" case):**
- x402 leg: payer's partially signed `TransferTransaction` (USDC `0.0.429274` or HBAR) → `payTo` = ORG treasury; facilitator co-signs + submits; mirror-visible settlement is the receipt.
- Delivery leg: vend execution (mint KEY → deliver to payer/alias → fund alias) is a separate transaction after settlement verification. The **settled transfer is the payment receipt; KEY delivery and the stamp are redeemable rights** — no funds strand, and failure of the delivery leg cannot un-settle the payment. W-1's Lane B wording is asymmetric one level earlier than V-9 anticipated; V-9 still governs whether delivery+stamp can fuse into one HIP-551 batch.
- Refund posture: delivery-leg failure → re-execution (redeem) rather than refund; operator-refund of the settled transfer is the backstop. Disclosed in LIMITATIONS.md.

**Facilitator:** the official template ships a **self-hosted facilitator** (Docker, `facilitator/`, `FACILITATOR_ACCOUNT_ID`/`FACILITATOR_PRIVATE_KEY`, "never custodies buyer funds — only co-signs pre-approved transfers"). ORG runs this for the demo with a dedicated fee-payer account. *(Superseded 2026-07-24 — see the facilitator-resolution note above: no facilitator was ever deployed; the pay tool implements the wire flow but the demo settles in direct mode.)* **W-2 note:** the facilitator key co-signs the payer's *payment transfer* as fee sponsor only — it never signs payer *testimony* (stamps remain payer-signed). Add to LIMITATIONS.md.

**Assets:** testnet USDC confirmed live on mirror: **`0.0.429274`** ("USDC HBAR", 6 decimals; Circle-held admin/freeze keys). HBAR exact-scheme = `asset: "0.0.0"`.

**Consequence for the spec's Lane B premise:** under the real scheme, the x402 payer must sign a debit from an existing funded account — a truly account-less agent cannot pay on Hedera rails directly. Lane B's "genesis" product stands: the *testimony account* (newborn key, auto-created alias) is what the vend delivers; the payment debit comes from the agent's funding source (demo: a funded payer account). To be stated plainly in LIMITATIONS.md rather than implied.
