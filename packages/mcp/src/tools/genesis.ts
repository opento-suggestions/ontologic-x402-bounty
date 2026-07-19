/**
 * genesis.ts — client-side testimony keypair (Lane B, step one).
 *
 * The keypair is generated HERE, in the agent's process, and stored in the
 * agent's keystore. No channel carries the private key; ORG never sees it.
 * The alias is what the vending machine will fund into existence.
 */

import { generateNewborn, latestNewborn } from "../state/keystore.js";
import { ok, type ToolResult } from "../channels.js";

export async function handleGenesis(): Promise<ToolResult> {
  const { alias } = generateNewborn();
  const entry = latestNewborn();
  return ok({
    alias,
    keyLocation: "local keystore (this machine, this agent) — the key is yours, never ORG's",
    accountExists: false,
    createdAt: entry?.createdAt,
    next: "witness_pay settles the x402 leg; ORG's vend then funds this alias into existence with 1 wKEY",
  });
}
