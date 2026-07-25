/**
 * config.ts — environment, identity, and the testnet-only guard.
 *
 * Ported from ontologic-hello-world/src/config.ts. assertTestnet() is the
 * mainnet kill-switch: called first by every script that opens a Hedera
 * Client, before any transaction is built. Never weakened.
 */

import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

// One .env, one source of truth: the repo root's. Scripts run from nested
// package dirs too, so walk upward from cwd to the first .env found.
function findEnv(): string | undefined {
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(dir, ".env");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

dotenv.config({ path: findEnv() });

export interface OperatorConfig {
  id: string;
  derKey: string;
  hexKey: string;
  evmAddr: string;
}

export interface NetworkConfig {
  mirrorNodeUrl: string;
  rpcUrl: string;
}

/** The live v0.8.3 sphere — READ ONLY. This build never writes to these. */
export interface SphereConfig {
  ruleDefsTopicId: string;
  ruleRegistryTopicId: string;
  proofTopicId: string;
}

/** Witness Required's own entities, filled in by scripts as they run. */
export interface WitnessConfig {
  hbarTopicId: string | null;
  keyTopicId: string | null;
  vendingContractId: string | null;
  vendingContractAddr: string | null;
  keyTokenId: string | null;
  usdcTokenId: string | null;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.startsWith("<")) {
    throw new Error(`Missing required env var ${name}. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

export function getOperatorConfig(): OperatorConfig {
  return {
    id: required("OPERATOR_ID"),
    derKey: required("OPERATOR_DER_KEY"),
    hexKey: process.env.OPERATOR_HEX_KEY ?? "",
    evmAddr: process.env.OPERATOR_EVM_ADDR ?? "",
  };
}

export function getNetworkConfig(): NetworkConfig {
  return {
    mirrorNodeUrl: process.env.MIRROR_NODE_URL ?? "https://testnet.mirrornode.hedera.com/api/v1",
    rpcUrl: process.env.HEDERA_RPC_URL ?? "https://testnet.hashio.io/api",
  };
}

export function getSphereConfig(): SphereConfig {
  return {
    ruleDefsTopicId: process.env.RULE_DEFS_TOPIC_ID ?? "0.0.8641938",
    ruleRegistryTopicId: process.env.RULE_REGISTRY_TOPIC_ID ?? "0.0.8641941",
    proofTopicId: process.env.PROOF_TOPIC_ID ?? "0.0.8641943",
  };
}

export function getWitnessConfig(): WitnessConfig {
  return {
    hbarTopicId: process.env.WITNESS_HBAR_TOPIC_ID || null,
    keyTopicId: process.env.WITNESS_KEY_TOPIC_ID || null,
    vendingContractId: process.env.VENDING_CONTRACT_ID || null,
    vendingContractAddr: process.env.VENDING_CONTRACT_ADDR || null,
    keyTokenId: process.env.WITNESS_KEY_TOKEN_ID || null,
    usdcTokenId: process.env.USDC_TOKEN_ID || null,
  };
}

/**
 * Phase 2 authority entities (PHASE_2 §3), filled in by the ceremony scripts.
 * Env naming follows the repo's *_DER_KEY convention (§3.1 wrote "ROOT_KEY";
 * the DER suffix is this codebase's existing dialect for the same thing).
 */
export interface AuthorityConfig {
  rootId: string | null;
  rootDerKey: string | null;
  witnessRulesTopicId: string | null;
  verdictTopicId: string | null;
  mandateHash: string | null;
  firstMandateTimestamp: string | null;
}

export function getAuthorityConfig(): AuthorityConfig {
  return {
    rootId: process.env.ROOT_ID || null,
    rootDerKey: process.env.ROOT_DER_KEY || null,
    witnessRulesTopicId: process.env.WITNESS_RULES_TOPIC || null,
    verdictTopicId: process.env.WITNESS_VERDICT_TOPIC || null,
    mandateHash: process.env.WITNESS_MANDATE_HASH || null,
    firstMandateTimestamp: process.env.WITNESS_FIRST_MANDATE_TS || null,
  };
}

/** Hard-fail, loudly, if anything points at mainnet. Testnet only. */
export function assertTestnet(): void {
  const net = getNetworkConfig();
  const haystack = `${net.mirrorNodeUrl} ${net.rpcUrl}`.toLowerCase();
  if (haystack.includes("mainnet")) {
    throw new Error(`Refusing to run: mainnet endpoint detected (${haystack.trim()}). Testnet only.`);
  }
  if (!haystack.includes("testnet")) {
    throw new Error(
      `Refusing to run: could not confirm a testnet endpoint from ${haystack.trim()}. Testnet only.`,
    );
  }
}
