import {
  // For stats
  fetchSplashPool,
  // For deposit (opening positions)
  openFullRangePositionInstructions,
  // For enumerating positions
  fetchPositionsForOwner,
  // For fully closing a position
  closePositionInstructions,

  // Set environment
  setWhirlpoolsConfig,
} from "@orca-so/whirlpools";

import { address } from "@solana/kit";
import {
  Keypair,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  PublicKey,
} from "@solana/web3.js";
import { WalletStore } from "./wallet";
import { connectionManager } from "./connectionManager";
import { getConnection, getTokenMint } from "../utils/constants";
import { formatUserError, logError, ErrorType } from "../utils/errorHandler";

// Convert network name to match Orca Config format
function getOrcaNetworkConfig(network: string): "solanaMainnet" | "solanaDevnet" {
  // Orca only supports "solanaMainnet" and "solanaDevnet"
  return network === "mainnet-beta" || network === "mainnet" ? "solanaMainnet" : "solanaDevnet";
}

/**
 * Helper to convert an Orca IInstruction into a normal Solana `TransactionInstruction`.
 * We do a fallback for library versions that might use `programId` vs. `address`, etc.
 */
function addIInstructionToTx(tx: Transaction, iInstr: any) {
  try {
    const progIdStr = iInstr.programId || iInstr.address;
    const metas = iInstr.keys || iInstr.accountMetas;
    if (!progIdStr || !metas) {
      throw new Error(`Unrecognized instruction shape: ${JSON.stringify(iInstr)}`);
    }
    tx.add(
      new TransactionInstruction({
        programId: new PublicKey(progIdStr),
        keys: metas.map((k: any) => ({
          pubkey: new PublicKey(k.pubkey),
          isSigner: k.isSigner,
          isWritable: k.isWritable,
        })),
        data: Buffer.from(iInstr.data),
      }),
    );
  } catch (error) {
    const formattedError = formatUserError(error, "Convert Orca instructions");
    throw new Error(`Failed to add instruction to transaction: ${formattedError.message}`);
  }
}

/** Build and send a Transaction from an array of IInstructions. */
async function sendOrcaInstructions(keypair: Keypair, iInstructions: any[]): Promise<string> {
  try {
    const tx = new Transaction();
    for (const iInstr of iInstructions) {
      addIInstructionToTx(tx, iInstr);
    }
    tx.feePayer = keypair.publicKey;

    const connection = getConnection();
    const latestBlockhash = await connection.getLatestBlockhash();
    tx.recentBlockhash = latestBlockhash.blockhash;

    const signature = await sendAndConfirmTransaction(connection, tx, [keypair]);
    return signature;
  } catch (error) {
    const formattedError = formatUserError(error, "Send Orca transaction");
    logError(error, {
      operation: "Send Orca transaction",
      additionalInfo: {
        instructions: iInstructions.length,
        wallet: keypair.publicKey.toString(),
      },
    });
    throw new Error(`Transaction failed: ${formattedError.message}`);
  }
}

/** Minimal "wallet" object for the Orca functions, cast to `any`. */
function buildWallet(keypair: Keypair): any {
  return {
    publicKey: keypair.publicKey,
    async signTransaction(tx: Transaction) {
      tx.sign(keypair);
      return tx;
    },
    async signAllTransactions(txs: Transaction[]) {
      txs.forEach((t) => t.sign(keypair));
      return txs;
    },
  } as any;
}

/** 1) fetchPoolStats:
 *    Example: use fetchSplashPool to get pool data on mainnet.
 *    If the pool is concentrated, you'd use `fetchConcentratedLiquidityPool`.
 *
 *    Note: Originally this function took two token mints as arguments to find the pool,
 *    but now it directly uses the whirlpool address.
 *    This requires modification in bot.ts.
 */
export async function fetchPoolStats(whirlpoolAddress: string): Promise<any> {
  try {
    const network = connectionManager.getCurrentNetwork();
    const orcaNetwork = getOrcaNetworkConfig(network);
    await setWhirlpoolsConfig(orcaNetwork);
    const rpc = connectionManager.getDefaultConnection();

    // Assuming first and second token mints as USDC and USDT
    const tokenMintA = address(getTokenMint("USDC").toString());
    const tokenMintB = address(getTokenMint("USDT").toString());

    // Fetch pool info using Orca's fetchSplashPool
    const poolInfo = await fetchSplashPool(rpc, tokenMintA, tokenMintB);

    if (!poolInfo.initialized) {
      throw new Error(`Pool not found or not initialized: ${whirlpoolAddress}`);
    }

    // Return pool information
    return {
      whirlpool: whirlpoolAddress,
      initialized: poolInfo.initialized,
      tokenMintA: tokenMintA,
      tokenMintB: tokenMintB,
      poolData: poolInfo,
    };
  } catch (error) {
    const formattedError = formatUserError(error, "Fetch pool statistics");
    logError(error, {
      operation: "Fetch pool statistics",
      additionalInfo: { whirlpoolAddress },
    });

    // Check if it's a "pool not found" error
    if (error instanceof Error && error.message.includes("not found")) {
      throw new Error(`The liquidity pool was not found. Please check the pool address.`);
    }

    throw new Error(`Failed to fetch pool data: ${formattedError.message}`);
  }
}

/** 2) depositLiquidity:
 *    We'll treat it like `openFullRangePositionInstructions` (Splash).
 *    If you want partial deposit or Concen. pool, you'd do differently.
 */
export async function depositLiquidity(
  walletStore: WalletStore,
  userId: string,
  poolAddress: string,
  tokenA: bigint,
  slippageBps = 100,
): Promise<string> {
  try {
    const network = connectionManager.getCurrentNetwork();
    const orcaNetwork = getOrcaNetworkConfig(network);
    await setWhirlpoolsConfig(orcaNetwork);
    const rpc = connectionManager.getDefaultConnection();

    const keypair = walletStore.getKeypairForUser(userId);
    const wallet = buildWallet(keypair);

    // param must be exactly { tokenA } or { tokenB } or { liquidity }
    const param = { tokenA };

    const { quote, instructions, initializationCost, positionMint } = await openFullRangePositionInstructions(
      rpc,
      address(poolAddress),
      param,
      slippageBps,
      wallet,
    );

    console.log("Deposit quote =>", quote);
    console.log("Initialization cost =>", initializationCost);
    console.log("Position mint =>", positionMint);

    return sendOrcaInstructions(keypair, instructions);
  } catch (error) {
    // Format a user-friendly error
    const formattedError = formatUserError(error, "Deposit liquidity");

    // Log detailed error for debugging
    logError(error, {
      operation: "Deposit liquidity",
      additionalInfo: {
        userId: userId.substring(0, 4) + "...", // Only log partial user ID
        poolAddress,
        tokenA: tokenA.toString(),
        slippageBps,
      },
    });

    // Common errors with specific messages
    if (error instanceof Error) {
      const errorMsg = error.message.toLowerCase();

      if (errorMsg.includes("insufficient") && errorMsg.includes("balance")) {
        throw new Error(`You don't have enough tokens for this deposit. Please check your balance.`);
      }

      if (errorMsg.includes("slippage")) {
        throw new Error(
          `Price moved too much during the transaction. Try again with higher slippage tolerance.`,
        );
      }

      if (errorMsg.includes("pool") && errorMsg.includes("not found")) {
        throw new Error(`The liquidity pool was not found. Please check the pool address.`);
      }
    }

    // Default error message
    throw new Error(`Deposit failed: ${formattedError.message}`);
  }
}

/** 3) fetchUserPositions:
 *    Lists positions owned by userId's wallet.
 */
export async function fetchUserPositions(walletStore: WalletStore, userId: string): Promise<any[]> {
  try {
    const network = connectionManager.getCurrentNetwork();
    const orcaNetwork = getOrcaNetworkConfig(network);
    await setWhirlpoolsConfig(orcaNetwork);
    const rpc = connectionManager.getDefaultConnection();

    const keypair = walletStore.getKeypairForUser(userId);
    const ownerAddr = address(keypair.publicKey.toBase58());

    const positions = await fetchPositionsForOwner(rpc, ownerAddr);
    return positions;
  } catch (error) {
    const formattedError = formatUserError(error, "Fetch user positions");

    logError(error, {
      operation: "Fetch user positions",
      additionalInfo: { userId: userId.substring(0, 4) + "..." },
    });

    // Return empty array instead of throwing for better UX
    if (
      error instanceof Error &&
      (error.message.includes("not found") || error.message.includes("no positions"))
    ) {
      console.log(`No positions found for user ${userId.substring(0, 4)}...`);
      return [];
    }

    throw new Error(`Failed to fetch your positions: ${formattedError.message}`);
  }
}

/** 4) closePositionFully:
 *    Collects fees, removes liquidity, closes NFT.
 */
export async function closePositionFully(
  walletStore: WalletStore,
  userId: string,
  positionMint: string,
  slippageBps = 100,
): Promise<string> {
  try {
    const network = connectionManager.getCurrentNetwork();
    const orcaNetwork = getOrcaNetworkConfig(network);
    await setWhirlpoolsConfig(orcaNetwork);
    const rpc = connectionManager.getDefaultConnection();

    const keypair = walletStore.getKeypairForUser(userId);
    const wallet = buildWallet(keypair);

    const { instructions, quote, feesQuote, rewardsQuote } = await closePositionInstructions(
      rpc,
      address(positionMint),
      slippageBps,
      wallet,
    );

    console.log("Close position =>", quote);
    console.log("Fees =>", feesQuote);
    console.log("Rewards =>", rewardsQuote);

    return sendOrcaInstructions(keypair, instructions);
  } catch (error) {
    const formattedError = formatUserError(error, "Close position");

    logError(error, {
      operation: "Close position",
      additionalInfo: {
        userId: userId.substring(0, 4) + "...",
        positionMint,
        slippageBps,
      },
    });

    // Specific error handling
    if (error instanceof Error) {
      const errorMsg = error.message.toLowerCase();

      if (errorMsg.includes("position") && errorMsg.includes("not found")) {
        throw new Error(`Position not found. Please check the position mint address.`);
      }

      if (errorMsg.includes("slippage")) {
        throw new Error(
          `Price moved too much during the transaction. Try again with higher slippage tolerance.`,
        );
      }

      if (errorMsg.includes("owner")) {
        throw new Error(`You don't own this position. Only the position owner can close it.`);
      }
    }

    throw new Error(`Failed to close position: ${formattedError.message}`);
  }
}
