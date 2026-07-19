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
| `scripts/` | testnet operations: probes, topic creation, smokes, operator attestation |
| `docs/verify-log.md` | dated V-series verification findings |
| `docs/evidence.md` | HashScan links for every on-chain action |

## Run

```bash
npm install && cp .env.example .env   # TESTNET key only — a mainnet URL hard-fails
npm test                              # offline: pinned + golden + crosscheck vectors
npm run smoke:lane-a                  # one paid stamp, end to end
```

Built for the Hedera x402 Bounty (July 2026) on the Ontologic v0.8.3 taxonomy — 27 published rules, live topics `0.0.8641938` / `0.0.8641941` / `0.0.8641943`, which this build reads and never writes.
