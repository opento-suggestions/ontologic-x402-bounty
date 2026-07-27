/**
 * claims.ts — the W-9 closed claim space.
 *
 * MVP admits exactly two claims: a trace proof of WHITE in the light domain or
 * the paint domain, over the live v0.8.3 taxonomy. Anything else refuses to
 * construct — invalid claims never submit (spec §3.1 step 2).
 *
 * Bundle shapes ported from ontologicv0.5_clean examples/v07/
 * bundle-white-entity.json and bundle-white-paint-entity.json; the hash
 * computation is the RegistryProof path of scripts/v0.7.1/reason-registry.js,
 * byte-identical by construction (same canonicalization, same field order
 * irrelevance, same keccak/sha256 split via the seam).
 */

import {
  computeInputsHash,
  computeOutputsHash,
  computeBindingHash,
} from "./morpheme.js";
import { resolveRule, resolveEvidence, type EvidenceRef, type ResolveOptions } from "./resolve.js";
import {
  buildStatusProfile,
  buildWitnessStamp,
  MORPHEME_PROOF_SCHEMA,
  MORPHEME_PROOF_VERSION,
  type MorphemeProof,
  type StatusValue,
  type WitnessStamp,
} from "./schema.js";

// ─── The closed claim space (W-9): two claims, enumerated, nothing else ───

export type WhiteTraceDomain = "light" | "paint";

interface ClaimTemplate {
  ruleRef: string;
  domain: string;
  evidence: EvidenceRef[];
  output: Record<string, unknown>;
}

/** WHITE token in the live v0.8 sphere. */
const WHITE = {
  tokenSymbol: "WHITE",
  tokenId: "0.0.8641323",
  tokenAddr: "0x000000000000000000000000000000000083db2b",
};

const CLAIMS: Record<WhiteTraceDomain, ClaimTemplate> = {
  light: {
    ruleRef: "sphere://demo/entity/white-from-cmy",
    domain: "color.entity.light",
    evidence: [
      { ruleId: "sphere://demo/light/red-green-yellow", bindingHash: null, outputToken: "YELLOW", hcsSeq: null },
      { ruleId: "sphere://demo/light/green-blue-cyan", bindingHash: null, outputToken: "CYAN", hcsSeq: null },
      { ruleId: "sphere://demo/light/red-blue-magenta", bindingHash: null, outputToken: "MAGENTA", hcsSeq: null },
    ],
    output: { ...WHITE, amount: 1, properties: { rgb_r: 255, rgb_g: 255, rgb_b: 255 } },
  },
  paint: {
    ruleRef: "sphere://demo/entity/white-from-paint",
    domain: "color.entity.paint",
    evidence: [
      { ruleId: "sphere://demo/paint/cyan-magenta-blue", bindingHash: null, outputToken: "BLUE", hcsSeq: null },
      { ruleId: "sphere://demo/paint/cyan-yellow-green", bindingHash: null, outputToken: "GREEN", hcsSeq: null },
      { ruleId: "sphere://demo/paint/magenta-yellow-red", bindingHash: null, outputToken: "RED", hcsSeq: null },
    ],
    output: { ...WHITE, amount: 1, properties: { cmyk_c: 0, cmyk_m: 0, cmyk_y: 0, cmyk_k: 0 } },
  },
};

/**
 * Human/agent-legible identity of each claim in the closed space. The
 * taxonomy's rule names invert color-model intuition (the LIGHT rule is
 * "white-from-cmy"; the PAINT evidence is BLUE/GREEN/RED), so every surface
 * that helps a caller CHOOSE speaks color-model language explicitly.
 */
export function describeClaim(domain: WhiteTraceDomain): string {
  return domain === "light"
    ? "WHITE in the ADDITIVE light domain (RGB light / screens) — evidence: the YELLOW/CYAN/MAGENTA secondaries produced by RGB mixes (rule sphere://demo/entity/white-from-cmy)"
    : "WHITE in the SUBTRACTIVE paint domain (CMY pigment / print) — evidence: the BLUE/GREEN/RED entities produced by CMY paint mixes (rule sphere://demo/entity/white-from-paint)";
}

export function allowedClaims(): string[] {
  return (Object.keys(CLAIMS) as WhiteTraceDomain[]).map((domain) => `${domain}: ${describeClaim(domain)}`);
}

// ─── Claim construction ───

export interface BuiltClaim {
  domain: WhiteTraceDomain;
  ruleId: string;
  ruleUri: string;
  bundle: { ruleRef: string; inputs: unknown[]; output: Record<string, unknown> };
  inputsHash: string;
  outputsHash: string;
  bindingHash: string;
  ruleUriHash: string;
}

export interface BuildClaimParams {
  domain: WhiteTraceDomain;
  registryTopicId: string;
  proofTopicId: string;
  resolve: ResolveOptions;
}

/**
 * Build a WHITE trace claim: resolve the rule against the live registry
 * (active + latest), resolve evidence bindingHashes from the live PROOF topic,
 * compute the three hashes. Throws — refuses to construct — for any domain
 * outside the closed space or any rule/evidence that fails to resolve.
 */
export async function buildWhiteTraceClaim(params: BuildClaimParams): Promise<BuiltClaim> {
  const template = CLAIMS[params.domain];
  if (!template) {
    throw new Error(
      `Claim outside the closed claim space (W-9). Allowed: ${allowedClaims().join(" · ")}`,
    );
  }

  const { ruleDef, ruleUri, ruleUriHash } = await resolveRule(
    template.ruleRef,
    params.registryTopicId,
    params.resolve,
  );

  if (ruleDef.domain !== template.domain) {
    throw new Error(
      `Resolved rule domain ${ruleDef.domain} does not match expected ${template.domain} — refusing to construct.`,
    );
  }

  // Evidence refs are cloned so the template stays immutable across calls.
  const evidence: EvidenceRef[] = template.evidence.map((e) => ({ ...e }));
  await resolveEvidence(evidence, params.proofTopicId, params.resolve);

  const inputs = [{ label: "evidence", proofs: evidence }];
  const output = { ...template.output };

  const inputsHash = computeInputsHash(inputs);
  const outputsHash = computeOutputsHash(output);
  const bindingHash = computeBindingHash({ ruleUri, inputsHash, outputsHash });

  return {
    domain: params.domain,
    ruleId: ruleDef.ruleId,
    ruleUri,
    bundle: { ruleRef: template.ruleRef, inputs, output },
    inputsHash,
    outputsHash,
    bindingHash,
    ruleUriHash,
  };
}

// ─── Stamp assembly (proof + unsealed statusProfile envelope) ───

export interface StampParams {
  claim: BuiltClaim;
  callerAccountId: string;
  createdAt: string; // ISO — passed in, never generated here, so verifiers can rebuild
  network?: string;
  status?: StatusValue;
  statusNote?: string;
}

export function buildStampForClaim(params: StampParams): WitnessStamp {
  const proof: MorphemeProof = {
    schema: MORPHEME_PROOF_SCHEMA,
    schemaVersion: MORPHEME_PROOF_VERSION,
    proofMode: "registry",
    ruleId: params.claim.ruleId,
    ruleUri: params.claim.ruleUri,
    ruleUriHash: params.claim.ruleUriHash,
    inputsHash: params.claim.inputsHash,
    outputsHash: params.claim.outputsHash,
    bindingHash: params.claim.bindingHash,
    reasoningContractId: null,
    callerAccountId: params.callerAccountId,
    transactionId: null,
    network: params.network ?? "hedera-testnet",
    createdAt: params.createdAt,
  };
  return buildWitnessStamp(proof, buildStatusProfile(params.status ?? "declared", params.statusNote));
}
