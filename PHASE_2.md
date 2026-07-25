# PHASE 2 — The Authority Layer

**Repo:** `opento-suggestions/ontologic-x402-bounty`
**Amends:** spec v0.2 · Addendum A (July 20) · CURRENT_ARCHITECTURE.md (July 24)
**Deploys:** Coprocessor I-9 (mandate lineage) — the first field surface
**Status:** execution spec, session of July 24, 2026

> Authority that cannot be revoked was never granted — it was surrendered.

---

## 0. Read this first

Phase 1 built the rails. Phase 2 builds the **authority layer that sits above them**: who may render a verdict, under what grant, for how long, and how a keyless reader confirms it — using nothing but public mirror REST data.

Two empirical findings drove every decision here. Both are settled; neither is negotiable:

- **V-10 (July 24).** Mirror REST exposes `payer_account_id` on a topic message, but **no signer set, no historical account key state**, and `transaction_bytes` availability varies by mirror implementation. Transport-level attribution therefore cannot carry authority: a verdict judged two weeks from now would be checked against whatever key the account holds *at query time*.
- **V-11 (July 24).** An HCS topic's admin key can be **rotated but never cleared**. HIP-540's key-removal behavior applies to tokens, not topics. **Immutability must be chosen at creation.**

Together these produce the architecture: **identity is enforced at write time by the network** (immutable submit-keyed topics), **authority is judged at read time against a mandate window** (revocable, content-resident). No signature library, no `/accounts` dependency, no temporal defect.

### The one thing that cannot be undone

Topics created in this phase are created **without an admin key**. That is the whole point — a submit key that can never be rotated is what makes topic membership a trustworthy attribution. It also means:

- A wrong submit key at creation is permanent. The topic must be abandoned and every anchor re-published.
- A lost submit key is permanent. No further writes, ever.
- This is **accepted and declared** for the MVP bounty submission (see §7).

Treat §2 as a one-shot ceremony. Dry-run it. Read the guards. Do not batch it with anything else.

---

## 1. What changes, in one paragraph

ORG gains a **root account** whose key is distinct from the operator's. Two new topics are created, both immutable at birth: a **Witness Rule Registry** (submit key = root) holding the witness-layer RuleDefs, mandate-morphemes, and revocations; and a **Verdict Topic** (submit key = operator) holding ORG's rejection attestations. Rejection attestations move off the paid lanes onto the Verdict Topic, become **full morphemes** with their own `bindingHash` and a registry-resolvable `R`, and carry a `mandateHash` in M. Their free-text `reasons` field becomes a **closed enum of codes**. The paid lanes are untouched: payer testimony still stamps atomically with its HIP-991 fee, and Lane A's "payment and testimony are the same transaction" remains exactly true.

**W-11's principal-distinct-from-grantee stops being a check and becomes a structure.** The operator physically cannot write a mandate — it does not hold the registry's submit key. A self-signed mandate is not detected; it is unconstructible.

---

## 2. New invariants

Add to spec §4 and to the CURRENT_ARCHITECTURE.md §2 enforcement map.

- **W-11 · Mandated verdicts.** No ORG-rendered verdict without a resolvable, in-window, in-scope mandate whose principal is distinct from its grantee. Key possession alone confers no verdict authority. *Enforced structurally by disjoint submit keys on the registry and verdict topics.*
- **W-12 · Anchor sufficiency.** Every input to a verdict is either (a) a topic message, or (b) topic/token configuration that is **immutable by construction and verifiably so** from public mirror REST. No verdict depends on live account key state, transaction records, or any endpoint whose answer can change between two honest readers.

**W-3 carve-out (explicit).** Lane equality binds the *testimony* layer: Lane A and Lane B are epistemic equals and lane is never a trust input for a proof. Topic identity **is** a trust input for the *authority* layer — a verdict is only ORG's if it is on the Verdict Topic. These are different layers, and LIMITATIONS.md says so in one sentence.

**W-8 amended blast-radius clause.** Replace the current wording with: *a compromised operator key can slander attempts only within the un-revoked mandate window, and every such slander is auditable against the mandate record; it can never forge a witness. Revocation is one registry message away, and everything signed after it is machine-detectably unauthorized.*

**W-10, restated honestly.** The type-level defense — "there is no field that could carry the attempt's payload" — becomes true again only once `reasons` is a closed code set. Until then it is aspirational. See §4.1.

---

## 3. Ceremony — the irreversible writes

Order here is causal, not scheduling: each step's output is the next step's required input.

### 3.1 ORG root account

- New testnet account. Key **must** differ from `OPERATOR_ID`'s key.
- Persist as `ROOT_ID` / `ROOT_KEY` via the existing `updateEnv` helper.
- Extend `packages/mcp/src/env.ts`'s boot check: refuse to run when `PAYER_ID == ROOT_ID`, alongside the existing `PAYER_ID == OPERATOR_ID` guard. W-2's carve-out now covers two ORG keys, and the plugin must hold neither.
- Append to `docs/evidence.md`.

### 3.2 Witness Rule Registry topic

- `setSubmitKey(ROOT_KEY)` · **no `setAdminKey`** · no custom fee · memo `WITNESS_RULES`.
- Holds three message classes, discriminated by `schema`: `ruleDef`, `mandateMorpheme`, `mandateRevocation`.
- **Divergence to confirm before creating:** the v0.8.3 colour sphere splits this across two topics (`RULE_DEFS 0.0.8641938` + `RULE_REGISTRY 0.0.8641941`). This build uses **one** topic with schema-discriminated entries, per steward decision. `resolveRuleDef` and `resolveLatestRule` both scan it, filtered by `schema`.
- Persist as `WITNESS_RULES_TOPIC`.

### 3.3 Verdict topic

- `setSubmitKey(OPERATOR_KEY)` · **no `setAdminKey`** · no custom fee · memo `WITNESS_VERDICTS`.
- Persist as `WITNESS_VERDICT_TOPIC`.

### 3.4 Creation guards — required, not optional

`scripts/create-authority-topics.ts` must:

1. Refuse to run if `WITNESS_RULES_TOPIC` or `WITNESS_VERDICT_TOPIC` is already populated in `.env` (single-shot, mirroring the contract's `AlreadyCreated` guard).
2. Assert `ROOT_KEY != OPERATOR_KEY` before either creation.
3. Never call `setAdminKey` on either topic — and assert the absence in the built transaction, not just in the source.
4. Immediately after creation, read back `/topics/{id}` from mirror and **assert `admin_key` is null and `submit_key` matches the intended key.** Fail loudly on mismatch; there is no second chance.
5. Print the two topic IDs under a banner reading *these are now trust anchors — publish them*.
6. `assertTestnet()` before the client opens, as everywhere else.

### 3.5 Genesis writes to the registry

1. **RuleDef: conformance rule** (`R` for rejection attestations). See §6.1 — the content is authoring work and must exist before anything downstream builds.
2. **RuleDef: delegation rule** (`R` for mandate-morphemes). Its content is steward-authored (see §6.1a), but it MUST carry these constraints, recovered from Addendum A:
   - The grantee never signs payer testimony (restates W-2).
   - The grantee never renders success verdicts — **the stamp is the verdict**. This clause is load-bearing: success needing no verdict is what keeps D-6's lazy-attestation economics closed. A delegation rule without it silently reopens the drain vector.
   - The mandate chain is **depth-1**: ORG root (self-grounding, no `mandateHash`) → operator. Recursive delegation is reserved to Coprocessor I-9 and the D-7 roadmap. A mandate whose principal is not the root is out of scope for this build's verifier.
3. **The first mandate-morpheme**, root-submitted, granting `verdict:rejection-attestation` to `OPERATOR_ID`, scoped to `WITNESS_VERDICT_TOPIC`, with explicit `notBefore` / `notAfter`.

The first message on the registry topic is the grant every later verdict resolves against. Whatever `R` says on day one is what the chain grounds in.

---

## 4. `packages/core` — the seam

**Do not touch `src/morpheme.ts`'s recipe.** `canonicalizeJSON`, `keccak256Canonical`, `sha256Utf8`, and the four named wrappers stay byte-identical. Every existing proof on `0.0.8641943` depends on them, and `canonicalize.test.ts` + `golden.test.ts` must pass **unmodified** at the end of this phase. That passing is the empirical proof that Phase 2 is additive.

There is **no new hash primitive** in this phase. `mandateHash` is the mandate-morpheme's own `bindingHash`, computed by the existing `computeBindingHash`. One recipe, everywhere.

### 4.1 `src/reasons.ts` — new, and the highest-value file in this phase

**Verify before writing:** grep `packages/core/src/verify.ts` for how `reasons` entries are constructed. The live Proof Wall renders a rejection tile reading `unknown schema: undefined`, which is the signature of string interpolation against a subject-message field. If reasons are built as `` `unknown schema: ${msg.schema}` ``, then **`reasons` is a payload carrier and W-10 is currently violated** — an attacker writes `{"schema": "<anything they want on an ORG surface>"}` and it renders. Record the finding in `docs/verify-log.md` either way. If confirmed, also read the live Lane A attestation's `reasons` array and note in LIMITATIONS.md that the mechanism shipped before it was closed.

The fix is the `claims.ts` pattern applied to reasons:

- A frozen constant map `REASONS: Record<ReasonCode, string>` — code → human-readable template. Codes are the wire format; templates are display-only and live in the renderer's lookup, never in the message.
- `ReasonCode` is a union type. Anything outside it fails at construction because there is nothing to construct with.
- No interpolation of subject-message content into any reason, ever. If a reason needs to point at something, it points with a **hash or an offset**, never a value.
- Suggested initial space (extend as `judgeMessage`'s real branches dictate): `parse.invalid-json` · `schema.unknown` · `schema.missing` · `structure.missing-field` · `hash.malformed` · `peirce.binding-mismatch` · `split.rule-uri-hash-mismatch` · `floridi.rule-unresolvable` · `floridi.ruledef-self-hash-failed` · `mandate.unresolvable` · `mandate.out-of-window` · `mandate.scope-mismatch` · `mandate.wrong-topic`.

Sonic's framing: this is the same shape as the closed colorimetry claim space. A bounded taxonomy is what makes both W-9 and W-10 structural instead of procedural.

### 4.2 `src/schema.ts`

- `RejectionAttestation` becomes a morpheme. It gains `ruleUri`, `inputsHash`, `outputsHash`, `bindingHash`, and `mandateHash`; `reasons` becomes `ReasonCode[]`. Its `I` is the subject's derivations (`subjectTopicId` / `subjectConsensusTimestamp` / `subjectSequenceNumber` / `subjectMessageHash`) — derivations only, unchanged. Its `O` is the verdict plus the reason codes. Its `M` carries trust-class, statusProfile, and `mandateHash`.
- New `MandateMorpheme`. `I` carries `principal` (root account), `grantee` (operator account), `scope`, `notBefore`, optional `notAfter`, and a **`nonce`** — required, because mandate identity is content-derived, so a revoked grant's content-identity is permanently dead and re-granting needs a fresh one. `M` carries no `mandateHash`; the root grounds the chain.
- New `MandateRevocation`. References the target `mandateHash`. Root-submitted to the registry topic.
- `statusProfile` handling is unchanged — still `0.1-mvp`, still beside the proof, still never sealed into any hash. The mandate's trust-class is therefore **advisory, not attested**; say so in LIMITATIONS.md.

### 4.3 `src/resolve.ts`

- **Registry dispatch.** `resolveRuleDef` picks its registry by rule namespace: colour-taxonomy rules from `0.0.8641941`, witness-layer rules from `WITNESS_RULES_TOPIC`. Topic IDs are **hardcoded constants**, and a comment must say plainly that these constants are the trust anchor.
- **Cross-registry impersonation defense.** Apply the `claims.ts` pattern: cross-check the resolved rule's declared domain against the expected domain for its namespace, so a rule published to one registry cannot masquerade as a rule from the other.
- New `resolveMandate(mandateHash)` → `{ mandate, revocation | null }`. Scans the registry topic for the mandate-morpheme with that `bindingHash`, then for any revocation referencing it. Hedera's total ordering settles any grant/revoke/attest race by consensus timestamp; no ambiguity survives.
- New `verifyAnchors()` — one-time confirmation that both authority topics report `admin_key: null` and the expected `submit_key`. This is W-12's (b) clause made executable.

### 4.4 `src/verify.ts`

**Signature change, and it breaks three callers.** `judgeMessage` currently takes a parsed message. It now needs topic context, because topic membership *is* the attribution. Change it to accept `{ topicId, consensusTimestamp, sequenceNumber, message }`. The three callers are the MCP `verify` tool, `scripts/reject-attest.ts`, and the wall's JS port (different repo — see §8).

Check order additions:

- **Schema dispatch** gains `mandateMorpheme` and `mandateRevocation` branches.
- **Rejection attestations now get the full Peirce check** — `bindingHash` must recompute from `{ruleUri, inputsHash, outputsHash}` — plus the split check (`ruleUriHash = sha256`) and the Floridi check (`ruleUri` dereferences to a self-verifying RuleDef in the witness registry). One recipe, two schemas.
- **W-11 check**, in this order: is the message on `WITNESS_VERDICT_TOPIC` (`mandate.wrong-topic` if not) → does `mandateHash` resolve (`mandate.unresolvable`) → does the verdict's consensus timestamp fall within `[notBefore, revocation ∨ notAfter)` (`mandate.out-of-window`) → does the mandate's scope cover this verdict class and topic (`mandate.scope-mismatch`).
- **Verdict class for out-of-mandate:** see §6.2 — this is still open. Implement as `invalid` carrying the specific code, behind a single named predicate so switching it later is a one-line change.
- **Temporal scope.** W-11 applies only to attestations whose consensus timestamp is **at or after the first mandate's**. The pre-mandate attestation already on Lane A stands as history and must not be retroactively condemned.

### 4.5 `test/`

New: `reasons.test.ts` (the closed space refuses unknown codes; no reason template interpolates subject content), `mandate.test.ts` (full lifecycle — grant → in-window attestation valid → revoke → post-revocation attestation judged out-of-mandate → wrong-topic attestation rejected), `attestation.test.ts` (the attestation's `bindingHash` recomputes; W-10 property test).

Unchanged and **must still pass without modification**: `canonicalize.test.ts`, `golden.test.ts`. If either moves, the recipe was touched and the phase is wrong.

---

## 5. `scripts/`

Every script appends to `docs/evidence.md` through the existing `appendEvidence` helper — the link collection stays a side effect of running, not a chore.

- `create-root.ts` — §3.1.
- `create-authority-topics.ts` — §3.2–3.4, with all five guards.
- `publish-witness-rules.ts` — the two RuleDefs, root-submitted.
- `grant-mandate.ts` — the mandate-morpheme, root-submitted, with `nonce`, `notBefore`, `notAfter` as arguments.
- `revoke-mandate.ts` — root-submitted revocation referencing a `mandateHash`.
- `reject-attest.ts` — **rewritten.** Still lazy, still manual, still ORG-initiated, still judges at read time exactly as any reader would, still refuses to attest about non-lane subjects. Changes: builds a full morpheme against the conformance RuleDef; carries `mandateHash`; emits reason **codes**; writes to `WITNESS_VERDICT_TOPIC` instead of the subject's lane. It should refuse to run if its own mandate does not currently resolve in-window — ORG should not be able to render an out-of-mandate verdict by accident.

**Note on economics.** The Verdict Topic carries no fee, so verdicts are now near-free for ORG to write. D-6 is not reopened — laziness was always the defense, not the fee — but the discipline is now purely procedural rather than economic. That belongs in LIMITATIONS.md.

---

## 6. Open before the work commences

Four of these are cheap. **§6.1 is not, and nothing downstream can be built without it.**

### 6.1 The conformance rule's content — BLOCKING

The rejection attestation's `R` must resolve to a real RuleDef with real content. Right now, "what makes a lane message conformant" exists only implicitly, as `judgeMessage`'s check order. That check order has to become an explicit, published, self-hashing RuleDef: rule id, version, domain, the conformance predicates in order, and the reason code each failure emits. **This is authoring work, not coding work.** Until it exists, the attestation has nothing to point at, and the first message on an immutable topic is not a good place to improvise.

### 6.1a The delegation rule's content — BLOCKING, same class as §6.1

The delegation rule has the same problem as the conformance rule: it must exist as a real, self-hashing RuleDef before the ceremony, and its content is steward-authored. §3.5 lists its required constraints; the rest — rule id, version, domain, the grant-validity predicates — does not yet exist. **Two rules block the ceremony, not one.**

### 6.2 Out-of-mandate verdict class — undecided

Fold into `invalid` with a distinguishing reason code, or promote to a fourth verdict class with its own rendering. Recommendation: `invalid` plus code, with the wall's ledger line splitting the count — *"N nonconforming, of which K unauthorized"* — so an unauthorized ORG-signed verdict gets louder treatment than probe garbage without a new tile type. Cheap to change if it's implemented behind one predicate.

> **Resolved 2026-07-25 (steward):** the recommendation stands — `invalid` + `mandate.*` code, behind the single named predicate.

### 6.3 Mandate scope grammar — undecided

`scope` needs a concrete shape before the in-scope check is implementable. Minimum viable: `{ verdictClass: "rejection-attestation", topicId: <verdict topic> }`. Anything richer is a decision.

> **Resolved 2026-07-25 (steward):** minimum viable adopted — `{ verdictClass, topicId }`, nothing richer for the MVP.

### 6.4 First mandate's window — governance, not architecture

`notBefore` / `notAfter` values. Short windows mean compromise self-expires but the root key comes out on a schedule; a long or open window means the root key stays cold but response depends on liveness.

> **Resolved 2026-07-25:** ~30 days (`notBefore` = ceremony, `notAfter` ≈ +30d), passed as arguments to `grant-mandate.ts` — nothing hardcodes it. A seconds-scale window was considered and rejected: mirror lag (3–7s, V-7) plus the attest script's own mandate-resolution read makes it a race against consensus, and the bounded-compromise property lives in *revocation* (one root message), not expiry — a verdict is judged against its own consensus timestamp, so expiry never rewrites history, it only stops new verdicts.

### 6.5 One registry topic vs. two — confirm

The steward decision was one topic holding R + mandates + revocations. The colour sphere uses two. Confirm the divergence is intentional before creation, because it cannot be split afterward.

> **Confirmed 2026-07-25 (steward):** intentional. ONE new registry topic, for the witness/authority layer only — the paid reasoning proofs that callers buy keep resolving against the original colour-sphere topics (read-only, untouched); verdicts resolve against the new Witness Rule Registry. The two-message pattern (ruleDef + ruleRegistryEntry) is retained on the single topic, schema-discriminated, so `resolveLatestRule` works unchanged against it.

### 6.6 Re-issue the existing attestation? — micro

The live Lane A attestation stands as pre-mandate history under §4.4's temporal clause. Whether to also render a conforming equivalent on the Verdict Topic, so the wall has a mandated example, is a demo call.

> **Resolved 2026-07-25 (steward):** yes — re-issue a conforming, mandated equivalent on the Verdict Topic post-ceremony, so the wall's lineage tree has a real mandated example.

---

## 7. Documentation

- **LIMITATIONS.md.** The line *"One ORG-held operational key exists"* is now false — replace with the two-key structure and their disjoint powers. Add: the authority topics' submit keys are **permanent and unrecoverable**, accepted and scoped as such for the MVP bounty submission, with abandon-and-re-anchor as the only recovery path; the trust anchors (two topic IDs) are **off-chain constants**, so changing them is a verifier-release event, not an on-chain one; the mandate window and revocation path; the mandate's trust-class is advisory because statusProfile is unsealed by design; and the verdict-economics note from §5.
- **Addendum A.** Three corrections. The header's *"additive; supersedes nothing"* is false — it supersedes spec §2's *"this is the one ORG key in the architecture"*. §A.2's *"the grant stamps through Lane A… the steward eats its own cooking"* must be rewritten: the grant lives on the immutable registry topic and is not fee-paid. §A.4's revocation target moves from `RULE_REGISTRY 0.0.8641941` (read-only, never written by this build) to the Witness Rule Registry.
- **Spec v0.2 §2.** Amend the one-key sentence. Also amend *"ORG treasury — fee collector for both lanes"*, which the build already superseded when Lane B's collector became the contract (that is how D-3's burn works) — an undeclared divergence worth closing.
- **CURRENT_ARCHITECTURE.md.** New rows in the §1 entities table and the §2 enforcement map (W-11, W-12); §9 gains the registry-topic-count divergence and the moved verdict path.
- **README.md.** Layout table gains the authority topics.
- **docs/verify-log.md.** V-10 and V-11 entries, plus the §4.1 grep finding.

---

## 8. Cross-repo — NOT in this repo

The site lives in `ontologic-dev` (`static/witness`, `static/wall`, `netlify/functions/x402.mts`) and is out of scope for the changes above. It needs its own pass:

- The JS port learns `mandateMorpheme`, `mandateRevocation`, and the new attestation shape. **Deployment coupling:** until it does, a mandate stamped to the registry topic renders as `invalid` — the wall's first word on ORG's grant of authority would be *nonconforming*. The port lands before the ceremony, or the wall does not read the registry topic yet.
- `js/data.js` reads three topics, not two.
- Reason **codes** render through a display lookup. The `undefined` currently visible on the rejection tile disappears with them.
- Layout: testimony stays a chronological wall where lane is provenance-only (W-3 — parallel lane columns invite reading lane as tier, which is exactly what the invariant exists to prevent). Judgment renders as a **lineage tree**: mandate-morpheme at the root, rejection attestations as children, edges being real `mandateHash` references. Depth-1 today; I-9's recursive delegation is what deepens it.
- Rejection tiles key off their **own** `bindingHash` now, not the subject's message hash.
- `runSelfTest()` gains the new vectors and calls `verifyAnchors()` before any tile renders.
- Page copy: *"Reproduce everything you see from the public topics alone"* and *"Every paid stamp… becomes a tile"* both go stale — the registry topic is not fee-bearing and reproduction now needs topic configuration. These are public claims and should track the architecture.

---

## 8b. Considered and rejected

Pre-empting the alternatives a capable instance will re-derive. Do not propose these; they were weighed and dropped.

- **In-payload signatures** (each verdict carries a signature over its own content, verified client-side) were the other attribution path. Rejected twice over: they drag a vendored signature-verification library into a wall whose deploy story is "vendored, not CDN" — a real supply-chain and maintenance surface for a static site — and, decisively, **topic membership already yields the same property from the network for free**: an immutable submit key means the network itself refuses unauthorized writes at consensus time, which is strictly stronger than detecting them at read time. V-10's finding (no signer set, no historical key state on mirror) also means a signature scheme would need its own key-distribution answer, which is just the mandate problem again, one layer down.
- **Verdicts on the paid lanes** was the status quo and had to go. W-5's open door means anyone can pay the published fee and write anything to a lane — including a message shaped exactly like an ORG rejection attestation, citing a *genuine* `mandateHash` copied from the registry. The verifier could not tell it from the real thing, because the lane's fee is the only write gate and fees are payable by anyone. That is forged judgment on an ORG-read surface, and it is precisely the hole W-11's structural form (verdicts only from the operator-submit-keyed Verdict Topic) exists to close. The open door stays open — it is W-5's integrity condition for the *testimony* layer — but judgment cannot live behind it.

## 9. Coverage note

This spec was written from spec v0.2, Addendum A, CURRENT_ARCHITECTURE.md, README.md, and LIMITATIONS.md. **Source files were not read** — GitHub blocks automated tree navigation and the repo is not indexed for code search. Every claim about code shape derives from CURRENT_ARCHITECTURE.md's descriptions and line references, not from the files themselves.

Verify before acting on: the `reasons` construction in `verify.ts` (§4.1 — this is the one that changes what LIMITATIONS.md must say), whether `judgeMessage` already carries topic context, the `.env` naming convention, and the actual field names on `RejectionAttestation`.

---

## 10. Definition of done

- Both authority topics live, `admin_key: null` confirmed by mirror read-back, submit keys disjoint.
- Two RuleDefs and one mandate-morpheme on the registry topic; the mandate resolves and is in-window.
- One rejection attestation rendered to the Verdict Topic under that mandate, carrying `mandateHash` and reason codes, with a `bindingHash` that recomputes.
- One revocation demonstrated, and one post-revocation attestation judged out-of-mandate by the verifier.
- `canonicalize.test.ts` and `golden.test.ts` pass **unmodified** — the additivity proof.
- Full suite green; new lifecycle tests included.
- `docs/evidence.md` carries HashScan links for every write above.
- LIMITATIONS.md, Addendum A, and CURRENT_ARCHITECTURE.md reflect what was actually built.

---

*Germs die in sunshine.*