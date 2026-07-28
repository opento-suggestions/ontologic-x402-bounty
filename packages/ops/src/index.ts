/**
 * @witness/ops — the keyed engine. Three layers, one boundary:
 *   packages/core  — pure keyless verification (no clients, no keys, no env writes)
 *   packages/ops   — THIS: persona-typed clients + the recurring lane operations
 *   scripts/, mcp  — thin frontends (CLI entries and tool adapters)
 */

export * from "./contexts.js";
export * from "./operator.js";
export * from "./customer.js";
export * from "./plumbing.js";
export * from "./peg.js";
export * from "./stamp.js";
export * from "./verify.js";
export * from "./pay.js";
export * from "./redeem.js";
export * from "./repeg.js";
