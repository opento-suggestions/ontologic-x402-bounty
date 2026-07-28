/**
 * publish-terms.ts — the first message on the WITNESS_TERMS topic.
 *
 * ⚠ CEREMONY SCRIPT — HUMAN GATE REQUIRED (CLAUDE.md). This message's
 * consensus timestamp bakes into the successor KEY token's FROZEN memo, so
 * the content (docs/vending-terms.json) is steward-ratified before this runs.
 *
 * Idempotent by public state: if the topic already carries a first message,
 * its URI is printed and nothing is written — the terms feed's history is
 * append-only and the memo points at message one.
 */

import { TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { canonicalizeJSON } from "../packages/core/src/morpheme.js";
import { buildHcsUri } from "../packages/core/src/resolve.js";
import { getNetworkConfig } from "../packages/core/src/config.js";
import { appendEvidence, awaitMirrorMessage, consensusString, hashscanTx, openOperatorClient, readJson, updateEnv } from "./lib/ops.js";

function memoCandidate(uri: string): string {
  return `Vends KEY+testimony genesis for reasoning-trace stamps. ORG ${uri}`;
}

async function main() {
  const topicId = process.env.WITNESS_TERMS_TOPIC;
  if (!topicId) {
    throw new Error("WITNESS_TERMS_TOPIC not set — run scripts/create-terms-topic.ts first.");
  }
  const net = getNetworkConfig();

  // Idempotence: message one is the anchor; never write a second copy of it.
  const existing = (await (
    await fetch(`${net.mirrorNodeUrl}/topics/${topicId}/messages?limit=1&order=asc`)
  ).json()) as { messages?: { consensus_timestamp: string }[] };
  if (existing.messages?.length) {
    const uri = buildHcsUri(topicId, existing.messages[0].consensus_timestamp);
    console.log(`Terms already published: ${uri}`);
    reportMemo(uri);
    return;
  }

  const terms = readJson<Record<string, unknown>>("docs/vending-terms.json");
  const bytes = Buffer.from(canonicalizeJSON(terms), "utf8");
  console.log(`Publishing vending terms (${bytes.length} bytes${bytes.length > 1024 ? " — WILL CHUNK" : ", single message"})...`);

  const { client } = openOperatorClient();
  const tx = await new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(bytes).execute(client);
  const record = await tx.getRecord(client);
  const consensus = consensusString(record);
  console.log(`  tx: ${hashscanTx(tx.transactionId.toString())}`);

  // Read-back: the memo must point at a message anyone can fetch keylessly.
  await awaitMirrorMessage(net.mirrorNodeUrl, topicId, consensus);
  const uri = buildHcsUri(topicId, consensus);
  console.log(`  terms URI: ${uri}`);

  updateEnv({ WITNESS_TERMS_URI: uri });
  appendEvidence("publish vending terms (message one on WITNESS_TERMS)", uri, hashscanTx(tx.transactionId.toString()));
  reportMemo(uri);
  client.close();
}

function reportMemo(uri: string): void {
  const memo = memoCandidate(uri);
  const len = Buffer.byteLength(memo, "utf8");
  console.log(`\nToken memo candidate (${len} bytes${len > 100 ? " — OVER the 100-byte cap, TRIM BEFORE DEPLOY" : ", fits the 100-byte cap"}):`);
  console.log(`  ${memo}`);
  console.log("Paste into WitnessVendingMachine.sol's HederaToken.memo, recompile, then deploy.");
}

main().catch((err) => {
  console.error("publish-terms failed:", err);
  process.exit(1);
});
