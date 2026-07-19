/**
 * mirror.ts — the mirror-node REST client. The canonical (free, keyless,
 * public) read path. Handles pagination and HCS chunked-message reassembly.
 *
 * Chunk strategy ported from ontologicv0.5_clean scripts/v0.7/lib/resolve.js:
 * a timestamp query may land on any chunk, and batch publishing can interleave
 * chunks with other messages — search a bounded window around the hit, capped
 * at 8 queries per resolve.
 */

export interface MirrorMessage {
  consensus_timestamp: string;
  sequence_number: number | string;
  message: string; // base64
  payer_account_id?: string;
  topic_id?: string;
  chunk_info?: {
    number: number;
    total: number;
    initial_transaction_id: { transaction_valid_start: string };
  } | null;
}

interface MessagesPage {
  messages?: MirrorMessage[];
  links?: { next?: string | null };
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Mirror node ${response.status}: ${url}`);
  }
  return (await response.json()) as T;
}

export function decodeMessage(msg: MirrorMessage): string {
  return Buffer.from(msg.message, "base64").toString("utf8");
}

/** Fetch every message on a topic, following pagination. order asc. */
export async function fetchAllTopicMessages(
  mirrorUrl: string,
  topicId: string,
): Promise<MirrorMessage[]> {
  const all: MirrorMessage[] = [];
  let next: string | null = `${mirrorUrl}/topics/${topicId}/messages?limit=100&order=asc`;
  while (next) {
    const page: MessagesPage = await getJson<MessagesPage>(next);
    all.push(...(page.messages ?? []));
    next = page.links?.next ? `${mirrorUrl}${page.links.next}` : null;
  }
  return all;
}

/** Fetch the message at an exact consensus timestamp (chunk-aware, reassembled UTF-8 body). */
export async function fetchMessageAtTimestamp(
  mirrorUrl: string,
  topicId: string,
  timestamp: string,
): Promise<string> {
  const data = await getJson<MessagesPage>(
    `${mirrorUrl}/topics/${topicId}/messages?timestamp=${timestamp}`,
  );
  const first = data.messages?.[0];
  if (!first) {
    throw new Error(`No message at hcs://${topicId}/${timestamp}`);
  }

  if (!first.chunk_info || first.chunk_info.total <= 1) {
    return decodeMessage(first);
  }

  // Chunked: collect siblings by initial_transaction_id in a bounded window.
  const totalChunks = first.chunk_info.total;
  const txStart = first.chunk_info.initial_transaction_id.transaction_valid_start;
  const seqNum = Number(first.sequence_number);
  const chunks: MirrorMessage[] = [first];
  const maxQueries = 8;
  let queries = 0;

  const collect = (page: MessagesPage) => {
    for (const m of page.messages ?? []) {
      if (m.chunk_info?.initial_transaction_id.transaction_valid_start === txStart) {
        chunks.push(m);
      }
    }
  };

  const backStart = Math.max(1, seqNum - totalChunks * 3);
  let backLink: string | null =
    `${mirrorUrl}/topics/${topicId}/messages?sequencenumber=gte:${backStart}&sequencenumber=lt:${seqNum}&limit=100`;
  while (chunks.length < totalChunks && backLink && queries < maxQueries) {
    queries++;
    const page: MessagesPage = await getJson<MessagesPage>(backLink);
    collect(page);
    backLink = page.links?.next ? `${mirrorUrl}${page.links.next}` : null;
  }

  let fwdLink: string | null =
    `${mirrorUrl}/topics/${topicId}/messages?sequencenumber=gt:${seqNum}&limit=100`;
  while (chunks.length < totalChunks && fwdLink && queries < maxQueries) {
    queries++;
    const page: MessagesPage = await getJson<MessagesPage>(fwdLink);
    collect(page);
    fwdLink = page.links?.next ? `${mirrorUrl}${page.links.next}` : null;
  }

  chunks.sort((a, b) => (a.chunk_info?.number ?? 0) - (b.chunk_info?.number ?? 0));
  if (chunks.length !== totalChunks) {
    throw new Error(`Expected ${totalChunks} chunks at hcs://${topicId}/${timestamp}, found ${chunks.length}`);
  }
  return chunks.map(decodeMessage).join("");
}

/** Token info (used for KEY audits and provenance state). */
export async function fetchToken(
  mirrorUrl: string,
  tokenId: string,
): Promise<Record<string, unknown>> {
  return getJson<Record<string, unknown>>(`${mirrorUrl}/tokens/${tokenId}`);
}
