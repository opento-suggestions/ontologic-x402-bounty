/**
 * lane-b-smoke.ts — the Lane B delivery chain, end to end (V-5 + the premium
 * lane's product: genesis + witness):
 *
 *   1. Newborn keypair generated client-side — theirs, never ours (W-2).
 *   2. vend(alias) on the vending machine: ONE atomic contract call funds the
 *      alias into existence (lazy account creation), mints 1 wKEY, delivers
 *      it. Any leg fails → whole delivery reverts (redeemable right).
 *   3. The newborn — which did not exist on Hedera ninety seconds ago —
 *      builds a WHITE trace claim (paint domain) and signs its OWN stamp to
 *      the Lane B topic; HIP-991 charges the 1 wKEY fee atomically, straight
 *      back to the treasury-in-code (the vending contract).
 *   4. burnCollected(1): the consumed KEY exits supply (D-3 — sink, not
 *      reserve).
 *
 * The x402 payment leg (partially signed TransferTransaction + facilitator)
 * runs upstream of this chain in the MCP plugin; this script is the
 * post-settlement delivery it redeems.
 */

import {
  AccountId,
  Client,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  CustomFeeLimit,
  CustomFixedFee,
  Hbar,
  PrivateKey,
  TokenId,
  TopicMessageSubmitTransaction,
} from "@hashgraph/sdk";
import { canonicalizeJSON } from "../packages/core/src/morpheme.js";
import { getNetworkConfig, getSphereConfig, getWitnessConfig } from "../packages/core/src/config.js";
import { buildWhiteTraceClaim, buildStampForClaim } from "../packages/core/src/claims.js";
import { judgeMessage } from "../packages/core/src/verify.js";
import type { MirrorMessage } from "../packages/core/src/mirror.js";
import { appendEvidence, hashscanEntity, hashscanTx, openOperatorClient } from "./lib/ops.js";
import { PEG } from "./peg.js";

const FUND_HBAR = 10;

async function mirrorJson<T>(url: string, tries = 20): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    const resp = await fetch(url);
    if (resp.ok) return (await resp.json()) as T;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

async function main() {
  const { client, operatorId } = openOperatorClient();
  const net = getNetworkConfig();
  const sphere = getSphereConfig();
  const witness = getWitnessConfig();
  if (!witness.keyTopicId || !witness.keyTokenId || !witness.vendingContractId) {
    throw new Error("Need WITNESS_KEY_TOPIC_ID, WITNESS_KEY_TOKEN_ID, VENDING_CONTRACT_ID in .env");
  }

  console.log("1. Newborn keypair (client-side, ECDSA for EVM alias)...");
  const newbornKey = PrivateKey.generateECDSA();
  const newbornEvm = `0x${newbornKey.publicKey.toEvmAddress()}`;
  console.log(`   alias: ${newbornEvm}`);

  console.log("\n2. vend(alias) — one atomic call: fund + mint + deliver...");
  const vendTx = await new ContractExecuteTransaction()
    .setContractId(witness.vendingContractId)
    .setFunction("vend", new ContractFunctionParameters().addAddress(newbornEvm))
    // Lazy account creation inside the value transfer is gas-heavy (~600k+
    // intrinsic) on top of mint + transfer. Headroom is cheap; unused refunds.
    .setGas(3_000_000)
    .setPayableAmount(new Hbar(FUND_HBAR))
    .execute(client);
  await vendTx.getReceipt(client);
  const vendLink = hashscanTx(vendTx.transactionId.toString());
  console.log(`   vend tx: ${vendLink}`);

  console.log("\n3. Confirming genesis on mirror (account, HBAR, 1 wKEY)...");
  const account = await mirrorJson<{ account: string; balance: { balance: number; tokens: { token_id: string; balance: number }[] } }>(
    `${net.mirrorNodeUrl}/accounts/${newbornEvm}`,
  );
  if (!account) throw new Error("Newborn account not visible on mirror");
  const newbornId = account.account;
  const keyBalance = account.balance.tokens.find((t) => t.token_id === witness.keyTokenId)?.balance ?? 0;
  console.log(`   account: ${newbornId} · ${account.balance.balance / 1e8} HBAR · ${keyBalance} wKEY`);
  if (keyBalance < 1) throw new Error("Newborn did not receive wKEY");
  appendEvidence(
    `Lane B vend: genesis + 1 wKEY delivered in one contract call (newborn ${newbornId})`,
    newbornId,
    hashscanEntity("account", newbornId),
  );

  console.log("\n4. Newborn builds WHITE trace (paint) and signs its OWN stamp to Lane B...");
  const claim = await buildWhiteTraceClaim({
    domain: "paint",
    registryTopicId: sphere.ruleRegistryTopicId,
    proofTopicId: sphere.proofTopicId,
    resolve: { mirrorNodeUrl: net.mirrorNodeUrl },
  });
  const stamp = buildStampForClaim({
    claim,
    callerAccountId: newbornId,
    createdAt: new Date().toISOString(),
  });

  const newbornClient = Client.forTestnet().setOperator(newbornId, newbornKey);
  newbornClient.setDefaultMaxTransactionFee(new Hbar(10));
  const feeLimit = new CustomFeeLimit()
    .setAccountId(newbornId)
    .setFees([
      new CustomFixedFee()
        .setAmount(PEG.laneB.feeKey)
        .setDenominatingTokenId(TokenId.fromString(witness.keyTokenId)),
    ]);
  const submitted = Date.now();
  const stampTx = await new TopicMessageSubmitTransaction()
    .setTopicId(witness.keyTopicId)
    .setMessage(Buffer.from(canonicalizeJSON(stamp), "utf8"))
    .setCustomFeeLimits([feeLimit])
    .execute(newbornClient);
  const record = await stampTx.getRecord(newbornClient);
  const consensusTimestamp = `${record.consensusTimestamp.seconds}.${record.consensusTimestamp.nanos
    .toString()
    .padStart(9, "0")}`;
  const stampLink = hashscanTx(stampTx.transactionId.toString());
  console.log(`   stamp consensus: ${consensusTimestamp}`);
  console.log(`   stamp tx: ${stampLink}`);

  console.log("\n5. Verifying: fee assessed in wKEY → collector = contract; stamp valid keyless...");
  const txIdMirror = stampTx.transactionId.toString().replace("@", "-").replace(/\.(\d+)$/, "-$1");
  await new Promise((r) => setTimeout(r, 4000));
  const txData = await mirrorJson<{ transactions: { assessed_custom_fees?: unknown[] }[] }>(
    `${net.mirrorNodeUrl}/transactions/${txIdMirror}`,
  );
  const fees = txData?.transactions?.flatMap((t) => t.assessed_custom_fees ?? []) ?? [];
  console.log(`   assessed_custom_fees: ${JSON.stringify(fees)}`);

  const msgData = await mirrorJson<{ messages: MirrorMessage[] }>(
    `${net.mirrorNodeUrl}/topics/${witness.keyTopicId}/messages?timestamp=${consensusTimestamp}`,
  );
  if (!msgData?.messages?.length) throw new Error("Lane B stamp not visible on mirror");
  const latency = ((Date.now() - submitted) / 1000).toFixed(1);
  const verdict = await judgeMessage(msgData.messages[0], witness.keyTopicId, { mirrorNodeUrl: net.mirrorNodeUrl });
  console.log(`   verdict: ${verdict.kind} · mirror latency ~${latency}s`);
  if (verdict.kind !== "valid") throw new Error("Lane B stamp did not verify VALID");
  appendEvidence(
    `Lane B stamp: newborn ${newbornId} self-signed WHITE trace (paint), 1 wKEY fee to treasury-in-code`,
    consensusTimestamp,
    stampLink,
  );

  console.log("\n6. burnCollected(1) — the consumed KEY exits supply (D-3)...");
  const burnTx = await new ContractExecuteTransaction()
    .setContractId(witness.vendingContractId)
    .setFunction("burnCollected", new ContractFunctionParameters().addInt64(1))
    .setGas(400_000)
    .execute(client);
  await burnTx.getReceipt(client);
  const burnLink = hashscanTx(burnTx.transactionId.toString());
  console.log(`   burn tx: ${burnLink}`);
  const token = await mirrorJson<{ total_supply: string }>(`${net.mirrorNodeUrl}/tokens/${witness.keyTokenId}`);
  console.log(`   wKEY total supply now: ${token?.total_supply}`);
  appendEvidence("Lane B burn: consumed wKEY exits supply (D-3)", witness.keyTokenId, burnLink);

  console.log("\nLANE B DELIVERY CHAIN COMPLETE — genesis, self-signed witness, fee-to-treasury, burn.");
  newbornClient.close();
  client.close();
}

main().catch((err) => {
  console.error("lane-b-smoke failed:", err);
  process.exit(1);
});
