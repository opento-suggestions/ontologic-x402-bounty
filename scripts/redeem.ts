/**
 * redeem.ts — CLI entry for ORG's vend-fulfillment service.
 *
 * Usage: npx tsx scripts/redeem.ts [--alias 0x...] [--watch] [--dry-run]
 *
 * The engine is packages/ops/src/redeem.ts (redeemPass): scan settled
 * x402:witness-required:vend:<alias> receipts, net against deliveries-ever,
 * vend what is owed, burn what the fees collected. This entry parses flags,
 * opens the operator context, and runs the pass — once, or on a 5s watch
 * loop with a graceful stop (never kill a pass mid-flight).
 */

import { openOperatorContext } from "../packages/ops/src/operator.js";
import { redeemPass } from "../packages/ops/src/redeem.js";

async function main() {
  const args = process.argv.slice(2);
  const watch = args.includes("--watch");
  const dryRun = args.includes("--dry-run");
  const aliasIdx = args.indexOf("--alias");
  const onlyAlias = aliasIdx !== -1 ? args[aliasIdx + 1]?.toLowerCase() : null;

  const ctx = openOperatorContext();

  if (watch) {
    console.log("Redemption watcher running (5s poll) — press q (or Ctrl+C) to stop gracefully...");

    // Graceful stop: never kill a pass mid-flight — a vend or burn in progress
    // completes, THEN the loop exits and the client closes.
    let stopping = false;
    const requestStop = (why: string) => {
      if (stopping) return;
      stopping = true;
      console.log(`\nStopping after the current pass (${why})...`);
    };
    if (process.stdin.isTTY) process.stdin.setRawMode(true); // raw: q works without Enter; Ctrl+C arrives as \u0003, not SIGINT
    process.stdin.resume();
    process.stdin.on("data", (buf: Buffer) => {
      const key = buf.toString("utf8");
      if (key.toLowerCase().includes("q")) requestStop("q pressed");
      else if (key.includes("\u0003")) requestStop("Ctrl+C");
    });
    process.on("SIGINT", () => requestStop("SIGINT"));
    process.on("SIGTERM", () => requestStop("SIGTERM"));

    while (!stopping) {
      try {
        await redeemPass(ctx, { onlyAlias, dryRun });
      } catch (err) {
        console.error("pass failed:", (err as Error).message);
      }
      // Sleep in short slices so a stop request is honored promptly.
      for (let i = 0; i < 10 && !stopping; i++) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    ctx.client.close();
    console.log("Watcher stopped cleanly.");
  } else {
    const result = await redeemPass(ctx, { onlyAlias, dryRun });
    console.log(`Done. ${result.receiptsScanned} settled vend receipt(s) scanned. (Use --watch to keep the watcher open.)`);
    ctx.client.close();
  }
}

main().catch((err) => {
  console.error("redeem failed:", err);
  process.exit(1);
});
