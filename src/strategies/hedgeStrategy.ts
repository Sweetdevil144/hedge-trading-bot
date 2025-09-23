/**
 * HedgeStrategy - Hedge trading strategy implementation
 */

import { BaseStrategy } from "./baseStrategy";
import { Signal } from "../types";
import { AppConfig } from "../utils/config";

/**
 * Hedge Strategy - Opens paired long/short positions based on spread opportunities
 */
export class HedgeStrategy extends BaseStrategy {
  private monitoredPools: string[] = [];
  private spreadSignals: Signal[] = [];

  /**
   * Initialize strategy - start monitoring pools
   */
  async initialize(): Promise<void> {
    await super.initialize();

    // Get pools from configuration
    const { PREDEFINED_POOLS } = await import("../utils/constants");

    // Monitor first few pools
    this.monitoredPools = PREDEFINED_POOLS.slice(0, 3).map((p) =>
      p.whirlpoolAddress.toString(),
    );

    // Start monitoring pools for price data
    for (const poolAddress of this.monitoredPools) {
      await this.signalEngine.startMonitoring(poolAddress);
    }

    console.log(`HedgeStrategy: Monitoring ${this.monitoredPools.length} pools`);
  }

  /**
   * Check if strategy can execute
   * Entry condition: spread deviation detected
   */
  async canExecute(): Promise<boolean> {
    // First validate basic entry conditions
    const validation = await this.validateEntry();
    if (!validation.valid) {
      console.log(`HedgeStrategy: Cannot execute - ${validation.reason}`);
      return false;
    }

    // Clear old signals
    this.spreadSignals = [];

    // Check for spread opportunities between monitored pools
    for (let i = 0; i < this.monitoredPools.length; i++) {
      for (let j = i + 1; j < this.monitoredPools.length; j++) {
        const poolA = this.monitoredPools[i];
        const poolB = this.monitoredPools[j];

        const minSpread = this.config.parameters.minSpread || 0.005; // 0.5% default
        const signal = await this.signalEngine.detectSpreadOpportunity(
          poolA,
          poolB,
          minSpread,
        );

        if (signal && signal.magnitude > minSpread) {
          this.spreadSignals.push(signal);
          console.log(
            `HedgeStrategy: Spread opportunity detected - ${(signal.magnitude * 100).toFixed(3)}%`,
          );
          return true;
        }
      }
    }

    // Also check for breakout signals
    for (const poolAddress of this.monitoredPools) {
      const breakoutSignal = await this.signalEngine.detectBreakout(
        "POOL",
        poolAddress,
        0.02,
      );

      if (breakoutSignal && breakoutSignal.magnitude > 0.02) {
        this.spreadSignals.push(breakoutSignal);
        console.log(
          `HedgeStrategy: Breakout detected - ${(breakoutSignal.magnitude * 100).toFixed(2)}%`,
        );
        return true;
      }
    }

    return false;
  }

  /**
   * Execute the strategy
   * Opens hedge position based on detected signal
   */
  async execute(): Promise<void> {
    try {
      if (this.spreadSignals.length === 0) {
        console.log("HedgeStrategy: No signals to execute");
        return;
      }

      // Take the strongest signal
      const signal = this.spreadSignals.sort((a, b) => b.magnitude - a.magnitude)[0];

      console.log(`HedgeStrategy: Executing based on signal: ${signal.reason}`);

      // Calculate position size
      const positionSize = this.calculatePositionSize();

      // Determine token to trade
      // For now, use a default token (SOL)
      // In production, this would be derived from the signal
      const token = "SOL";
      const strategy = "delta-neutral";

      // Open hedge position
      const hedgePosition = await this.hedgeEngine.openHedgePosition(
        this.userId,
        token,
        positionSize,
        strategy,
      );

      console.log(`HedgeStrategy: Opened hedge position ${hedgePosition.id}`);

      // Track the position
      this.trackPosition(hedgePosition.id);

      // Record execution
      this.recordExecution();
    } catch (error) {
      console.error("HedgeStrategy: Error executing strategy:", error);
      throw error;
    }
  }

  /**
   * Check if position should be closed
   * Exit conditions:
   * 1. Spread normalized (opportunity expired)
   * 2. Stop-loss hit (10% loss)
   * 3. Take-profit hit (5% profit)
   */
  async shouldClose(positionId: string): Promise<boolean> {
    try {
      // Get position details
      const position = await this.positionManager.getPosition(positionId);

      if (!position) {
        console.log(`HedgeStrategy: Position ${positionId} not found`);
        return false;
      }

      // Calculate P&L percentage
      const totalValue = position.amount * position.entryPrice;
      const pnlPercent = position.unrealizedPnl / totalValue;

      // Check stop-loss
      const stopLoss = this.config.parameters.stopLoss || 0.1; // 10% default
      if (pnlPercent <= -stopLoss) {
        console.log(
          `HedgeStrategy: Stop-loss hit for position ${positionId} (${(pnlPercent * 100).toFixed(2)}%)`,
        );
        return true;
      }

      // Check take-profit
      const takeProfit = this.config.parameters.takeProfit || 0.05; // 5% default
      if (pnlPercent >= takeProfit) {
        console.log(
          `HedgeStrategy: Take-profit hit for position ${positionId} (${(pnlPercent * 100).toFixed(2)}%)`,
        );
        return true;
      }

      // Check if spread normalized
      // For hedge positions, check if ratio is back to target
      const rebalanceNeeded = await this.signalEngine.checkRebalanceNeeded(positionId, 0.15);

      if (rebalanceNeeded && rebalanceNeeded.magnitude > 0.15) {
        console.log(
          `HedgeStrategy: Large drift detected for position ${positionId}, considering close`,
        );
        // Only close if at profit or small loss
        if (pnlPercent > -0.03) {
          return true;
        }
      }

      return false;
    } catch (error) {
      console.error(`HedgeStrategy: Error checking close condition for ${positionId}:`, error);
      return false;
    }
  }

  /**
   * Check if spread has normalized
   */
  private async spreadNormalized(poolA: string, poolB: string): Promise<boolean> {
    const signal = await this.signalEngine.detectSpreadOpportunity(poolA, poolB, 0.002);
    return signal === null; // Spread normalized if no signal
  }

  /**
   * Get strategy-specific statistics
   */
  getStrategyStats(): {
    monitoredPools: number;
    activeSignals: number;
    averageSpread: number;
  } {
    const avgSpread =
      this.spreadSignals.length > 0
        ? this.spreadSignals.reduce((sum, s) => sum + s.magnitude, 0) / this.spreadSignals.length
        : 0;

    return {
      monitoredPools: this.monitoredPools.length,
      activeSignals: this.spreadSignals.length,
      averageSpread: avgSpread,
    };
  }

  /**
   * Cleanup when strategy is stopped
   */
  async cleanup(): Promise<void> {
    // Stop monitoring pools
    for (const poolAddress of this.monitoredPools) {
      this.signalEngine.stopMonitoring(poolAddress);
    }

    await super.cleanup();
  }
}
