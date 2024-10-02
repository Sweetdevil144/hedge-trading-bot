/**
 * CLI Utilities - Helper functions for CLI interface
 * Prompt_3 Implementation
 */

import chalk from "chalk";
import Table from "cli-table3";
import ora from "ora";
import inquirer from "inquirer";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

/**
 * CLI Configuration Directory
 */
export const CLI_CONFIG_DIR = join(homedir(), ".hedge-bot");
export const CLI_CONFIG_FILE = join(CLI_CONFIG_DIR, "config.json");

/**
 * Ensure CLI config directory exists
 */
export function ensureConfigDir(): void {
  if (!existsSync(CLI_CONFIG_DIR)) {
    mkdirSync(CLI_CONFIG_DIR, { recursive: true });
  }
}

/**
 * Load CLI configuration
 */
export function loadCliConfig(): any {
  ensureConfigDir();

  if (!existsSync(CLI_CONFIG_FILE)) {
    return {
      currentUser: null,
      network: "devnet",
      defaultSlippage: 200, // 2%
    };
  }

  try {
    const data = readFileSync(CLI_CONFIG_FILE, "utf-8");
    return JSON.parse(data);
  } catch (error) {
    console.error(chalk.red("Error loading config:"), error);
    return {};
  }
}

/**
 * Save CLI configuration
 */
export function saveCliConfig(config: any): void {
  ensureConfigDir();

  try {
    writeFileSync(CLI_CONFIG_FILE, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error(chalk.red("Error saving config:"), error);
  }
}

/**
 * Get current user from config
 */
export function getCurrentUser(): string | null {
  const config = loadCliConfig();
  return config.currentUser || null;
}

/**
 * Set current user in config
 */
export function setCurrentUser(userId: string): void {
  const config = loadCliConfig();
  config.currentUser = userId;
  saveCliConfig(config);
}

/**
 * Format currency
 */
export function formatCurrency(amount: number, currency: string = "USDC"): string {
  return `${amount.toFixed(2)} ${currency}`;
}

/**
 * Format percentage
 */
export function formatPercentage(value: number): string {
  const color = value >= 0 ? chalk.green : chalk.red;
  const sign = value >= 0 ? "+" : "";
  return color(`${sign}${value.toFixed(2)}%`);
}

/**
 * Format number with commas
 */
export function formatNumber(value: number, decimals: number = 2): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format date
 */
export function formatDate(date: Date): string {
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Create a table for displaying data
 */
export function createTable(headers: string[]): Table.Table {
  return new Table({
    head: headers.map((h) => chalk.cyan(h)),
    style: {
      head: [],
      border: ["grey"],
    },
  });
}

/**
 * Show spinner while executing async operation
 */
export async function withSpinner<T>(
  message: string,
  operation: () => Promise<T>,
): Promise<T> {
  const spinner = ora(message).start();

  try {
    const result = await operation();
    spinner.succeed();
    return result;
  } catch (error: any) {
    spinner.fail();
    throw error;
  }
}

/**
 * Show success message
 */
export function success(message: string): void {
  console.log(chalk.green("✓"), message);
}

/**
 * Show error message
 */
export function error(message: string): void {
  console.log(chalk.red("✗"), message);
}

/**
 * Show warning message
 */
export function warning(message: string): void {
  console.log(chalk.yellow("⚠"), message);
}

/**
 * Show info message
 */
export function info(message: string): void {
  console.log(chalk.blue("ℹ"), message);
}

/**
 * Confirm action with user
 */
export async function confirm(message: string): Promise<boolean> {
  const answers = await inquirer.prompt([
    {
      type: "confirm",
      name: "confirmed",
      message,
      default: false,
    },
  ]);

  return answers.confirmed;
}

/**
 * Prompt for input
 */
export async function promptInput(message: string, defaultValue?: string): Promise<string> {
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "value",
      message,
      default: defaultValue,
    },
  ]);

  return answers.value;
}

/**
 * Prompt for password/secret
 */
export async function promptPassword(message: string): Promise<string> {
  const answers = await inquirer.prompt([
    {
      type: "password",
      name: "value",
      message,
      mask: "*",
    },
  ]);

  return answers.value;
}

/**
 * Select from list
 */
export async function selectFromList<T>(
  message: string,
  choices: Array<{ name: string; value: T }>,
): Promise<T> {
  const answers = await inquirer.prompt([
    {
      type: "list",
      name: "value",
      message,
      choices,
    },
  ]);

  return answers.value;
}

/**
 * Display PnL with color coding
 */
export function displayPnL(pnl: number): string {
  if (pnl > 0) {
    return chalk.green(`+$${formatNumber(pnl)}`);
  } else if (pnl < 0) {
    return chalk.red(`-$${formatNumber(Math.abs(pnl))}`);
  } else {
    return chalk.grey("$0.00");
  }
}

/**
 * Display status badge
 */
export function displayStatus(status: string): string {
  const statusColors: Record<string, any> = {
    OPEN: chalk.green,
    CLOSED: chalk.grey,
    PENDING: chalk.yellow,
    CONFIRMED: chalk.green,
    FAILED: chalk.red,
    FILLED: chalk.green,
    CANCELLED: chalk.red,
  };

  const color = statusColors[status] || chalk.white;
  return color(status);
}

/**
 * Show header banner
 */
export function showBanner(): void {
  console.log();
  console.log(chalk.cyan.bold("  ╔═══════════════════════════════════╗"));
  console.log(chalk.cyan.bold("  ║     HEDGE TRADING BOT CLI         ║"));
  console.log(chalk.cyan.bold("  ╚═══════════════════════════════════╝"));
  console.log();
}

/**
 * Parse amount with optional units (K, M)
 */
export function parseAmount(input: string): number {
  const cleanInput = input.trim().toUpperCase();

  if (cleanInput.endsWith("K")) {
    return parseFloat(cleanInput.slice(0, -1)) * 1000;
  } else if (cleanInput.endsWith("M")) {
    return parseFloat(cleanInput.slice(0, -1)) * 1_000_000;
  } else {
    return parseFloat(cleanInput);
  }
}

/**
 * Truncate string with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + "...";
}

/**
 * Handle CLI errors
 */
export function handleError(error: any): void {
  console.log();

  if (error.suggestedAction) {
    // Trading error with suggested action
    console.log(chalk.red.bold("Error:"), error.message);
    console.log(chalk.yellow("💡 Suggestion:"), error.suggestedAction);
  } else {
    // Generic error
    console.log(chalk.red.bold("Error:"), error.message || error);
  }

  console.log();
  process.exit(1);
}
