/**
 * stamp-lane-a.ts — one paid Lane A stamp, signed by YOUR payer account.
 *
 * The fresh-clone path (W-5's open door, exercised by a stranger): build a
 * WHITE trace claim against the live taxonomy, submit it to the Lane A topic,
 * and let HIP-991 charge the published 0.01 HBAR fee atomically with the
 * message — payment and testimony as one consensus event (W-1).
 *
 * Needs exactly two env values a visitor fills themselves: PAYER_ID and
 * PAYER_DER_KEY (a funded TESTNET account — free at portal.hedera.com).
 * Refuses ORG identities: an operator-signed stamp is exempt from its own
 * fee (a silently fake paid flow), and no ORG key belongs in a payer seat.
 *
 * Thin entry over the same engine every other frontend drives:
 * packages/ops/src/stamp.ts (stampLane) + verify.ts (verifyStampOnMirror).
 *
 *   npx tsx scripts/stamp-lane-a.ts [light|paint]
 */

import { getNetworkConfig, isPlaceholder } from "../packages/core/src/config.js";
import type { WhiteTraceDomain } from "../packages/core/src/claims.js";
import { openPayerContext } from "../packages/ops/src/customer.js";
import { stampLane } from "../packages/ops/src/stamp.js";
import { verifyStampOnMirror } from "../packages/ops/src/verify.js";
import { appendEvidence, hashscanTx } from "../packages/ops/src/plumbing.js";

function missing(v: string | undefined): boolean {
  return !v || isPlaceholder(v);
}

async function main() {
  const domainArg = (process.argv[2] ?? "light") as WhiteTraceDomain;

  const payerId = process.env.PAYER_ID;
  const payerKey = process.env.PAYER_DER_KEY;
  if (missing(payerId) || missing(payerKey)) {
    throw new Error(
      "Fill PAYER_ID and PAYER_DER_KEY in .env with YOUR OWN funded testnet account (free at portal.hedera.com). Everything else is pre-filled public coordinates.",
    );
  }
  for (const [name, value] of [["OPERATOR_ID", process.env.OPERATOR_ID], ["ROOT_ID", process.env.ROOT_ID]] as const) {
    if (!missing(value) && value === payerId) {
      throw new Error(`PAYER_ID equals ${name}. The payer must be a non-ORG account (W-2; and the fee collector is exempt from its own fees, which would fake the paid flow).`);
    }
  }

  console.log(`1. Building WHITE trace claim (${domainArg}) + submitting to Lane A...`);
  console.log("   HIP-991 charges the published fee AS the message records.");
  const ctx = openPayerContext({ id: payerId!, derKey: payerKey! });
  const stamped = await stampLane(ctx, { lane: "A", domain: domainArg });
  console.log(`   bindingHash: ${stamped.claim.bindingHash} (your tile derives from this and nothing else)`);
  console.log(`   consensus: ${stamped.consensusTimestamp}`);
  console.log(`   tx: ${stamped.hashscan}`);

  console.log("\n2. Keyless verification off the public mirror (no trust in ORG required)...");
  const net = getNetworkConfig();
  const verified = await verifyStampOnMirror([stamped.topicId], stamped.consensusTimestamp, {
    mirrorNodeUrl: net.mirrorNodeUrl,
    tries: 20,
  });
  if (!verified) throw new Error("Stamp not mirror-visible after 40s — check HashScan via the tx link above.");
  if (verified.verdict.kind !== "valid") {
    throw new Error(`Stamp judged '${verified.verdict.kind}' (${verified.verdict.reasons.join(", ")})`);
  }
  console.log("   verdict: valid ✓");
  console.log(`   assessed fee visible on HashScan; payer = ${payerId} (network-witnessed)`);

  appendEvidence(
    `Lane A stamp by payer ${payerId} (${domainArg} domain, fresh-clone path)`,
    stamped.consensusTimestamp,
    hashscanTx(stamped.transactionId),
  );
  console.log("\nYour tile: https://ontologic.dev/wall (duplicates of an existing claim collapse into its ×N badge)");
  ctx.client.close();
}

main().catch((err) => {
  console.error("stamp-lane-a failed:", err);
  process.exit(1);
});
