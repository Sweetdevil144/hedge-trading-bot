import { MyContext } from "../types";
import { WalletStore } from "../services/wallet";
import { createSwapTransaction } from "../services/swap";
import { TransactionMessage, VersionedTransaction, SendTransactionError } from "@solana/web3.js";
import { validateTransactionAmount, validateSolBalance, formatAmount } from "../utils/validation";
import { formatUserError, ErrorType } from "../utils/errorHandler";

export async function handleConvert(ctx: MyContext, walletStore: WalletStore) {
  if (!ctx.chat?.id || !ctx.from?.id) {
    console.error("Chat/User ID is undefined");
    return;
  }

  const userId = ctx.from.id.toString();
  let wallet = walletStore.getWallet(userId);
  if (!wallet) {
    wallet = walletStore.createWallet(userId);
  }

  // Check balances
  const solBalance = await walletStore.checkSolBalance(userId);
  const usdiBalance = await walletStore.checkUsdiBalance(userId);

  // Validate SOL balance
  const solValidation = validateSolBalance(solBalance);
  if (!solValidation.isValid) {
    await ctx.reply(
      `❌ ${solValidation.error}\n\nYour current balance is ${formatAmount(solBalance, "SOL")} SOL.\n\nPlease deposit some SOL to your wallet: \`${wallet.publicKey}\``,
    );
    return;
  }

  // No USDi
  if (usdiBalance <= 0) {
    await ctx.reply(`You don't have any USDi to convert. First, get some USDi by using the /mint command.`);
    return;
  }

  ctx.session.waitingForConversionAmount = true;
  await ctx.reply(
    `You have ${formatAmount(usdiBalance, "USDi")} USDi available.\n\nHow much would you like to convert back to USDC?\nEnter an amount (e.g. 50) or type "max" for entire balance.`,
  );
}

export async function handleConvertAmount(
  ctx: MyContext,
  walletStore: WalletStore,
  amountInput: number | string,
) {
  // Reset the state
  ctx.session.waitingForConversionAmount = false;

  const userId = ctx.from?.id.toString() || "";
  const usdiBalance = await walletStore.checkUsdiBalance(userId);

  // Handle "max" input
  if (typeof amountInput === "string" && amountInput.toLowerCase() === "max") {
    return handleConvertMax(ctx, walletStore);
  }

  // Validate input amount
  const validation = validateTransactionAmount(amountInput, usdiBalance);
  if (!validation.isValid) {
    await ctx.reply(`❌ ${validation.error}`);
    return;
  }

  const amountToConvert = validation.parsedAmount!;

  await ctx.reply(`Converting ${formatAmount(amountToConvert, "USDi")} USDi to USDC...`);

  try {
    // Get wallet and create transaction
    const keypair = walletStore.getKeypairForUser(userId);
    const connection = walletStore.getConnection();
    const transaction = await createSwapTransaction(
      connection,
      keypair,
      amountToConvert,
      true, // isWithdrawal = true
    );

    // Create a versioned transaction
    const latestBlockhash = await connection.getLatestBlockhash();

    const messageV0 = new TransactionMessage({
      payerKey: keypair.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: transaction.instructions,
    }).compileToV0Message();

    const versionedTransaction = new VersionedTransaction(messageV0);

    // Sign the transaction
    versionedTransaction.sign([keypair]);

    // Send the transaction
    const signature = await connection.sendTransaction(versionedTransaction);

    // Provide a link to the transaction
    await ctx.reply(
      `✅ Conversion sent! Transaction: https://explorer.solana.com/tx/${signature}?cluster=mainnet`,
    );

    // Confirming transaction
    const confirmationStrategy = {
      signature,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      blockhash: latestBlockhash.blockhash,
    };

    await connection.confirmTransaction(confirmationStrategy);

    // Check final status
    await ctx.reply("Checking transaction status...");
    const status = await connection.getSignatureStatus(signature);

    if (status.value?.err) {
      console.error("Transaction error details:", status.value.err);
      await ctx.reply(`❌ The conversion could not be completed. Please try again later.`);
    } else {
      // Update balances
      const newUsdcBalance = await walletStore.checkUsdcBalance(userId);
      const newUsdiBalance = await walletStore.checkUsdiBalance(userId);

      await ctx.reply(
        `✅ Successfully converted ${formatAmount(amountToConvert, "USDi")} USDi to USDC!\n\n` +
          `New USDC balance: ${formatAmount(newUsdcBalance, "USDC")} USDC\n` +
          `New USDi balance: ${formatAmount(newUsdiBalance, "USDi")} USDi`,
      );
    }
  } catch (error: any) {
    console.error("Error during conversion:", error);

    // Log the detailed error for debugging
    if (error instanceof SendTransactionError) {
      console.error("Transaction logs:", error.logs);
    }

    // Provide user-friendly error message based on error type
    let userMessage = "The conversion could not be completed. Please try again later.";

    if (error.message.includes("program that does not exist")) {
      userMessage = "The redeem service is temporarily unavailable. Please try again later.";
    } else if (error.message.includes("insufficient funds")) {
      userMessage =
        "You don't have enough SOL to pay for transaction fees. Please deposit some SOL and try again.";
    } else if (error.message.includes("blockhash")) {
      userMessage = "The transaction timed out. Please try again.";
    } else if (error.message.includes("simulate")) {
      userMessage = "The transaction couldn't be processed. Our team has been notified.";
    }

    await ctx.reply(`❌ ${userMessage}`);
  }
}

/**
 * Handle "max" amount input
 */
export async function handleConvertMax(ctx: MyContext, walletStore: WalletStore) {
  const userId = ctx.from?.id.toString() || "";
  const usdiBalance = await walletStore.checkUsdiBalance(userId);

  // Process with the entire balance
  await handleConvertAmount(ctx, walletStore, usdiBalance);
}
