/**
 * reasons.test.ts — the closed reason space (PHASE_2 §4.1, offline).
 *
 * Three properties under test:
 *   1. The space refuses unknown codes — anything outside ReasonCode fails at
 *      construction (the claims.ts refusal, applied to reasons).
 *   2. No display template carries an interpolation site — a template that
 *      could splice in subject-message content is the W-10 hole this module
 *      exists to close.
 *   3. judgeMessage's verdicts on known-bad inputs come back as codes, never
 *      free text — including the exact payload shape of the live Lane A seq-2
 *      probe that produced the "unknown schema: undefined" attestation.
 */

import { describe, it, expect } from "vitest";
import { REASONS, isReasonCode, assertReasonCodes, reasonText, type ReasonCode } from "../src/reasons.js";
import { buildRejectionAttestation, type MorphemeProof } from "../src/schema.js";
import { judgeMessage } from "../src/verify.js";
import type { MirrorMessage } from "../src/mirror.js";

// Same self-consistent proof as schema.test.ts: bindingHash recomputes from
// {ruleUri, inputsHash, outputsHash} and ruleUriHash = sha256(ruleUri).
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

const OPTIONS = { mirrorNodeUrl: "http://mirror.invalid", skipRuleResolution: true };

function mirrorMsg(payload: string, seq = 1): MirrorMessage {
  return {
    consensus_timestamp: "1784493351.903971104",
    sequence_number: seq,
    message: Buffer.from(payload, "utf8").toString("base64"),
    payer_account_id: "0.0.9999",
  };
}

async function reasonsFor(payload: string): Promise<string[]> {
  const verdict = await judgeMessage(mirrorMsg(payload), "0.0.9645621", OPTIONS);
  expect(verdict.kind).toBe("invalid");
  return verdict.reasons;
}

describe("the closed reason space", () => {
  it("REASONS is frozen and every code round-trips through the guards", () => {
    expect(Object.isFrozen(REASONS)).toBe(true);
    for (const code of Object.keys(REASONS) as ReasonCode[]) {
      expect(isReasonCode(code)).toBe(true);
      expect(reasonText(code)).toBe(REASONS[code]);
      expect(assertReasonCodes([code])).toEqual([code]);
    }
  });

  it("refuses unknown codes at every gate", () => {
    expect(isReasonCode("totally-made-up")).toBe(false);
    expect(isReasonCode("unknown schema: undefined")).toBe(false); // the old free text is outside the space
    expect(() => assertReasonCodes(["totally-made-up"])).toThrow(/closed reason space/);
    expect(() =>
      buildRejectionAttestation({
        subjectTopicId: "0.0.999",
        subjectConsensusTimestamp: "1",
        subjectSequenceNumber: 1,
        subjectMessageHash: "0x" + "ab".repeat(32),
        reasons: ["attacker text on an ORG surface" as ReasonCode],
        operatorAccountId: "0.0.1",
        createdAt: "2026-07-24T00:00:00.000Z",
      }),
    ).toThrow(/closed reason space/);
  });

  it("no template contains an interpolation site, and codes stay namespace.kebab", () => {
    for (const [code, template] of Object.entries(REASONS)) {
      expect(template).not.toMatch(/\$\{|%s|\{\d+\}/);
      expect(code).toMatch(/^[a-z]+\.[a-z][a-z-]*$/);
    }
  });

  it("the four mandate.* codes are in the space (stable wire format for 2b)", () => {
    for (const code of ["mandate.unresolvable", "mandate.out-of-window", "mandate.scope-mismatch", "mandate.wrong-topic"]) {
      expect(isReasonCode(code)).toBe(true);
    }
  });
});

describe("judgeMessage emits codes, never free text", () => {
  it("not JSON → parse.invalid-json", async () => {
    expect(await reasonsFor("{{{nope")).toEqual(["parse.invalid-json"]);
  });

  it("the live seq-2 probe payload (no schema field) → schema.missing", async () => {
    const probe = '{"probe":"V-9","note":"newborn-inner-payer probe stamp (not a morpheme; verifier will judge invalid — that is correct)"}';
    expect(await reasonsFor(probe)).toEqual(["schema.missing"]);
  });

  it("unrecognized schema value → schema.unknown, and the value never appears", async () => {
    const verdict = await judgeMessage(
      mirrorMsg('{"schema":"<img src=x onerror=alert(1)>"}'),
      "0.0.9645621",
      OPTIONS,
    );
    expect(verdict.reasons).toEqual(["schema.unknown"]);
    expect(JSON.stringify(verdict.reasons)).not.toContain("onerror");
  });

  it("missing proof field → structure.missing-field", async () => {
    const { bindingHash: _dropped, ...partial } = PROOF;
    expect(await reasonsFor(JSON.stringify(partial))).toEqual(["structure.missing-field"]);
  });

  it("malformed hash → hash.malformed", async () => {
    expect(await reasonsFor(JSON.stringify({ ...PROOF, bindingHash: "0xnothex" }))).toEqual(["hash.malformed"]);
  });

  it("bindingHash does not recompute → peirce.binding-mismatch", async () => {
    const tampered = { ...PROOF, bindingHash: "0x" + "11".repeat(32) };
    expect(await reasonsFor(JSON.stringify(tampered))).toEqual(["peirce.binding-mismatch"]);
  });

  it("ruleUriHash does not recompute → split.rule-uri-hash-mismatch", async () => {
    const tampered = { ...PROOF, ruleUriHash: "0x" + "22".repeat(32) };
    expect(await reasonsFor(JSON.stringify(tampered))).toEqual(["split.rule-uri-hash-mismatch"]);
  });

  it("every emitted reason is a member of the closed space", async () => {
    const payloads = ["{{{nope", "{}", '{"schema":"junk"}', JSON.stringify({ ...PROOF, bindingHash: "0x" + "11".repeat(32) })];
    for (const p of payloads) {
      for (const reason of await reasonsFor(p)) {
        expect(isReasonCode(reason)).toBe(true);
      }
    }
  });
});
