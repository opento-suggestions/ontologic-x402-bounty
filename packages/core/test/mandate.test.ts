/**
 * mandate.test.ts — the authority layer's grant lifecycle (offline).
 *
 * W-11 as code: a self-granted mandate is unconstructible; the window is
 * judged against consensus timestamps with exact arithmetic; revocation ends
 * the window early but never retroactively; scope is the closed minimum
 * {verdictClass, topicId}. Full on-chain resolution (resolveMandate against
 * the live registry) is exercised post-ceremony by the live crosscheck
 * pattern — these tests pin the pure predicates and the read-time judge.
 */

import { describe, it, expect } from "vitest";
import {
  buildMandateMorpheme,
  buildMandateRevocation,
  MANDATE_SCHEMA,
  type MandateScope,
} from "../src/schema.js";
import { mandateHashesRecompute } from "../src/resolve.js";
import { checkMandateWindow, checkMandateScope, judgeMessage } from "../src/verify.js";
import { compareTimestamps } from "../src/timestamps.js";
import type { MirrorMessage } from "../src/mirror.js";

const REGISTRY = "0.0.7777777";
const VERDICT_TOPIC = "0.0.8888888";
const RULE_URI = `hcs://${REGISTRY}/1785000000.000000001`;

const SCOPE: MandateScope = { verdictClass: "rejection-attestation", topicId: VERDICT_TOPIC };

const OPTIONS = {
  mirrorNodeUrl: "http://mirror.invalid",
  skipRuleResolution: true,
  skipMandateResolution: true,
  witnessRegistryTopicId: REGISTRY,
  verdictTopicId: VERDICT_TOPIC,
};

function grant(overrides: Partial<Parameters<typeof buildMandateMorpheme>[0]> = {}) {
  return buildMandateMorpheme({
    ruleId: "witness://org/authority/delegation",
    ruleUri: RULE_URI,
    principal: "0.0.111",
    grantee: "0.0.8641261",
    scope: SCOPE,
    notBefore: "1785000000",
    notAfter: "1787592000",
    nonce: "nonce-0001",
    createdAt: "2026-07-25T00:00:00.000Z",
    ...overrides,
  });
}

function mirrorMsg(payload: unknown, topicSeq = 1, ts = "1785100000.000000000"): MirrorMessage {
  return {
    consensus_timestamp: ts,
    sequence_number: topicSeq,
    message: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
    payer_account_id: "0.0.111",
  };
}

describe("mandate construction (W-11 at the builder)", () => {
  it("a self-granted mandate is unconstructible", () => {
    expect(() => grant({ grantee: "0.0.111" })).toThrow(/distinct/);
  });

  it("refuses an empty nonce, an empty window, and out-of-space scope", () => {
    expect(() => grant({ nonce: "" })).toThrow(/nonce/);
    expect(() => grant({ notAfter: "1785000000" })).toThrow(/empty/);
    expect(() => grant({ notAfter: "1784999999" })).toThrow(/empty/);
    expect(() => grant({ scope: { verdictClass: "success-verdict" as never, topicId: VERDICT_TOPIC } })).toThrow(
      /closed verdict-class space/,
    );
    expect(() => grant({ notBefore: "2026-07-25T00:00:00Z" })).toThrow(/consensus-style/);
  });

  it("the sealed hashes recompute, and the nonce moves the mandateHash", () => {
    const a = grant();
    expect(mandateHashesRecompute(a)).toBe(true);
    const b = grant({ nonce: "nonce-0002" });
    expect(b.bindingHash).not.toBe(a.bindingHash); // fresh identity per grant
    // statusProfile rides in M, unsealed — it never moves the mandateHash.
    const c = grant({ statusProfile: { schemaVersion: "0.1-mvp", status: "declared" } });
    expect(c.bindingHash).toBe(a.bindingHash);
  });
});

describe("the mandate window (half-open, exact arithmetic)", () => {
  const m = { notBefore: "1785000000", notAfter: "1787592000" as string | null };

  it("verdicts inside [notBefore, notAfter) pass; the boundaries behave", () => {
    expect(checkMandateWindow(m, null, "1784999999.999999999")).toBe(false); // before
    expect(checkMandateWindow(m, null, "1785000000.000000000")).toBe(true); // inclusive start
    expect(checkMandateWindow(m, null, "1786000000.5")).toBe(true); // inside
    expect(checkMandateWindow(m, null, "1787592000.000000000")).toBe(false); // exclusive end
  });

  it("revocation ends the window early, never retroactively", () => {
    const revokedAt = "1786000000.000000000";
    expect(checkMandateWindow(m, revokedAt, "1785500000")).toBe(true); // before revocation: stands
    expect(checkMandateWindow(m, revokedAt, "1786000000.000000000")).toBe(false); // at revocation: out
    expect(checkMandateWindow(m, revokedAt, "1787000000")).toBe(false); // after revocation: out
  });

  it("an open window (notAfter null) is bounded only by revocation", () => {
    const open = { notBefore: "1785000000", notAfter: null };
    expect(checkMandateWindow(open, null, "1999999999")).toBe(true);
    expect(checkMandateWindow(open, "1786000000", "1999999999")).toBe(false);
  });

  it("timestamp comparison is exact at nanosecond boundaries", () => {
    expect(compareTimestamps("1785000000.000000001", "1785000000.000000002")).toBe(-1);
    expect(compareTimestamps("1785000000.1", "1785000000.100000000")).toBe(0);
  });
});

describe("the mandate scope (closed minimum, §6.3)", () => {
  it("covers exactly its verdict class on exactly its topic", () => {
    expect(checkMandateScope(SCOPE, "rejection-attestation", VERDICT_TOPIC)).toBe(true);
    expect(checkMandateScope(SCOPE, "rejection-attestation", "0.0.9645621")).toBe(false);
  });
});

describe("judgeMessage on authority messages", () => {
  it("a well-formed mandate on the registry topic → kind mandate", async () => {
    const verdict = await judgeMessage(mirrorMsg(grant()), REGISTRY, OPTIONS);
    expect(verdict.kind).toBe("mandate");
    expect(verdict.reasons).toEqual([]);
    expect(verdict.mandate?.bindingHash).toBe(grant().bindingHash);
  });

  it("a mandate anywhere but the registry → invalid + mandate.wrong-topic", async () => {
    const verdict = await judgeMessage(mirrorMsg(grant()), "0.0.9645621", OPTIONS);
    expect(verdict.kind).toBe("invalid");
    expect(verdict.reasons).toEqual(["mandate.wrong-topic"]);
  });

  it("a hand-crafted self-granted mandate → invalid + mandate.self-granted", async () => {
    const forged = { ...grant(), grantee: "0.0.111" };
    const verdict = await judgeMessage(mirrorMsg(forged), REGISTRY, OPTIONS);
    expect(verdict.kind).toBe("invalid");
    expect(verdict.reasons).toEqual(["mandate.self-granted"]);
  });

  it("a tampered grant fails Peirce — the claimed mandateHash is not believed", async () => {
    const tampered = { ...grant(), notAfter: "1999999999" }; // widen the window, keep the hashes
    const verdict = await judgeMessage(mirrorMsg(tampered), REGISTRY, OPTIONS);
    expect(verdict.kind).toBe("invalid");
    expect(verdict.reasons).toEqual(["peirce.binding-mismatch"]);
    expect(mandateHashesRecompute(tampered as never)).toBe(false);
  });

  it("a revocation on the registry → kind revocation; elsewhere → wrong-topic", async () => {
    const revocation = buildMandateRevocation({
      mandateHash: grant().bindingHash,
      revokedBy: "0.0.111",
      createdAt: "2026-07-25T00:00:00.000Z",
    });
    const onRegistry = await judgeMessage(mirrorMsg(revocation), REGISTRY, OPTIONS);
    expect(onRegistry.kind).toBe("revocation");
    const onLane = await judgeMessage(mirrorMsg(revocation), "0.0.9645621", OPTIONS);
    expect(onLane.kind).toBe("invalid");
    expect(onLane.reasons).toEqual(["mandate.wrong-topic"]);
  });

  it("schema constant sanity: the fixtures really are the wire schema", () => {
    expect(grant().schema).toBe(MANDATE_SCHEMA);
  });
});
