/**
 * Custom Error Classes for Hedge Trading Bot
 */

/**
 * Base error class for all trading errors
 */
export class TradingError extends Error {
  public readonly retryAttempt: number;
  public readonly originalError: Error | null;
  public readonly suggestedAction: string;
  public readonly timestamp: Date;

  constructor(
    message: string,
    retryAttempt: number = 0,
    originalError: Error | null = null,
    suggestedAction: string = "Please try again later",
  ) {
    super(message);
    this.name = this.constructor.name;
    this.retryAttempt = retryAttempt;
    this.originalError = originalError;
    this.suggestedAction = suggestedAction;
    this.timestamp = new Date();

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      retryAttempt: this.retryAttempt,
      suggestedAction: this.suggestedAction,
      timestamp: this.timestamp.toISOString(),
      originalError: this.originalError?.message,
    };
  }
}

/**
 * Network-related errors (RPC failures, timeouts, connection issues)
 */
export class NetworkError extends TradingError {
  public readonly endpoint: string;

  constructor(
    message: string,
    endpoint: string,
    retryAttempt: number = 0,
    originalError: Error | null = null,
  ) {
    super(
      message,
      retryAttempt,
      originalError,
      retryAttempt < 4
        ? `Network issue detected. Automatic retry in progress (${retryAttempt + 1}/4)`
        : "Maximum retry attempts reached. Check your network connection and RPC endpoint",
    );
    this.endpoint = endpoint;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      endpoint: this.endpoint,
    };
  }
}

/**
 * Rate limit errors (429 responses from RPC)
 */
export class RateLimitError extends TradingError {
  public readonly retryAfter: number; // seconds
  public readonly endpoint: string;

  constructor(
    message: string,
    endpoint: string,
    retryAfter: number = 0,
    retryAttempt: number = 0,
    originalError: Error | null = null,
  ) {
    super(
      message,
      retryAttempt,
      originalError,
      retryAfter > 0
        ? `Rate limit exceeded. Retrying after ${retryAfter} seconds`
        : "Rate limit exceeded. Using exponential backoff",
    );
    this.retryAfter = retryAfter;
    this.endpoint = endpoint;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      endpoint: this.endpoint,
      retryAfter: this.retryAfter,
    };
  }
}

/**
 * Slippage exceeded errors
 */
export class SlippageError extends TradingError {
  public readonly expectedPrice: number;
  public readonly actualPrice: number;
  public readonly slippagePercent: number;
  public readonly maxSlippage: number;

  constructor(
    message: string,
    expectedPrice: number,
    actualPrice: number,
    slippagePercent: number,
    maxSlippage: number,
    retryAttempt: number = 0,
  ) {
    super(
      message,
      retryAttempt,
      null,
      `Slippage of ${slippagePercent.toFixed(2)}% exceeds maximum ${maxSlippage.toFixed(2)}%. ` +
        `Consider increasing slippage tolerance or waiting for better market conditions`,
    );
    this.expectedPrice = expectedPrice;
    this.actualPrice = actualPrice;
    this.slippagePercent = slippagePercent;
    this.maxSlippage = maxSlippage;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      expectedPrice: this.expectedPrice,
      actualPrice: this.actualPrice,
      slippagePercent: this.slippagePercent,
      maxSlippage: this.maxSlippage,
    };
  }
}

/**
 * Insufficient funds errors
 */
export class InsufficientFundsError extends TradingError {
  public readonly required: number;
  public readonly available: number;
  public readonly token: string;

  constructor(
    message: string,
    required: number,
    available: number,
    token: string = "USDC",
    retryAttempt: number = 0,
  ) {
    super(
      message,
      retryAttempt,
      null,
      `Insufficient ${token} balance. Required: ${required}, Available: ${available}. ` +
        `Please deposit more funds or reduce position size`,
    );
    this.required = required;
    this.available = available;
    this.token = token;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      required: this.required,
      available: this.available,
      token: this.token,
    };
  }
}

/**
 * Transaction timeout errors
 */
export class TransactionTimeoutError extends TradingError {
  public readonly signature: string;
  public readonly timeoutMs: number;

  constructor(
    message: string,
    signature: string,
    timeoutMs: number,
    retryAttempt: number = 0,
    originalError: Error | null = null,
  ) {
    super(
      message,
      retryAttempt,
      originalError,
      `Transaction ${signature} timed out after ${timeoutMs}ms. ` +
        `Check transaction status on Solana explorer. The transaction may still confirm`,
    );
    this.signature = signature;
    this.timeoutMs = timeoutMs;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      signature: this.signature,
      timeoutMs: this.timeoutMs,
    };
  }
}

/**
 * Transaction confirmation errors
 */
export class TransactionConfirmationError extends TradingError {
  public readonly signature: string;
  public readonly status: string;

  constructor(
    message: string,
    signature: string,
    status: string,
    retryAttempt: number = 0,
    originalError: Error | null = null,
  ) {
    super(
      message,
      retryAttempt,
      originalError,
      `Transaction ${signature} failed with status: ${status}. Check logs for details`,
    );
    this.signature = signature;
    this.status = status;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      signature: this.signature,
      status: this.status,
    };
  }
}

/**
 * Pool/liquidity errors
 */
export class PoolError extends TradingError {
  public readonly poolAddress: string;
  public readonly errorType: "not_found" | "insufficient_liquidity" | "invalid_pool";

  constructor(
    message: string,
    poolAddress: string,
    errorType: "not_found" | "insufficient_liquidity" | "invalid_pool",
    retryAttempt: number = 0,
    originalError: Error | null = null,
  ) {
    const suggestions = {
      not_found: "Pool not found. Verify the pool address is correct",
      insufficient_liquidity: "Insufficient liquidity in pool. Try a smaller amount or different pool",
      invalid_pool: "Invalid pool configuration. Contact support if issue persists",
    };

    super(message, retryAttempt, originalError, suggestions[errorType]);
    this.poolAddress = poolAddress;
    this.errorType = errorType;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      poolAddress: this.poolAddress,
      errorType: this.errorType,
    };
  }
}

/**
 * Atomic execution error (for hedge trades where both sides must succeed)
 */
export class AtomicExecutionError extends TradingError {
  public readonly successfulOrders: string[];
  public readonly failedOrders: string[];
  public readonly reason: string;

  constructor(
    message: string,
    successfulOrders: string[],
    failedOrders: string[],
    reason: string,
    retryAttempt: number = 0,
  ) {
    super(
      message,
      retryAttempt,
      null,
      `Atomic execution failed. ${successfulOrders.length} orders succeeded, ${failedOrders.length} failed. ` +
        `Reason: ${reason}. Successful orders may need manual reversal`,
    );
    this.successfulOrders = successfulOrders;
    this.failedOrders = failedOrders;
    this.reason = reason;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      successfulOrders: this.successfulOrders,
      failedOrders: this.failedOrders,
      reason: this.reason,
    };
  }
}

/**
 * Validation error
 */
export class ValidationError extends TradingError {
  public readonly field: string;
  public readonly value: any;

  constructor(message: string, field: string, value: any, suggestedAction?: string) {
    super(message, 0, null, suggestedAction || `Check the ${field} parameter and try again`);
    this.field = field;
    this.value = value;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      field: this.field,
      value: this.value,
    };
  }
}

/**
 * Risk limit error
 */
export class RiskLimitError extends TradingError {
  public readonly limitType: "position_size" | "max_positions" | "drawdown" | "exposure";
  public readonly limit: number;
  public readonly current: number;

  constructor(
    message: string,
    limitType: "position_size" | "max_positions" | "drawdown" | "exposure",
    limit: number,
    current: number,
  ) {
    super(
      message,
      0,
      null,
      `Risk limit exceeded. ${limitType}: ${current} exceeds limit of ${limit}. ` +
        `Reduce position size or close existing positions`,
    );
    this.limitType = limitType;
    this.limit = limit;
    this.current = current;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      limitType: this.limitType,
      limit: this.limit,
      current: this.current,
    };
  }
}

/**
 * Helper function to check if an error is retryable
 */
export function isRetryableError(error: Error): boolean {
  return (
    error instanceof NetworkError ||
    error instanceof RateLimitError ||
    error instanceof TransactionTimeoutError
  );
}

/**
 * Helper function to get delay for retry based on attempt number
 */
export function getRetryDelay(attemptNumber: number): number {
  const delays = [2000, 4000, 8000, 16000]; // 2s, 4s, 8s, 16s
  return delays[Math.min(attemptNumber, delays.length - 1)];
}

/**
 * Helper function to format error for user display
 */
export function formatErrorForUser(error: Error): string {
  if (error instanceof TradingError) {
    return `${error.message}\n\n💡 ${error.suggestedAction}`;
  }
  return error.message;
}
