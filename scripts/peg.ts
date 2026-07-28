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
 * the vending price (D-2 as amended), never in the fee amount.
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
    // D-2 as amended 2026-07-27 (steward-directed reprice): the original
    // $0.01 was upside-down at the peg — vend() FORWARDS fundHbar (3 HBAR =
    // $0.30 notional) to the newborn, so every sale delivered ~30× its
    // receipt. The price now covers what delivery costs, itemized below with
    // the margin visible — the same at-cost + margin honesty as Lane A (W-5).
    priceUsd: 0.5, // D-2 (amended) — the entire premium, in exactly one place
    priceUsdcSmallest: 500_000, // 6 decimals
    usdcTokenId: "0.0.429274", // Circle testnet USDC, confirmed on mirror 2026-07-19
    fundHbar: 3, // forwarded to the newborn inside vend() — the delivery's principal (redeem.ts msg.value)
    costUsdNotional: {
      funding: 0.3, // fundHbar at the peg — what the newborn receives
      deliveryNetwork: 0.15, // vend() gas + burn cadence, amortized allowance
      margin: 0.05, // ORG's take, visibly
    },
    // Price eras: a receipt is matched at the price in force at its OWN
    // consensus instant, so pre-reprice receipts stay countable and the
    // watcher's receipts-vs-deliveries netting never misreads a paid-in-full
    // old receipt (or denies a repeat customer their next delivery).
    priceEras: [
      { sinceConsensusSecond: 0, priceUsd: 0.01 },
      { sinceConsensusSecond: 1_785_187_000, priceUsd: 0.5 }, // reprice, 2026-07-27
    ],
  },
} as const;

/** Vending price in tinybar in force at a consensus timestamp ("ssss.nnnnnnnnn"). */
export function vendPriceTinybarAt(consensusTimestamp: string): number {
  const second = Number(consensusTimestamp.split(".")[0]);
  let priceUsd: number = PEG.vending.priceEras[0].priceUsd;
  for (const era of PEG.vending.priceEras) {
    if (second >= era.sinceConsensusSecond) priceUsd = era.priceUsd;
  }
  return Math.round((priceUsd / PEG.hbarUsd) * 1e8);
}

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
    spec: "https://github.com/opento-suggestions/ontologic-x402-bounty/blob/main/SPEC.md",
    peg: { hbarUsd: PEG.hbarUsd, semantics: "manual fixed peg, testnet demo (see LIMITATIONS.md)" },
    lanes: {
      laneA: {
        name: "WITNESS_HBAR — native, discounted",
        topicId: entities.hbarTopicId,
        fee: { amount: String(PEG.laneA.feeTinybar), asset: "0.0.0", denomination: "tinybar" },
        feeUsdNotional: PEG.laneA.marginUsd,
        note: "HIP-991 fixed fee charged atomically as the stamp records. The at-cost network fee is paid separately to the network; this fee is ORG's published minimum margin — the premium lane stays honest because this cheap native door stays open.",
      },
      laneB: {
        name: "WITNESS_KEY — premium, genesis + witness",
        topicId: entities.keyTopicId,
        fee: { amount: String(PEG.laneB.feeKey), asset: entities.keyTokenId, denomination: "KEY" },
        note: "1 KEY = 1 stamp, burned on execution. The premium lives in the vending price, never here.",
      },
    },
    vending: {
      priceUsd: PEG.vending.priceUsd,
      costUsdNotional: PEG.vending.costUsdNotional,
      note: "Price = funding the newborn receives + delivery network allowance + visible margin (repriced 2026-07-27). The vend forwards 3 HBAR to the testimony account it creates; the price covers what it delivers.",
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
