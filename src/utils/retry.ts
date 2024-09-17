import { logger } from "./logger";

export interface RetryOptions {
  maxAttempts?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  retryableErrors?: string[];
  onRetry?: (error: Error, attempt: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, "retryableErrors" | "onRetry">> = {
  maxAttempts: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
};

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === opts.maxAttempts) {
        break;
      }

      if (opts.retryableErrors && !isRetryableError(lastError, opts.retryableErrors)) {
        throw lastError;
      }

      const delay = calculateDelay(attempt, opts.initialDelay, opts.maxDelay, opts.backoffMultiplier);

      logger.warn(`Attempt ${attempt}/${opts.maxAttempts} failed: ${lastError.message}. Retrying in ${delay}ms...`);

      if (opts.onRetry) {
        opts.onRetry(lastError, attempt);
      }

      await sleep(delay);
    }
  }

  throw lastError!;
}

function calculateDelay(
  attempt: number,
  initialDelay: number,
  maxDelay: number,
  backoffMultiplier: number,
): number {
  const delay = initialDelay * Math.pow(backoffMultiplier, attempt - 1);
  return Math.min(delay, maxDelay);
}

function isRetryableError(error: Error, retryableErrors: string[]): boolean {
  return retryableErrors.some(pattern =>
    error.message.includes(pattern) || error.name.includes(pattern)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class RetryableOperation<T> {
  private options: RetryOptions;

  constructor(options: RetryOptions = {}) {
    this.options = options;
  }

  async execute(fn: () => Promise<T>): Promise<T> {
    return retryWithBackoff(fn, this.options);
  }
}
