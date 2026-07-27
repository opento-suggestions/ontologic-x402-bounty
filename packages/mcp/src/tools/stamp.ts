/**
 * stamp.ts — the witness itself.
 *
 * Lane A: the payer-agent signs one TopicMessageSubmitTransaction to the
 *   HBAR-fee topic. HIP-991 charges the published fee AS the message records:
 *   payment and testimony are the same transaction (W-1).
 * Lane B: the NEWBORN signs its own stamp to the KEY-fee topic, paying
 *   1 wKEY, which flows to the treasury-in-code and is burned (D-3).
 *
 * Both lanes set max-custom-fee protection at exactly the published price ×2
 * (a re-peg cannot ambush the payer). The signer is always the testifier —
 * no ORG key is in this process (W-2).
 */

import {
  Client,
  CustomFeeLimit,
  CustomFixedFee,
  Hbar,
  PrivateKey,
  TokenId,
  TopicMessageSubmitTransaction,
} from "@hashgraph/sdk";
import { canonicalizeJSON } from "../../../core/src/morpheme.js";
import { getNetworkConfig, getSphereConfig, getWitnessConfig } from "../../../core/src/config.js";
import { buildWhiteTraceClaim, buildStampForClaim, describeClaim, type WhiteTraceDomain } from "../../../core/src/claims.js";
import type { StatusValue } from "../../../core/src/schema.js";
import { getPayerConfig } from "../env.js";
import { latestNewborn, newbornKey } from "../state/keystore.js";
import { ok, fail, type ToolResult } from "../channels.js";
import { PEG } from "../../../../scripts/peg.js";

function hashscanTx(txId: string): string {
  return `https://hashscan.io/testnet/transaction/${txId.replace("@", "-").replace(/\.(\d+)$/, "-$1")}`;
}

export async function handleStamp(
  lane: string,
  domain: string,
  status?: string,
  statusNote?: string,
): Promise<ToolResult> {
  const net = getNetworkConfig();
  const sphere = getSphereConfig();
  const witness = getWitnessConfig();

  let client: Client | null = null;
  try {
    // Who testifies, and on which topic.
    let signerId: string;
    let signerKey: PrivateKey;
    let topicId: string;
    let feeLimitFee: CustomFixedFee;

    if (lane === "A") {
      if (!witness.hbarTopicId) return fail("WITNESS_HBAR_TOPIC_ID not configured.");
      const payer = getPayerConfig();
      signerId = payer.id;
      signerKey = PrivateKey.fromStringDer(payer.derKey);
      topicId = witness.hbarTopicId;
      feeLimitFee = new CustomFixedFee().setHbarAmount(Hbar.fromTinybars(PEG.laneA.feeTinybar * 2));
    } else if (lane === "B") {
      if (!witness.keyTopicId || !witness.keyTokenId) return fail("Lane B topic/token not configured.");
      const newborn = latestNewborn();
      if (!newborn?.accountId) {
        return fail("Newborn has no account yet. witness_pay → witness_redeem_status first.");
      }
      signerId = newborn.accountId;
      signerKey = newbornKey(newborn.alias);
      topicId = witness.keyTopicId;
      feeLimitFee = new CustomFixedFee()
        .setAmount(PEG.laneB.feeKey)
        .setDenominatingTokenId(TokenId.fromString(witness.keyTokenId));
    } else {
      return fail(`Unknown lane: ${lane}. Lanes are "A" (native HBAR) and "B" (premium KEY).`);
    }

    // Build the claim fresh from the live taxonomy (W-9 gate) and wrap it.
    const claim = await buildWhiteTraceClaim({
      domain: domain as WhiteTraceDomain,
      registryTopicId: sphere.ruleRegistryTopicId,
      proofTopicId: sphere.proofTopicId,
      resolve: { mirrorNodeUrl: net.mirrorNodeUrl },
    });
    const stamp = buildStampForClaim({
      claim,
      callerAccountId: signerId,
      createdAt: new Date().toISOString(),
      status: status as StatusValue | undefined,
      statusNote,
    });

    client = Client.forTestnet().setOperator(signerId, signerKey);
    client.setDefaultMaxTransactionFee(new Hbar(10));
    const feeLimit = new CustomFeeLimit().setAccountId(signerId).setFees([feeLimitFee]);
    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(topicId)
      .setMessage(Buffer.from(canonicalizeJSON(stamp), "utf8"))
      .setCustomFeeLimits([feeLimit])
      .execute(client);
    const record = await tx.getRecord(client);
    const consensus = `${record.consensusTimestamp.seconds}.${record.consensusTimestamp.nanos
      .toString()
      .padStart(9, "0")}`;
    const txId = tx.transactionId.toString();

    return ok(
      {
        stamped: true,
        lane,
        claimIdentity: describeClaim(claim.domain),
        signer: signerId,
        topicId,
        consensusTimestamp: consensus,
        bindingHash: claim.bindingHash,
        hashscan: hashscanTx(txId),
        next: `witness_verify consensusTimestamp=${consensus} lane=${lane} — anyone can re-check this keylessly`,
      },
      { stamp: stamp as unknown as Record<string, unknown>, transactionId: txId },
    );
  } catch (err) {
    return fail(`Stamp failed: ${(err as Error).message}`);
  } finally {
    client?.close();
  }
}
