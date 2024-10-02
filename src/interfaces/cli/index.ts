/**
 * CLI Interface - Command-line interface for Hedge Trading Bot
 * Prompt_3 Implementation
 */

import { Command } from "commander";
import chalk from "chalk";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { WalletStore } from "../../services/wallet";
import { HedgeEngine } from "../../core/hedgeEngine";
import { PositionManager } from "../../core/positionManager";
import { OrderExecutor } from "../../core/orderExecutor";
import { createTransactionMonitor } from "../../services/transactionMonitor";
import { marketDataService } from "../../services/marketData";
import { AutomationEngine } from "../../core/automationEngine";
import { HedgeStrategy } from "../../strategies/hedgeStrategy";
import { SignalEngine } from "../../core/signalEngine";
import {
  executeDirectSwap,
  executeBuyOrder,
  executeSellOrder,
  getSwapQuote,
  fetchUserPositions,
  fetchPoolStats,
} from "../../services/orcaLiquidity";
import {
  showBanner,
  createTable,
  formatCurrency,
  formatPercentage,
  formatDate,
  displayPnL,
  displayStatus,
  withSpinner,
  success,
  error,
  warning,
  info,
  confirm,
  promptInput,
  promptPassword,
  selectFromList,
  getCurrentUser,
  setCurrentUser,
  parseAmount,
  handleError,
  loadCliConfig,
  saveCliConfig,
} from "./utils";
import { AppConfig } from "../../utils/config";

// Load environment variables
dotenv.config();

// Initialize Prisma
const prisma = new PrismaClient();

// Initialize services
const walletStore = new WalletStore();
const hedgeEngine = new HedgeEngine(prisma, walletStore);
const positionManager = new PositionManager(prisma);
const orderExecutor = new OrderExecutor(walletStore, prisma);
const transactionMonitor = createTransactionMonitor(prisma);
const signalEngine = new SignalEngine(prisma);
const automationEngine = new AutomationEngine(prisma, { dryRun: false });

/**
 * Create CLI program
 */
export function createCliProgram(): Command {
  const program = new Command();

  program
    .name("hedge-bot")
    .description("CLI for Hedge Trading Bot - Trade, hedge, and manage positions on Solana")
    .version("1.0.0");

  // ===========================================================================
  // ACCOUNT COMMANDS
  // ===========================================================================

  const account = program.command("account").description("Manage your trading account");

  account
    .command("create")
    .description("Create a new trading account")
    .action(async () => {
      try {
        showBanner();
        info("Creating new trading account...");

        const userId = await promptInput("Enter a user ID (or leave blank for auto-generate)");
        const finalUserId = userId || `user_${Date.now()}`;

        await withSpinner("Creating wallet...", async () => {
          await walletStore.createWallet(finalUserId);
        });

        setCurrentUser(finalUserId);

        const wallet = walletStore.getWallet(finalUserId);
        const publicKey = wallet?.publicKey || "Unknown";

        success("Account created successfully!");
        console.log();
        console.log(chalk.bold("User ID:"), finalUserId);
        console.log(chalk.bold("Public Key:"), publicKey);
        console.log();
        warning("Please save your user ID and back up your wallet seed phrase!");
        console.log();
      } catch (err: any) {
        handleError(err);
      }
    });

  account
    .command("balance")
    .description("Check account balance")
    .action(async () => {
      try {
        const userId = getCurrentUser();
        if (!userId) {
          error("No active account. Run 'hedge-bot account login' first");
          return;
        }

        const balance = await withSpinner("Fetching balance...", async () => {
          return await walletStore.checkUsdcBalance(userId);
        });

        console.log();
        console.log(chalk.bold("Account Balance"));
        console.log("─".repeat(40));
        console.log(chalk.bold("USDC:"), chalk.green(formatCurrency(balance)));
        console.log();
      } catch (err: any) {
        handleError(err);
      }
    });

  account
    .command("login")
    .description("Login to an existing account")
    .option("-w, --wallet <path>", "Path to wallet keypair file")
    .option("-u, --user <userId>", "User ID to login")
    .action(async (options) => {
      try {
        let userId: string;

        if (options.user) {
          userId = options.user;
        } else {
          userId = await promptInput("Enter your user ID:");
        }

        // Verify user exists
        const wallet = walletStore.getWallet(userId);
        if (!wallet) {
          error(`User ${userId} not found`);
          return;
        }

        setCurrentUser(userId);
        success(`Logged in as ${userId}`);
      } catch (err: any) {
        handleError(err);
      }
    });

  // ===========================================================================
  // HEDGE TRADING COMMANDS
  // ===========================================================================

  const hedge = program.command("hedge").description("Hedge trading operations");

  hedge
    .command("open")
    .description("Open a new hedge position")
    .argument("<token>", "Token symbol (e.g., SOL, ETH)")
    .argument("<amount>", "Amount to trade")
    .option("-s, --strategy <type>", "Strategy type: delta-neutral | pairs", "delta-neutral")
    .action(async (token, amountStr, options) => {
      try {
        const userId = getCurrentUser();
        if (!userId) {
          error("No active account. Run 'hedge-bot account login' first");
          return;
        }

        const amount = parseAmount(amountStr);
        const strategy = options.strategy;

        console.log();
        info(`Opening ${strategy} hedge position: ${amount} ${token}`);
        console.log();

        const confirmed = await confirm("Are you sure you want to proceed?");
        if (!confirmed) {
          warning("Operation cancelled");
          return;
        }

        const position = await withSpinner("Opening hedge position...", async () => {
          return await hedgeEngine.openHedgePosition(userId, token, amount, strategy);
        });

        success("Hedge position opened successfully!");
        console.log();
        console.log(chalk.bold("Position ID:"), position.id);
        console.log(chalk.bold("Long Side:"), `${position.longSide.amount} ${token} @ ${position.longSide.entryPrice}`);
        console.log(chalk.bold("Short Side:"), `${position.shortSide.amount} ${token} @ ${position.shortSide.entryPrice}`);
        console.log(chalk.bold("Hedge Ratio:"), position.hedgeRatio);
        console.log();
      } catch (err: any) {
        handleError(err);
      }
    });

  hedge
    .command("close")
    .description("Close a hedge position")
    .argument("<positionId>", "Position ID to close")
    .action(async (positionId) => {
      try {
        const userId = getCurrentUser();
        if (!userId) {
          error("No active account. Run 'hedge-bot account login' first");
          return;
        }

        info(`Closing hedge position: ${positionId}`);
        console.log();

        const confirmed = await confirm("Are you sure you want to close this position?");
        if (!confirmed) {
          warning("Operation cancelled");
          return;
        }

        const result = await withSpinner("Closing hedge position...", async () => {
          return await hedgeEngine.closeHedgePosition(positionId);
        });

        success("Hedge position closed successfully!");
        console.log();
        console.log(chalk.bold("Total P&L:"), displayPnL(result.totalPnl));
        console.log(chalk.bold("Long P&L:"), displayPnL(result.longPnl));
        console.log(chalk.bold("Short P&L:"), displayPnL(result.shortPnl));
        console.log();
      } catch (err: any) {
        handleError(err);
      }
    });

  hedge
    .command("list")
    .description("List all hedge positions")
    .option("-s, --status <status>", "Filter by status: open | closed")
    .action(async (options) => {
      try {
        const userId = getCurrentUser();
        if (!userId) {
          error("No active account. Run 'hedge-bot account login' first");
          return;
        }

        const positions = await withSpinner("Fetching hedge positions...", async () => {
          return await hedgeEngine.getHedgePositions(userId);
        });

        if (positions.length === 0) {
          info("No hedge positions found");
          return;
        }

        const filteredPositions = options.status
          ? positions.filter((p) => p.status === options.status)
          : positions;

        const table = createTable([
          "ID",
          "Token",
          "Long Amount",
          "Short Amount",
          "Ratio",
          "P&L",
          "Status",
        ]);

        filteredPositions.forEach((pos) => {
          table.push([
            pos.id.slice(0, 8) + "...",
            pos.longSide.token,
            pos.longSide.amount.toFixed(2),
            pos.shortSide.amount.toFixed(2),
            pos.hedgeRatio.toFixed(2),
            displayPnL(pos.pnl),
            displayStatus(pos.status.toUpperCase()),
          ]);
        });

        console.log();
        console.log(table.toString());
        console.log();
        info(`Total positions: ${filteredPositions.length}`);
        console.log();
      } catch (err: any) {
        handleError(err);
      }
    });

  hedge
    .command("status")
    .description("Get status of a hedge position")
    .argument("<positionId>", "Position ID")
    .action(async (positionId) => {
      try {
        const userId = getCurrentUser();
        if (!userId) {
          error("No active account. Run 'hedge-bot account login' first");
          return;
        }

        const pnl = await withSpinner("Fetching position status...", async () => {
          return await hedgeEngine.getPositionPnL(positionId);
        });

        console.log();
        console.log(chalk.bold("Position Status"));
        console.log("─".repeat(40));
        console.log(chalk.bold("Position ID:"), positionId);
        console.log(chalk.bold("Current P&L:"), displayPnL(pnl));
        console.log();
      } catch (err: any) {
        handleError(err);
      }
    });

  hedge
    .command("rebalance")
    .description("Rebalance a hedge position")
    .argument("<positionId>", "Position ID to rebalance")
    .action(async (positionId) => {
      try {
        const userId = getCurrentUser();
        if (!userId) {
          error("No active account. Run 'hedge-bot account login' first");
          return;
        }

        await withSpinner("Rebalancing position...", async () => {
          await hedgeEngine.rebalancePosition(positionId);
        });

        success("Position rebalanced successfully!");
      } catch (err: any) {
        handleError(err);
      }
    });

  // ===========================================================================
  // TRADING COMMANDS
  // ===========================================================================

  const trade = program.command("trade").description("Trading operations");

  trade
    .command("swap")
    .description("Swap tokens")
    .argument("<from>", "From token symbol")
    .argument("<to>", "To token symbol")
    .argument("<amount>", "Amount to swap")
    .option("-s, --slippage <bps>", "Slippage in basis points", "200")
    .action(async (from, to, amountStr, options) => {
      try {
        const userId = getCurrentUser();
        if (!userId) {
          error("No active account. Run 'hedge-bot account login' first");
          return;
        }

        const amount = parseAmount(amountStr);
        const slippage = parseInt(options.slippage);

        info(`Swapping ${amount} ${from} → ${to}`);
        console.log();

        const result = await withSpinner("Executing swap...", async () => {
          return await executeDirectSwap(
            walletStore,
            userId,
            from,
            to,
            BigInt(Math.floor(amount * 1_000_000)),
            slippage,
          );
        });

        success("Swap executed successfully!");
        console.log();
        console.log(chalk.bold("Signature:"), result.signature);
        console.log(chalk.bold("Output Amount:"), Number(result.outputAmount) / 1_000_000);
        console.log(chalk.bold("Fee:"), formatCurrency(result.fee));
        console.log();
      } catch (err: any) {
        handleError(err);
      }
    });

  trade
    .command("buy")
    .description("Buy tokens with USDC")
    .argument("<token>", "Token symbol to buy")
    .argument("<amount>", "USDC amount to spend")
    .action(async (token, amountStr) => {
      try {
        const userId = getCurrentUser();
        if (!userId) {
          error("No active account. Run 'hedge-bot account login' first");
          return;
        }

        const amount = parseAmount(amountStr);

        const result = await withSpinner(`Buying ${token}...`, async () => {
          return await executeBuyOrder(
            walletStore,
            userId,
            token,
            BigInt(Math.floor(amount * 1_000_000)),
          );
        });

        success("Buy order executed successfully!");
        console.log();
        console.log(chalk.bold("Tokens Received:"), Number(result.tokenAmount) / 1_000_000);
        console.log(chalk.bold("Average Price:"), formatCurrency(result.averagePrice));
        console.log();
      } catch (err: any) {
        handleError(err);
      }
    });

  trade
    .command("sell")
    .description("Sell tokens for USDC")
    .argument("<token>", "Token symbol to sell")
    .argument("<amount>", "Token amount to sell")
    .action(async (token, amountStr) => {
      try {
        const userId = getCurrentUser();
        if (!userId) {
          error("No active account. Run 'hedge-bot account login' first");
          return;
        }

        const amount = parseAmount(amountStr);

        const result = await withSpinner(`Selling ${token}...`, async () => {
          return await executeSellOrder(
            walletStore,
            userId,
            token,
            BigInt(Math.floor(amount * 1_000_000)),
          );
        });

        success("Sell order executed successfully!");
        console.log();
        console.log(chalk.bold("USDC Received:"), Number(result.usdcAmount) / 1_000_000);
        console.log(chalk.bold("Average Price:"), formatCurrency(result.averagePrice));
        console.log();
      } catch (err: any) {
        handleError(err);
      }
    });

  // ===========================================================================
  // LIQUIDITY COMMANDS
  // ===========================================================================

  const liquidity = program.command("liquidity").description("Liquidity pool operations");

  liquidity
    .command("pools")
    .description("List available liquidity pools")
    .action(async () => {
      try {
        const { PREDEFINED_POOLS } = await import("../../utils/constants");

        const table = createTable(["Index", "Name", "Address"]);

        PREDEFINED_POOLS.forEach((pool, index) => {
          table.push([
            String(index),
            pool.label,
            pool.whirlpoolAddress.toString().slice(0, 20) + "...",
          ]);
        });

        console.log();
        console.log(table.toString());
        console.log();
      } catch (err: any) {
        handleError(err);
      }
    });

  liquidity
    .command("add")
    .description("Add liquidity to a pool")
    .argument("<pool>", "Pool address or index")
    .argument("<amount>", "Amount to add")
    .action(async (pool, amountStr) => {
      try {
        const userId = getCurrentUser();
        if (!userId) {
          error("No active account. Run 'hedge-bot account login' first");
          return;
        }

        const amount = parseAmount(amountStr);

        info(`Adding ${amount} USDC to pool ${pool}`);
        console.log();

        // This would call depositLiquidity
        warning("Liquidity operations require on-chain execution - implementation pending");
        console.log();
      } catch (err: any) {
        handleError(err);
      }
    });

  liquidity
    .command("remove")
    .description("Remove liquidity from a position")
    .argument("<positionId>", "Position NFT mint address")
    .action(async (positionId) => {
      try {
        const userId = getCurrentUser();
        if (!userId) {
          error("No active account. Run 'hedge-bot account login' first");
          return;
        }

        warning("Liquidity operations require on-chain execution - implementation pending");
        console.log();
      } catch (err: any) {
        handleError(err);
      }
    });

  // ===========================================================================
  // MONITORING COMMANDS
  // ===========================================================================

  const monitor = program.command("monitor").description("Monitor positions and performance");

  monitor
    .command("positions")
    .description("Monitor all open positions")
    .action(async () => {
      try {
        const userId = getCurrentUser();
        if (!userId) {
          error("No active account. Run 'hedge-bot account login' first");
          return;
        }

        const positions = await withSpinner("Fetching positions...", async () => {
          return await positionManager.getOpenPositions(userId);
        });

        if (positions.length === 0) {
          info("No open positions");
          return;
        }

        const table = createTable([
          "ID",
          "Type",
          "Token",
          "Amount",
          "Entry Price",
          "Current Price",
          "Unrealized P&L",
        ]);

        for (const pos of positions) {
          table.push([
            pos.id.slice(0, 8) + "...",
            pos.positionType,
            pos.tokenSymbol,
            pos.amount.toFixed(2),
            formatCurrency(pos.entryPrice, ""),
            pos.currentPrice ? formatCurrency(pos.currentPrice, "") : "-",
            displayPnL(pos.unrealizedPnl),
          ]);
        }

        console.log();
        console.log(table.toString());
        console.log();
      } catch (err: any) {
        handleError(err);
      }
    });

  monitor
    .command("pnl")
    .description("Show profit and loss summary")
    .action(async () => {
      try {
        const userId = getCurrentUser();
        if (!userId) {
          error("No active account. Run 'hedge-bot account login' first");
          return;
        }

        const stats = await withSpinner("Calculating P&L...", async () => {
          return await positionManager.getPositionStats(userId);
        });

        console.log();
        console.log(chalk.bold("P&L Summary"));
        console.log("─".repeat(40));
        console.log(chalk.bold("Total P&L:"), displayPnL(stats.totalPnl));
        console.log(chalk.bold("Realized P&L:"), displayPnL(stats.totalPnl));
        console.log(chalk.bold("Unrealized P&L:"), displayPnL(stats.unrealizedPnl));
        console.log(chalk.bold("Net P&L:"), displayPnL(stats.netPnl));
        console.log(chalk.bold("Open Positions:"), stats.openPositions);
        console.log(chalk.bold("Closed Positions:"), stats.closedPositions);
        console.log();
      } catch (err: any) {
        handleError(err);
      }
    });

  // ===========================================================================
  // AUTOMATION COMMANDS (Prompt_4)
  // ===========================================================================

  const auto = program.command("auto").description("Automated trading operations");

  auto
    .command("start")
    .description("Start automated trading")
    .option("-s, --strategy <name>", "Strategy to use (hedge)", "hedge")
    .option("-d, --dry-run", "Run in dry-run mode (no real trades)")
    .action(async (options) => {
      try {
        const userId = getCurrentUser();
        if (!userId) {
          error("No active account. Run 'hedge-bot account login' first");
          return;
        }

        const isDryRun = options.dryRun || false;

        info(
          `Starting automated trading with ${options.strategy} strategy (${isDryRun ? "DRY-RUN" : "LIVE"} mode)`,
        );
        console.log();

        if (!isDryRun) {
          const confirmed = await confirm("Are you sure you want to start LIVE automated trading?");
          if (!confirmed) {
            warning("Operation cancelled");
            return;
          }
        }

        // Set dry-run mode
        automationEngine.setDryRun(isDryRun);

        // Create and register strategy
        const strategyConfig = {
          id: "hedge-1",
          name: "Hedge Strategy",
          enabled: true,
          type: "hedge" as const,
          parameters: {
            minSpread: 0.005, // 0.5%
            maxPositionSize: 100, // $100
            stopLoss: 0.1, // 10%
            takeProfit: 0.05, // 5%
          },
          entryConditions: ["spread > 0.5%"],
          exitConditions: ["spread normalized", "stop-loss", "take-profit"],
        };

        const hedgeStrategy = new HedgeStrategy(strategyConfig, userId, prisma, walletStore);
        automationEngine.registerStrategy(hedgeStrategy);

        // Start automation
        await automationEngine.start();

        success("Automated trading started!");
        console.log();
        warning("Press Ctrl+C to stop automated trading");
        console.log();

        // Keep process alive
        process.on("SIGINT", async () => {
          console.log();
          warning("Stopping automated trading...");
          await automationEngine.stop();
          process.exit(0);
        });
      } catch (err: any) {
        handleError(err);
      }
    });

  auto
    .command("stop")
    .description("Stop automated trading")
    .action(async () => {
      try {
        await withSpinner("Stopping automated trading...", async () => {
          await automationEngine.stop();
        });

        success("Automated trading stopped");
      } catch (err: any) {
        handleError(err);
      }
    });

  auto
    .command("status")
    .description("Show automation status")
    .action(async () => {
      try {
        const status = automationEngine.getStatus();
        const stats = automationEngine.getStats();
        const safetyConfig = automationEngine.getSafetyConfig();

        console.log();
        console.log(chalk.bold("Automation Status"));
        console.log("─".repeat(40));
        console.log(chalk.bold("Running:"), status.running ? chalk.green("Yes") : chalk.red("No"));
        console.log(chalk.bold("Mode:"), status.mode === "dry-run" ? chalk.yellow("DRY-RUN") : chalk.green("LIVE"));
        console.log(chalk.bold("Uptime:"), `${Math.floor(stats.uptime / 1000)}s`);
        console.log(chalk.bold("Strategies:"), status.strategies.join(", "));
        console.log(chalk.bold("Active Strategies:"), stats.strategiesActive);
        console.log(chalk.bold("Positions Opened:"), status.positionsOpened);
        console.log(chalk.bold("Signals Detected:"), status.signalsDetected);
        console.log(chalk.bold("Position Rate:"), `${stats.positionRate}/hour`);
        console.log();
        console.log(chalk.bold("Safety Settings"));
        console.log("─".repeat(40));
        console.log(chalk.bold("Max Positions/Hour:"), safetyConfig.maxPositionsPerHour);
        console.log(chalk.bold("Manual Approval Threshold:"), formatCurrency(safetyConfig.manualApprovalThreshold));
        console.log(chalk.bold("Kill Switch:"), safetyConfig.killSwitch ? chalk.red("ACTIVE") : chalk.green("Inactive"));
        console.log();
      } catch (err: any) {
        handleError(err);
      }
    });

  auto
    .command("kill-switch")
    .description("Activate emergency kill switch (stops all trading)")
    .action(async () => {
      try {
        const confirmed = await confirm(
          "Are you sure you want to activate the KILL SWITCH? This will stop all trading immediately.",
        );

        if (!confirmed) {
          warning("Operation cancelled");
          return;
        }

        automationEngine.activateKillSwitch();
        success("Kill switch activated - all trading stopped");
      } catch (err: any) {
        handleError(err);
      }
    });

  // ===========================================================================
  // SIGNALS COMMANDS (Prompt_4)
  // ===========================================================================

  const signals = program.command("signals").description("Monitor trading signals");

  signals
    .command("watch")
    .description("Watch for trading signals in real-time")
    .option("-p, --pool <address>", "Pool address to monitor")
    .action(async (options) => {
      try {
        const userId = getCurrentUser();
        if (!userId) {
          error("No active account. Run 'hedge-bot account login' first");
          return;
        }

        info("Watching for trading signals... (Press Ctrl+C to stop)");
        console.log();

        // Get pools to monitor
        const { PREDEFINED_POOLS } = await import("../../utils/constants");
        const poolAddress = options.pool || PREDEFINED_POOLS[0].whirlpoolAddress.toString();

        // Start monitoring
        await signalEngine.startMonitoring(poolAddress);

        // Check for signals every 10 seconds
        const interval = setInterval(async () => {
          const signals = await signalEngine.scanForSignals();

          if (signals.length > 0) {
            console.log(chalk.green(`\n[${new Date().toLocaleTimeString()}] Signals detected:`));

            for (const signal of signals) {
              console.log(
                chalk.yellow(`  • ${signal.type.toUpperCase()}: ${signal.reason} (confidence: ${(signal.confidence * 100).toFixed(0)}%)`),
              );
            }
          }
        }, 10000);

        // Handle Ctrl+C
        process.on("SIGINT", () => {
          clearInterval(interval);
          signalEngine.stopMonitoring(poolAddress);
          console.log();
          info("Stopped watching signals");
          process.exit(0);
        });
      } catch (err: any) {
        handleError(err);
      }
    });

  signals
    .command("list")
    .description("List recent signals")
    .action(async () => {
      try {
        const signals = await signalEngine.scanForSignals();

        if (signals.length === 0) {
          info("No signals detected");
          return;
        }

        const table = createTable(["Type", "Reason", "Magnitude", "Confidence", "Time"]);

        for (const signal of signals) {
          table.push([
            signal.type.toUpperCase(),
            signal.reason.slice(0, 40) + "...",
            (signal.magnitude * 100).toFixed(2) + "%",
            (signal.confidence * 100).toFixed(0) + "%",
            signal.timestamp.toLocaleTimeString(),
          ]);
        }

        console.log();
        console.log(table.toString());
        console.log();
      } catch (err: any) {
        handleError(err);
      }
    });

  // ============================================================================
  // PROMPT_5 COMMANDS: Portfolio Analytics & Risk Management
  // ============================================================================

  // Portfolio command
  program
    .command("portfolio")
    .description("View portfolio summary")
    .action(async () => {
      try {
        const userId = getCurrentUser();
        if (!userId) {
          error("No active account. Run 'hedge-bot account login' first");
          return;
        }

        const spinner = createSpinner("Loading portfolio...").start();

        // Import AnalyticsService
        const { AnalyticsService } = await import("../../services/analytics");
        const analyticsService = new AnalyticsService(prisma);

        // Get portfolio summary
        const summary = await analyticsService.getPortfolioSummary(userId);

        spinner.stop();

        console.log();
        console.log(chalk.bold.cyan("Portfolio Summary"));
        console.log(chalk.cyan("━".repeat(60)));
        console.log(`Total Value:        ${formatCurrency(summary.totalValue)}`);
        console.log(`Total P&L:          ${formatPnL(summary.totalPnL)}`);
        console.log(`Today P&L:          ${formatPnL(summary.dayPnL)}`);
        console.log(`Week P&L:           ${formatPnL(summary.weekPnL)}`);
        console.log(`Month P&L:          ${formatPnL(summary.monthPnL)}`);
        console.log();

        console.log(chalk.bold.cyan(`Open Positions: ${summary.openPositions.length}`));
        console.log(chalk.cyan("━".repeat(60)));

        if (summary.openPositions.length > 0) {
          const table = createTable(["ID", "Token", "Amount", "Entry", "Current", "P&L"]);

          for (const pos of summary.openPositions) {
            table.push([
              pos.id.slice(0, 8) + "...",
              pos.tokenMint.slice(0, 10) + "...",
              pos.amount.toFixed(4),
              formatCurrency(pos.entryPrice),
              formatCurrency(pos.currentPrice || pos.entryPrice),
              formatPnL(pos.unrealizedPnl),
            ]);
          }

          console.log(table.toString());
        } else {
          info("No open positions");
        }

        console.log();
        console.log(chalk.bold.cyan("Performance Metrics"));
        console.log(chalk.cyan("━".repeat(60)));
        console.log(`Win Rate:           ${formatPercentage(summary.winRate)}`);
        console.log(`Avg Win:            ${formatCurrency(summary.avgWin)}`);
        console.log(`Avg Loss:           ${formatCurrency(summary.avgLoss)}`);
        console.log();
      } catch (err: any) {
        handleError(err);
      }
    });

  // Position command
  program
    .command("position <id>")
    .description("View detailed position information")
    .action(async (id: string) => {
      try {
        const spinner = createSpinner("Loading position...").start();

        // Import AnalyticsService
        const { AnalyticsService } = await import("../../services/analytics");
        const analyticsService = new AnalyticsService(prisma);

        // Get position metrics
        const metrics = await analyticsService.getPositionMetrics(id);

        // Get position details
        const position = await prisma.position.findUnique({
          where: { id },
        });

        spinner.stop();

        if (!position) {
          error(`Position ${id} not found`);
          return;
        }

        const p: any = position;

        console.log();
        console.log(chalk.bold.cyan(`Position: ${id}`));
        console.log(chalk.cyan("━".repeat(60)));
        console.log(`Status:             ${getStatusBadge(p.status)}`);
        console.log(`Token:              ${p.tokenMint || "N/A"}`);
        console.log(`Amount:             ${p.amount}`);
        console.log(`Entry Price:        ${formatCurrency(p.entryPrice)}`);
        console.log(`Current Price:      ${formatCurrency(p.currentPrice || p.entryPrice)}`);
        console.log();

        console.log(chalk.bold.cyan("Metrics"));
        console.log(chalk.cyan("━".repeat(60)));
        console.log(`Unrealized P&L:     ${formatPnL(metrics.unrealizedPnL)}`);
        console.log(`Realized P&L:       ${formatPnL(metrics.realizedPnL)}`);
        console.log(`ROI:                ${formatPercentage(metrics.roi / 100)}`);
        console.log(`Holding Period:     ${metrics.holdingPeriod.toFixed(2)} hours`);
        console.log(`Total Fees:         ${formatCurrency(metrics.totalFees)}`);
        console.log();

        console.log(chalk.bold.cyan("Timestamps"));
        console.log(chalk.cyan("━".repeat(60)));
        console.log(`Opened:             ${formatDate(p.createdAt)}`);
        if (p.closedAt) {
          console.log(`Closed:             ${formatDate(p.closedAt)}`);
        }
        console.log();
      } catch (err: any) {
        handleError(err);
      }
    });

  // History command
  program
    .command("history")
    .description("View trade history")
    .option("-d, --days <number>", "Number of days to show", "30")
    .action(async (options) => {
      try {
        const userId = getCurrentUser();
        if (!userId) {
          error("No active account. Run 'hedge-bot account login' first");
          return;
        }

        const spinner = createSpinner("Loading trade history...").start();

        // Import AnalyticsService
        const { AnalyticsService } = await import("../../services/analytics");
        const analyticsService = new AnalyticsService(prisma);

        // Calculate date range
        const days = parseInt(options.days);
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - days);

        // Get trade history
        const trades = await analyticsService.getTradeHistory(userId, fromDate);

        spinner.stop();

        if (trades.length === 0) {
          info(`No trades in the last ${days} days`);
          return;
        }

        console.log();
        console.log(chalk.bold.cyan(`Trade History (Last ${days} Days)`));
        console.log(chalk.cyan("━".repeat(80)));

        const table = createTable(["Date", "Token", "Type", "Amount", "Entry", "Exit", "P&L", "Status"]);

        for (const trade of trades.slice(0, 20)) {
          // Show last 20
          table.push([
            formatDate(trade.timestamp),
            trade.token.slice(0, 10) + "...",
            trade.type,
            trade.amount.toFixed(4),
            formatCurrency(trade.entryPrice),
            trade.exitPrice ? formatCurrency(trade.exitPrice) : "-",
            formatPnL(trade.pnl),
            getStatusBadge(trade.status),
          ]);
        }

        console.log(table.toString());
        console.log();

        if (trades.length > 20) {
          info(`Showing 20 of ${trades.length} trades. Use export command for full history.`);
          console.log();
        }
      } catch (err: any) {
        handleError(err);
      }
    });

  // Export command
  program
    .command("export")
    .description("Export trade history")
    .option("--from <date>", "Start date (YYYY-MM-DD)")
    .option("--to <date>", "End date (YYYY-MM-DD)")
    .option("--format <format>", "Export format (csv | json)", "csv")
    .action(async (options) => {
      try {
        const userId = getCurrentUser();
        if (!userId) {
          error("No active account. Run 'hedge-bot account login' first");
          return;
        }

        const spinner = createSpinner("Exporting trade history...").start();

        // Import AnalyticsService
        const { AnalyticsService } = await import("../../services/analytics");
        const analyticsService = new AnalyticsService(prisma);

        // Parse dates
        const fromDate = options.from ? new Date(options.from) : undefined;
        const toDate = options.to ? new Date(options.to) : undefined;

        // Export based on format
        let data: string;
        let filename: string;

        if (options.format === "json") {
          data = await analyticsService.exportToJSON(userId, fromDate, toDate);
          filename = `trades_${Date.now()}.json`;
        } else {
          data = await analyticsService.exportToCSV(userId, fromDate, toDate);
          filename = `trades_${Date.now()}.csv`;
        }

        // Write to file
        const fs = await import("fs/promises");
        await fs.writeFile(filename, data);

        spinner.stop();

        success(`Trade history exported to ${filename}`);
        console.log();
      } catch (err: any) {
        handleError(err);
      }
    });

  // Risk command
  const risk = program.command("risk").description("Risk management commands");

  risk
    .command("check")
    .description("Check current risk metrics")
    .action(async () => {
      try {
        const userId = getCurrentUser();
        if (!userId) {
          error("No active account. Run 'hedge-bot account login' first");
          return;
        }

        const spinner = createSpinner("Calculating risk metrics...").start();

        // Get risk metrics from RiskManager
        const riskManager = new RiskManager(prisma);
        const riskMetrics = await riskManager.getPortfolioRisk(userId);

        spinner.stop();

        console.log();
        console.log(chalk.bold.cyan("Risk Metrics"));
        console.log(chalk.cyan("━".repeat(60)));
        console.log(`Total Exposure:     ${formatCurrency(riskMetrics.totalExposure)}`);
        console.log(`Largest Position:   ${formatCurrency(riskMetrics.largestPosition)}`);
        console.log(`Open Positions:     ${riskMetrics.openPositions}`);
        console.log(`Day P&L:            ${formatPnL(riskMetrics.dayPnL)}`);
        console.log(`Week P&L:           ${formatPnL(riskMetrics.weekPnL)}`);
        console.log(`Max Drawdown:       ${formatPercentage(riskMetrics.maxDrawdown)}`);
        console.log();

        // Add warnings if risk levels are high
        const warnings: string[] = [];

        if (riskMetrics.openPositions >= 8) {
          warnings.push("⚠️  Approaching max positions limit");
        }

        if (riskMetrics.maxDrawdown > 0.05) {
          warnings.push("⚠️  High drawdown detected");
        }

        if (riskMetrics.dayPnL < -100) {
          warnings.push("⚠️  Significant daily loss");
        }

        if (warnings.length > 0) {
          console.log(chalk.bold.yellow("Warnings:"));
          warnings.forEach((w) => console.log(chalk.yellow(w)));
          console.log();
        } else {
          success("All risk metrics within normal ranges");
          console.log();
        }
      } catch (err: any) {
        handleError(err);
      }
    });

  return program;
}

/**
 * Main CLI entry point
 */
export async function runCli(args?: string[]): Promise<void> {
  try {
    const program = createCliProgram();
    await program.parseAsync(args || process.argv);
  } catch (err: any) {
    handleError(err);
  } finally {
    // Cleanup
    await prisma.$disconnect();
    transactionMonitor.cleanup();
  }
}
