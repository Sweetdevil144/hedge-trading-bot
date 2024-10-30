# Trading Strategies Guide

Comprehensive guide to trading strategies implemented in the hedge trading bot.

## Overview

The bot supports multiple trading strategies through an extensible framework. Each strategy implements entry/exit logic, risk management, and position sizing.

## Available Strategies

### 1. Delta-Neutral Hedge Strategy

**Type:** Spread-based hedge trading
**Risk Level:** Low to Medium
**Best For:** Market-neutral returns, spread capture

#### Description
Opens paired long/short positions to profit from price spreads while minimizing directional exposure. Maintains a 1:1 hedge ratio for delta neutrality.

#### When to Use
- High volatility with uncertain direction
- Abnormal spread between pools (>0.5%)
- Seeking market-neutral returns
- Protecting against directional risk

#### Entry Conditions
1. **Spread Opportunity**
   - Spread between pools exceeds 0.5% (configurable)
   - Sufficient liquidity in both pools
   - Balance available for both sides

2. **Breakout Detection**
   - Price movement >2% from historical average
   - Strong momentum signal
   - Volume confirmation

#### Exit Conditions
1. **Take Profit:** Position P&L reaches +5% (configurable)
2. **Stop Loss:** Position P&L reaches -10% (configurable)
3. **Hedge Drift:** Ratio drifts >15% AND P&L >-3%

#### Position Sizing
- Default: 1000 USDC per position
- Requires 2x amount (long + short)
- Configurable via `maxPositionSize` parameter

#### Risk Management
- Maximum 10 concurrent positions
- Automatic rebalancing on >5% drift
- Stop-loss protection at -10%
- Balance validation before opening

#### Parameters
```json
{
  "minSpread": 0.005,           // 0.5% minimum spread
  "stopLoss": 0.10,             // 10% stop loss
  "takeProfit": 0.05,           // 5% take profit
  "maxPositionSize": 1000,      // Max size in USDC
  "maxPositions": 10,           // Max concurrent positions
  "rebalanceThreshold": 0.05    // 5% drift threshold
}
```

#### Example Usage

**CLI:**
```bash
# Open delta-neutral position on SOL
hedge-bot hedge open SOL 1 --strategy delta-neutral

# Monitor position
hedge-bot hedge status abc123

# Manually rebalance if needed
hedge-bot hedge rebalance abc123

# Close position
hedge-bot hedge close abc123
```

**Automated:**
```bash
# Start automation with hedge strategy
hedge-bot auto start --strategy hedge

# Check status
hedge-bot auto status

# Stop when done
hedge-bot auto stop
```

#### Expected Returns
- Target: 0.5-2% per trade
- Win rate: 60-70%
- Holding period: Hours to days
- Risk/reward: 1:2 (risk 10% for 5% profit)

#### Risks
- Spread normalization (spread closes before exit)
- Hedge ratio drift during high volatility
- Slippage on entry/exit
- Pool liquidity constraints

### 2. Pairs Trading (Coming Soon)

**Type:** Statistical arbitrage
**Risk Level:** Medium
**Best For:** Mean reversion, correlated pairs

#### Description
Trades on temporary divergence between correlated asset pairs, expecting convergence.

### 3. Momentum Trading (Coming Soon)

**Type:** Trend following
**Risk Level:** Medium to High
**Best For:** Strong trends, breakouts

#### Description
Enters positions in direction of strong trends, rides momentum.

### 4. Arbitrage (Coming Soon)

**Type:** Price discrepancy exploitation
**Risk Level:** Low
**Best For:** Cross-exchange, cross-pool opportunities

#### Description
Exploits price differences between venues for risk-free profit.

## Strategy Framework

### Creating Custom Strategies

All strategies extend the `BaseStrategy` class:

```typescript
import { BaseStrategy } from './baseStrategy';

export class MyStrategy extends BaseStrategy {
  async canExecute(): Promise<boolean> {
    // Check entry conditions
    // Return true if should open position
  }

  async execute(signal: Signal): Promise<void> {
    // Execute trading logic
    // Open positions
  }

  async shouldClose(position: Position): Promise<boolean> {
    // Check exit conditions
    // Return true if should close
  }
}
```

### Strategy Lifecycle

1. **Initialization**
   - Register with AutomationEngine
   - Start monitoring pools/signals
   - Load configuration

2. **Monitoring**
   - Detect signals (breakouts, spreads, etc)
   - Check entry conditions
   - Validate risk limits

3. **Execution**
   - Calculate position size
   - Open positions
   - Track in active set

4. **Management**
   - Monitor P&L
   - Check rebalancing needs
   - Detect exit conditions

5. **Exit**
   - Close positions
   - Calculate realized P&L
   - Update statistics

6. **Cleanup**
   - Stop monitoring
   - Release resources

## Signal Types

### Breakout Signals
- **Detection:** Price moves >2% from average
- **Confidence:** Based on magnitude
- **Expiry:** 5 minutes
- **Use Case:** Momentum strategies

### Spread Signals
- **Detection:** Price difference >0.5% between pools
- **Confidence:** Based on spread size
- **Expiry:** 2 minutes
- **Use Case:** Hedge strategies, arbitrage

### Volume Spike Signals
- **Detection:** Volume >2x average
- **Confidence:** Based on spike magnitude
- **Expiry:** 5 minutes
- **Use Case:** Confirming breakouts

### Trend Change Signals
- **Detection:** SMA crossover (10 vs 30 period)
- **Confidence:** 70% default
- **Expiry:** No expiry (state)
- **Use Case:** Trend following

### Rebalance Signals
- **Detection:** Hedge ratio drift >5%
- **Confidence:** Based on drift magnitude
- **Expiry:** Immediate action
- **Use Case:** Position management

## Risk Management

### Position Limits
- **Max Position Size:** 1000 USDC (configurable)
- **Max Positions:** 10 concurrent
- **Max Daily Loss:** 10% of portfolio
- **Min SOL Balance:** 0.1 SOL for fees

### Stop Loss & Take Profit
- **Default Stop Loss:** -10%
- **Default Take Profit:** +5%
- **Trailing Stop:** Not implemented yet
- **Break-even Stop:** Moves to 0% after +3%

### Portfolio Exposure
- **Max Single Token:** 30% of portfolio
- **Max Total Exposure:** Calculated dynamically
- **Hedge Ratio Monitoring:** Continuous
- **Rebalance Threshold:** 5% drift

## Automation

### Safety Mechanisms

1. **Kill Switch**
   - Emergency stop all trading
   - Requires manual deactivation
   - Prevents restart until cleared

2. **Dry-Run Mode**
   - Simulates trades without execution
   - Logs "would execute" actions
   - Safe for testing

3. **Rate Limiting**
   - Max 3 positions per hour
   - Prevents runaway trading
   - Configurable threshold

4. **Manual Approval**
   - Large trades ($1000+) blocked
   - Requires confirmation
   - Configurable threshold

### Monitoring Cycle

- **Check Interval:** 30 seconds
- **Entry Checks:** Every cycle
- **Exit Checks:** Every cycle
- **Rebalance Checks:** Every cycle
- **Status Updates:** Real-time

## Performance Optimization

### Best Practices

1. **Start with Dry-Run**
   ```bash
   hedge-bot auto start --dry-run
   ```

2. **Monitor First Hour**
   - Watch for unexpected behavior
   - Verify signals detecting correctly
   - Check position opening/closing

3. **Adjust Parameters**
   - Start conservative
   - Increase limits gradually
   - Test each change

4. **Use Kill Switch**
   - Keep readily available
   - Don't hesitate to use
   - Review before restarting

### Performance Metrics

Track these key metrics:
- Win rate (target: >60%)
- Average win vs average loss (target: >1.5)
- Max drawdown (target: <15%)
- Sharpe ratio (target: >1.0)
- Position holding time
- Slippage impact

## Troubleshooting

### Position Not Opening

**Possible Causes:**
- Insufficient balance
- Max positions reached
- Risk limits exceeded
- Signal expired
- Slippage too high

**Solutions:**
- Check balance: `hedge-bot account balance`
- Check risk: `hedge-bot risk check`
- Increase slippage tolerance
- Wait for fresh signal

### Position Not Closing

**Possible Causes:**
- Exit conditions not met
- Network issues
- Insufficient liquidity
- Transaction timeout

**Solutions:**
- Check status: `hedge-bot hedge status <id>`
- Manual close: `hedge-bot hedge close <id>`
- Verify network connection
- Check pool liquidity

### Unexpected P&L

**Possible Causes:**
- Slippage on execution
- Fees not accounted
- Price moved during execution
- Hedge ratio drifted

**Solutions:**
- Review transaction history
- Check execution prices
- Monitor hedge ratio
- Rebalance if needed

### Automation Stopped

**Possible Causes:**
- Kill switch activated
- Error in strategy logic
- Database connection lost
- RPC rate limited

**Solutions:**
- Check status: `hedge-bot auto status`
- Review logs in `logs/` directory
- Deactivate kill switch
- Restart automation

## Strategy Comparison

| Strategy | Risk | Returns | Win Rate | Hold Time | Complexity |
|----------|------|---------|----------|-----------|------------|
| Delta-Neutral | Low | 0.5-2% | 60-70% | Hours-Days | Medium |
| Pairs Trading | Medium | 1-5% | 55-65% | Days-Weeks | High |
| Momentum | High | 5-20% | 40-50% | Hours-Days | Medium |
| Arbitrage | Low | 0.1-0.5% | 80-90% | Minutes | Low |

## Advanced Topics

### Custom Indicators

Create custom technical indicators in `src/utils/indicators.ts`:

```typescript
export function myCustomIndicator(prices: number[]): number {
  // Your indicator logic
  return result;
}
```

### Strategy Chaining

Combine multiple strategies:

```typescript
// Not yet implemented
const compositeStrategy = new CompositeStrategy([
  new HedgeStrategy(config1),
  new MomentumStrategy(config2)
]);
```

### Machine Learning Integration

Future enhancement for ML-based signal generation:

```typescript
// Planned feature
const mlStrategy = new MLStrategy({
  model: 'trained_model.pkl',
  features: ['rsi', 'macd', 'volume']
});
```

## Further Reading

- **Technical Indicators:** See `src/utils/indicators.ts`
- **Signal Engine:** See `src/core/signalEngine.ts`
- **Base Strategy:** See `src/strategies/baseStrategy.ts`
- **Risk Management:** See `src/core/riskManager.ts`
- **CLI Commands:** See `CLI_REFERENCE.md`

---

__(These documentations are auto generated by ollama. Please run `~/ollama/bot generate docs` to regerate the file using folder context)__