/**
 * create-terms-topic.ts — the vending-terms topic (rectification pass, 2026-07-28).
 *
 * ⚠ CEREMONY SCRIPT — HUMAN GATE REQUIRED (CLAUDE.md). Created WITHOUT an
 * admin key: immutability is chosen at creation and only at creation (V-11).
 * Submit key = OPERATOR — ORG can append amended terms; history is permanent.
 *
 * The first message on this topic is the terms document the successor KEY
 * token's frozen memo points at (hcs://<topic>/<consensus ts>), so this topic
 * must exist — and that message must be published — before the token deploy.
 */

import { TopicCreateTransaction } from "@hashgraph/sdk";
import { getNetworkConfig } from "../packages/core/src/config.js";
import { verifyAnchors } from "../packages/core/src/resolve.js";
import { appendEvidence, hashscanEntity, hashscanTx, openOperatorContext, updateEnv } from "../packages/ops/src/index.js";

async function main() {
  // Guard 1 — single-shot.
  if (process.env.WITNESS_TERMS_TOPIC) {
    throw new Error(
      `Terms topic already recorded (WITNESS_TERMS_TOPIC=${process.env.WITNESS_TERMS_TOPIC}). ` +
        `One-shot: a wrong topic is abandoned and re-created, never reused.`,
    );
  }

  const { client, operatorKey } = openOperatorContext();

  const tx = new TopicCreateTransaction().setTopicMemo("WITNESS_TERMS").setSubmitKey(operatorKey.publicKey);
  // Guard 2 — no admin key IN THE BUILT TRANSACTION, not just in the source.
  tx.freezeWith(client);
  if (tx.adminKey !== null && tx.adminKey !== undefined) {
    throw new Error("Built transaction carries an admin key. Refusing — immutability is the design.");
  }
  if (tx.submitKey === null || tx.submitKey === undefined) {
    throw new Error("Built transaction carries no submit key. Refusing — anyone could rewrite the terms feed.");
  }

  console.log("Creating WITNESS_TERMS (submit = operator, admin = NONE — immutable at birth)...");
  const resp = await tx.execute(client);
  const receipt = await resp.getReceipt(client);
  const topicId = receipt.topicId!.toString();
  console.log(`  topic: ${topicId}`);
  console.log(`  tx: ${hashscanTx(resp.transactionId.toString())}`);

  // Guard 3 — mirror read-back: admin_key null, submit_key exactly the operator's.
  const net = getNetworkConfig();
  const operatorPub = operatorKey.publicKey.toStringRaw().toLowerCase();
  console.log("Mirror read-back (patience for mirror lag)...");
  let reports;
  for (let i = 0; ; i++) {
    try {
      reports = await verifyAnchors([{ topicId, expectedSubmitKey: operatorPub }], {
        mirrorNodeUrl: net.mirrorNodeUrl,
      });
      break;
    } catch (e) {
      if (i >= 9) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.log(`  ${reports[0].topicId} (${reports[0].memo}): admin_key null ✓, submit_key ${reports[0].submitKey!.key.slice(0, 16)}… ✓`);

  updateEnv({ WITNESS_TERMS_TOPIC: topicId });
  appendEvidence("create WITNESS_TERMS topic (immutable, submit=operator — vending terms feed)", topicId, hashscanEntity("topic", topicId));
  console.log("\nNext: scripts/publish-terms.ts (the first message bakes into the successor token memo).");
  client.close();
}

main().catch((err) => {
  console.error("create-terms-topic failed:", err);
  process.exit(1);
});
