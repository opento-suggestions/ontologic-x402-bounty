/**
 * requirements.ts — the Payment Required moment (demo beat 2, W-7).
 *
 * Fetches the published PaymentRequirements. Preference order:
 *   1. WITNESS_REQUIREMENTS_URL (a literal-402 gateway's body). The fetched
 *      challenge is persisted to the keystore so witness_pay consumes THESE
 *      terms — the client never invents its own.
 *   2. config.witness.json at the repo root — the deploy-time artifact
 *      emit-requirements writes from the peg, for offline operation.
 * The operator's environment is never consulted: this process is the payer.
 */

import { fetchGatewayChallenge, readWitnessConfig } from "../payment-terms.js";
import { recordChallenge } from "../state/keystore.js";
import { ok, fail, type ToolResult } from "../channels.js";

export async function handleRequirements(): Promise<ToolResult> {
  const url = process.env.WITNESS_REQUIREMENTS_URL;
  if (url) {
    try {
      const challenge = await fetchGatewayChallenge(url);
      recordChallenge(challenge);
      return ok(
        {
          paymentRequired: true,
          source: challenge.source,
          lanes: challenge.body.lanes ?? challenge.body,
        },
        challenge.body,
      );
    } catch (err) {
      return fail((err as Error).message);
    }
  }

  const cfg = readWitnessConfig();
  if (!cfg?.requirements) {
    return fail(
      "No gateway configured (WITNESS_REQUIREMENTS_URL) and config.witness.json was not found. " +
        "The repo ships this file; the operator regenerates it with npm run peg.",
    );
  }
  return ok(
    {
      paymentRequired: true,
      source: "config.witness.json (deploy-time artifact)",
      lanes: cfg.requirements.lanes,
      vending: cfg.requirements.vending,
    },
    cfg.requirements as Record<string, unknown>,
  );
}
