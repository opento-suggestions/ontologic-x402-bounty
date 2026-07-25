/**
 * timestamps.ts — consensus-timestamp arithmetic.
 *
 * Everything temporal in the authority layer (mandate windows, revocation
 * bounds, the pre-mandate era) is expressed in Hedera consensus-timestamp
 * form: a decimal string "seconds[.nanoseconds]". Comparison is exact —
 * integer seconds, then nanoseconds padded to nine digits — never float,
 * so two honest readers can never disagree at a boundary (W-12).
 */

/** -1 if a < b, 0 if equal, 1 if a > b. Both are "seconds[.nanos]" strings. */
export function compareTimestamps(a: string, b: string): number {
  const [aSec, aNano = ""] = a.split(".");
  const [bSec, bNano = ""] = b.split(".");
  const aS = BigInt(aSec);
  const bS = BigInt(bSec);
  if (aS !== bS) return aS < bS ? -1 : 1;
  const aN = aNano.padEnd(9, "0");
  const bN = bNano.padEnd(9, "0");
  return aN < bN ? -1 : aN > bN ? 1 : 0;
}

const TIMESTAMP_RE = /^\d+(\.\d{1,9})?$/;

export function isConsensusTimestamp(value: string): boolean {
  return TIMESTAMP_RE.test(value);
}
