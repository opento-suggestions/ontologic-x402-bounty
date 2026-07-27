/**
 * anchors.ts — THE TRUST ANCHOR (W-12).
 *
 * These constants are the verifier's root of trust: the two authority topics
 * (immutable by construction — no admin key, V-11) and the boundary of the
 * pre-mandate era. They are OFF-CHAIN constants by design: changing them is a
 * verifier-release event, not an on-chain one (declared in LIMITATIONS.md).
 *
 * PINNED 2026-07-27 from the ceremony's mirror read-back (see
 * docs/verify-log.md, ceremony entry): both topics confirmed
 * admin_key: null with the intended disjoint submit keys before pinning.
 */

export interface TrustAnchors {
  /** Witness Rule Registry — submit key = root, admin key = null. */
  witnessRegistryTopicId: string | null;
  /** Verdict Topic — submit key = operator, admin key = null. */
  verdictTopicId: string | null;
  /**
   * Consensus timestamp of the first mandate-morpheme on the registry.
   * Attestations before this instant are pre-mandate history (PHASE_2 §4.4):
   * judged as they always were, never retroactively condemned.
   */
  firstMandateTimestamp: string | null;
}

export const TRUST_ANCHORS: TrustAnchors = Object.freeze({
  witnessRegistryTopicId: "0.0.9794232",
  verdictTopicId: "0.0.9794234",
  firstMandateTimestamp: "1785172221.348657104",
});
