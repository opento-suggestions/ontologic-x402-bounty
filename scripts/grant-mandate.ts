/**
 * grant-mandate.ts — ceremony §3.5 (3): the mandate-morpheme.
 *
 * ⚠ CEREMONY SCRIPT — HUMAN GATE REQUIRED (CLAUDE.md). The first mandate is
 * the grant every later verdict resolves against, and its consensus timestamp
 * becomes the pre-mandate era boundary (pinned as an anchor).
 *
 * Root-submitted. Grants `verdict:rejection-attestation` to the OPERATOR,
 * scoped to the Verdict Topic, with an explicit window. Window values are
 * ARGUMENTS (§6.4, resolved 2026-07-25: ~30 days default) — governance lives
 * at grant time, not in code. The nonce is required because mandate identity
 * is content-derived: a revoked grant's identity is dead forever.
 *
 *   npx tsx scripts/grant-mandate.ts [--not-before <iso|epochSec>] [--not-after <iso|epochSec>] [--nonce <string>]
 */

import crypto from "node:crypto";
import { TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { canonicalizeJSON } from "../packages/core/src/morpheme.js";
import { buildMandateMorpheme } from "../packages/core/src/schema.js";
import { resolveRule } from "../packages/core/src/resolve.js";
import { judgeMessage } from "../packages/core/src/verify.js";
import { getAuthorityConfig, getNetworkConfig, getOperatorConfig } from "../packages/core/src/config.js";
import { appendEvidence, awaitMirrorMessage, consensusString, hashscanTx, openRootClient, updateEnv } from "./lib/ops.js";

const DELEGATION_RULE_ID = "witness://org/authority/delegation";
const THIRTY_DAYS_SEC = 30 * 24 * 60 * 60;

function toEpochSeconds(value: string): string {
  if (/^\d+(\.\d+)?$/.test(value)) return value;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) throw new Error(`Cannot parse timestamp argument: ${value} (use ISO 8601 or epoch seconds).`);
  return Math.floor(ms / 1000).toString();
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const auth = getAuthorityConfig();
  if (!auth.witnessRulesTopicId || !auth.verdictTopicId) {
    throw new Error("WITNESS_RULES_TOPIC / WITNESS_VERDICT_TOPIC not set — the ceremony runs §3.2–§3.4 first.");
  }
  const registry = auth.witnessRulesTopicId;
  const verdictTopic = auth.verdictTopicId;
  const operatorId = getOperatorConfig().id;
  const net = getNetworkConfig();
  const { client, rootId } = openRootClient();

  const nowSec = Math.floor(Date.now() / 1000);
  const notBefore = toEpochSeconds(arg("not-before") ?? String(nowSec));
  const notAfter = toEpochSeconds(arg("not-after") ?? String(nowSec + THIRTY_DAYS_SEC));
  const nonce = arg("nonce") ?? crypto.randomBytes(16).toString("hex");

  // The delegation rule must already live on the registry — R first, grant second.
  const { ruleDef, ruleUri } = await resolveRule(DELEGATION_RULE_ID, registry, { mirrorNodeUrl: net.mirrorNodeUrl });
  if (typeof ruleDef.domain !== "string" || !ruleDef.domain.startsWith("witness.")) {
    throw new Error(`Delegation rule resolved with domain ${ruleDef.domain} — not a witness.* rule. Refusing.`);
  }

  // Construction enforces W-11's principal≠grantee, the closed scope, the
  // non-empty window; the mandateHash IS the bindingHash (no new primitive).
  const mandate = buildMandateMorpheme({
    ruleId: ruleDef.ruleId,
    ruleUri,
    principal: rootId,
    grantee: operatorId,
    scope: { verdictClass: "rejection-attestation", topicId: verdictTopic },
    notBefore,
    notAfter,
    nonce,
    createdAt: new Date().toISOString(),
  });

  console.log(`Granting verdict:rejection-attestation to ${operatorId}`);
  console.log(`  window: [${notBefore}, ${notAfter}) · nonce: ${nonce}`);
  console.log(`  mandateHash: ${mandate.bindingHash}`);

  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(registry)
    .setMessage(Buffer.from(canonicalizeJSON(mandate), "utf8"))
    .execute(client);
  const record = await tx.getRecord(client);
  const consensus = consensusString(record);
  console.log(`  granted @ ${consensus}`);
  console.log(`  tx: ${hashscanTx(tx.transactionId.toString())}`);

  // Read-back: the grant must judge as kind `mandate` from public mirror
  // data alone, with the same verifier every reader runs.
  const msg = await awaitMirrorMessage(net.mirrorNodeUrl, registry, consensus);
  const verdict = await judgeMessage(msg, registry, {
    mirrorNodeUrl: net.mirrorNodeUrl,
    witnessRegistryTopicId: registry,
    verdictTopicId: verdictTopic,
  });
  if (verdict.kind !== "mandate") {
    throw new Error(`Read-back FAILED: the grant judges '${verdict.kind}' (${verdict.reasons.join(", ")}). Investigate before any verdict is rendered.`);
  }
  console.log("  read-back ✓ — the grant judges as a mandate, keyless");

  const envUpdate: Record<string, string> = { WITNESS_MANDATE_HASH: mandate.bindingHash };
  if (!auth.firstMandateTimestamp) {
    envUpdate.WITNESS_FIRST_MANDATE_TS = consensus;
    console.log("\n══════════════════════════════════════════════════════════════");
    console.log("  FIRST MANDATE — THE PRE-MANDATE ERA ENDS AT");
    console.log(`    ${consensus}`);
    console.log("  Pin firstMandateTimestamp (with both topic IDs) into");
    console.log("  packages/core/src/anchors.ts and the wall's anchors —");
    console.log("  a verifier-release event (W-12).");
    console.log("══════════════════════════════════════════════════════════════");
  }
  updateEnv(envUpdate);
  appendEvidence(
    `grant mandate verdict:rejection-attestation → ${operatorId}, window [${notBefore},${notAfter}) (ceremony §3.5.3)`,
    mandate.bindingHash,
    hashscanTx(tx.transactionId.toString()),
  );
  client.close();
}

main().catch((err) => {
  console.error("grant-mandate failed:", err);
  process.exit(1);
});
