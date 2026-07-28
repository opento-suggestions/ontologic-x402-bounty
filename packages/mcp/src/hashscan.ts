/** hashscan.ts — one HashScan link formatter for the plugin's tools. */

export function hashscanTx(txId: string): string {
  // 0.0.x@seconds.nanos → 0.0.x-seconds-nanos
  return `https://hashscan.io/testnet/transaction/${txId.replace("@", "-").replace(/\.(\d+)$/, "-$1")}`;
}
