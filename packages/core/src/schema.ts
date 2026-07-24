/**
 * schema.ts — the Witness Required message envelopes.
 *
 * A WitnessStamp is the MorphemeProof v0.8 object (unchanged, hash-compatible
 * with the live sphere) PLUS envelope fields that ride BESIDE the proof and are
 * NEVER sealed into inputsHash/outputsHash/bindingHash:
 *   - statusProfile: provisional Sorensen envelope, schemaVersion 0.1-mvp.
 *     Placement outside the hashes is load-bearing: the finalized schema can
 *     supersede it without invalidating a single stamp or golden vector.
 *   - lane metadata is NOT a field: which topic the stamp landed on is the
 *     payment provenance (denominated testimony), free, with zero extra fields.
 */

import { assertReasonCodes, type ReasonCode } from "./reasons.js";

export const MORPHEME_PROOF_SCHEMA = "hcs.ontologic.morphemeProof";
export const MORPHEME_PROOF_VERSION = "0.8";
export const WITNESS_STAMP_SCHEMA = "hcs.ontologic.witness.stamp";
export const WITNESS_STAMP_VERSION = "0.1";
export const REJECTION_SCHEMA = "hcs.ontologic.witness.rejection";
export const REJECTION_VERSION = "0.1";

// ─── MorphemeProof v0.8 (byte-compatible with the live sphere) ───

export interface MorphemeProof {
  schema: typeof MORPHEME_PROOF_SCHEMA;
  schemaVersion: typeof MORPHEME_PROOF_VERSION;
  proofMode: "registry" | "contract";
  ruleId: string;
  ruleUri: string;
  ruleUriHash: string;
  inputsHash: string;
  outputsHash: string;
  bindingHash: string;
  reasoningContractId: string | null;
  callerAccountId: string;
  transactionId: string | null;
  network: string;
  createdAt: string;
}

// ─── statusProfile (provisional — Sorensen schema not finalized) ───

export const STATUS_PROFILE_VERSION = "0.1-mvp";

export const STATUS_VALUES = [
  "declared",
  "missing",
  "vague",
  "blurred",
  "stale",
  "timed-out",
  "withheld",
] as const;

export type StatusValue = (typeof STATUS_VALUES)[number];

export interface StatusProfile {
  schemaVersion: typeof STATUS_PROFILE_VERSION;
  status: StatusValue;
  note?: string;
}

export function buildStatusProfile(status: StatusValue, note?: string): StatusProfile {
  if (!STATUS_VALUES.includes(status)) {
    throw new Error(`Invalid statusProfile status: ${status}. Allowed: ${STATUS_VALUES.join(", ")}`);
  }
  return note ? { schemaVersion: STATUS_PROFILE_VERSION, status, note } : { schemaVersion: STATUS_PROFILE_VERSION, status };
}

/** An absent envelope reads as status: missing (verifier-side default). */
export function readStatusProfile(value: unknown): StatusProfile {
  if (
    typeof value === "object" &&
    value !== null &&
    (value as StatusProfile).schemaVersion === STATUS_PROFILE_VERSION &&
    STATUS_VALUES.includes((value as StatusProfile).status)
  ) {
    return value as StatusProfile;
  }
  return { schemaVersion: STATUS_PROFILE_VERSION, status: "missing" };
}

// ─── WitnessStamp — the message actually submitted to a lane topic ───

export interface WitnessStamp {
  schema: typeof WITNESS_STAMP_SCHEMA;
  schemaVersion: typeof WITNESS_STAMP_VERSION;
  proof: MorphemeProof;
  statusProfile: StatusProfile;
}

export function buildWitnessStamp(proof: MorphemeProof, statusProfile: StatusProfile): WitnessStamp {
  return {
    schema: WITNESS_STAMP_SCHEMA,
    schemaVersion: WITNESS_STAMP_VERSION,
    proof,
    statusProfile,
  };
}

// ─── Rejection attestation — ORG's own testimony, operator-signed only ───
//
// The bounded fail-write. It attests "this attempt occurred and failed
// conformance" and carries ONLY derivations of the attempt (its topic,
// timestamp, and byte-hash) — never the attempt's payload (W-10).

export interface RejectionAttestation {
  schema: typeof REJECTION_SCHEMA;
  schemaVersion: typeof REJECTION_VERSION;
  subjectTopicId: string;
  subjectConsensusTimestamp: string;
  subjectSequenceNumber: number;
  /** keccak256 of the attempt's raw message bytes — a derivation, not the bytes. */
  subjectMessageHash: string;
  verdict: "rejected";
  /** Wire-format codes from the closed reason space — never free text (W-10). */
  reasons: ReasonCode[];
  operatorAccountId: string;
  createdAt: string;
}

export function buildRejectionAttestation(params: {
  subjectTopicId: string;
  subjectConsensusTimestamp: string;
  subjectSequenceNumber: number;
  subjectMessageHash: string;
  reasons: ReasonCode[];
  operatorAccountId: string;
  createdAt: string;
}): RejectionAttestation {
  if (params.reasons.length === 0) {
    throw new Error("A rejection attestation must state at least one reason.");
  }
  // The claims.ts refusal: anything outside the closed reason space fails at
  // construction, including strings smuggled past the type by a JS caller.
  assertReasonCodes(params.reasons);
  return {
    schema: REJECTION_SCHEMA,
    schemaVersion: REJECTION_VERSION,
    verdict: "rejected",
    subjectTopicId: params.subjectTopicId,
    subjectConsensusTimestamp: params.subjectConsensusTimestamp,
    subjectSequenceNumber: params.subjectSequenceNumber,
    subjectMessageHash: params.subjectMessageHash,
    reasons: params.reasons,
    operatorAccountId: params.operatorAccountId,
    createdAt: params.createdAt,
  };
}
