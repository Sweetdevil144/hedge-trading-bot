import { Bot, Middleware, session } from "grammy";
import * as dotenv from "dotenv";
import { Keypair } from "@solana/web3.js";

import { MyContext, SessionData } from "./types";
import { WalletStore } from "./services/wallet";
import { ChatHistoryStore } from "./services/chatHistory";

// Existing commands
import { handleDeposit } from "./commands/deposit";
import { handleMintYield, handleMintAmount, handleMintMax } from "./commands/mint";
import { handleBalance } from "./commands/balance";
import { handleConvert, handleConvertAmount, handleConvertMax } from "./commands/redeem";
import { handleWithdraw, handleWithdrawalAmount, handleWithdrawalAddress } from "./commands/withdraw";
import {
  handleBackup,
  handleRecover,
  handleRecoverWithSeed,
  handleReset,
  handleResetConfirmation,
} from "./commands/wallet";

// === New Orca functionality ===
import {
  fetchPoolStats,
  depositLiquidity,
  fetchUserPositions,
  closePositionFully,
} from "./services/orcaLiquidity";
import { PREDEFINED_POOLS } from "./utils/constants";
import { connectionManager } from "./services/connectionManager";

dotenv.config();

const walletStore = new WalletStore();
const chatHistoryStore = new ChatHistoryStore();

if (!process.env.BOT_TOKEN) {
  throw new Error("Missing BOT_TOKEN in environment variables!");
}
const bot = new Bot<MyContext>(process.env.BOT_TOKEN);

// Chat history middleware
const chatHistoryMiddleware: Middleware<MyContext> = async (ctx, next) => {
  if (!ctx.from?.id) return next();

  const userId = ctx.from.id.toString();
  if (ctx.message?.text) {
    chatHistoryStore.addMessage(userId, "user", ctx.message.text);
  }

  const origReply = ctx.reply.bind(ctx);
  ctx.reply = async (text, ...args) => {
    const msg = await origReply(text, ...args);
    chatHistoryStore.addMessage(userId, "bot", text);
    return msg;
  };

  return next();
};
bot.use(chatHistoryMiddleware);

// Session
bot.use(
  session({
    initial: (): SessionData => ({
      waitingForMintAmount: false,
      waitingForConversionAmount: false,
      waitingForWithdrawalAmount: false,
      waitingForAddress: false,
      waitingForResetConfirmation: false,
      waitingForSeedPhrase: false,
      withdrawalAmount: undefined,
    }),
  }),
);

// Show predefined pools
bot.command("pools", async (ctx) => {
  let msg = "Supported Pools:\n\n";
  PREDEFINED_POOLS.forEach((p: any, i: number) => {
    msg += `${i}. ${p.label}\n`;
  });

  // Add current network information
  const network = connectionManager.getCurrentNetwork();
  msg += `\nCurrent network: ${network}`;

  await ctx.reply(msg);
});

// fetch minimal stats: /poolstats <index>
// currently not working 
bot.command("poolstats", async (ctx) => {
  const text = ctx.message?.text || "";
  const parts = text.split(" ");
  if (parts.length < 2) {
    await ctx.reply("Usage: /poolstats <poolIndex>");
    return;
  }
  const index = parseInt(parts[1]);
  if (isNaN(index) || index < 0 || index >= PREDEFINED_POOLS.length) {
    await ctx.reply("Invalid pool index.");
    return;
  }

  const pool = PREDEFINED_POOLS[index];
  await ctx.reply(`Fetching stats for ${pool.label}...`);
  try {
    // Use updated fetchPoolStats function
    const stats = await fetchPoolStats(pool.whirlpoolAddress.toString());
    await ctx.reply(`Pool Info:\n${JSON.stringify(stats, null, 2)}`);
  } catch (err) {
    console.error("Error fetching pool stats:", err);
    await ctx.reply("❌ Failed to fetch pool stats.");
  }
});

// Deposit liquidity: /pooldeposit <poolIndex> <amount>
bot.command("pooldeposit", async (ctx) => {
  const text = ctx.message?.text || "";
  const parts = text.split(" ");
  if (parts.length < 3) {
    await ctx.reply("Usage: /pooldeposit <poolIndex> <amount>\nExample: `/pooldeposit 0 1000`");
    return;
  }

  const index = parseInt(parts[1]);
  const rawAmount = parts[2];
  if (isNaN(index) || index < 0 || index >= PREDEFINED_POOLS.length) {
    await ctx.reply("Invalid pool index.");
    return;
  }

  let tokenA: bigint;
  try {
    tokenA = BigInt(rawAmount);
  } catch {
    await ctx.reply("Invalid amount. Must be integer in BigInt form, e.g. `1000` => 1000n.");
    return;
  }

  const userId = ctx.from?.id.toString() || "unknown";
  const pool = PREDEFINED_POOLS[index];

  await ctx.reply(`Depositing into ${pool.label} with tokenA=${tokenA}. Please wait...`);
  try {
    // Use updated depositLiquidity function
    const txSig = await depositLiquidity(walletStore, userId, pool.whirlpoolAddress.toString(), tokenA);

    // Use connectionManager to generate Explorer URL
    const explorerUrl = connectionManager.getExplorerUrl(txSig);
    await ctx.reply(`✅ Deposit successful!\nTx: ${explorerUrl}`);
  } catch (err) {
    console.error("Deposit error:", err);
    await ctx.reply("❌ Deposit failed. Check logs for details.");
  }
});

// show user positions: /positions
bot.command("positions", async (ctx) => {
  const userId = ctx.from?.id.toString() || "unknown";
  await ctx.reply("Fetching your positions, please wait...");
  try {
    // Use updated fetchUserPositions function
    const positions = await fetchUserPositions(walletStore, userId);
    if (!positions.length) {
      await ctx.reply("You have no positions open.");
      return;
    }
    let msg = `You have ${positions.length} position(s):\n\n`;
    positions.forEach((pos: any, i: number) => {
      msg += `${i}. positionMint: ${pos.positionMint}\n`;
      msg += `   liquidity: ${pos.liquidity}\n`;
      msg += `   tickLower: ${pos.tickLowerIndex}, tickUpper: ${pos.tickUpperIndex}\n\n`;
    });
    await ctx.reply(msg);
  } catch (err) {
    console.error("Error fetching positions:", err);
    await ctx.reply("❌ Failed to fetch positions.");
  }
});

// Withdraw or Close position fully: /closepos <positionMint>
bot.command("closepos", async (ctx) => {
  const text = ctx.message?.text || "";
  const parts = text.split(" ");
  if (parts.length < 2) {
    await ctx.reply("Usage: /closepos <positionMint>\nExample: `/closepos 8o7kR8...`");
    return;
  }
  const positionMint = parts[1];
  const userId = ctx.from?.id.toString() || "unknown";

  await ctx.reply(`Closing position ${positionMint} fully. Please wait...`);
  try {
    // Use updated closePositionFully function
    const txSig = await closePositionFully(walletStore, userId, positionMint);

    // Use connectionManager to generate Explorer URL
    const explorerUrl = connectionManager.getExplorerUrl(txSig);
    await ctx.reply(`✅ Position closed!\nTx: ${explorerUrl}`);
  } catch (err) {
    console.error("Close position error:", err);
    await ctx.reply("❌ Failed to close position. Check logs.");
  }
});

bot.command("start", async (ctx) => {
  if (!ctx.chat?.id || !ctx.from?.id) return;

  const userId = ctx.from.id.toString();
  if (!walletStore.getWallet(userId)) {
    walletStore.createWallet(userId);
  }

  await ctx.reply("Welcome to Kira! 🌟\n\nUse the menu below or type /help:", {
    reply_markup: {
      keyboard: [
        [{ text: "💰 Wallet Address" }],
        [{ text: "💎 Mint" }, { text: "📊 Check Balance" }],
        [{ text: "🌀 Liquidity" }],
        [{ text: "🔒 Backup Wallet" }, { text: "🔄 Reset Wallet" }],
      ],
      resize_keyboard: true,
    },
  });
});

bot.hears("💰 Wallet Address", (ctx) => handleDeposit(ctx, walletStore));
bot.hears("💎 Mint", (ctx) => handleMintYield(ctx, walletStore));
bot.hears("📊 Check Balance", (ctx) => handleBalance(ctx, walletStore));
bot.hears("🌀 Liquidity", async (ctx) => {
  await ctx.reply("Try /pools, /poolstats <i>, /pooldeposit <i> <amt>, etc.");
});
bot.hears("🔒 Backup Wallet", (ctx) => handleBackup(ctx, walletStore));
bot.hears("🔄 Reset Wallet", (ctx) => handleReset(ctx, walletStore));

// Slash commands you already had
bot.command("wallet", (ctx) => handleDeposit(ctx, walletStore));
bot.command("deposit", (ctx) => handleDeposit(ctx, walletStore));
bot.command("mint", (ctx) => handleMintYield(ctx, walletStore));
bot.command("balance", (ctx) => handleBalance(ctx, walletStore));
bot.command("redeem", (ctx) => handleConvert(ctx, walletStore));
bot.command("withdraw", (ctx) => handleWithdraw(ctx, walletStore));
bot.command("backup", (ctx) => handleBackup(ctx, walletStore));
bot.command("reset", (ctx) => handleReset(ctx, walletStore));
bot.command("recover", (ctx) => handleRecover(ctx, walletStore));

// Reset callbacks
bot.callbackQuery("confirm_reset", async (ctx) => {
  await handleResetConfirmation(ctx, walletStore, true);
  await ctx.answerCallbackQuery();
});
bot.callbackQuery("cancel_reset", async (ctx) => {
  await handleResetConfirmation(ctx, walletStore, false);
  await ctx.answerCallbackQuery();
});

// Text-based "router" for older flows
bot.on("message:text", async (ctx) => {
  if (!ctx.from?.id) return;
  const text = ctx.message.text;

  console.log("ctx.session", ctx.session);

  // Check for special commands that should always work regardless of session state
  if (text.toLowerCase() === "help" || text.toLowerCase() === "/help") {
    await ctx.reply(
      "🤖 Available Commands:\n\n" +
        "/deposit - Get deposit address\n" +
        "/mint - Mint USDi\n" +
        "/balance - Check balances\n" +
        "/redeem - Convert USDi->USDC\n" +
        "/withdraw - Withdraw USDC\n" +
        "/pools - List supported Orca pools\n" +
        "/poolstats <i> - Show stats for pool index i\n" +
        "/pooldeposit <i> <amt> - Deposit liquidity to pool i\n" +
        "/positions - Show your positions\n" +
        "/closepos <mint> - Close a position fully\n" +
        "Need help? Contact @kira_support",
    );
    return;
  }

  // Reset any stuck states if user types 'cancel' or 'exit'
  if (text.toLowerCase() === "cancel" || text.toLowerCase() === "exit") {
    // Reset all waiting states
    ctx.session.waitingForMintAmount = false;
    ctx.session.waitingForConversionAmount = false;
    ctx.session.waitingForWithdrawalAmount = false;
    ctx.session.waitingForAddress = false;
    ctx.session.waitingForResetConfirmation = false;
    ctx.session.waitingForSeedPhrase = false;
    ctx.session.withdrawalAmount = undefined;

    await ctx.reply("✅ Operation cancelled. What would you like to do next?");
    return;
  }

  // 1) Mint flow
  if (ctx.session.waitingForMintAmount) {
    if (text.toLowerCase() === "max") {
      await handleMintMax(ctx, walletStore);
    } else {
      const amount = parseFloat(text);
      if (!isNaN(amount) && amount > 0) {
        await handleMintAmount(ctx, walletStore, amount);
      } else {
        await ctx.reply(
          "❌ Please enter a valid amount or type 'max'. Or type 'cancel' to exit this operation.",
        );
        ctx.session.waitingForMintAmount = false;
        // console.log("ctx.session", ctx.session);
      }
    }
    return;
  }

  // 2) Convert flow
  if (ctx.session.waitingForConversionAmount) {
    if (text.toLowerCase() === "max") {
      await handleConvertMax(ctx, walletStore);
    } else {
      const amount = parseFloat(text);
      if (!isNaN(amount) && amount > 0) {
        await handleConvertAmount(ctx, walletStore, amount);
      } else {
        await ctx.reply(
          "❌ Please enter a valid amount or type 'max'. Or type 'cancel' to exit this operation.",
        );
        ctx.session.waitingForConversionAmount = false;
      }
    }
    return;
  }

  // 3) Withdraw flow
  if (ctx.session.waitingForWithdrawalAmount) {
    if (text.toLowerCase() === "max") {
      // Pass "max" to the handler which will use maximum available balance
      await handleWithdrawalAmount(ctx, walletStore, "max");
    } else {
      const amount = parseFloat(text);
      if (!isNaN(amount) && amount > 0) {
        await handleWithdrawalAmount(ctx, walletStore, amount);
      } else {
        await ctx.reply(
          "❌ Please enter a valid amount or type 'max'. Or type 'cancel' to exit this operation.",
        );
        ctx.session.waitingForWithdrawalAmount = false;
      }
    }
    return;
  }

  if (ctx.session.waitingForAddress && ctx.session.withdrawalAmount) {
    await handleWithdrawalAddress(ctx, walletStore, text, ctx.session.withdrawalAmount);
    return;
  }

  // 4) Seed phrase flow
  if (ctx.session.waitingForSeedPhrase) {
    await handleRecoverWithSeed(ctx, walletStore, text);
    return;
  }

  // No specific waiting state - check for common text commands
  if (text.toLowerCase() === "wallet" || text.toLowerCase() === "deposit") {
    await handleDeposit(ctx, walletStore);
  } else if (text.toLowerCase() === "mint") {
    await handleMintYield(ctx, walletStore);
  } else if (text.toLowerCase() === "balance") {
    await handleBalance(ctx, walletStore);
  } else if (text.toLowerCase() === "redeem") {
    await handleConvert(ctx, walletStore);
  }
});

// /help command
bot.command("help", async (ctx) => {
  await ctx.reply(
    "🤖 Available Commands:\n\n" +
      "/deposit - Get deposit address\n" +
      "/mint - Mint USDi\n" +
      "/balance - Check balances\n" +
      "/redeem - Convert USDi->USDC\n" +
      "/withdraw - Withdraw USDC\n" +
      "/pools - List supported Orca pools\n" +
      "/poolstats <i> - Show stats for pool index i\n" +
      "/pooldeposit <i> <amt> - Deposit liquidity to pool i\n" +
      "/positions - Show your positions\n" +
      "/closepos <mint> - Close a position fully\n" +
      "Need help? Contact @kira_support",
  );
});

// Global error handler
bot.catch((err) => {
  console.error("Bot error:", err);
});

export { bot };
