# Witness Required

**A pay-per-proof notary for machine reasoning, built on Hedera through the x402 payment standard.**

Steward: Ontologic Reclamation Group (ORG). **Testnet only.** Apache-2.0.

## The problem

AI agents make claims constantly... and once a claim is made, there is no standard way to check *why* the agent concluded what it did. The reasoning evaporates; only the answer remains. If agents are going to transact with each other and with people, their reasoning needs to be **checkable after the fact, by anyone, without trusting the agent or any middleman**.

There's also no standard way for a machine to *pay* for that kind of service. HTTP has had a status code reserved for this since the 1990s — `402 Payment Required` — and the [x402 standard](https://www.x402.org/) finally puts it to work: a server answers a request with a priced challenge, and the client settles it, machine to machine.

**Witness Required connects the two.** An agent (or a human) pays a few cents over x402 and gets one reasoning step permanently stamped onto Hedera's public ledger: the rule it applied, the input, the output. The stamp can be verified forever, by anyone, from public data alone — no account, no keys, no permission needed to check it. The receipt *is* the product.

This is only economical because Hedera's fees are fixed and tiny, so a one-cent notarization isn't eaten by its own transaction cost. Per-use proof becomes viable the same way per-use data did: machine to machine.

## Why colors?

The demo domain is deliberately tiny: claims about **why something counts as WHITE**, in two settings: light (red, green, and blue all at maximum), and paint (no pigment on the page). The point is that these claims are objective and instantly checkable, so you can judge whether the *mechanism* works — payment, stamping, public verification — without having to evaluate whether some complex chain of reasoning is sound. The published color taxonomy (27 rules, live on-chain) is a stand-in for any rulebook: swap in your own rules and the machinery carries over unchanged.

Each stamp is a **morpheme**: a sealed record of one reasoning step: the **R**ule applied, the **I**nput, the **O**utput, and the attributed **M**eaning, hashed together as `h(R‖I‖O‖M)`. Identical reasoning yields an identical hash, so duplicate claims collapse into one record instead of piling up.

## Two ways in

**Lane A — native (about a penny).** You have a Hedera account. You sign one message carrying your claim; a fixed 0.01 HBAR fee (HIP-991) is charged *in the same transaction* that records it. Payment and testimony are one atomic consensus event — there is no separate payment leg to fail, refund, or dispute. The fee rail *is* the checkout, a collapse specific to Hedera's native custom-fee topics.

**Lane B — premium (about fifty cents, the full x402 story).** Your *agent* has no Hedera account and never has to be trusted with one. The agent generates its own keypair off-chain; any funded account (yours, a sponsor's, the human principal behind the agent) fetches the service's live HTTP 402 challenge and settles exactly the terms it publishes (currently the exact scheme in testnet HBAR at the published peg). The vending machine then delivers the agent's on-chain existence: a funded account created from the *agent's* key, plus 1 KEY token — the fee for one stamp. The newborn signs its own testimony and the spent KEY is burned. The payer never holds the agent's key; the agent never touches the payer's. Every premium customer exits self-sovereign. The price is itemized in the open (`packages/ops/src/peg.ts`): the funding delivered, at cost, plus a visible margin. (Settlement today is Hedera-native; the receipt-and-redemption model is chain-agnostic by design — cross-chain USDC reception is the roadmap. See [LIMITATIONS.md](LIMITATIONS.md).)

Reads are always free and public. The [Proof Wall](https://ontologic.dev/wall) and bundled verifier are conveniences but mirror-node REST is the canonical read path.

## Try it in five minutes (Lane A — anyone can)

`.env.example` ships with every public coordinate pre-filled. You supply exactly one thing: your own **testnet** account.

```sh
# 1. Get a free testnet account (faucet-funded): portal.hedera.com
git clone https://github.com/opento-suggestions/ontologic-x402-bounty
cd ontologic-x402-bounty
npm install && cp .env.example .env
# 2. Fill PAYER_ID and PAYER_DER_KEY in .env. Nothing else.
npm run stamp:lane-a          # or: npm run stamp:lane-a paint
```

That builds a WHITE trace claim against the live taxonomy (a closed claim space so anything else refuses to construct), submits it, pays the published fee atomically, then **re-verifies your stamp keyless off the public mirror**. Your tile appears on the [wall](https://ontologic.dev/wall), rendered deterministically from your claim's hash.

## The full x402 story (Lane B, from a customer clone)

The same payer-only `.env` drives the premium lane end to end. Your clone never needs an ORG identity: `witness_requirements` fetches the live challenge from [ontologic.dev/x402/vend](https://www.ontologic.dev/x402/vend) and `witness_pay` consumes *its* terms — payTo, amount — falling back to the shipped `config.witness.json` when offline.

```sh
npm run smoke:mcp     # auto-detects customer posture (OPERATOR_ID left as placeholder)
```

It stamps Lane A, generates a newborn testimony key, settles the x402 payment with the redemption memo, waits for ORG's watcher (`npm run redeem:watch`, operator side) to honor the receipt with genesis + 1 KEY, then the newborn signs its own Lane B stamp and re-verifies it keyless. The settled transfer is your receipt; delivery is a redeemable right against it with no funds stranded (see [LIMITATIONS.md](LIMITATIONS.md)).

Prefer an agent driving it? Wire `packages/mcp` into goose (or any MCP host) ([packages/mcp/README.md](packages/mcp/README.md)) and ask it to assert a WHITE trace and stamp a lane.

**Or test the other door!** Try and pay the fee and write whatever bytes you like to the topic. You'll have bought a consensus timestamp and nothing else — the verifier judges it nonconforming at read time, no tile renders, and the operator may attest the rejection under its on-chain mandate.

## For the judges

The bounty names three criteria. Where each is proven, and one positioning note: the reference architectures pay to *read* (market data, files); this build pays to *prove*.

**A working end-to-end flow.** `npm run smoke:mcp` runs the whole story from a customer clone: 402 challenge → settlement → redemption → account genesis → the newborn's own stamp → keyless re-verification. The flow has also been completed by an external customer with no relationship to this repo: payer `0.0.7974723`, transaction [`0.0.7974723-1785275543-194304289`](https://hashscan.io/testnet/transaction/0.0.7974723-1785275543-194304289) settled against the live challenge.

**Real on-chain payments through x402.** The gateway at [ontologic.dev/x402/vend](https://www.ontologic.dev/x402/vend) answers with a literal HTTP 402, and the client consumes *that challenge's* terms. Every settlement, redemption, and burn is linked in [docs/evidence.md](docs/evidence.md).

**How well the build uses Hedera rails.** Five services in load-bearing roles: HCS topics carry the testimony; HIP-991 custom fees make Lane A's payment and product one atomic transaction; HTS mints and burns the KEY through a contract-held supply key; the Smart Contract Service holds custody and delivery for the vend; and mirror-node REST is the trust anchor — the whole verification story, including the operator's own authority chain, is checkable by a keyless stranger from public reads alone.

## How the pieces fit

```
customer (agent or human)                      ORG (operator)
  │ assert claim (closed claim space)            │
  │ GET /x402/vend ──► literal HTTP 402          │
  │ settle the challenge's exact terms ────────► │ watcher redeems receipt:
  │                                              │ account genesis + 1 KEY
  │ sign OWN testimony to the fee topic ──► HCS  │
  │                                              │ verdicts (separate topic,
  └─ anyone, keyless: verify from mirror REST ◄──┘  revocable on-chain mandate)
```

| Path | What |
|------|------|
| `packages/core/` | The pure seam: canonical hashing, claim builders, keyless verifier. No keys, no clients. |
| `packages/ops/` | The keyed engine: persona-typed clients (operator / root / payer / newborn as disjoint types — a customer function *cannot* be handed operator credentials, at compile time), the price peg, and the lane operations. |
| `packages/mcp/` | The MCP server (stdio): seven `witness_*` tools as thin adapters over ops. |
| `packages/contracts/` | `WitnessVendingMachine.sol` — custody and delivery for Lane B. |
| `scripts/` | Thin CLI entries over ops, plus the guarded one-shot ceremony scripts. |
| `probes/` | Re-runnable falsifiability instruments for empirically-answered design questions. |
| `rules/` | The witness-layer rules. A published source-of-record (ceremony dated 2026-07-27). |

## Live coordinates (testnet)

| Entity | ID |
|--------|-----|
| Lane A topic (native) | [`0.0.9645621`](https://hashscan.io/testnet/topic/0.0.9645621) |
| Lane B topic (KEY-fee) | [`0.0.9645622`](https://hashscan.io/testnet/topic/0.0.9645622) |
| Vending machine contract | [`0.0.9815452`](https://hashscan.io/testnet/contract/0.0.9815452) |
| KEY token (wKEY) | [`0.0.9815453`](https://hashscan.io/testnet/token/0.0.9815453) — immutable; its memo resolves to the vending terms at `hcs://0.0.9815434/1785270170.307828104` |
| Witness Rule Registry | [`0.0.9794232`](https://hashscan.io/testnet/topic/0.0.9794232) — born without an admin key: permanent by construction |
| Verdict Topic | [`0.0.9794234`](https://hashscan.io/testnet/topic/0.0.9794234) |
| ORG operator / treasury | `0.0.8641261` |

Every on-chain action in this build is linked in [docs/evidence.md](docs/evidence.md). The color taxonomy topics (`0.0.8641938/41/43`) are read-only to this build, always.

## Testimony vs. judgment

Anyone who pays a lane's published fee can write — that open door is the point. ORG's *verdicts* are a separate layer: they live on a dedicated Verdict Topic whose submit key operates under a **revocable mandate** granted by a distinct ORG root key on the immutable rule registry. A keyless reader can confirm the entire authority chain — grant, window, scope, revocation — from public mirror data alone. The live record demonstrates both directions: mandated verdicts that pass the full chain, and one deliberate post-revocation verdict the verifier condemns. Details: [PHASE_2.md](PHASE_2.md).

## Development

```sh
npm install && cp .env.example .env    # TESTNET only — a mainnet URL hard-fails
npm test                               # offline: pinned + golden + crosscheck vectors
npm run typecheck
npm run smoke:lane-a                   # ORG-side floor test (needs the operator key)
```

## Going deeper

Read order: [SPEC.md](SPEC.md) (the governing spec — invariants, decisions, verification items) → [CURRENT_ARCHITECTURE.md](CURRENT_ARCHITECTURE.md) (as built, and why it's shaped that way) → [LIMITATIONS.md](LIMITATIONS.md) (exactly what is and is not attested) → [docs/verify-log.md](docs/verify-log.md) (dated empirical findings) → [PHASE_2.md](PHASE_2.md) (the judgment layer).

Built for the Hedera x402 Bounty (July 2026) on the Ontologic v0.8.3 taxonomy.

## License

[Apache-2.0](LICENSE)
