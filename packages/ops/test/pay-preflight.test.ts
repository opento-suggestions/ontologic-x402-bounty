/**
 * pay-preflight.test.ts — the token-leg pre-flight fails with a sentence
 * naming the faucet, never a raw SDK status. A mirror hiccup does not block
 * a valid payment. All offline (global fetch stubbed).
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { assertTokenBalance, type PaymentTerms } from "../src/pay.js";
import { PEG } from "../src/peg.js";

const PAYER = "0.0.9646033";
const MIRROR = "https://testnet.mirrornode.hedera.com/api/v1";

const USDC_TERMS: PaymentTerms = {
  scheme: "exact",
  network: "hedera:testnet",
  amount: String(PEG.vending.priceUsdcSmallest),
  asset: PEG.vending.usdcTokenId,
  payTo: "0.0.8641261",
};

function stubBalance(tokens: { balance: number }[] | undefined, ok = true, status = 200) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok, status, json: async () => ({ tokens }) }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("assertTokenBalance — die at step 0 with a sentence", () => {
  it("names the faucet and the network when the payer is not associated", async () => {
    stubBalance([]);
    const attempt = assertTokenBalance(MIRROR, PAYER, USDC_TERMS);
    await expect(attempt).rejects.toThrow(/holds no USDC/);
    await expect(attempt).rejects.toThrow(/faucet\.circle\.com/);
    await expect(attempt).rejects.toThrow(/Hedera Testnet/);
  });

  it("names both amounts when the balance is short", async () => {
    stubBalance([{ balance: 250_000 }]);
    const attempt = assertTokenBalance(MIRROR, PAYER, USDC_TERMS);
    await expect(attempt).rejects.toThrow(/holds 0\.25 USDC/);
    await expect(attempt).rejects.toThrow(/require 0\.5 USDC/);
    await expect(attempt).rejects.toThrow(/faucet\.circle\.com/);
  });

  it("passes a sufficient balance through silently", async () => {
    stubBalance([{ balance: PEG.vending.priceUsdcSmallest }]);
    await expect(assertTokenBalance(MIRROR, PAYER, USDC_TERMS)).resolves.toBeUndefined();
  });

  it("never blocks a valid payment on a mirror error — the network stays the judge", async () => {
    stubBalance(undefined, false, 500);
    await expect(assertTokenBalance(MIRROR, PAYER, USDC_TERMS)).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(assertTokenBalance(MIRROR, PAYER, USDC_TERMS)).resolves.toBeUndefined();
  });

  it("speaks in raw units for a token it does not recognize", async () => {
    stubBalance([{ balance: 5 }]);
    const attempt = assertTokenBalance(MIRROR, PAYER, { ...USDC_TERMS, asset: "0.0.5449", amount: "10" });
    await expect(attempt).rejects.toThrow(/holds 5 units of 0\.0\.5449/);
    await expect(attempt).rejects.toThrow(/require 10 units/);
  });
});
