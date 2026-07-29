/**
 * redeem-match.test.ts — the receipt matcher recognizes BOTH published legs
 * and nothing else. HBAR is judged at the receipt's own era price; USDC has
 * a single era (the treasury's association postdates the only reprice, so
 * no USDC receipt can predate the current price). All offline.
 */

import { describe, expect, it } from "vitest";
import { vendReceiptFrom, VEND_MEMO_PREFIX, type MirrorTx } from "../src/redeem.js";
import { PEG } from "../src/peg.js";

const TREASURY = "0.0.8641261";
const ALIAS = "0xabc123def456abc123def456abc123def456abcd";
const CURRENT_ERA_TS = "1785339000.000000000"; // after the 2026-07-27 reprice boundary
const OLD_ERA_TS = "1785000000.000000000"; // before it — $0.01 at the peg

function tx(overrides: Partial<MirrorTx>): MirrorTx {
  return {
    consensus_timestamp: CURRENT_ERA_TS,
    memo_base64: Buffer.from(`${VEND_MEMO_PREFIX}${ALIAS}`).toString("base64"),
    result: "SUCCESS",
    transaction_id: "0.0.111-111-111",
    ...overrides,
  };
}

describe("vendReceiptFrom — both legs, era-honest", () => {
  it("matches an HBAR receipt at the current era price", () => {
    const receipt = vendReceiptFrom(
      tx({ transfers: [{ account: TREASURY, amount: 500_000_000 }] }),
      TREASURY,
    );
    expect(receipt).toEqual({ alias: ALIAS, txId: "0.0.111-111-111" });
  });

  it("honors an old-era HBAR receipt at its own price", () => {
    const oldPrice = Math.round((0.01 / PEG.hbarUsd) * 1e8);
    const receipt = vendReceiptFrom(
      tx({ consensus_timestamp: OLD_ERA_TS, transfers: [{ account: TREASURY, amount: oldPrice }] }),
      TREASURY,
    );
    expect(receipt).not.toBeNull();
  });

  it("rejects an underpaid HBAR transfer at the current era", () => {
    const receipt = vendReceiptFrom(
      tx({ transfers: [{ account: TREASURY, amount: 1_000_000 }] }),
      TREASURY,
    );
    expect(receipt).toBeNull();
  });

  it("matches a USDC receipt at the published amount", () => {
    const receipt = vendReceiptFrom(
      tx({
        token_transfers: [
          { token_id: PEG.vending.usdcTokenId, account: TREASURY, amount: PEG.vending.priceUsdcSmallest },
        ],
      }),
      TREASURY,
    );
    expect(receipt).toEqual({ alias: ALIAS, txId: "0.0.111-111-111" });
  });

  it("rejects an underpaid USDC transfer", () => {
    const receipt = vendReceiptFrom(
      tx({
        token_transfers: [
          { token_id: PEG.vending.usdcTokenId, account: TREASURY, amount: PEG.vending.priceUsdcSmallest - 1 },
        ],
      }),
      TREASURY,
    );
    expect(receipt).toBeNull();
  });

  it("rejects the right amount of the wrong token", () => {
    const receipt = vendReceiptFrom(
      tx({ token_transfers: [{ token_id: "0.0.5449", account: TREASURY, amount: PEG.vending.priceUsdcSmallest }] }),
      TREASURY,
    );
    expect(receipt).toBeNull();
  });

  it("rejects a paid transfer without the vend memo", () => {
    const receipt = vendReceiptFrom(
      tx({
        memo_base64: Buffer.from("just a transfer").toString("base64"),
        transfers: [{ account: TREASURY, amount: 500_000_000 }],
      }),
      TREASURY,
    );
    expect(receipt).toBeNull();
  });

  it("rejects a failed transaction regardless of transfers", () => {
    const receipt = vendReceiptFrom(
      tx({ result: "INSUFFICIENT_PAYER_BALANCE", transfers: [{ account: TREASURY, amount: 500_000_000 }] }),
      TREASURY,
    );
    expect(receipt).toBeNull();
  });
});
