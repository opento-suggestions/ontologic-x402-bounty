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
 *   npx tsx scripts/stamp-lane-a.ts [light|paint]
 */

import { Client, CustomFeeLimit, CustomFixedFee, Hbar, PrivateKey, TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { canonicalizeJSON } from "../packages/core/src/morpheme.js";
import { assertTestnet, getNetworkConfig, getSphereConfig, getWitnessConfig } from "../packages/core/src/config.js";
import { buildWhiteTraceClaim, buildStampForClaim, type WhiteTraceDomain } from "../packages/core/src/claims.js";
import { judgeMessage } from "../packages/core/src/verify.js";
import type { MirrorMessage } from "../packages/core/src/mirror.js";
import { appendEvidence, hashscanTx } from "./lib/ops.js";
import { PEG } from "./peg.js";

function isPlaceholder(v: string | undefined): boolean {
  return !v || v.startsWith("<") || v.includes("XXXX");
}

async function main() {
  const domainArg = (process.argv[2] ?? "light") as WhiteTraceDomain;
  assertTestnet();

  const payerId = process.env.PAYER_ID;
  const payerKey = process.env.PAYER_DER_KEY;
  if (isPlaceholder(payerId) || isPlaceholder(payerKey)) {
    throw new Error(
      "Fill PAYER_ID and PAYER_DER_KEY in .env with YOUR OWN funded testnet account (free at portal.hedera.com). Everything else is pre-filled public coordinates.",
    );
  }
  for (const [name, value] of [["OPERATOR_ID", process.env.OPERATOR_ID], ["ROOT_ID", process.env.ROOT_ID]] as const) {
    if (!isPlaceholder(value) && value === payerId) {
      throw new Error(`PAYER_ID equals ${name}. The payer must be a non-ORG account (W-2; and the fee collector is exempt from its own fees, which would fake the paid flow).`);
    }
  }

  const net = getNetworkConfig();
  const sphere = getSphereConfig();
  const witness = getWitnessConfig();
  if (!witness.hbarTopicId) throw new Error("WITNESS_HBAR_TOPIC_ID not set — copy .env.example freshly.");

  console.log(`1. Building WHITE trace claim (${domainArg}) against the live taxonomy...`);
  const claim = await buildWhiteTraceClaim({
    domain: domainArg,
    registryTopicId: sphere.ruleRegistryTopicId,
    proofTopicId: sphere.proofTopicId,
    resolve: { mirrorNodeUrl: net.mirrorNodeUrl },
  });
  console.log(`   bindingHash: ${claim.bindingHash} (your tile derives from this and nothing else)`);

  const stamp = buildStampForClaim({ claim, callerAccountId: payerId!, createdAt: new Date().toISOString() });

  console.log("\n2. Submitting to Lane A — HIP-991 charges the published fee AS the message records...");
  const client = Client.forTestnet().setOperator(payerId!, PrivateKey.fromStringDer(payerKey!));
  client.setDefaultMaxTransactionFee(new Hbar(50));
  // Cap at 2× the published fee: honors the price list, tolerates nothing more.
  const feeLimit = new CustomFeeLimit()
    .setAccountId(payerId!)
    .setFees([new CustomFixedFee().setHbarAmount(Hbar.fromTinybars(PEG.laneA.feeTinybar * 2))]);
  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(witness.hbarTopicId)
    .setMessage(Buffer.from(canonicalizeJSON(stamp), "utf8"))
    .setCustomFeeLimits([feeLimit])
    .execute(client);
  const record = await tx.getRecord(client);
  const consensus = `${record.consensusTimestamp.seconds}.${record.consensusTimestamp.nanos.toString().padStart(9, "0")}`;
  console.log(`   consensus: ${consensus}`);
  console.log(`   tx: ${hashscanTx(tx.transactionId.toString())}`);

  console.log("\n3. Keyless verification off the public mirror (no trust in ORG required)...");
  const url = `${net.mirrorNodeUrl}/topics/${witness.hbarTopicId}/messages?timestamp=${consensus}`;
  let msg: MirrorMessage | null = null;
  for (let i = 0; i < 20 && !msg; i++) {
    const resp = await fetch(url);
    if (resp.ok) {
      const data = (await resp.json()) as { messages?: MirrorMessage[] };
      if (data.messages?.[0]?.consensus_timestamp === consensus) msg = data.messages[0];
    }
    if (!msg) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!msg) throw new Error("Stamp not mirror-visible after 40s — check HashScan via the tx link above.");
  const verdict = await judgeMessage(msg, witness.hbarTopicId, { mirrorNodeUrl: net.mirrorNodeUrl });
  if (verdict.kind !== "valid") throw new Error(`Stamp judged '${verdict.kind}' (${verdict.reasons.join(", ")})`);
  console.log("   verdict: valid ✓");
  console.log(`   assessed fee visible on HashScan; payer = ${payerId} (network-witnessed)`);

  appendEvidence(`Lane A stamp by payer ${payerId} (${domainArg} domain, fresh-clone path)`, consensus, hashscanTx(tx.transactionId.toString()));
  console.log("\nYour tile: https://ontologic.dev/wall (duplicates of an existing claim collapse into its ×N badge)");
  client.close();
}

main().catch((err) => {
  console.error("stamp-lane-a failed:", err);
  process.exit(1);
});
