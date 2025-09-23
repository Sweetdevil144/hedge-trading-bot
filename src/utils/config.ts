import * as config from "config";
import { PublicKey } from "@solana/web3.js";

// Configuration interfaces
export interface NetworkConfig {
  default: string;
  endpoints: {
    [key: string]: string;
  };
}

export interface TokenAddresses {
  [network: string]: {
    [token: string]: string;
  };
}

export interface ProgramAddresses {
  CLMM_PROGRAM_ID: string;
  POOL_STATE: string;
  AMM_CONFIG: string;
  OBSERVATION_STATE: string;
  INPUT_VAULT: string;
  OUTPUT_VAULT: string;
  OUTPUT_VAULT_2: string;
  ORCA_WHIRLPOOL_PROGRAM_ID: string;
}

export interface PoolConfig {
  label: string;
  whirlpoolAddress: string;
}

export interface TradingConfig {
  slippage: {
    default: number;
    max: number;
    min: number;
  };
  fees: {
    swap: number;
    pool: number;
  };
  limits: {
    maxPositions: number;
    maxOrdersPerPosition: number;
    minTradeAmount: number;
    maxTradeAmount: number;
  };
}

export interface HedgeConfig {
  defaultRatio: number;
  minRatio: number;
  maxRatio: number;
  rebalanceThreshold: number;
  autoRebalance: boolean;
}

export interface RiskConfig {
  maxLeverage: number;
  maxDrawdown: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  maxDailyLoss: number;
}

export interface DatabaseConfig {
  pool: {
    min: number;
    max: number;
  };
  timeout: number;
}

export interface StorageConfig {
  walletDataFile: string;
}

/**
 * Type-safe configuration access layer
 */
export class AppConfig {
  static getNetwork(): NetworkConfig {
    return config.get<NetworkConfig>("network");
  }

  static getCurrentNetwork(): string {
    return process.env.SOLANA_NETWORK || this.getNetwork().default;
  }

  static getRpcEndpoint(network?: string): string {
    const net = network || this.getCurrentNetwork();
    const endpoints = this.getNetwork().endpoints;

    // Check for custom RPC URL in environment
    const envKey = `${net.toUpperCase().replace(/-/g, "_")}_RPC_URL`;
    const customRpc = process.env[envKey];

    return customRpc || endpoints[net] || endpoints[this.getNetwork().default];
  }

  static getTokenAddress(token: "USDC" | "USDT" | "USDI", network?: string): PublicKey {
    const net = network || this.getCurrentNetwork();
    const isMainnet = net === "mainnet-beta";
    const tokens = config.get<TokenAddresses>("tokens");
    const tokenMap = isMainnet ? tokens.mainnet : tokens.devnet;

    return new PublicKey(tokenMap[token]);
  }

  static getProgramAddresses(): ProgramAddresses {
    return config.get<ProgramAddresses>("programs");
  }

  static getProgramAddress(program: keyof ProgramAddresses): PublicKey {
    const programs = this.getProgramAddresses();
    return new PublicKey(programs[program]);
  }

  static getPredefinedPools(): PoolConfig[] {
    return config.get<{ predefined: PoolConfig[] }>("pools").predefined;
  }

  static getTradingConfig(): TradingConfig {
    return config.get<TradingConfig>("trading");
  }

  static getHedgeConfig(): HedgeConfig {
    return config.get<HedgeConfig>("hedge");
  }

  static getRiskConfig(): RiskConfig {
    return config.get<RiskConfig>("risk");
  }

  static getDatabaseConfig(): DatabaseConfig {
    return config.get<DatabaseConfig>("database");
  }

  static getStorageConfig(): StorageConfig {
    return config.get<StorageConfig>("storage");
  }

  static getWalletDataFile(): string {
    return this.getStorageConfig().walletDataFile;
  }

  static get<T>(key: string): T {
    return config.get<T>(key);
  }

  static has(key: string): boolean {
    return config.has(key);
  }
}

// Export convenience functions for backward compatibility
export const getCurrentNetwork = () => AppConfig.getCurrentNetwork();
export const getRpcEndpoint = (network?: string) => AppConfig.getRpcEndpoint(network);
export const getTokenAddress = (token: "USDC" | "USDT" | "USDI", network?: string) =>
  AppConfig.getTokenAddress(token, network);
export const getProgramAddress = (program: keyof ProgramAddresses) =>
  AppConfig.getProgramAddress(program);
export const getPredefinedPools = () => AppConfig.getPredefinedPools();
export const getWalletDataFile = () => AppConfig.getWalletDataFile();
