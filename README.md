# Witness Required

**Pay-per-proof on Hedera rails, through the x402 standard.**

HTTP 402 is *Payment Required*. This service adds the missing sibling: an agent (or human) pays through x402 to have a reasoning claim stamped as a morpheme — h(R‖I‖O‖M) — onto a fee-bearing Hedera Consensus Service topic. On the native lane, the payment and the testimony are the *same transaction*. The receipt is the product.

Steward: Ontologic Reclamation Group (ORG). Testnet only. See [LIMITATIONS.md](LIMITATIONS.md) for exactly what is and is not attested.

## Two lanes, one record

- **Lane A — native (discounted).** A Hedera account signs one `TopicMessageSubmitTransaction` carrying the morpheme; the HIP-991 fixed HBAR fee is charged *as* the message is recorded. Payment and stamp are one atomic consensus event.
- **Lane B — premium (genesis + witness).** An off-chain agent with no Hedera account pays $0.01 USDC through x402 into the vending machine. The same call funds the agent's key alias into existence, delivers 1 KEY, and includes gas for the newborn account. The newborn signs its own stamp to the KEY-fee topic; the consumed KEY is burned. Every premium customer exits holding their own Hedera key.

Reads are free and public — mirror-node REST is the canonical read path; the Proof Wall and verifier are conveniences.

## Layout

| Path | What |
|------|------|
| `packages/core/` | `@witness/core` — canonical hash seam, claim builders, mirror client, keyless verifier |
| `packages/mcp/` | `witness-mcp` — the goose plugin (MCP server, stdio) |
| `packages/contracts/` | `WitnessVendingMachine.sol` + hardhat |
| `scripts/` | testnet operations: probes, topic creation, smokes, ceremony scripts, mandated attestation |
| `rules/` | the witness-layer RuleDefs (steward-ratified content; published at the ceremony) |
| `docs/verify-log.md` | dated V-series verification findings |
| `docs/evidence.md` | HashScan links for every on-chain action |

## Judgment is mandated (Phase 2)

Testimony and judgment are separate layers. Anyone can pay a lane's published fee and write (that open door is the point — W-5); ORG's *verdicts* live on a dedicated **Verdict Topic** (`0.0.9794234`) whose submit key is the operator's, under a revocable **mandate** granted by a distinct ORG root key on the immutable **Witness Rule Registry** (`0.0.9794232`). Both authority topics were born without admin keys — permanent by construction, mirror-confirmed at the 2026-07-27 ceremony — and a keyless reader confirms the whole chain (grant, window, scope, revocation) from public mirror REST alone. The live record already demonstrates both directions: mandated verdicts that pass the full chain, and one deliberate post-revocation verdict the verifier condemns as `mandate.out-of-window`. See `PHASE_2.md` and [LIMITATIONS.md](LIMITATIONS.md).

## Run

```bash
npm install && cp .env.example .env   # TESTNET key only — a mainnet URL hard-fails
npm test                              # offline: pinned + golden + crosscheck vectors
npm run smoke:lane-a                  # ORG-side floor test (needs the operator key)
```

## Testing from a fresh clone (Lane A — anyone can)

The native lane is W-5's open door, and it is open to you. `.env.example`
ships with every public coordinate pre-filled; you supply exactly one thing —
your own testnet account:

1. Create a Hedera **testnet** account (free, funded by the faucet): portal.hedera.com
2. `git clone … && npm install && cp .env.example .env`
3. Fill `PAYER_ID` and `PAYER_DER_KEY` in `.env` with that account. Nothing else.
4. `npm run stamp:lane-a` (or `npm run stamp:lane-a paint` for the paint-domain trace)

That builds a WHITE trace claim against the live taxonomy (the closed claim
space — anything else refuses to construct), submits one
`TopicMessageSubmitTransaction`, and HIP-991 charges the published 0.01 HBAR
fee atomically with the message. The script then re-verifies your stamp
keyless off the public mirror, and your tile appears at
[ontologic.dev/wall](https://ontologic.dev/wall) — rendered deterministically
from your bindingHash (a duplicate of an existing claim collapses into that
tile's ×N badge instead; the two domains give visually distinct tiles).

Prefer an agent driving it? Wire `packages/mcp` into your own goose
(see [packages/mcp/README.md](packages/mcp/README.md)) and ask it to assert
a WHITE trace and stamp the native lane — for Lane A it only needs
`requirements → assert_claim → stamp`.

If you'd rather test the *other* door: pay the fee and write whatever bytes
you like. You'll have bought a consensus timestamp and nothing else — the
verifier judges it nonconforming at read time, no tile renders (W-10), and
the operator may lazily attest the rejection under its on-chain mandate.

Built for the Hedera x402 Bounty (July 2026) on the Ontologic v0.8.3 taxonomy — 27 published rules, live topics `0.0.8641938` / `0.0.8641941` / `0.0.8641943`, which this build reads and never writes.
