/**
 * attestation.test.ts — the v0.2 rejection attestation as a full morpheme
 * (offline). PHASE_2 §4.5: the attestation's bindingHash recomputes through
 * the same seam wrappers as every proof; the W-10 property holds (derivations
 * and codes only — no field can carry the subject's payload); mandateHash
 * rides in M, unsealed, exactly like statusProfile; and the one live v0.1
 * attestation stands as pre-mandate history under §4.4's temporal clause.
 */

import { describe, it, expect } from "vitest";
import {
  buildRejectionAttestationV2,
  REJECTION_SCHEMA,
  type RejectionAttestationV2,
} from "../src/schema.js";
import { computeBindingHash, computeInputsHash, computeOutputsHash } from "../src/morpheme.js";
import { judgeMessage } from "../src/verify.js";
import type { ReasonCode } from "../src/reasons.js";
import type { MirrorMessage } from "../src/mirror.js";

const REGISTRY = "0.0.7777777";
const VERDICT_TOPIC = "0.0.8888888";
const LANE_A = "0.0.9645621";
const RULE_URI = `hcs://${REGISTRY}/1785000000.000000002`;
const MANDATE_HASH = "0x" + "cd".repeat(32);

const OPTIONS = {
  mirrorNodeUrl: "http://mirror.invalid",
  skipRuleResolution: true,
  skipMandateResolution: true,
  witnessRegistryTopicId: REGISTRY,
  verdictTopicId: VERDICT_TOPIC,
};

function attest(overrides: Partial<Parameters<typeof buildRejectionAttestationV2>[0]> = {}) {
  return buildRejectionAttestationV2({
    ruleId: "witness://org/verdict/lane-conformance",
    ruleUri: RULE_URI,
    subjectTopicId: LANE_A,
    subjectConsensusTimestamp: "1784493351.903971104",
    subjectSequenceNumber: 2,
    subjectMessageHash: "0x" + "ab".repeat(32),
    reasons: ["schema.missing"],
    mandateHash: MANDATE_HASH,
    operatorAccountId: "0.0.8641261",
    createdAt: "2026-07-25T00:00:00.000Z",
    ...overrides,
  });
}

function mirrorMsg(payload: unknown, ts = "1785100000.000000000"): MirrorMessage {
  return {
    consensus_timestamp: ts,
    sequence_number: 1,
    message: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
    payer_account_id: "0.0.8641261",
  };
}

describe("the v0.2 attestation is a real morpheme", () => {
  it("its sealed hashes recompute through the seam wrappers", () => {
    const a = attest();
    const inputsHash = computeInputsHash({
      subjectConsensusTimestamp: a.subjectConsensusTimestamp,
      subjectMessageHash: a.subjectMessageHash,
      subjectSequenceNumber: a.subjectSequenceNumber,
      subjectTopicId: a.subjectTopicId,
    });
    const outputsHash = computeOutputsHash({ reasons: a.reasons, verdict: "rejected" });
    expect(inputsHash).toBe(a.inputsHash);
    expect(outputsHash).toBe(a.outputsHash);
    expect(computeBindingHash({ ruleUri: a.ruleUri, inputsHash, outputsHash })).toBe(a.bindingHash);
  });

  it("mandateHash rides in M, unsealed — changing it never moves the bindingHash", () => {
    const a = attest();
    const b = attest({ mandateHash: "0x" + "ef".repeat(32) });
    expect(b.bindingHash).toBe(a.bindingHash);
    expect(b.mandateHash).not.toBe(a.mandateHash);
  });

  it("W-10: carries only derivations and codes — nothing that could hold the payload", () => {
    const a = attest();
    const json = JSON.stringify(a);
    expect(json).not.toContain('"message":');
    expect(a.reasons.every((r) => typeof r === "string")).toBe(true);
    expect(() => attest({ reasons: [] })).toThrow(/at least one reason/);
    expect(() => attest({ reasons: ["free text about the payload" as ReasonCode] })).toThrow(/closed reason space/);
    expect(() => attest({ mandateHash: "not-a-hash" })).toThrow(/32-byte hex/);
  });
});

describe("judgeMessage on v0.2 attestations (W-11 chain, offline slice)", () => {
  it("well-formed, on the Verdict Topic → kind rejection", async () => {
    const verdict = await judgeMessage(mirrorMsg(attest()), VERDICT_TOPIC, OPTIONS);
    expect(verdict.kind).toBe("rejection");
    expect(verdict.reasons).toEqual([]);
    expect((verdict.rejection as RejectionAttestationV2).bindingHash).toBe(attest().bindingHash);
  });

  it("on a paid lane instead of the Verdict Topic → invalid + mandate.wrong-topic (§8b's forged-judgment hole, closed)", async () => {
    const verdict = await judgeMessage(mirrorMsg(attest()), LANE_A, OPTIONS);
    expect(verdict.kind).toBe("invalid");
    expect(verdict.reasons).toEqual(["mandate.wrong-topic"]);
  });

  it("tampered reason list fails Peirce — the sealed O is the acceptance test", async () => {
    const tampered = { ...attest(), reasons: ["schema.missing", "hash.malformed"] };
    const verdict = await judgeMessage(mirrorMsg(tampered), VERDICT_TOPIC, OPTIONS);
    expect(verdict.kind).toBe("invalid");
    expect(verdict.reasons).toEqual(["peirce.binding-mismatch"]);
  });

  it("free text smuggled into reasons → structure.reason-outside-space, and the text never re-renders", async () => {
    const smuggled = { ...attest(), reasons: ["<attacker text on an ORG surface>"] };
    const verdict = await judgeMessage(mirrorMsg(smuggled), VERDICT_TOPIC, OPTIONS);
    expect(verdict.kind).toBe("invalid");
    expect(verdict.reasons).toEqual(["structure.reason-outside-space"]);
    expect(JSON.stringify(verdict.reasons)).not.toContain("attacker");
  });

  it("a rule from outside the witness registry cannot ground a verdict (cross-registry defense)", async () => {
    const foreign = attest({ ruleUri: "hcs://0.0.8641938/1776123344.395540000" }); // the colour registry
    const verdict = await judgeMessage(mirrorMsg(foreign), VERDICT_TOPIC, OPTIONS);
    expect(verdict.kind).toBe("invalid");
    expect(verdict.reasons).toEqual(["floridi.rule-unresolvable"]);
  });

  it("unresolvable mandate context → invalid + mandate.unresolvable (out-of-mandate, §6.2)", async () => {
    const verdict = await judgeMessage(mirrorMsg(attest()), VERDICT_TOPIC, {
      ...OPTIONS,
      skipMandateResolution: false,
      witnessRegistryTopicId: null,
    });
    expect(verdict.kind).toBe("invalid");
    expect(verdict.reasons).toEqual(["mandate.unresolvable"]);
  });
});

describe("the temporal clause (§4.4): v0.1 stands as pre-mandate history", () => {
  const LIVE_V1 = {
    schema: REJECTION_SCHEMA,
    schemaVersion: "0.1",
    verdict: "rejected",
    subjectTopicId: LANE_A,
    subjectConsensusTimestamp: "1784493351.903971104",
    subjectSequenceNumber: 2,
    subjectMessageHash: "0x784712708a8b6930b2a311d48ee4b8ff4953a6413ad6052366a613d37bdee6ae",
    reasons: ["unknown schema: undefined"], // the live pre-fix string, immutable on-chain
    operatorAccountId: "0.0.8641261",
    createdAt: "2026-07-20T03:34:19.691Z",
  };

  it("before the first mandate (or with the era unpinned) it is history: kind rejection", async () => {
    const verdict = await judgeMessage(mirrorMsg(LIVE_V1, "1784518459.756961931"), LANE_A, OPTIONS);
    expect(verdict.kind).toBe("rejection");
  });

  it("the same shape rendered inside the mandate era does not conform", async () => {
    const verdict = await judgeMessage(mirrorMsg(LIVE_V1, "1786000000.000000000"), LANE_A, {
      ...OPTIONS,
      firstMandateTimestamp: "1785000000.000000000",
    });
    expect(verdict.kind).toBe("invalid");
    expect(verdict.reasons).toEqual(["structure.missing-field"]);
  });
});
