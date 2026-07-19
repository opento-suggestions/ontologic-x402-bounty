/**
 * repeg-lane-b.ts — flip the Lane B (WITNESS_KEY) topic fee from its
 * provisional HBAR value to the final 1 wKEY (W-4: 1 KEY = 1 stamp), using
 * the retained fee schedule key — the re-peg lever the spec names. Payers'
 * max-custom-fee protection means this can never ambush anyone.
 *
 * Collector preference order:
 *   1. The vending contract account (= wKEY treasury): collected KEY sits in
 *      code and only exits by burning — D-3 structural.
 *   2. If the network requires a collector signature a contract cannot give,
 *      fall back to the operator/treasury account (disclosed in
 *      LIMITATIONS.md; burn path gains one transfer-back-to-treasury step).
 */

import { CustomFixedFee, TopicUpdateTransaction } from "@hashgraph/sdk";
import { getWitnessConfig } from "../packages/core/src/config.js";
import { appendEvidence, hashscanEntity, hashscanTx, openOperatorClient } from "./lib/ops.js";
import { PEG } from "./peg.js";

async function main() {
  const { client, operatorId } = openOperatorClient();
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
      .execute(client);
    await tx.getReceipt(client);
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
    await tryCollector(operatorId, "operator (fallback — disclosed in LIMITATIONS.md)");
  }

  client.close();
}

main().catch((err) => {
  console.error("repeg-lane-b failed:", err);
  process.exit(1);
});
