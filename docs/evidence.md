# Evidence — HashScan links

Running collection of on-chain evidence (bounty checklist §10: real testnet transactions, links collected as we go). Every smoke script appends here. This file doubles as the demo-video shot list for beats 4–5.

| Date | What | Tx / entity | HashScan |
|------|------|-------------|----------|
| 2026-07-19 | create topic WITNESS_HBAR (HIP-991 fixed fee) | `0.0.9645621` | https://hashscan.io/testnet/topic/0.0.9645621 |
| 2026-07-19 | create topic WITNESS_KEY (HIP-991 fixed fee) | `0.0.9645622` | https://hashscan.io/testnet/topic/0.0.9645622 |
| 2026-07-19 | Lane A stamp: WHITE trace (light), HIP-991 fee paid atomically, mirror latency ~3.0s | `1784493185.787686246` | https://hashscan.io/testnet/transaction/0.0.8641261-1784493180-257716109 |
| 2026-07-19 | Lane A topic after first stamp | `0.0.9645621` | https://hashscan.io/testnet/topic/0.0.9645621 |
| 2026-07-19 | V-9 Attempt B: auto-create newborn 0.0.9645672 + self-signed stamp (custom fee assessed: false) | `0.0.9645672` | https://hashscan.io/testnet/account/0.0.9645672 |
| 2026-07-19 | V-9 newborn's paid stamp on Lane A | `0.0.9645672@1784493344.397091341` | https://hashscan.io/testnet/transaction/0.0.9645672-1784493344-397091341 |
| 2026-07-19 | V-9 Attempt B: auto-create newborn 0.0.9645732 + self-signed stamp (custom fee assessed: false) | `0.0.9645732` | https://hashscan.io/testnet/account/0.0.9645732 |
| 2026-07-19 | V-9 newborn's paid stamp on Lane A | `0.0.9645732@1784493687.629548526` | https://hashscan.io/testnet/transaction/0.0.9645732-1784493687-629548526 |
| 2026-07-19 | WitnessVendingMachine deployed | `0.0.9645863` | https://hashscan.io/testnet/contract/0.0.9645863 |
| 2026-07-19 | witness-KEY created by contract (immutable, supply key = contract) | `0.0.9645864` | https://hashscan.io/testnet/token/0.0.9645864 |
| 2026-07-19 | Lane B re-peg: fee -> 1 wKEY, collector = vending contract / wKEY treasury | `0.0.9645622` | https://hashscan.io/testnet/topic/0.0.9645622 |
| 2026-07-19 | Lane B vend: genesis + 1 wKEY delivered in one contract call (newborn 0.0.9645912) | `0.0.9645912` | https://hashscan.io/testnet/account/0.0.9645912 |
| 2026-07-19 | Lane B stamp: newborn 0.0.9645912 self-signed WHITE trace (paint), 1 wKEY fee to treasury-in-code | `1784494947.096715104` | https://hashscan.io/testnet/transaction/0.0.9645912-1784494942-798350801 |
| 2026-07-19 | Lane B burn: consumed wKEY exits supply (D-3) | `0.0.9645864` | https://hashscan.io/testnet/transaction/0.0.8641261-1784494947-780841474 |
| 2026-07-19 | payer-agent account created (distinct from operator) | `0.0.9646033` | https://hashscan.io/testnet/account/0.0.9646033 |
| 2026-07-19 | redeem: settled x402 receipt 0.0.9646033-1784495988-270588092 → vend(0xfa00a4b3d592139508828675ba73a718013acdc4) | `0xfa00a4b3d592139508828675ba73a718013acdc4` | https://hashscan.io/testnet/transaction/0.0.8641261-1784495994-871461914 |
