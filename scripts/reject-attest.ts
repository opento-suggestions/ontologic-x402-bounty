/**
 * reject-attest.ts — operator-only lazy attestation (spec §3.4, D-6/D-7;
 * rewritten for the authority layer, PHASE_2 §5).
 *
 * Usage: npx tsx scripts/reject-attest.ts <topicId> <sequenceNumber>
 *
 * Still lazy, still manual, still ORG-initiated: no daemon watches the
 * topics; nothing auto-emits; a rejection becomes durable only when
 * summoned. Still judges at read time exactly as any reader would, and
 * still refuses to attest about non-lane subjects.
 *
 * What changed (Phase 2b):
 *   - The verdict is a FULL MORPHEME (v0.2): R = the conformance rule in the
 *     Witness Rule Registry, I = the subject's derivations, O = verdict +
 *     reason codes, bindingHash through the same seam as every proof.
 *   - It carries mandateHash in M and writes to the VERDICT TOPIC, not the
 *     subject's lane — judgment does not live behind the open door (§8b).
 *   - It REFUSES to run if its own mandate does not currently resolve
 *     in-window: ORG cannot render an out-of-mandate verdict by accident.
 *   - The Verdict Topic carries no fee: verdicts are near-free for ORG now.
 *     D-6 is not reopened — laziness was always the discipline, not the fee
 *     (declared in LIMITATIONS.md).
 */

import { TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { canonicalizeJSON } from "../packages/core/src/morpheme.js";
import { getAuthorityConfig, getNetworkConfig, getWitnessConfig } from "../packages/core/src/config.js";
import { judgeMessage, checkMandateWindow } from "../packages/core/src/verify.js";
import { reasonText } from "../packages/core/src/reasons.js";
import { buildRejectionAttestationV2 } from "../packages/core/src/schema.js";
import { resolveMandate, resolveRule } from "../packages/core/src/resolve.js";
import type { MirrorMessage } from "../packages/core/src/mirror.js";
import { appendEvidence, awaitMirrorMessage, consensusString, hashscanTx, openOperatorClient } from "./lib/ops.js";

const CONFORMANCE_RULE_ID = "witness://org/verdict/lane-conformance";

async function main() {
  const [topicId, seqArg] = process.argv.slice(2);
  if (!topicId || !seqArg) {
    console.error("Usage: npx tsx scripts/reject-attest.ts <topicId> <sequenceNumber>");
    process.exit(1);
  }

  // Kill-switch first, as everywhere: openOperatorClient runs assertTestnet
  // before anything — including the mirror reads below — touches a network.
  const { client, operatorId } = openOperatorClient();
  const net = getNetworkConfig();
  const witness = getWitnessConfig();
  const auth = getAuthorityConfig();
  if (topicId !== witness.hbarTopicId && topicId !== witness.keyTopicId) {
    throw new Error(`${topicId} is not a witness lane topic — refusing to attest about foreign topics.`);
  }
  if (!auth.witnessRulesTopicId || !auth.verdictTopicId || !auth.mandateHash) {
    throw new Error(
      "Authority layer not provisioned (WITNESS_RULES_TOPIC / WITNESS_VERDICT_TOPIC / WITNESS_MANDATE_HASH). " +
        "The ceremony (§3) runs first — a verdict without a mandate is exactly what W-11 forbids.",
    );
  }
  const anchors = {
    witnessRegistryTopicId: auth.witnessRulesTopicId,
    verdictTopicId: auth.verdictTopicId,
    firstMandateTimestamp: auth.firstMandateTimestamp,
  };

  // 0. The mandate gate: refuse to render unless OUR OWN grant currently
  // resolves in-window. Same resolver every reader runs — if this fails,
  // the verdict would judge out-of-mandate, so it is never rendered.
  const resolved = await resolveMandate(auth.mandateHash, auth.witnessRulesTopicId, { mirrorNodeUrl: net.mirrorNodeUrl });
  if (!resolved) {
    throw new Error(`Own mandate ${auth.mandateHash} does not resolve on the registry. Refusing to render (W-11).`);
  }
  const nowTs = Math.floor(Date.now() / 1000).toString();
  if (!checkMandateWindow(resolved.mandate, resolved.revocationConsensusTimestamp, nowTs)) {
    throw new Error(
      resolved.revocationConsensusTimestamp
        ? `Own mandate was revoked at ${resolved.revocationConsensusTimestamp}. Refusing to render (W-11).`
        : `Own mandate window [${resolved.mandate.notBefore}, ${resolved.mandate.notAfter}) does not cover now (~${nowTs}). Refusing to render (W-11).`,
    );
  }
  console.log(`Mandate ${auth.mandateHash.slice(0, 18)}… resolves in-window ✓`);

  // 1. Judge the attempt at read time, exactly as any reader would.
  const resp = await fetch(`${net.mirrorNodeUrl}/topics/${topicId}/messages/${seqArg}`);
  if (!resp.ok) throw new Error(`No message at ${topicId} seq ${seqArg} (mirror ${resp.status})`);
  const msg = (await resp.json()) as MirrorMessage;
  const verdict = await judgeMessage(msg, topicId, { mirrorNodeUrl: net.mirrorNodeUrl, ...anchors });

  if (verdict.kind !== "invalid") {
    console.log(`Message at seq ${seqArg} judged '${verdict.kind}' — nothing to attest.`);
    console.log("(Successful stamps ARE their own verdict; only failed attempts get attestations.)");
    client.close();
    return;
  }
  // Codes are the wire format; the display text is a local lookup (W-10).
  const display = verdict.reasons.map((c) => `${c} (${reasonText(c)})`).join("; ");
  console.log(`Attempt at seq ${seqArg} judged invalid: ${display}`);

  // 2. The conformance rule is the verdict's R — resolved fresh from the
  // registry, never cached (same discipline as the stamp path's claims).
  const { ruleDef, ruleUri } = await resolveRule(CONFORMANCE_RULE_ID, auth.witnessRulesTopicId, {
    mirrorNodeUrl: net.mirrorNodeUrl,
  });
  if (typeof ruleDef.domain !== "string" || !ruleDef.domain.startsWith("witness.")) {
    throw new Error(`Conformance rule resolved with domain ${ruleDef.domain} — not a witness.* rule. Refusing.`);
  }

  // 3. Build the bounded fail-write — a real morpheme, derivations + codes only.
  const attestation = buildRejectionAttestationV2({
    ruleId: ruleDef.ruleId,
    ruleUri,
    subjectTopicId: topicId,
    subjectConsensusTimestamp: verdict.consensusTimestamp,
    subjectSequenceNumber: verdict.sequenceNumber,
    subjectMessageHash: verdict.messageHash,
    reasons: verdict.reasons,
    mandateHash: auth.mandateHash,
    operatorAccountId: operatorId,
    createdAt: new Date().toISOString(),
  });

  // 4. Stamp it to the VERDICT TOPIC (operator submit key; no custom fee).
  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(auth.verdictTopicId)
    .setMessage(Buffer.from(canonicalizeJSON(attestation), "utf8"))
    .execute(client);
  const record = await tx.getRecord(client);
  const consensus = consensusString(record);
  const link = hashscanTx(tx.transactionId.toString());
  console.log(`Rejection attestation (v0.2 morpheme) stamped to the Verdict Topic at ${consensus}`);
  console.log(`  bindingHash: ${attestation.bindingHash}`);
  console.log(`  tx: ${link}`);

  // 5. Read-back: OUR OWN verdict must survive the full W-11 chain from
  // public mirror data alone — the same judge every reader runs.
  const own = await awaitMirrorMessage(net.mirrorNodeUrl, auth.verdictTopicId, consensus);
  const ownVerdict = await judgeMessage(own, auth.verdictTopicId, { mirrorNodeUrl: net.mirrorNodeUrl, ...anchors });
  if (ownVerdict.kind !== "rejection") {
    throw new Error(
      `Read-back FAILED: our attestation judges '${ownVerdict.kind}' (${ownVerdict.reasons.join(", ")}). It is on-chain and immutable — investigate and disclose.`,
    );
  }
  console.log("  read-back ✓ — the verdict passes Peirce + split + Floridi + the W-11 chain, keyless");

  appendEvidence(
    `rejection attestation (mandated, v0.2) for ${topicId} seq ${seqArg}: ${verdict.reasons.join("; ")}`,
    consensus,
    link,
  ); // evidence carries the codes — same wire format as the attestation itself
  console.log("The wall renders the ATTESTATION — the attempt itself still gets no tile (W-10).");
  client.close();
}

main().catch((err) => {
  console.error("reject-attest failed:", err);
  process.exit(1);
});
