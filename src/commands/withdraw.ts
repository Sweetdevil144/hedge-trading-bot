import { MyContext } from "../types";
import { WalletStore } from "../services/wallet";
import { PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createTransferTransaction } from "../services/transfer";
import {
  validateTransactionAmount,
  validateSolBalance,
  validateSolanaAddress,
  formatAmount,
} from "../utils/validation";

export async function handleWithdraw(ctx: MyContext, walletStore: WalletStore) {
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
  const usdcBalance = await walletStore.checkUsdcBalance(userId);

  // Validate SOL balance
  const solValidation = validateSolBalance(solBalance);
  if (!solValidation.isValid) {
    await ctx.reply(
      `❌ ${solValidation.error}\n\nYour current balance is ${formatAmount(solBalance, "SOL")} SOL.\n\nPlease deposit some SOL to your wallet: \`${wallet.publicKey}\``,
    );
    return;
  }

  // No USDC
  if (usdcBalance <= 0) {
    await ctx.reply(
      `You don't have any USDC to withdraw.\n\nYou need to have USDC in your wallet first. Use /deposit to add funds.`,
    );
    return;
  }

  ctx.session.waitingForWithdrawalAmount = true;
  await ctx.reply(
    `You have ${formatAmount(usdcBalance, "USDC")} USDC available for withdrawal.\n\nHow much would you like to withdraw?\nEnter an amount (e.g. 50) or type "max" for entire balance.`,
  );
}

export async function handleWithdrawalAmount(
  ctx: MyContext,
  walletStore: WalletStore,
  amountInput: number | string,
) {
  const userId = ctx.from?.id.toString() || "";
  const usdcBalance = await walletStore.checkUsdcBalance(userId);

  // Handle "max" input
  if (typeof amountInput === "string" && amountInput.toLowerCase() === "max") {
    // Process with the entire balance
    amountInput = usdcBalance;
  }

  // Validate input amount
  const validation = validateTransactionAmount(amountInput, usdcBalance);
  if (!validation.isValid) {
    await ctx.reply(`❌ ${validation.error}`);
    // Reset state
    ctx.session.waitingForWithdrawalAmount = false;
    return;
  }

  // Store amount for next step
  ctx.session.withdrawalAmount = validation.parsedAmount;
  ctx.session.waitingForWithdrawalAmount = false;
  ctx.session.waitingForAddress = true;

  await ctx.reply(
    `Please enter the Solana address where you want to withdraw ${formatAmount(validation.parsedAmount!, "USDC")} USDC:`,
  );
}

export async function handleWithdrawalAddress(
  ctx: MyContext,
  walletStore: WalletStore,
  addressText: string,
  amount: number,
) {
  // Reset the state
  ctx.session.waitingForAddress = false;
  ctx.session.withdrawalAmount = undefined;

  // Validate address
  const addressValidation = validateSolanaAddress(addressText.trim());
  if (!addressValidation.isValid) {
    await ctx.reply(`❌ ${addressValidation.error}\n\nPlease try again with /withdraw.`);
    return;
  }

  let destinationAddress: PublicKey;
  try {
    destinationAddress = new PublicKey(addressText.trim());
  } catch (error) {
    await ctx.reply("❌ Invalid Solana address. Please try again with /withdraw.");
    return;
  }

  await ctx.reply(
    `Processing withdrawal of ${formatAmount(amount, "USDC")} USDC to ${destinationAddress.toString()}...`,
  );

  try {
    const userId = ctx.from?.id.toString() || "";
    const keypair = walletStore.getKeypairForUser(userId);
    const connection = walletStore.getConnection();

    // Create transfer transaction
    const transaction = await createTransferTransaction(connection, keypair, destinationAddress, amount);

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
      `✅ Withdrawal sent! Transaction: https://explorer.solana.com/tx/${signature}?cluster=mainnet`,
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
      await ctx.reply(`❌ Transaction failed: ${JSON.stringify(status.value.err)}`);
    } else {
      // Update balance
      const newUsdcBalance = await walletStore.checkUsdcBalance(userId);

      await ctx.reply(
        `✅ Successfully withdrew ${formatAmount(amount, "USDC")} USDC to ${destinationAddress.toString()}!\n\n` +
          `New USDC balance: ${formatAmount(newUsdcBalance, "USDC")} USDC`,
      );
    }
  } catch (error: any) {
    console.error("Error during withdrawal:", error);
    await ctx.reply(`❌ Error during withdrawal: ${error.message || "Unknown error"}`);
  }
}
