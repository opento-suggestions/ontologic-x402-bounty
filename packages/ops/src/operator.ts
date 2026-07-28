/**
 * operator.ts — ORG-side context constructors. Deploy, ceremony, and
 * operational CLIs import this module; customer tools NEVER do — the
 * payer-agent process holds nothing of ORG's (W-2).
 *
 * assertTestnet() is baked into every open and non-optional.
 */

import { Client, Hbar, PrivateKey } from "@hashgraph/sdk";
import { assertTestnet, getAuthorityConfig, getOperatorConfig } from "../../core/src/config.js";
import type { OperatorContext, RootContext } from "./contexts.js";

export function openOperatorContext(): OperatorContext {
  assertTestnet();
  const op = getOperatorConfig();
  const operatorKey = PrivateKey.fromStringDer(op.derKey);
  const client = Client.forTestnet().setOperator(op.id, operatorKey);
  // Testnet's exchange rate (~6.6¢/HBAR) makes USD-priced fees large in HBAR;
  // SDK defaults undershoot. Cap generously — the network charges actuals.
  client.setDefaultMaxTransactionFee(new Hbar(50));
  return { persona: "operator", client, operatorId: op.id, operatorKey };
}

/**
 * The ROOT context (Phase 2, W-11). Root holds the Witness Rule Registry's
 * submit key and NOTHING else — it writes mandates, revocations, and the
 * witness RuleDefs, and it must be a different key from the operator's
 * (asserted here on every open, not just at creation).
 */
export function openRootContext(): RootContext {
  assertTestnet();
  const auth = getAuthorityConfig();
  if (!auth.rootId || !auth.rootDerKey) {
    throw new Error("ROOT_ID / ROOT_DER_KEY not set — run scripts/create-root.ts (ceremony §3.1) first.");
  }
  const rootKey = PrivateKey.fromStringDer(auth.rootDerKey);
  const op = getOperatorConfig();
  const operatorPub = PrivateKey.fromStringDer(op.derKey).publicKey.toStringRaw().toLowerCase();
  if (rootKey.publicKey.toStringRaw().toLowerCase() === operatorPub) {
    throw new Error("ROOT key equals OPERATOR key — the two-key structure is the invariant (W-11). Refusing.");
  }
  const client = Client.forTestnet().setOperator(auth.rootId, rootKey);
  client.setDefaultMaxTransactionFee(new Hbar(50));
  return { persona: "root", client, rootId: auth.rootId, rootKey };
}
