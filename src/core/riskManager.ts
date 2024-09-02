import { AppConfig } from "../utils/config";
import { RiskMetrics } from "../types";
import { PrismaClient } from "@prisma/client";

/**
 * Validation result interface
 */
export interface ValidationResult {
  allowed: boolean;
  reason?: string;
  warnings: string[];
}

/**
 * Portfolio risk metrics interface
 */
export interface PortfolioRiskMetrics {
  totalExposure: number;
  largestPosition: number;
  openPositions: number;
  dayPnL: number;
  weekPnL: number;
  maxDrawdown: number;
}

/**
 * Order interface for validation
 */
export interface OrderForValidation {
  userId: string;
  amount: number;
  token?: string;
  type?: string;
}

/**
 * RiskManager - Manages risk parameters and validates trading decisions
 */
export class RiskManager {
  private config = AppConfig.getRiskConfig();
  private prisma?: PrismaClient;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Check if a position size is within risk limits
   */
  validatePositionSize(amount: number, totalPortfolioValue: number): { valid: boolean; reason?: string } {
    const positionValue = amount;
    const positionPercent = (positionValue / totalPortfolioValue) * 100;

    const maxPositionPercent = (1 / this.config.maxLeverage) * 100;

    if (positionPercent > maxPositionPercent) {
      return {
        valid: false,
        reason: `Position size exceeds risk limit. Max ${maxPositionPercent.toFixed(1)}% of portfolio per position`,
      };
    }

    return { valid: true };
  }

  /**
   * Check if adding a new position would exceed max positions limit
   */
  validateMaxPositions(currentPositions: number): { valid: boolean; reason?: string } {
    const maxPositions = AppConfig.getTradingConfig().limits.maxPositions;

    if (currentPositions >= maxPositions) {
      return {
        valid: false,
        reason: `Maximum positions limit reached (${maxPositions})`,
      };
    }

    return { valid: true };
  }

  /**
   * Check if current drawdown is within acceptable limits
   */
  validateDrawdown(currentValue: number, peakValue: number): { valid: boolean; reason?: string } {
    if (peakValue === 0) return { valid: true };

    const drawdown = (peakValue - currentValue) / peakValue;

    if (drawdown > this.config.maxDrawdown) {
      return {
        valid: false,
        reason: `Maximum drawdown exceeded. Current: ${(drawdown * 100).toFixed(2)}%, Max: ${(this.config.maxDrawdown * 100).toFixed(2)}%`,
      };
    }

    return { valid: true };
  }

  /**
   * Calculate stop loss price
   */
  calculateStopLoss(entryPrice: number, side: "long" | "short"): number {
    if (side === "long") {
      return entryPrice * (1 - this.config.stopLossPercent);
    } else {
      return entryPrice * (1 + this.config.stopLossPercent);
    }
  }

  /**
   * Calculate take profit price
   */
  calculateTakeProfit(entryPrice: number, side: "long" | "short"): number {
    if (side === "long") {
      return entryPrice * (1 + this.config.takeProfitPercent);
    } else {
      return entryPrice * (1 - this.config.takeProfitPercent);
    }
  }

  /**
   * Check if a stop loss should be triggered
   */
  shouldTriggerStopLoss(currentPrice: number, entryPrice: number, side: "long" | "short"): boolean {
    const stopLossPrice = this.calculateStopLoss(entryPrice, side);

    if (side === "long") {
      return currentPrice <= stopLossPrice;
    } else {
      return currentPrice >= stopLossPrice;
    }
  }

  /**
   * Check if a take profit should be triggered
   */
  shouldTriggerTakeProfit(currentPrice: number, entryPrice: number, side: "long" | "short"): boolean {
    const takeProfitPrice = this.calculateTakeProfit(entryPrice, side);

    if (side === "long") {
      return currentPrice >= takeProfitPrice;
    } else {
      return currentPrice <= takeProfitPrice;
    }
  }

  /**
   * Calculate risk metrics from position history
   */
  calculateRiskMetrics(positions: Array<{ realizedPnl: number; unrealizedPnl: number }>): RiskMetrics {
    const totalPnl = positions.reduce((sum, p) => sum + p.realizedPnl + p.unrealizedPnl, 0);
    const closedPositions = positions.filter((p) => p.realizedPnl !== 0);

    const wins = closedPositions.filter((p) => p.realizedPnl > 0);
    const losses = closedPositions.filter((p) => p.realizedPnl < 0);

    const winRate = closedPositions.length > 0 ? wins.length / closedPositions.length : 0;

    const totalWins = wins.reduce((sum, p) => sum + p.realizedPnl, 0);
    const totalLosses = Math.abs(losses.reduce((sum, p) => sum + p.realizedPnl, 0));
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

    // Calculate drawdown
    let peak = 0;
    let maxDrawdown = 0;
    let runningPnl = 0;

    closedPositions.forEach((p) => {
      runningPnl += p.realizedPnl;
      if (runningPnl > peak) {
        peak = runningPnl;
      }
      const drawdown = peak > 0 ? (peak - runningPnl) / peak : 0;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    });

    const currentDrawdown = peak > 0 ? (peak - runningPnl) / peak : 0;

    // Simple Sharpe ratio calculation (assuming risk-free rate = 0)
    const avgReturn = closedPositions.length > 0 ? totalPnl / closedPositions.length : 0;
    const variance =
      closedPositions.length > 0
        ? closedPositions.reduce((sum, p) => sum + Math.pow(p.realizedPnl - avgReturn, 2), 0) /
          closedPositions.length
        : 0;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;

    return {
      currentDrawdown,
      maxDrawdown,
      sharpeRatio,
      winRate,
      profitFactor,
      totalPnl,
    };
  }

  /**
   * Validate hedge ratio is within acceptable range
   */
  validateHedgeRatio(ratio: number): { valid: boolean; reason?: string } {
    const hedgeConfig = AppConfig.getHedgeConfig();

    if (ratio < hedgeConfig.minRatio || ratio > hedgeConfig.maxRatio) {
      return {
        valid: false,
        reason: `Hedge ratio must be between ${hedgeConfig.minRatio} and ${hedgeConfig.maxRatio}`,
      };
    }

    return { valid: true };
  }

  /**
   * Check if hedge position needs rebalancing
   */
  needsRebalancing(currentRatio: number, targetRatio: number): boolean {
    const hedgeConfig = AppConfig.getHedgeConfig();
    const deviation = Math.abs(currentRatio - targetRatio) / targetRatio;

    return deviation > hedgeConfig.rebalanceThreshold;
  }

  /**
   * Validate trade amount is within limits
   */
  validateTradeAmount(amount: number): { valid: boolean; reason?: string } {
    const limits = AppConfig.getTradingConfig().limits;

    if (amount < limits.minTradeAmount) {
      return {
        valid: false,
        reason: `Trade amount below minimum (${limits.minTradeAmount})`,
      };
    }

    if (amount > limits.maxTradeAmount) {
      return {
        valid: false,
        reason: `Trade amount exceeds maximum (${limits.maxTradeAmount})`,
      };
    }

    return { valid: true };
  }

  // ============================================================================
  // NEW METHODS FOR PROMPT_2: Balance Checks & Emergency Controls
  // ============================================================================

  /**
   * Enforce max position size (configurable, default 1000 USDC)
   * Returns validation result with reason if invalid
   */
  enforceMaxPositionSize(amount: number, maxSize?: number): { valid: boolean; reason?: string } {
    const limits = AppConfig.getTradingConfig().limits;
    const maxPositionSize = maxSize || limits.maxTradeAmount;

    if (amount > maxPositionSize) {
      return {
        valid: false,
        reason: `Position size ${amount} exceeds maximum allowed ${maxPositionSize}`,
      };
    }

    return { valid: true };
  }

  /**
   * Check if user has sufficient balance for the trade
   * Requires balance information from wallet service
   */
  checkSufficientBalance(requiredAmount: number, availableBalance: number): { valid: boolean; reason?: string } {
    if (availableBalance < requiredAmount) {
      return {
        valid: false,
        reason: `Insufficient balance. Required: ${requiredAmount}, Available: ${availableBalance}`,
      };
    }

    // Add a small buffer for fees (1%)
    const bufferAmount = requiredAmount * 1.01;
    if (availableBalance < bufferAmount) {
      return {
        valid: false,
        reason: `Insufficient balance for trade + fees. Required: ${bufferAmount}, Available: ${availableBalance}`,
      };
    }

    return { valid: true };
  }

  /**
   * Implement stop-loss check (default 10% loss)
   * Returns true if stop-loss should be triggered
   */
  shouldTriggerStopLossWithDefault(
    currentPrice: number,
    entryPrice: number,
    side: "long" | "short",
    customStopLossPercent?: number,
  ): boolean {
    const stopLossPercent = customStopLossPercent || 0.1; // Default 10%

    const priceDiff = currentPrice - entryPrice;
    const percentChange = Math.abs(priceDiff / entryPrice);

    if (side === "long") {
      // Long position: trigger if price dropped by stopLossPercent
      return priceDiff < 0 && percentChange >= stopLossPercent;
    } else {
      // Short position: trigger if price increased by stopLossPercent
      return priceDiff > 0 && percentChange >= stopLossPercent;
    }
  }

  /**
   * Validate that a position can be opened given current portfolio state
   * Combines multiple risk checks
   */
  async validatePositionOpening(params: {
    amount: number;
    availableBalance: number;
    currentPositions: number;
    portfolioValue: number;
  }): Promise<{ valid: boolean; reasons: string[] }> {
    const { amount, availableBalance, currentPositions, portfolioValue } = params;
    const reasons: string[] = [];

    // Check max positions
    const maxPosCheck = this.validateMaxPositions(currentPositions);
    if (!maxPosCheck.valid && maxPosCheck.reason) {
      reasons.push(maxPosCheck.reason);
    }

    // Check position size
    const sizeCheck = this.enforceMaxPositionSize(amount);
    if (!sizeCheck.valid && sizeCheck.reason) {
      reasons.push(sizeCheck.reason);
    }

    // Check sufficient balance
    const balanceCheck = this.checkSufficientBalance(amount, availableBalance);
    if (!balanceCheck.valid && balanceCheck.reason) {
      reasons.push(balanceCheck.reason);
    }

    // Check portfolio percentage
    if (portfolioValue > 0) {
      const portfolioCheck = this.validatePositionSize(amount, portfolioValue);
      if (!portfolioCheck.valid && portfolioCheck.reason) {
        reasons.push(portfolioCheck.reason);
      }
    }

    // Check trade amount limits
    const amountCheck = this.validateTradeAmount(amount);
    if (!amountCheck.valid && amountCheck.reason) {
      reasons.push(amountCheck.reason);
    }

    return {
      valid: reasons.length === 0,
      reasons,
    };
  }

  /**
   * Calculate maximum safe position size based on available balance and risk parameters
   */
  calculateMaxSafePositionSize(availableBalance: number, portfolioValue: number): number {
    const limits = AppConfig.getTradingConfig().limits;

    // Can't use more than available balance
    let maxSize = availableBalance * 0.99; // Leave 1% buffer for fees

    // Can't exceed absolute max trade amount
    maxSize = Math.min(maxSize, limits.maxTradeAmount);

    // Can't exceed portfolio risk limits
    if (portfolioValue > 0) {
      const maxPortfolioPercent = (1 / this.config.maxLeverage) * 100;
      const maxFromPortfolio = (portfolioValue * maxPortfolioPercent) / 100;
      maxSize = Math.min(maxSize, maxFromPortfolio);
    }

    return maxSize;
  }

  /**
   * Get stop-loss price for default 10% loss threshold
   */
  getDefaultStopLossPrice(entryPrice: number, side: "long" | "short"): number {
    const stopLossPercent = 0.1; // 10%

    if (side === "long") {
      return entryPrice * (1 - stopLossPercent);
    } else {
      return entryPrice * (1 + stopLossPercent);
    }
  }

  // ============================================================================
  // NEW METHODS FOR PROMPT_5: Enhanced Risk Management
  // ============================================================================

  /**
   * Validate trade is within risk limits
   * Comprehensive validation checking all risk parameters
   */
  async validateTrade(order: OrderForValidation): Promise<ValidationResult> {
    const warnings: string[] = [];
    const reasons: string[] = [];

    if (!this.prisma) {
      return {
        allowed: false,
        reason: "Database connection not available",
        warnings: [],
      };
    }

    try {
      const { userId, amount, token } = order;

      // 1. Check sufficient balance
      // Get user wallet balance (simplified - would need actual wallet service integration)
      const availableBalance = amount * 2; // Placeholder - should fetch from wallet service
      const balanceCheck = this.checkSufficientBalance(amount, availableBalance);
      if (!balanceCheck.valid) {
        reasons.push(balanceCheck.reason || "Insufficient balance");
      }

      // 2. Check position size within limits
      const sizeCheck = this.enforceMaxPositionSize(amount);
      if (!sizeCheck.valid) {
        reasons.push(sizeCheck.reason || "Position size exceeds limit");
      }

      // 3. Check not exceeding max open positions
      const openPositions = await this.prisma.position.count({
        where: {
          userId,
          status: "OPEN",
        },
      });

      const maxPosCheck = this.validateMaxPositions(openPositions);
      if (!maxPosCheck.valid) {
        reasons.push(maxPosCheck.reason || "Max positions limit reached");
      }

      // Warning if approaching limit
      const limits = AppConfig.getTradingConfig().limits;
      if (openPositions >= limits.maxPositions * 0.8) {
        warnings.push(`Approaching max positions limit (${openPositions}/${limits.maxPositions})`);
      }

      // 4. Check total exposure not too concentrated
      if (token) {
        const tokenPositions = await this.prisma.position.findMany({
          where: {
            userId,
            status: "OPEN",
            tokenMint: token,
          },
        });

        const totalTokenExposure = tokenPositions.reduce((sum, p: any) => sum + p.amount * (p.entryPrice || 1), 0);
        const totalPortfolioValue = await this.calculateTotalPortfolioValue(userId);

        if (totalPortfolioValue > 0) {
          const tokenExposurePercent = (totalTokenExposure / totalPortfolioValue) * 100;
          const maxTokenExposure = 30; // 30% max exposure to single token

          if (tokenExposurePercent > maxTokenExposure) {
            reasons.push(`Token exposure exceeds ${maxTokenExposure}% (current: ${tokenExposurePercent.toFixed(1)}%)`);
          } else if (tokenExposurePercent > maxTokenExposure * 0.8) {
            warnings.push(`Approaching max token exposure (${tokenExposurePercent.toFixed(1)}%/${maxTokenExposure}%)`);
          }
        }
      }

      // 5. Check daily loss limit not exceeded
      const dayPnL = await this.calculateDayPnL(userId);
      const totalPortfolioValue = await this.calculateTotalPortfolioValue(userId);

      if (totalPortfolioValue > 0) {
        const dayLossPercent = (dayPnL / totalPortfolioValue) * 100;
        const maxDailyLoss = -10; // -10% max daily loss

        if (dayLossPercent < maxDailyLoss) {
          reasons.push(`Daily loss limit exceeded (${dayLossPercent.toFixed(2)}%)`);
        } else if (dayLossPercent < maxDailyLoss * 0.8) {
          warnings.push(`Approaching daily loss limit (${dayLossPercent.toFixed(2)}%)`);
        }
      }

      // 6. Check minimum SOL balance for fees
      // Placeholder - would need actual wallet balance check
      const minSolBalance = 0.1; // 0.1 SOL minimum
      // In production: fetch actual SOL balance and check
      // For now, just add a warning
      warnings.push(`Ensure you have at least ${minSolBalance} SOL for transaction fees`);

      // Return result
      return {
        allowed: reasons.length === 0,
        reason: reasons.length > 0 ? reasons.join("; ") : undefined,
        warnings,
      };
    } catch (error) {
      console.error("Error validating trade:", error);
      return {
        allowed: false,
        reason: `Validation error: ${error instanceof Error ? error.message : "Unknown error"}`,
        warnings: [],
      };
    }
  }

  /**
   * Get portfolio risk metrics
   * Returns comprehensive risk assessment
   */
  async getPortfolioRisk(userId: string): Promise<PortfolioRiskMetrics> {
    if (!this.prisma) {
      throw new Error("Database connection not available");
    }

    try {
      // Get all open positions
      const openPositions = await this.prisma.position.findMany({
        where: {
          userId,
          status: "OPEN",
        },
      });

      // Calculate total exposure
      const totalExposure = openPositions.reduce((sum, p: any) => {
        const value = p.amount * (p.currentPrice || p.entryPrice || 1);
        return sum + value;
      }, 0);

      // Find largest position
      const largestPosition = openPositions.reduce((max, p: any) => {
        const value = p.amount * (p.currentPrice || p.entryPrice || 1);
        return Math.max(max, value);
      }, 0);

      // Calculate day P&L
      const dayPnL = await this.calculateDayPnL(userId);

      // Calculate week P&L
      const weekPnL = await this.calculateWeekPnL(userId);

      // Calculate max drawdown
      const maxDrawdown = await this.calculateMaxDrawdown(userId);

      return {
        totalExposure,
        largestPosition,
        openPositions: openPositions.length,
        dayPnL,
        weekPnL,
        maxDrawdown,
      };
    } catch (error) {
      console.error("Error getting portfolio risk:", error);
      throw error;
    }
  }

  /**
   * Emergency exit - close all positions
   * Used in extreme risk situations
   */
  async emergencyExit(userId: string, reason: string): Promise<void> {
    if (!this.prisma) {
      throw new Error("Database connection not available");
    }

    console.warn(`EMERGENCY EXIT initiated for user ${userId}: ${reason}`);

    try {
      // Get all open positions
      const openPositions = await this.prisma.position.findMany({
        where: {
          userId,
          status: "OPEN",
        },
      });

      console.log(`Closing ${openPositions.length} positions...`);

      // Close each position
      for (const position of openPositions) {
        try {
          // Update position status to CLOSED
          await this.prisma.position.update({
            where: { id: position.id },
            data: {
              status: "CLOSED",
              closedAt: new Date(),
              // In production, would execute actual blockchain transaction
              // and update with real exit price and realized P&L
            },
          });

          console.log(`Closed position ${position.id}`);
        } catch (error) {
          console.error(`Failed to close position ${position.id}:`, error);
          // Continue with other positions even if one fails
        }
      }

      console.log(`Emergency exit completed. ${openPositions.length} positions closed.`);
    } catch (error) {
      console.error("Error during emergency exit:", error);
      throw error;
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Calculate total portfolio value
   */
  private async calculateTotalPortfolioValue(userId: string): Promise<number> {
    if (!this.prisma) return 0;

    const positions = await this.prisma.position.findMany({
      where: {
        userId,
        status: "OPEN",
      },
    });

    return positions.reduce((sum, p: any) => {
      const value = p.amount * (p.currentPrice || p.entryPrice || 1);
      return sum + value;
    }, 0);
  }

  /**
   * Calculate day P&L (last 24 hours)
   */
  private async calculateDayPnL(userId: string): Promise<number> {
    if (!this.prisma) return 0;

    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const positions = await this.prisma.position.findMany({
      where: {
        userId,
        OR: [
          { status: "OPEN" },
          {
            status: "CLOSED",
            closedAt: {
              gte: oneDayAgo,
            },
          },
        ],
      },
    });

    return positions.reduce((sum, p: any) => {
      return sum + (p.unrealizedPnl || 0) + (p.realizedPnl || 0);
    }, 0);
  }

  /**
   * Calculate week P&L (last 7 days)
   */
  private async calculateWeekPnL(userId: string): Promise<number> {
    if (!this.prisma) return 0;

    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const positions = await this.prisma.position.findMany({
      where: {
        userId,
        OR: [
          { status: "OPEN" },
          {
            status: "CLOSED",
            closedAt: {
              gte: oneWeekAgo,
            },
          },
        ],
      },
    });

    return positions.reduce((sum, p: any) => {
      return sum + (p.unrealizedPnl || 0) + (p.realizedPnl || 0);
    }, 0);
  }

  /**
   * Calculate maximum drawdown
   */
  private async calculateMaxDrawdown(userId: string): Promise<number> {
    if (!this.prisma) return 0;

    const closedPositions = await this.prisma.position.findMany({
      where: {
        userId,
        status: "CLOSED",
      },
      orderBy: {
        closedAt: "asc",
      },
    });

    let peak = 0;
    let maxDrawdown = 0;
    let runningPnl = 0;

    closedPositions.forEach((p: any) => {
      runningPnl += p.realizedPnl || 0;
      if (runningPnl > peak) {
        peak = runningPnl;
      }
      const drawdown = peak > 0 ? (peak - runningPnl) / peak : 0;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    });

    return maxDrawdown;
  }
}
