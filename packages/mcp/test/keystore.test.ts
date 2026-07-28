/**
 * keystore.test.ts — the challenge handoff persists exactly like genesis
 * state, in the same file, without disturbing the newborn entries.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordChallenge, latestChallenge } from "../src/state/keystore.js";
import type { StoredChallenge } from "../src/payment-terms.js";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "witness-mcp-test-"));
  vi.stubEnv("WITNESS_STATE_DIR", dir);
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

const CHALLENGE: StoredChallenge = {
  body: { vending: { accepts: [] } },
  accepts: [
    {
      scheme: "exact",
      network: "hedera:testnet",
      amount: "500000000",
      asset: "0.0.0",
      payTo: "0.0.4242",
      maxTimeoutSeconds: 180,
    },
  ],
  source: "https://gw.example/x402/vend (HTTP 402)",
  fetchedAt: "2026-07-28T12:00:00.000Z",
};

describe("challenge handoff", () => {
  it("round-trips through the keystore", () => {
    expect(latestChallenge()).toBeNull();
    recordChallenge(CHALLENGE);
    expect(latestChallenge()).toEqual(CHALLENGE);
  });

  it("preserves existing newborn entries", () => {
    const newborn = {
      alias: "0xabc123",
      derKey: "302e0201...",
      accountId: null,
      createdAt: "2026-07-28T11:00:00.000Z",
    };
    fs.writeFileSync(path.join(dir, "keystore.json"), JSON.stringify({ newborns: [newborn] }, null, 2));
    recordChallenge(CHALLENGE);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "keystore.json"), "utf8"));
    expect(onDisk.newborns).toEqual([newborn]);
    expect(onDisk.challenge).toEqual(CHALLENGE);
  });
});
