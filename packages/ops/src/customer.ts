/**
 * customer.ts — customer-side context constructors. The caller supplies the
 * credentials (the plugin's env.ts owns the W-2 boot refusals: PAYER ≠
 * OPERATOR ≠ ROOT; the keystore owns newborn keys). No operator identity
 * can enter through these signatures.
 *
 * assertTestnet() is baked into every open and non-optional.
 */

import { Client, Hbar, PrivateKey } from "@hashgraph/sdk";
import { assertTestnet } from "../../core/src/config.js";
import type { NewbornContext, PayerContext } from "./contexts.js";

export function openPayerContext(creds: { id: string; derKey: string }): PayerContext {
  assertTestnet();
  const payerKey = PrivateKey.fromStringDer(creds.derKey);
  const client = Client.forTestnet().setOperator(creds.id, payerKey);
  client.setDefaultMaxTransactionFee(new Hbar(50));
  return { persona: "payer", client, payerId: creds.id, payerKey };
}

export function openNewbornContext(entry: { accountId: string; alias: string; derKey: string }): NewbornContext {
  assertTestnet();
  const key = PrivateKey.fromStringDer(entry.derKey);
  const client = Client.forTestnet().setOperator(entry.accountId, key);
  client.setDefaultMaxTransactionFee(new Hbar(10));
  return { persona: "newborn", client, accountId: entry.accountId, alias: entry.alias, key };
}
