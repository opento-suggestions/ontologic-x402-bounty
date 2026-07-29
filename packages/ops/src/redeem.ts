/**
 * redeem.ts — ORG's vend-fulfillment service: honor settled x402 receipts
 * with vend(), then execute D-3's sink. Promoted from the original
 * scripts/redeem.ts body; the CLI (watch loop, flags) stays a thin frontend.
 *
 * Idempotency is COUNT-based, by public state: deliveries-ever (the
 * contract's outgoing wKEY transfers to the alias's account) vs
 * receipts-ever (paid memos for that alias). The original balance-based
 * check double-delivered the moment a customer SPENT their wKEY (observed
 * live 2026-07-27; see verify-log). Counting nets receipts against
 * deliveries, so repeat purchases redeem correctly and nothing ever
 * delivers twice. If the receipt window undercounts (old receipts beyond
 * the scan), the error direction is skip, never over-vend.
 *
 * One caveat learned live 2026-07-28: deliveries are counted against the
 * CURRENT contract, so a watcher's era is fixed at boot — retire all
 * watchers before rolling VENDING_CONTRACT_ID (see verify-log).
 *
 * This is the ONE ORG-signed action on the delivery path, and it signs no
 * payer testimony (W-2).
 */

import { ContractExecuteTransaction, ContractFunctionParameters, Hbar } from "@hashgraph/sdk";
import { getNetworkConfig, getWitnessConfig } from "../../core/src/config.js";
import type { OperatorContext } from "./contexts.js";
import { appendEvidence, hashscanTx } from "./plumbing.js";
import { PEG, vendPriceTinybarAt } from "./peg.js";

export const VEND_MEMO_PREFIX = "x402:witness-required:vend:";

export interface MirrorTx {
  consensus_timestamp: string;
  memo_base64?: string;
  result: string;
  transfers?: { account: string; amount: number }[];
  token_transfers?: { token_id: string; account: string; amount: number }[];
  transaction_id: string;
}

/**
 * A settled vend receipt: the vend memo plus the published price credited to
 * the treasury in EITHER leg. HBAR is judged at the price in force at the
 * receipt's OWN consensus instant (peg priceEras) — a reprice must not
 * orphan history, or the receipts-vs-deliveries netting would misread every
 * old receipt. USDC has a single era: the treasury's association
 * (2026-07-29) postdates the only reprice, so no USDC receipt can predate
 * the current price — if USDC is ever repriced, eras get added here under
 * the same never-orphan-history rule.
 */
export function vendReceiptFrom(tx: MirrorTx, treasury: string): { alias: string; txId: string } | null {
  if (tx.result !== "SUCCESS" || !tx.memo_base64) return null;
  const memo = Buffer.from(tx.memo_base64, "base64").toString("utf8");
  if (!memo.startsWith(VEND_MEMO_PREFIX)) return null;
  const hbarCredited = tx.transfers?.some(
    (t) => t.account === treasury && t.amount >= vendPriceTinybarAt(tx.consensus_timestamp),
  );
  const usdcCredited = tx.token_transfers?.some(
    (t) =>
      t.token_id === PEG.vending.usdcTokenId && t.account === treasury && t.amount >= PEG.vending.priceUsdcSmallest,
  );
  if (!hbarCredited && !usdcCredited) return null;
  return { alias: memo.slice(VEND_MEMO_PREFIX.length).toLowerCase(), txId: tx.transaction_id };
}

async function findSettledVends(mirrorUrl: string, treasury: string): Promise<{ alias: string; txId: string }[]> {
  const found: { alias: string; txId: string }[] = [];
  // Paginate a few pages so receipt COUNTS stay accurate as history grows.
  // An undercounted receipt (beyond the window) can only cause a skip.
  let url: string | null = `${mirrorUrl}/transactions?account.id=${treasury}&transactiontype=cryptotransfer&order=desc&limit=100`;
  for (let page = 0; url && page < 5; page++) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Mirror ${resp.status}`);
    const data = (await resp.json()) as { transactions?: MirrorTx[]; links?: { next?: string | null } };
    for (const tx of data.transactions ?? []) {
      const receipt = vendReceiptFrom(tx, treasury);
      if (receipt) found.push(receipt);
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

export interface RedeemPassResult {
  receiptsScanned: number;
  delivered: { alias: string; txId: string; link: string }[];
  burned: number;
}

/**
 * One full pass: scan settled receipts, net against deliveries-ever, vend
 * what is owed, then burn whatever the Lane B fees have collected into the
 * treasury-in-code (D-3's sink — the watcher IS the burn cadence).
 */
export async function redeemPass(
  ctx: OperatorContext,
  opts: { onlyAlias?: string | null; dryRun?: boolean } = {},
): Promise<RedeemPassResult> {
  const net = getNetworkConfig();
  const witness = getWitnessConfig();
  if (!witness.vendingContractId || !witness.keyTokenId) {
    throw new Error("Need VENDING_CONTRACT_ID and WITNESS_KEY_TOKEN_ID in .env");
  }

  const settled = await findSettledVends(net.mirrorNodeUrl, ctx.operatorId);
  const delivered = await deliveryCounts(net.mirrorNodeUrl, witness.vendingContractId, witness.keyTokenId);
  const outcome: RedeemPassResult = { receiptsScanned: settled.length, delivered: [], burned: 0 };

  // Receipts per alias, oldest-first, netted against deliveries-ever.
  const byAlias = new Map<string, { txId: string }[]>();
  for (const { alias, txId } of settled.reverse()) {
    if (opts.onlyAlias && alias !== opts.onlyAlias) continue;
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
      if (opts.dryRun) {
        console.log(`[dry-run] would redeem receipt ${txId} → vend(${alias})`);
        continue;
      }
      console.log(`Redeeming receipt ${txId} → vend(${alias})...`);
      const vendTx = await new ContractExecuteTransaction()
        .setContractId(witness.vendingContractId)
        .setFunction("vend", new ContractFunctionParameters().addAddress(alias))
        .setGas(3_000_000)
        // The delivery's principal — funded from the vending price, which
        // covers it since the 2026-07-27 reprice (see peg costUsdNotional).
        .setPayableAmount(new Hbar(PEG.vending.fundHbar))
        .execute(ctx.client);
      await vendTx.getReceipt(ctx.client);
      const link = hashscanTx(vendTx.transactionId.toString());
      console.log(`  delivered: ${link}`);
      appendEvidence(`redeem: settled x402 receipt ${txId} → vend(${alias})`, alias, link);
      outcome.delivered.push({ alias, txId, link });
    }
  }

  // D-3's sink, every pass: burn whatever the fees have collected. Mirror
  // lag may hide a seconds-old fee — the next pass catches it.
  const collected = await collectedBalance(net.mirrorNodeUrl, witness.keyTokenId, witness.vendingContractId);
  if (collected > 0) {
    if (opts.dryRun) {
      console.log(`[dry-run] would burnCollected(${collected}) — consumed KEY exits supply (D-3)`);
    } else {
      console.log(`burnCollected(${collected}) — consumed KEY exits supply (D-3)...`);
      const burnTx = await new ContractExecuteTransaction()
        .setContractId(witness.vendingContractId)
        .setFunction("burnCollected", new ContractFunctionParameters().addInt64(collected))
        .setGas(400_000)
        .execute(ctx.client);
      await burnTx.getReceipt(ctx.client);
      const burnLink = hashscanTx(burnTx.transactionId.toString());
      console.log(`  burned: ${burnLink}`);
      appendEvidence(`burnCollected(${collected}) — Lane B fee sink executed (D-3)`, witness.keyTokenId, burnLink);
      outcome.burned = collected;
    }
  }
  return outcome;
}
