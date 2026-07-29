/**
 * payment-terms.test.ts — the resolution order that makes the payer a
 * customer: 402 challenge → config.witness.json → instructive failure.
 * The operator's environment must never be consulted. All offline.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchGatewayChallenge,
  matchAccepts,
  readConfigAccepts,
  resolvePaymentTerms,
  termsWantedFor,
  type AcceptsEntry,
  type StoredChallenge,
} from "../src/payment-terms.js";

const NOW = Date.parse("2026-07-28T12:00:00Z");

function entry(overrides: Partial<AcceptsEntry> = {}): AcceptsEntry {
  return {
    scheme: "exact",
    network: "hedera:testnet",
    amount: "500000000",
    asset: "0.0.0",
    payTo: "0.0.4242",
    maxTimeoutSeconds: 180,
    ...overrides,
  };
}

function challenge(ageSeconds: number, overrides: Partial<AcceptsEntry> = {}): StoredChallenge {
  return {
    body: { vending: { accepts: [entry(overrides)] } },
    accepts: [entry(overrides)],
    source: "https://gw.example/x402/vend (HTTP 402)",
    fetchedAt: new Date(NOW - ageSeconds * 1000).toISOString(),
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("resolvePaymentTerms — ratified order", () => {
  it("uses a fresh stored challenge without refetching", async () => {
    const fetchChallenge = vi.fn();
    const resolved = await resolvePaymentTerms({
      stored: challenge(10),
      now: NOW,
      gatewayUrl: "https://gw.example/x402/vend",
      fetchChallenge,
      configAccepts: [entry({ payTo: "0.0.7" })],
    });
    expect(resolved.terms.payTo).toBe("0.0.4242");
    expect(resolved.source).toContain("402 challenge");
    expect(resolved.challenge).toBeUndefined();
    expect(fetchChallenge).not.toHaveBeenCalled();
  });

  it("refetches a stale challenge and returns the fresh one for persistence", async () => {
    const fresh = challenge(0, { payTo: "0.0.99" });
    const fetchChallenge = vi.fn().mockResolvedValue(fresh);
    const resolved = await resolvePaymentTerms({
      stored: challenge(400),
      now: NOW,
      gatewayUrl: "https://gw.example/x402/vend",
      fetchChallenge,
      configAccepts: null,
    });
    expect(fetchChallenge).toHaveBeenCalledWith("https://gw.example/x402/vend");
    expect(resolved.terms.payTo).toBe("0.0.99");
    expect(resolved.challenge).toBe(fresh);
  });

  it("falls back to config.witness.json when the refetch fails", async () => {
    const resolved = await resolvePaymentTerms({
      stored: challenge(400),
      now: NOW,
      gatewayUrl: "https://gw.example/x402/vend",
      fetchChallenge: vi.fn().mockRejectedValue(new Error("gateway down")),
      configAccepts: [entry({ payTo: "0.0.7" })],
    });
    expect(resolved.terms.payTo).toBe("0.0.7");
    expect(resolved.source).toContain("config.witness.json");
  });

  it("falls back to config when nothing was ever fetched and no gateway is set", async () => {
    const resolved = await resolvePaymentTerms({
      stored: null,
      now: NOW,
      gatewayUrl: null,
      configAccepts: [entry({ payTo: "0.0.7" })],
    });
    expect(resolved.terms.payTo).toBe("0.0.7");
  });

  it("fails with an instructive message naming both paths when neither resolves", async () => {
    const attempt = resolvePaymentTerms({
      stored: null,
      now: NOW,
      gatewayUrl: null,
      configAccepts: null,
    });
    await expect(attempt).rejects.toThrow(/witness_requirements/);
    await expect(attempt).rejects.toThrow(/config\.witness\.json/);
  });

  it("rejects a published entry with a malformed payTo instead of passing it to the SDK", async () => {
    const attempt = resolvePaymentTerms({
      stored: challenge(10, { payTo: "0.0.XXXXXXX" }),
      now: NOW,
      gatewayUrl: null,
      configAccepts: null,
    });
    await expect(attempt).rejects.toThrow(/not an account id/);
  });

  it("never consults OPERATOR_ID — the regression that broke customer clones", async () => {
    vi.stubEnv("OPERATOR_ID", "0.0.XXXXXXX");
    const resolved = await resolvePaymentTerms({
      stored: challenge(10),
      now: NOW,
      gatewayUrl: null,
      configAccepts: null,
    });
    expect(resolved.terms.payTo).toBe("0.0.4242");
    expect(resolved.terms.payTo).not.toBe("0.0.XXXXXXX");
  });
});

describe("leg selection", () => {
  const USDC = "0.0.429274";
  const bothLegs = [
    entry({ asset: USDC, amount: "500000", payTo: "0.0.4242" }),
    entry(), // HBAR
  ];

  it("termsWantedFor names the two published legs", () => {
    expect(termsWantedFor("hbar")).toEqual({ scheme: "exact", network: "hedera:testnet", asset: "0.0.0" });
    expect(termsWantedFor("usdc")).toEqual({ scheme: "exact", network: "hedera:testnet", asset: USDC });
    expect(termsWantedFor("usdc", "0.0.99").asset).toBe("0.0.99");
  });

  it("the usdc filter selects the USDC entry from a two-leg challenge", async () => {
    const resolved = await resolvePaymentTerms({
      stored: { ...challenge(10), accepts: bothLegs },
      now: NOW,
      gatewayUrl: null,
      configAccepts: null,
      want: termsWantedFor("usdc"),
    });
    expect(resolved.terms.asset).toBe(USDC);
    expect(resolved.terms.amount).toBe("500000");
  });

  it("the default still selects HBAR from the same challenge — non-regression", async () => {
    const resolved = await resolvePaymentTerms({
      stored: { ...challenge(10), accepts: bothLegs },
      now: NOW,
      gatewayUrl: null,
      configAccepts: null,
    });
    expect(resolved.terms.asset).toBe("0.0.0");
  });

  it("a no-matching-leg failure names the legs actually published", async () => {
    const attempt = resolvePaymentTerms({
      stored: challenge(10), // HBAR-only challenge
      now: NOW,
      gatewayUrl: null,
      configAccepts: null,
      want: termsWantedFor("usdc"),
    });
    await expect(attempt).rejects.toThrow(/Published legs seen: 0\.0\.0 \(HBAR\)/);
  });

  it("the usdc filter falls back to config.witness.json like any other leg", async () => {
    const resolved = await resolvePaymentTerms({
      stored: null,
      now: NOW,
      gatewayUrl: null,
      configAccepts: bothLegs,
      want: termsWantedFor("usdc"),
    });
    expect(resolved.terms.asset).toBe(USDC);
    expect(resolved.source).toContain("config.witness.json");
  });
});

describe("the shipped config.witness.json", () => {
  it("carries real entity ids in every accepts entry — a customer can pay from it offline", () => {
    const repoConfig = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../config.witness.json",
    );
    const accepts = readConfigAccepts(repoConfig);
    expect(accepts).not.toBeNull();
    for (const a of accepts!) {
      expect(a.payTo).toMatch(/^\d+\.\d+\.\d+$/);
      expect(Number(a.amount)).toBeGreaterThan(0);
    }
    expect(matchAccepts(accepts!, { scheme: "exact", network: "hedera:testnet", asset: "0.0.0" })).not.toBeNull();
    expect(matchAccepts(accepts!, termsWantedFor("usdc"))).not.toBeNull();
  });
});

describe("fetchGatewayChallenge", () => {
  it("reads a literal 402 body and stamps fetchedAt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        status: 402,
        ok: false,
        json: async () => ({ vending: { accepts: [entry()] } }),
      }),
    );
    const got = await fetchGatewayChallenge("https://gw.example/x402/vend");
    expect(got.accepts).toHaveLength(1);
    expect(got.source).toContain("HTTP 402");
    expect(Date.parse(got.fetchedAt)).not.toBeNaN();
  });

  it("throws on a non-402 error status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 500, ok: false, json: async () => ({}) }));
    await expect(fetchGatewayChallenge("https://gw.example")).rejects.toThrow(/HTTP 500/);
  });

  it("throws distinctly when unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(fetchGatewayChallenge("https://gw.example")).rejects.toThrow(/unreachable/);
  });
});
