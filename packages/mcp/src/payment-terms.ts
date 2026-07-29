/**
 * payment-terms.ts — WHO to pay and HOW MUCH, resolved from what the service
 * PUBLISHED, never from the operator's environment.
 *
 * The payer-agent is a customer. A customer clone has no OPERATOR_ID, so the
 * payment destination must come from the service's own published surfaces:
 *
 *   (a) the 402 challenge witness_requirements fetched from the gateway —
 *       persisted in the keystore by the caller, refetched here if older than
 *       the challenge's own maxTimeoutSeconds;
 *   (b) config.witness.json at the repo root — the deploy-time artifact
 *       the peg CLI (npm run peg) writes, for offline operation;
 *   (c) neither → one instructive error naming both paths.
 *
 * Everything is injectable so the resolution order is testable offline.
 * This module holds no keys, opens no clients, and reads no operator env.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface AcceptsEntry {
  scheme: string;
  network: string;
  amount: string; // smallest unit (tinybar for HBAR), as a string
  asset: string; // "0.0.0" = HBAR, otherwise an HTS token id
  payTo: string;
  maxTimeoutSeconds?: number;
  description?: string;
}

export interface StoredChallenge {
  body: Record<string, unknown>; // the full 402 body, verbatim
  accepts: AcceptsEntry[];
  source: string; // e.g. "https://…/x402/vend (HTTP 402)"
  fetchedAt: string; // ISO timestamp of the fetch
}

export const DEFAULT_MAX_TIMEOUT_SECONDS = 180;

/** The two published legs a payer can settle. HBAR is the default; USDC is
 * the dollar-honest opt-in (Circle testnet USDC, six decimals). */
export type PaymentLeg = "hbar" | "usdc";

export function termsWantedFor(
  leg: PaymentLeg,
  usdcAsset = "0.0.429274",
): Pick<AcceptsEntry, "scheme" | "network" | "asset"> {
  return { scheme: "exact", network: "hedera:testnet", asset: leg === "hbar" ? "0.0.0" : usdcAsset };
}

/** The HBAR leg of the exact scheme — the default witness_pay settles. */
export const HBAR_TERMS_WANTED = {
  scheme: "exact",
  network: "hedera:testnet",
  asset: "0.0.0",
} as const;

function extractAccepts(body: Record<string, unknown>): AcceptsEntry[] {
  const vending = body.vending as { accepts?: unknown } | undefined;
  const raw = vending?.accepts ?? (body.accepts as unknown);
  return Array.isArray(raw) ? (raw as AcceptsEntry[]) : [];
}

/** GET the gateway. A literal 402 response IS the conformance surface — read its body. */
export async function fetchGatewayChallenge(url: string): Promise<StoredChallenge> {
  let resp: Response;
  try {
    resp = await fetch(url);
  } catch (err) {
    throw new Error(`Requirements endpoint unreachable: ${(err as Error).message}`);
  }
  if (resp.status !== 402 && !resp.ok) {
    throw new Error(`Requirements endpoint returned HTTP ${resp.status}`);
  }
  const body = (await resp.json()) as Record<string, unknown>;
  return {
    body,
    accepts: extractAccepts(body),
    source: `${url} (HTTP ${resp.status})`,
    fetchedAt: new Date().toISOString(),
  };
}

export interface WitnessConfigFile {
  treasuryAccountId?: string;
  requirements?: {
    lanes?: Record<string, unknown>;
    vending?: ({ accepts?: AcceptsEntry[] } & Record<string, unknown>) | undefined;
  } & Record<string, unknown>;
}

function findFileFrom(start: string, name: string): string | undefined {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Locate and parse config.witness.json — cwd walk first, then from this
 * module's own directory (src → mcp → packages → repo root), because an MCP
 * host like goose spawns the server with the HOST's cwd. Returns null if
 * missing or unparseable; an explicit path skips the walk (tests, overrides).
 */
export function readWitnessConfig(configPath?: string): WitnessConfigFile | null {
  const found =
    configPath ??
    findFileFrom(process.cwd(), "config.witness.json") ??
    findFileFrom(path.dirname(fileURLToPath(import.meta.url)), "config.witness.json");
  if (!found) return null;
  try {
    return JSON.parse(fs.readFileSync(found, "utf8")) as WitnessConfigFile;
  } catch {
    return null;
  }
}

export function readConfigAccepts(configPath?: string): AcceptsEntry[] | null {
  const accepts = readWitnessConfig(configPath)?.requirements?.vending?.accepts;
  return Array.isArray(accepts) && accepts.length > 0 ? accepts : null;
}

export function matchAccepts(
  accepts: AcceptsEntry[],
  want: Pick<AcceptsEntry, "scheme" | "network" | "asset">,
): AcceptsEntry | null {
  return (
    accepts.find(
      (a) => a.scheme === want.scheme && a.network === want.network && a.asset === want.asset,
    ) ?? null
  );
}

/** A bad published entry must fail HERE with a named reason, not deep in the SDK. */
function validTerms(entry: AcceptsEntry): string | null {
  if (!/^\d+\.\d+\.\d+$/.test(entry.payTo)) return `payTo "${entry.payTo}" is not an account id`;
  const amount = Number(entry.amount);
  if (!Number.isInteger(amount) || amount <= 0) return `amount "${entry.amount}" is not a positive integer`;
  return null;
}

export interface ResolvedTerms {
  terms: AcceptsEntry;
  source: string;
  /** Present when a refetch happened — the caller persists it to the keystore. */
  challenge?: StoredChallenge;
}

export async function resolvePaymentTerms(opts: {
  stored: StoredChallenge | null;
  now?: number;
  gatewayUrl?: string | null;
  fetchChallenge?: (url: string) => Promise<StoredChallenge>;
  configAccepts?: AcceptsEntry[] | null;
  want?: Pick<AcceptsEntry, "scheme" | "network" | "asset">;
}): Promise<ResolvedTerms> {
  const now = opts.now ?? Date.now();
  const gatewayUrl = opts.gatewayUrl !== undefined ? opts.gatewayUrl : process.env.WITNESS_REQUIREMENTS_URL ?? null;
  const fetchChallenge = opts.fetchChallenge ?? fetchGatewayChallenge;
  const configAccepts = opts.configAccepts !== undefined ? opts.configAccepts : readConfigAccepts();
  const want = opts.want ?? HBAR_TERMS_WANTED;

  const seenAssets = new Set<string>();
  const noteAssets = (accepts: AcceptsEntry[]) => accepts.forEach((a) => seenAssets.add(a.asset));

  const useIfValid = (entry: AcceptsEntry | null, source: string, challenge?: StoredChallenge): ResolvedTerms | string => {
    if (!entry) return "no matching accepts entry";
    const problem = validTerms(entry);
    if (problem) return problem;
    return { terms: entry, source, challenge };
  };

  // (a) the challenge witness_requirements fetched, if still within its window.
  let challengeNote: string;
  if (opts.stored) {
    noteAssets(opts.stored.accepts);
    const entry = matchAccepts(opts.stored.accepts, want);
    const windowMs = (entry?.maxTimeoutSeconds ?? DEFAULT_MAX_TIMEOUT_SECONDS) * 1000;
    const ageMs = now - Date.parse(opts.stored.fetchedAt);
    if (ageMs <= windowMs) {
      const result = useIfValid(entry, `402 challenge from ${opts.stored.source}, ${Math.round(ageMs / 1000)}s old`);
      if (typeof result !== "string") return result;
      challengeNote = `stored challenge: ${result}`;
    } else {
      challengeNote = `stored challenge is stale (${Math.round(ageMs / 1000)}s old, window ${windowMs / 1000}s)`;
    }
  } else {
    challengeNote = "none stored — witness_requirements has not fetched one";
  }

  // Stale or missing: refetch from the gateway if one is configured.
  if (gatewayUrl) {
    try {
      const fresh = await fetchChallenge(gatewayUrl);
      noteAssets(fresh.accepts);
      const result = useIfValid(matchAccepts(fresh.accepts, want), `402 challenge refetched from ${fresh.source}`, fresh);
      if (typeof result !== "string") return result;
      challengeNote += `; refetch: ${result}`;
    } catch (err) {
      challengeNote += `; refetch failed: ${(err as Error).message}`;
    }
  } else {
    challengeNote += "; no gateway configured (WITNESS_REQUIREMENTS_URL unset)";
  }

  // (b) the deploy-time artifact, for offline / no-gateway operation.
  let configNote: string;
  if (configAccepts) {
    noteAssets(configAccepts);
    const result = useIfValid(matchAccepts(configAccepts, want), "config.witness.json (deploy-time artifact)");
    if (typeof result !== "string") return result;
    configNote = result;
  } else {
    configNote = "config.witness.json not found at the repo root";
  }

  // (c) neither path resolved — say exactly what was tried and how to fix it.
  const legs = [...seenAssets].map((a) => (a === "0.0.0" ? "0.0.0 (HBAR)" : a)).join(", ") || "none seen";
  throw new Error(
    `Cannot resolve payment terms (payTo/amount) for ${want.scheme}/${want.network}/${want.asset}. ` +
      `Published legs seen: ${legs}. ` +
      `Tried: (1) the 402 challenge — ${challengeNote}. (2) config.witness.json — ${configNote}. ` +
      `Fix: run witness_requirements with WITNESS_REQUIREMENTS_URL set, or restore config.witness.json ` +
      `(the operator regenerates it with npm run peg).`,
  );
}
