/**
 * verify.ts — keyless verification off the public mirror node.
 *
 * The read-time judgment (spec §3.4): every message on a lane topic is judged
 * here, at read time, by anyone. No key, no API, no trust in ORG. The verdict
 * object is the shared basis for the MCP verify tool, the wall's classifier,
 * and the reject-attest script.
 *
 * Classification (W-10 discipline lives downstream: renderers act on the
 * verdict and never on the raw payload):
 *   valid      — parses as a WitnessStamp (or bare MorphemeProof), bindingHash
 *                recomputes, rule resolves active in the live registry
 *   rejection  — an ORG rejection attestation (rendered as a verdict-tile)
 *   invalid    — paid bytes that fail conformance (no tile, ever)
 */

import { keccak256, toUtf8Bytes } from "ethers";
import { computeBindingHash, computeRuleUriHash } from "./morpheme.js";
import { type ReasonCode } from "./reasons.js";
import { resolveRuleDef, type ResolveOptions } from "./resolve.js";
import {
  MORPHEME_PROOF_SCHEMA,
  REJECTION_SCHEMA,
  WITNESS_STAMP_SCHEMA,
  readStatusProfile,
  type MorphemeProof,
  type RejectionAttestation,
  type StatusProfile,
} from "./schema.js";
import { decodeMessage, type MirrorMessage } from "./mirror.js";

export type VerdictKind = "valid" | "rejection" | "invalid";

export interface Verdict {
  kind: VerdictKind;
  topicId: string;
  consensusTimestamp: string;
  sequenceNumber: number;
  payerAccountId: string | null;
  /** keccak256 of the raw message bytes — the only derivation invalid messages get. */
  messageHash: string;
  /**
   * Codes from the closed reason space (reasons.ts) — the wire format.
   * Never free text, never subject-message content (W-10, verdict path).
   * Display strings come from a renderer-side reasonText lookup.
   */
  reasons: ReasonCode[];
  proof?: MorphemeProof;
  statusProfile?: StatusProfile;
  rejection?: RejectionAttestation;
}

const HASH_RE = /^0x[0-9a-f]{64}$/i;

/** Judge one mirror message. Pure except for the rule-registry resolution. */
export async function judgeMessage(
  msg: MirrorMessage,
  topicId: string,
  options: ResolveOptions & { skipRuleResolution?: boolean },
): Promise<Verdict> {
  const raw = decodeMessage(msg);
  const base: Verdict = {
    kind: "invalid",
    topicId,
    consensusTimestamp: msg.consensus_timestamp,
    sequenceNumber: Number(msg.sequence_number),
    payerAccountId: msg.payer_account_id ?? null,
    messageHash: keccak256(toUtf8Bytes(raw)),
    reasons: [],
  };

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    base.reasons.push("parse.invalid-json");
    return base;
  }

  // ORG's own testimony: a rejection attestation.
  if (payload.schema === REJECTION_SCHEMA) {
    base.kind = "rejection";
    base.rejection = payload as unknown as RejectionAttestation;
    return base;
  }

  // A stamp: either the WitnessStamp envelope or a bare MorphemeProof.
  let proof: MorphemeProof | null = null;
  if (payload.schema === WITNESS_STAMP_SCHEMA && typeof payload.proof === "object" && payload.proof !== null) {
    proof = payload.proof as MorphemeProof;
    base.statusProfile = readStatusProfile(payload.statusProfile);
  } else if (payload.schema === MORPHEME_PROOF_SCHEMA) {
    proof = payload as unknown as MorphemeProof;
    base.statusProfile = readStatusProfile(undefined); // absent envelope → missing
  } else {
    // Absent vs unrecognized are distinguishable conditions; neither reason
    // may carry the declared value (that was the live W-10 hole).
    base.reasons.push(payload.schema === undefined ? "schema.missing" : "schema.unknown");
    return base;
  }

  // Structural checks.
  // One code regardless of which field failed — codes stay closed; a pointer
  // to the specific field would be an offset question for a later phase.
  for (const field of ["ruleId", "ruleUri", "ruleUriHash", "inputsHash", "outputsHash", "bindingHash"] as const) {
    if (typeof proof[field] !== "string" || proof[field].length === 0) {
      base.reasons.push("structure.missing-field");
      return base;
    }
  }

  for (const field of ["ruleUriHash", "inputsHash", "outputsHash", "bindingHash"] as const) {
    if (!HASH_RE.test(proof[field])) {
      base.reasons.push("hash.malformed");
      return base;
    }
  }

  // Peirce: the binding recomputes from its parts.
  const recomputedBinding = computeBindingHash({
    ruleUri: proof.ruleUri,
    inputsHash: proof.inputsHash,
    outputsHash: proof.outputsHash,
  });
  if (recomputedBinding.toLowerCase() !== proof.bindingHash.toLowerCase()) {
    base.reasons.push("peirce.binding-mismatch");
    return base;
  }

  // The sha256/keccak split holds.
  const recomputedRuleUriHash = computeRuleUriHash(proof.ruleUri);
  if (recomputedRuleUriHash.toLowerCase() !== proof.ruleUriHash.toLowerCase()) {
    base.reasons.push("split.rule-uri-hash-mismatch");
    return base;
  }

  // Floridi: the rule dereferences and is a real RuleDef (active-registry gate
  // is implicit — the ruleUri came from the registry at claim time; here we
  // confirm it resolves and self-verifies).
  if (!options.skipRuleResolution) {
    try {
      await resolveRuleDef(proof.ruleUri, options);
    } catch {
      // The resolver's error text embeds the subject's ruleUri — it must not
      // reach reasons (W-10). The code alone is the verdict's explanation.
      base.reasons.push("floridi.rule-unresolvable");
      return base;
    }
  }

  base.kind = "valid";
  base.proof = proof;
  return base;
}
