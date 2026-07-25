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
 *   rejection  — an ORG rejection attestation (rendered as a verdict-tile);
 *                v0.2 attestations must also pass the W-11 mandate chain
 *   mandate    — a mandate-morpheme on the Witness Rule Registry (Phase 2)
 *   revocation — a mandate revocation on the registry (Phase 2)
 *   invalid    — paid bytes that fail conformance (no tile, ever), including
 *                out-of-mandate verdicts (§6.2: invalid + mandate.* code)
 *
 * W-11 (mandated verdicts) and W-12 (anchor sufficiency) live here: every
 * authority input is a topic message or immutable-by-construction topic
 * configuration. Deliberately ABSENT: any check against payer_account_id or
 * live account key state — V-10 closed that road (transport attribution
 * cannot carry authority; two honest readers could disagree).
 */

import { keccak256, toUtf8Bytes } from "ethers";
import {
  computeBindingHash,
  computeInputsHash,
  computeOutputsHash,
  computeRuleUriHash,
} from "./morpheme.js";
import { isReasonCode, type ReasonCode } from "./reasons.js";
import { parseHcsUri, resolveMandate, resolveRuleDef, type ResolveOptions } from "./resolve.js";
import {
  MANDATE_REVOCATION_SCHEMA,
  MANDATE_SCHEMA,
  MORPHEME_PROOF_SCHEMA,
  REJECTION_SCHEMA,
  REJECTION_VERSION,
  REJECTION_VERSION_V2,
  WITNESS_STAMP_SCHEMA,
  readStatusProfile,
  type AnyRejectionAttestation,
  type MandateMorpheme,
  type MandateRevocation,
  type MandateScope,
  type MorphemeProof,
  type RejectionAttestation,
  type RejectionAttestationV2,
  type StatusProfile,
  type VerdictClass,
} from "./schema.js";
import { decodeMessage, type MirrorMessage } from "./mirror.js";
import { compareTimestamps } from "./timestamps.js";
import { TRUST_ANCHORS } from "./anchors.js";

export type VerdictKind = "valid" | "rejection" | "invalid" | "mandate" | "revocation";

/**
 * Authority context (W-11/W-12). Values default from the TRUST_ANCHORS
 * constants — null until the ceremony pins them — so a check only runs where
 * its anchor exists. Tests and ceremony scripts pass explicit values.
 */
export interface AuthorityContext {
  witnessRegistryTopicId?: string | null;
  verdictTopicId?: string | null;
  firstMandateTimestamp?: string | null;
  /** Offline escape hatch for tests — mirrors skipRuleResolution. */
  skipMandateResolution?: boolean;
}

export type JudgeOptions = ResolveOptions & AuthorityContext & { skipRuleResolution?: boolean };

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
  rejection?: AnyRejectionAttestation;
  mandate?: MandateMorpheme;
  revocation?: MandateRevocation;
}

const HASH_RE = /^0x[0-9a-f]{64}$/i;

/**
 * §6.2 (resolved 2026-07-25): out-of-mandate folds into `invalid`, carrying
 * the specific mandate.* code. One named predicate so promoting it to a
 * fourth verdict class later is a one-line change.
 */
export function outOfMandateKind(): VerdictKind {
  return "invalid";
}

/** W-11 window: verdictTs ∈ [notBefore, revocation ∨ notAfter). Half-open; revocation is never retroactive. */
export function checkMandateWindow(
  mandate: Pick<MandateMorpheme, "notBefore" | "notAfter">,
  revocationTimestamp: string | null,
  verdictTimestamp: string,
): boolean {
  if (compareTimestamps(verdictTimestamp, mandate.notBefore) < 0) return false;
  let bound = mandate.notAfter;
  if (revocationTimestamp !== null) {
    bound = bound === null || compareTimestamps(revocationTimestamp, bound) < 0 ? revocationTimestamp : bound;
  }
  if (bound === null) return true;
  return compareTimestamps(verdictTimestamp, bound) < 0;
}

/** W-11 scope: the mandate's declared scope must cover this verdict class on this topic. */
export function checkMandateScope(scope: MandateScope, verdictClass: VerdictClass, topicId: string): boolean {
  return scope.verdictClass === verdictClass && scope.topicId === topicId;
}

function resolveAnchors(options: JudgeOptions) {
  return {
    witnessRegistryTopicId: options.witnessRegistryTopicId ?? TRUST_ANCHORS.witnessRegistryTopicId,
    verdictTopicId: options.verdictTopicId ?? TRUST_ANCHORS.verdictTopicId,
    firstMandateTimestamp: options.firstMandateTimestamp ?? TRUST_ANCHORS.firstMandateTimestamp,
  };
}

/** Judge one mirror message. Pure except for registry/mandate resolution. */
export async function judgeMessage(
  msg: MirrorMessage,
  topicId: string,
  options: JudgeOptions,
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

  const anchors = resolveAnchors(options);

  // ORG's own testimony: rejection attestations and the authority messages.
  if (payload.schema === REJECTION_SCHEMA) {
    return judgeRejection(base, payload, topicId, options, anchors);
  }
  if (payload.schema === MANDATE_SCHEMA) {
    return judgeMandate(base, payload, topicId, options, anchors);
  }
  if (payload.schema === MANDATE_REVOCATION_SCHEMA) {
    return judgeRevocation(base, payload, topicId, anchors);
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

type Anchors = ReturnType<typeof resolveAnchors>;

/**
 * Rejection attestations. v0.1 is pre-mandate history (PHASE_2 §4.4 temporal
 * clause): it stands, judged as it always was, never retroactively condemned.
 * v0.2 is a full morpheme and must pass Peirce + split + Floridi (against the
 * WITNESS registry) and then the W-11 chain, in the spec's order:
 * wrong-topic → mandate resolves → in-window → in-scope.
 */
async function judgeRejection(
  base: Verdict,
  payload: Record<string, unknown>,
  topicId: string,
  options: JudgeOptions,
  anchors: Anchors,
): Promise<Verdict> {
  if (payload.schemaVersion === REJECTION_VERSION) {
    const preMandateEra =
      anchors.firstMandateTimestamp === null ||
      compareTimestamps(base.consensusTimestamp, anchors.firstMandateTimestamp) < 0;
    if (preMandateEra) {
      base.kind = "rejection";
      base.rejection = payload as unknown as RejectionAttestation;
      return base;
    }
    // A v0.1 shape rendered inside the mandate era lacks the morpheme fields.
    base.reasons.push("structure.missing-field");
    return base;
  }

  if (payload.schemaVersion !== REJECTION_VERSION_V2) {
    base.reasons.push("schema.unknown");
    return base;
  }
  const att = payload as unknown as RejectionAttestationV2;

  // Structural.
  const stringFields = [
    "ruleId",
    "ruleUri",
    "ruleUriHash",
    "inputsHash",
    "outputsHash",
    "bindingHash",
    "subjectTopicId",
    "subjectConsensusTimestamp",
    "subjectMessageHash",
    "mandateHash",
    "operatorAccountId",
    "createdAt",
  ] as const;
  for (const field of stringFields) {
    if (typeof att[field] !== "string" || att[field].length === 0) {
      base.reasons.push("structure.missing-field");
      return base;
    }
  }
  if (typeof att.subjectSequenceNumber !== "number" || att.verdict !== "rejected" || !Array.isArray(att.reasons) || att.reasons.length === 0) {
    base.reasons.push("structure.missing-field");
    return base;
  }
  // The closed reason space is part of the wire format: an attestation whose
  // reasons carry anything else is a payload vector and does not conform.
  for (const reason of att.reasons) {
    if (typeof reason !== "string" || !isReasonCode(reason)) {
      base.reasons.push("structure.reason-outside-space");
      return base;
    }
  }
  for (const field of ["ruleUriHash", "inputsHash", "outputsHash", "bindingHash", "mandateHash", "subjectMessageHash"] as const) {
    if (!HASH_RE.test(att[field])) {
      base.reasons.push("hash.malformed");
      return base;
    }
  }

  // Peirce — full material recompute: I from the subject derivations, O from
  // the verdict + codes, binding from the sealed triple. One recipe, two
  // schemas (PHASE_2 §4.4). mandateHash and statusProfile ride in M, unsealed.
  const inputsHash = computeInputsHash({
    subjectConsensusTimestamp: att.subjectConsensusTimestamp,
    subjectMessageHash: att.subjectMessageHash,
    subjectSequenceNumber: att.subjectSequenceNumber,
    subjectTopicId: att.subjectTopicId,
  });
  const outputsHash = computeOutputsHash({ reasons: att.reasons, verdict: "rejected" });
  const bindingHash = computeBindingHash({ ruleUri: att.ruleUri, inputsHash, outputsHash });
  if (
    inputsHash.toLowerCase() !== att.inputsHash.toLowerCase() ||
    outputsHash.toLowerCase() !== att.outputsHash.toLowerCase() ||
    bindingHash.toLowerCase() !== att.bindingHash.toLowerCase()
  ) {
    base.reasons.push("peirce.binding-mismatch");
    return base;
  }

  // The split holds.
  if (computeRuleUriHash(att.ruleUri).toLowerCase() !== att.ruleUriHash.toLowerCase()) {
    base.reasons.push("split.rule-uri-hash-mismatch");
    return base;
  }

  // Floridi — against the WITNESS registry. Cross-registry impersonation
  // defense (PHASE_2 §4.3): the conformance rule must live on the witness
  // registry and declare a witness.* domain; a rule published elsewhere
  // cannot masquerade as the verdict layer's R.
  if (!checkWitnessRule(att.ruleUri, anchors)) {
    base.reasons.push("floridi.rule-unresolvable");
    return base;
  }
  if (!options.skipRuleResolution) {
    try {
      const ruleDef = await resolveRuleDef(att.ruleUri, options);
      if (typeof ruleDef.domain !== "string" || !ruleDef.domain.startsWith("witness.")) {
        base.reasons.push("floridi.rule-unresolvable");
        return base;
      }
    } catch {
      base.reasons.push("floridi.rule-unresolvable");
      return base;
    }
  }

  // W-11, in the spec's order. Each failure is out-of-mandate: §6.2 folds it
  // into `invalid` with the specific code, behind the one named predicate.
  if (anchors.verdictTopicId !== null && topicId !== anchors.verdictTopicId) {
    base.kind = outOfMandateKind();
    base.reasons.push("mandate.wrong-topic");
    return base;
  }
  if (!options.skipMandateResolution) {
    if (anchors.witnessRegistryTopicId === null) {
      base.kind = outOfMandateKind();
      base.reasons.push("mandate.unresolvable");
      return base;
    }
    const resolved = await resolveMandate(att.mandateHash, anchors.witnessRegistryTopicId, options);
    if (resolved === null) {
      base.kind = outOfMandateKind();
      base.reasons.push("mandate.unresolvable");
      return base;
    }
    if (!checkMandateWindow(resolved.mandate, resolved.revocationConsensusTimestamp, base.consensusTimestamp)) {
      base.kind = outOfMandateKind();
      base.reasons.push("mandate.out-of-window");
      return base;
    }
    if (!checkMandateScope(resolved.mandate.scope, "rejection-attestation", topicId)) {
      base.kind = outOfMandateKind();
      base.reasons.push("mandate.scope-mismatch");
      return base;
    }
  }

  base.kind = "rejection";
  base.rejection = att;
  base.statusProfile = readStatusProfile(att.statusProfile);
  return base;
}

/** A mandate-morpheme: full Peirce/split, self-grant refusal, registry membership. */
async function judgeMandate(
  base: Verdict,
  payload: Record<string, unknown>,
  topicId: string,
  options: JudgeOptions,
  anchors: Anchors,
): Promise<Verdict> {
  const m = payload as unknown as MandateMorpheme;

  for (const field of ["ruleId", "ruleUri", "ruleUriHash", "inputsHash", "outputsHash", "bindingHash", "principal", "grantee", "nonce", "notBefore", "createdAt"] as const) {
    if (typeof m[field] !== "string" || m[field].length === 0) {
      base.reasons.push("structure.missing-field");
      return base;
    }
  }
  if (
    m.verdict !== "granted" ||
    (m.notAfter !== null && typeof m.notAfter !== "string") ||
    typeof m.scope !== "object" ||
    m.scope === null ||
    typeof m.scope.verdictClass !== "string" ||
    typeof m.scope.topicId !== "string"
  ) {
    base.reasons.push("structure.missing-field");
    return base;
  }
  for (const field of ["ruleUriHash", "inputsHash", "outputsHash", "bindingHash"] as const) {
    if (!HASH_RE.test(m[field])) {
      base.reasons.push("hash.malformed");
      return base;
    }
  }

  // W-11's core: principal distinct from grantee. Unconstructible through the
  // builder; refused at read time if hand-crafted onto the registry.
  if (m.principal === m.grantee) {
    base.reasons.push("mandate.self-granted");
    return base;
  }

  // A mandate is only a mandate on the Witness Rule Registry.
  if (anchors.witnessRegistryTopicId !== null && topicId !== anchors.witnessRegistryTopicId) {
    base.kind = outOfMandateKind();
    base.reasons.push("mandate.wrong-topic");
    return base;
  }

  // Peirce on the grant itself.
  const inputsHash = computeInputsHash({
    grantee: m.grantee,
    nonce: m.nonce,
    notAfter: m.notAfter,
    notBefore: m.notBefore,
    principal: m.principal,
    scope: { topicId: m.scope.topicId, verdictClass: m.scope.verdictClass },
  });
  const outputsHash = computeOutputsHash({ verdict: "granted" });
  const bindingHash = computeBindingHash({ ruleUri: m.ruleUri, inputsHash, outputsHash });
  if (
    inputsHash.toLowerCase() !== m.inputsHash.toLowerCase() ||
    outputsHash.toLowerCase() !== m.outputsHash.toLowerCase() ||
    bindingHash.toLowerCase() !== m.bindingHash.toLowerCase()
  ) {
    base.reasons.push("peirce.binding-mismatch");
    return base;
  }

  if (computeRuleUriHash(m.ruleUri).toLowerCase() !== m.ruleUriHash.toLowerCase()) {
    base.reasons.push("split.rule-uri-hash-mismatch");
    return base;
  }

  // Floridi — the delegation rule lives on the witness registry too.
  if (!checkWitnessRule(m.ruleUri, anchors)) {
    base.reasons.push("floridi.rule-unresolvable");
    return base;
  }
  if (!options.skipRuleResolution) {
    try {
      const ruleDef = await resolveRuleDef(m.ruleUri, options);
      if (typeof ruleDef.domain !== "string" || !ruleDef.domain.startsWith("witness.")) {
        base.reasons.push("floridi.rule-unresolvable");
        return base;
      }
    } catch {
      base.reasons.push("floridi.rule-unresolvable");
      return base;
    }
  }

  base.kind = "mandate";
  base.mandate = m;
  base.statusProfile = readStatusProfile(m.statusProfile);
  return base;
}

/** A revocation: structurally minimal; authorship is the registry submit key's business. */
function judgeRevocation(
  base: Verdict,
  payload: Record<string, unknown>,
  topicId: string,
  anchors: Anchors,
): Verdict {
  const r = payload as unknown as MandateRevocation;
  for (const field of ["mandateHash", "revokedBy", "createdAt"] as const) {
    if (typeof r[field] !== "string" || r[field].length === 0) {
      base.reasons.push("structure.missing-field");
      return base;
    }
  }
  if (!HASH_RE.test(r.mandateHash)) {
    base.reasons.push("hash.malformed");
    return base;
  }
  if (anchors.witnessRegistryTopicId !== null && topicId !== anchors.witnessRegistryTopicId) {
    base.kind = outOfMandateKind();
    base.reasons.push("mandate.wrong-topic");
    return base;
  }
  base.kind = "revocation";
  base.revocation = r;
  return base;
}

/**
 * Offline half of the cross-registry defense: the ruleUri must at least point
 * INTO the witness registry topic. (The resolved rule's witness.* domain is
 * checked after dereferencing, when resolution is enabled.)
 */
function checkWitnessRule(ruleUri: string, anchors: Anchors): boolean {
  let parts;
  try {
    parts = parseHcsUri(ruleUri);
  } catch {
    return false;
  }
  if (anchors.witnessRegistryTopicId !== null && parts.topicId !== anchors.witnessRegistryTopicId) {
    return false;
  }
  return true;
}
