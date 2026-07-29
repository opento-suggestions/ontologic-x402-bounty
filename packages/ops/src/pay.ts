/**
 * pay.ts — settle the x402 payment leg (Lane B), per the Hedera exact scheme
 * (verify-log V-1): a plain native TransferTransaction from the payer's
 * funding account to the published payTo — HBAR or the published token
 * (Circle testnet USDC), whichever accepts entry the resolved terms name.
 * The terms arrive as DATA — resolved upstream from the 402 challenge or
 * config.witness.json — and the signature accepts only a PayerContext, so no
 * operator identity can answer this payer-path question (the Lane B payTo
 * bug, closed at the type level).
 *
 * Two settlement modes:
 *   facilitator — the conformant wire flow: partially signed (fee payer
 *     open), base64-encoded, POSTed to the facilitator's /settle.
 *   direct — the payer self-sponsors the same conformant transfer.
 */

import { AccountId, Hbar, TokenId, TransactionId, TransferTransaction } from "@hashgraph/sdk";
import { getNetworkConfig } from "../../core/src/config.js";
import type { PayerContext } from "./contexts.js";
import { hashscanTx } from "./plumbing.js";
import { PEG } from "./peg.js";

export interface PaymentTerms {
  scheme: string;
  network: string;
  amount: string; // smallest unit of `asset` (tinybar for HBAR, 6-decimal units for USDC), as a string
  asset: string; // "0.0.0" = HBAR, otherwise an HTS token id
  payTo: string;
}

function formatUnits(units: number, asset: string): string {
  return asset === PEG.vending.usdcTokenId ? `${units / 1e6} USDC` : `${units} units of ${asset}`;
}

/**
 * Pre-flight for the token leg — the last member of the placeholder-validation
 * family: a missing association or a short balance dies HERE with a sentence,
 * not mid-settlement as a raw SDK status. A mirror hiccup does not block a
 * valid payment; the network stays the final judge.
 */
export async function assertTokenBalance(
  mirrorNodeUrl: string,
  payerId: string,
  terms: PaymentTerms,
): Promise<void> {
  let resp: Response;
  try {
    resp = await fetch(`${mirrorNodeUrl}/accounts/${payerId}/tokens?token.id=${terms.asset}`);
  } catch {
    return;
  }
  if (!resp.ok) return;
  const data = (await resp.json()) as { tokens?: { balance: number }[] };
  const faucet =
    terms.asset === PEG.vending.usdcTokenId
      ? ' Drip free Circle testnet USDC at faucet.circle.com — select "Hedera Testnet".'
      : "";
  const name = terms.asset === PEG.vending.usdcTokenId ? "USDC" : `token ${terms.asset}`;
  const held = data.tokens?.[0];
  if (!held) {
    throw new Error(
      `Payer ${payerId} holds no ${name} and is not associated with it.` +
        `${faucet} Holding the token implies the association the transfer needs.`,
    );
  }
  const amount = Number(terms.amount);
  if (held.balance < amount) {
    throw new Error(
      `Payer ${payerId} holds ${formatUnits(held.balance, terms.asset)} but the published terms require ` +
        `${formatUnits(amount, terms.asset)}.${faucet}`,
    );
  }
}

/** The conformant transfer, either leg: an HBAR pair, or the same pair in the
 * published token — the amount comes verbatim from the matched accepts entry,
 * never through the peg. */
function addSettlementTransfer(tx: TransferTransaction, terms: PaymentTerms, payerId: string): TransferTransaction {
  const amount = Number(terms.amount);
  if (terms.asset === "0.0.0") {
    return tx
      .addHbarTransfer(payerId, Hbar.fromTinybars(-amount))
      .addHbarTransfer(terms.payTo, Hbar.fromTinybars(amount));
  }
  const token = TokenId.fromString(terms.asset);
  return tx.addTokenTransfer(token, payerId, -amount).addTokenTransfer(token, terms.payTo, amount);
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
  if (opts.terms.asset !== "0.0.0") {
    await assertTokenBalance(getNetworkConfig().mirrorNodeUrl, ctx.payerId, opts.terms);
  }
  const requirements = { ...opts.terms, memo: opts.memo };

  if (opts.facilitatorUrl) {
    // Conformant wire flow: partially signed, fee payer open, facilitator settles.
    const frozen = addSettlementTransfer(new TransferTransaction(), opts.terms, ctx.payerId)
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
  const tx = await addSettlementTransfer(new TransferTransaction(), opts.terms, ctx.payerId)
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
