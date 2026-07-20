/**
 * emit-requirements.ts — publish the price list (W-7's sunshine).
 *
 * One price authority (peg.ts) emits BOTH the machine config and the site's
 * payment-requirements.json, so the published list cannot drift from the
 * fees the topics actually charge.
 */

import fs from "node:fs";
import path from "node:path";
import { getWitnessConfig, getOperatorConfig } from "../packages/core/src/config.js";
import { buildPaymentRequirements, PEG } from "./peg.js";
import { REPO_ROOT, writeJson } from "./lib/ops.js";

const SITE_DIR = "c:/The_Fountain/ontologic/ontologic-dev-main/static/witness";

async function main() {
  const witness = getWitnessConfig();
  const treasury = getOperatorConfig().id;
  if (!witness.hbarTopicId || !witness.keyTopicId || !witness.keyTokenId) {
    throw new Error("Topics/token not configured in .env");
  }

  const requirements = buildPaymentRequirements({
    hbarTopicId: witness.hbarTopicId,
    keyTopicId: witness.keyTopicId,
    keyTokenId: witness.keyTokenId,
    treasuryAccountId: treasury,
  });

  // The bounty repo's copy (canonical) …
  writeJson("config.witness.json", {
    network: "hedera-testnet",
    laneATopicId: witness.hbarTopicId,
    laneBTopicId: witness.keyTopicId,
    keyTokenId: witness.keyTokenId,
    vendingContractId: witness.vendingContractId,
    treasuryAccountId: treasury,
    peg: PEG,
    requirements,
  });
  console.log(`wrote ${path.join(REPO_ROOT, "config.witness.json")}`);

  // … and the site's (same bytes, W-7).
  fs.mkdirSync(SITE_DIR, { recursive: true });
  fs.writeFileSync(path.join(SITE_DIR, "payment-requirements.json"), JSON.stringify(requirements, null, 2) + "\n");
  console.log(`wrote ${path.join(SITE_DIR, "payment-requirements.json")}`);
}

main().catch((err) => {
  console.error("emit-requirements failed:", err);
  process.exit(1);
});
