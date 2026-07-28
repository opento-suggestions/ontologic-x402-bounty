/**
 * repeg-lane-b.ts — CLI entry for the re-peg lever: flip the Lane B topic
 * fee to 1 wKEY of the CURRENT key token via the retained fee schedule key.
 * The engine is packages/ops/src/repeg.ts.
 */

import { openOperatorContext } from "../packages/ops/src/operator.js";
import { repegLaneB } from "../packages/ops/src/repeg.js";

async function main() {
  const ctx = openOperatorContext();
  await repegLaneB(ctx);
  ctx.client.close();
}

main().catch((err) => {
  console.error("repeg-lane-b failed:", err);
  process.exit(1);
});
