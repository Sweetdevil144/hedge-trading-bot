/**
 * AlertService - Send alerts and notifications
 */

import { PrismaClient } from "@prisma/client";

/**
 * Alert type enum
 */
export enum AlertType {
  POSITION_OPENED = "POSITION_OPENED",
  POSITION_CLOSED = "POSITION_CLOSED",
  STOP_LOSS_APPROACHING = "STOP_LOSS_APPROACHING",
  STOP_LOSS_HIT = "STOP_LOSS_HIT",
  TAKE_PROFIT_HIT = "TAKE_PROFIT_HIT",
  DAILY_LOSS_WARNING = "DAILY_LOSS_WARNING",
  DAILY_LOSS_LIMIT = "DAILY_LOSS_LIMIT",
  RISK_LIMIT_WARNING = "RISK_LIMIT_WARNING",
  EMERGENCY_EXIT = "EMERGENCY_EXIT",
  REBALANCE_NEEDED = "REBALANCE_NEEDED",
}

/**
 * Alert severity
 */
export enum AlertSeverity {
  INFO = "INFO",
  WARNING = "WARNING",
  ERROR = "ERROR",
  CRITICAL = "CRITICAL",
}

/**
 * Alert interface
 */
export interface Alert {
  type: AlertType;
  severity: AlertSeverity;
  userId: string;
  message: string;
  metadata?: Record<string, any>;
  timestamp: Date;
}

/**
 * Alert configuration
 */
export interface AlertConfig {
  stopLossWarningThreshold: number; // -8% default
  dailyLossWarningThreshold: number; // -5% default
  dailyLossLimit: number; // -10% default
  enableTelegram: boolean;
  enableConsole: boolean;
}

/**
 * AlertService - Send trading alerts and notifications
 */
export class AlertService {
  private prisma: PrismaClient;
  private config: AlertConfig;
  private telegramBot?: any; // Reference to Telegram bot (optional)

  constructor(prisma: PrismaClient, telegramBot?: any, config?: Partial<AlertConfig>) {
    this.prisma = prisma;
    this.telegramBot = telegramBot;
    this.config = {
      stopLossWarningThreshold: -0.08, // -8%
      dailyLossWarningThreshold: -0.05, // -5%
      dailyLossLimit: -0.1, // -10%
      enableTelegram: true,
      enableConsole: true,
      ...config,
    };
  }

  /**
   * Send an alert
   * Routes alert to appropriate channels (Telegram, console, database)
   */
  async sendAlert(alert: Alert): Promise<void> {
    try {
      // Log to console if enabled
      if (this.config.enableConsole) {
        this.logToConsole(alert);
      }

      // Send to Telegram if enabled and bot available
      if (this.config.enableTelegram && this.telegramBot) {
        await this.sendToTelegram(alert);
      }

      // Store in database for audit trail
      await this.storeAlert(alert);
    } catch (error) {
      console.error("Error sending alert:", error);
      // Don't throw - alerts should never break the main flow
    }
  }

  /**
   * Alert when position P&L approaching stop-loss (-8%)
   */
  async alertStopLossApproaching(userId: string, positionId: string, currentPnL: number, entryValue: number): Promise<void> {
    const pnlPercent = (currentPnL / entryValue) * 100;

    await this.sendAlert({
      type: AlertType.STOP_LOSS_APPROACHING,
      severity: AlertSeverity.WARNING,
      userId,
      message: `⚠️ Position ${positionId} approaching stop-loss: ${pnlPercent.toFixed(2)}%`,
      metadata: {
        positionId,
        currentPnL,
        pnlPercent,
        stopLossThreshold: this.config.stopLossWarningThreshold * 100,
      },
      timestamp: new Date(),
    });
  }

  /**
   * Alert when stop-loss is hit
   */
  async alertStopLossHit(userId: string, positionId: string, finalPnL: number): Promise<void> {
    await this.sendAlert({
      type: AlertType.STOP_LOSS_HIT,
      severity: AlertSeverity.ERROR,
      userId,
      message: `🛑 Stop-loss triggered for position ${positionId}: ${finalPnL.toFixed(2)} USDC loss`,
      metadata: {
        positionId,
        finalPnL,
      },
      timestamp: new Date(),
    });
  }

  /**
   * Alert when take-profit is hit
   */
  async alertTakeProfitHit(userId: string, positionId: string, finalPnL: number): Promise<void> {
    await this.sendAlert({
      type: AlertType.TAKE_PROFIT_HIT,
      severity: AlertSeverity.INFO,
      userId,
      message: `🎯 Take-profit hit for position ${positionId}: +${finalPnL.toFixed(2)} USDC profit`,
      metadata: {
        positionId,
        finalPnL,
      },
      timestamp: new Date(),
    });
  }

  /**
   * Alert when daily loss exceeds threshold (-5%)
   */
  async alertDailyLossWarning(userId: string, dayPnL: number, portfolioValue: number): Promise<void> {
    const lossPercent = (dayPnL / portfolioValue) * 100;

    await this.sendAlert({
      type: AlertType.DAILY_LOSS_WARNING,
      severity: AlertSeverity.WARNING,
      userId,
      message: `⚠️ Daily loss warning: ${lossPercent.toFixed(2)}% (${dayPnL.toFixed(2)} USDC)`,
      metadata: {
        dayPnL,
        portfolioValue,
        lossPercent,
        threshold: this.config.dailyLossWarningThreshold * 100,
      },
      timestamp: new Date(),
    });
  }

  /**
   * Alert when daily loss limit exceeded (-10%)
   */
  async alertDailyLossLimit(userId: string, dayPnL: number, portfolioValue: number): Promise<void> {
    const lossPercent = (dayPnL / portfolioValue) * 100;

    await this.sendAlert({
      type: AlertType.DAILY_LOSS_LIMIT,
      severity: AlertSeverity.CRITICAL,
      userId,
      message: `🚨 DAILY LOSS LIMIT EXCEEDED: ${lossPercent.toFixed(2)}% (${dayPnL.toFixed(2)} USDC) - Trading paused`,
      metadata: {
        dayPnL,
        portfolioValue,
        lossPercent,
        limit: this.config.dailyLossLimit * 100,
      },
      timestamp: new Date(),
    });
  }

  /**
   * Alert when position opened successfully
   */
  async alertPositionOpened(
    userId: string,
    positionId: string,
    token: string,
    amount: number,
    entryPrice: number,
  ): Promise<void> {
    await this.sendAlert({
      type: AlertType.POSITION_OPENED,
      severity: AlertSeverity.INFO,
      userId,
      message: `✅ Position opened: ${amount} ${token} at ${entryPrice.toFixed(4)} USDC`,
      metadata: {
        positionId,
        token,
        amount,
        entryPrice,
        totalValue: amount * entryPrice,
      },
      timestamp: new Date(),
    });
  }

  /**
   * Alert when position closed
   */
  async alertPositionClosed(
    userId: string,
    positionId: string,
    token: string,
    pnl: number,
    roi: number,
  ): Promise<void> {
    const emoji = pnl >= 0 ? "💰" : "📉";
    const sign = pnl >= 0 ? "+" : "";

    await this.sendAlert({
      type: AlertType.POSITION_CLOSED,
      severity: pnl >= 0 ? AlertSeverity.INFO : AlertSeverity.WARNING,
      userId,
      message: `${emoji} Position closed: ${token} | P&L: ${sign}${pnl.toFixed(2)} USDC (${sign}${roi.toFixed(2)}%)`,
      metadata: {
        positionId,
        token,
        pnl,
        roi,
      },
      timestamp: new Date(),
    });
  }

  /**
   * Alert when emergency exit initiated
   */
  async alertEmergencyExit(userId: string, reason: string, positionsCount: number): Promise<void> {
    await this.sendAlert({
      type: AlertType.EMERGENCY_EXIT,
      severity: AlertSeverity.CRITICAL,
      userId,
      message: `🚨 EMERGENCY EXIT INITIATED: ${reason} - Closing ${positionsCount} positions`,
      metadata: {
        reason,
        positionsCount,
      },
      timestamp: new Date(),
    });
  }

  /**
   * Alert when rebalance needed
   */
  async alertRebalanceNeeded(userId: string, positionId: string, currentRatio: number, targetRatio: number): Promise<void> {
    const drift = Math.abs(currentRatio - targetRatio) / targetRatio;

    await this.sendAlert({
      type: AlertType.REBALANCE_NEEDED,
      severity: AlertSeverity.WARNING,
      userId,
      message: `⚖️ Rebalance needed for position ${positionId}: Ratio drift ${(drift * 100).toFixed(2)}%`,
      metadata: {
        positionId,
        currentRatio,
        targetRatio,
        drift,
      },
      timestamp: new Date(),
    });
  }

  /**
   * Alert when risk limit warning
   */
  async alertRiskLimitWarning(userId: string, message: string, metadata?: Record<string, any>): Promise<void> {
    await this.sendAlert({
      type: AlertType.RISK_LIMIT_WARNING,
      severity: AlertSeverity.WARNING,
      userId,
      message: `⚠️ Risk Warning: ${message}`,
      metadata,
      timestamp: new Date(),
    });
  }

  /**
   * Check position for alerts
   * Checks if position needs any alerts (stop-loss approaching, etc.)
   */
  async checkPositionAlerts(userId: string, positionId: string): Promise<void> {
    try {
      const position = await this.prisma.position.findUnique({
        where: { id: positionId },
      });

      if (!position) return;

      const p: any = position;
      const entryValue = p.amount * (p.entryPrice || 1);
      const currentPnL = p.unrealizedPnl || 0;

      if (entryValue > 0) {
        const pnlPercent = currentPnL / entryValue;

        // Check if approaching stop-loss (-8%)
        if (pnlPercent <= this.config.stopLossWarningThreshold && pnlPercent > -0.1) {
          await this.alertStopLossApproaching(userId, positionId, currentPnL, entryValue);
        }

        // Check if stop-loss hit (-10%)
        if (pnlPercent <= -0.1) {
          await this.alertStopLossHit(userId, positionId, currentPnL);
        }

        // Check if take-profit hit (+5%)
        if (pnlPercent >= 0.05) {
          await this.alertTakeProfitHit(userId, positionId, currentPnL);
        }
      }
    } catch (error) {
      console.error(`Error checking alerts for position ${positionId}:`, error);
    }
  }

  /**
   * Check portfolio for alerts
   * Checks daily loss limits and other portfolio-level alerts
   */
  async checkPortfolioAlerts(userId: string): Promise<void> {
    try {
      // Calculate daily P&L
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

      const dayPnL = positions.reduce((sum, p: any) => {
        return sum + (p.unrealizedPnl || 0) + (p.realizedPnl || 0);
      }, 0);

      // Calculate portfolio value
      const openPositions = positions.filter((p) => p.status === "OPEN");
      const portfolioValue = openPositions.reduce((sum, p: any) => {
        return sum + p.amount * (p.currentPrice || p.entryPrice || 1);
      }, 0);

      if (portfolioValue > 0) {
        const dayLossPercent = dayPnL / portfolioValue;

        // Check daily loss warning (-5%)
        if (dayLossPercent <= this.config.dailyLossWarningThreshold && dayLossPercent > this.config.dailyLossLimit) {
          await this.alertDailyLossWarning(userId, dayPnL, portfolioValue);
        }

        // Check daily loss limit (-10%)
        if (dayLossPercent <= this.config.dailyLossLimit) {
          await this.alertDailyLossLimit(userId, dayPnL, portfolioValue);
        }
      }
    } catch (error) {
      console.error(`Error checking portfolio alerts for user ${userId}:`, error);
    }
  }

  /**
   * Get recent alerts for user
   */
  async getRecentAlerts(userId: string, limit: number = 10): Promise<Alert[]> {
    try {
      // In production, would query from database
      // For now, return empty array
      return [];
    } catch (error) {
      console.error("Error getting recent alerts:", error);
      return [];
    }
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Log alert to console
   */
  private logToConsole(alert: Alert): void {
    const timestamp = alert.timestamp.toISOString();
    const severityEmoji = {
      INFO: "ℹ️",
      WARNING: "⚠️",
      ERROR: "❌",
      CRITICAL: "🚨",
    }[alert.severity];

    console.log(`[${timestamp}] ${severityEmoji} ${alert.message}`);

    if (alert.metadata) {
      console.log("  Metadata:", JSON.stringify(alert.metadata, null, 2));
    }
  }

  /**
   * Send alert to Telegram
   */
  private async sendToTelegram(alert: Alert): Promise<void> {
    if (!this.telegramBot) return;

    try {
      // Format message for Telegram
      let message = `${alert.message}\n`;

      if (alert.metadata) {
        message += "\n*Details:*\n";
        Object.entries(alert.metadata).forEach(([key, value]) => {
          message += `• ${key}: ${value}\n`;
        });
      }

      // Get user's Telegram chat ID from database
      const user = await this.prisma.user.findUnique({
        where: { id: alert.userId },
      });

      if (user && (user as any).telegramChatId) {
        // Send message via Telegram bot
        // Note: Actual implementation would depend on Telegram bot setup
        // This is a placeholder showing the concept
        console.log(`Would send to Telegram chat ${(user as any).telegramChatId}:`, message);
      }
    } catch (error) {
      console.error("Error sending to Telegram:", error);
    }
  }

  /**
   * Store alert in database for audit trail
   */
  private async storeAlert(alert: Alert): Promise<void> {
    try {
      // Store alert in database
      // In production, would have an Alert table
      // For now, just log
      console.log("Alert stored:", {
        type: alert.type,
        severity: alert.severity,
        userId: alert.userId,
        timestamp: alert.timestamp,
      });
    } catch (error) {
      console.error("Error storing alert:", error);
    }
  }
}
