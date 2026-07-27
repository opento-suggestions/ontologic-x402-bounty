# witness-mcp — the Witness Required goose plugin

MCP server (stdio) that lets a goose agent drive the full pay-per-proof flow:
assert a WHITE trace claim over the live Ontologic taxonomy, meet *Payment
Required*, settle the x402 leg, and stamp its own testimony onto a fee-bearing
topic. Successor to the Apex goose/MCP Hologlass artifact — same anatomy
(stdio transport, three-channel returns, Morpheme-wrapped tools).

## Credential model (W-2, structural)

This process is the **payer-agent's**. It holds:
- `PAYER_ID` / `PAYER_DER_KEY` — the agent's funding account (boot refuses to
  run if this equals `OPERATOR_ID`);
- newborn testimony keys, generated client-side by `witness_genesis`, stored
  in the local keystore (`~/.witness-mcp/keystore.json` or
  `WITNESS_STATE_DIR`). No tool channel ever carries a private key.

No ORG key exists in this process. ORG's only delivery-path signature
(`vend`) lives in `scripts/redeem.ts`, run ORG-side.

## Tools

| Tool | What it does |
|------|--------------|
| `witness_requirements` | The *Payment Required* moment: both lanes' published prices (W-7) as Hedera exact-scheme PaymentRequirements |
| `witness_assert_claim` | Build a WHITE trace (light \| paint) — the closed claim space (W-9); anything else refuses to construct |
| `witness_genesis` | Client-side testimony keypair; returns only the EVM alias |
| `witness_pay` | Settle the x402 leg (facilitator if `FACILITATOR_URL` set, else self-sponsored). The settled transfer is the receipt |
| `witness_redeem_status` | Keyless mirror check: has ORG's vend delivered genesis + 1 wKEY? |
| `witness_stamp` | Lane A: payer signs; Lane B: the newborn signs its own stamp. HIP-991 charges the fee atomically; max-custom-fee protection set |
| `witness_verify` | Keyless re-check off public mirror REST → `valid \| rejection \| invalid` |

## Wiring into goose

Add to goose's config (`~/.config/goose/config.yaml` on Linux/macOS,
`%APPDATA%\goose\config.yaml` on Windows):

```yaml
extensions:
  witness:
    type: stdio
    enabled: true
    cmd: npx
    args:
      - tsx
      - C:/The_Fountain/ontologic-x402-bounty/witness-required/packages/mcp/src/index.ts
    timeout: 300
```

Use FORWARD slashes in the path, even on Windows — goose's config layers
strip backslashes (observed live: `C:\The_Fountain\…` arrived at Node as
`C:The_Fountain…`, a drive-relative path resolved against goose's own cwd).
Node accepts forward slashes on Windows natively. On the desktop app the
config lives at `%APPDATA%\Block\goose\config\config.yaml`.

The server reads the repo root `.env`: it walks up from the process cwd
first, then falls back to walking up from its own module path — so goose can
spawn it from any working directory. `assertTestnet()` runs before the
transport opens — a mainnet URL refuses to boot.

Windows note: if goose fails to spawn `npx`, use `cmd: npx.cmd` (or an
absolute path to it) in the extension config.

## Smoke

`npx tsx scripts/mcp-smoke.ts` (repo root) drives every tool handler through
both lanes end-to-end — the demo storyline as one script.
