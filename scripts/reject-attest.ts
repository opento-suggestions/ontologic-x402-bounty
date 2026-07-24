/**
 * reject-attest.ts — operator-only lazy attestation (spec §3.4, D-6/D-7).
 *
 * Usage: npx tsx scripts/reject-attest.ts <topicId> <sequenceNumber>
 *
 * No daemon watches the topics; nothing auto-emits. A rejection becomes
 * durable only when summoned — manually, on ORG's initiative, at ORG's
 * expense (the attestation itself pays the lane's HIP-991 fee). This keeps
 * the spam economics pointed the right way: verdicts are free at read time;
 * durability is funded by the party who wants it durable.
 *
 * The attestation carries ONLY derivations of the attempt (topic, timestamp,
 * sequence, byte-hash, reasons) — never the attempt's payload (W-10). It is
 * the only ORG-signed testimony in the design (W-2's carve-out), and it can
 * slander an attempt, never forge a witness.
 */

import { CustomFeeLimit, CustomFixedFee, Hbar, TokenId, TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { canonicalizeJSON } from "../packages/core/src/morpheme.js";
import { getNetworkConfig, getWitnessConfig } from "../packages/core/src/config.js";
import { judgeMessage } from "../packages/core/src/verify.js";
import { reasonText } from "../packages/core/src/reasons.js";
import { buildRejectionAttestation } from "../packages/core/src/schema.js";
import type { MirrorMessage } from "../packages/core/src/mirror.js";
import { appendEvidence, hashscanTx, openOperatorClient } from "./lib/ops.js";
import { PEG } from "./peg.js";

async function main() {
  const [topicId, seqArg] = process.argv.slice(2);
  if (!topicId || !seqArg) {
    console.error("Usage: npx tsx scripts/reject-attest.ts <topicId> <sequenceNumber>");
    process.exit(1);
  }

  const { client, operatorId } = openOperatorClient();
  const net = getNetworkConfig();
  const witness = getWitnessConfig();
  if (topicId !== witness.hbarTopicId && topicId !== witness.keyTopicId) {
    throw new Error(`${topicId} is not a witness lane topic — refusing to attest about foreign topics.`);
  }

  // 1. Judge the attempt at read time, exactly as any reader would.
  const resp = await fetch(`${net.mirrorNodeUrl}/topics/${topicId}/messages/${seqArg}`);
  if (!resp.ok) throw new Error(`No message at ${topicId} seq ${seqArg} (mirror ${resp.status})`);
  const msg = (await resp.json()) as MirrorMessage;
  const verdict = await judgeMessage(msg, topicId, { mirrorNodeUrl: net.mirrorNodeUrl });

  if (verdict.kind !== "invalid") {
    console.log(`Message at seq ${seqArg} judged '${verdict.kind}' — nothing to attest.`);
    console.log("(Successful stamps ARE their own verdict; only failed attempts get attestations.)");
    client.close();
    return;
  }
  // Codes are the wire format; the display text is a local lookup (W-10).
  const display = verdict.reasons.map((c) => `${c} (${reasonText(c)})`).join("; ");
  console.log(`Attempt at seq ${seqArg} judged invalid: ${display}`);

  // 2. Build the bounded fail-write — derivations only, never the payload.
  const attestation = buildRejectionAttestation({
    subjectTopicId: topicId,
    subjectConsensusTimestamp: verdict.consensusTimestamp,
    subjectSequenceNumber: verdict.sequenceNumber,
    subjectMessageHash: verdict.messageHash,
    reasons: verdict.reasons,
    operatorAccountId: operatorId,
    createdAt: new Date().toISOString(),
  });

  // 3. Stamp it to the same topic, paying the lane's own published fee.
  const feeLimit = new CustomFeeLimit().setAccountId(operatorId).setFees([
    topicId === witness.hbarTopicId
      ? new CustomFixedFee().setHbarAmount(Hbar.fromTinybars(PEG.laneA.feeTinybar * 2))
      : new CustomFixedFee().setAmount(PEG.laneB.feeKey).setDenominatingTokenId(TokenId.fromString(witness.keyTokenId!)),
  ]);
  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(Buffer.from(canonicalizeJSON(attestation), "utf8"))
    .setCustomFeeLimits([feeLimit])
    .execute(client);
  const record = await tx.getRecord(client);
  const consensus = `${record.consensusTimestamp.seconds}.${record.consensusTimestamp.nanos.toString().padStart(9, "0")}`;
  const link = hashscanTx(tx.transactionId.toString());

  console.log(`Rejection attestation stamped at ${consensus}`);
  console.log(`  tx: ${link}`);
  appendEvidence(
    `rejection attestation (operator-summoned) for ${topicId} seq ${seqArg}: ${verdict.reasons.join("; ")}`,
    consensus,
    link,
  ); // evidence carries the codes — same wire format as the attestation itself
  console.log("The wall now renders the ATTESTATION — the attempt itself still gets no tile (W-10).");
  client.close();
}

main().catch((err) => {
  console.error("reject-attest failed:", err);
  process.exit(1);
});
