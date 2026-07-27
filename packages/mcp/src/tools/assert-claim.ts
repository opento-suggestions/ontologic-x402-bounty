/**
 * assert-claim.ts — the agent asserts a reasoning claim (demo beat 1).
 *
 * W-9 lives in @witness/core: only WHITE traces over the live taxonomy
 * construct; everything else throws before any network write is possible.
 * Invalid claims never submit — they never even exist.
 */

import { getNetworkConfig, getSphereConfig } from "../../../core/src/config.js";
import { buildWhiteTraceClaim, allowedClaims, describeClaim, type WhiteTraceDomain } from "../../../core/src/claims.js";
import { ok, fail, type ToolResult } from "../channels.js";

export async function handleAssertClaim(domain: string): Promise<ToolResult> {
  const net = getNetworkConfig();
  const sphere = getSphereConfig();
  try {
    const claim = await buildWhiteTraceClaim({
      domain: domain as WhiteTraceDomain,
      registryTopicId: sphere.ruleRegistryTopicId,
      proofTopicId: sphere.proofTopicId,
      resolve: { mirrorNodeUrl: net.mirrorNodeUrl },
    });
    return ok(
      {
        claimConstructed: true,
        domain: claim.domain,
        // Echoed so a mismatch between the user's color-model language and
        // the chosen domain is visible BEFORE anything is paid or stamped.
        claimIdentity: describeClaim(claim.domain),
        ruleId: claim.ruleId,
        ruleUri: claim.ruleUri,
        bindingHash: claim.bindingHash,
        next: "confirm claimIdentity matches what the user meant, then witness_requirements → pay (Lane B) or stamp directly (Lane A, native)",
      },
      { claim: claim as unknown as Record<string, unknown> },
    );
  } catch (err) {
    return fail((err as Error).message, { allowedClaims: allowedClaims() });
  }
}
