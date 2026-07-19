/**
 * mcp-smoke.ts — drive the witness-mcp tool handlers through the FULL agent
 * story, exactly as goose will call them (demo beats 1–4, both lanes):
 *
 *   requirements → assert claim → Lane A stamp → verify
 *   genesis → pay (x402 leg) → [ORG redeems] → redeem_status → Lane B stamp → verify
 *
 * The ORG redemption between pay and redeem_status is the one ORG-side step;
 * here we invoke scripts/redeem.ts inline the way the demo's watcher would.
 */

import { execFileSync } from "node:child_process";
import { handleRequirements } from "../packages/mcp/src/tools/requirements.js";
import { handleAssertClaim } from "../packages/mcp/src/tools/assert-claim.js";
import { handleGenesis } from "../packages/mcp/src/tools/genesis.js";
import { handlePay } from "../packages/mcp/src/tools/pay.js";
import { handleRedeemStatus } from "../packages/mcp/src/tools/redeem-status.js";
import { handleStamp } from "../packages/mcp/src/tools/stamp.js";
import { handleVerify } from "../packages/mcp/src/tools/verify.js";

function show(label: string, result: { content: { text: string }[]; isError?: boolean }) {
  console.log(`\n━━ ${label} ━━`);
  console.log(result.content[0].text);
  if (result.isError) throw new Error(`${label} returned an error`);
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

async function main() {
  show("witness_requirements", await handleRequirements());
  show("witness_assert_claim(light)", await handleAssertClaim("light"));

  const laneA = show("witness_stamp(A, light)", await handleStamp("A", "light"));
  show(
    "witness_verify(lane A)",
    await handleVerify(laneA.consensusTimestamp as string, "A"),
  );

  const genesis = show("witness_genesis", await handleGenesis());
  show("witness_pay", await handlePay());

  console.log("\n━━ ORG-side: redeem watcher pass ━━");
  execFileSync("npx", ["tsx", "scripts/redeem.ts", "--alias", genesis.alias as string], {
    stdio: "inherit",
    shell: true,
  });

  const status = show("witness_redeem_status", await handleRedeemStatus());
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
