# Witness Required — Spec v0.2

> **Amendments (2026-07-24, per PHASE_2.md §7).** The historical text below is preserved unedited; two §2 sentences are superseded:
> 1. *"This is the one ORG key in the architecture"* (Operator account) — superseded by the Phase 2 two-key structure: the **root** key (holds the Witness Rule Registry's submit key; writes mandates and revocations) and the **operator** key (holds the Verdict Topic's submit key; renders mandated verdicts). Disjoint powers; the operator physically cannot write a mandate. See PHASE_2.md §1–3 and W-11.
> 2. *"ORG treasury — fee collector for both lanes"* — superseded during Phase 1: Lane B's HIP-991 fee collector is the **vending contract** (the wKEY treasury-in-code), which is how D-3's burn works. Lane A's collector remains the ORG treasury. See CURRENT_ARCHITECTURE.md §4 and verify-log 2026-07-19.
>
> Every `W-n`, `D-n`, and `V-n` reference in this repo resolves to this document (as amended); W-11 and W-12 are defined in PHASE_2.md §2.

**Project:** x402 pay-per-proof service on Hedera rails
**Steward:** Ontologic Reclamation Group (ORG)
**Status:** Working draft — session of July 19, 2026 (supersedes v0.1, July 17)
**Bounty:** Hedera x402 Bounty · July 13–31, 2026 · submissions close 11:59 PM ET July 31 · five $1,000 prizes · [submission form](https://forms.gle/oWbifBqkvbk2oANC7)
**Judged on:** working end-to-end flow · real on-chain payments through x402 · depth of Hedera rails usage
**Deadline posture:** the build is the goal; the bounty is a bonus window. If the deadline kills us, we simply don't submit. No descope ladder needed — this is not cold scratch, it's assembly from proven implementations (hello-world pipeline, v0.7.1/v0.8.3 taxonomy, Visor grammar).

---

## 1. Thesis

HTTP 402 is *Payment Required*. Ontologic adds the missing sibling: **Witness Required.** An agent (or human) pays through the x402 standard to have a reasoning claim stamped as a morpheme — h(R‖I‖O‖M) — onto a fee-bearing Hedera Consensus Service topic. The payment and the testimony settle on the same ledger; on the native lane they are the *same transaction*. The receipt is the product.

Posture per decisions of July 16: ORG flag, steward register, no thesis-speech in the README — the build is the argument. This is an MVP bounty artifact of the current protocol iteration, built with intent to maintain, scoped honestly as what it is (precedent: the Apex goose/MCP Hologlass artifact).

## 2. Actors

- **Payer-agent** — a fresh goose instance running the Witness plugin (successor to the Apex artifact; Morpheme-wrapped tool per the Feb anatomy: namespaced URN, policy metadata, generate → validate → intercept → sign → execute → audit). The agent is the driver: it asserts a reasoning claim and navigates each gate intentionally.
- **Payer-human** — secondary flow; HashPack via WalletConnect, audience-participation lane.
- **Static orchestrator** — a subpage on ontologic.dev. Zero keys in repo or page. No ORG backend holds signing authority over payer testimony, ever.
- **Operator account** — ORG-held operational key. Holds the vending contract's admin relationship and is the sole party authorized to render failed-attempt verdicts in MVP (§4 W-10, §5). This is the *one* ORG key in the architecture, and it never signs payer testimony (W-2 preserved). Blast radius if compromised: an attacker can fabricate false *rejection attestations*, never false proofs — a stolen operator key can slander an attempt, not forge a witness. Declared in LIMITATIONS.md (W-8).
- **402 gateway (optional, stateless, keyless)** — a thin endpoint (Pages Function/Worker class, zero secrets) that returns a literal HTTP 402 with PaymentRequirements and verifies settlement by reading mirror REST. Exists purely for x402 wire-conformance; the trust design never depends on it. Whether literal-HTTP is required or scheme-conformance suffices is verify-at-build item V-1.
- **Vending machine** — a contract holding the KEY supply key. Accepts the conformant x402 payment (USDC or HBAR, exact scheme) and mints KEY to the payer in the same call. Settlement and mint share one atomic boundary: if the transfer fails, the mint reverts; if the transfer lands, the mint proceeds (V-1 narrows to confirming the x402 exact scheme permits in-call settlement — §8). Full revert refunds the payer, minus the network fee the failed transaction itself incurred (disclosed in W-8). The contract also **burns KEY per-execution** on the stamp side — mint-on-pay and burn-on-stamp live in the same custody (D-3, closed).
- **Two fee-bearing topics** (new; HIP-991 fee schedule key must be set at creation, so these are siblings to PROOF 0.0.8641943, not modifications of it):
  - **Lane A topic** — fixed fee in HBAR. Native, discounted, at-cost + minimum margin.
  - **Lane B topic** — fixed fee in KEY. Premium, for off-chain entrants and non-HBAR payers.
- **ORG treasury** — fee collector for both lanes (HIP-991 multi-wallet distribution supported natively). Holds no KEY position: KEY is burned per-execution, not accumulated (self-executing neutrality — no reserve for anyone to question, no treasury position for the steward to steward).
- **Proof Wall** — public gallery on ontologic.dev; every stamp becomes a tile rendered deterministically from its morpheme hash. **The wall renders derivations, never payloads** (the pollination doctrine, §5): ORG surfaces display ORG's judgments — tiles, verdicts, attestations — and never foreign bytes. The wall is the product; the tile is the reward.
- **Verifier/readers** — mirror-node REST (public, free) as the canonical read path; the site's verifier and HashScan as the human-facing views. HashScan carries the raw-payload view on its own brand; ORG surfaces never do.

## 3. Flows

### 3.1 Lane A — native (discounted)

1. Agent asserts a claim: a **trace proof of WHITE in light or paint over the existing taxonomy** (v0.7.1/v0.8.3 — 10 rules, 29 proofs, dual proof modes). Closed claim space; no custom color assertions in MVP.
2. Plugin validates client-side (schema, rule references, statusProfile envelope). Invalid claims never submit.
3. Plugin fetches the published price list (static PaymentRequirements JSON on the page; literal 402 via gateway if V-1 says so).
4. Payer's wallet signs **one TopicMessageSubmitTransaction** to the Lane A topic carrying the morpheme. HIP-991 charges the HBAR fee *as* it records the message. Payment and stamp are one atomic consensus event.
5. Mirror REST shows the message; site verifies the hash live; HashScan link returned; tile blooms on the wall.

### 3.2 Lane B — premium (genesis + witness)

1. Off-chain agent (no Hedera account) asserts the same class of claim.
2. Plugin generates a keypair **client-side — theirs, never ours**.
3. Conformant x402 payment (USDC or HBAR, exact scheme) into the vending machine. The same call: funds the payer's public-key **alias into existence** (account auto-create), delivers KEY, and includes enough HBAR for the account's own transaction fees. Payment and mint are one contract call; revert-on-failure is the refund path (minus the failed transaction's own network fee).
4. Newborn account signs its own TopicMessageSubmitTransaction to the Lane B topic; HIP-991 charges the KEY fee atomically with the stamp; the contract burns the consumed KEY.
5. Same read path as Lane A. **The premium lane's product is account genesis plus witness** — every premium customer exits holding their own Hedera key.

**Atomicity across steps 3–4:** target is a **HIP-551 atomic batch** bundling the vending call and the newborn's stamp into one all-or-nothing unit — the pattern SentX ships for NFT minting and SaucerSwap for LP minting (V-9). If the batch works, Lane B's composite (pay → KEY → stamp) is a single atomic event and W-1 holds symmetrically on both lanes. If the newborn-as-inner-payer question (V-9) comes back negative, the two-step stands and W-1's asymmetric wording applies: on Lane B, KEY-in-hand is the payment receipt and the stamp is a redeemable right — a payer can hold KEY and an account without a stamp (client crash, wallet hiccup), but no funds strand and the stamp remains claimable. Whichever branch V-9 selects, W-1 and W-8 are worded *after* the answer, not before.

### 3.3 Read/verify

Wall and verifier query both topic IDs via mirror REST and merge by consensus timestamp. Renderer and verifier are lane-agnostic. Which topic a stamp landed on is free payment-provenance — denominated testimony — with zero extra fields. Reads are free and public: direct rail access is the demonstration; only convenience is ever priced (read-side convenience metering is out of MVP scope — see §7).

### 3.4 Rejection — lazy attestation

Malformed messages hand-crafted directly to a topic (bypassing the plugin) are judged at **read-time** by the verifier, as all messages already are. No daemon watches the topic; nothing auto-emits — proof-on-demand symmetry holds for rejections exactly as it does for proofs. A rejection becomes *durable* (stamped to the topic as a bounded fail-write in ORG's schema, under ORG's signature, attesting "this attempt occurred and failed conformance") only when summoned:

- **Successful calls and payments:** the verdict is automatic — the stamp *is* the verdict. Nothing further to summon.
- **Failed attempts:** only the **operator account** may render the failed verdict in MVP (D-7, closed). Manual, on ORG's initiative, at ORG's expense, when durability is worth the fee.

Why lazy: eager attestation would convert every spammer's paid fee into a matching fee *ORG pays* to attest the garbage — an attacker-controlled lever draining the fail-write wallet at a fixed exchange rate, inverting W-5's spam economics. Lazy attestation keeps the economics pointed the right way: verdicts are free at read-time; durability is funded only by the party who wants it durable.

## 4. Invariants (W-series)

Namespaced W- to avoid collision with the Coprocessor spec's I-series.

- **W-1 · No payment, no stamp.** Enforced by consensus (HIP-991 atomicity) on both lanes. *No stamp without payment* holds unconditionally everywhere. The converse — *no payment without stamp* — holds on Lane A by construction, and on Lane B either (a) by HIP-551 batch atomicity if V-9 confirms, or (b) as a redeemable right: KEY-in-hand is the receipt, the stamp is claimable, no funds strand. Final wording follows V-9.
- **W-2 · Keyless testimony.** No ORG-held key ever signs a payer's testimony. The payer signs their own stamp — including the newborn account on Lane B. The operator account (§2) signs only ORG's *own* testimony: rejection attestations about observed attempts. (Keyless ≠ serverless: the optional 402 gateway holds zero secrets.)
- **W-3 · Lane equality.** Proof semantics are identical across lanes. Fee denomination changes economics, never trust-class. A KEY-stamped WHITE and an HBAR-stamped WHITE are epistemic equals. One sentence in LIMITATIONS.md says exactly this so nobody reads lane as tier.
- **W-4 · Unit semantics.** 1 KEY = 1 stamp, burned on execution. The entire premium lives in the vending price; the fee amount never carries it. The tokenomics knob exists in exactly one place, and consumed KEY exits supply — no reserve accumulates (D-3).
- **W-5 · The native door stays open at published at-cost + minimum margin.** This is the integrity condition for the premium: the premium prices convenience, and remains honest only because the cheap public door exists. If the premium lane were the only door, the fee schedule would be extraction.
- **W-6 · Deterministic rendering.** A tile derives solely from the on-chain record (morpheme hash seeds color/form/distortion). No randomness; any observer reproduces the wall from the topics alone.
- **W-7 · Published price list.** Both lanes' prices visible on the page. The price list is the sunshine.
- **W-8 · The affidavit ships.** LIMITATIONS.md declares: trust-class of each component (client-side hash computation = self-witnessed; the record = network-witnessed); statusProfile envelope semantics (missing / vague / blurred / stale / timed-out / withheld); W-3 lane equality; W-5 integrity condition; the fixed-peg disclosure (manual peg, testnet HBAR notionally at $0.10 — testnet HBAR is faucet-free, so the peg is *demo semantics*, a stand-in for the mainnet pricing story, stated plainly rather than implied); the refund-minus-network-fee clause (a reverted vending call refunds the payer's principal but not the network fee the failed transaction itself incurred); the operator account's existence and blast radius (a compromised operator key can fabricate false rejection attestations, never false proofs); and W-1's final lane-B wording per V-9.
- **W-9 · Closed claim space (MVP).** Trace proofs over the existing taxonomy only. Semantics stay bounded; the demo stays legible. Note the layer honesty: W-9 bounds the *validation* and *reading* layers, not the ledger — a fee-bearing topic without a submit key accepts any paid bytes by design (that open door *is* W-5's cheap public door). The bound is a reading discipline enforced by verifier judgment and the pollination doctrine (W-10), not a writing constraint.
- **W-10 · No payload pollination.** ORG surfaces (wall, verifier UI) render only derivations and judgments — tiles seeded from hashes, verdicts, ORG-signed attestations. Foreign message bytes never render on ORG-branded pages. Raw-payload views live on HashScan under HashScan's brand. An attacker who pays to write garbage buys a consensus timestamp and nothing else: no tile until lazily attested, and then the *attestation* renders, not the attempt. (Closes D-4.)

## 5. Failure modes

- **Payment settles, stamp fails** — Lane A: excluded by HIP-991 atomicity. Lane B: excluded by HIP-551 batch if V-9 confirms; otherwise degraded to "KEY held, stamp pending" — a recoverable state, not a loss. Vending leg: settlement and mint share one atomic boundary; transfer failure reverts the mint; revert = refund minus the failed transaction's network fee.
- **Spam/griefing (write-side)** — dissolved by economics: the payer pays, the fee is the rate limit. (Retires the June objection: proof-on-demand, never auto-emit.)
- **Spam/griefing (attestation-side)** — dissolved by lazy attestation (§3.4): no auto-emitting fail-writer exists to drain. The operator renders failed verdicts manually, at ORG's discretion and expense.
- **Malformed morpheme hand-crafted directly to a topic** — they paid the fee for a consensus timestamp. Verifier marks it invalid at read-time; no tile renders (W-10); durable rejection only by operator-summoned lazy attestation. We reject it; we don't pollinate their payload.
- **Operator key compromise** — attacker can slander attempts (false rejection attestations), cannot forge witnesses. Bounded, disclosed in W-8.
- **Fee drift** — resolved by fixed manual peg (D-1/D-2): HBAR native lane at at-cost + $0.001 minimum margin; vending at $0.01 USDC fixed. Testnet peg is demo semantics (W-8). The retained fee schedule key remains the re-peg lever; payers' max-fee protection means a re-peg cannot ambush anyone.
- **Mirror REST lag** — the money shot depends on seconds-scale propagation; fallback is HashScan direct. Verify latency (V-7).
- **WalletConnect session failure (human lane)** — retry UX; non-blocking for the agent demo.
- **Newborn-account edges (Lane B)** — token association for receiving KEY (HIP-904 auto-association expected to cover; verify V-3), and the funding transfer must include HBAR for the account's own base fees.
- **Vending machine custody** — supply key held by contract; operator account holds the admin relationship; pause/drain considerations are testnet-MVP-light but noted for the mainnet story.
- **Replay/duplicates** — same morpheme stamped N times yields N identical tiles (W-6 guarantees it); economically self-limiting (each duplicate is paid). Open micro-decision D-8: wall dedups or displays multiplicity — identical adjacent tiles may read as a rendering bug to visitors; a small multiplicity badge is the likely resolution.

## 6. Tokenomics — decided

- **D-1 (closed):** native lane minimum margin = **$0.001**. Can't lose money; makes at least a fraction. HBAR-denominated, slightly above at-cost.
- **D-2 (closed):** vending price = **$0.01 USDC, fixed**. The entire premium, carried in exactly one place (W-4).
- **D-3 (closed):** **KEY is consumed by the contract — burned per-execution.** Sink, not reserve. Self-executing neutrality: no treasury position to steward, no KEY pile to question, nobody misuses a token that no longer exists.
- **Peg (closed):** manual fixed peg for MVP; testnet HBAR notionally $0.10. Demo semantics, disclosed (W-8). HBAR priced slightly above at-cost for the native lane; USDC carries the premium on the vending side.
- LARI/SaucerSwap universal inlet (any LP'd token → USDC/HBAR → KEY) remains a post-MVP bolt-on tier, not a foundation change.

## 7. Scope

**In (MVP):** goose plugin · static orchestrator · vending contract (mint + burn) · two fee-bearing topics · Lane A and Lane B end-to-end · Proof Wall with deterministic renderer under the pollination doctrine · mirror-REST verifier + HashScan links · lazy-attestation rejection path (operator-only) · LIMITATIONS.md · both x402 legs (conformant exact-scheme + atomic HIP-991) · demo video.

**Out (roadmap — the "what this becomes" slide):** sphere deployment (pay via x402 to deploy your own RULE_DEFS/RULE_REGISTRY/PROOF triple minted to your keys — ORG as registrar; who-decides vs. who-registers separation) · Ontosphere/CLPR cross-chain attach · LARI universal inlet · read-side convenience metering (requires a server; conflicts with pure-static MVP) · third-party verdict summoning (opening D-7 beyond the operator — attestation-as-a-service) · mainnet migration.

**Cross-chain note:** enters through x402's own multichain nature (Ripple, Stellar, Solana joined the Foundation July 14) — any agent on any x402 rail can pay in. We demonstrate cross-chain by conforming, not constructing.

## 8. Verify-at-build (V-series)

Priority order: **V-1/V-5 and V-9 first** — they are the only items that can falsify design rather than adjust it.

- **V-1** — x402 spec + [matevszm/x402-hedera-example](https://github.com/matevszm/x402-hedera-example): (a) does conformance require literal HTTP 402 roundtrips (→ stateless gateway) or does scheme/PaymentRequirements conformance suffice (→ pure static)? (b) **Does the Hedera exact scheme permit settlement to occur inside the resource contract call itself?** If settlement runs facilitator-first (money moves before the contract executes), revert protects nothing and Lane B needs a real refund mechanism — the one place genuine design work may still hide.
- **V-2** — HIP-991 fee-list semantics: conjunctive (all fees charged) vs. payer's choice. Two-topic design is adopted regardless (provenance benefit stands); this only affects whether a future single-topic collapse is possible.
- **V-3** — account auto-create by public-key alias on testnet: funding minimums, HIP-904 auto-association for receiving KEY, and confirmation that contract-side topic submission does not exist (HIP-206 covers HTS, not HCS — if a relayer were the only alternative, it would cost W-2; auto-provisioning is the design that doesn't).
- **V-4** — HashPack/WalletConnect from a static page: TopicMessageSubmitTransaction with custom-fee max-fee field support.
- **V-5** — vending contract: payable call that settles the x402 transfer, mints KEY, and funds the alias in one transaction; HTS system-contract mint *and burn* mechanics; revert behavior when the transfer leg fails.
- **V-6** — SaucerSwap testnet + LARI pools API capabilities (only if the post-MVP tier is reached).
- **V-7** — mirror REST propagation latency on testnet (money-shot timing).
- **V-8** — HIP-991 reference: [hedera-dev/tutorial-js-hip-991-ai-agent](https://github.com/hedera-dev/tutorial-js-hip-991-ai-agent) and the [scaffold x402 template](https://github.com/hedera-dev/scaffold-hbar/tree/templates/x402-pay-per-use).
- **V-9 (new)** — **HIP-551 atomic batch for Lane B:** can an inner transaction be signed and fee-paid by an account that an earlier inner transaction *in the same batch* creates? The newborn's key exists client-side before the account does (signature producible), but a transaction ID needs a payer account. Study targets: SentX NFT-mint flow and SaucerSwap LP-mint flow — both ship this pattern in production; the SentX co-founder thread is already warm. Yes → W-1 fully symmetric, Lane B is one atomic event. No → two-step stands, asymmetric W-1 wording applies.

## 9. Demo video — beat sheet (≤ 5:00)

1. **0:00–0:30** — Fresh goose boots, loads the Witness plugin. Agent is asked to assert a reasoning claim (WHITE trace).
2. **0:30–1:15** — Plugin returns *Payment Required*: PaymentRequirements on screen, both lanes' prices visible (W-7).
3. **1:15–2:30** — **Lane B full flow:** x402 payment → vending machine mints KEY → account genesis on screen ("this agent did not exist on Hedera ninety seconds ago") → atomic KEY-fee stamp → KEY burned.
4. **2:30–3:15** — Mirror REST shows the message → site verifies the hash live → HashScan link → **tile blooms on the Proof Wall.**
5. **3:15–4:00** — **Lane A contrast:** an already-native agent stamps the discounted lane in one transaction; price difference on screen. Both, both is good.
6. **4:00–4:45** — LIMITATIONS.md on screen for ten honest seconds. Trust-class, lane equality, the affidavit.
7. **4:45–5:00** — One slide: *what this becomes* — spheres, Ontosphere, every chain's agents paying their way onto the record.

## 10. Bounty compliance checklist

- [ ] Public open-source GitHub repo (**D-5 open:** repo home — `opento-suggestions` org alongside ontologic-hello-world, or a new ORG org)
- [ ] Real on-chain transactions on Hedera **testnet**; HashScan links collected as we go
- [ ] Demo video under five minutes, end-to-end flow + on-chain payments focus
- [ ] Submission form before 11:59 PM ET, July 31
- [ ] Payments through the x402 standard (conformant leg) — settled in HBAR ($0.0001/transfer) and/or USDC ($0.001/transfer)

## 11. Existing assets

- ontologic-hello-world (187 lines) — stamping pipeline precedent
- v0.7.1/v0.8.3 taxonomy — 10 rules, 29 proofs, KEY token with HIP-646/657 metadata, dual proof modes, WHITE proven in light and paint
- Live topics: RULE_DEFS 0.0.8641938 · RULE_REGISTRY 0.0.8641941 · PROOF 0.0.8641943 · ReasoningContract 0.0.8641949 (all remain untouched; new fee-bearing siblings are additive)
- Visor at ontologic.dev/visor — scene grammar the wall can inherit or fork
- Apex goose/MCP Hologlass artifact — plugin predecessor, tragically outdated, honorably retired
- SentX NFT-mint and SaucerSwap LP-mint flows — production precedents for the HIP-551 batch pattern (V-9 study targets)

## 12. Decision ledger

| ID | Status | Resolution |
|----|--------|-----------|
| D-1 | **Closed** | Native minimum margin: $0.001 |
| D-2 | **Closed** | Vending price: $0.01 USDC fixed |
| D-3 | **Closed** | KEY burned per-execution (sink, not reserve) |
| D-4 | **Closed** | Invalid attempts render no tile; only operator-summoned attestations render (W-10) |
| D-5 | **Open** | Repo home: `opento-suggestions` org vs. new ORG org — gates repo creation |
| D-6 | **Closed** | Lazy attestation (economics: eager = attacker-drainable fail-write wallet) |
| D-7 | **Closed (MVP)** | Success verdicts automatic (the stamp is the verdict); failed verdicts operator-only. Third-party summoning → roadmap |
| D-8 | **Open** | Duplicate-stamp display: dedup vs. multiplicity badge (micro, non-blocking) |

## 13. Naming (micro-decisions, zero blockers)

- Project/demo title: **Witness Required**
- Lane topic memos: proposed `WITNESS_HBAR` / `WITNESS_KEY` — rename at will
- Wall page: proposed `/wall` — the Proof Wall

---

*Spec v0.2 drafted July 19, 2026, from the session of the same date. Every decision above traces to an explicit call made in-conversation; every uncertainty is tagged D- (decide) or V- (verify) rather than papered over. We reject malformed morphemes; we do not pollinate their payloads. Germs die in sunshine.*