/**
 * reasons.ts — the closed reason space (PHASE_2 §4.1, W-10 in the verdict path).
 *
 * The claims.ts pattern applied to verdict reasons: a bounded taxonomy is what
 * makes W-10 structural instead of procedural. Codes are the WIRE format —
 * they are what travels in a Verdict and in a RejectionAttestation. Templates
 * are DISPLAY-ONLY: a renderer looks them up; they never enter a message.
 *
 * No reason may ever interpolate subject-message content. If a reason must
 * point at something, it points with a hash or an offset, never a value.
 * (reasons.test.ts holds a property test that no template carries an
 * interpolation site.)
 */

/**
 * One code per real failure branch in judgeMessage. The mandate.* codes are
 * part of the wire format NOW (stable for Phase 2b) but NOTHING emits them
 * yet — the mandate-resolution machinery that produces them is Phase 2b.
 */
export type ReasonCode =
  | "parse.invalid-json"
  | "schema.missing"
  | "schema.unknown"
  | "structure.missing-field"
  | "hash.malformed"
  | "peirce.binding-mismatch"
  | "split.rule-uri-hash-mismatch"
  | "floridi.rule-unresolvable"
  | "mandate.unresolvable"
  | "mandate.out-of-window"
  | "mandate.scope-mismatch"
  | "mandate.wrong-topic";

/** Display templates. Fixed strings only — no interpolation sites, ever. */
export const REASONS: Record<ReasonCode, string> = Object.freeze({
  "parse.invalid-json": "message is not valid JSON",
  "schema.missing": "message declares no schema field",
  "schema.unknown": "message schema is not a recognized witness schema",
  "structure.missing-field": "a required proof field is missing or empty",
  "hash.malformed": "a proof hash field is not a 32-byte hex string",
  "peirce.binding-mismatch": "bindingHash does not recompute from {ruleUri, inputsHash, outputsHash}",
  "split.rule-uri-hash-mismatch": "ruleUriHash does not recompute (sha256 of ruleUri)",
  "floridi.rule-unresolvable": "ruleUri does not dereference to a self-verifying RuleDef",
  "mandate.unresolvable": "mandateHash does not resolve to a mandate-morpheme in the registry",
  "mandate.out-of-window": "verdict consensus timestamp falls outside the mandate window",
  "mandate.scope-mismatch": "mandate scope does not cover this verdict class and topic",
  "mandate.wrong-topic": "verdict is not on the mandated verdict topic",
});

/** Membership test — the only gate anything needs to admit a reason. */
export function isReasonCode(value: string): value is ReasonCode {
  return Object.prototype.hasOwnProperty.call(REASONS, value);
}

/**
 * Construction guard: returns the codes it was given or throws. Anything
 * outside the space fails at construction because there is nothing to
 * construct with (the claims.ts refusal, applied to reasons).
 */
export function assertReasonCodes(values: readonly string[]): ReasonCode[] {
  for (const v of values) {
    if (!isReasonCode(v)) {
      throw new Error(
        `Reason outside the closed reason space: a verdict may only carry known ReasonCodes.`,
      );
    }
  }
  return values as ReasonCode[];
}

/** Display lookup for renderers and consoles. Never travels in a message. */
export function reasonText(code: ReasonCode): string {
  return REASONS[code];
}
