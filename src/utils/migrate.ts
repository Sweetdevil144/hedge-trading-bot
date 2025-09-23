import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import { EncryptionService } from "./encryption";
import { WalletData, UserData } from "../types";
import { AppConfig } from "./config";

/**
 * Migration script to transfer data from wallet_data.json to PostgreSQL database
 *
 * Usage:
 *   ts-node src/utils/migrate.ts
 *
 * This script will:
 * 1. Read existing wallet_data.json
 * 2. Encrypt private keys and seed phrases
 * 3. Create user records in the database
 * 4. Optionally backup the JSON file
 */

const prisma = new PrismaClient();

interface LegacyWalletData {
  [telegramId: string]: UserData;
}

export class DataMigration {
  private prisma: PrismaClient;
  private walletDataFile: string;

  constructor(prisma: PrismaClient, walletDataFile?: string) {
    this.prisma = prisma;
    this.walletDataFile = walletDataFile || AppConfig.getWalletDataFile();
  }

  /**
   * Check if wallet_data.json exists
   */
  private checkFileExists(): boolean {
    return fs.existsSync(this.walletDataFile);
  }

  /**
   * Load data from wallet_data.json
   */
  private loadLegacyData(): LegacyWalletData | null {
    if (!this.checkFileExists()) {
      console.log(`File ${this.walletDataFile} does not exist. Nothing to migrate.`);
      return null;
    }

    try {
      const fileContent = fs.readFileSync(this.walletDataFile, "utf-8");
      const data: LegacyWalletData = JSON.parse(fileContent);
      return data;
    } catch (error) {
      console.error("Error reading wallet_data.json:", error);
      throw error;
    }
  }

  /**
   * Migrate a single user's wallet data
   */
  private async migrateUser(telegramId: string, userData: UserData): Promise<boolean> {
    try {
      const { wallet } = userData;

      // Check if user already exists
      const existingUser = await this.prisma.user.findUnique({
        where: { telegramId },
      });

      if (existingUser) {
        console.log(`User ${telegramId} already exists in database. Skipping.`);
        return false;
      }

      // Encrypt secret key and seed phrase
      const encryptedSecretKey = EncryptionService.encrypt(wallet.secretKey);
      const encryptedSeedPhrase = wallet.seedPhrase ? EncryptionService.encrypt(wallet.seedPhrase) : null;

      // Create user in database
      await this.prisma.user.create({
        data: {
          telegramId,
          publicKey: wallet.publicKey,
          encryptedSecretKey,
          seedPhraseBackedUp: wallet.seedPhraseBackedUp,
          encryptedSeedPhrase,
          createdAt: new Date(wallet.createdAt),
        },
      });

      console.log(`✓ Migrated user ${telegramId}`);
      return true;
    } catch (error) {
      console.error(`✗ Failed to migrate user ${telegramId}:`, error);
      return false;
    }
  }

  /**
   * Run the complete migration
   */
  async migrate(options: {
    backup?: boolean;
    deleteAfterMigration?: boolean;
  } = {}): Promise<{
    success: boolean;
    totalUsers: number;
    migratedUsers: number;
    skippedUsers: number;
    failedUsers: number;
  }> {
    console.log("=== Starting Data Migration ===\n");

    // Ensure encryption is initialized
    if (!process.env.ENCRYPTION_KEY) {
      throw new Error("ENCRYPTION_KEY must be set in environment variables");
    }
    EncryptionService.initialize();

    // Load legacy data
    const legacyData = this.loadLegacyData();

    if (!legacyData || Object.keys(legacyData).length === 0) {
      console.log("No data to migrate.");
      return {
        success: true,
        totalUsers: 0,
        migratedUsers: 0,
        skippedUsers: 0,
        failedUsers: 0,
      };
    }

    const totalUsers = Object.keys(legacyData).length;
    console.log(`Found ${totalUsers} users in wallet_data.json\n`);

    // Backup if requested
    if (options.backup) {
      await this.backupFile();
    }

    // Migrate each user
    let migratedUsers = 0;
    let skippedUsers = 0;
    let failedUsers = 0;

    for (const [telegramId, userData] of Object.entries(legacyData)) {
      const migrated = await this.migrateUser(telegramId, userData);

      if (migrated) {
        migratedUsers++;
      } else {
        // Check if it was skipped or failed by looking for the user
        const exists = await this.prisma.user.findUnique({
          where: { telegramId },
        });
        if (exists) {
          skippedUsers++;
        } else {
          failedUsers++;
        }
      }
    }

    // Summary
    console.log("\n=== Migration Summary ===");
    console.log(`Total users: ${totalUsers}`);
    console.log(`Successfully migrated: ${migratedUsers}`);
    console.log(`Skipped (already exist): ${skippedUsers}`);
    console.log(`Failed: ${failedUsers}`);

    // Delete original file if requested and all migrations succeeded
    if (options.deleteAfterMigration && failedUsers === 0) {
      console.log(`\nDeleting ${this.walletDataFile}...`);
      fs.unlinkSync(this.walletDataFile);
      console.log("✓ Original file deleted");
    }

    const success = failedUsers === 0;
    return {
      success,
      totalUsers,
      migratedUsers,
      skippedUsers,
      failedUsers,
    };
  }

  /**
   * Backup wallet_data.json
   */
  private async backupFile(): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${this.walletDataFile}.backup.${timestamp}`;

    try {
      fs.copyFileSync(this.walletDataFile, backupPath);
      console.log(`✓ Backup created: ${backupPath}\n`);
    } catch (error) {
      console.error("Failed to create backup:", error);
      throw error;
    }
  }

  /**
   * Verify migration by checking if data can be decrypted
   */
  async verifyMigration(): Promise<boolean> {
    console.log("\n=== Verifying Migration ===\n");

    const users = await this.prisma.user.findMany();

    if (users.length === 0) {
      console.log("No users found in database.");
      return true;
    }

    let verified = 0;
    let failed = 0;

    for (const user of users) {
      try {
        // Try to decrypt the secret key
        const decryptedSecretKey = EncryptionService.decrypt(user.encryptedSecretKey);

        // Try to decrypt seed phrase if it exists
        if (user.encryptedSeedPhrase) {
          EncryptionService.decrypt(user.encryptedSeedPhrase);
        }

        verified++;
        console.log(`✓ User ${user.telegramId} verified`);
      } catch (error) {
        failed++;
        console.error(`✗ User ${user.telegramId} verification failed:`, error);
      }
    }

    console.log(`\nVerification: ${verified}/${users.length} successful`);

    return failed === 0;
  }
}

// CLI execution
if (require.main === module) {
  async function main() {
    const migration = new DataMigration(prisma);

    try {
      const result = await migration.migrate({
        backup: true, // Create backup
        deleteAfterMigration: false, // Keep original file for safety
      });

      if (result.success) {
        // Verify the migration
        const verified = await migration.verifyMigration();

        if (verified) {
          console.log("\n✓ Migration completed successfully!");
          process.exit(0);
        } else {
          console.error("\n✗ Migration verification failed!");
          process.exit(1);
        }
      } else {
        console.error("\n✗ Migration completed with errors!");
        process.exit(1);
      }
    } catch (error) {
      console.error("\n✗ Migration failed:", error);
      process.exit(1);
    } finally {
      await prisma.$disconnect();
    }
  }

  main();
}

export default DataMigration;
