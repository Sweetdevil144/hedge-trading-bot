/**
 * Error Handler - Global error handling with graceful shutdown
 */

import { logger } from "./logger";
import { PrismaClient } from "@prisma/client";

/**
 * Graceful shutdown handler
 */
export class GracefulShutdown {
  private shutdownCallbacks: Array<() => Promise<void>> = [];
  private isShuttingDown: boolean = false;

  /**
   * Register a shutdown callback
   * These will be called in reverse order during shutdown
   */
  registerCallback(callback: () => Promise<void>): void {
    this.shutdownCallbacks.push(callback);
  }

  /**
   * Perform graceful shutdown
   */
  async shutdown(exitCode: number = 0): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn("Shutdown already in progress, skipping...");
      return;
    }

    this.isShuttingDown = true;
    logger.info("Graceful shutdown initiated...");

    // Execute shutdown callbacks in reverse order
    for (let i = this.shutdownCallbacks.length - 1; i >= 0; i--) {
      const callback = this.shutdownCallbacks[i];
      try {
        await callback();
      } catch (error) {
        logger.error(`Error during shutdown callback ${i}:`, error);
        // Continue with other callbacks even if one fails
      }
    }

    logger.info("Graceful shutdown completed");
    logger.close();

    // Exit process
    process.exit(exitCode);
  }
}

// Global shutdown handler instance
export const gracefulShutdown = new GracefulShutdown();

/**
 * Setup global error handling
 * Catches uncaught exceptions and unhandled rejections
 */
export function setupGlobalErrorHandling(prisma?: PrismaClient, automationEngine?: any, marketData?: any): void {
  // Register cleanup callbacks
  if (prisma) {
    gracefulShutdown.registerCallback(async () => {
      logger.info("Disconnecting from database...");
      await prisma.$disconnect();
    });
  }

  if (automationEngine) {
    gracefulShutdown.registerCallback(async () => {
      if (automationEngine.isRunning && automationEngine.isRunning()) {
        logger.info("Stopping automation engine...");
        await automationEngine.stop();
      }
    });
  }

  if (marketData) {
    gracefulShutdown.registerCallback(async () => {
      logger.info("Closing market data connections...");
      if (marketData.disconnectAll) {
        await marketData.disconnectAll();
      }
    });
  }

  // Handle uncaught exceptions
  process.on("uncaughtException", (error: Error) => {
    logger.error("Uncaught exception:", error);
    logger.error("Stack trace:", { stack: error.stack });

    // Perform graceful shutdown
    gracefulShutdown.shutdown(1);
  });

  // Handle unhandled promise rejections
  process.on("unhandledRejection", (reason: any, promise: Promise<any>) => {
    logger.error("Unhandled promise rejection:", reason);
    logger.error("Promise:", promise);

    if (reason instanceof Error) {
      logger.error("Stack trace:", { stack: reason.stack });
    }

    // Perform graceful shutdown
    gracefulShutdown.shutdown(1);
  });

  // Handle SIGTERM (graceful termination)
  process.on("SIGTERM", () => {
    logger.info("Received SIGTERM signal");
    gracefulShutdown.shutdown(0);
  });

  // Handle SIGINT (Ctrl+C)
  process.on("SIGINT", () => {
    logger.info("Received SIGINT signal (Ctrl+C)");
    gracefulShutdown.shutdown(0);
  });

  logger.info("Global error handling configured");
}

/**
 * Wrap async function with error handling
 * Useful for wrapping route handlers and async operations
 */
export function asyncErrorHandler<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
): (...args: T) => Promise<R | undefined> {
  return async (...args: T): Promise<R | undefined> => {
    try {
      return await fn(...args);
    } catch (error) {
      logger.error("Error in async function:", error);
      if (error instanceof Error) {
        logger.error("Stack trace:", { stack: error.stack });
      }
      return undefined;
    }
  };
}

/**
 * Error types for better error handling
 */
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public isOperational: boolean = true,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation error
 */
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", 400, true);
  }
}

/**
 * Not found error
 */
export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, "NOT_FOUND", 404, true);
  }
}

/**
 * Unauthorized error
 */
export class UnauthorizedError extends AppError {
  constructor(message: string) {
    super(message, "UNAUTHORIZED", 401, true);
  }
}

/**
 * Database error
 */
export class DatabaseError extends AppError {
  constructor(message: string, originalError?: Error) {
    super(message, "DATABASE_ERROR", 500, false);
    if (originalError) {
      this.stack = originalError.stack;
    }
  }
}

/**
 * External service error
 */
export class ExternalServiceError extends AppError {
  constructor(message: string, public service: string) {
    super(message, "EXTERNAL_SERVICE_ERROR", 503, true);
  }
}

/**
 * Log error with context
 */
export function logError(error: Error | AppError, context?: Record<string, any>): void {
  const errorInfo: Record<string, any> = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };

  if (error instanceof AppError) {
    errorInfo.code = error.code;
    errorInfo.statusCode = error.statusCode;
    errorInfo.isOperational = error.isOperational;
  }

  if (context) {
    errorInfo.context = context;
  }

  logger.error("Error occurred:", errorInfo);
}

/**
 * Check if error is operational (expected) or programming error
 */
export function isOperationalError(error: Error | AppError): boolean {
  if (error instanceof AppError) {
    return error.isOperational;
  }
  return false;
}

/**
 * Format error for user display
 */
export function formatErrorForUser(error: Error | AppError): string {
  if (error instanceof AppError) {
    return error.message;
  }

  // Don't expose internal errors to users
  return "An unexpected error occurred. Please try again later.";
}

/**
 * Error recovery strategies
 */
export async function recoverFromError(error: Error | AppError, retryFn?: () => Promise<void>): Promise<boolean> {
  logger.warn("Attempting error recovery...", { error: error.message });

  // Check if error is operational and recoverable
  if (!isOperationalError(error)) {
    logger.error("Non-operational error, cannot recover:", error);
    return false;
  }

  // Attempt retry if function provided
  if (retryFn) {
    try {
      await retryFn();
      logger.info("Error recovery successful");
      return true;
    } catch (retryError) {
      logger.error("Error recovery failed:", retryError);
      return false;
    }
  }

  return false;
}
