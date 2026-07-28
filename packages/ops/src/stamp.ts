/**
 * stamp.ts — the witness itself, one engine for both lanes.
 *
 * Lane A: the signer pays the HBAR fee; HIP-991 charges it AS the message
 *   records — payment and testimony are the same consensus event (W-1).
 * Lane B: the signer pays 1 wKEY, which flows to the treasury-in-code and
 *   is burned on the watcher's cadence (D-3).
 *
 * The signer is always the testifier (W-2): a customer payer, a newborn, or
 * ORG stamping its own floor test (disclosed fee-exempt). Max-custom-fee
 * protection is set from the published peg — a re-peg cannot ambush anyone.
 */

import { CustomFeeLimit, CustomFixedFee, Hbar, TokenId, TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { canonicalizeJSON } from "../../core/src/morpheme.js";
import { getNetworkConfig, getSphereConfig, getWitnessConfig } from "../../core/src/config.js";
import { buildWhiteTraceClaim, buildStampForClaim, type WhiteTraceDomain } from "../../core/src/claims.js";
import type { StatusValue } from "../../core/src/schema.js";
import { signerOf, type TestimonyContext } from "./contexts.js";
import { hashscanTx } from "./plumbing.js";
import { PEG } from "./peg.js";

export type WitnessLane = "A" | "B";

export interface StampOutcome {
  lane: WitnessLane;
  topicId: string;
  signerAccountId: string;
  claim: Awaited<ReturnType<typeof buildWhiteTraceClaim>>;
  stamp: ReturnType<typeof buildStampForClaim>;
  consensusTimestamp: string;
  transactionId: string;
  hashscan: string;
  /** submit → record round-trip; mirror visibility lags this by V-7's 3–7s. */
  latencyMs: number;
}

export async function stampLane(
  ctx: TestimonyContext,
  opts: { lane: WitnessLane; domain: WhiteTraceDomain; status?: StatusValue; statusNote?: string },
): Promise<StampOutcome> {
  const net = getNetworkConfig();
  const sphere = getSphereConfig();
  const witness = getWitnessConfig();
  const { accountId: signerId } = signerOf(ctx);

  let topicId: string;
  let feeLimitFee: CustomFixedFee;
  if (opts.lane === "A") {
    if (!witness.hbarTopicId) throw new Error("WITNESS_HBAR_TOPIC_ID not configured.");
    topicId = witness.hbarTopicId;
    // Cap at 2× the published fee: honors the price list, tolerates nothing more.
    feeLimitFee = new CustomFixedFee().setHbarAmount(Hbar.fromTinybars(PEG.laneA.feeTinybar * 2));
  } else {
    if (!witness.keyTopicId || !witness.keyTokenId) throw new Error("Lane B topic/token not configured.");
    topicId = witness.keyTopicId;
    feeLimitFee = new CustomFixedFee()
      .setAmount(PEG.laneB.feeKey)
      .setDenominatingTokenId(TokenId.fromString(witness.keyTokenId));
  }

  // Build the claim fresh from the live taxonomy (W-9 gate) and wrap it.
  const claim = await buildWhiteTraceClaim({
    domain: opts.domain,
    registryTopicId: sphere.ruleRegistryTopicId,
    proofTopicId: sphere.proofTopicId,
    resolve: { mirrorNodeUrl: net.mirrorNodeUrl },
  });
  const stamp = buildStampForClaim({
    claim,
    callerAccountId: signerId,
    createdAt: new Date().toISOString(),
    status: opts.status,
    statusNote: opts.statusNote,
  });

  const feeLimit = new CustomFeeLimit().setAccountId(signerId).setFees([feeLimitFee]);
  const submitted = Date.now();
  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(topicId)
    .setMessage(Buffer.from(canonicalizeJSON(stamp), "utf8"))
    .setCustomFeeLimits([feeLimit])
    .execute(ctx.client);
  const record = await tx.getRecord(ctx.client);
  const latencyMs = Date.now() - submitted;
  const consensusTimestamp = `${record.consensusTimestamp.seconds}.${record.consensusTimestamp.nanos
    .toString()
    .padStart(9, "0")}`;
  const transactionId = tx.transactionId.toString();

  return {
    lane: opts.lane,
    topicId,
    signerAccountId: signerId,
    claim,
    stamp,
    consensusTimestamp,
    transactionId,
    hashscan: hashscanTx(transactionId),
    latencyMs,
  };
}
