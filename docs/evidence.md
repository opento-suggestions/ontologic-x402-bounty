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
| 2026-07-20 | rejection attestation (operator-summoned) for 0.0.9645621 seq 2: unknown schema: undefined | `1784518459.756961931` | https://hashscan.io/testnet/transaction/0.0.8641261-1784518454-120831562 |
| 2026-07-27 | create ORG root account (ceremony §3.1, W-11 two-key structure) | `0.0.9794226` | https://hashscan.io/testnet/account/0.0.9794226 |
| 2026-07-27 | create Witness Rule Registry (immutable, submit=root — ceremony §3.2) | `0.0.9794232` | https://hashscan.io/testnet/topic/0.0.9794232 |
| 2026-07-27 | create Verdict Topic (immutable, submit=operator — ceremony §3.3) | `0.0.9794234` | https://hashscan.io/testnet/topic/0.0.9794234 |
| 2026-07-27 | publish witness RuleDef witness://org/authority/delegation (ceremony §3.5) | `hcs://0.0.9794232/1785172139.525106079` | https://hashscan.io/testnet/transaction/0.0.9794226-1785172131-382235869 |
| 2026-07-27 | grant mandate verdict:rejection-attestation → 0.0.8641261, window [1785172219,1787764219) (ceremony §3.5.3) | `0xdf27b03d7be00f2a572aab2dea0b37d194cc48d8c7119e88e382dced662e74d7` | https://hashscan.io/testnet/transaction/0.0.9794226-1785172213-287119241 |
| 2026-07-27 | rejection attestation (mandated, v0.2) for 0.0.9645621 seq 2: schema.missing | `1785172454.501234104` | https://hashscan.io/testnet/transaction/0.0.8641261-1785172449-626863504 |
| 2026-07-27 | revoke mandate 0xdf27b03d7be00f2a572aab2dea0b37d194cc48d8c7119e88e382dced662e74d7 (root kill switch) | `1785172504.561116104` | https://hashscan.io/testnet/transaction/0.0.9794226-1785172500-395111264 |
| 2026-07-27 | DEMO: deliberate post-revocation verdict (cites revoked 0xdf27b03d7be00f2a…) judged out-of-mandate by the keyless verifier | `1785172607.765035104` | https://hashscan.io/testnet/transaction/0.0.8641261-1785172603-335249819 |
| 2026-07-27 | grant mandate verdict:rejection-attestation → 0.0.8641261, window [1785172643,1787764643) (ceremony §3.5.3) | `0x93dce459eaeecf87617d24eba9f46df7e1cd751e91a9bcf151f36ddf85510ba1` | https://hashscan.io/testnet/transaction/0.0.9794226-1785172639-234909194 |
| 2026-07-27 | rejection attestation (mandated, v0.2) for 0.0.9645621 seq 3: schema.missing | `1785172680.376116760` | https://hashscan.io/testnet/transaction/0.0.8641261-1785172674-600835659 |
| 2026-07-27 | redeem: settled x402 receipt 0.0.9646033-1784495988-270588092 → vend(0xfa00a4b3d592139508828675ba73a718013acdc4) | `0xfa00a4b3d592139508828675ba73a718013acdc4` | https://hashscan.io/testnet/transaction/0.0.8641261-1785174197-880527441 |
| 2026-07-27 | redeem: settled x402 receipt 0.0.9646033-1784495870-744739955 → vend(0xdda899346bc8db560467eda299e9a7bfc2f39cbd) | `0xdda899346bc8db560467eda299e9a7bfc2f39cbd` | https://hashscan.io/testnet/transaction/0.0.8641261-1785174200-393077192 |
| 2026-07-27 | redeem: settled x402 receipt 0.0.9646033-1785175870-493219754 → vend(0x8f36a50403f128496cb14b1c4476cbcc6e7f5bc7) | `0x8f36a50403f128496cb14b1c4476cbcc6e7f5bc7` | https://hashscan.io/testnet/transaction/0.0.8641261-1785175882-800058270 |
| 2026-07-27 | Lane A stamp by payer 0.0.9646033 (paint domain, fresh-clone path) | `1785180535.095903353` | https://hashscan.io/testnet/transaction/0.0.9646033-1785180531-397802874 |
