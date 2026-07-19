/**
 * resolve.ts — rule resolution against the LIVE v0.8.3 sphere (read only).
 *
 * TypeScript port of ontologicv0.5_clean scripts/v0.7/lib/resolve.js
 * (Algorithms 11.1 ruleUri→RuleDef and 11.2 ruleId+latest→ruleUri), on top of
 * the mirror client and the morpheme seam.
 */

import { canonicalizeJSON, computeRuleUriHash, keccak256Canonical } from "./morpheme.js";
import { fetchAllTopicMessages, fetchMessageAtTimestamp, decodeMessage } from "./mirror.js";

export interface HcsUriParts {
  topicId: string;
  timestamp: string;
}

export function parseHcsUri(ruleUri: string): HcsUriParts {
  const match = ruleUri.match(/^hcs:\/\/(\d+\.\d+\.\d+)\/(\d+\.\d+)$/);
  if (!match) {
    throw new Error(`Invalid ruleUri format: ${ruleUri}. Expected: hcs://<topicId>/<timestamp>`);
  }
  return { topicId: match[1], timestamp: match[2] };
}

export function buildHcsUri(topicId: string, timestamp: string): string {
  return `hcs://${topicId}/${timestamp}`;
}

export interface RuleDef {
  schema: string;
  schemaVersion: string;
  ruleId: string;
  version: string;
  versionNumber: number;
  domain: string;
  operator: string;
  ruleUri?: string;
  ruleUriHash?: string;
  contentHash?: string;
  [key: string]: unknown;
}

export interface RegistryEntry {
  schema: string;
  ruleId: string;
  version: string;
  versionNumber: number;
  ruleUri: string;
  status: string;
  isLatest?: boolean;
  supersededBy?: string | null;
  [key: string]: unknown;
}

export interface ResolveOptions {
  mirrorNodeUrl: string;
  skipVerification?: boolean;
}

/** Algorithm 11.1: ruleUri → RuleDef, with ruleUriHash + contentHash verification. */
export async function resolveRuleDef(ruleUri: string, options: ResolveOptions): Promise<RuleDef> {
  const { topicId, timestamp } = parseHcsUri(ruleUri);
  const body = await fetchMessageAtTimestamp(options.mirrorNodeUrl, topicId, timestamp);

  let ruleDef: RuleDef;
  try {
    ruleDef = JSON.parse(body) as RuleDef;
  } catch (e) {
    throw new Error(`Failed to parse RuleDef JSON at ${ruleUri}: ${(e as Error).message}`);
  }

  if (ruleDef.schema !== "hcs.ontologic.ruleDef") {
    throw new Error(`Invalid schema: ${ruleDef.schema}. Expected: hcs.ontologic.ruleDef`);
  }

  if (!options.skipVerification && ruleDef.ruleUriHash) {
    const computed = computeRuleUriHash(ruleUri);
    if (computed.toLowerCase() !== ruleDef.ruleUriHash.toLowerCase()) {
      throw new Error(`ruleUriHash mismatch. Computed: ${computed}, Found: ${ruleDef.ruleUriHash}`);
    }
  }

  if (!options.skipVerification && ruleDef.contentHash) {
    const verifyObj: Record<string, unknown> = { ...ruleDef };
    delete verifyObj.ruleUri;
    delete verifyObj.ruleUriHash;
    delete verifyObj.contentHash;
    const computed = keccak256Canonical(verifyObj);
    if (computed.toLowerCase() !== ruleDef.contentHash.toLowerCase()) {
      throw new Error(`contentHash mismatch. Computed: ${computed}, Found: ${ruleDef.contentHash}`);
    }
  }

  return ruleDef;
}

/** Algorithm 11.2: ruleId + "latest" → ruleUri via the registry topic. */
export async function resolveLatestRule(
  ruleId: string,
  registryTopicId: string,
  options: ResolveOptions & { version?: string },
): Promise<string> {
  const messages = await fetchAllTopicMessages(options.mirrorNodeUrl, registryTopicId);

  const entries: RegistryEntry[] = [];
  for (const msg of messages) {
    try {
      const entry = JSON.parse(decodeMessage(msg)) as RegistryEntry;
      if (
        entry.schema === "hcs.ontologic.ruleRegistryEntry" &&
        entry.ruleId === ruleId &&
        entry.status === "active"
      ) {
        entries.push(entry);
      }
    } catch {
      continue; // skip malformed messages silently
    }
  }

  if (entries.length === 0) {
    throw new Error(`Rule not found in registry: ${ruleId}`);
  }

  if (options.version && options.version !== "latest") {
    const selected = entries.find((e) => e.version === options.version);
    if (!selected) {
      throw new Error(`Version ${options.version} not found for rule: ${ruleId}`);
    }
    return selected.ruleUri;
  }

  const latest =
    entries.find((e) => e.isLatest === true) ??
    entries.reduce((max, e) => (e.versionNumber > max.versionNumber ? e : max));
  return latest.ruleUri;
}

export interface ResolvedRule {
  ruleDef: RuleDef;
  ruleUri: string;
  ruleUriHash: string;
}

/** Resolve either a direct hcs:// ruleUri or a sphere:// ruleId via the registry. */
export async function resolveRule(
  ruleRef: string,
  registryTopicId: string,
  options: ResolveOptions,
): Promise<ResolvedRule> {
  const ruleUri = ruleRef.startsWith("hcs://")
    ? ruleRef
    : await resolveLatestRule(ruleRef, registryTopicId, options);

  const ruleDef = await resolveRuleDef(ruleUri, options);
  return { ruleDef, ruleUri, ruleUriHash: computeRuleUriHash(ruleUri) };
}

export interface EvidenceRef {
  ruleId: string;
  bindingHash: string | null;
  outputToken: string;
  hcsSeq: number | null;
}

/**
 * Auto-resolve entity-bundle evidence from the PROOF topic: for each evidence
 * entry with bindingHash === null, find the latest MorphemeProof matching that
 * ruleId and populate bindingHash + hcsSeq from the on-chain record.
 */
export async function resolveEvidence(
  proofs: EvidenceRef[],
  proofTopicId: string,
  options: ResolveOptions,
): Promise<EvidenceRef[]> {
  const needed = new Set(proofs.filter((p) => p.bindingHash === null).map((p) => p.ruleId));
  if (needed.size === 0) return proofs;

  const messages = await fetchAllTopicMessages(options.mirrorNodeUrl, proofTopicId);
  const byRuleId = new Map<string, { bindingHash: string; hcsSeq: number }>();

  for (const msg of messages) {
    try {
      const entry = JSON.parse(decodeMessage(msg)) as { schema?: string; ruleId?: string; bindingHash?: string };
      if (entry.schema === "hcs.ontologic.morphemeProof" && entry.ruleId && needed.has(entry.ruleId)) {
        const seq = Number(msg.sequence_number);
        const existing = byRuleId.get(entry.ruleId);
        if (!existing || seq > existing.hcsSeq) {
          byRuleId.set(entry.ruleId, { bindingHash: entry.bindingHash as string, hcsSeq: seq });
        }
      }
    } catch {
      continue;
    }
  }

  for (const proof of proofs) {
    if (proof.bindingHash === null) {
      const resolved = byRuleId.get(proof.ruleId);
      if (!resolved) {
        throw new Error(`Evidence not found on PROOF topic for ruleId: ${proof.ruleId}`);
      }
      proof.bindingHash = resolved.bindingHash;
      proof.hcsSeq = resolved.hcsSeq;
    }
  }
  return proofs;
}

export { canonicalizeJSON };
