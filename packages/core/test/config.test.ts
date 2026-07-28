/**
 * config.test.ts — placeholder-shaped env values fail at step 0 with a clear
 * message, never deep in the SDK as "failed to parse entity id".
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { isPlaceholder, getOperatorConfig } from "../src/config.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isPlaceholder", () => {
  it("catches every .env.example placeholder shape", () => {
    expect(isPlaceholder("<your-der-encoded-private-key>")).toBe(true);
    expect(isPlaceholder("0.0.XXXXXXX")).toBe(true);
    expect(isPlaceholder("0x0000000000000000000000000000000000xxxxxx")).toBe(true);
  });

  it("passes every legitimate value shape", () => {
    expect(isPlaceholder("0.0.8641261")).toBe(false); // account id
    expect(isPlaceholder("302e020100300506032b657004220420ab54a98ceb1f0ad2")).toBe(false); // DER hex
    expect(isPlaceholder("0x0000000000000000000000000000000000932f27")).toBe(false); // EVM address
    expect(isPlaceholder("https://testnet.mirrornode.hedera.com/api/v1")).toBe(false);
  });
});

describe("getOperatorConfig", () => {
  it("refuses the OPERATOR_ID placeholder before any client could open", () => {
    vi.stubEnv("OPERATOR_ID", "0.0.XXXXXXX");
    vi.stubEnv("OPERATOR_DER_KEY", "302e020100300506032b657004220420ab54a98ceb1f0ad2");
    expect(() => getOperatorConfig()).toThrow(/OPERATOR_ID.*placeholder/);
  });
});
