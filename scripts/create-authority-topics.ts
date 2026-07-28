/**
 * create-authority-topics.ts — ceremony §3.2–§3.4: the two immutable topics.
 *
 * ⚠ CEREMONY SCRIPT — HUMAN GATE REQUIRED (CLAUDE.md). THE ONE THING THAT
 * CANNOT BE UNDONE: both topics are created WITHOUT an admin key, which is
 * the whole point (V-11: an admin key can be rotated but never cleared, so
 * immutability is chosen at creation and only at creation). A wrong submit
 * key is permanent. A lost submit key is permanent. Dry-run first. Do not
 * batch this with anything else.
 *
 *   Witness Rule Registry — submit key = ROOT,     memo WITNESS_RULES
 *   Verdict Topic         — submit key = OPERATOR, memo WITNESS_VERDICTS
 *
 * No custom fees on either: authority is not for sale, and near-free verdict
 * writes are fine because laziness (D-6) was always the discipline, not the
 * fee (PHASE_2 §5 economics note — declared in LIMITATIONS.md).
 *
 * The five guards of §3.4 are all here, in code.
 */

import { PrivateKey, TopicCreateTransaction, type Client, type PublicKey } from "@hashgraph/sdk";
import { getAuthorityConfig, getNetworkConfig } from "../packages/core/src/config.js";
import { verifyAnchors } from "../packages/core/src/resolve.js";
import { appendEvidence, hashscanEntity, hashscanTx, openOperatorContext, updateEnv } from "../packages/ops/src/index.js";

async function createImmutableTopic(client: Client, memo: string, submitKey: PublicKey): Promise<string> {
  const tx = new TopicCreateTransaction().setTopicMemo(memo).setSubmitKey(submitKey);
  // Guard 3 — no admin key IN THE BUILT TRANSACTION, not just in the source.
  tx.freezeWith(client);
  if (tx.adminKey !== null && tx.adminKey !== undefined) {
    throw new Error(`${memo}: built transaction carries an admin key. Refusing — immutability is the design.`);
  }
  if (tx.submitKey === null || tx.submitKey === undefined) {
    throw new Error(`${memo}: built transaction carries no submit key. Refusing — an open authority topic is not an authority topic.`);
  }
  const resp = await tx.execute(client);
  const receipt = await resp.getReceipt(client);
  const topicId = receipt.topicId!.toString();
  console.log(`${memo}: ${topicId}`);
  console.log(`  tx: ${hashscanTx(resp.transactionId.toString())}`);
  return topicId;
}

async function main() {
  // Guard 1 — single-shot (mirrors the vending contract's AlreadyCreated).
  const auth = getAuthorityConfig();
  if (auth.witnessRulesTopicId || auth.verdictTopicId) {
    throw new Error(
      `Authority topics already recorded (registry=${auth.witnessRulesTopicId}, verdict=${auth.verdictTopicId}). ` +
        `These are one-shot. Recovery from a bad creation is abandon-and-re-anchor, deliberately manual.`,
    );
  }
  if (!auth.rootDerKey) {
    throw new Error("ROOT_DER_KEY not set — run scripts/create-root.ts (ceremony §3.1) first.");
  }

  const { client, operatorKey } = openOperatorContext();
  const rootKey = PrivateKey.fromStringDer(auth.rootDerKey);

  // Guard 2 — key distinctness, asserted before EITHER creation.
  const rootPub = rootKey.publicKey.toStringRaw().toLowerCase();
  const operatorPub = operatorKey.publicKey.toStringRaw().toLowerCase();
  if (rootPub === operatorPub) {
    throw new Error("ROOT key equals OPERATOR key — disjoint powers are the invariant (W-11). Refusing.");
  }

  console.log("Creating the Witness Rule Registry (submit = root, admin = NONE — immutable at birth)...");
  const registryId = await createImmutableTopic(client, "WITNESS_RULES", rootKey.publicKey);

  console.log("Creating the Verdict Topic (submit = operator, admin = NONE — immutable at birth)...");
  const verdictId = await createImmutableTopic(client, "WITNESS_VERDICTS", operatorKey.publicKey);

  // Guard 4 — mirror read-back: admin_key null, submit_key exactly as intended.
  // verifyAnchors throws on any violation; there is no second chance, so this
  // failing means STOP and investigate, not retry.
  const net = getNetworkConfig();
  console.log("\nMirror read-back (W-12(b) executable — patience for mirror lag)...");
  let reports;
  for (let i = 0; ; i++) {
    try {
      reports = await verifyAnchors(
        [
          { topicId: registryId, expectedSubmitKey: rootPub },
          { topicId: verdictId, expectedSubmitKey: operatorPub },
        ],
        { mirrorNodeUrl: net.mirrorNodeUrl },
      );
      break;
    } catch (e) {
      if (i >= 9) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  for (const r of reports) {
    console.log(`  ${r.topicId} (${r.memo}): admin_key null ✓, submit_key ${r.submitKey!.key.slice(0, 16)}… ✓`);
  }

  updateEnv({ WITNESS_RULES_TOPIC: registryId, WITNESS_VERDICT_TOPIC: verdictId });
  appendEvidence("create Witness Rule Registry (immutable, submit=root — ceremony §3.2)", registryId, hashscanEntity("topic", registryId));
  appendEvidence("create Verdict Topic (immutable, submit=operator — ceremony §3.3)", verdictId, hashscanEntity("topic", verdictId));

  // Guard 5 — the banner.
  console.log("\n══════════════════════════════════════════════════════════════");
  console.log("  THESE ARE NOW TRUST ANCHORS — PUBLISH THEM");
  console.log(`    Witness Rule Registry : ${registryId}`);
  console.log(`    Verdict Topic         : ${verdictId}`);
  console.log("  Pin both into packages/core/src/anchors.ts (and the wall's");
  console.log("  anchors) — changing them later is a verifier-release event.");
  console.log("══════════════════════════════════════════════════════════════");
  console.log("\nNext (ceremony §3.5): scripts/publish-witness-rules.ts, then grant-mandate.ts");
  client.close();
}

main().catch((err) => {
  console.error("create-authority-topics failed:", err);
  process.exit(1);
});
