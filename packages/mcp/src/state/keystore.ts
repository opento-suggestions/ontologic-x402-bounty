/**
 * keystore.ts — newborn testimony keys, client-side. Theirs, never ours (W-2).
 *
 * A flat JSON file in the agent's state dir. Keys are written once at genesis
 * and read only by the stamp tool to sign the newborn's own testimony. No
 * tool channel ever carries a private key.
 */

import fs from "node:fs";
import path from "node:path";
import { PrivateKey } from "@hashgraph/sdk";
import { stateDir } from "../env.js";
import type { StoredChallenge } from "../payment-terms.js";

export interface NewbornEntry {
  alias: string; // 0x EVM alias
  derKey: string;
  accountId: string | null; // filled once the vend lazy-creates it
  createdAt: string;
}

interface KeystoreFile {
  newborns: NewbornEntry[];
  /** The last 402 challenge witness_requirements fetched — witness_pay consumes it. */
  challenge?: StoredChallenge;
}

function keystorePath(): string {
  return path.join(stateDir(), "keystore.json");
}

function load(): KeystoreFile {
  try {
    return JSON.parse(fs.readFileSync(keystorePath(), "utf8")) as KeystoreFile;
  } catch {
    return { newborns: [] };
  }
}

function save(data: KeystoreFile): void {
  fs.writeFileSync(keystorePath(), JSON.stringify(data, null, 2));
}

/** Generate a fresh testimony keypair, persist it, return only the alias. */
export function generateNewborn(): { alias: string } {
  const key = PrivateKey.generateECDSA();
  const alias = `0x${key.publicKey.toEvmAddress()}`;
  const data = load();
  data.newborns.push({
    alias,
    derKey: key.toStringDer(),
    accountId: null,
    createdAt: new Date().toISOString(),
  });
  save(data);
  return { alias };
}

export function latestNewborn(): NewbornEntry | null {
  const data = load();
  return data.newborns.at(-1) ?? null;
}

export function findNewborn(alias: string): NewbornEntry | null {
  return load().newborns.find((n) => n.alias.toLowerCase() === alias.toLowerCase()) ?? null;
}

export function recordAccountId(alias: string, accountId: string): void {
  const data = load();
  const entry = data.newborns.find((n) => n.alias.toLowerCase() === alias.toLowerCase());
  if (entry) {
    entry.accountId = accountId;
    save(data);
  }
}

/** Persist the challenge the way genesis state is persisted — the pay tool reads it back. */
export function recordChallenge(challenge: StoredChallenge): void {
  const data = load();
  data.challenge = challenge;
  save(data);
}

export function latestChallenge(): StoredChallenge | null {
  return load().challenge ?? null;
}

/** The signing key, for the stamp tool only. Never returned on a channel. */
export function newbornKey(alias: string): PrivateKey {
  const entry = findNewborn(alias);
  if (!entry) throw new Error(`No testimony key in keystore for alias ${alias}`);
  return PrivateKey.fromStringDer(entry.derKey);
}
