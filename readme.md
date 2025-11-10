# Hedge Trading Bot

A sophisticated Telegram bot for hedge trading on Solana. This bot provides wallet management, DeFi protocol interaction, and advanced hedge trading capabilities including position management, risk controls, and automated rebalancing.

## Features

### Core Trading (Telegram Bot)
- 💰 Wallet Creation & Management
- 💎 USDC Deposits & Withdrawals
- 📈 Minting & Redemption
- 🔄 Token Conversions (USDi/USDC)
- 🔒 Secure Backup & Recovery with AES-256 Encryption
- 📊 Real-time Balance Checking
- 🌀 Liquidity Pools (Orca Whirlpools Integration)
- 🔄 Network Switching (mainnet/devnet/testnet)

### New Hedge Trading Capabilities
- 📊 **Position Management**: Track long, short, and hedge positions
- ⚖️ **Risk Management**: Automated stop-loss, take-profit, and risk metrics
- 🔄 **Auto-Rebalancing**: Maintain optimal hedge ratios
- 💾 **PostgreSQL Database**: Persistent storage for positions, transactions, and orders
- 🔐 **Encrypted Storage**: AES-256 encryption for private keys and seed phrases
- 📈 **Market Data Integration**: Real-time price tracking (ready for oracle integration)
- 🎯 **Strategy Framework**: Extensible strategy system for custom trading logic

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- PostgreSQL 12+ (or Docker)
- Telegram Bot Token (from [@BotFather](https://t.me/botfather))
- Solana RPC endpoint (optional, defaults to public endpoints)

## Quick Start

**First time setup?** → See [SETUP_GUIDE.md](./SETUP_GUIDE.md) for detailed instructions.

**Understanding the refactoring?** → See [IMPLEMENTATION_SUMMARY.md](./IMPLEMENTATION_SUMMARY.md) for complete details.

### Installation

1. **Clone the repository:**

```bash
git clone https://github.com/btunter/hedge-traing-bot-beta.git
cd hedge-traing-bot-beta
```

2. **Install dependencies:**

```bash
npm install
```

3. **Set up PostgreSQL:**

```bash
# Using Docker (recommended for development)
docker run --name hedge-postgres \
  -e POSTGRES_PASSWORD=yourpassword \
  -e POSTGRES_DB=hedge_trading_bot \
  -p 5432:5432 \
  -d postgres:15
```

4. **Configure environment:**

```bash
# Copy example environment file
cp .env.example .env

# Generate encryption key
npm run generate:key

# Edit .env and add:
# - BOT_TOKEN (from @BotFather)
# - ENCRYPTION_KEY (from generate:key command)
# - DATABASE_URL (PostgreSQL connection string)
```

5. **Initialize database:**

```bash
# Generate Prisma client
npm run db:generate

# Run migrations
npm run db:migrate

# (Optional) Migrate existing wallet_data.json
npm run migrate
```

6. **Start the bot:**

```bash
npm run dev
```

## Development

Start the bot in development mode:

```bash
npm run dev
```

Start with a specific Solana network:

```bash
SOLANA_NETWORK=devnet npm run dev
```

Build the TypeScript code:

```bash
npm run build
```

Start the production version:

```bash
npm start
```

## Bot Commands

- `/start` - Initialize the bot and show main menu
- `/deposit` - Get deposit address
- `/mint` - Start minting
- `/balance` - Check current balances
- `/convert` - Convert between USDi and USDC
- `/withdraw` - Withdraw funds
- `/backup` - Backup wallet seed phrase
- `/reset` - Reset wallet
- `/help` - Show available commands

### Liquidity Pool Commands

- `/pools` - List supported pools
- `/poolstats <index>` - Show stats for a specific pool
- `/pooldeposit <index> <amount>` - Deposit to a specific pool
- `/positions` - List open positions
- `/closepos <mint>` - Close a specific position

### System Commands

- `/network [network]` - Display current network or request change

## Project Structure

```
src/
├── core/                      # Core trading engine
│   ├── hedgeEngine.ts         # Hedge position management
│   ├── positionManager.ts     # Position CRUD operations
│   └── riskManager.ts         # Risk validation & metrics
├── interfaces/
│   ├── telegram/              # Telegram bot interface
│   │   ├── bot.ts             # Main bot file
│   │   └── commands/          # Command handlers
│   └── cli/                   # CLI interface (future)
├── services/                  # Core services
│   ├── wallet.ts              # Wallet management
│   ├── swap.ts                # Token swaps
│   ├── transfer.ts            # Token transfers
│   ├── orcaLiquidity.ts       # Orca pool interaction
│   ├── connectionManager.ts   # Solana connection management
│   ├── chatHistory.ts         # Chat history tracking
│   └── marketData.ts          # Market data & price feeds
├── strategies/                # Trading strategies (extensible)
│   ├── hedgeStrategy.ts       # Hedge trading strategy
│   └── baseStrategy.ts        # Base strategy class
├── types/                     # TypeScript type definitions
│   └── index.ts               # All type definitions
└── utils/                     # Utilities
    ├── constants.ts           # Network & token constants
    ├── config.ts              # Type-safe configuration
    ├── encryption.ts          # AES-256 encryption
    ├── errorHandler.ts        # Error handling utilities
    ├── validation.ts          # Input validation
    ├── migrate.ts             # Data migration script
    └── prisma.ts              # Prisma client singleton
```

## Available Scripts

```bash
# Development
npm run dev              # Start bot with auto-reload
npm run build            # Compile TypeScript
npm start                # Run production build

# Database
npm run db:generate      # Generate Prisma client
npm run db:migrate       # Run database migrations
npm run db:migrate:deploy # Deploy migrations (production)
npm run db:studio        # Open Prisma Studio (database GUI)
npm run db:reset         # Reset database (⚠️ deletes all data)

# Data Migration
npm run migrate          # Migrate wallet_data.json to database

# Utilities
npm run generate:key     # Generate encryption key
npm run format           # Format code with Prettier
npm run format:check     # Check code formatting
```

## Environment Configuration

The bot supports dynamic configuration through environment variables:

| Variable           | Description                          | Required | Default                                    |
| ------------------ | ------------------------------------ | -------- | ------------------------------------------ |
| `BOT_TOKEN`        | Telegram Bot Token                   | ✅ Yes   | -                                          |
| `DATABASE_URL`     | PostgreSQL connection string         | ✅ Yes   | -                                          |
| `ENCRYPTION_KEY`   | 32-byte hex key for AES-256          | ✅ Yes   | Generate with `npm run generate:key`       |
| `SOLANA_NETWORK`   | Solana network to use                | No       | `mainnet-beta`                             |
| `MAINNET_RPC_URL`  | Custom RPC URL for mainnet           | No       | `https://api.mainnet-beta.solana.com`      |
| `DEVNET_RPC_URL`   | Custom RPC URL for devnet            | No       | `https://api.devnet.solana.com`            |
| `TESTNET_RPC_URL`  | Custom RPC URL for testnet           | No       | `https://api.testnet.solana.com`           |
| `LOCALNET_RPC_URL` | Custom RPC URL for localnet          | No       | `http://localhost:8899`                    |

**Example `.env` file:**

```env
DATABASE_URL="postgresql://postgres:password@localhost:5432/hedge_trading_bot?schema=public"
BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
ENCRYPTION_KEY=a1b2c3d4e5f6...  # 64 character hex string
SOLANA_NETWORK=devnet
```

## Security Notes

- ✅ **AES-256 Encryption**: All private keys and seed phrases encrypted at rest

### Security Best Practices

1. **Store ENCRYPTION_KEY securely**:
   - Use a password manager
   - Keep offline backup
   - Never commit to git (already in .gitignore)

2. **Database Security**:
   - Use strong PostgreSQL password
   - Don't expose database publicly
   - Regular backups recommended

3. **Production Deployment**:
   - Use environment secrets (not .env files)
   - Enable PostgreSQL SSL
   - Use custom RPC endpoints (not public)
   - Monitor for suspicious activity

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Quick Links

- **Start Trading:** `npm run cli -- hedge open SOL 1 --strategy delta-neutral`
- **Monitor Positions:** `npm run cli -- monitor positions`
- **Start Automation:** `npm run cli -- auto start --dry-run`
- **Check Status:** `npm run cli -- auto status`

## Disclaimer

This bot is provided as-is for educational and research purposes. Users are responsible for their own funds and should exercise caution when using DeFi protocols.

**Important:**
- Always test on devnet first
- Start with small amounts
- Use `--dry-run` mode initially
- Never share private keys or seed phrases
- Understand the risks of automated trading

## License

MIT License - See LICENSE file for details

---

__(These documentations are auto generated by ollama. Please run `~/ollama/bot generate docs.md` to regerate the file using folder context)__
