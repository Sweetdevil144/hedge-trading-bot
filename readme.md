# Hedge Trading Bot

A Telegram bot for managing Solana wallets and interacting with DeFi protocols. This bot allows users to deposit USDC, mint USDi, and manage their wallets directly through Telegram.

## Features

- 💰 Wallet Creation & Management
- 💎 USDC Deposits & Withdrawals
- 📈 Minting
- 🔄 USDi/USDC Conversions
- 🔒 Secure Backup & Recovery
- 📊 Balance Checking
- 🌀 Liquidity Pools (Orca Whirlpools Integration)
- 🔄 Network Switching (mainnet/devnet/testnet)

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Telegram Bot Token (from [@BotFather](https://t.me/botfather))
- Solana RPC endpoint (optional, defaults to public endpoints)

## Installation

1. Clone the repository:

```bash
git clone https://github.com/btunter/hedge-traing-bot-beta.git
cd hedge-traing-bot-beta
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file in the root directory:

```env
# Required
BOT_TOKEN=your_telegram_bot_token_here

# Network configuration (optional)
SOLANA_NETWORK=mainnet-beta  # Options: mainnet-beta, devnet, testnet, localnet

# Custom RPC endpoints (optional)
MAINNET_RPC_URL=https://your-custom-mainnet-rpc.com
DEVNET_RPC_URL=https://your-custom-devnet-rpc.com
TESTNET_RPC_URL=https://your-custom-testnet-rpc.com
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
- `/positions` - List your open positions
- `/closepos <mint>` - Close a specific position

### System Commands

- `/network [network]` - Display current network or request change

## Project Structure

```
src/
├── commands/        # Command handlers
├── services/        # Core services
│   ├── wallet.ts    # Wallet management
│   ├── orcaLiquidity.ts # Orca pool interaction
│   └── connectionManager.ts # Solana connection management
├── types/           # TypeScript type definitions
└── utils/           # Utilities and constants
```

## Environment Configuration

The bot supports dynamic configuration through environment variables:

| Variable           | Description                 | Default                 |
| ------------------ | --------------------------- | ----------------------- |
| `BOT_TOKEN`        | Telegram Bot Token          | (required)              |
| `SOLANA_NETWORK`   | Solana network to use       | `mainnet-beta`          |
| `MAINNET_RPC_URL`  | Custom RPC URL for mainnet  | Public endpoint         |
| `DEVNET_RPC_URL`   | Custom RPC URL for devnet   | Public endpoint         |
| `TESTNET_RPC_URL`  | Custom RPC URL for testnet  | Public endpoint         |
| `LOCALNET_RPC_URL` | Custom RPC URL for localnet | `http://localhost:8899` |

## Security Notes

- Seed phrases are only shown once during backup
- Private keys are stored encrypted (TODO)
- Never share your seed phrase or private keys
- Always verify transaction details before confirming

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Disclaimer

This bot is provided as-is. Users are responsible for their own funds and should exercise caution when using DeFi protocols.
