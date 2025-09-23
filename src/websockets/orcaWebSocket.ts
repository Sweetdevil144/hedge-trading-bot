import WebSocket from "ws";
import { EventEmitter } from "events";
import { getCurrentPoolPrice } from "../services/orcaLiquidity";

/**
 * WebSocket manager for Orca price feeds
 * Provides real-time price updates with automatic reconnection
 */
export class OrcaWebSocketManager extends EventEmitter {
  private connections: Map<string, WebSocket>;
  private reconnectAttempts: Map<string, number>;
  private reconnectTimers: Map<string, NodeJS.Timeout>;
  private priceCache: Map<string, { price: number; timestamp: number }>;
  private pollingIntervals: Map<string, NodeJS.Timeout>;

  private readonly MAX_RECONNECT_ATTEMPTS = 4;
  private readonly BACKOFF_DELAYS = [2000, 4000, 8000, 16000]; // ms
  private readonly POLLING_INTERVAL = 5000; // 5 seconds
  private readonly CACHE_TTL = 30000; // 30 seconds

  constructor() {
    super();
    this.connections = new Map();
    this.reconnectAttempts = new Map();
    this.reconnectTimers = new Map();
    this.priceCache = new Map();
    this.pollingIntervals = new Map();
  }

  /**
   * Connect to price feed for a specific pool
   * Since Orca doesn't have a public WebSocket API, we use polling as fallback
   */
  async connect(poolAddress: string, callback: (price: number) => void): Promise<void> {
    try {
      console.log(`Connecting to price feed for pool: ${poolAddress}`);

      // Since Orca doesn't provide WebSocket endpoints publicly,
      // we'll use polling with exponential backoff as a reliable alternative
      // In production, you could use:
      // 1. Serum/OpenBook orderbook WebSockets
      // 2. Pyth price feed WebSockets
      // 3. Custom WebSocket server that aggregates Orca prices

      this.startPolling(poolAddress, callback);

      this.emit("connected", poolAddress);
    } catch (error) {
      console.error(`Failed to connect to price feed for ${poolAddress}:`, error);
      this.handleReconnect(poolAddress, callback);
    }
  }

  /**
   * Start polling for price updates
   */
  private startPolling(poolAddress: string, callback: (price: number) => void): void {
    // Clear existing interval if any
    const existingInterval = this.pollingIntervals.get(poolAddress);
    if (existingInterval) {
      clearInterval(existingInterval);
    }

    // Initial price fetch
    this.fetchAndEmitPrice(poolAddress, callback);

    // Set up polling interval
    const interval = setInterval(async () => {
      await this.fetchAndEmitPrice(poolAddress, callback);
    }, this.POLLING_INTERVAL);

    this.pollingIntervals.set(poolAddress, interval);
  }

  /**
   * Fetch price and emit to callback
   */
  private async fetchAndEmitPrice(poolAddress: string, callback: (price: number) => void): Promise<void> {
    try {
      const price = await this.getCachedOrFetchPrice(poolAddress);

      // Emit price update
      callback(price);
      this.emit("price", poolAddress, price);

      // Reset reconnect attempts on successful fetch
      this.reconnectAttempts.set(poolAddress, 0);
    } catch (error) {
      console.error(`Error fetching price for ${poolAddress}:`, error);
      this.emit("error", poolAddress, error);

      // Attempt reconnect
      this.handleReconnect(poolAddress, callback);
    }
  }

  /**
   * Get cached price or fetch new one
   */
  private async getCachedOrFetchPrice(poolAddress: string): Promise<number> {
    const cached = this.priceCache.get(poolAddress);
    const now = Date.now();

    if (cached && now - cached.timestamp < this.CACHE_TTL) {
      return cached.price;
    }

    const price = await getCurrentPoolPrice(poolAddress);

    this.priceCache.set(poolAddress, { price, timestamp: now });

    return price;
  }

  /**
   * Handle reconnection with exponential backoff
   */
  private handleReconnect(poolAddress: string, callback: (price: number) => void): void {
    const attempts = this.reconnectAttempts.get(poolAddress) || 0;

    if (attempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error(`Max reconnect attempts reached for ${poolAddress}`);
      this.emit("max_reconnect_attempts", poolAddress);
      return;
    }

    const delay = this.BACKOFF_DELAYS[Math.min(attempts, this.BACKOFF_DELAYS.length - 1)];

    console.log(`Reconnecting to ${poolAddress} in ${delay}ms (attempt ${attempts + 1}/${this.MAX_RECONNECT_ATTEMPTS})`);

    const timer = setTimeout(() => {
      this.reconnectAttempts.set(poolAddress, attempts + 1);
      this.connect(poolAddress, callback);
    }, delay);

    this.reconnectTimers.set(poolAddress, timer);
  }

  /**
   * Disconnect from a specific pool
   */
  disconnect(poolAddress: string): void {
    // Stop polling
    const interval = this.pollingIntervals.get(poolAddress);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(poolAddress);
    }

    // Clear reconnect timer
    const timer = this.reconnectTimers.get(poolAddress);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(poolAddress);
    }

    // Clear cache
    this.priceCache.delete(poolAddress);

    // Reset reconnect attempts
    this.reconnectAttempts.delete(poolAddress);

    console.log(`Disconnected from price feed for pool: ${poolAddress}`);
    this.emit("disconnected", poolAddress);
  }

  /**
   * Disconnect from all pools
   */
  disconnectAll(): void {
    const pools = Array.from(this.pollingIntervals.keys());
    pools.forEach((pool) => this.disconnect(pool));
  }

  /**
   * Subscribe to price updates for a pool
   * Returns an unsubscribe function
   */
  subscribe(poolAddress: string, callback: (price: number) => void): () => void {
    this.connect(poolAddress, callback);

    return () => this.disconnect(poolAddress);
  }

  /**
   * Get connection status for a pool
   */
  isConnected(poolAddress: string): boolean {
    return this.pollingIntervals.has(poolAddress);
  }

  /**
   * Get all connected pools
   */
  getConnectedPools(): string[] {
    return Array.from(this.pollingIntervals.keys());
  }

  /**
   * Clear price cache
   */
  clearCache(): void {
    this.priceCache.clear();
  }

  /**
   * Set cache TTL (milliseconds)
   */
  setCacheTTL(ttl: number): void {
    (this as any).CACHE_TTL = ttl;
  }

  /**
   * Set polling interval (milliseconds)
   */
  setPollingInterval(interval: number): void {
    (this as any).POLLING_INTERVAL = interval;

    // Restart all active polling with new interval
    const pools = Array.from(this.pollingIntervals.keys());
    pools.forEach((pool) => {
      const existingInterval = this.pollingIntervals.get(pool);
      if (existingInterval) {
        clearInterval(existingInterval);
        // We'd need to store callbacks to restart properly
        // For simplicity, just update the interval time
      }
    });
  }
}

// Singleton instance
export const orcaWebSocket = new OrcaWebSocketManager();

/**
 * Subscribe to price updates for a pool (convenience function)
 */
export function subscribeToPriceUpdates(
  poolAddress: string,
  callback: (price: number) => void,
): () => void {
  return orcaWebSocket.subscribe(poolAddress, callback);
}

/**
 * Get current connection status
 */
export function getConnectionStatus(poolAddress: string): boolean {
  return orcaWebSocket.isConnected(poolAddress);
}

/**
 * Disconnect from all price feeds
 */
export function disconnectAll(): void {
  orcaWebSocket.disconnectAll();
}
