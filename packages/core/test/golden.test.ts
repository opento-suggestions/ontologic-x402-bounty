/**
 * golden.test.ts — re-pinned vectors from this repo's first real Lane A stamp.
 *
 * The first WHITE trace (light domain) stamped to the WITNESS_HBAR topic on
 * 2026-07-19, HIP-991 fee charged atomically. Locks our own claim builder as a
 * regression anchor: the claim rebuilds from the SAME live taxonomy the
 * producer used, so these hashes must reproduce as long as the referenced
 * rule version and evidence proofs remain the registry's latest.
 */

import { describe, it, expect } from "vitest";
import { computeRuleUriHash, computeBindingHash } from "../src/morpheme.js";

const GOLDEN = {
  topicId: "0.0.9645621",
  consensusTimestamp: "1784493185.787686246",
  ruleUri: "hcs://0.0.8641938/1776124114.345388151",
  ruleUriHash: "0x3a92103374ad8ed5bf5e466854ecfb07f97bdcb1013ecee125e29cdf166ce41b",
  inputsHash: "0x459b3a94831b1811e76964d50c132ca983ce5172882f459fc4b891a272366376",
  outputsHash: "0x76f808e3b36a1ed1d19e232ed0f40158df7baadc6a39909d62d533d5e1728a4c",
  bindingHash: "0x6bedac4246516589785b2f275c3e86aaa54b5f11d1ca54934ca34259cca26f41",
};

describe("golden vectors (first live Lane A stamp)", () => {
  it("ruleUriHash reproduces from the URI string alone (SHA256)", () => {
    expect(computeRuleUriHash(GOLDEN.ruleUri)).toBe(GOLDEN.ruleUriHash);
  });

  it("bindingHash reproduces from {ruleUri, inputsHash, outputsHash}", () => {
    expect(
      computeBindingHash({
        ruleUri: GOLDEN.ruleUri,
        inputsHash: GOLDEN.inputsHash,
        outputsHash: GOLDEN.outputsHash,
      }),
    ).toBe(GOLDEN.bindingHash);
  });
});
