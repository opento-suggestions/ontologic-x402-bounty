/**
 * verify.ts — the keyless re-check (demo beat 4), as a thin adapter over
 * the ops engine's verifyStampOnMirror — the same judgeMessage the wall and
 * reject-attest use. No key, no ORG endpoint; public mirror REST only.
 */

import { getNetworkConfig, getWitnessConfig } from "../../../core/src/config.js";
import { verifyStampOnMirror } from "../../../ops/src/verify.js";
import { ok, fail, type ToolResult } from "../channels.js";

export async function handleVerify(consensusTimestamp: string, lane?: string): Promise<ToolResult> {
  const net = getNetworkConfig();
  const witness = getWitnessConfig();

  const topics = (
    lane === "A" ? [witness.hbarTopicId] : lane === "B" ? [witness.keyTopicId] : [witness.hbarTopicId, witness.keyTopicId]
  ).filter((t): t is string => !!t);
  if (topics.length === 0) return fail("Lane topics not configured.");

  const verified = await verifyStampOnMirror(topics, consensusTimestamp, { mirrorNodeUrl: net.mirrorNodeUrl });
  if (!verified) {
    return fail(`No message at consensus timestamp ${consensusTimestamp} on the witness topics.`);
  }
  const { topicId, verdict } = verified;
  return ok(
    {
      verdict: verdict.kind,
      reasons: verdict.reasons,
      topicId,
      lane: topicId === witness.hbarTopicId ? "A (HBAR-denominated testimony)" : "B (KEY-denominated testimony)",
      payerAccountId: verdict.payerAccountId,
      bindingHash: verdict.proof?.bindingHash ?? null,
      statusProfile: verdict.statusProfile ?? null,
      hashscan: `https://hashscan.io/testnet/topic/${topicId}`,
      note: "verified keyless from public mirror REST — no trust in ORG required",
    },
    verdict as unknown as Record<string, unknown>,
  );
}
