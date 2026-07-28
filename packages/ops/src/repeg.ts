/**
 * repeg.ts — flip the Lane B (WITNESS_KEY) topic fee to 1 wKEY of the
 * CURRENT key token, using the retained fee schedule key — the re-peg lever
 * the spec names. Payers' max-custom-fee protection means this can never
 * ambush anyone.
 *
 * Collector preference order:
 *   1. The vending contract account (= wKEY treasury): collected KEY sits in
 *      code and only exits by burning — structural.
 *   2. If the network requires a collector signature a contract cannot give,
 *      fall back to the operator/treasury account (disclosed in
 *      LIMITATIONS.md; burn path gains one transfer-back-to-treasury step).
 */

import { CustomFixedFee, TopicUpdateTransaction } from "@hashgraph/sdk";
import { getWitnessConfig } from "../../core/src/config.js";
import type { OperatorContext } from "./contexts.js";
import { appendEvidence, hashscanEntity, hashscanTx } from "./plumbing.js";
import { PEG } from "./peg.js";

export async function repegLaneB(ctx: OperatorContext): Promise<void> {
  const witness = getWitnessConfig();
  if (!witness.keyTopicId || !witness.keyTokenId || !witness.vendingContractId) {
    throw new Error("Need WITNESS_KEY_TOPIC_ID, WITNESS_KEY_TOKEN_ID, VENDING_CONTRACT_ID in .env");
  }

  const tryCollector = async (collector: string, label: string) => {
    const fee = new CustomFixedFee()
      .setAmount(PEG.laneB.feeKey)
      .setDenominatingTokenId(witness.keyTokenId!)
      .setFeeCollectorAccountId(collector);
    const tx = await new TopicUpdateTransaction()
      .setTopicId(witness.keyTopicId!)
      .setCustomFees([fee])
      .execute(ctx.client);
    await tx.getReceipt(ctx.client);
    console.log(`Lane B re-pegged: fee = ${PEG.laneB.feeKey} wKEY (${witness.keyTokenId}), collector = ${collector} (${label})`);
    console.log(`  tx: ${hashscanTx(tx.transactionId.toString())}`);
    appendEvidence(
      `Lane B re-peg: fee -> 1 wKEY, collector = ${label}`,
      witness.keyTopicId!,
      hashscanEntity("topic", witness.keyTopicId!),
    );
  };

  try {
    await tryCollector(witness.vendingContractId, "vending contract / wKEY treasury");
  } catch (err) {
    console.log(`Contract-as-collector failed (${(err as Error).message?.slice(0, 120)}); falling back to operator...`);
    await tryCollector(ctx.operatorId, "operator (fallback — disclosed in LIMITATIONS.md)");
  }
}
