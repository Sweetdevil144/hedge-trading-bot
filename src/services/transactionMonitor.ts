/**
 * TransactionMonitor - Monitor and track blockchain transactions
 * Prompt_3 Implementation
 */

import { Connection, PublicKey, ConfirmedSignatureInfo } from "@solana/web3.js";
import { PrismaClient, TransactionStatus, TransactionType } from "@prisma/client";
import { getConnection } from "../utils/constants";
import { TransactionTimeoutError, TransactionConfirmationError } from "../utils/errors";

/**
 * Transaction tracking data
 */
export interface TransactionTrackingData {
  signature: string;
  userId: string;
  transactionType: TransactionType;
  fromToken?: string;
  toToken?: string;
  fromAmount?: number;
  toAmount?: number;
  positionId?: string;
  metadata?: any;
}

/**
 * Transaction status result
 */
export interface TransactionStatusResult {
  signature: string;
  status: TransactionStatus;
  confirmations: number;
  blockTime?: Date;
  slot?: bigint;
  fee?: number;
  error?: string;
}

/**
 * Transaction Monitor Service
 * Tracks transaction lifecycle and stores in database
 */
export class TransactionMonitor {
  private connection: Connection;
  private prisma: PrismaClient;
  private monitoringInterval: number = 2000; // 2 seconds
  private maxMonitoringTime: number = 60000; // 60 seconds
  private activeMonitors: Map<string, NodeJS.Timeout>;

  constructor(prisma: PrismaClient, connection?: Connection) {
    this.prisma = prisma;
    this.connection = connection || getConnection();
    this.activeMonitors = new Map();
  }

  /**
   * Create and start monitoring a transaction
   */
  async trackTransaction(data: TransactionTrackingData): Promise<string> {
    try {
      // Create transaction record in database
      const transaction = await this.prisma.transaction.create({
        data: {
          signature: data.signature,
          userId: data.userId,
          transactionType: data.transactionType,
          status: "PENDING",
          fromToken: data.fromToken,
          toToken: data.toToken,
          fromAmount: data.fromAmount,
          toAmount: data.toAmount,
          positionId: data.positionId,
          metadata: data.metadata,
        },
      });

      console.log(`Tracking transaction: ${data.signature}`);

      // Start monitoring in background
      this.startMonitoring(data.signature);

      return transaction.id;
    } catch (error: any) {
      console.error("Error creating transaction record:", error);
      throw error;
    }
  }

  /**
   * Start monitoring a transaction for status updates
   */
  private startMonitoring(signature: string): void {
    // Don't start if already monitoring
    if (this.activeMonitors.has(signature)) {
      console.log(`Already monitoring transaction: ${signature}`);
      return;
    }

    const startTime = Date.now();

    const monitor = setInterval(async () => {
      try {
        const elapsed = Date.now() - startTime;

        // Stop monitoring after max time
        if (elapsed > this.maxMonitoringTime) {
          console.warn(`Transaction monitoring timeout: ${signature}`);
          await this.updateTransactionStatus(signature, "FAILED", {
            error: "Monitoring timeout - transaction may still confirm",
          });
          this.stopMonitoring(signature);
          return;
        }

        // Check transaction status
        const status = await this.checkTransactionStatus(signature);

        if (status.status === "CONFIRMED") {
          console.log(`Transaction confirmed: ${signature}`);
          await this.updateTransactionStatus(signature, "CONFIRMED", {
            blockTime: status.blockTime,
            slot: status.slot,
            fee: status.fee,
          });
          this.stopMonitoring(signature);
        } else if (status.status === "FAILED") {
          console.error(`Transaction failed: ${signature} - ${status.error}`);
          await this.updateTransactionStatus(signature, "FAILED", {
            error: status.error,
          });
          this.stopMonitoring(signature);
        }
        // If still pending, continue monitoring
      } catch (error: any) {
        console.error(`Error monitoring transaction ${signature}:`, error);
        // Don't stop monitoring on temporary errors
      }
    }, this.monitoringInterval);

    this.activeMonitors.set(signature, monitor);
  }

  /**
   * Stop monitoring a transaction
   */
  private stopMonitoring(signature: string): void {
    const monitor = this.activeMonitors.get(signature);
    if (monitor) {
      clearInterval(monitor);
      this.activeMonitors.delete(signature);
      console.log(`Stopped monitoring transaction: ${signature}`);
    }
  }

  /**
   * Check transaction status on Solana blockchain
   */
  async checkTransactionStatus(signature: string): Promise<TransactionStatusResult> {
    try {
      // Get signature status
      const statusResponse = await this.connection.getSignatureStatus(signature, {
        searchTransactionHistory: true,
      });

      if (!statusResponse || !statusResponse.value) {
        return {
          signature,
          status: "PENDING",
          confirmations: 0,
        };
      }

      const status = statusResponse.value;

      // Check if transaction failed
      if (status.err) {
        return {
          signature,
          status: "FAILED",
          confirmations: status.confirmations || 0,
          error: JSON.stringify(status.err),
        };
      }

      // Check confirmation status
      if (
        status.confirmationStatus === "confirmed" ||
        status.confirmationStatus === "finalized"
      ) {
        // Get transaction details for more info
        const txDetails = await this.connection.getTransaction(signature, {
          maxSupportedTransactionVersion: 0,
        });

        return {
          signature,
          status: "CONFIRMED",
          confirmations: status.confirmations || 0,
          blockTime: txDetails?.blockTime ? new Date(txDetails.blockTime * 1000) : undefined,
          slot: txDetails?.slot ? BigInt(txDetails.slot) : undefined,
          fee: txDetails?.meta?.fee ? txDetails.meta.fee / 1_000_000_000 : undefined, // Convert to SOL
        };
      }

      // Still pending
      return {
        signature,
        status: "PENDING",
        confirmations: status.confirmations || 0,
      };
    } catch (error: any) {
      console.error(`Error checking transaction status for ${signature}:`, error);

      // If transaction not found, it's still pending
      if (error.message?.includes("not found")) {
        return {
          signature,
          status: "PENDING",
          confirmations: 0,
        };
      }

      throw error;
    }
  }

  /**
   * Update transaction status in database
   */
  private async updateTransactionStatus(
    signature: string,
    status: TransactionStatus,
    data: {
      blockTime?: Date;
      slot?: bigint;
      fee?: number;
      error?: string;
    },
  ): Promise<void> {
    try {
      await this.prisma.transaction.update({
        where: { signature },
        data: {
          status,
          blockTime: data.blockTime,
          slot: data.slot,
          fee: data.fee,
          errorMessage: data.error,
        },
      });
    } catch (error: any) {
      console.error(`Error updating transaction ${signature}:`, error);
      throw error;
    }
  }

  /**
   * Get transaction by signature
   */
  async getTransaction(signature: string) {
    return await this.prisma.transaction.findUnique({
      where: { signature },
    });
  }

  /**
   * Get all transactions for a user
   */
  async getUserTransactions(
    userId: string,
    options?: {
      limit?: number;
      offset?: number;
      status?: TransactionStatus;
      type?: TransactionType;
    },
  ) {
    const where: any = { userId };

    if (options?.status) {
      where.status = options.status;
    }

    if (options?.type) {
      where.transactionType = options.type;
    }

    return await this.prisma.transaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: options?.limit || 50,
      skip: options?.offset || 0,
    });
  }

  /**
   * Get recent transactions
   */
  async getRecentTransactions(limit: number = 20) {
    return await this.prisma.transaction.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  /**
   * Calculate effective execution price for a transaction
   */
  calculateExecutionPrice(transaction: {
    fromAmount?: number | null;
    toAmount?: number | null;
    fromToken?: string | null;
    toToken?: string | null;
  }): number | null {
    if (!transaction.fromAmount || !transaction.toAmount) {
      return null;
    }

    // Price is how much of toToken you get per unit of fromToken
    return transaction.toAmount / transaction.fromAmount;
  }

  /**
   * Get transaction statistics for a user
   */
  async getTransactionStats(userId: string) {
    const transactions = await this.prisma.transaction.findMany({
      where: { userId },
    });

    const stats = {
      total: transactions.length,
      confirmed: transactions.filter((t) => t.status === "CONFIRMED").length,
      pending: transactions.filter((t) => t.status === "PENDING").length,
      failed: transactions.filter((t) => t.status === "FAILED").length,
      totalFees: transactions.reduce((sum, t) => sum + (t.fee || 0), 0),
      avgFee: 0,
      successRate: 0,
    };

    if (stats.total > 0) {
      stats.avgFee = stats.totalFees / stats.total;
      stats.successRate = (stats.confirmed / stats.total) * 100;
    }

    return stats;
  }

  /**
   * Wait for transaction confirmation with timeout
   */
  async waitForConfirmation(
    signature: string,
    timeoutMs: number = 30000,
  ): Promise<TransactionStatusResult> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.checkTransactionStatus(signature);

      if (status.status === "CONFIRMED") {
        return status;
      }

      if (status.status === "FAILED") {
        throw new TransactionConfirmationError(
          `Transaction failed: ${status.error}`,
          signature,
          status.error || "Unknown error",
        );
      }

      // Wait 1 second before checking again
      await this.sleep(1000);
    }

    throw new TransactionTimeoutError(
      "Transaction confirmation timeout",
      signature,
      timeoutMs,
    );
  }

  /**
   * Cleanup - stop all active monitors
   */
  cleanup(): void {
    console.log(`Cleaning up ${this.activeMonitors.size} active transaction monitors`);
    this.activeMonitors.forEach((monitor, signature) => {
      this.stopMonitoring(signature);
    });
  }

  /**
   * Get count of active monitors
   */
  getActiveMonitorCount(): number {
    return this.activeMonitors.size;
  }

  /**
   * Set monitoring interval (for testing)
   */
  setMonitoringInterval(ms: number): void {
    this.monitoringInterval = ms;
  }

  /**
   * Set max monitoring time (for testing)
   */
  setMaxMonitoringTime(ms: number): void {
    this.maxMonitoringTime = ms;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Export singleton instance
 */
export function createTransactionMonitor(prisma: PrismaClient): TransactionMonitor {
  return new TransactionMonitor(prisma);
}
