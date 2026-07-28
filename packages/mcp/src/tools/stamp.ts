/**
 * stamp.ts — the witness itself, as a thin adapter over the ops engine
 * (packages/ops/src/stamp.ts — the same stampLane every frontend drives).
 *
 * Lane A: the payer-agent signs; HIP-991 charges the published fee AS the
 *   message records (W-1). Lane B: the NEWBORN signs its own stamp, paying
 *   1 wKEY. The signer is always the testifier — no ORG key is in this
 *   process (W-2), and the context constructors bake in assertTestnet().
 */

import { openNewbornContext, openPayerContext } from "../../../ops/src/customer.js";
import { stampLane } from "../../../ops/src/stamp.js";
import type { TestimonyContext } from "../../../ops/src/contexts.js";
import { describeClaim, type WhiteTraceDomain } from "../../../core/src/claims.js";
import type { StatusValue } from "../../../core/src/schema.js";
import { getPayerConfig } from "../env.js";
import { latestNewborn } from "../state/keystore.js";
import { ok, fail, type ToolResult } from "../channels.js";

export async function handleStamp(
  lane: string,
  domain: string,
  status?: string,
  statusNote?: string,
): Promise<ToolResult> {
  let ctx: TestimonyContext | null = null;
  try {
    if (lane === "A") {
      ctx = openPayerContext(getPayerConfig());
    } else if (lane === "B") {
      const newborn = latestNewborn();
      if (!newborn?.accountId) {
        return fail("Newborn has no account yet. witness_pay → witness_redeem_status first.");
      }
      ctx = openNewbornContext({ accountId: newborn.accountId, alias: newborn.alias, derKey: newborn.derKey });
    } else {
      return fail(`Unknown lane: ${lane}. Lanes are "A" (native HBAR) and "B" (premium KEY).`);
    }

    const stamped = await stampLane(ctx, {
      lane,
      domain: domain as WhiteTraceDomain,
      status: status as StatusValue | undefined,
      statusNote,
    });

    return ok(
      {
        stamped: true,
        lane,
        claimIdentity: describeClaim(stamped.claim.domain),
        signer: stamped.signerAccountId,
        topicId: stamped.topicId,
        consensusTimestamp: stamped.consensusTimestamp,
        bindingHash: stamped.claim.bindingHash,
        hashscan: stamped.hashscan,
        next: `witness_verify consensusTimestamp=${stamped.consensusTimestamp} lane=${lane} — anyone can re-check this keylessly`,
      },
      { stamp: stamped.stamp as unknown as Record<string, unknown>, transactionId: stamped.transactionId },
    );
  } catch (err) {
    return fail(`Stamp failed: ${(err as Error).message}`);
  } finally {
    ctx?.client.close();
  }
}
