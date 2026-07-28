/**
 * pay.ts — settle the x402 payment leg (Lane B), per the Hedera exact scheme
 * (verify-log V-1): a plain native TransferTransaction from the payer's
 * funding account to the published payTo. The terms arrive as DATA — resolved
 * upstream from the 402 challenge or config.witness.json — and the signature
 * accepts only a PayerContext, so no operator identity can answer this
 * payer-path question (the Lane B payTo bug, closed at the type level).
 *
 * Two settlement modes:
 *   facilitator — the conformant wire flow: partially signed (fee payer
 *     open), base64-encoded, POSTed to the facilitator's /settle.
 *   direct — the payer self-sponsors the same conformant transfer.
 */

import { AccountId, Hbar, TransactionId, TransferTransaction } from "@hashgraph/sdk";
import type { PayerContext } from "./contexts.js";
import { hashscanTx } from "./plumbing.js";

export interface PaymentTerms {
  scheme: string;
  network: string;
  amount: string; // tinybar, as a string
  asset: string;
  payTo: string;
}

export interface SettlementOutcome {
  mode: "facilitator (fee-payer sponsored)" | "direct (self-sponsored settlement — no facilitator configured)";
  requirements: PaymentTerms & { memo: string };
  receipt: Record<string, unknown>;
}

export async function settleVendPayment(
  ctx: PayerContext,
  opts: { terms: PaymentTerms; memo: string; facilitatorUrl?: string | null },
): Promise<SettlementOutcome> {
  const amountTinybar = Number(opts.terms.amount);
  const requirements = { ...opts.terms, memo: opts.memo };

  if (opts.facilitatorUrl) {
    // Conformant wire flow: partially signed, fee payer open, facilitator settles.
    const frozen = new TransferTransaction()
      .addHbarTransfer(ctx.payerId, Hbar.fromTinybars(-amountTinybar))
      .addHbarTransfer(opts.terms.payTo, Hbar.fromTinybars(amountTinybar))
      .setTransactionMemo(opts.memo)
      .setTransactionId(TransactionId.generate(ctx.payerId))
      .setNodeAccountIds([new AccountId(3)])
      .freeze();
    const signed = await frozen.sign(ctx.payerKey);
    const paymentB64 = Buffer.from(signed.toBytes()).toString("base64");
    const resp = await fetch(`${opts.facilitatorUrl.replace(/\/$/, "")}/settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ x402Version: 1, paymentRequirements: requirements, transaction: paymentB64 }),
    });
    if (!resp.ok) {
      throw new Error(`Facilitator /settle returned HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
    }
    const receipt = (await resp.json()) as Record<string, unknown>;
    return { mode: "facilitator (fee-payer sponsored)", requirements, receipt };
  }

  // Direct mode: self-sponsored settlement of the same conformant transfer.
  const tx = await new TransferTransaction()
    .addHbarTransfer(ctx.payerId, Hbar.fromTinybars(-amountTinybar))
    .addHbarTransfer(opts.terms.payTo, Hbar.fromTinybars(amountTinybar))
    .setTransactionMemo(opts.memo)
    .execute(ctx.client);
  const record = await tx.getRecord(ctx.client);
  const transactionId = tx.transactionId.toString();
  const consensusTimestamp = `${record.consensusTimestamp.seconds}.${record.consensusTimestamp.nanos
    .toString()
    .padStart(9, "0")}`;
  return {
    mode: "direct (self-sponsored settlement — no facilitator configured)",
    requirements,
    receipt: { transactionId, consensusTimestamp, hashscan: hashscanTx(transactionId) },
  };
}
