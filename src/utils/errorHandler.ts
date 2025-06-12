/**
 * Error handling utilities for the Solana trading bot
 * Provides unified error handling, logging, and user-friendly error messages
 */

// Error types for categorization
export enum ErrorType {
  CONNECTION = "Connection Error",
  WALLET = "Wallet Error",
  TRANSACTION = "Transaction Error",
  POOL = "Pool Error",
  POSITION = "Position Error",
  UNKNOWN = "Unknown Error",
}

// Interface for error logging
interface ErrorLogInfo {
  operation: string;
  additionalInfo?: Record<string, any>;
  type?: ErrorType;
}

/**
 * Format errors into user-friendly messages
 * @param error The original error
 * @param context The operation context where the error occurred
 * @returns A formatted error object with user-friendly message
 */
export function formatUserError(
  error: unknown,
  context: string,
): {
  message: string;
  type: ErrorType;
  original: any;
} {
  // Default values
  let message = "An unexpected error occurred";
  let type = ErrorType.UNKNOWN;
  let original = error;

  if (error instanceof Error) {
    const errorMsg = error.message.toLowerCase();

    // Connection errors
    if (
      errorMsg.includes("network") ||
      errorMsg.includes("connection") ||
      errorMsg.includes("timeout") ||
      errorMsg.includes("rpc")
    ) {
      type = ErrorType.CONNECTION;
      message = "Network connection error. Please check your internet connection or try again later.";
    }
    // Wallet errors
    else if (
      errorMsg.includes("wallet") ||
      errorMsg.includes("account") ||
      errorMsg.includes("key") ||
      errorMsg.includes("signature")
    ) {
      type = ErrorType.WALLET;
      message = "Wallet operation failed. Please check your wallet setup.";
    }
    // Transaction errors
    else if (
      errorMsg.includes("transaction") ||
      errorMsg.includes("instruction") ||
      errorMsg.includes("blockhash") ||
      errorMsg.includes("fee")
    ) {
      type = ErrorType.TRANSACTION;
      message = "Transaction failed. This could be due to network congestion or insufficient funds.";
    }
    // Pool errors
    else if (errorMsg.includes("pool") || errorMsg.includes("liquidity") || errorMsg.includes("swap")) {
      type = ErrorType.POOL;
      message = "Liquidity pool operation failed. The pool may be unavailable or has insufficient liquidity.";
    }
    // Position errors
    else if (errorMsg.includes("position") || errorMsg.includes("slippage") || errorMsg.includes("range")) {
      type = ErrorType.POSITION;
      message = "Position operation failed. Please check your position parameters.";
    }
    // Keep original message for other cases but add context
    else {
      message = `${context} operation failed: ${error.message}`;
    }
  } else if (typeof error === "string") {
    message = error;
  }

  return {
    message,
    type,
    original,
  };
}

/**
 * Log errors with structured information for debugging
 * @param error The original error
 * @param info Additional error context information
 */
export function logError(error: unknown, info: ErrorLogInfo): void {
  const { operation, additionalInfo = {}, type } = info;
  const timestamp = new Date().toISOString();

  // Format error for logging
  let errorDetails: any = {
    message: "Unknown error",
    stack: null,
  };

  if (error instanceof Error) {
    errorDetails = {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  } else if (typeof error === "string") {
    errorDetails = { message: error };
  } else {
    try {
      errorDetails = { value: JSON.stringify(error) };
    } catch (e) {
      errorDetails = { value: String(error) };
    }
  }

  // Create structured log
  const logData = {
    timestamp,
    operation,
    type: type || ErrorType.UNKNOWN,
    error: errorDetails,
    additionalInfo,
  };

  // Log to console but would ideally send to a monitoring service in production
  console.error("[ERROR]", JSON.stringify(logData, null, 2));

  // Future enhancement: Send to monitoring/analytics service
  // Example: sendToMonitoring(logData);
}

/**
 * Wraps an async function with error handling
 * @param operation - Description of the operation for error messages
 * @param fn - Async function to execute
 * @param errorHandler - Function to handle errors
 * @param additionalInfo - Optional additional context information for logging
 * @returns Result of the async function or handles the error
 */
export async function withErrorHandling<T>(
  operation: string,
  fn: () => Promise<T>,
  errorHandler: (error: any, operation: string, additionalInfo?: Record<string, any>) => Promise<any>,
  additionalInfo?: Record<string, any>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    logError(error, { operation, additionalInfo, type: undefined });
    return await errorHandler(error, operation, additionalInfo);
  }
}
