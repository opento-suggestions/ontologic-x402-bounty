/**
 * mcp-smoke.ts — drive the witness-mcp tool handlers through the FULL agent
 * story, exactly as goose will call them (demo beats 1–4, both lanes):
 *
 *   requirements → assert claim → Lane A stamp → verify
 *   genesis → pay (x402 leg) → [ORG redeems] → redeem_status → Lane B stamp → verify
 *
 * Two postures for the ORG redemption between pay and redeem_status:
 *
 *   operator (default when OPERATOR_* is filled) — invoke scripts/redeem.ts
 *     inline, the single-process CI story.
 *   customer (auto-detected when OPERATOR_ID is the placeholder; force with
 *     --customer) — this process holds payer creds only; the operator's
 *     watcher (npm run redeem:watch) runs separately, and we poll
 *     witness_redeem_status until delivery arrives. This is the posture that
 *     exposed the payTo bug: the fix is only proven from here.
 *
 * --usdc settles the pay leg against the published USDC accepts entry
 * instead of the HBAR default (the payer must hold Circle testnet USDC).
 */

import { execFileSync } from "node:child_process";
import { getOperatorConfig } from "../packages/core/src/config.js";
import { handleRequirements } from "../packages/mcp/src/tools/requirements.js";
import { handleAssertClaim } from "../packages/mcp/src/tools/assert-claim.js";
import { handleGenesis } from "../packages/mcp/src/tools/genesis.js";
import { handlePay } from "../packages/mcp/src/tools/pay.js";
import { handleRedeemStatus } from "../packages/mcp/src/tools/redeem-status.js";
import { handleStamp } from "../packages/mcp/src/tools/stamp.js";
import { handleVerify } from "../packages/mcp/src/tools/verify.js";

const REDEEM_POLL_MS = 5_000;
const REDEEM_TIMEOUT_MS = 180_000;

function show(label: string, result: { content: { text: string }[]; isError?: boolean }) {
  console.log(`\n━━ ${label} ━━`);
  console.log(result.content[0].text);
  if (result.isError) throw new Error(`${label} returned an error`);
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

function customerPosture(): boolean {
  if (process.argv.includes("--customer")) return true;
  try {
    getOperatorConfig();
    return false;
  } catch {
    return true; // OPERATOR_ID unset or placeholder — this clone is a customer
  }
}

async function awaitExternalRedeem(): Promise<Record<string, unknown>> {
  console.log(
    "\n━━ customer posture — waiting for the operator's redeem watcher (npm run redeem:watch on the ORG side) ━━",
  );
  const deadline = Date.now() + REDEEM_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const result = await handleRedeemStatus();
    if (!result.isError) {
      const status = JSON.parse(result.content[0].text) as Record<string, unknown>;
      if (status.redeemed) return show("witness_redeem_status", result);
    }
    await new Promise((r) => setTimeout(r, REDEEM_POLL_MS));
  }
  throw new Error(
    `Delivery not redeemed within ${REDEEM_TIMEOUT_MS / 1000}s — is the operator's watcher running (npm run redeem:watch)?`,
  );
}

async function main() {
  const customer = customerPosture();
  const leg = process.argv.includes("--usdc") ? "usdc" : undefined; // default: HBAR
  console.log(
    `${customer ? "posture: customer (payer creds only)" : "posture: operator (single process)"} · pay leg: ${leg ?? "hbar"}`,
  );

  show("witness_requirements", await handleRequirements());
  show("witness_assert_claim(light)", await handleAssertClaim("light"));

  const laneA = show("witness_stamp(A, light)", await handleStamp("A", "light"));
  show(
    "witness_verify(lane A)",
    await handleVerify(laneA.consensusTimestamp as string, "A"),
  );

  const genesis = show("witness_genesis", await handleGenesis());
  show("witness_pay", await handlePay(undefined, leg));

  let status: Record<string, unknown>;
  if (customer) {
    status = await awaitExternalRedeem();
  } else {
    console.log("\n━━ ORG-side: redeem watcher pass ━━");
    execFileSync("npx", ["tsx", "scripts/redeem.ts", "--alias", genesis.alias as string], {
      stdio: "inherit",
      shell: true,
    });
    status = show("witness_redeem_status", await handleRedeemStatus());
  }
  if (!status.redeemed) throw new Error("Delivery not redeemed");

  const laneB = show("witness_stamp(B, paint)", await handleStamp("B", "paint"));
  show(
    "witness_verify(lane B)",
    await handleVerify(laneB.consensusTimestamp as string, "B"),
  );

  console.log("\nMCP SMOKE COMPLETE — both lanes driven through the plugin's own tool handlers.");
}

main().catch((err) => {
  console.error("mcp-smoke failed:", err);
  process.exit(1);
});
