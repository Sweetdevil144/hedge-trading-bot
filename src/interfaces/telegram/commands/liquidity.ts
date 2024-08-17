// src/commands/liquidity.ts
import { MyContext } from "../types";
import { WalletStore } from "../services/wallet";
import { Keypair } from "@solana/web3.js";

/**
 * Step 1. Triggered by /liquidity or "🌀 Liquidity" button
 */
export async function handleAddLiquidity(ctx: MyContext, walletStore: WalletStore) {
  if (!ctx.chat?.id || !ctx.from?.id) {
    console.error("Chat/User ID is undefined");
    return;
  }

  // Ensure user has a wallet
  const userId = ctx.from.id.toString();
  let wallet = walletStore.getWallet(userId);
  if (!wallet) {
    wallet = walletStore.createWallet(userId);
  }

  // Ask user how much USDC and USDi they'd like to deposit
  ctx.session.waitingForLiquidityAmounts = true;

  await ctx.reply(
    "Enter the USDC and USDi amounts you want to deposit in the format:\n\n" +
      "`<USDC_amount> <USDi_amount>`\n\n" +
      "Example: `100 50`",
    {
      parse_mode: "Markdown",
    },
  );
}

/**
 * Step 2. Handle the amounts from the user's text
 */
export async function handleAddLiquidityAmounts(ctx: MyContext, walletStore: WalletStore) {
  if (!ctx.message?.text) {
    await ctx.reply("❌ Please enter amounts in the format `100 50`");
    return;
  }

  const parts = ctx.message.text.split(" ").map((p) => p.trim());
  if (parts.length < 2) {
    await ctx.reply("❌ Please enter two numbers, e.g. `100 50`");
    return;
  }

  const usdcAmount = parseFloat(parts[0]);
  const usdiAmount = parseFloat(parts[1]);

  if (isNaN(usdcAmount) || isNaN(usdiAmount) || usdcAmount <= 0 || usdiAmount <= 0) {
    await ctx.reply("❌ Invalid amounts. Try again with e.g. `100 50`");
    return;
  }

  // Reset the flag so we don't process again
  ctx.session.waitingForLiquidityAmounts = false;

  // Get user's Keypair
  const userId = ctx.from?.id.toString();
  if (!userId) {
    await ctx.reply("❌ Could not determine user ID.");
    return;
  }
  const wallet = walletStore.getWallet(userId);
  if (!wallet) {
    await ctx.reply("❌ You have no wallet. Please use /start to create one.");
    return;
  }
  const userKeypair = Keypair.fromSecretKey(Buffer.from(wallet.secretKey, "base64"));

  // Perform deposit
  await ctx.reply("Processing your liquidity deposit... please wait.");

  try {
    // const connection = walletStore.getConnection();
    // const orcaService = new OrcaLiquidityService(connection);
    // const txSig = await orcaService.depositLiquidity(
    //   userKeypair,
    //   usdcAmount,
    //   usdiAmount
    // );
    // await ctx.reply(
    //   `✅ Successfully deposited:\n` +
    //     `• USDC: ${usdcAmount}\n` +
    //     `• USDi: ${usdiAmount}\n\n` +
    //     `Transaction: https://explorer.solana.com/tx/${txSig}?cluster=mainnet`
    // );
  } catch (err) {
    console.error("Error depositing liquidity:", err);
    await ctx.reply("❌ Failed to deposit liquidity. Please try again later.");
  }
}
