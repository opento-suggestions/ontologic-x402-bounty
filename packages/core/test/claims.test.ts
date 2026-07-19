/**
 * claims.test.ts — the closed claim space against the LIVE sphere (keyless).
 *
 * Builds both WHITE trace claims (light + paint) by resolving the live
 * registry and PROOF topic, and asserts the hashes are stable and well-formed.
 * Network test — skips if the mirror is unreachable.
 */

import { describe, it, expect } from "vitest";
import { buildWhiteTraceClaim, allowedClaims } from "../src/claims.js";
import { buildStampForClaim } from "../src/claims.js";

const MIRROR = "https://testnet.mirrornode.hedera.com/api/v1";
const REGISTRY = "0.0.8641941";
const PROOF = "0.0.8641943";
const HASH_RE = /^0x[0-9a-f]{64}$/;

async function tryBuild(domain: "light" | "paint") {
  try {
    return await buildWhiteTraceClaim({
      domain,
      registryTopicId: REGISTRY,
      proofTopicId: PROOF,
      resolve: { mirrorNodeUrl: MIRROR },
    });
  } catch (e) {
    if ((e as Error).message.includes("fetch failed")) return null; // offline
    throw e;
  }
}

describe("W-9 closed claim space", () => {
  it("enumerates exactly the two WHITE traces", () => {
    expect(allowedClaims()).toHaveLength(2);
  });

  it("refuses to construct outside the space", async () => {
    await expect(
      buildWhiteTraceClaim({
        domain: "chartreuse" as never,
        registryTopicId: REGISTRY,
        proofTopicId: PROOF,
        resolve: { mirrorNodeUrl: MIRROR },
      }),
    ).rejects.toThrow(/closed claim space/);
  });

  it("builds the WHITE light trace from the live registry, deterministically", async () => {
    const a = await tryBuild("light");
    if (!a) return;
    expect(a.ruleId).toBe("sphere://demo/entity/white-from-cmy");
    expect(a.ruleUri).toMatch(/^hcs:\/\/0\.0\.8641938\//);
    expect(a.bindingHash).toMatch(HASH_RE);
    // Deterministic: a second build produces identical hashes.
    const b = await tryBuild("light");
    expect(b?.bindingHash).toBe(a.bindingHash);
  }, 120_000);

  it("builds the WHITE paint trace and it differs from light", async () => {
    const light = await tryBuild("light");
    const paint = await tryBuild("paint");
    if (!light || !paint) return;
    expect(paint.ruleId).toBe("sphere://demo/entity/white-from-paint");
    expect(paint.bindingHash).toMatch(HASH_RE);
    expect(paint.bindingHash).not.toBe(light.bindingHash);
  }, 120_000);

  it("wraps a claim into a stamp without moving its hashes", async () => {
    const claim = await tryBuild("light");
    if (!claim) return;
    const stamp = buildStampForClaim({
      claim,
      callerAccountId: "0.0.1234",
      createdAt: "2026-07-19T00:00:00.000Z",
    });
    expect(stamp.proof.bindingHash).toBe(claim.bindingHash);
    expect(stamp.statusProfile.status).toBe("declared");
  }, 120_000);
});
