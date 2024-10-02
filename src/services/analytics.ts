/**
 * AnalyticsService - Portfolio analytics and performance tracking
 * Prompt_5 Implementation
 */

import { PrismaClient } from "@prisma/client";

/**
 * Portfolio summary interface
 */
export interface PortfolioSummary {
  totalValue: number;
  totalPnL: number;
  dayPnL: number;
  weekPnL: number;
  monthPnL: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  openPositions: Position[];
  closedPositions: Position[];
}

/**
 * Position metrics interface
 */
export interface PositionMetrics {
  unrealizedPnL: number;
  realizedPnL: number;
  roi: number;
  holdingPeriod: number;
  totalFees: number;
}

/**
 * Trade interface
 */
export interface Trade {
  id: string;
  userId: string;
  type: string;
  token: string;
  amount: number;
  entryPrice: number;
  exitPrice?: number;
  pnl: number;
  fees: number;
  timestamp: Date;
  closedAt?: Date;
  status: string;
}

/**
 * Position interface (simplified for analytics)
 */
export interface Position {
  id: string;
  userId: string;
  tokenMint: string;
  amount: number;
  entryPrice: number;
  currentPrice?: number;
  unrealizedPnl: number;
  realizedPnl: number;
  status: string;
  createdAt: Date;
  closedAt?: Date;
  fees?: number;
}

/**
 * AnalyticsService - Calculate portfolio and position metrics
 */
export class AnalyticsService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Get portfolio summary
   * Comprehensive portfolio overview with P&L and statistics
   */
  async getPortfolioSummary(userId: string): Promise<PortfolioSummary> {
    try {
      // Get all positions
      const openPositions = await this.prisma.position.findMany({
        where: {
          userId,
          status: "OPEN",
        },
      });

      const closedPositions = await this.prisma.position.findMany({
        where: {
          userId,
          status: "CLOSED",
        },
        orderBy: {
          closedAt: "desc",
        },
      });

      // Calculate total value (sum of open positions)
      const totalValue = openPositions.reduce((sum, p: any) => {
        const value = p.amount * (p.currentPrice || p.entryPrice || 1);
        return sum + value;
      }, 0);

      // Calculate total P&L
      const totalUnrealizedPnl = openPositions.reduce((sum, p: any) => sum + (p.unrealizedPnl || 0), 0);
      const totalRealizedPnl = closedPositions.reduce((sum, p: any) => sum + (p.realizedPnl || 0), 0);
      const totalPnL = totalUnrealizedPnl + totalRealizedPnl;

      // Calculate day P&L (last 24 hours)
      const dayPnL = await this.calculatePeriodPnL(userId, 1);

      // Calculate week P&L (last 7 days)
      const weekPnL = await this.calculatePeriodPnL(userId, 7);

      // Calculate month P&L (last 30 days)
      const monthPnL = await this.calculatePeriodPnL(userId, 30);

      // Calculate win rate
      const wins = closedPositions.filter((p: any) => (p.realizedPnl || 0) > 0);
      const losses = closedPositions.filter((p: any) => (p.realizedPnl || 0) < 0);
      const winRate = closedPositions.length > 0 ? wins.length / closedPositions.length : 0;

      // Calculate average win/loss
      const avgWin = wins.length > 0 ? wins.reduce((sum, p: any) => sum + (p.realizedPnl || 0), 0) / wins.length : 0;
      const avgLoss =
        losses.length > 0 ? losses.reduce((sum, p: any) => sum + (p.realizedPnl || 0), 0) / losses.length : 0;

      // Map to Position interface
      const mappedOpenPositions: Position[] = openPositions.map((p: any) => ({
        id: p.id,
        userId: p.userId,
        tokenMint: p.tokenMint || "UNKNOWN",
        amount: p.amount || 0,
        entryPrice: p.entryPrice || 0,
        currentPrice: p.currentPrice,
        unrealizedPnl: p.unrealizedPnl || 0,
        realizedPnl: p.realizedPnl || 0,
        status: p.status,
        createdAt: p.createdAt,
        closedAt: p.closedAt,
        fees: p.fees,
      }));

      const mappedClosedPositions: Position[] = closedPositions.map((p: any) => ({
        id: p.id,
        userId: p.userId,
        tokenMint: p.tokenMint || "UNKNOWN",
        amount: p.amount || 0,
        entryPrice: p.entryPrice || 0,
        currentPrice: p.currentPrice,
        unrealizedPnl: p.unrealizedPnl || 0,
        realizedPnl: p.realizedPnl || 0,
        status: p.status,
        createdAt: p.createdAt,
        closedAt: p.closedAt,
        fees: p.fees,
      }));

      return {
        totalValue,
        totalPnL,
        dayPnL,
        weekPnL,
        monthPnL,
        winRate,
        avgWin,
        avgLoss,
        openPositions: mappedOpenPositions,
        closedPositions: mappedClosedPositions,
      };
    } catch (error) {
      console.error("Error getting portfolio summary:", error);
      throw error;
    }
  }

  /**
   * Calculate position-specific metrics
   * Returns detailed metrics for a single position
   */
  async getPositionMetrics(positionId: string): Promise<PositionMetrics> {
    try {
      const position = await this.prisma.position.findUnique({
        where: { id: positionId },
      });

      if (!position) {
        throw new Error(`Position ${positionId} not found`);
      }

      const p: any = position;

      // Calculate unrealized P&L
      const unrealizedPnL = p.unrealizedPnl || 0;

      // Calculate realized P&L
      const realizedPnL = p.realizedPnl || 0;

      // Calculate ROI (Return on Investment)
      const investedAmount = p.amount * (p.entryPrice || 1);
      const roi = investedAmount > 0 ? ((unrealizedPnL + realizedPnL) / investedAmount) * 100 : 0;

      // Calculate holding period (in hours)
      const createdAt = p.createdAt || new Date();
      const closedAt = p.closedAt || new Date();
      const holdingPeriod = (closedAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60); // hours

      // Calculate total fees
      const totalFees = p.fees || 0;

      return {
        unrealizedPnL,
        realizedPnL,
        roi,
        holdingPeriod,
        totalFees,
      };
    } catch (error) {
      console.error(`Error getting metrics for position ${positionId}:`, error);
      throw error;
    }
  }

  /**
   * Get trade history
   * Returns all trades for a user within a date range
   */
  async getTradeHistory(userId: string, fromDate?: Date, toDate?: Date): Promise<Trade[]> {
    try {
      const whereClause: any = {
        userId,
      };

      // Add date filters if provided
      if (fromDate || toDate) {
        whereClause.createdAt = {};
        if (fromDate) {
          whereClause.createdAt.gte = fromDate;
        }
        if (toDate) {
          whereClause.createdAt.lte = toDate;
        }
      }

      const positions = await this.prisma.position.findMany({
        where: whereClause,
        orderBy: {
          createdAt: "desc",
        },
      });

      // Map positions to Trade interface
      const trades: Trade[] = positions.map((p: any) => ({
        id: p.id,
        userId: p.userId,
        type: p.positionType || "UNKNOWN",
        token: p.tokenMint || "UNKNOWN",
        amount: p.amount || 0,
        entryPrice: p.entryPrice || 0,
        exitPrice: p.currentPrice,
        pnl: (p.realizedPnl || 0) + (p.unrealizedPnl || 0),
        fees: p.fees || 0,
        timestamp: p.createdAt,
        closedAt: p.closedAt,
        status: p.status,
      }));

      return trades;
    } catch (error) {
      console.error("Error getting trade history:", error);
      throw error;
    }
  }

  /**
   * Get daily snapshots (for charting)
   * Returns portfolio value snapshots for the last N days
   */
  async getDailySnapshots(userId: string, days: number = 30): Promise<Array<{ date: Date; value: number; pnl: number }>> {
    try {
      const snapshots: Array<{ date: Date; value: number; pnl: number }> = [];
      const today = new Date();

      for (let i = days; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        date.setHours(0, 0, 0, 0);

        const endDate = new Date(date);
        endDate.setHours(23, 59, 59, 999);

        // Get all positions that existed on this day
        const positions = await this.prisma.position.findMany({
          where: {
            userId,
            createdAt: {
              lte: endDate,
            },
            OR: [
              { status: "OPEN" },
              {
                closedAt: {
                  gte: date,
                },
              },
            ],
          },
        });

        // Calculate portfolio value and P&L for this day
        const value = positions.reduce((sum, p: any) => {
          const posValue = p.amount * (p.currentPrice || p.entryPrice || 1);
          return sum + posValue;
        }, 0);

        const pnl = positions.reduce((sum, p: any) => {
          return sum + (p.unrealizedPnl || 0) + (p.realizedPnl || 0);
        }, 0);

        snapshots.push({ date, value, pnl });
      }

      return snapshots;
    } catch (error) {
      console.error("Error getting daily snapshots:", error);
      throw error;
    }
  }

  /**
   * Get weekly summary
   * Returns aggregated stats for the week
   */
  async getWeeklySummary(userId: string): Promise<{
    totalPnL: number;
    winRate: number;
    bestTrade: Trade | null;
    worstTrade: Trade | null;
    totalTrades: number;
  }> {
    try {
      const oneWeekAgo = new Date();
      oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

      const trades = await this.getTradeHistory(userId, oneWeekAgo);

      // Calculate total P&L
      const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);

      // Calculate win rate
      const closedTrades = trades.filter((t) => t.status === "CLOSED");
      const wins = closedTrades.filter((t) => t.pnl > 0);
      const winRate = closedTrades.length > 0 ? wins.length / closedTrades.length : 0;

      // Find best and worst trades
      let bestTrade: Trade | null = null;
      let worstTrade: Trade | null = null;

      closedTrades.forEach((trade) => {
        if (!bestTrade || trade.pnl > bestTrade.pnl) {
          bestTrade = trade;
        }
        if (!worstTrade || trade.pnl < worstTrade.pnl) {
          worstTrade = trade;
        }
      });

      return {
        totalPnL,
        winRate,
        bestTrade,
        worstTrade,
        totalTrades: trades.length,
      };
    } catch (error) {
      console.error("Error getting weekly summary:", error);
      throw error;
    }
  }

  /**
   * Export trades to CSV format
   * Returns CSV string of all trades
   */
  async exportToCSV(userId: string, fromDate?: Date, toDate?: Date): Promise<string> {
    try {
      const trades = await this.getTradeHistory(userId, fromDate, toDate);

      // CSV header
      let csv = "ID,Date,Type,Token,Amount,Entry Price,Exit Price,P&L,Fees,Status\n";

      // CSV rows
      trades.forEach((trade) => {
        csv += `${trade.id},`;
        csv += `${trade.timestamp.toISOString()},`;
        csv += `${trade.type},`;
        csv += `${trade.token},`;
        csv += `${trade.amount},`;
        csv += `${trade.entryPrice},`;
        csv += `${trade.exitPrice || ""},`;
        csv += `${trade.pnl},`;
        csv += `${trade.fees},`;
        csv += `${trade.status}\n`;
      });

      return csv;
    } catch (error) {
      console.error("Error exporting to CSV:", error);
      throw error;
    }
  }

  /**
   * Export trades to JSON format
   * Returns JSON string of all trades
   */
  async exportToJSON(userId: string, fromDate?: Date, toDate?: Date): Promise<string> {
    try {
      const trades = await this.getTradeHistory(userId, fromDate, toDate);
      return JSON.stringify(trades, null, 2);
    } catch (error) {
      console.error("Error exporting to JSON:", error);
      throw error;
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Calculate P&L for a specific period
   */
  private async calculatePeriodPnL(userId: string, days: number): Promise<number> {
    const periodAgo = new Date();
    periodAgo.setDate(periodAgo.getDate() - days);

    const positions = await this.prisma.position.findMany({
      where: {
        userId,
        OR: [
          { status: "OPEN" },
          {
            status: "CLOSED",
            closedAt: {
              gte: periodAgo,
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
   * Calculate portfolio statistics
   * Returns detailed statistics for analysis
   */
  async getPortfolioStatistics(userId: string): Promise<{
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    profitFactor: number;
    avgWinAmount: number;
    avgLossAmount: number;
    largestWin: number;
    largestLoss: number;
    avgHoldingPeriod: number;
    totalFees: number;
  }> {
    try {
      const closedPositions = await this.prisma.position.findMany({
        where: {
          userId,
          status: "CLOSED",
        },
      });

      const wins = closedPositions.filter((p: any) => (p.realizedPnl || 0) > 0);
      const losses = closedPositions.filter((p: any) => (p.realizedPnl || 0) < 0);

      const totalWinAmount = wins.reduce((sum, p: any) => sum + (p.realizedPnl || 0), 0);
      const totalLossAmount = Math.abs(losses.reduce((sum, p: any) => sum + (p.realizedPnl || 0), 0));

      const profitFactor = totalLossAmount > 0 ? totalWinAmount / totalLossAmount : totalWinAmount > 0 ? Infinity : 0;

      const avgWinAmount = wins.length > 0 ? totalWinAmount / wins.length : 0;
      const avgLossAmount = losses.length > 0 ? -totalLossAmount / losses.length : 0;

      let largestWin = 0;
      let largestLoss = 0;
      let totalHoldingPeriod = 0;
      let totalFees = 0;

      closedPositions.forEach((p: any) => {
        const pnl = p.realizedPnl || 0;
        if (pnl > largestWin) largestWin = pnl;
        if (pnl < largestLoss) largestLoss = pnl;

        // Calculate holding period
        if (p.createdAt && p.closedAt) {
          const holdingMs = p.closedAt.getTime() - p.createdAt.getTime();
          totalHoldingPeriod += holdingMs / (1000 * 60 * 60); // hours
        }

        totalFees += p.fees || 0;
      });

      const avgHoldingPeriod = closedPositions.length > 0 ? totalHoldingPeriod / closedPositions.length : 0;

      return {
        totalTrades: closedPositions.length,
        winningTrades: wins.length,
        losingTrades: losses.length,
        winRate: closedPositions.length > 0 ? wins.length / closedPositions.length : 0,
        profitFactor,
        avgWinAmount,
        avgLossAmount,
        largestWin,
        largestLoss,
        avgHoldingPeriod,
        totalFees,
      };
    } catch (error) {
      console.error("Error getting portfolio statistics:", error);
      throw error;
    }
  }
}
