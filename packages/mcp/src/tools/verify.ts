/**
 * verify.ts — the keyless re-check (demo beat 4).
 *
 * Everything here reads public mirror REST; no key, no ORG endpoint. The same
 * judgeMessage the wall and reject-attest use — one verifier, three callers.
 */

import { getNetworkConfig, getWitnessConfig } from "../../../core/src/config.js";
import { judgeMessage } from "../../../core/src/verify.js";
import type { MirrorMessage } from "../../../core/src/mirror.js";
import { ok, fail, type ToolResult } from "../channels.js";

export async function handleVerify(consensusTimestamp: string, lane?: string): Promise<ToolResult> {
  const net = getNetworkConfig();
  const witness = getWitnessConfig();

  const topics = (
    lane === "A" ? [witness.hbarTopicId] : lane === "B" ? [witness.keyTopicId] : [witness.hbarTopicId, witness.keyTopicId]
  ).filter((t): t is string => !!t);
  if (topics.length === 0) return fail("Lane topics not configured.");

  // Mirror propagation runs ~3–7s behind consensus (V-7) — poll with patience.
  for (let attempt = 0; attempt < 10; attempt++) {
    for (const topicId of topics) {
      const resp = await fetch(`${net.mirrorNodeUrl}/topics/${topicId}/messages?timestamp=${consensusTimestamp}`);
      if (!resp.ok) continue;
      const data = (await resp.json()) as { messages?: MirrorMessage[] };
      const msg = data.messages?.[0];
      // The timestamp query is >= — accept only the exact consensus instant.
      if (!msg || msg.consensus_timestamp !== consensusTimestamp) continue;

      const verdict = await judgeMessage(msg, topicId, { mirrorNodeUrl: net.mirrorNodeUrl });
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
    await new Promise((r) => setTimeout(r, 2000));
  }
  return fail(`No message at consensus timestamp ${consensusTimestamp} on the witness topics.`);
}
