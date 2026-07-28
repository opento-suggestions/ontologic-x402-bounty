/**
 * probe-batch.ts — V-9: can a HIP-551 inner transaction be signed and
 * fee-paid by an account that an earlier inner transaction IN THE SAME BATCH
 * creates?
 *
 * The falsifier: the newborn's key exists client-side before the account does
 * (signature producible), but a TransactionId needs a payer account. Attempt A
 * uses the alias-form account ID as the inner payer. If the network rejects
 * it, Attempt B demonstrates the two-step fallback (transfer-to-alias creates
 * the account; the newborn then signs its own stamp) — the branch under which
 * W-1's asymmetric Lane B wording applies.
 *
 * Side quests answered on the way:
 *   V-3: auto-create funding via transfer-to-alias, and the child-record path
 *        to the newborn's account number.
 *   Fee assessment: the newborn is NOT the fee collector, so its Lane A stamp
 *        must show a non-empty assessed_custom_fees — the fee really flows.
 */

import {
  AccountId,
  BatchTransaction,
  Client,
  Hbar,
  PrivateKey,
  TransactionId,
  TransactionReceiptQuery,
  TransferTransaction,
  TopicMessageSubmitTransaction,
} from "@hashgraph/sdk";
import { getNetworkConfig, getWitnessConfig } from "../packages/core/src/config.js";
import { openOperatorContext, appendEvidence, hashscanTx, hashscanEntity } from "../packages/ops/src/index.js";

const FUND_HBAR = 5;

async function main() {
  const { client, operatorId, operatorKey } = openOperatorContext();
  const net = getNetworkConfig();
  const witness = getWitnessConfig();
  if (!witness.hbarTopicId) throw new Error("WITNESS_HBAR_TOPIC_ID not set — run create-topics first.");

  // The newborn: key generated client-side — theirs, never ours (W-2).
  const newbornKey = PrivateKey.generateECDSA();
  const newbornEvm = newbornKey.publicKey.toEvmAddress();
  const aliasId = AccountId.fromEvmAddress(0, 0, newbornEvm);
  console.log(`Newborn keypair generated. EVM alias: 0x${newbornEvm}`);

  const stampMessage = JSON.stringify({
    probe: "V-9",
    note: "newborn-inner-payer probe stamp (not a morpheme; verifier will judge invalid — that is correct)",
  });

  // ─── Attempt A: single atomic batch, newborn pays its own inner stamp ───
  console.log("\nAttempt A — one HIP-551 batch: [transfer-to-alias] + [newborn-paid stamp]...");
  try {
    const batchKey = operatorKey;

    const fund = await new TransferTransaction()
      .addHbarTransfer(operatorId, new Hbar(-FUND_HBAR))
      .addHbarTransfer(aliasId, new Hbar(FUND_HBAR))
      .batchify(client, batchKey.publicKey);

    // Inner txs carry empty node IDs; batch key must be set BEFORE freeze.
    // The payer is the alias-form account id — the thing V-9 actually tests.
    const stamp = await new TopicMessageSubmitTransaction()
      .setTopicId(witness.hbarTopicId)
      .setMessage(stampMessage)
      .setTransactionId(TransactionId.generate(aliasId))
      .setBatchKey(batchKey.publicKey)
      .freeze()
      .sign(newbornKey);

    const batch = new BatchTransaction()
      .addInnerTransaction(fund)
      .addInnerTransaction(stamp);
    const resp = await batch.execute(client);
    const receipt = await resp.getReceipt(client);
    console.log(`   BATCH SUCCEEDED: ${receipt.status.toString()}`);
    console.log(`   tx: ${hashscanTx(resp.transactionId.toString())}`);
    appendEvidence("V-9 Attempt A: atomic batch, newborn inner payer — SUCCESS", resp.transactionId.toString(), hashscanTx(resp.transactionId.toString()));
    console.log("\nV-9 = YES. Lane B can be one atomic event; W-1 fully symmetric.");
    client.close();
    return;
  } catch (err) {
    console.log(`   BATCH FAILED (expected candidate): ${(err as Error).message?.slice(0, 300)}`);
  }

  // ─── Attempt B: two-step — auto-create, then the newborn stamps itself ───
  console.log("\nAttempt B — two-step: transfer-to-alias creates the account, newborn signs its own stamp...");

  const fundTx = await new TransferTransaction()
    .addHbarTransfer(operatorId, new Hbar(-FUND_HBAR))
    .addHbarTransfer(aliasId, new Hbar(FUND_HBAR))
    .execute(client);
  await fundTx.getReceipt(client);

  // The auto-create is a child transaction — pull the newborn's account number.
  const withChildren = await new TransactionReceiptQuery()
    .setTransactionId(fundTx.transactionId)
    .setIncludeChildren(true)
    .execute(client);
  const newbornId =
    withChildren.children.map((c) => c.accountId).find((a) => a != null)?.toString() ?? null;
  if (!newbornId) throw new Error("Auto-create child receipt did not surface the newborn account id");
  console.log(`   Newborn account created: ${newbornId} (funded ${FUND_HBAR} HBAR)`);
  console.log(`   fund tx: ${hashscanTx(fundTx.transactionId.toString())}`);

  const newbornClient = Client.forTestnet().setOperator(newbornId, newbornKey);
  const stampTx = await new TopicMessageSubmitTransaction()
    .setTopicId(witness.hbarTopicId)
    .setMessage(stampMessage)
    .execute(newbornClient);
  const stampReceipt = await stampTx.getReceipt(newbornClient);
  console.log(`   Newborn stamp: ${stampReceipt.status.toString()}`);
  console.log(`   stamp tx: ${hashscanTx(stampTx.transactionId.toString())}`);

  // Confirm the custom fee actually flowed (newborn ≠ collector).
  console.log("\nChecking assessed custom fees on the newborn's stamp (mirror)...");
  await new Promise((r) => setTimeout(r, 5000));
  const txIdMirror = stampTx.transactionId
    .toString()
    .replace("@", "-")
    .replace(/\.(\d+)$/, "-$1");
  const resp = await fetch(`${net.mirrorNodeUrl}/transactions/${txIdMirror}`);
  const data = (await resp.json()) as {
    transactions?: { assessed_custom_fees?: unknown[]; charged_tx_fee?: number }[];
  };
  const fees = data.transactions?.[0]?.assessed_custom_fees ?? [];
  console.log(`   assessed_custom_fees: ${JSON.stringify(fees)}`);

  appendEvidence(
    `V-9 Attempt B: auto-create newborn ${newbornId} + self-signed stamp (custom fee assessed: ${fees.length > 0})`,
    newbornId,
    hashscanEntity("account", newbornId),
  );
  appendEvidence("V-9 newborn's paid stamp on Lane A", stampTx.transactionId.toString(), hashscanTx(stampTx.transactionId.toString()));

  console.log("\nV-9 = NO (two-step stands). W-1 Lane B wording: asymmetric — receipt + redeemable right.");
  client.close();
}

main().catch((err) => {
  console.error("probe-batch failed:", err);
  process.exit(1);
});
