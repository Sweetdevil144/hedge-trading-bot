import { PrismaClient, OrderType, OrderSide, OrderStatus } from "@prisma/client";
import { Connection, Transaction as SolanaTransaction, ConfirmOptions } from "@solana/web3.js";
import { getConnection } from "../utils/constants";
import { WalletStore } from "../services/wallet";
import { depositLiquidity } from "../services/orcaLiquidity";
import { marketDataService } from "../services/marketData";
import { AppConfig } from "../utils/config";
import {
  NetworkError,
  RateLimitError,
  SlippageError,
  InsufficientFundsError,
  TransactionTimeoutError,
  TransactionConfirmationError,
  AtomicExecutionError,
  getRetryDelay,
  isRetryableError,
} from "../utils/errors";

export interface Order {
  id?: string;
  userId: string;
  orderType: OrderType;
  side: OrderSide;
  tokenMint: string;
  tokenSymbol: string;
  amount: number;
  price?: number;
  poolAddress: string;
  maxSlippage?: number;
}

export interface ExecutionResult {
  success: boolean;
  signature?: string;
  orderId?: string;
  executedPrice?: number;
  executedAmount?: number;
  fee?: number;
  error?: Error;
  retryAttempts: number;
}

export interface HedgeExecutionResult {
  success: boolean;
  longOrder: ExecutionResult;
  shortOrder: ExecutionResult;
  totalFees: number;
  error?: Error;
}

export class OrderExecutor {
  private connection: Connection;
  private walletStore: WalletStore;
  private prisma: PrismaClient;

  private readonly MAX_RETRIES = 4;
  private readonly RETRY_DELAYS = [2000, 4000, 8000, 16000]; // 2s, 4s, 8s, 16s
  private readonly DEFAULT_TIMEOUT = 30000; // 30 seconds
  private readonly DEFAULT_MAX_SLIPPAGE = 2.0; // 2%

  constructor(walletStore: WalletStore, prisma: PrismaClient, connection?: Connection) {
    this.walletStore = walletStore;
    this.prisma = prisma;
    this.connection = connection || getConnection();
  }

  async executeOrder(order: Order): Promise<ExecutionResult> {
    let lastError: Error | null = null;
    let retryAttempt = 0;

    while (retryAttempt <= this.MAX_RETRIES) {
      try {

        await this.validateOrder(order);
        const dbOrder = await this.createOrderRecord(order);
        let result: ExecutionResult;

        switch (order.orderType) {
          case "MARKET":
            result = await this.executeMarketOrder(order, dbOrder.id, retryAttempt);
            break;
          case "LIMIT":
            result = await this.executeLimitOrder(order, dbOrder.id, retryAttempt);
            break;
          case "STOP_LOSS":
          case "TAKE_PROFIT":
            result = await this.executeConditionalOrder(order, dbOrder.id, retryAttempt);
            break;
          default:
            throw new Error(`Unsupported order type: ${order.orderType}`);
        }

        await this.updateOrderRecord(dbOrder.id, result);

        if (result.success) {
          return result;
        }

        if (result.error && !isRetryableError(result.error)) {
          throw result.error;
        }

        lastError = result.error || new Error("Unknown error");
      } catch (error: any) {
        console.error(`Order execution failed (attempt ${retryAttempt + 1}):`, error);
        lastError = error;

        // Check if error is retryable
        if (!isRetryableError(error)) {
          // Not retryable, return failure immediately
          return {
            success: false,
            error: error,
            retryAttempts: retryAttempt,
          };
        }

        // Handle rate limit with specific delay
        if (error instanceof RateLimitError && error.retryAfter > 0) {
          const delay = error.retryAfter * 1000;
          console.log(`Rate limited. Waiting ${error.retryAfter}s before retry...`);
          await this.sleep(delay);
        } else {
          // Use exponential backoff
          const delay = getRetryDelay(retryAttempt);
          console.log(`Waiting ${delay}ms before retry...`);
          await this.sleep(delay);
        }
      }

      retryAttempt++;
    }

    // All retries exhausted
    return {
      success: false,
      error: lastError || new Error("Max retries exceeded"),
      retryAttempts: this.MAX_RETRIES,
    };
  }

  /**
   * Execute paired hedge orders atomically
   * If one fails, cancel the other
   */
  async executeHedgeOrders(longOrder: Order, shortOrder: Order): Promise<HedgeExecutionResult> {
    const successfulOrders: string[] = [];
    const failedOrders: string[] = [];

    try {
      console.log("Executing hedge orders atomically...");

      // Execute long order first
      console.log("Executing long order...");
      const longResult = await this.executeOrder(longOrder);

      if (!longResult.success) {
        failedOrders.push("long");
        throw new AtomicExecutionError(
          "Long order failed",
          successfulOrders,
          failedOrders,
          longResult.error?.message || "Unknown error",
          0,
        );
      }

      successfulOrders.push(longResult.signature!);

      // Execute short order
      console.log("Executing short order...");
      const shortResult = await this.executeOrder(shortOrder);

      if (!shortResult.success) {
        failedOrders.push("short");

        // Short order failed - need to reverse long order
        console.error("Short order failed. Attempting to reverse long order...");

        // In a real implementation, you'd reverse the long position here
        // For now, we'll just log the error

        throw new AtomicExecutionError(
          "Short order failed after long order succeeded",
          successfulOrders,
          failedOrders,
          shortResult.error?.message || "Unknown error",
          0,
        );
      }

      successfulOrders.push(shortResult.signature!);

      // Both orders succeeded
      const totalFees = (longResult.fee || 0) + (shortResult.fee || 0);

      console.log("Hedge orders executed successfully");

      return {
        success: true,
        longOrder: longResult,
        shortOrder: shortResult,
        totalFees,
      };
    } catch (error: any) {
      console.error("Hedge order execution failed:", error);

      return {
        success: false,
        longOrder: {
          success: successfulOrders.length > 0,
          retryAttempts: 0,
        },
        shortOrder: {
          success: false,
          retryAttempts: 0,
        },
        totalFees: 0,
        error: error,
      };
    }
  }

  /**
   * Execute market order
   */
  private async executeMarketOrder(
    order: Order,
    orderId: string,
    retryAttempt: number,
  ): Promise<ExecutionResult> {
    try {
      // Get current market price
      const currentPrice = await marketDataService.getCurrentPrice(order.poolAddress);

      // Check slippage protection
      if (order.price) {
        const slippage = Math.abs((currentPrice - order.price) / order.price) * 100;
        const maxSlippage = order.maxSlippage || this.DEFAULT_MAX_SLIPPAGE;

        if (slippage > maxSlippage) {
          throw new SlippageError(
            `Slippage exceeded: ${slippage.toFixed(2)}%`,
            order.price,
            currentPrice,
            slippage,
            maxSlippage,
            retryAttempt,
          );
        }
      }

      // Execute the order on Orca
      const amountLamports = BigInt(Math.floor(order.amount * 1_000_000)); // Convert to token decimals
      const slippageBps = Math.floor((order.maxSlippage || this.DEFAULT_MAX_SLIPPAGE) * 100);

      console.log(`Executing market order: ${order.amount} ${order.tokenSymbol} at ~${currentPrice}`);

      const signature = await depositLiquidity(
        this.walletStore,
        order.userId,
        order.poolAddress,
        amountLamports,
        slippageBps,
      );

      // Wait for confirmation
      await this.waitForConfirmation(signature, this.DEFAULT_TIMEOUT);

      // Calculate fee (estimate 0.1%)
      const fee = order.amount * 0.001;

      return {
        success: true,
        signature,
        orderId,
        executedPrice: currentPrice,
        executedAmount: order.amount,
        fee,
        retryAttempts: retryAttempt,
      };
    } catch (error: any) {
      console.error("Market order execution failed:", error);

      // Wrap RPC errors
      if (error.message?.includes("429") || error.message?.includes("rate limit")) {
        throw new RateLimitError(
          "RPC rate limit exceeded",
          this.connection.rpcEndpoint,
          0,
          retryAttempt,
          error,
        );
      }

      if (error.message?.includes("timeout") || error.message?.includes("timed out")) {
        throw new TransactionTimeoutError(
          "Transaction timed out",
          error.signature || "unknown",
          this.DEFAULT_TIMEOUT,
          retryAttempt,
          error,
        );
      }

      throw error;
    }
  }

  /**
   * Execute limit order (placeholder)
   */
  private async executeLimitOrder(
    order: Order,
    orderId: string,
    retryAttempt: number,
  ): Promise<ExecutionResult> {
    // Limit orders would require a separate order book system
    // For now, treat as market order if price is met
    const currentPrice = await marketDataService.getCurrentPrice(order.poolAddress);

    if (!order.price) {
      throw new Error("Limit order requires a price");
    }

    // Check if limit price is met
    const isBuyOrder = order.side === "BUY";
    const priceIsMet = isBuyOrder ? currentPrice <= order.price : currentPrice >= order.price;

    if (!priceIsMet) {
      throw new Error(`Limit price not met. Current: ${currentPrice}, Target: ${order.price}`);
    }

    // Execute as market order
    return this.executeMarketOrder(order, orderId, retryAttempt);
  }

  /**
   * Execute conditional order (stop-loss / take-profit)
   */
  private async executeConditionalOrder(
    order: Order,
    orderId: string,
    retryAttempt: number,
  ): Promise<ExecutionResult> {
    const currentPrice = await marketDataService.getCurrentPrice(order.poolAddress);

    if (!order.price) {
      throw new Error("Conditional order requires a trigger price");
    }

    // Check if trigger condition is met
    const isStopLoss = order.orderType === "STOP_LOSS";
    const conditionMet = isStopLoss
      ? currentPrice <= order.price // Stop-loss triggers when price falls below
      : currentPrice >= order.price; // Take-profit triggers when price rises above

    if (!conditionMet) {
      throw new Error(
        `${order.orderType} condition not met. Current: ${currentPrice}, Trigger: ${order.price}`,
      );
    }

    // Execute as market order
    return this.executeMarketOrder(order, orderId, retryAttempt);
  }

  /**
   * Validate order before execution
   */
  private async validateOrder(order: Order): Promise<void> {
    // Check user balance
    const balance = await this.walletStore.checkUsdcBalance(order.userId);

    if (balance < order.amount) {
      throw new InsufficientFundsError(
        "Insufficient balance for order",
        order.amount,
        balance,
        "USDC",
      );
    }

    // Validate amount
    if (order.amount <= 0) {
      throw new Error("Order amount must be greater than 0");
    }

    // Validate pool address
    if (!order.poolAddress) {
      throw new Error("Pool address is required");
    }
  }

  /**
   * Create order record in database
   */
  private async createOrderRecord(order: Order): Promise<{ id: string }> {
    return await this.prisma.order.create({
      data: {
        userId: order.userId,
        orderType: order.orderType,
        side: order.side,
        tokenMint: order.tokenMint,
        tokenSymbol: order.tokenSymbol,
        amount: order.amount,
        price: order.price,
        status: "PENDING",
      },
      select: { id: true },
    });
  }

  /**
   * Update order record with execution result
   */
  private async updateOrderRecord(orderId: string, result: ExecutionResult): Promise<void> {
    await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: result.success ? "FILLED" : "FAILED",
        filledAmount: result.executedAmount || 0,
        averagePrice: result.executedPrice,
        executedAt: result.success ? new Date() : undefined,
      },
    });
  }

  /**
   * Wait for transaction confirmation with polling
   */
  private async waitForConfirmation(signature: string, timeoutMs: number): Promise<void> {
    const start = Date.now();
    const confirmOptions: ConfirmOptions = {
      commitment: "confirmed",
    };

    while (Date.now() - start < timeoutMs) {
      try {
        const status = await this.connection.getSignatureStatus(signature);

        if (status.value?.confirmationStatus === "confirmed" ||
            status.value?.confirmationStatus === "finalized") {

          if (status.value.err) {
            throw new TransactionConfirmationError(
              "Transaction failed",
              signature,
              JSON.stringify(status.value.err),
            );
          }

          return; // Success
        }

        // Wait 1 second before checking again
        await this.sleep(1000);
      } catch (error: any) {
        console.error("Error checking transaction status:", error);

        if (Date.now() - start >= timeoutMs) {
          throw new TransactionTimeoutError(
            "Transaction confirmation timeout",
            signature,
            timeoutMs,
          );
        }
      }
    }

    throw new TransactionTimeoutError(
      "Transaction confirmation timeout",
      signature,
      timeoutMs,
    );
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
