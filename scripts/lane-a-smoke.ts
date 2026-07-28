/**
 * lane-a-smoke.ts — Lane A end to end: one paid stamp (the demo floor).
 *
 * ORG's floor test: the operator stamps its OWN testimony (disclosed
 * fee-exempt — the collector is exempt from its own HIP-991 fee), measures
 * submit→mirror latency (V-7), verifies keyless, and prints the golden-vector
 * block for test/golden.test.ts. Thin entry over the same engine the
 * fresh-clone path and the MCP plugin drive: packages/ops stampLane +
 * verifyStampOnMirror.
 */

import { getNetworkConfig } from "../packages/core/src/config.js";
import { openOperatorContext } from "../packages/ops/src/operator.js";
import { stampLane } from "../packages/ops/src/stamp.js";
import { verifyStampOnMirror } from "../packages/ops/src/verify.js";
import { appendEvidence, hashscanEntity } from "../packages/ops/src/plumbing.js";

async function main() {
  const ctx = openOperatorContext();
  const net = getNetworkConfig();

  console.log("1. Building WHITE trace claim (light) + submitting to Lane A with max-custom-fee protection...");
  const submitted = Date.now();
  const stamped = await stampLane(ctx, { lane: "A", domain: "light" });
  console.log(`   ruleUri:     ${stamped.claim.ruleUri}`);
  console.log(`   bindingHash: ${stamped.claim.bindingHash}`);
  console.log(`   consensus: ${stamped.consensusTimestamp}`);
  console.log(`   tx: ${stamped.hashscan}`);

  console.log("\n2. Waiting for mirror visibility (V-7 latency) + keyless verification...");
  const verified = await verifyStampOnMirror([stamped.topicId], stamped.consensusTimestamp, {
    mirrorNodeUrl: net.mirrorNodeUrl,
    tries: 30,
  });
  if (!verified) throw new Error("Stamp not visible on mirror after 60s");
  const latencyMs = Date.now() - submitted;
  console.log(`   visible + judged after ~${(latencyMs / 1000).toFixed(1)}s (submit→mirror)`);
  console.log(`   verdict: ${verified.verdict.kind}${verified.verdict.reasons.length ? " — " + verified.verdict.reasons.join("; ") : ""}`);
  if (verified.verdict.kind !== "valid") throw new Error("Smoke stamp did not verify VALID");

  appendEvidence(
    `Lane A stamp: WHITE trace (light), HIP-991 fee paid atomically, mirror latency ~${(latencyMs / 1000).toFixed(1)}s`,
    stamped.consensusTimestamp,
    stamped.hashscan,
  );
  appendEvidence("Lane A topic after smoke stamp", stamped.topicId, hashscanEntity("topic", stamped.topicId));

  console.log("\n3. Golden vector block (paste into packages/core/test/golden.test.ts):");
  console.log(
    JSON.stringify(
      {
        topicId: stamped.topicId,
        consensusTimestamp: stamped.consensusTimestamp,
        ruleUri: stamped.claim.ruleUri,
        ruleUriHash: stamped.claim.ruleUriHash,
        inputsHash: stamped.claim.inputsHash,
        outputsHash: stamped.claim.outputsHash,
        bindingHash: stamped.claim.bindingHash,
      },
      null,
      2,
    ),
  );

  ctx.client.close();
}

main().catch((err) => {
  console.error("lane-a-smoke failed:", err);
  process.exit(1);
});
