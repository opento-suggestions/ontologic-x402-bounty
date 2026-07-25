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

import {
  computeBindingHash,
  computeInputsHash,
  computeOutputsHash,
  computeRuleUriHash,
} from "./morpheme.js";
import { assertReasonCodes, type ReasonCode } from "./reasons.js";
import { compareTimestamps, isConsensusTimestamp } from "./timestamps.js";

export const MORPHEME_PROOF_SCHEMA = "hcs.ontologic.morphemeProof";
export const MORPHEME_PROOF_VERSION = "0.8";
export const WITNESS_STAMP_SCHEMA = "hcs.ontologic.witness.stamp";
export const WITNESS_STAMP_VERSION = "0.1";
export const REJECTION_SCHEMA = "hcs.ontologic.witness.rejection";
export const REJECTION_VERSION = "0.1";
export const REJECTION_VERSION_V2 = "0.2";
export const MANDATE_SCHEMA = "hcs.ontologic.witness.mandate";
export const MANDATE_VERSION = "0.1";
export const MANDATE_REVOCATION_SCHEMA = "hcs.ontologic.witness.mandateRevocation";
export const MANDATE_REVOCATION_VERSION = "0.1";

const HASH_RE = /^0x[0-9a-f]{64}$/i;

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
//
// v0.1 (below) is the pre-mandate shape: the one live attestation on Lane A
// (seq 7) has it, and it stands as history under PHASE_2 §4.4's temporal
// clause. New attestations are v0.2 full morphemes (further below).

/** @deprecated v0.1 — pre-mandate shape, retained for reading history. New attestations are v0.2. */
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

/** @deprecated v0.1 builder — superseded by buildRejectionAttestationV2; kept until the reject-attest rewrite lands. */
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

// ─── The authority layer (Phase 2, W-11/W-12) ───
//
// Three message classes. The mandate and the v0.2 attestation are FULL
// MORPHEMES: same recipe, same named wrappers, no new hash primitive —
// `mandateHash` IS the mandate-morpheme's own bindingHash. The sealed zone
// of each is {ruleUri, inputsHash, outputsHash} → bindingHash; everything
// listed under "M (beside)" rides UNSEALED, exactly like statusProfile on a
// WitnessStamp — supersedable without invalidating a hash, and therefore
// advisory rather than attested (declared in LIMITATIONS.md).

export const VERDICT_CLASSES = ["rejection-attestation"] as const;
export type VerdictClass = (typeof VERDICT_CLASSES)[number];

/** §6.3 (resolved 2026-07-25): minimum viable scope — nothing richer in MVP. */
export interface MandateScope {
  verdictClass: VerdictClass;
  topicId: string;
}

export interface MandateMorpheme {
  schema: typeof MANDATE_SCHEMA;
  schemaVersion: typeof MANDATE_VERSION;
  // R — the delegation rule in the Witness Rule Registry
  ruleId: string;
  ruleUri: string;
  ruleUriHash: string;
  // I (sealed) — the grant: parties, scope, window, nonce
  principal: string;
  grantee: string;
  scope: MandateScope;
  /** Consensus-style "seconds[.nanos]" strings — same lexicon the window is judged in. */
  notBefore: string;
  notAfter: string | null;
  /** Mandate identity is content-derived; a revoked grant's identity is dead forever, so re-granting needs a fresh nonce. */
  nonce: string;
  inputsHash: string;
  // O (sealed) — the delegation verdict
  verdict: "granted";
  outputsHash: string;
  /** The mandateHash every mandated verdict cites. */
  bindingHash: string;
  // M (beside, unsealed) — NO mandateHash here: the root grounds the chain (depth-1, PHASE_2 §3.5)
  statusProfile?: StatusProfile;
  createdAt: string;
}

export function buildMandateMorpheme(params: {
  ruleId: string;
  ruleUri: string;
  principal: string;
  grantee: string;
  scope: MandateScope;
  notBefore: string;
  notAfter: string | null;
  nonce: string;
  createdAt: string;
  statusProfile?: StatusProfile;
}): MandateMorpheme {
  // W-11: a mandate whose principal is its grantee is unconstructible.
  if (params.principal === params.grantee) {
    throw new Error("Mandate principal and grantee must be distinct accounts (W-11).");
  }
  if (params.nonce.length === 0) {
    throw new Error("A mandate requires a nonce: content-derived identity means a revoked grant is dead forever.");
  }
  if (!VERDICT_CLASSES.includes(params.scope.verdictClass)) {
    throw new Error(`Mandate scope outside the closed verdict-class space. Allowed: ${VERDICT_CLASSES.join(", ")}`);
  }
  if (!isConsensusTimestamp(params.notBefore) || (params.notAfter !== null && !isConsensusTimestamp(params.notAfter))) {
    throw new Error("Mandate window bounds must be consensus-style timestamps (seconds[.nanos]).");
  }
  if (params.notAfter !== null && compareTimestamps(params.notAfter, params.notBefore) <= 0) {
    throw new Error("Mandate window is empty: notAfter must be after notBefore.");
  }

  const inputs = {
    grantee: params.grantee,
    nonce: params.nonce,
    notAfter: params.notAfter,
    notBefore: params.notBefore,
    principal: params.principal,
    scope: { topicId: params.scope.topicId, verdictClass: params.scope.verdictClass },
  };
  const inputsHash = computeInputsHash(inputs);
  const outputsHash = computeOutputsHash({ verdict: "granted" });
  const bindingHash = computeBindingHash({ ruleUri: params.ruleUri, inputsHash, outputsHash });

  const mandate: MandateMorpheme = {
    schema: MANDATE_SCHEMA,
    schemaVersion: MANDATE_VERSION,
    ruleId: params.ruleId,
    ruleUri: params.ruleUri,
    ruleUriHash: computeRuleUriHash(params.ruleUri),
    principal: params.principal,
    grantee: params.grantee,
    scope: params.scope,
    notBefore: params.notBefore,
    notAfter: params.notAfter,
    nonce: params.nonce,
    inputsHash,
    verdict: "granted",
    outputsHash,
    bindingHash,
    createdAt: params.createdAt,
  };
  if (params.statusProfile) mandate.statusProfile = params.statusProfile;
  return mandate;
}

export interface MandateRevocation {
  schema: typeof MANDATE_REVOCATION_SCHEMA;
  schemaVersion: typeof MANDATE_REVOCATION_VERSION;
  /** The target mandate's bindingHash. */
  mandateHash: string;
  /** Advisory — authorship is enforced by the registry topic's submit key, not this field. */
  revokedBy: string;
  createdAt: string;
}

export function buildMandateRevocation(params: {
  mandateHash: string;
  revokedBy: string;
  createdAt: string;
}): MandateRevocation {
  if (!HASH_RE.test(params.mandateHash)) {
    throw new Error("Revocation target must be a mandateHash (32-byte hex).");
  }
  return {
    schema: MANDATE_REVOCATION_SCHEMA,
    schemaVersion: MANDATE_REVOCATION_VERSION,
    mandateHash: params.mandateHash,
    revokedBy: params.revokedBy,
    createdAt: params.createdAt,
  };
}

/**
 * v0.2 — the rejection attestation as a full morpheme (PHASE_2 §4.2).
 * I = the subject's derivations (unchanged — never the payload, W-10).
 * O = the verdict plus the reason codes.
 * M (beside, unsealed) = mandateHash + statusProfile + operator identity.
 */
export interface RejectionAttestationV2 {
  schema: typeof REJECTION_SCHEMA;
  schemaVersion: typeof REJECTION_VERSION_V2;
  // R — the conformance rule in the Witness Rule Registry
  ruleId: string;
  ruleUri: string;
  ruleUriHash: string;
  // I (sealed) — derivations of the attempt, only
  subjectTopicId: string;
  subjectConsensusTimestamp: string;
  subjectSequenceNumber: number;
  subjectMessageHash: string;
  inputsHash: string;
  // O (sealed)
  verdict: "rejected";
  reasons: ReasonCode[];
  outputsHash: string;
  bindingHash: string;
  // M (beside, unsealed)
  mandateHash: string;
  statusProfile?: StatusProfile;
  operatorAccountId: string;
  createdAt: string;
}

export type AnyRejectionAttestation = RejectionAttestation | RejectionAttestationV2;

export function buildRejectionAttestationV2(params: {
  ruleId: string;
  ruleUri: string;
  subjectTopicId: string;
  subjectConsensusTimestamp: string;
  subjectSequenceNumber: number;
  subjectMessageHash: string;
  reasons: ReasonCode[];
  mandateHash: string;
  operatorAccountId: string;
  createdAt: string;
  statusProfile?: StatusProfile;
}): RejectionAttestationV2 {
  if (params.reasons.length === 0) {
    throw new Error("A rejection attestation must state at least one reason.");
  }
  assertReasonCodes(params.reasons);
  if (!HASH_RE.test(params.mandateHash)) {
    throw new Error("mandateHash must be a 32-byte hex bindingHash.");
  }
  if (!HASH_RE.test(params.subjectMessageHash)) {
    throw new Error("subjectMessageHash must be a 32-byte hex derivation.");
  }

  const inputs = {
    subjectConsensusTimestamp: params.subjectConsensusTimestamp,
    subjectMessageHash: params.subjectMessageHash,
    subjectSequenceNumber: params.subjectSequenceNumber,
    subjectTopicId: params.subjectTopicId,
  };
  const inputsHash = computeInputsHash(inputs);
  const outputsHash = computeOutputsHash({ reasons: params.reasons, verdict: "rejected" });
  const bindingHash = computeBindingHash({ ruleUri: params.ruleUri, inputsHash, outputsHash });

  const attestation: RejectionAttestationV2 = {
    schema: REJECTION_SCHEMA,
    schemaVersion: REJECTION_VERSION_V2,
    ruleId: params.ruleId,
    ruleUri: params.ruleUri,
    ruleUriHash: computeRuleUriHash(params.ruleUri),
    subjectTopicId: params.subjectTopicId,
    subjectConsensusTimestamp: params.subjectConsensusTimestamp,
    subjectSequenceNumber: params.subjectSequenceNumber,
    subjectMessageHash: params.subjectMessageHash,
    inputsHash,
    verdict: "rejected",
    reasons: params.reasons,
    outputsHash,
    bindingHash,
    mandateHash: params.mandateHash,
    operatorAccountId: params.operatorAccountId,
    createdAt: params.createdAt,
  };
  if (params.statusProfile) attestation.statusProfile = params.statusProfile;
  return attestation;
}
