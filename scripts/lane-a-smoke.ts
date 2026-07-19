/**
 * lane-a-smoke.ts — Lane A end to end: one paid stamp (the demo floor).
 *
 * 1. Build a WHITE trace claim (light domain) against the LIVE v0.8.3
 *    taxonomy via @witness/core — W-9 closed space, invalid never constructs.
 * 2. Submit the WitnessStamp to the Lane A topic with max-custom-fee
 *    protection set (a re-peg cannot ambush the payer).
 *    HIP-991 charges the HBAR fee AS the message records: payment and stamp
 *    are one atomic consensus event (W-1).
 * 3. Measure submit→mirror-visible latency (V-7, the money-shot timing).
 * 4. Verify the stamp back off the mirror with the keyless verifier.
 * 5. Append evidence; print the golden-vector block for test/golden.test.ts.
 */

import {
  CustomFeeLimit,
  CustomFixedFee,
  Hbar,
  TopicMessageSubmitTransaction,
} from "@hashgraph/sdk";
import { canonicalizeJSON } from "../packages/core/src/morpheme.js";
import { getNetworkConfig, getSphereConfig, getWitnessConfig } from "../packages/core/src/config.js";
import { buildWhiteTraceClaim, buildStampForClaim } from "../packages/core/src/claims.js";
import { judgeMessage } from "../packages/core/src/verify.js";
import type { MirrorMessage } from "../packages/core/src/mirror.js";
import { openOperatorClient, appendEvidence, hashscanTx, hashscanEntity } from "./lib/ops.js";
import { PEG } from "./peg.js";

async function main() {
  const { client, operatorId } = openOperatorClient();
  const net = getNetworkConfig();
  const sphere = getSphereConfig();
  const witness = getWitnessConfig();

  if (!witness.hbarTopicId) throw new Error("WITNESS_HBAR_TOPIC_ID not set — run create-topics first.");

  console.log("1. Building WHITE trace claim (light) against the live taxonomy...");
  const claim = await buildWhiteTraceClaim({
    domain: "light",
    registryTopicId: sphere.ruleRegistryTopicId,
    proofTopicId: sphere.proofTopicId,
    resolve: { mirrorNodeUrl: net.mirrorNodeUrl },
  });
  console.log(`   ruleUri:     ${claim.ruleUri}`);
  console.log(`   bindingHash: ${claim.bindingHash}`);

  const stamp = buildStampForClaim({
    claim,
    callerAccountId: operatorId,
    createdAt: new Date().toISOString(),
  });
  const message = canonicalizeJSON(stamp);

  console.log("\n2. Submitting to Lane A with max-custom-fee protection...");
  // Cap at 2× the published fee: honors the price list, tolerates nothing more.
  const feeLimit = new CustomFeeLimit()
    .setAccountId(operatorId)
    .setFees([
      new CustomFixedFee().setHbarAmount(Hbar.fromTinybars(PEG.laneA.feeTinybar * 2)),
    ]);

  const submitted = Date.now();
  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(witness.hbarTopicId)
    .setMessage(Buffer.from(message, "utf8"))
    .setCustomFeeLimits([feeLimit])
    .execute(client);
  const record = await tx.getRecord(client);
  const consensusTimestamp = `${record.consensusTimestamp.seconds}.${record.consensusTimestamp.nanos
    .toString()
    .padStart(9, "0")}`;
  const txLink = hashscanTx(tx.transactionId.toString());
  console.log(`   consensus: ${consensusTimestamp}`);
  console.log(`   tx: ${txLink}`);

  console.log("\n3. Waiting for mirror visibility (V-7 latency)...");
  const url = `${net.mirrorNodeUrl}/topics/${witness.hbarTopicId}/messages?timestamp=${consensusTimestamp}`;
  let mirrorMsg: MirrorMessage | null = null;
  let latencyMs = 0;
  for (let i = 0; i < 60; i++) {
    const resp = await fetch(url);
    if (resp.ok) {
      const data = (await resp.json()) as { messages?: MirrorMessage[] };
      if (data.messages?.length) {
        mirrorMsg = data.messages[0];
        latencyMs = Date.now() - submitted;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!mirrorMsg) throw new Error("Stamp not visible on mirror after 30s");
  console.log(`   visible after ~${(latencyMs / 1000).toFixed(1)}s (submit→mirror)`);

  console.log("\n4. Keyless verification off the mirror...");
  const verdict = await judgeMessage(mirrorMsg, witness.hbarTopicId, { mirrorNodeUrl: net.mirrorNodeUrl });
  console.log(`   verdict: ${verdict.kind}${verdict.reasons.length ? " — " + verdict.reasons.join("; ") : ""}`);
  if (verdict.kind !== "valid") throw new Error("Smoke stamp did not verify VALID");

  appendEvidence(
    `Lane A stamp: WHITE trace (light), HIP-991 fee paid atomically, mirror latency ~${(latencyMs / 1000).toFixed(1)}s`,
    consensusTimestamp,
    txLink,
  );
  appendEvidence("Lane A topic after first stamp", witness.hbarTopicId, hashscanEntity("topic", witness.hbarTopicId));

  console.log("\n5. Golden vector block (paste into packages/core/test/golden.test.ts):");
  console.log(
    JSON.stringify(
      {
        topicId: witness.hbarTopicId,
        consensusTimestamp,
        ruleUri: claim.ruleUri,
        ruleUriHash: claim.ruleUriHash,
        inputsHash: claim.inputsHash,
        outputsHash: claim.outputsHash,
        bindingHash: claim.bindingHash,
      },
      null,
      2,
    ),
  );

  client.close();
}

main().catch((err) => {
  console.error("lane-a-smoke failed:", err);
  process.exit(1);
});
