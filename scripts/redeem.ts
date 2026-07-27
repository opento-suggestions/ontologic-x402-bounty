/**
 * redeem.ts — ORG-side delivery: honor a settled x402 receipt with vend().
 *
 * Usage: npx tsx scripts/redeem.ts [--alias 0x...] [--watch]
 *
 * Scans the treasury's recent incoming transfers on mirror REST for
 * x402:witness-required:vend:<alias> memos at the published vending price,
 * and executes vend(alias) — genesis + 1 wKEY in one atomic contract call —
 * for every receipt not yet matched by a delivery.
 *
 * Idempotency is COUNT-based, by public state: deliveries-ever (the
 * contract's outgoing wKEY transfers to the alias's account) vs
 * receipts-ever (paid memos for that alias). The original balance-based
 * check ("alias holds wKEY → skip") double-delivered the moment a customer
 * SPENT their wKEY — every later pass re-vended the historical receipt
 * (observed live 2026-07-27: three unbacked mints; see verify-log). Counting
 * nets receipts against deliveries, so repeat purchases redeem correctly and
 * nothing ever delivers twice. If the receipt window undercounts (old
 * receipts beyond the scan), the error direction is skip, never over-vend.
 *
 * Each pass ends by executing D-3's sink: any wKEY the Lane B fees have
 * collected into the treasury-in-code is burned (burnCollected). The burn
 * cannot be atomic with a stamp — a stamp is a TopicMessageSubmit, no
 * contract runs — so the watcher IS the burn cadence: vend and burn live in
 * the same custody and the same operational loop. (Phase 1's burn was
 * lane-b-smoke step 6; this folds it into the standing process.)
 *
 * This is the ONE ORG-signed action on the delivery path, and it signs no
 * payer testimony (W-2). --watch polls every 5s (demo mode); --dry-run
 * prints decisions without executing.
 */

import { ContractExecuteTransaction, ContractFunctionParameters, Hbar } from "@hashgraph/sdk";
import { getNetworkConfig, getWitnessConfig } from "../packages/core/src/config.js";
import { appendEvidence, hashscanTx, openOperatorClient } from "./lib/ops.js";
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
  const found: { alias: string; txId: string }[] = [];
  // Paginate a few pages so receipt COUNTS stay accurate as history grows.
  // An undercounted receipt (beyond the window) can only cause a skip.
  let url: string | null = `${mirrorUrl}/transactions?account.id=${treasury}&transactiontype=cryptotransfer&order=desc&limit=100`;
  for (let page = 0; url && page < 5; page++) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Mirror ${resp.status}`);
    const data = (await resp.json()) as { transactions?: MirrorTx[]; links?: { next?: string | null } };
    for (const tx of data.transactions ?? []) {
      if (tx.result !== "SUCCESS" || !tx.memo_base64) continue;
      const memo = Buffer.from(tx.memo_base64, "base64").toString("utf8");
      if (!memo.startsWith(MEMO_PREFIX)) continue;
      const credited = tx.transfers?.some((t) => t.account === treasury && t.amount >= amount);
      if (!credited) continue;
      found.push({ alias: memo.slice(MEMO_PREFIX.length).toLowerCase(), txId: tx.transaction_id });
    }
    url = data.links?.next ? `${mirrorUrl.replace(/\/api\/v1$/, "")}${data.links.next}` : null;
  }
  return found;
}

interface ContractTx {
  name: string;
  token_transfers?: { token_id: string; account: string; amount: number }[];
}

/** Deliveries-ever, from the contract's own transfer history: account → count of 1-wKEY sends. */
async function deliveryCounts(mirrorUrl: string, contractId: string, keyTokenId: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  let url: string | null = `${mirrorUrl}/transactions?account.id=${contractId}&order=desc&limit=100`;
  for (let page = 0; url && page < 10; page++) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Mirror ${resp.status}`);
    const data = (await resp.json()) as { transactions?: ContractTx[]; links?: { next?: string | null } };
    for (const tx of data.transactions ?? []) {
      const outbound = (tx.token_transfers ?? []).filter(
        (t) => t.token_id === keyTokenId && t.account !== contractId && t.amount > 0,
      );
      const treasurySent = (tx.token_transfers ?? []).some(
        (t) => t.token_id === keyTokenId && t.account === contractId && t.amount < 0,
      );
      if (!treasurySent) continue; // mints and fee inflows are not deliveries
      for (const t of outbound) counts.set(t.account, (counts.get(t.account) ?? 0) + 1);
    }
    url = data.links?.next ? `${mirrorUrl.replace(/\/api\/v1$/, "")}${data.links.next}` : null;
  }
  return counts;
}

/** alias (EVM address) → account id, or null if the account does not exist yet. */
async function aliasToAccount(mirrorUrl: string, alias: string): Promise<string | null> {
  const resp = await fetch(`${mirrorUrl}/accounts/${alias}`);
  if (!resp.ok) return null;
  const account = (await resp.json()) as { account?: string };
  return account.account ?? null;
}

/** Collected Lane B fees sitting in the treasury-in-code, per mirror. */
async function collectedBalance(mirrorUrl: string, tokenId: string, contractId: string): Promise<number> {
  const resp = await fetch(`${mirrorUrl}/tokens/${tokenId}/balances?account.id=${contractId}`);
  if (!resp.ok) throw new Error(`Mirror ${resp.status} for token balances`);
  const data = (await resp.json()) as { balances: { account: string; balance: number }[] };
  return data.balances.find((b) => b.account === contractId)?.balance ?? 0;
}

async function main() {
  const args = process.argv.slice(2);
  const watch = args.includes("--watch");
  const dryRun = args.includes("--dry-run");
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
    const delivered = await deliveryCounts(net.mirrorNodeUrl, witness.vendingContractId!, witness.keyTokenId!);

    // Receipts per alias, oldest-first, netted against deliveries-ever.
    const byAlias = new Map<string, { txId: string }[]>();
    for (const { alias, txId } of settled.reverse()) {
      if (onlyAlias && alias !== onlyAlias) continue;
      const list = byAlias.get(alias) ?? [];
      list.push({ txId });
      byAlias.set(alias, list);
    }

    for (const [alias, receipts] of byAlias) {
      const account = await aliasToAccount(net.mirrorNodeUrl, alias);
      const already = account ? (delivered.get(account) ?? 0) : 0;
      const owed = receipts.length - already;
      if (owed <= 0) {
        console.log(`${alias}: ${receipts.length} receipt(s), ${already} delivery(ies) — nothing owed.`);
        continue;
      }
      for (const { txId } of receipts.slice(-owed)) {
        if (dryRun) {
          console.log(`[dry-run] would redeem receipt ${txId} → vend(${alias})`);
          continue;
        }
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
    }

    // D-3's sink, every pass: burn whatever the fees have collected. Mirror
    // lag may hide a seconds-old fee — the next pass catches it.
    const collected = await collectedBalance(net.mirrorNodeUrl, witness.keyTokenId!, witness.vendingContractId!);
    if (collected > 0) {
      if (dryRun) {
        console.log(`[dry-run] would burnCollected(${collected}) — consumed KEY exits supply (D-3)`);
      } else {
        console.log(`burnCollected(${collected}) — consumed KEY exits supply (D-3)...`);
        const burnTx = await new ContractExecuteTransaction()
          .setContractId(witness.vendingContractId!)
          .setFunction("burnCollected", new ContractFunctionParameters().addInt64(collected))
          .setGas(400_000)
          .execute(client);
        await burnTx.getReceipt(client);
        const burnLink = hashscanTx(burnTx.transactionId.toString());
        console.log(`  burned: ${burnLink}`);
        appendEvidence(`burnCollected(${collected}) — Lane B fee sink executed (D-3)`, witness.keyTokenId!, burnLink);
      }
    }
    return settled.length;
  };

  if (watch) {
    console.log("Redemption watcher running (5s poll) — press q (or Ctrl+C) to stop gracefully...");

    // Graceful stop: never kill a pass mid-flight — a vend or burn in progress
    // completes, THEN the loop exits and the client closes.
    let stopping = false;
    const requestStop = (why: string) => {
      if (stopping) return;
      stopping = true;
      console.log(`\nStopping after the current pass (${why})...`);
    };
    if (process.stdin.isTTY) process.stdin.setRawMode(true); // raw: q works without Enter; Ctrl+C arrives as \u0003, not SIGINT
    process.stdin.resume();
    process.stdin.on("data", (buf: Buffer) => {
      const key = buf.toString("utf8");
      if (key.toLowerCase().includes("q")) requestStop("q pressed");
      else if (key.includes("\u0003")) requestStop("Ctrl+C");
    });
    process.on("SIGINT", () => requestStop("SIGINT"));
    process.on("SIGTERM", () => requestStop("SIGTERM"));

    while (!stopping) {
      try {
        await pass();
      } catch (err) {
        console.error("pass failed:", (err as Error).message);
      }
      // Sleep in short slices so a stop request is honored promptly.
      for (let i = 0; i < 10 && !stopping; i++) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    client.close();
    console.log("Watcher stopped cleanly.");
  } else {
    const n = await pass();
    console.log(`Done. ${n} settled vend receipt(s) scanned. (Use --watch to keep the watcher open.)`);
    client.close();
  }
}

main().catch((err) => {
  console.error("redeem failed:", err);
  process.exit(1);
});
