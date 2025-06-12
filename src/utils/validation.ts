/**
 * Validation utilities for user inputs
 */

// Constants for validation limits
export const VALIDATION_LIMITS = {
  // Maximum transaction amount (in USDC or USDi)
  MAX_TRANSACTION_AMOUNT: 1_000_000,

  // Minimum transaction amount (in USDC or USDi)
  MIN_TRANSACTION_AMOUNT: 0.001,

  // Minimum SOL needed for transaction fees
  MIN_SOL_BALANCE: 0.01,

  // Maximum reasonable slippage (in percentage, e.g., 5 = 5%)
  MAX_SLIPPAGE_PERCENT: 10,
};

/**
 * Validates a transaction amount
 * @param amount - Amount to validate
 * @param maxAmount - Optional maximum amount (e.g., user's balance)
 * @returns Object with validation result and error message if invalid
 */
export function validateTransactionAmount(
  amount: number | string,
  maxAmount?: number,
): {
  isValid: boolean;
  error?: string;
  parsedAmount?: number;
} {
  // Convert string to number if needed
  const parsedAmount = typeof amount === "string" ? parseFloat(amount.replace(/,/g, "")) : amount;

  // Check if it's a valid number
  if (isNaN(parsedAmount)) {
    return {
      isValid: false,
      error: "Amount must be a valid number.",
    };
  }

  // Check for negative values
  if (parsedAmount < 0) {
    return {
      isValid: false,
      error: "Amount cannot be negative.",
    };
  }

  // Check if amount is too small
  if (parsedAmount < VALIDATION_LIMITS.MIN_TRANSACTION_AMOUNT) {
    return {
      isValid: false,
      error: `Amount must be at least ${VALIDATION_LIMITS.MIN_TRANSACTION_AMOUNT}.`,
    };
  }

  // Check if amount is too large
  if (parsedAmount > VALIDATION_LIMITS.MAX_TRANSACTION_AMOUNT) {
    return {
      isValid: false,
      error: `Amount cannot exceed ${VALIDATION_LIMITS.MAX_TRANSACTION_AMOUNT.toLocaleString()}.`,
    };
  }

  // If maxAmount provided (e.g., user's balance), check against it
  if (maxAmount !== undefined && parsedAmount > maxAmount) {
    return {
      isValid: false,
      error: `Amount exceeds available balance of ${maxAmount.toFixed(6)}.`,
    };
  }

  // All validations passed
  return {
    isValid: true,
    parsedAmount,
  };
}

/**
 * Validates a Solana address
 * @param address - The address to validate
 * @returns Object with validation result and error message if invalid
 */
export function validateSolanaAddress(address: string): {
  isValid: boolean;
  error?: string;
} {
  // Basic formatting check (starts with a letter or number, 32-44 characters)
  const addressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

  if (!address || typeof address !== "string") {
    return {
      isValid: false,
      error: "Address cannot be empty.",
    };
  }

  address = address.trim();

  if (!addressRegex.test(address)) {
    return {
      isValid: false,
      error: "Invalid Solana address format.",
    };
  }

  return { isValid: true };
}

/**
 * Validates SOL balance for transaction feasibility
 * @param solBalance - Current SOL balance
 * @returns Object with validation result and error message if invalid
 */
export function validateSolBalance(solBalance: number): {
  isValid: boolean;
  error?: string;
} {
  if (solBalance < VALIDATION_LIMITS.MIN_SOL_BALANCE) {
    return {
      isValid: false,
      error: `Insufficient SOL for transaction fees. You need at least ${VALIDATION_LIMITS.MIN_SOL_BALANCE} SOL.`,
    };
  }

  return { isValid: true };
}

/**
 * Formats an amount with proper decimal places based on token type
 * @param amount - The amount to format
 * @param tokenType - Type of token (SOL, USDC, USDi, etc.)
 * @returns Formatted amount string
 */
export function formatAmount(amount: number, tokenType: "SOL" | "USDC" | "USDi" = "USDC"): string {
  const decimals = tokenType === "SOL" ? 9 : 6;
  return amount.toFixed(Math.min(6, decimals));
}
