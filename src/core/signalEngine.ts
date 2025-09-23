/**
 * SignalEngine - Detect trading opportunities and market signals
 */

import { Signal } from "../types";
import { marketDataService } from "../services/marketData";
import { PositionManager } from "./positionManager";
import { PrismaClient } from "@prisma/client";
import {
  priceChange,
  priceChangeOverPeriod,
  volatility,
  SMA,
  detectBreakout,
  detectTrend,
  isVolumeSpike,
} from "../utils/indicators";
import { randomBytes } from "crypto";

// Simple UUID generator (since uuid package may not be available)
function generateId(): string {
  return randomBytes(16).toString("hex");
}

/**
 * SignalEngine - Detects market opportunities
 */
export class SignalEngine {
  private positionManager: PositionManager;
  private priceHistory: Map<string, Array<{ price: number; timestamp: Date; volume?: number }>>;
  private readonly HISTORY_SIZE = 100; // Keep last 100 data points
  private readonly PRICE_UPDATE_INTERVAL = 10000; // Update prices every 10 seconds

  constructor(prisma: PrismaClient) {
    this.positionManager = new PositionManager(prisma);
    this.priceHistory = new Map();
  }

  /**
   * Start collecting price data for a pair/pool
   */
  async startMonitoring(poolAddress: string): Promise<void> {
    if (!this.priceHistory.has(poolAddress)) {
      this.priceHistory.set(poolAddress, []);
    }

    // Subscribe to price updates
    marketDataService.subscribeToPriceUpdates(poolAddress, async (price) => {
      await this.recordPrice(poolAddress, price);
    });

    console.log(`SignalEngine: Started monitoring ${poolAddress}`);
  }

  /**
   * Stop monitoring a pool
   */
  stopMonitoring(poolAddress: string): void {
    this.priceHistory.delete(poolAddress);
    console.log(`SignalEngine: Stopped monitoring ${poolAddress}`);
  }

  /**
   * Record price in history
   */
  private async recordPrice(
    poolAddress: string,
    price: number,
    volume?: number,
  ): Promise<void> {
    const history = this.priceHistory.get(poolAddress) || [];

    history.push({
      price,
      timestamp: new Date(),
      volume,
    });

    // Keep only last N data points
    if (history.length > this.HISTORY_SIZE) {
      history.shift();
    }

    this.priceHistory.set(poolAddress, history);
  }

  /**
   * Get price history for a pool
   */
  private getPriceHistory(poolAddress: string): number[] {
    const history = this.priceHistory.get(poolAddress) || [];
    return history.map((h) => h.price);
  }

  /**
   * Get volume history for a pool
   */
  private getVolumeHistory(poolAddress: string): number[] {
    const history = this.priceHistory.get(poolAddress) || [];
    return history.filter((h) => h.volume !== undefined).map((h) => h.volume!);
  }

  /**
   * Detect price breakout
   * Returns signal if price moves >threshold% in specified timeframe
   */
  async detectBreakout(
    pair: string,
    poolAddress: string,
    threshold: number = 0.02, // 2% default
  ): Promise<Signal | null> {
    try {
      const history = this.getPriceHistory(poolAddress);

      if (history.length < 10) {
        return null; // Not enough data
      }

      const currentPrice = history[history.length - 1];
      const historicalPrices = history.slice(0, -1);

      const breakoutResult = detectBreakout(currentPrice, historicalPrices, threshold);

      if (breakoutResult.breakout) {
        return {
          id: uuidv4(),
          type: "breakout",
          pair,
          poolA: poolAddress,
          magnitude: breakoutResult.magnitude,
          confidence: Math.min(breakoutResult.magnitude / threshold, 1.0),
          direction: breakoutResult.direction || "neutral",
          reason: `Price ${breakoutResult.direction} breakout detected: ${(breakoutResult.magnitude * 100).toFixed(2)}% move`,
          metadata: {
            currentPrice,
            threshold,
            historicalAverage: SMA(historicalPrices, Math.min(20, historicalPrices.length)),
          },
          timestamp: new Date(),
          expiresAt: new Date(Date.now() + 5 * 60 * 1000), // Expires in 5 minutes
        };
      }

      return null;
    } catch (error) {
      console.error(`Error detecting breakout for ${pair}:`, error);
      return null;
    }
  }

  /**
   * Detect spread opportunity between two pools
   * Returns signal if spread >threshold%
   */
  async detectSpreadOpportunity(
    poolA: string,
    poolB: string,
    threshold: number = 0.005, // 0.5% default
  ): Promise<Signal | null> {
    try {
      const priceA = await marketDataService.getCurrentPrice(poolA);
      const priceB = await marketDataService.getCurrentPrice(poolB);

      if (!priceA || !priceB) {
        return null;
      }

      // Calculate spread percentage
      const spread = Math.abs(priceA - priceB);
      const averagePrice = (priceA + priceB) / 2;
      const spreadPercent = spread / averagePrice;

      if (spreadPercent > threshold) {
        const direction = priceA > priceB ? "up" : "down";

        return {
          id: uuidv4(),
          type: "spread",
          poolA,
          poolB,
          magnitude: spreadPercent,
          confidence: Math.min(spreadPercent / threshold, 1.0),
          direction,
          reason: `Spread opportunity detected: ${(spreadPercent * 100).toFixed(3)}% between pools`,
          metadata: {
            priceA,
            priceB,
            spread,
            spreadPercent,
          },
          timestamp: new Date(),
          expiresAt: new Date(Date.now() + 2 * 60 * 1000), // Expires in 2 minutes
        };
      }

      return null;
    } catch (error) {
      console.error(`Error detecting spread opportunity:`, error);
      return null;
    }
  }

  /**
   * Check if position needs rebalancing
   * Returns true if hedge ratio drifted >threshold%
   */
  async checkRebalanceNeeded(
    positionId: string,
    threshold: number = 0.05, // 5% default
  ): Promise<Signal | null> {
    try {
      const positions = await this.positionManager.prisma.position.findMany({
        where: {
          hedgePositionId: positionId,
          status: "OPEN",
        },
      });

      const longPos = positions.find((p: any) => p.isLongSide === true);
      const shortPos = positions.find((p: any) => p.isLongSide === false);

      if (!longPos || !shortPos) {
        return null;
      }

      // Get current prices
      const longPrice = await marketDataService.getCurrentPrice(longPos.poolAddress);
      const shortPrice = await marketDataService.getCurrentPrice(shortPos.poolAddress);

      // Calculate current values
      const longValue = longPos.amount * longPrice;
      const shortValue = shortPos.amount * shortPrice;

      // Calculate current ratio
      const currentRatio = longValue / shortValue;
      const targetRatio = longPos.hedgeRatio || 1.0;

      // Calculate drift
      const drift = Math.abs(currentRatio - targetRatio) / targetRatio;

      if (drift > threshold) {
        return {
          id: uuidv4(),
          type: "rebalance",
          positionId,
          magnitude: drift,
          confidence: Math.min(drift / threshold, 1.0),
          direction: currentRatio > targetRatio ? "up" : "down",
          reason: `Hedge ratio drifted ${(drift * 100).toFixed(2)}% from target`,
          metadata: {
            currentRatio,
            targetRatio,
            drift,
            longValue,
            shortValue,
          },
          timestamp: new Date(),
        };
      }

      return null;
    } catch (error) {
      console.error(`Error checking rebalance for position ${positionId}:`, error);
      return null;
    }
  }

  /**
   * Detect volume spike
   * Returns signal if volume >threshold * average
   */
  async detectVolumeSpike(
    poolAddress: string,
    threshold: number = 2.0, // 2x average
  ): Promise<Signal | null> {
    try {
      const volumeHistory = this.getVolumeHistory(poolAddress);

      if (volumeHistory.length < 10) {
        return null; // Not enough data
      }

      const currentVolume = volumeHistory[volumeHistory.length - 1];
      const historicalVolumes = volumeHistory.slice(0, -1);
      const avgVolume =
        historicalVolumes.reduce((sum, vol) => sum + vol, 0) / historicalVolumes.length;

      if (isVolumeSpike(currentVolume, avgVolume, threshold)) {
        const magnitude = currentVolume / avgVolume;

        return {
          id: uuidv4(),
          type: "volume_spike",
          poolA: poolAddress,
          magnitude,
          confidence: Math.min((magnitude - threshold) / threshold, 1.0),
          direction: "up",
          reason: `Volume spike detected: ${magnitude.toFixed(2)}x average volume`,
          metadata: {
            currentVolume,
            averageVolume: avgVolume,
            threshold,
          },
          timestamp: new Date(),
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        };
      }

      return null;
    } catch (error) {
      console.error(`Error detecting volume spike for ${poolAddress}:`, error);
      return null;
    }
  }

  /**
   * Detect price threshold crossing
   * Returns signal if price crosses specified threshold
   */
  async detectThresholdCrossing(
    poolAddress: string,
    thresholdPrice: number,
    direction: "above" | "below",
  ): Promise<Signal | null> {
    try {
      const history = this.getPriceHistory(poolAddress);

      if (history.length < 2) {
        return null;
      }

      const currentPrice = history[history.length - 1];
      const previousPrice = history[history.length - 2];

      const crossedAbove = previousPrice <= thresholdPrice && currentPrice > thresholdPrice;
      const crossedBelow = previousPrice >= thresholdPrice && currentPrice < thresholdPrice;

      if (
        (direction === "above" && crossedAbove) ||
        (direction === "below" && crossedBelow)
      ) {
        return {
          id: uuidv4(),
          type: "breakout",
          poolA: poolAddress,
          magnitude: Math.abs(currentPrice - thresholdPrice) / thresholdPrice,
          confidence: 0.9,
          direction: direction === "above" ? "up" : "down",
          reason: `Price crossed ${direction} threshold of ${thresholdPrice}`,
          metadata: {
            currentPrice,
            previousPrice,
            thresholdPrice,
          },
          timestamp: new Date(),
        };
      }

      return null;
    } catch (error) {
      console.error(`Error detecting threshold crossing:`, error);
      return null;
    }
  }

  /**
   * Detect trend changes
   */
  async detectTrendChange(poolAddress: string): Promise<Signal | null> {
    try {
      const history = this.getPriceHistory(poolAddress);

      if (history.length < 30) {
        return null;
      }

      const trend = detectTrend(history, 10, 30);

      if (trend !== "sideways") {
        const changePercent = priceChangeOverPeriod(history.slice(-10));

        return {
          id: uuidv4(),
          type: "trend",
          poolA: poolAddress,
          magnitude: Math.abs(changePercent) / 100,
          confidence: 0.7,
          direction: trend === "uptrend" ? "up" : "down",
          reason: `${trend} detected with ${changePercent.toFixed(2)}% recent change`,
          metadata: {
            trend,
            changePercent,
          },
          timestamp: new Date(),
        };
      }

      return null;
    } catch (error) {
      console.error(`Error detecting trend change:`, error);
      return null;
    }
  }

  /**
   * Scan all monitored pools for signals
   */
  async scanForSignals(): Promise<Signal[]> {
    const signals: Signal[] = [];

    for (const poolAddress of this.priceHistory.keys()) {
      // Check for breakouts
      const breakoutSignal = await this.detectBreakout("POOL", poolAddress, 0.02);
      if (breakoutSignal) signals.push(breakoutSignal);

      // Check for volume spikes
      const volumeSignal = await this.detectVolumeSpike(poolAddress, 2.0);
      if (volumeSignal) signals.push(volumeSignal);

      // Check for trend changes
      const trendSignal = await this.detectTrendChange(poolAddress);
      if (trendSignal) signals.push(trendSignal);
    }

    return signals;
  }

  /**
   * Get current volatility for a pool
   */
  getVolatility(poolAddress: string): number {
    const history = this.getPriceHistory(poolAddress);

    if (history.length < 2) {
      return 0;
    }

    return volatility(history);
  }

  /**
   * Get price change over period
   */
  getPriceChange(poolAddress: string, minutes: number = 5): number {
    const history = this.priceHistory.get(poolAddress) || [];

    if (history.length < 2) {
      return 0;
    }

    const cutoffTime = Date.now() - minutes * 60 * 1000;
    const relevantHistory = history.filter((h) => h.timestamp.getTime() >= cutoffTime);

    if (relevantHistory.length < 2) {
      return 0;
    }

    const firstPrice = relevantHistory[0].price;
    const lastPrice = relevantHistory[relevantHistory.length - 1].price;

    return priceChange(lastPrice, firstPrice);
  }

  /**
   * Clear all price history (for testing)
   */
  clearHistory(): void {
    this.priceHistory.clear();
  }

  /**
   * Get monitoring status
   */
  getMonitoringStatus(): {
    monitoredPools: number;
    totalDataPoints: number;
    pools: string[];
  } {
    let totalDataPoints = 0;

    for (const history of this.priceHistory.values()) {
      totalDataPoints += history.length;
    }

    return {
      monitoredPools: this.priceHistory.size,
      totalDataPoints,
      pools: Array.from(this.priceHistory.keys()),
    };
  }
}
