/**
 * Technical Indicators - Simple technical analysis indicators
 */

/**
 * Simple Moving Average (SMA)
 * Calculates the average price over a specified period
 */
export function SMA(prices: number[], period: number): number {
  if (prices.length < period) {
    throw new Error(`Not enough data points. Need ${period}, got ${prices.length}`);
  }

  // Take the last 'period' prices
  const relevantPrices = prices.slice(-period);
  const sum = relevantPrices.reduce((acc, price) => acc + price, 0);
  return sum / period;
}

/**
 * Exponential Moving Average (EMA)
 * Gives more weight to recent prices
 */
export function EMA(prices: number[], period: number): number {
  if (prices.length < period) {
    throw new Error(`Not enough data points. Need ${period}, got ${prices.length}`);
  }

  const multiplier = 2 / (period + 1);
  let ema = prices[0]; // Start with first price

  for (let i = 1; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }

  return ema;
}

/**
 * Price change percentage
 * Calculates the percentage change between two prices
 */
export function priceChange(currentPrice: number, previousPrice: number): number {
  if (previousPrice === 0) {
    throw new Error("Previous price cannot be zero");
  }

  return ((currentPrice - previousPrice) / previousPrice) * 100;
}

/**
 * Price change over period
 * Calculates the percentage change over a specific period
 */
export function priceChangeOverPeriod(prices: number[]): number {
  if (prices.length < 2) {
    throw new Error("Need at least 2 price points");
  }

  const firstPrice = prices[0];
  const lastPrice = prices[prices.length - 1];

  return priceChange(lastPrice, firstPrice);
}

/**
 * Volatility (standard deviation)
 * Measures price volatility over a period
 */
export function volatility(prices: number[]): number {
  if (prices.length < 2) {
    throw new Error("Need at least 2 price points for volatility calculation");
  }

  // Calculate mean
  const mean = prices.reduce((acc, price) => acc + price, 0) / prices.length;

  // Calculate variance
  const variance =
    prices.reduce((acc, price) => acc + Math.pow(price - mean, 2), 0) / prices.length;

  // Standard deviation
  return Math.sqrt(variance);
}

/**
 * Relative volatility (coefficient of variation)
 * Volatility as a percentage of mean price
 */
export function relativeVolatility(prices: number[]): number {
  const mean = prices.reduce((acc, price) => acc + price, 0) / prices.length;
  const vol = volatility(prices);

  return (vol / mean) * 100;
}

/**
 * Average volume calculation
 */
export function averageVolume(volumes: number[], period: number): number {
  if (volumes.length < period) {
    throw new Error(`Not enough volume data. Need ${period}, got ${volumes.length}`);
  }

  const relevantVolumes = volumes.slice(-period);
  return relevantVolumes.reduce((acc, vol) => acc + vol, 0) / period;
}

/**
 * Volume spike detection
 * Returns true if current volume is significantly higher than average
 */
export function isVolumeSpike(
  currentVolume: number,
  averageVolume: number,
  threshold: number = 2.0,
): boolean {
  return currentVolume > averageVolume * threshold;
}

/**
 * Bollinger Bands
 * Returns upper and lower bands based on SMA and standard deviation
 */
export function bollingerBands(
  prices: number[],
  period: number = 20,
  stdDevMultiplier: number = 2,
): {
  upper: number;
  middle: number;
  lower: number;
} {
  const middle = SMA(prices, period);
  const relevantPrices = prices.slice(-period);
  const stdDev = volatility(relevantPrices);

  return {
    upper: middle + stdDev * stdDevMultiplier,
    middle,
    lower: middle - stdDev * stdDevMultiplier,
  };
}

/**
 * RSI (Relative Strength Index)
 * Momentum indicator (0-100)
 */
export function RSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) {
    throw new Error(`Not enough data for RSI. Need ${period + 1}, got ${prices.length}`);
  }

  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i] - prices[i - 1]);
  }

  const gains = changes.map((change) => (change > 0 ? change : 0));
  const losses = changes.map((change) => (change < 0 ? Math.abs(change) : 0));

  const avgGain = gains.slice(-period).reduce((acc, gain) => acc + gain, 0) / period;
  const avgLoss = losses.slice(-period).reduce((acc, loss) => acc + loss, 0) / period;

  if (avgLoss === 0) {
    return 100; // No losses, RSI = 100
  }

  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);

  return rsi;
}

/**
 * MACD (Moving Average Convergence Divergence)
 * Trend-following momentum indicator
 */
export function MACD(
  prices: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9,
): {
  macd: number;
  signal: number;
  histogram: number;
} {
  if (prices.length < slowPeriod) {
    throw new Error(`Not enough data for MACD. Need ${slowPeriod}, got ${prices.length}`);
  }

  const fastEMA = EMA(prices, fastPeriod);
  const slowEMA = EMA(prices, slowPeriod);
  const macd = fastEMA - slowEMA;

  // For signal line, we'd need historical MACD values
  // Simplified: use current MACD as approximation
  const signal = macd;
  const histogram = macd - signal;

  return {
    macd,
    signal,
    histogram,
  };
}

/**
 * Detect price breakout
 * Returns true if price breaks above/below a threshold
 */
export function detectBreakout(
  currentPrice: number,
  historicalPrices: number[],
  threshold: number = 0.02, // 2%
): {
  breakout: boolean;
  direction: "up" | "down" | null;
  magnitude: number;
} {
  if (historicalPrices.length === 0) {
    return { breakout: false, direction: null, magnitude: 0 };
  }

  const recentAvg = SMA(historicalPrices, Math.min(20, historicalPrices.length));
  const changePercent = priceChange(currentPrice, recentAvg);
  const magnitude = Math.abs(changePercent) / 100;

  if (magnitude > threshold) {
    return {
      breakout: true,
      direction: changePercent > 0 ? "up" : "down",
      magnitude,
    };
  }

  return { breakout: false, direction: null, magnitude };
}

/**
 * Detect trend
 * Returns trend direction based on price history
 */
export function detectTrend(
  prices: number[],
  shortPeriod: number = 10,
  longPeriod: number = 30,
): "uptrend" | "downtrend" | "sideways" {
  if (prices.length < longPeriod) {
    return "sideways";
  }

  const shortMA = SMA(prices, shortPeriod);
  const longMA = SMA(prices, longPeriod);

  const difference = ((shortMA - longMA) / longMA) * 100;

  if (difference > 1) {
    return "uptrend";
  } else if (difference < -1) {
    return "downtrend";
  } else {
    return "sideways";
  }
}

/**
 * Calculate support and resistance levels
 */
export function supportResistance(
  prices: number[],
): {
  support: number;
  resistance: number;
} {
  if (prices.length < 2) {
    return { support: prices[0] || 0, resistance: prices[0] || 0 };
  }

  const sorted = [...prices].sort((a, b) => a - b);
  const support = sorted[Math.floor(sorted.length * 0.1)]; // 10th percentile
  const resistance = sorted[Math.floor(sorted.length * 0.9)]; // 90th percentile

  return { support, resistance };
}

/**
 * Calculate price momentum
 * Rate of price change over time
 */
export function momentum(prices: number[], period: number = 10): number {
  if (prices.length < period) {
    throw new Error(`Not enough data for momentum. Need ${period}, got ${prices.length}`);
  }

  const currentPrice = prices[prices.length - 1];
  const oldPrice = prices[prices.length - period];

  return currentPrice - oldPrice;
}

/**
 * Rate of Change (ROC)
 * Momentum indicator as percentage
 */
export function ROC(prices: number[], period: number = 10): number {
  if (prices.length < period) {
    throw new Error(`Not enough data for ROC. Need ${period}, got ${prices.length}`);
  }

  const currentPrice = prices[prices.length - 1];
  const oldPrice = prices[prices.length - period];

  return priceChange(currentPrice, oldPrice);
}

/**
 * Average True Range (ATR)
 * Volatility indicator
 */
export function ATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14,
): number {
  if (highs.length !== lows.length || lows.length !== closes.length) {
    throw new Error("High, low, and close arrays must have the same length");
  }

  if (highs.length < period + 1) {
    throw new Error(`Not enough data for ATR. Need ${period + 1}, got ${highs.length}`);
  }

  const trueRanges: number[] = [];

  for (let i = 1; i < highs.length; i++) {
    const high = highs[i];
    const low = lows[i];
    const prevClose = closes[i - 1];

    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));

    trueRanges.push(tr);
  }

  // Average of last 'period' true ranges
  const relevantTR = trueRanges.slice(-period);
  return relevantTR.reduce((acc, tr) => acc + tr, 0) / period;
}
