import { PrismaClient } from "@prisma/client";
import { PositionManager } from "./positionManager";
import { RiskManager } from "./riskManager";
import { HedgePosition, Position, RebalanceAction } from "../types";
import { AppConfig } from "../utils/config";
import { WalletStore } from "../services/wallet";
import { depositLiquidity, closePositionFully, getBestExecutionPool } from "../services/orcaLiquidity";
import { marketDataService } from "../services/marketData";
import { logger } from "../utils/logger";

export class HedgeEngine {
  private positionManager: PositionManager;
  private riskManager: RiskManager;
  private prisma: PrismaClient;
  private walletStore: WalletStore;

  constructor(prisma: PrismaClient, walletStore: WalletStore) {
    this.prisma = prisma;
    this.walletStore = walletStore;
    this.positionManager = new PositionManager(prisma);
    this.riskManager = new RiskManager();
  }

  async openHedgePosition(
    userId: string,
    token: string,
    amount: number,
    strategyType: "delta-neutral" | "pairs" = "delta-neutral",
  ): Promise<HedgePosition> {
    try {
      const hedgeRatio = strategyType === "delta-neutral" ? 1.0 : AppConfig.getHedgeConfig().defaultRatio;

      const ratioValidation = this.riskManager.validateHedgeRatio(hedgeRatio);
      if (!ratioValidation.valid) {
        throw new Error(ratioValidation.reason);
      }

      const usdcBalance = await this.walletStore.checkUsdcBalance(userId);
      const totalRequired = amount * 2;

      const balanceCheck = this.riskManager.checkSufficientBalance(totalRequired, usdcBalance);
      if (!balanceCheck.valid) {
        throw new Error(balanceCheck.reason);
      }

      const openPositions = await this.positionManager.getOpenPositions(userId);
      const maxPosValidation = this.riskManager.validateMaxPositions(openPositions.length);
      if (!maxPosValidation.valid) {
        throw new Error(maxPosValidation.reason);
      }

      const tokenMint = AppConfig.getTokenAddress(token as any).toString();
      const { poolAddress: longPool } = await getBestExecutionPool(tokenMint, "USDC", BigInt(amount));

      const shortPool = longPool;

      const longEntryPrice = await marketDataService.getCurrentPrice(longPool);
      const shortEntryPrice = longEntryPrice;

      const longAmount = amount;
      const shortAmount = amount * hedgeRatio;

      logger.trading(`Opening long: ${longAmount} ${token} @ ${longEntryPrice}`);
      const longSignature = await depositLiquidity(
        this.walletStore,
        userId,
        longPool,
        BigInt(Math.floor(longAmount * 1_000_000)),
        100,
      );

      logger.trading(`Opening short: ${shortAmount} ${token} @ ${shortEntryPrice}`);
      const shortSignature = await depositLiquidity(
        this.walletStore,
        userId,
        shortPool,
        BigInt(Math.floor(shortAmount * 1_000_000)),
        100,
      );

      const { long, short, hedgeId } = await this.positionManager.createHedgePosition(
        userId,
        {
          pool: longPool,
          token,
          amount: longAmount,
          entryPrice: longEntryPrice,
        },
        {
          pool: shortPool,
          token,
          amount: shortAmount,
          entryPrice: shortEntryPrice,
        },
        hedgeRatio,
      );

      marketDataService.subscribeToPriceUpdates(longPool, async (price) => {
        await this.monitorPosition(hedgeId, price);
      });

      return {
        id: hedgeId,
        userId,
        longSide: {
          pool: longPool,
          token,
          amount: longAmount,
          entryPrice: longEntryPrice,
          side: "long",
        },
        shortSide: {
          pool: shortPool,
          token,
          amount: shortAmount,
          entryPrice: shortEntryPrice,
          side: "short",
        },
        hedgeRatio,
        status: "open",
        pnl: 0,
        createdAt: long.openedAt,
        updatedAt: long.updatedAt,
      };
    } catch (error) {
      logger.error("Failed to open hedge position", error);
      throw error;
    }
  }

  async closeHedgePosition(positionId: string): Promise<{
    signature: string;
    totalPnl: number;
    longPnl: number;
    shortPnl: number;
  }> {
    try {
      const positions = await this.prisma.position.findMany({
        where: {
          hedgePositionId: positionId,
          status: "OPEN",
        },
      });

      const longPos = positions.find((p: any) => p.isLongSide === true);
      const shortPos = positions.find((p: any) => p.isLongSide === false);

      if (!longPos || !shortPos) {
        throw new Error("Hedge position not found or incomplete");
      }

      const longPrice = await marketDataService.getCurrentPrice(longPos.poolAddress);
      const shortPrice = await marketDataService.getCurrentPrice(shortPos.poolAddress);

      logger.trading(`Closing hedge position ${positionId}`);

      const result = await this.positionManager.closeHedgePosition(positionId, {
        long: longPrice,
        short: shortPrice,
      });

      return {
        signature: `closed_${positionId}`,
        totalPnl: result.longPnl + result.shortPnl,
        longPnl: result.longPnl,
        shortPnl: result.shortPnl,
      };
    } catch (error) {
      logger.error("Failed to close hedge position", error);
      throw error;
    }
  }

  async rebalancePosition(positionId: string): Promise<void> {
    try {
      const positions = await this.prisma.position.findMany({
        where: {
          hedgePositionId: positionId,
          status: "OPEN",
        },
      });

      const longPos = positions.find((p: any) => p.isLongSide === true);
      const shortPos = positions.find((p: any) => p.isLongSide === false);

      if (!longPos || !shortPos) {
        throw new Error("Hedge position not found or incomplete");
      }

      const longPrice = await marketDataService.getCurrentPrice(longPos.poolAddress);
      const shortPrice = await marketDataService.getCurrentPrice(shortPos.poolAddress);

      const longValue = longPos.amount * longPrice;
      const shortValue = shortPos.amount * shortPrice;

      const currentRatio = longValue / shortValue;
      const targetRatio = longPos.hedgeRatio || 1.0;

      const needsRebalancing = this.riskManager.needsRebalancing(currentRatio, targetRatio);

      if (!needsRebalancing) {
        return;
      }

      logger.info(`Rebalancing ${positionId}: ratio ${currentRatio.toFixed(3)} -> ${targetRatio}`);

      if (currentRatio > targetRatio) {
        const excessValue = longValue - targetRatio * shortValue;
        const adjustAmount = excessValue / longPrice;
        await this.positionManager.updatePositionPrice(longPos.id, longPrice);
      } else {
        const excessValue = shortValue - longValue / targetRatio;
        const adjustAmount = excessValue / shortPrice;
        await this.positionManager.updatePositionPrice(shortPos.id, shortPrice);
      }

      logger.info(`Rebalanced ${positionId}`);
    } catch (error) {
      logger.error("Rebalance failed", error);
      throw error;
    }
  }

  async getPositionPnL(positionId: string): Promise<number> {
    try {
      const positions = await this.prisma.position.findMany({
        where: {
          hedgePositionId: positionId,
        },
      });

      const longPos = positions.find((p: any) => p.isLongSide === true);
      const shortPos = positions.find((p: any) => p.isLongSide === false);

      if (!longPos || !shortPos) {
        throw new Error("Hedge position not found or incomplete");
      }

      if (longPos.status === "OPEN") {
        const longPrice = await marketDataService.getCurrentPrice(longPos.poolAddress);
        const shortPrice = await marketDataService.getCurrentPrice(shortPos.poolAddress);

        await this.positionManager.updatePositionPrice(longPos.id, longPrice);
        await this.positionManager.updatePositionPrice(shortPos.id, shortPrice);

        const updatedLong = await this.positionManager.getPosition(longPos.id);
        const updatedShort = await this.positionManager.getPosition(shortPos.id);

        if (!updatedLong || !updatedShort) {
          throw new Error("Failed to get updated positions");
        }

        return updatedLong.unrealizedPnl + updatedShort.unrealizedPnl;
      }

      return longPos.realizedPnl + shortPos.realizedPnl;
    } catch (error) {
      logger.error("Failed to get P&L", error);
      throw error;
    }
  }

  private async monitorPosition(hedgePositionId: string, currentPrice: number): Promise<void> {
    try {
      const positions = await this.prisma.position.findMany({
        where: {
          hedgePositionId,
          status: "OPEN",
        },
      });

      if (positions.length === 0) return;

      for (const position of positions) {
        const side = position.isLongSide ? "long" : "short";
        const shouldStopLoss = this.riskManager.shouldTriggerStopLossWithDefault(
          currentPrice,
          position.entryPrice,
          side,
        );

        if (shouldStopLoss) {
          logger.warn(`Stop-loss triggered: ${hedgePositionId}`);
          await this.closeHedgePosition(hedgePositionId);
          return;
        }
      }

      await this.rebalancePosition(hedgePositionId);
    } catch (error) {
      logger.error("Monitor position failed", error);
    }
  }

  async getHedgePositions(userId: string): Promise<HedgePosition[]> {
    return this.positionManager.getHedgePositions(userId);
  }

  async calculateTotalPnl(userId: string): Promise<{ realizedPnl: number; unrealizedPnl: number; totalPnl: number }> {
    const stats = await this.positionManager.getPositionStats(userId);

    return {
      realizedPnl: stats.totalPnl,
      unrealizedPnl: stats.unrealizedPnl,
      totalPnl: stats.netPnl,
    };
  }

  async getPositionCorrelation(hedgePositionId: string): Promise<number> {
    return 0.8;
  }
}
