/**
 * peg.ts — the price authority's CLI entry (W-7's sunshine).
 *
 * The peg itself lives in packages/ops/src/peg.ts — one source both the
 * topics' fees and this published list are built from. Running this entry
 * prints the current prices and emits BOTH the machine config
 * (config.witness.json) and the site's payment-requirements.json, so the
 * published list cannot drift from the charged fees.
 *
 *   npm run peg
 */

import fs from "node:fs";
import path from "node:path";
import { getWitnessConfig, getOperatorConfig } from "../packages/core/src/config.js";
import { buildPaymentRequirements, PEG } from "../packages/ops/src/peg.js";
import { REPO_ROOT, writeJson } from "../packages/ops/src/plumbing.js";

// The site lives in a SEPARATE repo (ontologic-dev) whose location is
// machine-specific — never hardcoded here. ORG sets ONTOLOGIC_DEV_SITE_DIR
// in .env (e.g. <ontologic-dev checkout>/static/witness); when unset, only
// the canonical in-repo copy is written and the site copy is skipped.
const SITE_DIR = process.env.ONTOLOGIC_DEV_SITE_DIR || null;

async function main() {
  const witness = getWitnessConfig();
  const treasury = getOperatorConfig().id;
  if (!witness.hbarTopicId || !witness.keyTopicId || !witness.keyTokenId) {
    throw new Error("Topics/token not configured in .env");
  }

  console.log(`Peg: $${PEG.hbarUsd}/HBAR (manual, testnet demo semantics)`);
  console.log(`Lane A fee: ${PEG.laneA.feeHbar} HBAR ($${PEG.laneA.marginUsd} margin)`);
  console.log(`Lane B fee: ${PEG.laneB.feeKey} wKEY · vend price: $${PEG.vending.priceUsd}`);

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
  if (SITE_DIR) {
    fs.mkdirSync(SITE_DIR, { recursive: true });
    fs.writeFileSync(path.join(SITE_DIR, "payment-requirements.json"), JSON.stringify(requirements, null, 2) + "\n");
    console.log(`wrote ${path.join(SITE_DIR, "payment-requirements.json")}`);
  } else {
    console.log("site copy skipped — set ONTOLOGIC_DEV_SITE_DIR in .env to also write the site's payment-requirements.json");
  }
}

main().catch((err) => {
  console.error("peg failed:", err);
  process.exit(1);
});
