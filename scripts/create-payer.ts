/**
 * create-payer.ts — provision the PAYER-AGENT's funding account (demo setup).
 *
 * The payer-agent must be distinct from the ORG operator (W-2, and the fee
 * collector is exempt from its own fees — a self-paid demo would show no
 * assessed fee). One-time: operator funds a fresh ECDSA account; credentials
 * are written to .env for witness-mcp.
 */

import { AccountCreateTransaction, Hbar, PrivateKey } from "@hashgraph/sdk";
import { appendEvidence, hashscanEntity, hashscanTx, openOperatorContext, updateEnv } from "../packages/ops/src/index.js";

const FUND_HBAR = 60;

async function main() {
  const { client } = openOperatorContext();

  const payerKey = PrivateKey.generateECDSA();
  const tx = await new AccountCreateTransaction()
    .setKeyWithoutAlias(payerKey.publicKey)
    .setInitialBalance(new Hbar(FUND_HBAR))
    .setAccountMemo("witness-required payer-agent (demo)")
    .execute(client);
  const receipt = await tx.getReceipt(client);
  const payerId = receipt.accountId!.toString();

  console.log(`Payer-agent account: ${payerId} (funded ${FUND_HBAR} HBAR)`);
  console.log(`tx: ${hashscanTx(tx.transactionId.toString())}`);
  appendEvidence("payer-agent account created (distinct from operator)", payerId, hashscanEntity("account", payerId));

  updateEnv({ PAYER_ID: payerId, PAYER_DER_KEY: payerKey.toStringDer() });
  console.log(".env updated: PAYER_ID, PAYER_DER_KEY");

  client.close();
}

main().catch((err) => {
  console.error("create-payer failed:", err);
  process.exit(1);
});
