/**
 * ops.ts — shared plumbing for the testnet operation scripts.
 *
 * Every script calls assertTestnet() before opening a client (the kill-switch),
 * appends its on-chain actions to docs/evidence.md as it goes (the bounty's
 * link collection is a side effect of running, not a chore), and persists new
 * entity IDs back into .env so later scripts pick them up.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, Hbar, PrivateKey } from "@hashgraph/sdk";
import { assertTestnet, getOperatorConfig } from "../../packages/core/src/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..");

export function openOperatorClient(): { client: Client; operatorId: string; operatorKey: PrivateKey } {
  assertTestnet();
  const op = getOperatorConfig();
  const operatorKey = PrivateKey.fromStringDer(op.derKey);
  const client = Client.forTestnet().setOperator(op.id, operatorKey);
  // Testnet's exchange rate (~6.6¢/HBAR) makes USD-priced fees large in HBAR;
  // SDK defaults undershoot. Cap generously — the network charges actuals.
  client.setDefaultMaxTransactionFee(new Hbar(50));
  return { client, operatorId: op.id, operatorKey };
}

export function hashscanTx(txId: string): string {
  // 0.0.x@seconds.nanos → 0.0.x-seconds-nanos
  const normalized = txId.replace("@", "-").replace(/\.(\d+)$/, "-$1");
  return `https://hashscan.io/testnet/transaction/${normalized}`;
}

export function hashscanEntity(kind: "topic" | "token" | "contract" | "account", id: string): string {
  return `https://hashscan.io/testnet/${kind}/${id}`;
}

export function appendEvidence(what: string, entity: string, link: string): void {
  const file = path.join(REPO_ROOT, "docs", "evidence.md");
  const date = new Date().toISOString().slice(0, 10);
  fs.appendFileSync(file, `| ${date} | ${what} | \`${entity}\` | ${link} |\n`);
}

/** Set or replace KEY=value lines in .env (creates the key if absent). */
export function updateEnv(pairs: Record<string, string>): void {
  const file = path.join(REPO_ROOT, ".env");
  let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  for (const [key, value] of Object.entries(pairs)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, "m");
    text = re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
  }
  fs.writeFileSync(file, text);
}

export function writeJson(relPath: string, data: unknown): void {
  fs.writeFileSync(path.join(REPO_ROOT, relPath), JSON.stringify(data, null, 2) + "\n");
}

export function readJson<T>(relPath: string): T {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relPath), "utf8")) as T;
}
