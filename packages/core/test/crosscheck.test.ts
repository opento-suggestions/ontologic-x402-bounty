/**
 * crosscheck.test.ts — recipe equivalence proven against the LIVE sphere.
 *
 * Fetches real MorphemeProof v0.8 messages from PROOF topic 0.0.8641943 via
 * public mirror REST (keyless) and recomputes their hashes with the ported
 * seam. Green = the hello-world seam and the v0.8.3 build's canonicalize.js
 * are provably the same recipe. Network test — skipped if the mirror is
 * unreachable (offline CI stays green via the pinned vectors).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { computeBindingHash, computeRuleUriHash } from "../src/morpheme.js";
import { fetchAllTopicMessages, decodeMessage, type MirrorMessage } from "../src/mirror.js";

const MIRROR = "https://testnet.mirrornode.hedera.com/api/v1";
const PROOF_TOPIC = "0.0.8641943";

interface LiveProof {
  schema?: string;
  ruleUri: string;
  ruleUriHash: string;
  inputsHash: string;
  outputsHash: string;
  bindingHash: string;
}

let proofs: LiveProof[] = [];
let mirrorReachable = true;

beforeAll(async () => {
  let messages: MirrorMessage[];
  try {
    messages = await fetchAllTopicMessages(MIRROR, PROOF_TOPIC);
  } catch {
    mirrorReachable = false;
    return;
  }
  for (const msg of messages) {
    try {
      const p = JSON.parse(decodeMessage(msg)) as LiveProof;
      if (p.schema === "hcs.ontologic.morphemeProof" && p.bindingHash && p.ruleUri) {
        proofs.push(p);
      }
    } catch {
      continue;
    }
  }
}, 60_000);

describe("live crosscheck against PROOF topic 0.0.8641943", () => {
  it("found live v0.8 proofs on the topic", () => {
    if (!mirrorReachable) return; // offline — pinned vectors carry the lock
    expect(proofs.length).toBeGreaterThan(10);
  });

  it("every live bindingHash recomputes with the ported seam", () => {
    if (!mirrorReachable) return;
    for (const p of proofs) {
      expect(
        computeBindingHash({
          ruleUri: p.ruleUri,
          inputsHash: p.inputsHash,
          outputsHash: p.outputsHash,
        }),
      ).toBe(p.bindingHash);
    }
  });

  it("every live ruleUriHash recomputes (sha256 split)", () => {
    if (!mirrorReachable) return;
    for (const p of proofs) {
      expect(computeRuleUriHash(p.ruleUri)).toBe(p.ruleUriHash);
    }
  });
});
