/**
 * canonicalize.test.ts — the recipe lock (offline, no network).
 *
 * Vectors copied from ontologic-hello-world/test/canonicalize.test.ts — the
 * pinned seq-42 anchors from the LIVE v0.8 sphere (topic 0.0.8641938). Proves
 * the ported seam reproduces the protocol's hash recipe byte-for-byte.
 */

import { describe, it, expect } from "vitest";
import {
  canonicalizeJSON,
  computeRuleUriHash,
  computeBindingHash,
  keccak256Canonical,
  sha256Utf8,
} from "../src/morpheme.js";

// Pinned seq-42 vector (registry mode) — do not re-derive.
const SEQ42 = {
  ruleUri: "hcs://0.0.8641938/1776142805.844760965",
  ruleUriHash: "0xe93b11fbbaeb00c513c562beea969b084eeda12cfda2c9de3c131326c948ae50",
  inputsHash: "0x39c96d5608b5e39fd9610cfe2a4aa92d998100c16faa36d3691ab91b76a3c548",
  outputsHash: "0xf78a4e647936f12c0ca96f5cb6420ec53c6508676caaa0abc96ce7ebdbdce490",
  bindingHash: "0xf17b903e1587d02d52b7d9a866ac6f69537cd9674c2850ff3deaf4f0d697276a",
};

describe("pinned seq-42 anchors", () => {
  it("reproduces ruleUriHash from the URI string alone (SHA256)", () => {
    expect(computeRuleUriHash(SEQ42.ruleUri)).toBe(SEQ42.ruleUriHash);
  });

  it("reproduces bindingHash from {ruleUri, inputsHash, outputsHash} (keccak256)", () => {
    expect(
      computeBindingHash({
        ruleUri: SEQ42.ruleUri,
        inputsHash: SEQ42.inputsHash,
        outputsHash: SEQ42.outputsHash,
      }),
    ).toBe(SEQ42.bindingHash);
  });

  it("uses SHA256 for the ruleUri, keccak256 elsewhere (the split is real)", () => {
    expect(sha256Utf8(SEQ42.ruleUri)).not.toBe(keccak256Canonical(SEQ42.ruleUri));
  });
});

describe("canonicalizeJSON (RFC 8785 subset)", () => {
  it("sorts object keys lexicographically", () => {
    expect(canonicalizeJSON({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("normalizes numbers (1.0 -> 1)", () => {
    expect(canonicalizeJSON({ n: 1.0 })).toBe('{"n":1}');
  });

  it("emits no whitespace and escapes strings via JSON.stringify", () => {
    expect(canonicalizeJSON('a"b')).toBe('"a\\"b"');
  });

  it("handles arrays, nesting, and null", () => {
    expect(canonicalizeJSON([1, "a", null])).toBe('[1,"a",null]');
    expect(canonicalizeJSON({ z: [{ y: 1, x: 2 }] })).toBe('{"z":[{"x":2,"y":1}]}');
    expect(canonicalizeJSON(null)).toBe("null");
  });
});
