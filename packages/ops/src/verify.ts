/**
 * verify.ts — the keyless re-check as an operation: wait out mirror lag for
 * the exact consensus instant, then judge with the same judgeMessage the
 * wall and reject-attest use. No key, no context — anyone can run this.
 */

import { judgeMessage } from "../../core/src/verify.js";
import type { MirrorMessage } from "../../core/src/mirror.js";
import { sleep } from "./plumbing.js";

export type StampVerdict = Awaited<ReturnType<typeof judgeMessage>>;

export interface VerifiedStamp {
  topicId: string;
  message: MirrorMessage;
  verdict: StampVerdict;
}

/**
 * Search the given topics for a message at the EXACT consensus timestamp
 * (mirror's `timestamp=` filter is >=, so equality is asserted), judging it
 * when found. Returns null if no topic shows it within the try budget.
 */
export async function verifyStampOnMirror(
  topicIds: string[],
  consensusTimestamp: string,
  opts: { mirrorNodeUrl: string; tries?: number },
): Promise<VerifiedStamp | null> {
  const tries = opts.tries ?? 10;
  for (let attempt = 0; attempt < tries; attempt++) {
    for (const topicId of topicIds) {
      const resp = await fetch(`${opts.mirrorNodeUrl}/topics/${topicId}/messages?timestamp=${consensusTimestamp}`);
      if (!resp.ok) continue;
      const data = (await resp.json()) as { messages?: MirrorMessage[] };
      const msg = data.messages?.[0];
      if (!msg || msg.consensus_timestamp !== consensusTimestamp) continue;
      const verdict = await judgeMessage(msg, topicId, { mirrorNodeUrl: opts.mirrorNodeUrl });
      return { topicId, message: msg, verdict };
    }
    await sleep(2000);
  }
  return null;
}
