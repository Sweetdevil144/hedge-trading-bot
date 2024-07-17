// src/utils/constants.ts
import { PublicKey } from "@solana/web3.js";
import { address } from "@solana/kit";
import { connectionManager } from "../services/connectionManager";

// ----------------------
// 1) Connection Functions (Dynamic)
// ----------------------
export function getConnection() {
  return connectionManager.getDefaultStandardConnection();
}

// ----------------------
// 2) Network-specific values (Dynamic)
// ----------------------

// Get current network
export function getCurrentNetwork() {
  return connectionManager.getCurrentNetwork();
}

// Return token address based on the current network
export function getTokenMint(token: "USDC" | "USDT" | "USDI") {
  const network = getCurrentNetwork();
  const isMainnet = network === "mainnet-beta";

  // Token address map by network
  const tokenAddresses = {
    mainnet: {
      USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
      USDI: "CXbKtuMVWc2LkedJjATZDNwaPSN6vHsuBGqYHUC4BN3B",
    },
    devnet: {
      USDC: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", // https://faucet.circle.coma/
      USDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // This is mainnet USDT address
      USDI: "CXbKtuMVWc2LkedJjATZDNwaPSN6vHsuBGqYHUC4BN3B", // This is mainnet USDI address
    },
  };

  const addresses = isMainnet ? tokenAddresses.mainnet : tokenAddresses.devnet;
  return new PublicKey(addresses[token]);
}

// Convenience functions for token addresses
export function getUsdcMint() {
  return getTokenMint("USDC");
}

export function getUsdtMint() {
  return getTokenMint("USDT");
}

export function getUsdiMint() {
  return getTokenMint("USDI");
}

// ----------------------
// 3) Static PublicKeys
// ----------------------
export const CLMM_PROGRAM_ID = new PublicKey("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK");
export const POOL_STATE = new PublicKey("6bGe466weTDXkv8emyRMxFxLDQyXkE7W89zod8e5AGVe");
export const AMM_CONFIG = new PublicKey("E64NGkDLLCdQ2yFNPcavaKptrEgmiQaNykUuLC1Qgwyp");
export const OBSERVATION_STATE = new PublicKey("8JxwSBohQa42ahYntvoxR91LEvNL9g1232wa5cMRwW4z");
export const INPUT_VAULT = new PublicKey("Abd1ehgfMAAhmmVrWENYYLUzNHQrQHtaazr2f1SD6HUE");
export const OUTPUT_VAULT = new PublicKey("GrXCVwWjQavypEw41RDiCqQNzj9aEoEdmHG6QaRunjyX");
export const OUTPUT_VAULT_2 = new PublicKey("Ary4XMyk4vx2Jd9YGhXZPgR5FFPtKcNb7qPyPXQHBJ1m");

// ----------------------
// 4) Config
// ----------------------
export const WALLET_DATA_FILE = "wallet_data.json";

export const ORCA_WHIRLPOOL_PROGRAM_ID = new PublicKey(
  "whirLbG9ZzKfAwQ4CD6B8XvuHn34Ns2Jt6ZFM2ZrUzr", // Example only
);

export const ORCA_USDC_SOL_WHIRLPOOL = address("Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE");

export const ORCA_WBTC_SOL_WHIRLPOOL = new PublicKey("B5EwJVDuAauzUEEdwvbuXzbFFgEYnUqqS37TUM1c4PQA");

// --------------------------------------------
// 5) Predefined Pools
// --------------------------------------------
/**
 * Because one is stored as an `address(...)` (string),
 * and the other is a `PublicKey`, we'll just store them as-is.
 * Your code can call `.toString()` if needed.
 */
export const PREDEFINED_POOLS = [
  {
    label: "SOL/USDC",
    whirlpoolAddress: ORCA_USDC_SOL_WHIRLPOOL,
  },
  {
    label: "WBTC/USDT",
    whirlpoolAddress: ORCA_WBTC_SOL_WHIRLPOOL,
  },
];
