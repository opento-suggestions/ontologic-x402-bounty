/**
 * redeem-status.ts — has ORG's vend redeemed the receipt yet?
 *
 * Pure mirror read (keyless): does the alias resolve to an account, does it
 * hold HBAR and 1 wKEY? Also records the newborn's real account ID into the
 * keystore so the stamp tool can sign as it.
 */

import { getNetworkConfig, getWitnessConfig } from "../../../core/src/config.js";
import { latestNewborn, recordAccountId } from "../state/keystore.js";
import { ok, fail, type ToolResult } from "../channels.js";

interface MirrorAccount {
  account: string;
  balance: { balance: number; tokens: { token_id: string; balance: number }[] };
}

export async function handleRedeemStatus(aliasArg?: string): Promise<ToolResult> {
  const net = getNetworkConfig();
  const witness = getWitnessConfig();
  const alias = aliasArg ?? latestNewborn()?.alias;
  if (!alias) return fail("No testimony alias in keystore. Run witness_genesis first.");

  const resp = await fetch(`${net.mirrorNodeUrl}/accounts/${alias}`);
  if (!resp.ok) {
    return ok({
      alias,
      redeemed: false,
      status: "pending — account not yet created; the redeemable right stands (no funds strand)",
    });
  }
  const account = (await resp.json()) as MirrorAccount;
  const keyBalance = witness.keyTokenId
    ? account.balance.tokens.find((t) => t.token_id === witness.keyTokenId)?.balance ?? 0
    : 0;
  recordAccountId(alias, account.account);
  return ok({
    alias,
    redeemed: keyBalance >= 1,
    accountId: account.account,
    hbar: account.balance.balance / 1e8,
    wKey: keyBalance,
    hashscan: `https://hashscan.io/testnet/account/${account.account}`,
    next:
      keyBalance >= 1
        ? "witness_stamp lane=B — the newborn signs its own testimony"
        : "delivery pending — poll again shortly",
  });
}
