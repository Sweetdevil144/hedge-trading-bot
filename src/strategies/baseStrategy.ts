/**
 * BaseStrategy - Abstract base class for trading strategies
 */

import { Signal, StrategyConfig } from "../types";
import { SignalEngine } from "../core/signalEngine";
import { HedgeEngine } from "../core/hedgeEngine";
import { PositionManager } from "../core/positionManager";
import { RiskManager } from "../core/riskManager";
import { PrismaClient } from "@prisma/client";
import { WalletStore } from "../services/wallet";

/**
 * Abstract base class for all trading strategies
 */
export abstract class BaseStrategy {
  protected signalEngine: SignalEngine;
  protected hedgeEngine: HedgeEngine;
  protected positionManager: PositionManager;
  protected riskManager: RiskManager;
  protected config: StrategyConfig;
  protected userId: string;

  // Execution tracking
  protected executionCount: number = 0;
  protected lastExecutionTime?: Date;
  protected activePositions: Set<string> = new Set();

  constructor(
    config: StrategyConfig,
    userId: string,
    prisma: PrismaClient,
    walletStore: WalletStore,
  ) {
    this.config = config;
    this.userId = userId;
    this.signalEngine = new SignalEngine(prisma);
    this.hedgeEngine = new HedgeEngine(prisma, walletStore);
    this.positionManager = new PositionManager(prisma);
    this.riskManager = new RiskManager();
  }

  /**
   * Check if strategy can execute
   * Must be implemented by derived classes
   */
  abstract canExecute(): Promise<boolean>;

  /**
   * Execute the strategy
   * Must be implemented by derived classes
   */
  abstract execute(): Promise<void>;

  /**
   * Check if position should be closed
   * Must be implemented by derived classes
   */
  abstract shouldClose(positionId: string): Promise<boolean>;

  /**
   * Get strategy name
   */
  getName(): string {
    return this.config.name;
  }

  /**
   * Get strategy ID
   */
  getId(): string {
    return this.config.id;
  }

  /**
   * Check if strategy is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Enable strategy
   */
  enable(): void {
    this.config.enabled = true;
  }

  /**
   * Disable strategy
   */
  disable(): void {
    this.config.enabled = false;
  }

  /**
   * Get strategy configuration
   */
  getConfig(): StrategyConfig {
    return this.config;
  }

  /**
   * Update strategy parameters
   */
  updateParameters(params: Record<string, any>): void {
    this.config.parameters = {
      ...this.config.parameters,
      ...params,
    };
  }

  /**
   * Get execution statistics
   */
  getStats(): {
    executionCount: number;
    activePositions: number;
    lastExecutionTime?: Date;
  } {
    return {
      executionCount: this.executionCount,
      activePositions: this.activePositions.size,
      lastExecutionTime: this.lastExecutionTime,
    };
  }

  /**
   * Track position as active
   */
  protected trackPosition(positionId: string): void {
    this.activePositions.add(positionId);
  }

  /**
   * Untrack position (when closed)
   */
  protected untrackPosition(positionId: string): void {
    this.activePositions.delete(positionId);
  }

  /**
   * Record execution
   */
  protected recordExecution(): void {
    this.executionCount++;
    this.lastExecutionTime = new Date();
  }

  /**
   * Validate entry conditions
   */
  protected async validateEntry(): Promise<{ valid: boolean; reason?: string }> {
    // Check if strategy is enabled
    if (!this.config.enabled) {
      return { valid: false, reason: "Strategy is disabled" };
    }

    // Check max positions
    const openPositions = await this.positionManager.getOpenPositions(this.userId);
    const maxPositions = this.config.parameters.maxPositions || 10;

    if (openPositions.length >= maxPositions) {
      return { valid: false, reason: `Max positions reached (${maxPositions})` };
    }

    // Check user balance
    const requiredAmount = this.config.parameters.maxPositionSize || 1000;
    // Balance check would be done in HedgeEngine

    return { valid: true };
  }

  /**
   * Calculate position size based on risk parameters
   */
  protected calculatePositionSize(): number {
    const baseSize = this.config.parameters.maxPositionSize || 1000;
    // Could add dynamic sizing based on volatility, risk, etc.
    return baseSize;
  }

  /**
   * Get stop-loss price
   */
  protected getStopLossPrice(entryPrice: number, side: "long" | "short"): number {
    const stopLossPercent = this.config.parameters.stopLoss || 0.1; // 10% default

    if (side === "long") {
      return entryPrice * (1 - stopLossPercent);
    } else {
      return entryPrice * (1 + stopLossPercent);
    }
  }

  /**
   * Get take-profit price
   */
  protected getTakeProfitPrice(entryPrice: number, side: "long" | "short"): number {
    const takeProfitPercent = this.config.parameters.takeProfit || 0.05; // 5% default

    if (side === "long") {
      return entryPrice * (1 + takeProfitPercent);
    } else {
      return entryPrice * (1 - takeProfitPercent);
    }
  }

  /**
   * Check if stop-loss is hit
   */
  protected async checkStopLoss(positionId: string): Promise<boolean> {
    const position = await this.positionManager.getPosition(positionId);

    if (!position || !position.currentPrice) {
      return false;
    }

    const stopLossPercent = this.config.parameters.stopLoss || 0.1;
    const pnlPercent = position.unrealizedPnl / (position.amount * position.entryPrice);

    return pnlPercent <= -stopLossPercent;
  }

  /**
   * Check if take-profit is hit
   */
  protected async checkTakeProfit(positionId: string): Promise<boolean> {
    const position = await this.positionManager.getPosition(positionId);

    if (!position || !position.currentPrice) {
      return false;
    }

    const takeProfitPercent = this.config.parameters.takeProfit || 0.05;
    const pnlPercent = position.unrealizedPnl / (position.amount * position.entryPrice);

    return pnlPercent >= takeProfitPercent;
  }

  /**
   * Cleanup when strategy is stopped
   */
  async cleanup(): Promise<void> {
    // Stop signal engine monitoring
    this.signalEngine.clearHistory();

    // Clear active positions tracking
    this.activePositions.clear();

    console.log(`Strategy ${this.config.name} cleaned up`);
  }

  /**
   * Initialize strategy (called before starting)
   */
  async initialize(): Promise<void> {
    console.log(`Initializing strategy: ${this.config.name}`);
    // Can be overridden by derived classes
  }
}
