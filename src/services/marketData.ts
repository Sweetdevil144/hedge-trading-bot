import { Connection, PublicKey } from "@solana/web3.js";
import { MarketData } from "../types";
import { getConnection } from "../utils/constants";
import { getCurrentPoolPrice } from "./orcaLiquidity";
import { subscribeToPriceUpdates as wsSubscribe } from "../websockets/orcaWebSocket";

/**
 * MarketDataService - Fetches and manages market data for tokens and pools
 * Enhanced with real Orca integration and WebSocket support
 */
export class MarketDataService {
  private connection: Connection;
  private priceCache: Map<string, { price: number; timestamp: Date }>;
  private priceHistory: Map<string, Array<{ price: number; timestamp: Date }>>;
  private cacheExpiry: number = 30000; // 30 seconds
  private readonly MAX_HISTORY_POINTS = 1000;

  constructor(connection?: Connection) {
    this.connection = connection || getConnection();
    this.priceCache = new Map();
    this.priceHistory = new Map();
  }

  /**
   * Get current price for a token from an Orca pool
   * Uses real Orca pool data
   */
  async getTokenPrice(tokenMint: string, poolAddress: string): Promise<number> {
    const cacheKey = `${tokenMint}_${poolAddress}`;
    const cached = this.priceCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp.getTime() < this.cacheExpiry) {
      return cached.price;
    }

    try {
      // Fetch real price from Orca pool
      const price = await getCurrentPoolPrice(poolAddress);

      // Cache the price
      this.priceCache.set(cacheKey, { price, timestamp: new Date() });

      // Add to price history
      this.addToPriceHistory(cacheKey, price);

      return price;
    } catch (error) {
      console.error("Error fetching price from Orca:", error);

      // Return cached price if available, even if expired
      if (cached) {
        console.warn(`Using stale price for ${cacheKey}`);
        return cached.price;
      }

      throw error;
    }
  }

  /**
   * Add price point to history (last 1000 points cached in memory)
   */
  private addToPriceHistory(key: string, price: number): void {
    const history = this.priceHistory.get(key) || [];

    history.push({ price, timestamp: new Date() });

    // Keep only last MAX_HISTORY_POINTS
    if (history.length > this.MAX_HISTORY_POINTS) {
      history.shift();
    }

    this.priceHistory.set(key, history);
  }

  /**
   * Get current price (alias for getTokenPrice for API compatibility)
   */
  async getCurrentPrice(poolAddress: string): Promise<number> {
    return getCurrentPoolPrice(poolAddress);
  }

  /**
   * Subscribe to price updates via WebSocket
   * Returns unsubscribe function
   */
  subscribeToPriceUpdates(poolAddress: string, callback: (price: number) => void): () => void {
    // Use WebSocket manager for real-time updates
    const unsubscribe = wsSubscribe(poolAddress, (price: number) => {
      // Update cache
      const cacheKey = `${poolAddress}_price`;
      this.priceCache.set(cacheKey, { price, timestamp: new Date() });

      // Add to history
      this.addToPriceHistory(cacheKey, price);

      // Call callback
      callback(price);
    });

    return unsubscribe;
  }

  /**
   * Get price history for a specific pool
   * Returns cached price points from memory
   */
  async getPriceHistory(
    poolAddress: string,
    timeframe: number, // milliseconds
  ): Promise<Array<{ price: number; timestamp: Date }>> {
    const cacheKey = `${poolAddress}_price`;
    const history = this.priceHistory.get(cacheKey) || [];

    if (history.length === 0) {
      // If no history, fetch current price to start tracking
      try {
        const currentPrice = await this.getCurrentPrice(poolAddress);
        return [{ price: currentPrice, timestamp: new Date() }];
      } catch (error) {
        console.error("Error fetching current price for history:", error);
        return [];
      }
    }

    // Filter by timeframe
    const cutoffTime = Date.now() - timeframe;
    return history.filter((point) => point.timestamp.getTime() >= cutoffTime);
  }

  /**
   * Get market data for a token/pool combination
   */
  async getMarketData(tokenSymbol: string, tokenMint: string, poolAddress: string): Promise<MarketData> {
    const price = await this.getTokenPrice(tokenMint, poolAddress);

    // Calculate 24h price change
    const history24h = await this.getPriceHistory(poolAddress, 24 * 60 * 60 * 1000);
    let priceChange24h = 0;

    if (history24h.length > 1) {
      const oldestPrice = history24h[0].price;
      priceChange24h = ((price - oldestPrice) / oldestPrice) * 100;
    }

    // Volume calculation would require additional data sources
    // For now, return 0 as placeholder
    const volume24h = 0;

    return {
      token: tokenSymbol,
      pool: poolAddress,
      price,
      volume24h,
      priceChange24h,
      timestamp: new Date(),
    };
  }

  /**
   * Get prices for multiple tokens (batch operation)
   */
  async getBatchPrices(tokens: Array<{ mint: string; pool: string }>): Promise<Map<string, number>> {
    const prices = new Map<string, number>();

    // Fetch all prices in parallel
    await Promise.all(
      tokens.map(async ({ mint, pool }) => {
        try {
          const price = await this.getTokenPrice(mint, pool);
          prices.set(mint, price);
        } catch (error) {
          console.error(`Failed to get price for ${mint}:`, error);
          prices.set(mint, 0);
        }
      }),
    );

    return prices;
  }

  /**
   * Clear price cache
   */
  clearCache(): void {
    this.priceCache.clear();
  }

  /**
   * Clear price history
   */
  clearHistory(): void {
    this.priceHistory.clear();
  }

  /**
   * Set cache expiry time in milliseconds
   */
  setCacheExpiry(ms: number): void {
    this.cacheExpiry = ms;
  }

  /**
   * Calculate price impact for a trade
   * Uses historical data to estimate slippage
   */
  calculatePriceImpact(tradeAmount: number, poolLiquidity: number): number {
    if (poolLiquidity === 0) return 100; // 100% impact if no liquidity

    // Simplified constant product formula impact
    // impact = tradeAmount / (poolLiquidity + tradeAmount)
    const impact = (tradeAmount / (poolLiquidity + tradeAmount)) * 100;

    return Math.min(impact, 100); // Cap at 100%
  }

  /**
   * Get historical prices (from in-memory cache)
   */
  async getHistoricalPrices(
    tokenMint: string,
    poolAddress: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ price: number; timestamp: Date }>> {
    const cacheKey = `${tokenMint}_${poolAddress}`;
    const history = this.priceHistory.get(cacheKey) || [];

    // Filter by date range
    return history.filter(
      (point) => point.timestamp.getTime() >= from.getTime() && point.timestamp.getTime() <= to.getTime(),
    );
  }

  /**
   * Get statistics from price history
   */
  getPriceStatistics(poolAddress: string): {
    current: number;
    high24h: number;
    low24h: number;
    avg24h: number;
    volatility: number;
  } {
    const cacheKey = `${poolAddress}_price`;
    const history24h = this.priceHistory.get(cacheKey) || [];

    if (history24h.length === 0) {
      return {
        current: 0,
        high24h: 0,
        low24h: 0,
        avg24h: 0,
        volatility: 0,
      };
    }

    const prices = history24h.map((p) => p.price);
    const current = prices[prices.length - 1];
    const high24h = Math.max(...prices);
    const low24h = Math.min(...prices);
    const avg24h = prices.reduce((a, b) => a + b, 0) / prices.length;

    // Calculate volatility (standard deviation)
    const variance = prices.reduce((sum, price) => sum + Math.pow(price - avg24h, 2), 0) / prices.length;
    const volatility = Math.sqrt(variance);

    return {
      current,
      high24h,
      low24h,
      avg24h,
      volatility,
    };
  }

  /**
   * Check if price data is stale
   */
  isStale(poolAddress: string): boolean {
    const cacheKey = `${poolAddress}_price`;
    const cached = this.priceCache.get(cacheKey);

    if (!cached) return true;

    return Date.now() - cached.timestamp.getTime() > this.cacheExpiry;
  }
}

// Export singleton instance
export const marketDataService = new MarketDataService();
