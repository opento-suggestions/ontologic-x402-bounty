/**
 * anchors.ts — THE TRUST ANCHOR (W-12).
 *
 * These constants are the verifier's root of trust: the two authority topics
 * (immutable by construction — no admin key, V-11) and the boundary of the
 * pre-mandate era. They are OFF-CHAIN constants by design: changing them is a
 * verifier-release event, not an on-chain one (declared in LIMITATIONS.md).
 *
 * All null until the Phase 2 ceremony (PHASE_2 §3) creates the entities;
 * pinned to literals immediately after, from the ceremony's mirror read-back.
 * Until pinned, judgeMessage's authority checks run only where a caller
 * supplies the values explicitly (tests, the ceremony scripts themselves).
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
  witnessRegistryTopicId: null,
  verdictTopicId: null,
  firstMandateTimestamp: null,
});
