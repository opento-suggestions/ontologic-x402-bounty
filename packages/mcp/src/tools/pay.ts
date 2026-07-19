/**
 * pay.ts — the x402 payment leg (Lane B).
 *
 * Per the Hedera exact scheme (verify-log V-1): the payment is a plain native
 * TransferTransaction from the payer's funding account to the published
 * payTo. Two settlement modes:
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
import { getNetworkConfig, getWitnessConfig, getOperatorConfig } from "../../../core/src/config.js";
import { PEG } from "../../../../scripts/peg.js";
import { getPayerConfig } from "../env.js";
import { latestNewborn } from "../state/keystore.js";
import { ok, fail, type ToolResult } from "../channels.js";

function hashscanTx(txId: string): string {
  return `https://hashscan.io/testnet/transaction/${txId.replace("@", "-").replace(/\.(\d+)$/, "-$1")}`;
}

export async function handlePay(aliasArg?: string): Promise<ToolResult> {
  const net = getNetworkConfig();
  const witness = getWitnessConfig();
  const payer = getPayerConfig();

  const alias = aliasArg ?? latestNewborn()?.alias;
  if (!alias) {
    return fail("No testimony alias. Run witness_genesis first (Lane B pays FOR a genesis).");
  }

  const treasury = process.env.OPERATOR_ID ?? getOperatorConfig().id;
  const amountTinybar = Math.round((PEG.vending.priceUsd / PEG.hbarUsd) * 1e8); // $0.01 at the peg
  const payerKey = PrivateKey.fromStringDer(payer.derKey);

  const requirements = {
    scheme: "exact",
    network: "hedera:testnet",
    amount: String(amountTinybar),
    asset: "0.0.0",
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
