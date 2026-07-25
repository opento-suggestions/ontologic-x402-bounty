/**
 * publish-witness-rules.ts — ceremony §3.5 (1–2): the two witness RuleDefs.
 *
 * ⚠ CEREMONY SCRIPT — HUMAN GATE REQUIRED (CLAUDE.md). The first messages on
 * an immutable topic are the ground every later verdict resolves against.
 * The content comes from rules/*.draft.json — steward-ratified, never
 * improvised here. This script only fills the publish-time fields:
 * author (ROOT_ID), createdAt, contentHash (self-hashing via the seam's
 * computeContentHash), then the follow-up ruleRegistryEntry with ruleUri +
 * ruleUriHash — the colour sphere's own two-message pattern, on ONE topic
 * (§6.5, confirmed 2026-07-25).
 *
 * Idempotent by public state: a rule that already resolves on the registry
 * is refused, not re-published.
 */

import { TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { canonicalizeJSON, computeContentHash, computeRuleUriHash } from "../packages/core/src/morpheme.js";
import { buildHcsUri, resolveLatestRule, resolveRuleDef, type RuleDef } from "../packages/core/src/resolve.js";
import { getAuthorityConfig, getNetworkConfig } from "../packages/core/src/config.js";
import { appendEvidence, awaitMirrorMessage, consensusString, hashscanTx, openRootClient, readJson } from "./lib/ops.js";

const DRAFTS = ["rules/witness-lane-conformance.draft.json", "rules/witness-delegation.draft.json"];

async function main() {
  const auth = getAuthorityConfig();
  if (!auth.witnessRulesTopicId) {
    throw new Error("WITNESS_RULES_TOPIC not set — run scripts/create-authority-topics.ts (ceremony §3.2) first.");
  }
  const registry = auth.witnessRulesTopicId;
  const net = getNetworkConfig();
  const { client, rootId } = openRootClient();

  for (const draftPath of DRAFTS) {
    const draft = readJson<RuleDef & Record<string, unknown>>(draftPath);
    console.log(`\n── ${draft.ruleId} (${draftPath})`);

    if (!String(draft.domain).startsWith("witness.")) {
      throw new Error(`${draft.ruleId} declares domain ${draft.domain} — witness rules must be witness.* (cross-registry defense).`);
    }

    // Single-shot by public state.
    let already = false;
    try {
      await resolveLatestRule(draft.ruleId, registry, { mirrorNodeUrl: net.mirrorNodeUrl });
      already = true;
    } catch {
      /* not on the registry yet — proceed */
    }
    if (already) {
      throw new Error(`${draft.ruleId} already resolves on ${registry}. Refusing to double-publish a genesis rule.`);
    }

    // Publish-time fields, then the self-hash. contentHash is computed over
    // the content EXACTLY as it will sit on-chain (minus the three
    // self-referential fields the seam's computeContentHash excludes).
    const ruleDef: Record<string, unknown> = { ...draft, author: rootId, createdAt: new Date().toISOString() };
    ruleDef.contentHash = computeContentHash(ruleDef);

    const defTx = await new TopicMessageSubmitTransaction()
      .setTopicId(registry)
      .setMessage(Buffer.from(canonicalizeJSON(ruleDef), "utf8"))
      .execute(client);
    const defRecord = await defTx.getRecord(client);
    const defConsensus = consensusString(defRecord);
    const ruleUri = buildHcsUri(registry, defConsensus);
    console.log(`  ruleDef @ ${defConsensus}`);
    console.log(`  ruleUri: ${ruleUri}`);
    console.log(`  tx: ${hashscanTx(defTx.transactionId.toString())}`);

    const entry = {
      schema: "hcs.ontologic.ruleRegistryEntry",
      schemaVersion: "1",
      ruleId: draft.ruleId,
      version: draft.version,
      versionNumber: draft.versionNumber,
      ruleUri,
      ruleUriHash: computeRuleUriHash(ruleUri),
      status: "active",
      isLatest: true,
      supersededBy: null,
      createdAt: new Date().toISOString(),
    };
    const entryTx = await new TopicMessageSubmitTransaction()
      .setTopicId(registry)
      .setMessage(Buffer.from(canonicalizeJSON(entry), "utf8"))
      .execute(client);
    const entryRecord = await entryTx.getRecord(client);
    console.log(`  registryEntry @ ${consensusString(entryRecord)}`);
    console.log(`  tx: ${hashscanTx(entryTx.transactionId.toString())}`);

    // Read-back: the rule must round-trip keyless — resolve by ruleId off the
    // public mirror and self-verify (ruleUriHash + contentHash) before we
    // call it published.
    await awaitMirrorMessage(net.mirrorNodeUrl, registry, defConsensus);
    const resolvedUri = await resolveLatestRule(draft.ruleId, registry, { mirrorNodeUrl: net.mirrorNodeUrl });
    if (resolvedUri !== ruleUri) {
      throw new Error(`Read-back mismatch: registry resolves ${draft.ruleId} to ${resolvedUri}, expected ${ruleUri}.`);
    }
    const resolved = await resolveRuleDef(ruleUri, { mirrorNodeUrl: net.mirrorNodeUrl });
    console.log(`  read-back ✓ (self-verified: contentHash ${String(resolved.contentHash).slice(0, 16)}…)`);

    appendEvidence(`publish witness RuleDef ${draft.ruleId} (ceremony §3.5)`, ruleUri, hashscanTx(defTx.transactionId.toString()));
  }

  console.log("\nBoth witness rules live and self-verifying. Next (ceremony §3.5.3): scripts/grant-mandate.ts");
  client.close();
}

main().catch((err) => {
  console.error("publish-witness-rules failed:", err);
  process.exit(1);
});
