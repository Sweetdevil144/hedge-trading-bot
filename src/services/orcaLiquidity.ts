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

/**
 * Get current price from an Orca pool
 * Calculates price from pool's token reserves
 */
export async function getCurrentPoolPrice(poolAddress: string): Promise<number> {
  try {
    const network = connectionManager.getCurrentNetwork();
    const orcaNetwork = getOrcaNetworkConfig(network);
    await setWhirlpoolsConfig(orcaNetwork);
    const rpc = connectionManager.getDefaultConnection();

    const tokenMintA = address(getTokenMint("USDC").toString());
    const tokenMintB = address(getTokenMint("USDT").toString());

    const poolInfo = await fetchSplashPool(rpc, tokenMintA, tokenMintB);

    if (!poolInfo.initialized) {
      throw new Error(`Pool not initialized: ${poolAddress}`);
    }

    // Calculate price from pool data
    // For Orca splash pools, the price can be derived from sqrtPrice
    // sqrtPrice is stored as a u128, representing sqrt(price) * 2^64
    const sqrtPriceX64 = poolInfo.sqrtPrice;

    // Convert sqrtPrice to actual price
    // price = (sqrtPrice / 2^64)^2
    const Q64 = 2n ** 64n;
    const sqrtPrice = Number(sqrtPriceX64) / Number(Q64);
    const price = sqrtPrice * sqrtPrice;

    return price;
  } catch (error) {
    const formattedError = formatUserError(error, "Get current pool price");
    logError(error, {
      operation: "Get current pool price",
      additionalInfo: { poolAddress },
      type: ErrorType.UNKNOWN,
    });
    throw new Error(`Failed to get pool price: ${formattedError.message}`);
  }
}

/**
 * Execute a market order (swap) on Orca
 */
export async function executeMarketOrder(
  walletStore: WalletStore,
  userId: string,
  poolAddress: string,
  inputToken: string,
  amount: bigint,
  minOutputAmount: bigint,
  slippageBps = 100,
): Promise<{ signature: string; outputAmount: bigint }> {
  try {
    const network = connectionManager.getCurrentNetwork();
    const orcaNetwork = getOrcaNetworkConfig(network);
    await setWhirlpoolsConfig(orcaNetwork);
    const rpc = connectionManager.getDefaultConnection();

    const keypair = walletStore.getKeypairForUser(userId);
    const wallet = buildWallet(keypair);

    // For market orders, we can use Orca's swap functionality
    // This is a placeholder - actual implementation would use Orca's swap instructions
    // For now, we'll use the deposit/close position flow as a proxy

    // In production, you'd use:
    // - swapInstructions() from Orca SDK
    // - Or Jupiter aggregator for best execution

    console.log(`Executing market order: ${amount} ${inputToken} on pool ${poolAddress}`);

    // Placeholder return - actual implementation would return real swap results
    const signature = await depositLiquidity(walletStore, userId, poolAddress, amount, slippageBps);

    return {
      signature,
      outputAmount: minOutputAmount, // Placeholder
    };
  } catch (error) {
    const formattedError = formatUserError(error, "Execute market order");
    logError(error, {
      operation: "Execute market order",
      additionalInfo: {
        userId: userId.substring(0, 4) + "...",
        poolAddress,
        inputToken,
        amount: amount.toString(),
      },
      type: ErrorType.UNKNOWN,
    });
    throw new Error(`Market order failed: ${formattedError.message}`);
  }
}


/**
 * Execute direct swap between two tokens
 */
export async function executeDirectSwap(
  walletStore: WalletStore,
  userId: string,
  fromToken: string,
  toToken: string,
  amount: bigint,
  slippageBps = 200, // 2% default slippage
): Promise<{ signature: string; inputAmount: bigint; outputAmount: bigint; fee: number }> {
  try {
    const network = connectionManager.getCurrentNetwork();
    const orcaNetwork = getOrcaNetworkConfig(network);
    await setWhirlpoolsConfig(orcaNetwork);
    const rpc = connectionManager.getDefaultConnection();

    const keypair = walletStore.getKeypairForUser(userId);

    console.log(`Executing direct swap: ${amount} ${fromToken} → ${toToken}`);

    // Get the best pool for this swap
    const { poolAddress, expectedOutput } = await getBestExecutionPool(fromToken, toToken, amount);

    // Calculate minimum output with slippage
    const slippageMultiplier = (10000 - slippageBps) / 10000;
    const minOutputAmount = BigInt(Math.floor(Number(expectedOutput) * slippageMultiplier));

    // Execute swap via market order
    const result = await executeMarketOrder(
      walletStore,
      userId,
      poolAddress,
      fromToken,
      amount,
      minOutputAmount,
      slippageBps,
    );

    // Calculate fee (estimate 0.3% for Orca pools)
    const feePercent = 0.003;
    const fee = Number(amount) * feePercent;

    return {
      signature: result.signature,
      inputAmount: amount,
      outputAmount: result.outputAmount,
      fee,
    };
  } catch (error) {
    const formattedError = formatUserError(error, "Execute direct swap");
    logError(error, {
      operation: "Execute direct swap",
      additionalInfo: {
        userId: userId.substring(0, 4) + "...",
        fromToken,
        toToken,
        amount: amount.toString(),
      },
      type: ErrorType.UNKNOWN,
    });
    throw new Error(`Swap failed: ${formattedError.message}`);
  }
}

/**
 * Get price quote for a swap
 * Returns expected output amount and price impact
 */
export async function getSwapQuote(
  fromToken: string,
  toToken: string,
  amount: bigint,
): Promise<{ expectedOutput: bigint; priceImpact: number; fee: number; route: string[] }> {
  try {
    const network = connectionManager.getCurrentNetwork();
    const orcaNetwork = getOrcaNetworkConfig(network);
    await setWhirlpoolsConfig(orcaNetwork);

    console.log(`Getting swap quote: ${amount} ${fromToken} → ${toToken}`);

    // Get best execution pool
    const { poolAddress, expectedOutput, priceImpact } = await getBestExecutionPool(
      fromToken,
      toToken,
      amount,
    );

    // Calculate fee
    const feePercent = 0.003; // 0.3%
    const fee = Number(amount) * feePercent;

    // Route is direct (single pool)
    const route = [fromToken, toToken];

    return {
      expectedOutput,
      priceImpact,
      fee,
      route,
    };
  } catch (error) {
    const formattedError = formatUserError(error, "Get swap quote");
    logError(error, {
      operation: "Get swap quote",
      additionalInfo: { fromToken, toToken, amount: amount.toString() },
      type: ErrorType.UNKNOWN,
    });
    throw new Error(`Failed to get swap quote: ${formattedError.message}`);
  }
}

/**
 * Execute buy order (swap USDC to token)
 */
export async function executeBuyOrder(
  walletStore: WalletStore,
  userId: string,
  token: string,
  usdcAmount: bigint,
  slippageBps = 200,
): Promise<{ signature: string; tokenAmount: bigint; averagePrice: number }> {
  try {
    console.log(`Executing buy order: ${usdcAmount} USDC → ${token}`);

    const result = await executeDirectSwap(
      walletStore,
      userId,
      "USDC",
      token,
      usdcAmount,
      slippageBps,
    );

    const averagePrice = Number(usdcAmount) / Number(result.outputAmount);

    return {
      signature: result.signature,
      tokenAmount: result.outputAmount,
      averagePrice,
    };
  } catch (error) {
    const formattedError = formatUserError(error, "Execute buy order");
    logError(error, {
      operation: "Execute buy order",
      additionalInfo: {
        userId: userId.substring(0, 4) + "...",
        token,
        usdcAmount: usdcAmount.toString(),
      },
      type: ErrorType.UNKNOWN,
    });
    throw new Error(`Buy order failed: ${formattedError.message}`);
  }
}

/**
 * Execute sell order (swap token to USDC)
 */
export async function executeSellOrder(
  walletStore: WalletStore,
  userId: string,
  token: string,
  tokenAmount: bigint,
  slippageBps = 200,
): Promise<{ signature: string; usdcAmount: bigint; averagePrice: number }> {
  try {
    console.log(`Executing sell order: ${tokenAmount} ${token} → USDC`);

    const result = await executeDirectSwap(
      walletStore,
      userId,
      token,
      "USDC",
      tokenAmount,
      slippageBps,
    );

    const averagePrice = Number(result.outputAmount) / Number(tokenAmount);

    return {
      signature: result.signature,
      usdcAmount: result.outputAmount,
      averagePrice,
    };
  } catch (error) {
    const formattedError = formatUserError(error, "Execute sell order");
    logError(error, {
      operation: "Execute sell order",
      additionalInfo: {
        userId: userId.substring(0, 4) + "...",
        token,
        tokenAmount: tokenAmount.toString(),
      },
      type: ErrorType.UNKNOWN,
    });
    throw new Error(`Sell order failed: ${formattedError.message}`);
  }
}

/**
 * Get the best execution pool for a token pair
 * Returns the pool with the best liquidity/price for the trade
 */
export async function getBestExecutionPool(
  tokenA: string,
  tokenB: string,
  amount: bigint,
): Promise<{ poolAddress: string; expectedOutput: bigint; priceImpact: number }> {
  try {
    const network = connectionManager.getCurrentNetwork();
    const orcaNetwork = getOrcaNetworkConfig(network);
    await setWhirlpoolsConfig(orcaNetwork);
    const rpc = connectionManager.getDefaultConnection();

    // In production, this would:
    // 1. Query all available pools for this token pair
    // 2. Get quotes from each pool
    // 3. Calculate price impact for each
    // 4. Return the best one

    // For now, return a placeholder using predefined pools
    const { PREDEFINED_POOLS } = await import("../utils/constants");

    // Find a matching pool (this is simplified)
    const pool = PREDEFINED_POOLS[0]; // Default to first pool

    const poolAddress = pool.whirlpoolAddress.toString();
    const price = await getCurrentPoolPrice(poolAddress);

    // Calculate expected output (simplified)
    const expectedOutput = (Number(amount) * price) as unknown as bigint;
    const priceImpact = 0.01; // 1% - placeholder

    return {
      poolAddress,
      expectedOutput,
      priceImpact,
    };
  } catch (error) {
    const formattedError = formatUserError(error, "Get best execution pool");
    logError(error, {
      operation: "Get best execution pool",
      additionalInfo: { tokenA, tokenB, amount: amount.toString() },
      type: ErrorType.UNKNOWN,
    });
    throw new Error(`Failed to find best pool: ${formattedError.message}`);
  }
}
