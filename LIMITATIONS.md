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

## The facilitator (x402 fee sponsor)

The Hedera x402 exact scheme requires a facilitator that co-signs the payer's payment transfer as fee-payer and submits it. ORG runs the official template's self-hosted facilitator for the demo. The facilitator key sponsors network fees on the payer's *payment transfer* only — it never signs payer *testimony* (stamps are payer-signed, always). It never custodies payer funds.

## The x402 payer needs a funded account

Under the exact scheme the payer signs a debit from an existing funded account. A truly account-less agent cannot pay on Hedera rails directly; what Lane B's vend delivers is the genesis of the fresh **testimony account** (the key that signs the witness), funded and KEY-bearing, from the payment the agent's funding account settled. "This agent did not exist on Hedera ninety seconds ago" is true of the account that signs the stamp.
