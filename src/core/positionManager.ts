import { PrismaClient } from "@prisma/client";
import { HedgePosition, Position } from "../types";

/**
 * PositionManager - Manages all trading positions including hedge positions
 */
export class PositionManager {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Create a new position
   */
  async createPosition(
    userId: string,
    type: "LONG" | "SHORT" | "HEDGE",
    poolAddress: string,
    tokenMint: string,
    tokenSymbol: string,
    amount: number,
    entryPrice: number,
    hedgePositionId?: string,
    isLongSide?: boolean,
    hedgeRatio?: number,
  ): Promise<any> {
    return this.prisma.position.create({
      data: {
        userId,
        positionType: type,
        poolAddress,
        tokenMint,
        tokenSymbol,
        amount,
        entryPrice,
        currentPrice: entryPrice,
        hedgePositionId,
        isLongSide,
        hedgeRatio,
        status: "OPEN",
      },
    });
  }

  /**
   * Create a hedge position (both long and short sides)
   */
  async createHedgePosition(
    userId: string,
    longPosition: Omit<Position, "side">,
    shortPosition: Omit<Position, "side">,
    hedgeRatio: number,
  ): Promise<{ long: any; short: any; hedgeId: string }> {
    const hedgeId = `hedge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const [long, short] = await Promise.all([
      this.createPosition(
        userId,
        "HEDGE",
        longPosition.pool,
        longPosition.token,
        longPosition.token.split("/")[0], // Extract token symbol
        longPosition.amount,
        longPosition.entryPrice,
        hedgeId,
        true, // isLongSide
        hedgeRatio,
      ),
      this.createPosition(
        userId,
        "HEDGE",
        shortPosition.pool,
        shortPosition.token,
        shortPosition.token.split("/")[0], // Extract token symbol
        shortPosition.amount,
        shortPosition.entryPrice,
        hedgeId,
        false, // isLongSide (short side)
        hedgeRatio,
      ),
    ]);

    return { long, short, hedgeId };
  }

  /**
   * Get all open positions for a user
   */
  async getOpenPositions(userId: string): Promise<any[]> {
    return this.prisma.position.findMany({
      where: {
        userId,
        status: OPEN,
      },
      orderBy: {
        openedAt: "desc",
      },
    });
  }

  /**
   * Get hedge positions for a user
   */
  async getHedgePositions(userId: string): Promise<HedgePosition[]> {
    const positions = await this.prisma.position.findMany({
      where: {
        userId,
        positionType: PositionType.HEDGE,
        status: OPEN,
      },
      orderBy: {
        openedAt: "desc",
      },
    });

    // Group positions by hedgePositionId
    const hedgeMap = new Map<string, any[]>();
    positions.forEach((pos: any) => {
      if (pos.hedgePositionId) {
        const existing = hedgeMap.get(pos.hedgePositionId) || [];
        existing.push(pos);
        hedgeMap.set(pos.hedgePositionId, existing);
      }
    });

    // Convert to HedgePosition format
    const hedgePositions: HedgePosition[] = [];
    hedgeMap.forEach((positions, hedgeId) => {
      const longPos = positions.find((p: any) => p.isLongSide === true);
      const shortPos = positions.find((p: any) => p.isLongSide === false);

      if (longPos && shortPos) {
        hedgePositions.push({
          id: hedgeId,
          userId,
          longSide: {
            pool: longPos.poolAddress,
            token: longPos.tokenSymbol,
            amount: longPos.amount,
            entryPrice: longPos.entryPrice,
            side: "long",
          },
          shortSide: {
            pool: shortPos.poolAddress,
            token: shortPos.tokenSymbol,
            amount: shortPos.amount,
            entryPrice: shortPos.entryPrice,
            side: "short",
          },
          hedgeRatio: longPos.hedgeRatio || 1.0,
          status: longPos.status === OPEN ? "open" : "closed",
          pnl: longPos.realizedPnl + shortPos.realizedPnl,
          createdAt: longPos.openedAt,
          updatedAt: longPos.updatedAt,
          closedAt: longPos.closedAt || undefined,
        });
      }
    });

    return hedgePositions;
  }

  /**
   * Update position price and unrealized PnL
   */
  async updatePositionPrice(positionId: string, currentPrice: number): Promise<any> {
    const position = await this.prisma.position.findUnique({ where: { id: positionId } });

    if (!position) {
      throw new Error("Position not found");
    }

    const priceDiff = currentPrice - position.entryPrice;
    const unrealizedPnl = priceDiff * position.amount;

    return this.prisma.position.update({
      where: { id: positionId },
      data: {
        currentPrice,
        unrealizedPnl,
      },
    });
  }

  /**
   * Close a position
   */
  async closePosition(positionId: string, exitPrice: number): Promise<any> {
    const position = await this.prisma.position.findUnique({ where: { id: positionId } });

    if (!position) {
      throw new Error("Position not found");
    }

    const priceDiff = exitPrice - position.entryPrice;
    const realizedPnl = priceDiff * position.amount - position.fees;

    return this.prisma.position.update({
      where: { id: positionId },
      data: {
        status: CLOSED,
        closedAt: new Date(),
        currentPrice: exitPrice,
        realizedPnl,
        unrealizedPnl: 0,
      },
    });
  }

  /**
   * Close a hedge position (both sides)
   */
  async closeHedgePosition(hedgePositionId: string, prices: { long: number; short: number }) {
    const positions = await this.prisma.position.findMany({
      where: {
        hedgePositionId,
        status: OPEN,
      },
    });

    const longPos = positions.find((p) => p.isLongSide === true);
    const shortPos = positions.find((p) => p.isLongSide === false);

    if (!longPos || !shortPos) {
      throw new Error("Hedge position incomplete");
    }

    await Promise.all([
      this.closePosition(longPos.id, prices.long),
      this.closePosition(shortPos.id, prices.short),
    ]);

    return {
      hedgePositionId,
      longPnl: (prices.long - longPos.entryPrice) * longPos.amount,
      shortPnl: (prices.short - shortPos.entryPrice) * shortPos.amount,
    };
  }

  /**
   * Get position by ID
   */
  async getPosition(positionId: string): Promise<any | null> {
    return this.prisma.position.findUnique({ where: { id: positionId } });
  }

  /**
   * Get position statistics for a user
   */
  async getPositionStats(userId: string) {
    const positions = await this.prisma.position.findMany({
      where: { userId },
    });

    const openPositions = positions.filter((p: any) => p.status === "OPEN");
    const closedPositions = positions.filter((p: any) => p.status === "CLOSED");

    const totalPnl = closedPositions.reduce((sum: number, p: any) => sum + p.realizedPnl, 0);
    const unrealizedPnl = openPositions.reduce((sum: number, p: any) => sum + p.unrealizedPnl, 0);

    return {
      totalPositions: positions.length,
      openPositions: openPositions.length,
      closedPositions: closedPositions.length,
      totalPnl,
      unrealizedPnl,
      netPnl: totalPnl + unrealizedPnl,
    };
  }

  /**
   * Emergency close all open positions for a user
   * Used when risk limits are exceeded or manual emergency closure is needed
   */
  async emergencyCloseAllPositions(
    userId: string,
    currentPrices: Map<string, number>,
  ): Promise<{
    closedCount: number;
    totalPnl: number;
    errors: Array<{ positionId: string; error: string }>;
  }> {
    const openPositions = await this.getOpenPositions(userId);
    const errors: Array<{ positionId: string; error: string }> = [];
    let closedCount = 0;
    let totalPnl = 0;

    console.warn(`EMERGENCY CLOSE: Closing ${openPositions.length} positions for user ${userId}`);

    for (const position of openPositions) {
      try {
        // Get current price for this pool
        const currentPrice = currentPrices.get(position.poolAddress) || position.currentPrice || position.entryPrice;

        // Close the position
        const closedPosition = await this.closePosition(position.id, currentPrice);

        closedCount++;
        totalPnl += closedPosition.realizedPnl;

        console.log(`Closed position ${position.id} at ${currentPrice}, PnL: ${closedPosition.realizedPnl}`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        errors.push({
          positionId: position.id,
          error: errorMessage,
        });
        console.error(`Failed to close position ${position.id}:`, error);
      }
    }

    console.warn(`EMERGENCY CLOSE COMPLETE: ${closedCount}/${openPositions.length} positions closed`);

    return {
      closedCount,
      totalPnl,
      errors,
    };
  }

  /**
   * Emergency close all hedge positions for a user
   * Closes both sides of all hedge positions
   */
  async emergencyCloseAllHedgePositions(
    userId: string,
    currentPrices: Map<string, number>,
  ): Promise<{
    closedCount: number;
    totalPnl: number;
    errors: Array<{ hedgePositionId: string; error: string }>;
  }> {
    const hedgePositions = await this.getHedgePositions(userId);
    const errors: Array<{ hedgePositionId: string; error: string }> = [];
    let closedCount = 0;
    let totalPnl = 0;

    console.warn(`EMERGENCY CLOSE: Closing ${hedgePositions.length} hedge positions for user ${userId}`);

    for (const hedge of hedgePositions) {
      try {
        // Get prices for both sides
        const longPrice =
          currentPrices.get(hedge.longSide.pool) || hedge.longSide.entryPrice;
        const shortPrice =
          currentPrices.get(hedge.shortSide.pool) || hedge.shortSide.entryPrice;

        // Close the hedge position
        const result = await this.closeHedgePosition(hedge.id, {
          long: longPrice,
          short: shortPrice,
        });

        closedCount++;
        totalPnl += result.longPnl + result.shortPnl;

        console.log(
          `Closed hedge position ${hedge.id}, Long PnL: ${result.longPnl}, Short PnL: ${result.shortPnl}`,
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        errors.push({
          hedgePositionId: hedge.id,
          error: errorMessage,
        });
        console.error(`Failed to close hedge position ${hedge.id}:`, error);
      }
    }

    console.warn(
      `EMERGENCY CLOSE COMPLETE: ${closedCount}/${hedgePositions.length} hedge positions closed`,
    );

    return {
      closedCount,
      totalPnl,
      errors,
    };
  }

  /**
   * Close positions that have exceeded stop-loss threshold
   */
  async closePositionsExceedingStopLoss(
    userId: string,
    stopLossPercent: number,
    currentPrices: Map<string, number>,
  ): Promise<{
    closedCount: number;
    totalPnl: number;
  }> {
    const openPositions = await this.getOpenPositions(userId);
    let closedCount = 0;
    let totalPnl = 0;

    for (const position of openPositions) {
      const currentPrice =
        currentPrices.get(position.poolAddress) || position.currentPrice || position.entryPrice;

      const priceDiff = currentPrice - position.entryPrice;
      const percentChange = Math.abs(priceDiff / position.entryPrice);

      // Determine if position should be closed based on side
      let shouldClose = false;

      if (position.isLongSide === true) {
        // Long position: close if price dropped by stopLossPercent
        shouldClose = priceDiff < 0 && percentChange >= stopLossPercent;
      } else if (position.isLongSide === false) {
        // Short position: close if price increased by stopLossPercent
        shouldClose = priceDiff > 0 && percentChange >= stopLossPercent;
      }

      if (shouldClose) {
        try {
          const closedPosition = await this.closePosition(position.id, currentPrice);
          closedCount++;
          totalPnl += closedPosition.realizedPnl;

          console.log(
            `Stop-loss triggered for position ${position.id}: ${percentChange.toFixed(2)}% loss, closed at ${currentPrice}`,
          );
        } catch (error) {
          console.error(`Failed to close position ${position.id} on stop-loss:`, error);
        }
      }
    }

    return {
      closedCount,
      totalPnl,
    };
  }
}
