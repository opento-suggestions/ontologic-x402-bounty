#!/usr/bin/env node
/**
 * witness-mcp — the Witness Required goose plugin.
 *
 * Successor to the Apex goose/MCP Hologlass artifact, same anatomy: MCP
 * server over stdio, three-channel returns, Morpheme-wrapped tools. The
 * agent is the driver: it asserts a reasoning claim and navigates each gate
 * intentionally — Payment Required, then Witness Required.
 *
 * SECURITY INVARIANTS (W-2, structural):
 * - This process holds the PAYER-AGENT's credentials only. Boot refuses to
 *   run as the ORG operator.
 * - Newborn testimony keys are generated client-side and live only in the
 *   local keystore; no tool channel ever carries a private key.
 * - Every signer is the testifier. ORG's only signatures in the whole design
 *   (vend delivery, rejection attestations) happen in ORG-side scripts that
 *   are not part of this process.
 * - assertTestnet() runs before the transport opens. Testnet only.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { assertTestnet, getWitnessConfig } from "../../core/src/config.js";
import { envPath } from "./env.js";
import { PROTOCOL } from "./channels.js";
import { handleRequirements } from "./tools/requirements.js";
import { handleAssertClaim } from "./tools/assert-claim.js";
import { handleGenesis } from "./tools/genesis.js";
import { handlePay } from "./tools/pay.js";
import { handleRedeemStatus } from "./tools/redeem-status.js";
import { handleStamp } from "./tools/stamp.js";
import { handleVerify } from "./tools/verify.js";

assertTestnet();

// ── Boot diagnostic (stderr only — stdout is the MCP wire) ──
{
  const w = getWitnessConfig();
  console.error(`[witness-mcp] Env: ${envPath ?? "process.env only"}`);
  console.error(`[witness-mcp]   Lane A topic: ${w.hbarTopicId ?? "MISSING"}`);
  console.error(`[witness-mcp]   Lane B topic: ${w.keyTopicId ?? "MISSING"}`);
  console.error(`[witness-mcp]   wKEY token:  ${w.keyTokenId ?? "MISSING"}`);
  console.error(`[witness-mcp]   PAYER_ID:    ${process.env.PAYER_ID ?? "MISSING (Lane A + pay tools will refuse)"}`);
  console.error(`[witness-mcp]   Facilitator: ${process.env.FACILITATOR_URL ?? "none (direct settlement mode)"}`);
}

const server = new McpServer({ name: "witness-required", version: "0.1.0" });

server.tool(
  "witness_requirements",
  "Fetch the published Witness Required price list (both lanes, W-7) — the Payment Required moment. " +
    "Returns PaymentRequirements per the Hedera x402 exact scheme.",
  {},
  async () => handleRequirements(),
);

server.tool(
  "witness_assert_claim",
  "Assert a reasoning claim: a trace proof of WHITE over the live Ontologic taxonomy. " +
    "The claim space is closed (W-9): only 'light' and 'paint' WHITE traces construct; anything else refuses. " +
    "Validation is client-side — invalid claims never submit.",
  {
    domain: z.enum(["light", "paint"]).describe("Proof domain: WHITE in light (additive) or paint (subtractive)"),
  },
  async ({ domain }) => handleAssertClaim(domain),
);

server.tool(
  "witness_genesis",
  "Generate a fresh testimony keypair CLIENT-SIDE for Lane B (premium). The private key stays in this " +
    "machine's keystore — yours, never ORG's. Returns the EVM alias the vending machine will fund into existence.",
  {},
  async () => handleGenesis(),
);

server.tool(
  "witness_pay",
  "Settle the x402 payment leg for Lane B: a conformant exact-scheme TransferTransaction from your funding " +
    "account to the published payTo (via facilitator if configured, else self-sponsored). The settled transfer " +
    "IS the payment receipt; delivery (account genesis + 1 wKEY) is a redeemable right against it.",
  {
    alias: z.string().optional().describe("Testimony alias to vend for (defaults to the latest witness_genesis)"),
  },
  async ({ alias }) => handlePay(alias),
);

server.tool(
  "witness_redeem_status",
  "Check (keyless, mirror-only) whether ORG's vend has redeemed your payment receipt: does the testimony " +
    "account exist, is it funded, does it hold 1 wKEY?",
  {
    alias: z.string().optional().describe("Testimony alias (defaults to the latest witness_genesis)"),
  },
  async ({ alias }) => handleRedeemStatus(alias),
);

server.tool(
  "witness_stamp",
  "Stamp the asserted claim as a morpheme onto a fee-bearing topic. Lane A: your funding account signs; the " +
    "HIP-991 HBAR fee is charged AS the message records — payment and testimony are one transaction. Lane B: " +
    "the NEWBORN signs its own stamp, paying 1 wKEY (burned on execution). Max-custom-fee protection is set " +
    "at the published price — a re-peg cannot ambush you.",
  {
    lane: z.enum(["A", "B"]).describe("A = native/discounted (HBAR fee), B = premium/genesis (wKEY fee)"),
    domain: z.enum(["light", "paint"]).describe("Which WHITE trace to stamp"),
    status: z
      .enum(["declared", "missing", "vague", "blurred", "stale", "timed-out", "withheld"])
      .optional()
      .describe("statusProfile envelope value (default: declared). Rides beside the proof, never hashed."),
    statusNote: z.string().optional().describe("Optional short note on the statusProfile"),
  },
  async ({ lane, domain, status, statusNote }) => handleStamp(lane, domain, status, statusNote),
);

server.tool(
  "witness_verify",
  "Re-check a stamp keylessly off public mirror REST: recompute its hashes, dereference its rule, judge it " +
    "valid | rejection | invalid. No key, no ORG endpoint, no trust in the author.",
  {
    consensusTimestamp: z.string().describe("The stamp's consensus timestamp (seconds.nanos)"),
    lane: z.enum(["A", "B"]).optional().describe("Restrict to one lane's topic (default: search both)"),
  },
  async ({ consensusTimestamp, lane }) => handleVerify(consensusTimestamp, lane),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[witness-mcp] ${PROTOCOL} running on stdio`);
}

main().catch((error) => {
  console.error("witness-mcp failed to start:", error);
  process.exit(1);
});

// ── Graceful shutdown + Windows orphan watchdog (hologlass pattern) ──
function gracefulShutdown(reason: string) {
  console.error(`[witness-mcp] Shutting down: ${reason}`);
  process.exit(0);
}

process.stdin.on("end", () => gracefulShutdown("stdin closed (goose disconnected)"));
process.stdin.on("close", () => gracefulShutdown("stdin closed (goose disconnected)"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

{
  const parentPid = process.ppid;
  const watchdog = setInterval(() => {
    if (process.stdin.destroyed || !process.stdin.readable) {
      clearInterval(watchdog);
      gracefulShutdown("watchdog: stdin pipe broken");
      return;
    }
    try {
      process.kill(parentPid, 0);
    } catch {
      clearInterval(watchdog);
      gracefulShutdown(`watchdog: parent gone (PID ${parentPid})`);
    }
  }, 5_000);
  watchdog.unref();
}
