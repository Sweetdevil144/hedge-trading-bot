import { Context, SessionFlavor } from "grammy";

export interface WalletData {
  publicKey: string;
  secretKey: string; // base64 or hex
  createdAt: number;
  seedPhraseBackedUp: boolean;
  seedPhrase?: string;
}

// Reintroduce UserData so wallet.ts can store { wallet: WalletData } in the Map
export interface UserData {
  wallet: WalletData;
}

export interface SessionData {
  userId?: string;
  waitingForMintAmount?: boolean;
  waitingForConversionAmount?: boolean;
  waitingForWithdrawalAmount?: boolean;
  waitingForAddress?: boolean;
  waitingForResetConfirmation?: boolean;
  waitingForSeedPhrase?: boolean;
  withdrawalAmount?: number;

  waitingForLiquidityAmounts?: boolean;
}

export type MyContext = Context & SessionFlavor<SessionData>;
