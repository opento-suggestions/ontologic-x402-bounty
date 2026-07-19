/**
 * create-topics.ts — the two fee-bearing lane topics (HIP-991).
 *
 * Descendant of ontologicv0.5_clean scripts/v0.7/create_sphere.js, with the
 * divergences the spec demands:
 *   - setCustomFees(): HIP-991 fixed fee, set at creation (it cannot be added
 *     to an existing topic without a fee schedule key — these are additive
 *     siblings to the live 0.0.86419xx topics, which stay untouched)
 *   - setFeeScheduleKey(operator): the retained re-peg lever (spec §5). A
 *     re-peg cannot ambush payers — their max-custom-fee protection caps it.
 *   - NO submit key: the open door IS W-5's cheap public door and W-9's layer
 *     honesty. A fee-bearing topic without a submit key accepts any paid bytes
 *     by design; the bound is a reading discipline, not a writing constraint.
 *
 * Lane A fee: final (0.01 HBAR = D-1 margin at the peg).
 * Lane B fee: PROVISIONAL in HBAR — HIP-991 requires the fee at creation but
 * the witness-KEY token doesn't exist until the vending contract deploys.
 * The retained fee schedule key re-pegs Lane B to `1 KEY` immediately after
 * token creation (scripts/repeg-lane-b.ts). Recorded in verify-log.
 */

import { CustomFixedFee, Hbar, TopicCreateTransaction } from "@hashgraph/sdk";

// A revenue-generating (custom-fee) topic is priced ~$2 by the network — far
// above the SDK default max fee. Cap generously; the network charges actuals.
const MAX_CREATE_FEE = new Hbar(50);
import { openOperatorClient, appendEvidence, hashscanEntity, hashscanTx, updateEnv } from "./lib/ops.js";
import { PEG } from "./peg.js";

async function main() {
  const { client, operatorId, operatorKey } = openOperatorClient();

  const mk = async (memo: string, fee: CustomFixedFee) => {
    const tx = await new TopicCreateTransaction()
      .setTopicMemo(memo)
      .setCustomFees([fee])
      .setFeeScheduleKey(operatorKey.publicKey)
      .setAdminKey(operatorKey.publicKey)
      .setMaxTransactionFee(MAX_CREATE_FEE)
      .execute(client);
    const receipt = await tx.getReceipt(client);
    const topicId = receipt.topicId!.toString();
    console.log(`${memo}: ${topicId}`);
    console.log(`  tx: ${hashscanTx(tx.transactionId.toString())}`);
    appendEvidence(`create topic ${memo} (HIP-991 fixed fee)`, topicId, hashscanEntity("topic", topicId));
    return topicId;
  };

  console.log("Creating Lane A (WITNESS_HBAR) — fixed HBAR fee, collector = ORG treasury...");
  const laneA = await mk(
    "WITNESS_HBAR",
    new CustomFixedFee()
      .setHbarAmount(Hbar.fromTinybars(PEG.laneA.feeTinybar))
      .setFeeCollectorAccountId(operatorId),
  );

  console.log("Creating Lane B (WITNESS_KEY) — provisional HBAR fee until witness-KEY exists...");
  const laneB = await mk(
    "WITNESS_KEY",
    new CustomFixedFee()
      .setHbarAmount(Hbar.fromTinybars(PEG.laneA.feeTinybar))
      .setFeeCollectorAccountId(operatorId),
  );

  updateEnv({ WITNESS_HBAR_TOPIC_ID: laneA, WITNESS_KEY_TOPIC_ID: laneB });
  console.log("\n.env updated: WITNESS_HBAR_TOPIC_ID, WITNESS_KEY_TOPIC_ID");
  console.log("Reminder: run repeg-lane-b after witness-KEY token creation (fee → 1 KEY).");

  client.close();
}

main().catch((err) => {
  console.error("create-topics failed:", err);
  process.exit(1);
});
