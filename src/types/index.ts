import { Context, SessionFlavor } from "grammy";

// =====================================================
// EXISTING TYPES (Telegram Bot)
// =====================================================

export interface WalletData {
  publicKey: string;
  secretKey: string; // base64 or hex
  createdAt: number;
  seedPhraseBackedUp: boolean;
  seedPhrase?: string;
}

// Reintroduce UserData so wallet.ts can store { wallet: WalletData } in the Map
export interface UserData {
  wallet: WalletData;
}

export interface SessionData {
  userId?: string;
  waitingForMintAmount?: boolean;
  waitingForConversionAmount?: boolean;
  waitingForWithdrawalAmount?: boolean;
  waitingForAddress?: boolean;
  waitingForResetConfirmation?: boolean;
  waitingForSeedPhrase?: boolean;
  withdrawalAmount?: number;

  waitingForLiquidityAmounts?: boolean;
}

export type MyContext = Context & SessionFlavor<SessionData>;

// =====================================================
// NEW TYPES (Hedge Trading System)
// =====================================================

/**
 * Represents a single side of a trading position
 */
export interface Position {
  pool: string;
  token: string;
  amount: number;
  entryPrice: number;
  side: "long" | "short";
}

/**
 * Represents a hedge position with both long and short sides
 */
export interface HedgePosition {
  id: string;
  userId: string;
  longSide: Position;
  shortSide: Position;
  hedgeRatio: number;
  status: "open" | "closed";
  pnl: number;
  createdAt: Date;
  updatedAt: Date;
  closedAt?: Date;
}

/**
 * Trading strategy interface
 */
export interface TradingStrategy {
  id: string;
  name: string;
  type: "hedge" | "arbitrage";
  enabled: boolean;
  parameters?: Record<string, any>;
}

/**
 * Market data interface for real-time price tracking
 */
export interface MarketData {
  token: string;
  pool: string;
  price: number;
  volume24h: number;
  priceChange24h: number;
  timestamp: Date;
}

/**
 * Risk metrics for position monitoring
 */
export interface RiskMetrics {
  currentDrawdown: number;
  maxDrawdown: number;
  sharpeRatio: number;
  winRate: number;
  profitFactor: number;
  totalPnl: number;
}

/**
 * Order book entry
 */
export interface OrderBookEntry {
  price: number;
  amount: number;
  side: "bid" | "ask";
}

/**
 * Trading signal
 */
export interface TradingSignal {
  type: "entry" | "exit" | "rebalance";
  position: Position;
  action: "buy" | "sell";
  amount: number;
  reason: string;
  confidence: number;
  timestamp: Date;
}

/**
 * Portfolio summary
 */
export interface Portfolio {
  userId: string;
  totalValue: number;
  totalPnl: number;
  openPositions: number;
  hedgePositions: number;
  availableBalance: number;
  allocatedBalance: number;
  riskMetrics: RiskMetrics;
}

/**
 * Transaction result
 */
export interface TransactionResult {
  signature: string;
  status: "success" | "failed" | "pending";
  error?: string;
  timestamp: Date;
}

/**
 * Rebalance action
 */
export interface RebalanceAction {
  hedgePositionId: string;
  currentRatio: number;
  targetRatio: number;
  adjustments: {
    side: "long" | "short";
    action: "increase" | "decrease";
    amount: number;
  }[];
}

/**
 * Market Signal - Detected trading opportunity
 */
export interface Signal {
  id: string;
  type: "breakout" | "spread" | "rebalance" | "volume_spike" | "trend";
  pair?: string;
  poolA?: string;
  poolB?: string;
  positionId?: string;
  magnitude: number;
  confidence: number;
  direction?: "up" | "down" | "neutral";
  reason: string;
  metadata?: Record<string, any>;
  timestamp: Date;
  expiresAt?: Date;
}

/**
 * Strategy Configuration
 */
export interface StrategyConfig {
  id: string;
  name: string;
  enabled: boolean;
  type: "hedge" | "arbitrage" | "momentum" | "custom";
  parameters: {
    minSpread?: number;
    maxPositionSize?: number;
    stopLoss?: number;
    takeProfit?: number;
    timeframe?: number;
    [key: string]: any;
  };
  entryConditions: string[];
  exitConditions: string[];
}

/**
 * Automation Status
 */
export interface AutomationStatus {
  running: boolean;
  strategies: string[];
  positionsOpened: number;
  signalsDetected: number;
  lastExecutionTime?: Date;
  uptime: number;
  mode: "live" | "dry-run";
}
