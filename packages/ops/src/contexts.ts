/**
 * contexts.ts — the persona boundary as a type (W-2, compile-time).
 *
 * Every keyed operation takes a context whose persona literal and field
 * names make the types disjoint: a function that accepts a CustomerContext
 * cannot be handed an OperatorContext. The Lane B payTo bug — deployer
 * identity answering a payer-path question — is unrepresentable at these
 * signatures, alongside the runtime refusals in the plugin's env.ts.
 *
 * Constructors live in separate modules by side of the counter:
 *   operator.ts — openOperatorContext / openRootContext (ORG's CLIs only)
 *   customer.ts — openPayerContext / openNewbornContext (customer tools)
 */

import type { Client, PrivateKey } from "@hashgraph/sdk";

export interface OperatorContext {
  readonly persona: "operator";
  readonly client: Client;
  readonly operatorId: string;
  readonly operatorKey: PrivateKey;
}

export interface RootContext {
  readonly persona: "root";
  readonly client: Client;
  readonly rootId: string;
  readonly rootKey: PrivateKey;
}

export interface PayerContext {
  readonly persona: "payer";
  readonly client: Client;
  readonly payerId: string;
  readonly payerKey: PrivateKey;
}

export interface NewbornContext {
  readonly persona: "newborn";
  readonly client: Client;
  readonly accountId: string;
  readonly alias: string;
  readonly key: PrivateKey;
}

/** The customer side of the counter — the only personas the payment path accepts. */
export type CustomerContext = PayerContext | NewbornContext;

/**
 * Who may sign testimony: always the testifier itself (W-2 — never ORG on a
 * payer's behalf). The operator appears here only for ORG's own floor-test
 * stamps, which testify as ORG and are disclosed as fee-exempt.
 */
export type TestimonyContext = PayerContext | NewbornContext | OperatorContext;

export function signerOf(ctx: TestimonyContext): { accountId: string } {
  switch (ctx.persona) {
    case "payer":
      return { accountId: ctx.payerId };
    case "newborn":
      return { accountId: ctx.accountId };
    case "operator":
      return { accountId: ctx.operatorId };
  }
}
