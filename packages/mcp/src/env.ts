/**
 * env.ts — the plugin's credential model. W-2 is enforced HERE, structurally:
 *
 * This process holds the PAYER-AGENT's identity and nothing of ORG's:
 *   PAYER_ID / PAYER_DER_KEY — the agent's funding account (Lane A stamps and
 *     x402 payment debits). Distinct from the ORG operator by construction —
 *     boot refuses to run if PAYER_ID equals OPERATOR_ID, so the fee-collector
 *     exemption can never quietly fake a paid demo, and no ORG key ever
 *     enters the agent's process.
 *   Newborn testimony keys — generated client-side by witness_genesis, stored
 *     in the local keystore, never emitted on any tool channel.
 *
 * Topic/token/contract IDs are public coordinates, not secrets.
 */

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

function findEnv(): string | undefined {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, ".env");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

export const envPath = findEnv();
dotenv.config({ path: envPath });

export interface PayerConfig {
  id: string;
  derKey: string;
}

export function getPayerConfig(): PayerConfig {
  const id = process.env.PAYER_ID;
  const derKey = process.env.PAYER_DER_KEY;
  if (!id || !derKey || derKey.startsWith("<")) {
    throw new Error(
      "Missing PAYER_ID / PAYER_DER_KEY. The plugin runs as the payer-agent, with the agent's own account — run scripts/create-payer.ts or supply an existing funded testnet account.",
    );
  }
  if (process.env.OPERATOR_ID && id === process.env.OPERATOR_ID) {
    throw new Error(
      "PAYER_ID equals OPERATOR_ID. The payer-agent must be distinct from the ORG operator (W-2; and the fee collector is exempt from its own fees, which would fake the demo).",
    );
  }
  return { id, derKey };
}

/** Where newborn testimony keys live. The agent's machine, the agent's keys. */
export function stateDir(): string {
  const dir =
    process.env.WITNESS_STATE_DIR ??
    path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".witness-mcp");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
