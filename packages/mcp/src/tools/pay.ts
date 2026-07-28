/**
 * pay.ts — the x402 payment leg (Lane B), as a thin adapter.
 *
 * Terms (payTo, amount, asset) are CONSUMED from the 402 challenge
 * witness_requirements fetched — refetched if older than the challenge's own
 * maxTimeoutSeconds — falling back to config.witness.json for offline
 * operation (payment-terms.ts). Settlement is the ops engine's
 * settleVendPayment, whose signature accepts only a PayerContext: the
 * operator's environment cannot answer this payer-path question, at compile
 * time and at runtime.
 *
 * Either mode returns the SETTLED TRANSFER as the payment receipt
 * (mirror-verifiable). Delivery (genesis + 1 wKEY) is ORG's vend — a
 * redeemable right against this receipt, checked with witness_redeem_status.
 */

import { openPayerContext } from "../../../ops/src/customer.js";
import { settleVendPayment } from "../../../ops/src/pay.js";
import { resolvePaymentTerms, type ResolvedTerms } from "../payment-terms.js";
import { getPayerConfig } from "../env.js";
import { latestNewborn, latestChallenge, recordChallenge } from "../state/keystore.js";
import { ok, fail, type ToolResult } from "../channels.js";

export async function handlePay(aliasArg?: string): Promise<ToolResult> {
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

  const memo = `x402:witness-required:vend:${alias}`;
  try {
    const ctx = openPayerContext(getPayerConfig());
    try {
      const settled = await settleVendPayment(ctx, {
        terms: resolved.terms,
        memo,
        facilitatorUrl: process.env.FACILITATOR_URL ?? null,
      });
      return ok(
        {
          settled: true,
          mode: settled.mode,
          paymentTermsSource: resolved.source,
          requirements: settled.requirements,
          receipt: settled.receipt,
          next: "witness_redeem_status — ORG's vend redeems this receipt into genesis + 1 wKEY",
        },
        { requirements: settled.requirements, receipt: settled.receipt },
      );
    } finally {
      ctx.client.close();
    }
  } catch (err) {
    return fail(`Payment failed to settle: ${(err as Error).message}`, {
      requirements: { ...resolved.terms, memo },
    });
  }
}
