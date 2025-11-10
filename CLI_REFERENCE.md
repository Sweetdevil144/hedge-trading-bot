# CLI Command Reference

Complete reference for all hedge-bot CLI commands.

## Installation

```bash
# Development mode
npm run cli -- <command>

# Production (after build)
npm run build:cli
npm install -g .
hedge-bot <command>
```

## Account Management

### Create Account
```bash
hedge-bot account create
```
Creates a new wallet and user account. Generates seed phrase and stores encrypted in database.

### Login
```bash
hedge-bot account login -u <userId>
hedge-bot account login -w <walletPath>
```
Login to existing account by user ID or wallet file path.

**Options:**
- `-u, --user <userId>` - Login with user ID
- `-w, --wallet <path>` - Login with wallet file

### Check Balance
```bash
hedge-bot account balance
```
Display current token balances (SOL, USDC, USDi, etc).

## Hedge Trading

### Open Hedge Position
```bash
hedge-bot hedge open <token> <amount> [options]
```
Open a hedge position (paired long/short).

**Arguments:**
- `<token>` - Token symbol (e.g., SOL, BTC)
- `<amount>` - Amount to hedge in USDC

**Options:**
- `-s, --strategy <type>` - Strategy type (delta-neutral | pairs)

**Examples:**
```bash
# Open delta-neutral hedge on 1 SOL
hedge-bot hedge open SOL 1 --strategy delta-neutral

# Open pairs trade on 500 USDC worth of BTC
hedge-bot hedge open BTC 500 --strategy pairs
```

### Close Hedge Position
```bash
hedge-bot hedge close <positionId>
```
Close an existing hedge position.

**Example:**
```bash
hedge-bot hedge close abc123def456
```

### List Hedge Positions
```bash
hedge-bot hedge list [options]
```
List all hedge positions.

**Options:**
- `-s, --status <status>` - Filter by status (OPEN | CLOSED)

**Examples:**
```bash
# List all positions
hedge-bot hedge list

# List only open positions
hedge-bot hedge list --status OPEN
```

### Position Status
```bash
hedge-bot hedge status <positionId>
```
Get detailed status of specific hedge position including P&L, hedge ratio, and drift.

### Rebalance Position
```bash
hedge-bot hedge rebalance <positionId>
```
Manually trigger rebalancing of hedge position.

## Trading

### Swap Tokens
```bash
hedge-bot trade swap <from> <to> <amount> [options]
```
Swap one token for another.

**Options:**
- `-s, --slippage <bps>` - Slippage tolerance in basis points (default: 200 = 2%)

**Example:**
```bash
hedge-bot trade swap USDC SOL 100 --slippage 250
```

### Buy Tokens
```bash
hedge-bot trade buy <token> <amount>
```
Buy tokens with USDC.

**Example:**
```bash
hedge-bot trade buy SOL 10
```

### Sell Tokens
```bash
hedge-bot trade sell <token> <amount>
```
Sell tokens for USDC.

**Example:**
```bash
hedge-bot trade sell SOL 5
```

## Liquidity Management

### List Pools
```bash
hedge-bot liquidity pools
```
Display all available Orca liquidity pools.

### Add Liquidity
```bash
hedge-bot liquidity add <pool> <amount>
```
Add liquidity to an Orca pool.

**Example:**
```bash
hedge-bot liquidity add SOL-USDC 100
```

### Remove Liquidity
```bash
hedge-bot liquidity remove <positionId>
```
Remove liquidity from a pool position.

## Monitoring

### Monitor Positions
```bash
hedge-bot monitor positions
```
Real-time monitoring of all open positions with P&L updates.

### Portfolio P&L
```bash
hedge-bot monitor pnl
```
Display portfolio-wide P&L summary with statistics.

## Automation

### Start Automation
```bash
hedge-bot auto start [options]
```
Start automated trading engine.

**Options:**
- `-s, --strategy <type>` - Strategy to use (default: hedge)
- `--dry-run` - Run in simulation mode (no real trades)

**Examples:**
```bash
# Start with hedge strategy (live mode)
hedge-bot auto start --strategy hedge

# Start in dry-run mode
hedge-bot auto start --dry-run
```

### Stop Automation
```bash
hedge-bot auto stop
```
Stop automated trading engine gracefully.

### Automation Status
```bash
hedge-bot auto status
```
Display automation engine status including:
- Running state
- Active strategies
- Positions opened
- Signals detected
- Uptime

### Emergency Kill Switch
```bash
hedge-bot auto kill-switch
```
Emergency stop - immediately halts all trading. Requires confirmation.

## Signals

### Watch Signals
```bash
hedge-bot signals watch [options]
```
Monitor trading signals in real-time.

**Options:**
- `-p, --pool <address>` - Pool address to monitor

**Example:**
```bash
hedge-bot signals watch --pool HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ
```

### List Signals
```bash
hedge-bot signals list
```
Display all recent trading signals.

## Portfolio & Analytics

### Portfolio Summary
```bash
hedge-bot portfolio
```
Display complete portfolio summary including:
- Total value
- Total P&L (day/week/month)
- Open positions
- Risk metrics

### Position Details
```bash
hedge-bot position <id>
```
View detailed metrics for specific position.

### Trade History
```bash
hedge-bot history [options]
```
Display historical trades.

**Options:**
- `--days <number>` - Number of days to show (default: 30)

**Example:**
```bash
hedge-bot history --days 7
```

### Export Data
```bash
hedge-bot export [options]
```
Export trading data to file.

**Options:**
- `--from <date>` - Start date (YYYY-MM-DD)
- `--to <date>` - End date (YYYY-MM-DD)
- `--format <type>` - Output format (csv | json)

**Example:**
```bash
hedge-bot export --from 2025-01-01 --to 2025-01-31 --format csv
```

### Risk Check
```bash
hedge-bot risk check
```
Perform comprehensive risk analysis on portfolio.

## Global Options

All commands support:
- `-h, --help` - Show command help
- `-v, --version` - Show version number

## Configuration

CLI stores configuration in `~/.hedge-bot/config.json`:
```json
{
  "currentUserId": "user123",
  "network": "mainnet-beta",
  "defaultSlippage": 200
}
```

## Exit Codes

- `0` - Success
- `1` - General error
- `2` - Validation error
- `3` - Insufficient funds
- `130` - User cancelled (Ctrl+C)

## Amount Notation

The CLI supports shorthand notation:
- `1K` = 1,000
- `1M` = 1,000,000
- `0.5K` = 500

**Example:**
```bash
hedge-bot hedge open SOL 1.5K  # Opens position with 1,500 USDC
```

## Tips

1. **Always test with --dry-run first**
   ```bash
   hedge-bot auto start --dry-run
   ```

2. **Use kill-switch for emergencies**
   ```bash
   hedge-bot auto kill-switch
   ```

3. **Monitor positions regularly**
   ```bash
   hedge-bot monitor positions
   ```

4. **Check risk before large trades**
   ```bash
   hedge-bot risk check
   ```

5. **Start with small amounts**
   - Test with devnet first
   - Start with minimum position sizes
   - Verify behavior before scaling

---

__(These documentations are auto generated by ollama. Please run `~/ollama/bot generate docs` to regerate the file using folder context)__