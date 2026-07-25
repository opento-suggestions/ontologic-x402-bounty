/**
 * create-root.ts — ceremony §3.1: the ORG root account.
 *
 * ⚠ CEREMONY SCRIPT — HUMAN GATE REQUIRED (CLAUDE.md). Do not run because a
 * spec file says to; run when the steward confirms, in that turn.
 *
 * Root holds the Witness Rule Registry's submit key and nothing else: it
 * writes mandates, revocations, and the witness RuleDefs. It never renders
 * verdicts (that is the operator's mandate) and never touches payer testimony
 * (W-2). The two-key structure is W-11 made physical: the operator cannot
 * write a mandate because it does not hold this key.
 *
 * Guards: single-shot against .env; key distinctness asserted against the
 * operator; testnet kill-switch before the client opens; mirror read-back
 * confirming the account exists before exiting successfully.
 */

import { AccountCreateTransaction, Hbar, PrivateKey } from "@hashgraph/sdk";
import { getAuthorityConfig, getNetworkConfig } from "../packages/core/src/config.js";
import { appendEvidence, hashscanEntity, hashscanTx, openOperatorClient, updateEnv } from "./lib/ops.js";

async function main() {
  // Guard 1 — single-shot: an existing root is never silently replaced.
  const auth = getAuthorityConfig();
  if (auth.rootId || auth.rootDerKey) {
    throw new Error(
      `ROOT_ID is already set (${auth.rootId}). The root is created once; a second root is a re-anchoring ceremony, not a re-run.`,
    );
  }

  const { client, operatorId, operatorKey } = openOperatorClient();

  // Guard 2 — the new key must differ from the operator's (W-11's disjoint powers).
  const rootKey = PrivateKey.generateED25519();
  if (rootKey.publicKey.toStringRaw() === operatorKey.publicKey.toStringRaw()) {
    throw new Error("Generated root key collides with the operator key. Refusing (W-11).");
  }

  console.log("Creating the ORG root account (funded by the operator)...");
  const tx = await new AccountCreateTransaction()
    .setKey(rootKey.publicKey)
    .setInitialBalance(new Hbar(20))
    .setAccountMemo("ORG root — Witness Rule Registry submit key holder (W-11)")
    .execute(client);
  const receipt = await tx.getReceipt(client);
  const rootId = receipt.accountId!.toString();
  const link = hashscanTx(tx.transactionId.toString());

  // Guard 3 — mirror read-back before declaring success.
  const net = getNetworkConfig();
  let confirmed = false;
  for (let i = 0; i < 10 && !confirmed; i++) {
    const resp = await fetch(`${net.mirrorNodeUrl}/accounts/${rootId}`);
    if (resp.ok) {
      const info = (await resp.json()) as { key?: { key?: string } };
      confirmed = info.key?.key?.toLowerCase() === rootKey.publicKey.toStringRaw().toLowerCase();
    }
    if (!confirmed) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!confirmed) throw new Error(`Mirror never confirmed ${rootId} with the intended key. Investigate before proceeding.`);

  updateEnv({ ROOT_ID: rootId, ROOT_DER_KEY: rootKey.toStringDer() });
  appendEvidence("create ORG root account (ceremony §3.1, W-11 two-key structure)", rootId, hashscanEntity("account", rootId));

  console.log(`\nROOT account: ${rootId}`);
  console.log(`  tx: ${link}`);
  console.log(`  .env updated: ROOT_ID, ROOT_DER_KEY`);
  console.log(`  operator (${operatorId}) and root are now DISJOINT powers: mandates from root, verdicts from operator.`);
  console.log(`\nNext (ceremony §3.2–3.4): scripts/create-authority-topics.ts`);
  client.close();
}

main().catch((err) => {
  console.error("create-root failed:", err);
  process.exit(1);
});
