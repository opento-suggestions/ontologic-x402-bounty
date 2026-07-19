/**
 * morpheme.ts — THE SEAM.
 *
 * Ported verbatim from ontologic-hello-world/src/morpheme.ts (the canonical
 * hash source; byte-identical recipe to the v0.8.3 build's canonicalize.js —
 * proven by test/crosscheck.test.ts, not asserted).
 *
 * Hash recipe (RFC 8785 subset canonicalization, then hash):
 *   ruleUriHash = sha256(ruleUri)          ← SHA256, on the URI STRING only
 *   everything else = keccak256(canonicalizeJSON(x))
 * The SHA256-vs-keccak split lives here, in one place, so callers cannot get it
 * wrong: every caller goes through a named compute* wrapper.
 */

import { keccak256, sha256, toUtf8Bytes, concat } from "ethers";

// ─── Canonicalization (RFC 8785 subset: sorted keys, no whitespace, deterministic numbers) ───

export function canonicalizeJSON(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value.toString();
  if (typeof value === "number") return Number(value).toString();
  if (typeof value === "string") return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJSON(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const pairs = Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeJSON(obj[key])}`);
    return `{${pairs.join(",")}}`;
  }

  throw new Error(`Cannot canonicalize type: ${typeof value}`);
}

// ─── The two hash primitives ───

/** keccak256 over the canonical JSON. The default for every hash except ruleUriHash. */
export function keccak256Canonical(value: unknown): string {
  return keccak256(toUtf8Bytes(canonicalizeJSON(value)));
}

/** sha256 over a UTF-8 string. The contract uses sha256() for the ruleUri only. */
export function sha256Utf8(text: string): string {
  return sha256(toUtf8Bytes(text));
}

// ─── The proof hashes (the named wrappers — the only correct way to hash a field) ───

export function computeRuleUriHash(ruleUri: string): string {
  return sha256Utf8(ruleUri); // SHA256 — assert this per the pinned seq-42 vector
}

export function computeInputsHash(inputs: unknown): string {
  return keccak256Canonical(inputs);
}

export function computeOutputsHash(output: unknown): string {
  return keccak256Canonical(output);
}

export interface BindingParts {
  ruleUri: string;
  inputsHash: string;
  outputsHash: string;
}

/** bindingHash = keccak256({ruleUri, inputsHash, outputsHash}); seals all four RIOM parts (R+M ride in ruleUri). */
export function computeBindingHash(parts: BindingParts): string {
  return keccak256Canonical({
    ruleUri: parts.ruleUri,
    inputsHash: parts.inputsHash,
    outputsHash: parts.outputsHash,
  });
}

/** contentHash = keccak256(ruleDef minus its self-referential fields). */
export function computeContentHash(ruleDef: Record<string, unknown>): string {
  const copy: Record<string, unknown> = { ...ruleDef };
  delete copy.ruleUri;
  delete copy.ruleUriHash;
  delete copy.contentHash;
  return keccak256Canonical(copy);
}

// ─── Provenance chain (the Tarski material commitment carried by the token) ───

export interface ProvenanceEntry {
  bindingHash: string;
  domain: string;
  ruleId: string;
  proofUri: string;
  proofMode: string;
  timestamp: string;
}

export interface ProvenanceState {
  n: number;
  root: string | null;
}

/**
 * timestamp is a REQUIRED input (not generated here): the producer passes the
 * proof's createdAt so a keyless verifier can rebuild the identical entry.
 */
export function buildProvenanceEntry(params: ProvenanceEntry): ProvenanceEntry {
  return {
    bindingHash: params.bindingHash,
    domain: params.domain,
    ruleId: params.ruleId,
    proofUri: params.proofUri,
    proofMode: params.proofMode,
    timestamp: params.timestamp,
  };
}

export function entryHash(entry: ProvenanceEntry): string {
  return keccak256Canonical(entry);
}

/** newRoot = prevRoot ? keccak256(prevRoot ‖ entryHash) : entryHash. */
export function nextRoot(prevRoot: string | null, entry: ProvenanceEntry): string {
  const eHash = entryHash(entry);
  return prevRoot ? keccak256(concat([prevRoot, eHash])) : eHash;
}
