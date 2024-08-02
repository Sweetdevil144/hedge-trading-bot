import * as CryptoJS from "crypto-js";

/**
 * Encryption utility for securing sensitive data (private keys, seed phrases)
 * Uses AES-256 encryption
 */
export class EncryptionService {
  private static encryptionKey: string | null = null;

  /**
   * Initialize encryption service with key from environment
   */
  static initialize(): void {
    if (!process.env.ENCRYPTION_KEY) {
      throw new Error(
        "ENCRYPTION_KEY not found in environment variables. Please set a 32-byte hex string.",
      );
    }
    this.encryptionKey = process.env.ENCRYPTION_KEY;
  }

  /**
   * Get encryption key, initializing if necessary
   */
  private static getKey(): string {
    if (!this.encryptionKey) {
      this.initialize();
    }
    return this.encryptionKey!;
  }

  /**
   * Encrypt a string using AES-256
   */
  static encrypt(plaintext: string): string {
    try {
      const key = this.getKey();
      const encrypted = CryptoJS.AES.encrypt(plaintext, key);
      return encrypted.toString();
    } catch (error) {
      throw new Error(`Encryption failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Decrypt a string using AES-256
   */
  static decrypt(ciphertext: string): string {
    try {
      const key = this.getKey();
      const decrypted = CryptoJS.AES.decrypt(ciphertext, key);
      const plaintext = decrypted.toString(CryptoJS.enc.Utf8);

      if (!plaintext) {
        throw new Error("Decryption resulted in empty string");
      }

      return plaintext;
    } catch (error) {
      throw new Error(`Decryption failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Encrypt a Uint8Array (used for secret keys)
   */
  static encryptBytes(bytes: Uint8Array): string {
    const base64 = Buffer.from(bytes).toString("base64");
    return this.encrypt(base64);
  }

  /**
   * Decrypt to Uint8Array
   */
  static decryptBytes(ciphertext: string): Uint8Array {
    const base64 = this.decrypt(ciphertext);
    return new Uint8Array(Buffer.from(base64, "base64"));
  }

  /**
   * Generate a random encryption key (32 bytes hex)
   * Use this to generate ENCRYPTION_KEY for .env
   */
  static generateKey(): string {
    const randomBytes = CryptoJS.lib.WordArray.random(32);
    return randomBytes.toString(CryptoJS.enc.Hex);
  }

  /**
   * Hash a string using SHA256
   */
  static hash(data: string): string {
    return CryptoJS.SHA256(data).toString();
  }

  /**
   * Verify if a string matches a hash
   */
  static verifyHash(data: string, hash: string): boolean {
    return this.hash(data) === hash;
  }
}

// Initialize on module load if ENCRYPTION_KEY is available
if (process.env.ENCRYPTION_KEY) {
  EncryptionService.initialize();
}
