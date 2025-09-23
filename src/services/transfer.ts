import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from "@solana/spl-token";
import { getUsdcMint } from "../utils/constants";
import { formatUserError, logError, ErrorType, withErrorHandling } from "../utils/errorHandler";

/**
 * Creates a transaction for transferring USDC tokens between accounts
 * @param connection Solana connection
 * @param fromKeypair Sender's keypair
 * @param toPublicKey Recipient's public key
 * @param amount Amount to transfer
 * @returns Prepared transaction
 */
export async function createTransferTransaction(
  connection: Connection,
  fromKeypair: Keypair,
  toPublicKey: PublicKey,
  amount: number,
): Promise<Transaction> {
  return withErrorHandling(
    "Create transfer transaction",
    async () => {
      const transaction = new Transaction();
      const usdcMint = getUsdcMint();

      // Get the from and to token accounts
      const fromTokenAccount = await getAssociatedTokenAddress(usdcMint, fromKeypair.publicKey);

      const toTokenAccount = await getAssociatedTokenAddress(usdcMint, toPublicKey);

      // Check if destination token account exists
      const toTokenAccountInfo = await connection.getAccountInfo(toTokenAccount);

      // If destination token account doesn't exist, create it
      if (!toTokenAccountInfo) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            fromKeypair.publicKey, // payer
            toTokenAccount, // ata
            toPublicKey, // owner
            usdcMint, // mint
          ),
        );
      }

      // Add transfer instruction
      transaction.add(
        createTransferInstruction(
          fromTokenAccount, // source
          toTokenAccount, // destination
          fromKeypair.publicKey, // owner
          amount * Math.pow(10, 6), // amount in USDC (6 decimals)
        ),
      );

      // Get latest blockhash
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = fromKeypair.publicKey;

      return transaction;
    },
    async (error, operation) => {
      // Format error based on specific error types
      const formattedError = formatUserError(error, operation);

      if (error instanceof Error) {
        const errorMsg = error.message.toLowerCase();

        if (errorMsg.includes("insufficient") || errorMsg.includes("balance")) {
          throw new Error("Insufficient balance for transfer. Please check your account balance.");
        }

        if (errorMsg.includes("invalid") && errorMsg.includes("address")) {
          throw new Error("Invalid recipient address. Please check the address and try again.");
        }

        if (errorMsg.includes("network") || errorMsg.includes("connection")) {
          throw new Error("Network connection error. Please check your internet connection and try again.");
        }
      }

      // Default error message
      throw new Error(`Transfer preparation failed: ${formattedError.message}`);
    },
    {
      fromPublicKey: fromKeypair.publicKey.toString(),
      toPublicKey: toPublicKey.toString(),
      amount,
    },
  );
}
