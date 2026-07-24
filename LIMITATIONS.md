# LIMITATIONS.md — the affidavit (W-8)

This document declares, plainly, what each component of Witness Required can and cannot attest. It ships with the MVP and is part of the product. Entries accumulate as phases complete; wording marked *[pending V-9]* is finalized only after that verification answers.

## Trust classes

- **Client-side hash computation is self-witnessed.** The payer's own machine computes h(R‖I‖O‖M). The network does not check the hash at write time; it witnesses that *these exact bytes* reached consensus at *this exact instant*, paid for by *this account*.
- **The record is network-witnessed.** Consensus timestamp, fee settlement, and payer account are enforced by the Hedera network, not by ORG.

## statusProfile envelope (provisional)

Stamps carry a provisional `statusProfile` envelope (`schemaVersion: "0.1-mvp"`) with statuses `declared | missing | vague | blurred | stale | timed-out | withheld`. It rides **beside** the proof in the HCS message and is **not sealed into any hash** — the finalized Sorensen schema can supersede it without invalidating a single stamp. A stamp without the envelope reads as `status: missing`.

## Lane equality (W-3)

A KEY-stamped proof and an HBAR-stamped proof are epistemic equals. Fee denomination changes economics, never trust-class. Lane is not tier.

## The integrity condition (W-5)

The premium lane prices convenience, and remains honest only because the cheap native door stays open at published at-cost + minimum margin. If the premium lane were the only door, the fee schedule would be extraction.

## Fixed peg (demo semantics)

Prices are manually pegged for the MVP: testnet HBAR notionally at $0.10. Testnet HBAR is faucet-free, so the peg is *demo semantics* — a stand-in for the mainnet pricing story, stated plainly rather than implied.

## Refund minus network fee

A reverted vending call refunds the payer's principal but not the network fee the failed transaction itself incurred. *[Exact observed revert behavior recorded after Phase 3 testnet smokes.]*

## Operator account — existence and blast radius

One ORG-held operational key exists. It holds the vending contract's admin relationship and is the sole party authorized to render failed-attempt verdicts in the MVP. It never signs payer testimony. If compromised, an attacker can fabricate false *rejection attestations* — it can slander an attempt, never forge a witness.

## KEY token provenance

The vending KEY is a fresh token whose supply key is held by the vending contract from creation. It coexists with the earlier colorimetric K-channel token `0.0.8644153` (v0.8.3 sphere), which is unrelated to payment and remains untouched.

## Lane B payment/stamp coupling (final wording, per V-1b + V-9)

*No stamp without payment* holds unconditionally on both lanes: HIP-991 charges the fee in the same consensus event as the stamp. The converse — *no payment without stamp* — holds on Lane A by construction. On Lane B the x402 exact scheme settles the payment as a plain native transfer **outside** any contract call (the scheme forbids wrapping), so: the **settled transfer is the payment receipt**, and delivery (account genesis + 1 KEY) and the stamp are **redeemable rights**. A payer can transiently hold KEY without a stamp (client crash, wallet hiccup); no funds strand, every right remains redeemable, and the delivery leg itself is one atomic contract call that reverts whole.

## The facilitator (x402 fee sponsor) — implemented, not deployed

The Hedera x402 exact scheme's full wire flow has the payer partially sign the payment transfer and a facilitator co-sign as fee-payer and submit. The plugin's pay tool **implements** that flow (set `FACILITATOR_URL`), but **no facilitator is deployed for this MVP**: the demo settles in **direct mode** — the payer fully signs and self-sponsors the same conformant transfer, and every pay response discloses which mode ran. If a facilitator is ever used, its key sponsors network fees on the payer's *payment transfer* only — it never signs payer *testimony* (stamps are payer-signed, always) and never custodies payer funds.

## The reasons field shipped before it was closed

Rejection attestations carry a free-text `reasons` array, and the verifier currently constructs those strings by interpolating subject-message fields (the live attestation's `"unknown schema: undefined"` is this mechanism showing through). That means `reasons` is, today, a potential payload carrier: a crafted subject message could place attacker-chosen text into an ORG-signed attestation and onto the wall — a W-10 hole in the *verdict* path (the subject fields themselves remain derivations only). Recorded in `docs/verify-log.md` (2026-07-24); the fix is a closed reason-code enum (codes on the wire, display templates in the renderer), scheduled as Phase 2 work.

## The x402 payer needs a funded account

Under the exact scheme the payer signs a debit from an existing funded account. A truly account-less agent cannot pay on Hedera rails directly; what Lane B's vend delivers is the genesis of the fresh **testimony account** (the key that signs the witness), funded and KEY-bearing, from the payment the agent's funding account settled. "This agent did not exist on Hedera ninety seconds ago" is true of the account that signs the stamp.
