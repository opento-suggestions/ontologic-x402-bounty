/**
 * redeem.ts — ORG-side delivery: honor a settled x402 receipt with vend().
 *
 * Usage: npx tsx scripts/redeem.ts [--alias 0x...] [--watch]
 *
 * Scans the treasury's recent incoming transfers on mirror REST for
 * x402:witness-required:vend:<alias> memos at the published vending price,
 * and for each unredeemed one executes vend(alias) — genesis + 1 wKEY in one
 * atomic contract call. Redemption is idempotent by construction: an alias
 * whose account already holds wKEY is skipped.
 *
 * This is the ONE ORG-signed action on the delivery path, and it signs no
 * payer testimony (W-2). --watch polls every 5s (demo mode).
 */

import { ContractExecuteTransaction, ContractFunctionParameters, Hbar } from "@hashgraph/sdk";
import { getNetworkConfig, getWitnessConfig } from "../packages/core/src/config.js";
import { appendEvidence, hashscanEntity, hashscanTx, openOperatorClient } from "./lib/ops.js";
import { PEG } from "./peg.js";

const MEMO_PREFIX = "x402:witness-required:vend:";
// Enough for the newborn's own stamp (network fee ~0.75 HBAR at the testnet
// rate + the 0.01 custom fee) with headroom; testnet HBAR is tight.
const FUND_HBAR = 3;

interface MirrorTx {
  memo_base64?: string;
  result: string;
  transfers?: { account: string; amount: number }[];
  transaction_id: string;
}

async function findSettledVends(mirrorUrl: string, treasury: string): Promise<{ alias: string; txId: string }[]> {
  const amount = Math.round((PEG.vending.priceUsd / PEG.hbarUsd) * 1e8);
  const resp = await fetch(
    `${mirrorUrl}/transactions?account.id=${treasury}&transactiontype=cryptotransfer&order=desc&limit=50`,
  );
  if (!resp.ok) throw new Error(`Mirror ${resp.status}`);
  const data = (await resp.json()) as { transactions?: MirrorTx[] };
  const found: { alias: string; txId: string }[] = [];
  for (const tx of data.transactions ?? []) {
    if (tx.result !== "SUCCESS" || !tx.memo_base64) continue;
    const memo = Buffer.from(tx.memo_base64, "base64").toString("utf8");
    if (!memo.startsWith(MEMO_PREFIX)) continue;
    const credited = tx.transfers?.some((t) => t.account === treasury && t.amount >= amount);
    if (!credited) continue;
    found.push({ alias: memo.slice(MEMO_PREFIX.length), txId: tx.transaction_id });
  }
  return found;
}

async function alreadyRedeemed(mirrorUrl: string, alias: string, keyTokenId: string): Promise<boolean> {
  const resp = await fetch(`${mirrorUrl}/accounts/${alias}`);
  if (!resp.ok) return false;
  const account = (await resp.json()) as { balance: { tokens: { token_id: string; balance: number }[] } };
  return (account.balance.tokens.find((t) => t.token_id === keyTokenId)?.balance ?? 0) >= 1;
}

async function main() {
  const args = process.argv.slice(2);
  const watch = args.includes("--watch");
  const aliasIdx = args.indexOf("--alias");
  const onlyAlias = aliasIdx !== -1 ? args[aliasIdx + 1]?.toLowerCase() : null;

  const { client, operatorId } = openOperatorClient();
  const net = getNetworkConfig();
  const witness = getWitnessConfig();
  if (!witness.vendingContractId || !witness.keyTokenId) {
    throw new Error("Need VENDING_CONTRACT_ID and WITNESS_KEY_TOKEN_ID in .env");
  }

  const pass = async () => {
    const settled = await findSettledVends(net.mirrorNodeUrl, operatorId);
    for (const { alias, txId } of settled) {
      if (onlyAlias && alias.toLowerCase() !== onlyAlias) continue;
      if (await alreadyRedeemed(net.mirrorNodeUrl, alias, witness.keyTokenId!)) continue;

      console.log(`Redeeming receipt ${txId} → vend(${alias})...`);
      const vendTx = await new ContractExecuteTransaction()
        .setContractId(witness.vendingContractId!)
        .setFunction("vend", new ContractFunctionParameters().addAddress(alias))
        .setGas(3_000_000)
        .setPayableAmount(new Hbar(FUND_HBAR))
        .execute(client);
      await vendTx.getReceipt(client);
      const link = hashscanTx(vendTx.transactionId.toString());
      console.log(`  delivered: ${link}`);
      appendEvidence(`redeem: settled x402 receipt ${txId} → vend(${alias})`, alias, link);
    }
    return settled.length;
  };

  if (watch) {
    console.log("Redemption watcher running (5s poll, Ctrl+C to stop)...");
    for (;;) {
      try {
        await pass();
      } catch (err) {
        console.error("pass failed:", (err as Error).message);
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  } else {
    const n = await pass();
    console.log(`Done. ${n} settled vend receipt(s) scanned.`);
    client.close();
  }
}

main().catch((err) => {
  console.error("redeem failed:", err);
  process.exit(1);
});
