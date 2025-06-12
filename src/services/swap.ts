import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import BN from "bn.js";
import {
  getUsdtMint,
  getUsdiMint,
  AMM_CONFIG,
  POOL_STATE,
  OUTPUT_VAULT,
  INPUT_VAULT,
  OBSERVATION_STATE,
  CLMM_PROGRAM_ID,
  getUsdcMint,
} from "../utils/constants";
import { formatUserError, logError, ErrorType, withErrorHandling } from "../utils/errorHandler";

/**
 * Creates a swap transaction for exchanging between USDC and USDi
 * @param connection Solana connection
 * @param userKeypair User's keypair
 * @param amountIn Amount to swap
 * @param isWithdrawal Whether this is a withdrawal (USDi -> USDC) or deposit (USDC -> USDi)
 * @returns Prepared transaction
 */
export async function createSwapTransaction(
  connection: Connection,
  userKeypair: Keypair,
  amountIn: number,
  isWithdrawal: boolean = false,
): Promise<Transaction> {
  return withErrorHandling(
    `Create ${isWithdrawal ? "withdrawal" : "deposit"} swap transaction`,
    async () => {
      const userPublicKey = userKeypair.publicKey;
      const usdcMint = getUsdcMint();
      const usdiMint = getUsdiMint();

      // Get token accounts
      const userUsdcAccount = await getAssociatedTokenAddress(usdcMint, userPublicKey);

      const userUsdiAccount = await getAssociatedTokenAddress(usdiMint, userPublicKey);

      // Create transaction
      const transaction = new Transaction();

      // Create token accounts if they don't exist
      const usdcAccount = await connection.getAccountInfo(userUsdcAccount);
      if (!usdcAccount) {
        transaction.add(
          createAssociatedTokenAccountInstruction(userPublicKey, userUsdcAccount, userPublicKey, usdcMint),
        );
      }

      const usdiAccount = await connection.getAccountInfo(userUsdiAccount);
      if (!usdiAccount) {
        transaction.add(
          createAssociatedTokenAccountInstruction(userPublicKey, userUsdiAccount, userPublicKey, usdiMint),
        );
      }

      // Add swap instruction with all required accounts
      const swapIx = createSwapInstruction(
        userPublicKey,
        userUsdcAccount,
        userUsdiAccount,
        amountIn,
        isWithdrawal,
      );

      transaction.add(swapIx);

      // Get latest blockhash
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = userPublicKey;

      return transaction;
    },
    async (error, operation) => {
      // Format error based on specific error types
      const formattedError = formatUserError(error, operation);

      if (error instanceof Error) {
        const errorMsg = error.message.toLowerCase();

        if (errorMsg.includes("insufficient") || errorMsg.includes("balance")) {
          throw new Error(
            `Insufficient balance for ${isWithdrawal ? "withdrawal" : "deposit"}. Please check your account balance.`,
          );
        }

        if (errorMsg.includes("slippage")) {
          throw new Error("Price moved too much during the transaction. Try again later.");
        }

        if (errorMsg.includes("network") || errorMsg.includes("connection")) {
          throw new Error("Network connection error. Please check your internet connection and try again.");
        }

        if (errorMsg.includes("liquidity")) {
          throw new Error(
            "Insufficient liquidity in the pool. Try with a smaller amount or try again later.",
          );
        }
      }

      // Default error message
      throw new Error(
        `${isWithdrawal ? "Withdrawal" : "Deposit"} preparation failed: ${formattedError.message}`,
      );
    },
    {
      wallet: userKeypair.publicKey.toString(),
      amount: amountIn,
      operation: isWithdrawal ? "withdrawal" : "deposit",
    },
  );
}

/**
 * Creates a swap instruction
 * @param userPublicKey User's public key
 * @param userUsdcAccount User's USDC token account
 * @param userUsdiAccount User's USDi token account
 * @param amountIn Amount to swap
 * @param isWithdrawal Whether this is a withdrawal (USDi -> USDC) or deposit (USDC -> USDi)
 * @returns Swap instruction
 */
function createSwapInstruction(
  userPublicKey: PublicKey,
  userUsdcAccount: PublicKey,
  userUsdiAccount: PublicKey,
  amountIn: number,
  isWithdrawal: boolean,
): TransactionInstruction {
  try {
    // Convert amount to raw units (USDC has 6 decimals)
    const amount = Math.floor(amountIn * Math.pow(10, 6));

    // Get mint addresses
    const usdcMint = getUsdcMint();
    const usdiMint = getUsdiMint();

    // Prepare instruction data
    const data = Buffer.alloc(41);

    // Write swap instruction discriminator
    data.write("2b04ed0b1ac91e62", 0, "hex");

    // Write amount
    data.writeBigUInt64LE(BigInt(amount), 8);

    // Write minimum output amount (98.9% of input amount)
    const minimumAmountOut = Math.floor(amount * 0.989);
    data.writeBigUInt64LE(BigInt(minimumAmountOut), 16);

    // Write sqrtPriceLimitX64 - using exact value from successful transaction
    const sqrtPriceLimitX64 = isWithdrawal
      ? BigInt("4295048017") // For withdrawals (USDi -> USDC)
      : BigInt("79226673515401279992447579055"); // For deposits (USDC -> USDi)
    const bn = new BN(sqrtPriceLimitX64.toString());
    bn.maskn(64).toArrayLike(Buffer, "le", 8).copy(data, 24);
    bn.shrn(64).maskn(64).toArrayLike(Buffer, "le", 8).copy(data, 32);

    // Write direction flag
    data[40] = 1;

    // Use same account order as old code
    const keys = [
      { pubkey: userPublicKey, isSigner: true, isWritable: true },
      { pubkey: AMM_CONFIG, isSigner: false, isWritable: false },
      { pubkey: POOL_STATE, isSigner: false, isWritable: true },
      {
        pubkey: isWithdrawal ? userUsdiAccount : userUsdcAccount,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: isWithdrawal ? userUsdcAccount : userUsdiAccount,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: isWithdrawal ? OUTPUT_VAULT : INPUT_VAULT,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: isWithdrawal ? INPUT_VAULT : OUTPUT_VAULT,
        isSigner: false,
        isWritable: true,
      },
      { pubkey: OBSERVATION_STATE, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      {
        pubkey: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: isWithdrawal ? usdiMint : usdcMint,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: isWithdrawal ? usdcMint : usdiMint,
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: new PublicKey("3JP1QNbACeXBFpwBBHjAg8YUxaZvHRZ6aUSkekKt521M"),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: new PublicKey("E14EG74exe5oZeAL6cJksNDT59jFfYVu72o4QDqJBrEB"),
        isSigner: false,
        isWritable: true,
      },
      {
        pubkey: isWithdrawal
          ? new PublicKey("ChvSyZQDGr9jcioJXBwq6Ube8Emi9sCjW3bzSGW5pYbG")
          : new PublicKey("FXMRNUwWrNAMiCZghjo3jvgmHak3Lrgcmd6QuuJZfkAx"),
        isSigner: false,
        isWritable: true,
      },
    ];

    return new TransactionInstruction({
      programId: CLMM_PROGRAM_ID,
      keys,
      data,
    });
  } catch (error) {
    const formattedError = formatUserError(error, "Create swap instruction");
    logError(error, {
      operation: "Create swap instruction",
      additionalInfo: {
        userPublicKey: userPublicKey.toString(),
        amount: amountIn,
        isWithdrawal,
      },
      type: ErrorType.TRANSACTION,
    });
    throw new Error(`Failed to create swap instruction: ${formattedError.message}`);
  }
}
