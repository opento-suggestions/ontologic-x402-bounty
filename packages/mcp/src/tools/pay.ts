/**
 * pay.ts — the x402 payment leg (Lane B).
 *
 * Per the Hedera exact scheme (verify-log V-1): the payment is a plain native
 * TransferTransaction from the payer's funding account to the published
 * payTo. The terms (payTo, amount, asset) are CONSUMED from the 402 challenge
 * witness_requirements fetched — refetched if older than the challenge's own
 * maxTimeoutSeconds — falling back to config.witness.json for offline
 * operation. The operator's environment is never consulted: this process is
 * the payer, and a customer clone has no OPERATOR_ID.
 *
 * Two settlement modes:
 *
 *   facilitator (FACILITATOR_URL set) — the conformant wire flow: the payer
 *     PARTIALLY signs (fee payer left open), base64-encodes, and POSTs to the
 *     facilitator's /settle; the facilitator co-signs as fee payer and
 *     submits. The facilitator sponsors the network fee only — it cannot
 *     alter the transfer the payer signed.
 *
 *   direct (no facilitator) — the payer self-sponsors: signs fully and
 *     submits its own conformant transfer. Same PaymentRequirements, same
 *     settled-transfer receipt; disclosed as self-sponsored settlement.
 *
 * Either way the tool returns the SETTLED TRANSFER as the payment receipt
 * (mirror-verifiable). Delivery (genesis + 1 wKEY) is ORG's vend — a
 * redeemable right against this receipt, checked with witness_redeem_status.
 */

import {
  AccountId,
  Client,
  Hbar,
  PrivateKey,
  TransactionId,
  TransferTransaction,
} from "@hashgraph/sdk";
import { assertTestnet } from "../../../core/src/config.js";
import { resolvePaymentTerms, type ResolvedTerms } from "../payment-terms.js";
import { getPayerConfig } from "../env.js";
import { latestNewborn, latestChallenge, recordChallenge } from "../state/keystore.js";
import { hashscanTx } from "../hashscan.js";
import { ok, fail, type ToolResult } from "../channels.js";

export async function handlePay(aliasArg?: string): Promise<ToolResult> {
  try {
    assertTestnet();
  } catch (err) {
    return fail((err as Error).message);
  }
  const payer = getPayerConfig();

  const alias = aliasArg ?? latestNewborn()?.alias;
  if (!alias) {
    return fail("No testimony alias. Run witness_genesis first (Lane B pays FOR a genesis).");
  }

  let resolved: ResolvedTerms;
  try {
    resolved = await resolvePaymentTerms({ stored: latestChallenge() });
  } catch (err) {
    return fail((err as Error).message);
  }
  if (resolved.challenge) recordChallenge(resolved.challenge); // a refetch keeps the handoff current

  const treasury = resolved.terms.payTo;
  const amountTinybar = Number(resolved.terms.amount);
  const payerKey = PrivateKey.fromStringDer(payer.derKey);

  const requirements = {
    scheme: resolved.terms.scheme,
    network: resolved.terms.network,
    amount: resolved.terms.amount,
    asset: resolved.terms.asset,
    payTo: treasury,
    memo: `x402:witness-required:vend:${alias}`,
  };

  const facilitatorUrl = process.env.FACILITATOR_URL;
  try {
    if (facilitatorUrl) {
      // Conformant wire flow: partially signed, fee payer open, facilitator settles.
      const client = Client.forTestnet();
      const frozen = new TransferTransaction()
        .addHbarTransfer(payer.id, Hbar.fromTinybars(-amountTinybar))
        .addHbarTransfer(treasury, Hbar.fromTinybars(amountTinybar))
        .setTransactionMemo(requirements.memo)
        .setTransactionId(TransactionId.generate(payer.id))
        .setNodeAccountIds([new AccountId(3)])
        .freeze();
      const signed = await frozen.sign(payerKey);
      const paymentB64 = Buffer.from(signed.toBytes()).toString("base64");
      const resp = await fetch(`${facilitatorUrl.replace(/\/$/, "")}/settle`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ x402Version: 1, paymentRequirements: requirements, transaction: paymentB64 }),
      });
      client.close();
      if (!resp.ok) {
        return fail(`Facilitator /settle returned HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
      }
      const receipt = (await resp.json()) as Record<string, unknown>;
      return ok(
        {
          settled: true,
          mode: "facilitator (fee-payer sponsored)",
          paymentTermsSource: resolved.source,
          requirements,
          receipt,
          next: "witness_redeem_status — ORG's vend redeems this receipt into genesis + 1 wKEY",
        },
        { requirements, receipt },
      );
    }

    // Direct mode: self-sponsored settlement of the same conformant transfer.
    const client = Client.forTestnet().setOperator(payer.id, payerKey);
    client.setDefaultMaxTransactionFee(new Hbar(10));
    const tx = await new TransferTransaction()
      .addHbarTransfer(payer.id, Hbar.fromTinybars(-amountTinybar))
      .addHbarTransfer(treasury, Hbar.fromTinybars(amountTinybar))
      .setTransactionMemo(requirements.memo)
      .execute(client);
    const record = await tx.getRecord(client);
    client.close();
    const txId = tx.transactionId.toString();
    const consensus = `${record.consensusTimestamp.seconds}.${record.consensusTimestamp.nanos.toString().padStart(9, "0")}`;
    return ok(
      {
        settled: true,
        mode: "direct (self-sponsored settlement — no facilitator configured)",
        paymentTermsSource: resolved.source,
        requirements,
        receipt: { transactionId: txId, consensusTimestamp: consensus, hashscan: hashscanTx(txId) },
        next: "witness_redeem_status — ORG's vend redeems this receipt into genesis + 1 wKEY",
      },
      { requirements, receipt: { transactionId: txId, consensusTimestamp: consensus } },
    );
  } catch (err) {
    return fail(`Payment failed to settle: ${(err as Error).message}`, { requirements });
  }
}
