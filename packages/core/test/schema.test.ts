/**
 * schema.test.ts — envelope semantics (offline).
 *
 * The load-bearing property under test: the statusProfile rides BESIDE the
 * proof and is never sealed into any hash — changing it must not move
 * bindingHash. Plus the verifier-side default (absent → missing) and the
 * closed status vocabulary.
 */

import { describe, it, expect } from "vitest";
import {
  buildStatusProfile,
  readStatusProfile,
  buildWitnessStamp,
  buildRejectionAttestation,
  STATUS_VALUES,
} from "../src/schema.js";
import { computeBindingHash } from "../src/morpheme.js";
import type { MorphemeProof } from "../src/schema.js";

const PROOF: MorphemeProof = {
  schema: "hcs.ontologic.morphemeProof",
  schemaVersion: "0.8",
  proofMode: "registry",
  ruleId: "sphere://demo/entity/white-from-cmy",
  ruleUri: "hcs://0.0.8641938/1776142805.844760965",
  ruleUriHash: "0xe93b11fbbaeb00c513c562beea969b084eeda12cfda2c9de3c131326c948ae50",
  inputsHash: "0x39c96d5608b5e39fd9610cfe2a4aa92d998100c16faa36d3691ab91b76a3c548",
  outputsHash: "0xf78a4e647936f12c0ca96f5cb6420ec53c6508676caaa0abc96ce7ebdbdce490",
  bindingHash: "0xf17b903e1587d02d52b7d9a866ac6f69537cd9674c2850ff3deaf4f0d697276a",
  reasoningContractId: null,
  callerAccountId: "0.0.1234",
  transactionId: null,
  network: "hedera-testnet",
  createdAt: "2026-07-19T00:00:00.000Z",
};

describe("statusProfile (unsealed envelope)", () => {
  it("changing the statusProfile does not move the proof's bindingHash", () => {
    const a = buildWitnessStamp(PROOF, buildStatusProfile("declared"));
    const b = buildWitnessStamp(PROOF, buildStatusProfile("withheld", "redacted premise"));
    const bind = (s: typeof a) =>
      computeBindingHash({
        ruleUri: s.proof.ruleUri,
        inputsHash: s.proof.inputsHash,
        outputsHash: s.proof.outputsHash,
      });
    expect(bind(a)).toBe(bind(b));
    expect(bind(a)).toBe(PROOF.bindingHash);
  });

  it("absent envelope reads as status: missing", () => {
    expect(readStatusProfile(undefined).status).toBe("missing");
    expect(readStatusProfile({ garbage: true }).status).toBe("missing");
  });

  it("round-trips every allowed status and refuses others", () => {
    for (const s of STATUS_VALUES) {
      expect(readStatusProfile(buildStatusProfile(s)).status).toBe(s);
    }
    expect(() => buildStatusProfile("fabricated" as never)).toThrow(/Invalid statusProfile/);
  });
});

describe("rejection attestation (the bounded fail-write)", () => {
  it("carries only derivations of the attempt, and requires a reason", () => {
    const r = buildRejectionAttestation({
      subjectTopicId: "0.0.999",
      subjectConsensusTimestamp: "1776142805.000000000",
      subjectSequenceNumber: 7,
      subjectMessageHash: "0x" + "ab".repeat(32),
      reasons: ["not JSON"],
      operatorAccountId: "0.0.1234",
      createdAt: "2026-07-19T00:00:00.000Z",
    });
    expect(r.verdict).toBe("rejected");
    expect(JSON.stringify(r)).not.toContain("message\":"); // no payload field exists
    expect(() =>
      buildRejectionAttestation({
        subjectTopicId: "0.0.999",
        subjectConsensusTimestamp: "1",
        subjectSequenceNumber: 1,
        subjectMessageHash: "0x00",
        reasons: [],
        operatorAccountId: "0.0.1",
        createdAt: "2026-07-19T00:00:00.000Z",
      }),
    ).toThrow(/at least one reason/);
  });
});
