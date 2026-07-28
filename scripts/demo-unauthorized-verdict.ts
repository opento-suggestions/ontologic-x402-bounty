/**
 * demo-unauthorized-verdict.ts — PHASE_2 §10's negative-space demonstration.
 *
 * ⚠ This script exists to demonstrate DETECTION, and for no other purpose.
 * It deliberately writes exactly ONE well-formed v0.2 rejection attestation
 * that cites a REVOKED mandate, then judges its own message keyless and
 * asserts the verifier condemns it: `invalid` + `mandate.out-of-window`.
 *
 * This is the property W-11 exists to make demonstrable: a compromised (or,
 * here, deliberately misbehaving) operator key can still write to the
 * Verdict Topic — the network's submit key cannot know about mandates — but
 * every reader's verifier detects the write as unauthorized, machine-checked
 * from public topic messages alone. The artifact is permanent, counted on
 * the wall's ledger line as "unauthorized", and never renders as judgment.
 *
 * Guards: refuses to run unless the cited mandate IS revoked (this script
 * must never be the thing that renders a verdict that would pass), and
 * refuses if an unauthorized demo artifact already exists on the Verdict
 * Topic (exactly one, ever).
 *
 *   npx tsx scripts/demo-unauthorized-verdict.ts <subjectTopicId> <sequenceNumber>
 */

import { TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { canonicalizeJSON } from "../packages/core/src/morpheme.js";
import { getAuthorityConfig, getNetworkConfig, getWitnessConfig } from "../packages/core/src/config.js";
import { judgeMessage } from "../packages/core/src/verify.js";
import { buildRejectionAttestationV2 } from "../packages/core/src/schema.js";
import { resolveMandate, resolveRule } from "../packages/core/src/resolve.js";
import { fetchAllTopicMessages, type MirrorMessage } from "../packages/core/src/mirror.js";
import { appendEvidence, waitForMirror, consensusString, hashscanTx, openOperatorContext } from "../packages/ops/src/index.js";

const CONFORMANCE_RULE_ID = "witness://org/verdict/lane-conformance";

async function main() {
  const [topicId, seqArg] = process.argv.slice(2);
  if (!topicId || !seqArg) {
    console.error("Usage: npx tsx scripts/demo-unauthorized-verdict.ts <subjectTopicId> <sequenceNumber>");
    process.exit(1);
  }

  const { client, operatorId } = openOperatorContext();
  const net = getNetworkConfig();
  const witness = getWitnessConfig();
  const auth = getAuthorityConfig();
  if (topicId !== witness.hbarTopicId && topicId !== witness.keyTopicId) {
    throw new Error(`${topicId} is not a witness lane topic — refusing.`);
  }
  if (!auth.witnessRulesTopicId || !auth.verdictTopicId || !auth.mandateHash) {
    throw new Error("Authority layer not provisioned — nothing to demonstrate against.");
  }

  // Guard 1 — the cited mandate MUST be revoked. This script demonstrates an
  // unauthorized write; it must never be capable of an authorized one.
  const resolved = await resolveMandate(auth.mandateHash, auth.witnessRulesTopicId, { mirrorNodeUrl: net.mirrorNodeUrl });
  if (!resolved) throw new Error(`${auth.mandateHash} does not resolve — refusing.`);
  if (!resolved.revocationConsensusTimestamp) {
    throw new Error(`Mandate ${auth.mandateHash} is NOT revoked. This script only writes verdicts the verifier will condemn. Refusing.`);
  }
  console.log(`Cited mandate is revoked (at ${resolved.revocationConsensusTimestamp}) ✓ — the verdict below MUST judge out-of-mandate.`);

  // Guard 2 — exactly one demo artifact, ever.
  const existing = await fetchAllTopicMessages(net.mirrorNodeUrl, auth.verdictTopicId);
  for (const msg of existing) {
    const v = await judgeMessage(msg, auth.verdictTopicId, { mirrorNodeUrl: net.mirrorNodeUrl, skipRuleResolution: true });
    if (v.kind === "invalid" && v.reasons.some((r) => r.startsWith("mandate."))) {
      throw new Error(`An unauthorized demo artifact already exists (seq ${v.sequenceNumber}). One is the demonstration; two is litter. Refusing.`);
    }
  }

  // Judge the subject exactly as reject-attest would.
  const resp = await fetch(`${net.mirrorNodeUrl}/topics/${topicId}/messages/${seqArg}`);
  if (!resp.ok) throw new Error(`No message at ${topicId} seq ${seqArg} (mirror ${resp.status})`);
  const subject = (await resp.json()) as MirrorMessage;
  const subjectVerdict = await judgeMessage(subject, topicId, { mirrorNodeUrl: net.mirrorNodeUrl });
  if (subjectVerdict.kind !== "invalid") {
    throw new Error(`Subject judged '${subjectVerdict.kind}' — even a demo artifact only ever judges genuinely invalid attempts.`);
  }

  const { ruleDef, ruleUri } = await resolveRule(CONFORMANCE_RULE_ID, auth.witnessRulesTopicId, { mirrorNodeUrl: net.mirrorNodeUrl });
  if (typeof ruleDef.domain !== "string" || !ruleDef.domain.startsWith("witness.")) {
    throw new Error(`Conformance rule resolved with domain ${ruleDef.domain} — refusing.`);
  }
  const attestation = buildRejectionAttestationV2({
    ruleId: ruleDef.ruleId,
    ruleUri,
    subjectTopicId: topicId,
    subjectConsensusTimestamp: subjectVerdict.consensusTimestamp,
    subjectSequenceNumber: subjectVerdict.sequenceNumber,
    subjectMessageHash: subjectVerdict.messageHash,
    reasons: subjectVerdict.reasons,
    mandateHash: auth.mandateHash, // the REVOKED grant — the whole point
    operatorAccountId: operatorId,
    createdAt: new Date().toISOString(),
  });

  console.log("Stamping ONE deliberately out-of-mandate verdict (the detection demo)...");
  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(auth.verdictTopicId)
    .setMessage(Buffer.from(canonicalizeJSON(attestation), "utf8"))
    .execute(client);
  const record = await tx.getRecord(client);
  const consensus = consensusString(record);
  const link = hashscanTx(tx.transactionId.toString());
  console.log(`  stamped @ ${consensus}`);
  console.log(`  tx: ${link}`);

  // The demonstration: every reader's verifier condemns it, keyless.
  const own = await waitForMirror(net.mirrorNodeUrl, auth.verdictTopicId, consensus);
  const verdict = await judgeMessage(own, auth.verdictTopicId, { mirrorNodeUrl: net.mirrorNodeUrl });
  console.log(`  verifier says: kind=${verdict.kind} reasons=[${verdict.reasons.join(", ")}]`);
  if (verdict.kind !== "invalid" || !verdict.reasons.includes("mandate.out-of-window")) {
    throw new Error(
      `DEMONSTRATION FAILED: expected invalid + mandate.out-of-window, got '${verdict.kind}' [${verdict.reasons.join(", ")}]. ` +
        `The artifact is on-chain and immutable — investigate and disclose.`,
    );
  }
  console.log("  ✓ condemned: invalid + mandate.out-of-window — W-11 detection demonstrated on the live record.");
  appendEvidence(
    `DEMO: deliberate post-revocation verdict (cites revoked ${auth.mandateHash.slice(0, 18)}…) judged out-of-mandate by the keyless verifier`,
    consensus,
    link,
  );
  client.close();
}

main().catch((err) => {
  console.error("demo-unauthorized-verdict failed:", err);
  process.exit(1);
});
