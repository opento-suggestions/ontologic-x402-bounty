/**
 * revoke-mandate.ts — the root's one-message kill switch (PHASE_2 §5).
 *
 * Root-submitted revocation referencing a mandateHash. Effective at its own
 * consensus timestamp, never retroactive: verdicts rendered in-window stand
 * forever; everything signed after this instant is machine-detectably
 * unauthorized. Re-granting afterwards requires a FRESH nonce — the revoked
 * grant's content-identity is permanently dead.
 *
 *   npx tsx scripts/revoke-mandate.ts [<mandateHash>]   (default: WITNESS_MANDATE_HASH)
 */

import { TopicMessageSubmitTransaction } from "@hashgraph/sdk";
import { canonicalizeJSON } from "../packages/core/src/morpheme.js";
import { buildMandateRevocation } from "../packages/core/src/schema.js";
import { resolveMandate } from "../packages/core/src/resolve.js";
import { getAuthorityConfig, getNetworkConfig } from "../packages/core/src/config.js";
import { appendEvidence, awaitMirrorMessage, consensusString, hashscanTx, openRootClient } from "./lib/ops.js";

async function main() {
  const auth = getAuthorityConfig();
  if (!auth.witnessRulesTopicId) throw new Error("WITNESS_RULES_TOPIC not set.");
  const registry = auth.witnessRulesTopicId;
  const mandateHash = process.argv[2] ?? auth.mandateHash;
  if (!mandateHash) throw new Error("No mandateHash: pass one or set WITNESS_MANDATE_HASH.");

  const net = getNetworkConfig();

  // Typo protection: never stamp a revocation for a grant that does not
  // resolve — a revocation referencing nothing is noise on an immutable topic.
  const resolved = await resolveMandate(mandateHash, registry, { mirrorNodeUrl: net.mirrorNodeUrl });
  if (!resolved) throw new Error(`${mandateHash} does not resolve to a mandate on ${registry}. Refusing.`);
  if (resolved.revocationConsensusTimestamp) {
    throw new Error(`Already revoked at ${resolved.revocationConsensusTimestamp}. A second revocation adds nothing.`);
  }
  console.log(`Revoking mandate ${mandateHash}`);
  console.log(`  grantee: ${resolved.mandate.grantee} · window was [${resolved.mandate.notBefore}, ${resolved.mandate.notAfter})`);

  const { client, rootId } = openRootClient();
  const revocation = buildMandateRevocation({ mandateHash, revokedBy: rootId, createdAt: new Date().toISOString() });
  const tx = await new TopicMessageSubmitTransaction()
    .setTopicId(registry)
    .setMessage(Buffer.from(canonicalizeJSON(revocation), "utf8"))
    .execute(client);
  const record = await tx.getRecord(client);
  const consensus = consensusString(record);
  await awaitMirrorMessage(net.mirrorNodeUrl, registry, consensus);

  console.log(`  revoked @ ${consensus}`);
  console.log(`  tx: ${hashscanTx(tx.transactionId.toString())}`);
  console.log("  Every verdict at or after this instant is machine-detectably out-of-mandate.");
  console.log("  Verdicts rendered in-window stand — revocation is never retroactive.");
  appendEvidence(`revoke mandate ${mandateHash} (root kill switch)`, consensus, hashscanTx(tx.transactionId.toString()));
  client.close();
}

main().catch((err) => {
  console.error("revoke-mandate failed:", err);
  process.exit(1);
});
