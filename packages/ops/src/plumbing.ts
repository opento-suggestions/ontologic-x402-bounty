/**
 * plumbing.ts — shared testnet plumbing for every keyed operation.
 *
 * Every on-chain action appends to docs/evidence.md as it goes (the link
 * collection is a side effect of running, not a chore), and new entity IDs
 * persist back into .env so later operations pick them up.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TransactionRecord } from "@hashgraph/sdk";
import type { MirrorMessage } from "../../core/src/mirror.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Record consensus timestamp → mirror-style "seconds.nanos" string. */
export function consensusString(record: TransactionRecord): string {
  const ts = record.consensusTimestamp;
  return `${ts.seconds}.${ts.nanos.toString().padStart(9, "0")}`;
}

/**
 * Wait out mirror lag (3–7s on testnet, V-7) for the message at an EXACT
 * consensus timestamp — mirror's `timestamp=` filter is >=, so equality is
 * asserted or the next message could impersonate the one we wrote.
 * The ONE mirror-poll loop; hand-rolled copies are the bug farm this replaced.
 */
export async function waitForMirror(
  mirrorNodeUrl: string,
  topicId: string,
  consensusTimestamp: string,
  tries = 10,
): Promise<MirrorMessage> {
  for (let i = 0; i < tries; i++) {
    const resp = await fetch(`${mirrorNodeUrl}/topics/${topicId}/messages?timestamp=${consensusTimestamp}`);
    if (resp.ok) {
      const data = (await resp.json()) as { messages?: MirrorMessage[] };
      const msg = data.messages?.[0];
      if (msg && msg.consensus_timestamp === consensusTimestamp) return msg;
    }
    await sleep(2000);
  }
  throw new Error(`Mirror never showed ${topicId} @ ${consensusTimestamp} after ${tries} tries.`);
}

/** Fetch JSON off the mirror with bounded retries; null when it never appears. */
export async function mirrorJson<T>(url: string, tries = 10, delayMs = 2000): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    const resp = await fetch(url);
    if (resp.ok) return (await resp.json()) as T;
    await sleep(delayMs);
  }
  return null;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
