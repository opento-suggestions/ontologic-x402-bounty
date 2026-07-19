/**
 * peg.ts — the ONE price authority (W-7's sunshine, single source).
 *
 * Manual fixed peg for MVP (spec D-1/D-2, closed): testnet HBAR notionally at
 * $0.10 — demo semantics, disclosed in LIMITATIONS.md. Emits both the machine
 * config (config.witness.json prices) and the site's payment-requirements.json
 * from the same numbers, so the published price list cannot drift from the
 * charged fees.
 *
 * Lane A (native): the HIP-991 custom fee carries exactly the D-1 minimum
 * margin ($0.001); at-cost is the network fee the payer already pays the
 * network. Total = at-cost + margin, and ORG's take is the margin, visibly.
 * Lane B (premium): fee is exactly 1 KEY (W-4) — the entire premium lives in
 * the $0.01 USDC vending price (D-2), never in the fee amount.
 */

export const PEG = {
  hbarUsd: 0.10, // testnet HBAR, notional — demo semantics (W-8)
  laneA: {
    marginUsd: 0.001, // D-1, closed
    feeHbar: 0.01, // $0.001 at the peg
    feeTinybar: 1_000_000,
  },
  laneB: {
    feeKey: 1, // W-4: 1 KEY = 1 stamp, burned on execution
  },
  vending: {
    priceUsd: 0.01, // D-2, closed — the entire premium, in exactly one place
    priceUsdcSmallest: 10_000, // 6 decimals
    usdcTokenId: "0.0.429274", // Circle testnet USDC, confirmed on mirror 2026-07-19
  },
} as const;

interface WitnessEntities {
  hbarTopicId: string | null;
  keyTopicId: string | null;
  keyTokenId: string | null;
  treasuryAccountId: string;
}

/** x402 PaymentRequirements per the Hedera exact scheme (CAIP-2 network id). */
export function buildPaymentRequirements(entities: WitnessEntities) {
  return {
    generatedBy: "scripts/peg.ts — the single price authority; do not hand-edit",
    peg: { hbarUsd: PEG.hbarUsd, semantics: "manual fixed peg, testnet demo (see LIMITATIONS.md)" },
    lanes: {
      laneA: {
        name: "WITNESS_HBAR — native, discounted",
        topicId: entities.hbarTopicId,
        fee: { amount: String(PEG.laneA.feeTinybar), asset: "0.0.0", denomination: "tinybar" },
        feeUsdNotional: PEG.laneA.marginUsd,
        note: "HIP-991 fixed fee charged atomically as the stamp records. At-cost network fee is paid separately to the network; this fee is ORG's published minimum margin (W-5).",
      },
      laneB: {
        name: "WITNESS_KEY — premium, genesis + witness",
        topicId: entities.keyTopicId,
        fee: { amount: String(PEG.laneB.feeKey), asset: entities.keyTokenId, denomination: "KEY" },
        note: "1 KEY = 1 stamp, burned on execution (W-4/D-3). The premium lives in the vending price, never here.",
      },
    },
    vending: {
      accepts: [
        {
          scheme: "exact",
          network: "hedera:testnet",
          amount: String(PEG.vending.priceUsdcSmallest),
          asset: PEG.vending.usdcTokenId,
          payTo: entities.treasuryAccountId,
          maxTimeoutSeconds: 180,
          description: "Vend 1 KEY + testimony-account genesis (Witness Required, Lane B)",
        },
        {
          scheme: "exact",
          network: "hedera:testnet",
          amount: String(Math.round((PEG.vending.priceUsd / PEG.hbarUsd) * 1e8)),
          asset: "0.0.0",
          payTo: entities.treasuryAccountId,
          maxTimeoutSeconds: 180,
          description: "Vend 1 KEY + testimony-account genesis (HBAR at the pegged rate)",
        },
      ],
    },
  };
}
