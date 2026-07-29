/**
 * associate-usdc.ts — one-time token association with Circle testnet USDC.
 *
 * ⚠ HUMAN GATE (CLAUDE.md) — an on-chain write, though a gentle one:
 * association is reversible while the balance is zero.
 *
 * The USDC settlement leg is a plain payer→treasury transfer, and Hedera
 * accounts cannot receive a token they are not associated with — so the
 * treasury association is the gate the whole leg waits on. Idempotent by
 * public state: already-associated accounts are reported, never re-sent.
 *
 *   npx tsx scripts/associate-usdc.ts            # treasury (operator-signed)
 *   npx tsx scripts/associate-usdc.ts --payer    # the test payer (payer-signed)
 */

import { TokenAssociateTransaction } from "@hashgraph/sdk";
import { getNetworkConfig, getWitnessConfig, isPlaceholder } from "../packages/core/src/config.js";
import { openOperatorContext } from "../packages/ops/src/operator.js";
import { openPayerContext } from "../packages/ops/src/customer.js";
import { appendEvidence, hashscanEntity, hashscanTx, sleep } from "../packages/ops/src/plumbing.js";

async function isAssociated(mirrorNodeUrl: string, accountId: string, tokenId: string): Promise<boolean> {
  const resp = await fetch(`${mirrorNodeUrl}/accounts/${accountId}/tokens?token.id=${tokenId}`);
  if (!resp.ok) return false;
  const data = (await resp.json()) as { tokens?: unknown[] };
  return (data.tokens?.length ?? 0) > 0;
}

async function main() {
  const payerMode = process.argv.includes("--payer");
  const net = getNetworkConfig();
  const usdc = getWitnessConfig().usdcTokenId;
  if (!usdc) throw new Error("USDC_TOKEN_ID not set in .env (Circle testnet USDC is 0.0.429274).");

  let client, accountId: string, label: string;
  if (payerMode) {
    const id = process.env.PAYER_ID;
    const derKey = process.env.PAYER_DER_KEY;
    if (!id || !derKey || isPlaceholder(id) || isPlaceholder(derKey)) {
      throw new Error("PAYER_ID / PAYER_DER_KEY not filled — the payer association is signed by the payer itself.");
    }
    const ctx = openPayerContext({ id, derKey });
    client = ctx.client;
    accountId = ctx.payerId;
    label = "test payer";
  } else {
    const ctx = openOperatorContext();
    client = ctx.client;
    accountId = ctx.operatorId;
    label = "treasury";
  }

  if (await isAssociated(net.mirrorNodeUrl, accountId, usdc)) {
    console.log(`${label} ${accountId} is already associated with USDC ${usdc} — nothing to do.`);
    client.close();
    return;
  }

  console.log(`Associating ${label} ${accountId} with USDC ${usdc}...`);
  const tx = await new TokenAssociateTransaction().setAccountId(accountId).setTokenIds([usdc]).execute(client);
  await tx.getReceipt(client);
  console.log(`  tx: ${hashscanTx(tx.transactionId.toString())}`);

  // Read-back: the association must be mirror-visible before the leg is called open.
  for (let i = 0; ; i++) {
    if (await isAssociated(net.mirrorNodeUrl, accountId, usdc)) break;
    if (i >= 9) throw new Error("Mirror never showed the association — check HashScan via the tx link above.");
    await sleep(2000);
  }
  console.log(`  mirror confirms: ${accountId} ↔ ${usdc}`);

  appendEvidence(
    `associate ${label} ${accountId} with Circle testnet USDC (opens the USDC settlement leg)`,
    accountId,
    hashscanEntity("account", accountId),
  );
  client.close();
}

main().catch((err) => {
  console.error("associate-usdc failed:", err);
  process.exit(1);
});
