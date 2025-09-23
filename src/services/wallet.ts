import { Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import * as fs from "fs";
import { WALLET_DATA_FILE, getConnection, getUsdcMint, getUsdiMint } from "../utils/constants";
import * as bip39 from "bip39";
import * as CryptoJS from "crypto-js";
import { WalletData, UserData } from "../types";
import { formatUserError, logError, ErrorType, withErrorHandling } from "../utils/errorHandler";

export class WalletStore {
  private data: Map<string, UserData>;
  private ID: any;

  constructor() {
    this.data = new Map();
    this.ID = CryptoJS.SHA256("WalletStore");
    this.loadData();
  }

  private loadData() {
    try {
      if (fs.existsSync(WALLET_DATA_FILE)) {
        const fileData = JSON.parse(fs.readFileSync(WALLET_DATA_FILE, "utf-8"));
        this.data = new Map(Object.entries(fileData));
      }
    } catch (error) {
      logError(error, {
        operation: "Load wallet data",
        type: ErrorType.UNKNOWN,
      });
      console.error("Error loading wallet data:", error);
    }
  }

  public ObjectID() {
    return this.ID;
  }

  private saveData() {
    try {
      const dataObject = Object.fromEntries(this.data);
      fs.writeFileSync(WALLET_DATA_FILE, JSON.stringify(dataObject, null, 2));
    } catch (error) {
      logError(error, {
        operation: "Save wallet data",
        type: ErrorType.UNKNOWN,
      });
      console.error("Error saving wallet data:", error);
    }
  }

  async checkUsdcBalance(userId: string): Promise<number> {
    return withErrorHandling<number>(
      "Check USDC balance",
      async () => {
        const userData = this.data.get(userId);
        if (!userData) return 0;

        const keypair = this.getKeypairFromData(userData.wallet);
        const usdcMint = getUsdcMint();
        const usdcAccount = await getAssociatedTokenAddress(usdcMint, keypair.publicKey);

        try {
          const connection = getConnection();
          const balance = await getAccount(connection, usdcAccount);
          const actualBalance = Number(balance.amount) / Math.pow(10, 6);
          return truncateDecimals(actualBalance, 5);
        } catch {
          return 0; // Account doesn't exist yet
        }
      },
      async (error, operation) => {
        logError(error, {
          operation,
          additionalInfo: { userId: userId.substring(0, 4) + "..." },
          type: ErrorType.WALLET,
        });
        // For balance checks, return 0 instead of throwing error for better UX
        return 0;
      },
      { userId: userId.substring(0, 4) + "..." },
    );
  }

  async checkUsdiBalance(userId: string): Promise<number> {
    return withErrorHandling<number>(
      "Check USDi balance",
      async () => {
        const userData = this.data.get(userId);
        if (!userData) return 0;

        const keypair = this.getKeypairFromData(userData.wallet);
        const usdiMint = getUsdiMint();
        const usdiAccount = await getAssociatedTokenAddress(usdiMint, keypair.publicKey);

        try {
          const connection = getConnection();
          const balance = await getAccount(connection, usdiAccount);
          const actualBalance = Number(balance.amount) / Math.pow(10, 6);
          return truncateDecimals(actualBalance, 5);
        } catch {
          return 0; // Account doesn't exist yet
        }
      },
      async (error, operation) => {
        logError(error, {
          operation,
          additionalInfo: { userId: userId.substring(0, 4) + "..." },
          type: ErrorType.WALLET,
        });
        // For balance checks, return 0 instead of throwing error for better UX
        return 0;
      },
      { userId: userId.substring(0, 4) + "..." },
    );
  }

  getWallet(userId: string): WalletData | undefined {
    return this.data.get(userId)?.wallet;
  }

  createWallet(userId: string): WalletData {
    const keypair = Keypair.generate();
    const walletData: WalletData = {
      publicKey: keypair.publicKey.toString(),
      secretKey: Buffer.from(keypair.secretKey).toString("base64"),
      createdAt: Date.now(),
      seedPhraseBackedUp: false,
      seedPhrase: bip39.generateMnemonic(256), // Temporarily store seed phrase
    };

    try {
      this.data.set(userId, { wallet: walletData });
      this.saveData();
      return walletData;
    } catch (error) {
      const formattedError = formatUserError(error, "Create wallet");
      logError(error, {
        operation: "Create wallet",
        additionalInfo: { userId: userId.substring(0, 4) + "..." },
        type: ErrorType.WALLET,
      });
      throw new Error(`Failed to create wallet: ${formattedError.message}`);
    }
  }

  private getKeypairFromData(wallet: WalletData): Keypair {
    try {
      const secretKey = Buffer.from(wallet.secretKey, "base64");
      return Keypair.fromSecretKey(secretKey);
    } catch (error) {
      const formattedError = formatUserError(error, "Convert wallet data to keypair");
      logError(error, {
        operation: "Convert wallet data to keypair",
        type: ErrorType.WALLET,
      });
      throw new Error(`Invalid wallet data: ${formattedError.message}`);
    }
  }

  markSeedPhraseBackedUp(userId: string): void {
    try {
      const userData = this.data.get(userId);
      if (userData) {
        userData.wallet.seedPhraseBackedUp = true;
        userData.wallet.seedPhrase = undefined; // Clear stored seed phrase
        this.saveData();
      } else {
        throw new Error("Wallet not found");
      }
    } catch (error) {
      const formattedError = formatUserError(error, "Mark seed phrase backed up");
      logError(error, {
        operation: "Mark seed phrase backed up",
        additionalInfo: { userId: userId.substring(0, 4) + "..." },
        type: ErrorType.WALLET,
      });
      throw new Error(`Failed to update backup status: ${formattedError.message}`);
    }
  }

  resetWallet(userId: string): void {
    try {
      this.data.delete(userId);
      this.saveData();
    } catch (error) {
      const formattedError = formatUserError(error, "Reset wallet");
      logError(error, {
        operation: "Reset wallet",
        additionalInfo: { userId: userId.substring(0, 4) + "..." },
        type: ErrorType.WALLET,
      });
      throw new Error(`Failed to reset wallet: ${formattedError.message}`);
    }
  }

  getKeypairForUser(userId: string): Keypair {
    const userData = this.data.get(userId);
    if (!userData) {
      const error = new Error("Wallet not found");
      logError(error, {
        operation: "Get user keypair",
        additionalInfo: { userId: userId.substring(0, 4) + "..." },
        type: ErrorType.WALLET,
      });
      throw new Error("Wallet not found. Please create a wallet first.");
    }

    try {
      const secretKey = Buffer.from(userData.wallet.secretKey, "base64");
      return Keypair.fromSecretKey(secretKey);
    } catch (error) {
      const formattedError = formatUserError(error, "Get user keypair");
      logError(error, {
        operation: "Get user keypair",
        additionalInfo: { userId: userId.substring(0, 4) + "..." },
        type: ErrorType.WALLET,
      });
      throw new Error(`Failed to access wallet: ${formattedError.message}`);
    }
  }

  updateWallet(userId: string, walletData: WalletData): void {
    try {
      this.data.set(userId, { wallet: walletData });
      this.saveData();
    } catch (error) {
      const formattedError = formatUserError(error, "Update wallet");
      logError(error, {
        operation: "Update wallet",
        additionalInfo: { userId: userId.substring(0, 4) + "..." },
        type: ErrorType.WALLET,
      });
      throw new Error(`Failed to update wallet: ${formattedError.message}`);
    }
  }

  async checkSolBalance(userId: string): Promise<number> {
    return withErrorHandling<number>(
      "Check SOL balance",
      async () => {
        const userData = this.data.get(userId);
        if (!userData) return 0;

        const keypair = this.getKeypairForUser(userId);
        const connection = getConnection();
        const balance = await connection.getBalance(keypair.publicKey);
        return truncateDecimals(balance / LAMPORTS_PER_SOL, 5); // Convert lamports to SOL
      },
      async (error, operation) => {
        logError(error, {
          operation,
          additionalInfo: { userId: userId.substring(0, 4) + "..." },
          type: ErrorType.WALLET,
        });
        // For balance checks, return 0 instead of throwing error for better UX
        return 0;
      },
      { userId: userId.substring(0, 4) + "..." },
    );
  }

  getConnection() {
    return getConnection();
  }
}

export function truncateDecimals(num: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  const truncated = Math.floor(num * factor) / factor;

  // Format to exact number of decimal places
  return Number(truncated.toFixed(decimals));
}
