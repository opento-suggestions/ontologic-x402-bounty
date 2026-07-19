import type { HardhatUserConfig } from "hardhat/config";
import "dotenv/config";
import path from "node:path";
import dotenv from "dotenv";

// The repo-root .env is the one source of truth (hello-world convention).
dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

const HEDERA_RPC_URL = process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api";
const PRIVATE_KEY = process.env.OPERATOR_HEX_KEY || "";

if (HEDERA_RPC_URL.toLowerCase().includes("mainnet")) {
  throw new Error("Refusing to configure: mainnet endpoint detected. Testnet only.");
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    hedera: {
      url: HEDERA_RPC_URL,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 296, // Hedera testnet
    },
  },
};

export default config;
