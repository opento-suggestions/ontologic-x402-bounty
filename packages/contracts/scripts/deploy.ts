/**
 * deploy.ts — deploy WitnessVendingMachine via the Hedera SDK (the operator
 * key is ED25519, so the JSON-RPC/EVM-alias route is unavailable — native
 * ContractCreateFlow works with any key type), then have the contract create
 * the witness-KEY token (treasury = contract, supply key = contract, no admin
 * key — the token is born immutable).
 *
 * Writes VENDING_CONTRACT_* and WITNESS_KEY_TOKEN_ID back to the root .env
 * and appends HashScan evidence.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ContractCallQuery,
  ContractCreateFlow,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  Hbar,
} from "@hashgraph/sdk";
import { getNetworkConfig } from "../../core/src/config.js";
import { appendEvidence, hashscanEntity, hashscanTx, openOperatorContext, updateEnv } from "../../ops/src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const { client } = openOperatorContext();
  const net = getNetworkConfig();

  const artifactPath = path.join(
    __dirname,
    "..",
    "artifacts",
    "contracts",
    "WitnessVendingMachine.sol",
    "WitnessVendingMachine.json",
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8")) as { bytecode: string };

  console.log("Deploying WitnessVendingMachine (ContractCreateFlow)...");
  const createResp = await new ContractCreateFlow()
    .setBytecode(artifact.bytecode)
    .setGas(1_000_000)
    .execute(client);
  const createReceipt = await createResp.getReceipt(client);
  const contractId = createReceipt.contractId!.toString();
  const evmAddr = `0x${createReceipt.contractId!.toSolidityAddress()}`;
  console.log(`  contract: ${contractId} (${evmAddr})`);
  console.log(`  tx: ${hashscanTx(createResp.transactionId.toString())}`);
  appendEvidence("WitnessVendingMachine deployed", contractId, hashscanEntity("contract", contractId));

  console.log("\nCreating witness-KEY via the contract (treasury = contract, supply key = contract)...");
  const createKeyResp = await new ContractExecuteTransaction()
    .setContractId(createReceipt.contractId!)
    .setFunction("createKeyToken")
    .setGas(1_500_000)
    .setPayableAmount(new Hbar(30))
    .execute(client);
  await createKeyResp.getReceipt(client);
  console.log(`  tx: ${hashscanTx(createKeyResp.transactionId.toString())}`);

  const tokenAddrQuery = await new ContractCallQuery()
    .setContractId(createReceipt.contractId!)
    .setFunction("keyToken")
    .setGas(100_000)
    .execute(client);
  const tokenAddr = `0x${Buffer.from(tokenAddrQuery.getAddress(0), "hex").toString("hex")}`;
  const tokenAddrHex = `0x${tokenAddrQuery.getAddress(0)}`;
  console.log(`  witness-KEY EVM address: ${tokenAddrHex}`);

  await new Promise((r) => setTimeout(r, 5000));
  const tokenInfo = (await (await fetch(`${net.mirrorNodeUrl}/tokens/${tokenAddrHex.toLowerCase()}`)).json()) as {
    token_id?: string;
  };
  const tokenId = tokenInfo.token_id ?? "";
  if (!tokenId) throw new Error(`Mirror did not resolve token at ${tokenAddrHex} — check HashScan and set WITNESS_KEY_TOKEN_ID manually.`);
  console.log(`  witness-KEY token ID: ${tokenId}`);
  appendEvidence("witness-KEY created by contract (immutable, supply key = contract)", tokenId, hashscanEntity("token", tokenId));

  updateEnv({
    VENDING_CONTRACT_ID: contractId,
    VENDING_CONTRACT_ADDR: evmAddr,
    WITNESS_KEY_TOKEN_ID: tokenId,
  });
  console.log("\n.env updated: VENDING_CONTRACT_ID, VENDING_CONTRACT_ADDR, WITNESS_KEY_TOKEN_ID");
  console.log("Next: scripts/repeg-lane-b.ts (Lane B fee → 1 KEY), then smoke:lane-b.");
  void tokenAddr;
  client.close();
}

main().catch((err) => {
  console.error("deploy failed:", err);
  process.exit(1);
});
