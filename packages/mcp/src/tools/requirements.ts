/**
 * requirements.ts — the Payment Required moment (demo beat 2, W-7).
 *
 * Fetches the published PaymentRequirements. Preference order:
 *   1. WITNESS_REQUIREMENTS_URL (the live orchestrator page's JSON — if a
 *      literal-402 gateway is configured it IS that gateway's 402 body)
 *   2. Local reconstruction from the same peg constants the topics charge —
 *      one price authority, so the published list cannot drift from the fees.
 */

import { getWitnessConfig, getOperatorConfig } from "../../../core/src/config.js";
import { buildPaymentRequirements } from "../../../../scripts/peg.js";
import { ok, fail, type ToolResult } from "../channels.js";

export async function handleRequirements(): Promise<ToolResult> {
  const url = process.env.WITNESS_REQUIREMENTS_URL;
  if (url) {
    try {
      const resp = await fetch(url);
      // A literal 402 response IS the x402 conformance surface — read its body.
      if (resp.status === 402 || resp.ok) {
        const body = (await resp.json()) as Record<string, unknown>;
        return ok(
          {
            paymentRequired: true,
            source: `${url} (HTTP ${resp.status})`,
            lanes: body.lanes ?? body,
          },
          body,
        );
      }
      return fail(`Requirements endpoint returned HTTP ${resp.status}`);
    } catch (err) {
      return fail(`Requirements endpoint unreachable: ${(err as Error).message}`);
    }
  }

  const witness = getWitnessConfig();
  if (!witness.hbarTopicId || !witness.keyTopicId) {
    return fail("Lane topics not configured (WITNESS_HBAR_TOPIC_ID / WITNESS_KEY_TOPIC_ID).");
  }
  // Treasury = ORG operator account (public coordinate, not a secret).
  const treasury = process.env.OPERATOR_ID ?? getOperatorConfig().id;
  const requirements = buildPaymentRequirements({
    hbarTopicId: witness.hbarTopicId,
    keyTopicId: witness.keyTopicId,
    keyTokenId: witness.keyTokenId,
    treasuryAccountId: treasury,
  });
  return ok(
    {
      paymentRequired: true,
      source: "local peg (single price authority)",
      lanes: requirements.lanes,
      vending: requirements.vending,
    },
    requirements as unknown as Record<string, unknown>,
  );
}
