# Setup Guide - Hedge Trading Bot

This guide will walk you through setting up the hedge trading bot from scratch.

## Prerequisites

- Node.js v16 or higher
- npm or yarn
- PostgreSQL 12 or higher (or Docker)
- Telegram Bot Token (from @BotFather)

## Step-by-Step Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up PostgreSQL

#### Option A: Local PostgreSQL Installation

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo -u postgres createdb hedge_trading_bot
```

**macOS:**
```bash
brew install postgresql@15
brew services start postgresql@15
createdb hedge_trading_bot
```

**Windows:**
Download and install from https://www.postgresql.org/download/windows/

#### Option B: Docker (Recommended for Development)

```bash
docker run --name hedge-postgres \
  -e POSTGRES_PASSWORD=yourpassword \
  -e POSTGRES_DB=hedge_trading_bot \
  -p 5432:5432 \
  -d postgres:15

# Verify it's running
docker ps
```

### 3. Generate Encryption Key

Run this script to generate a secure 32-byte encryption key:

```bash
node -e "const crypto = require('crypto'); console.log(crypto.randomBytes(32).toString('hex'));"
```

Copy the output - you'll need it for the next step.

### 4. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and fill in the values:

```env
# Database Configuration
DATABASE_URL="postgresql://postgres:yourpassword@localhost:5432/hedge_trading_bot?schema=public"

# Telegram Bot
BOT_TOKEN=your_bot_token_from_botfather

# Encryption (use the key generated in step 3)
ENCRYPTION_KEY=your_32_byte_hex_key_here

# Network configuration
SOLANA_NETWORK=devnet  # Use devnet for testing

# Optional: Custom RPC endpoints
DEVNET_RPC_URL=https://api.devnet.solana.com
```

### 5. Initialize Database

Generate Prisma client:

```bash
npx prisma generate
```

Run database migrations:

```bash
npx prisma migrate dev --name init
```

You should see output confirming the migration was successful.

### 6. Migrate Existing Data (Optional)

If you have existing wallet data in `wallet_data.json`, migrate it to the database:

```bash
npm run migrate
```

This will:
- ✅ Create a backup of wallet_data.json
- ✅ Encrypt all private keys and seed phrases
- ✅ Import data into PostgreSQL
- ✅ Verify the migration

### 7. Verify Setup

Check your database:

```bash
npx prisma studio
```

This opens a web UI at http://localhost:5555 where you can view your database.

### 8. Start the Bot

Development mode (with auto-reload):

```bash
npm run dev
```

Production mode:

```bash
npm run build
npm start
```

## Troubleshooting

### Database Connection Errors

**Error: "Can't reach database server"**
- Verify PostgreSQL is running: `pg_isready` (or `docker ps` if using Docker)
- Check your DATABASE_URL in .env
- Ensure port 5432 is not blocked by firewall

**Error: "Database does not exist"**
```bash
# Create the database manually
createdb hedge_trading_bot

# Or with psql
psql -U postgres -c "CREATE DATABASE hedge_trading_bot;"
```

### Prisma Errors

**Error: "Prisma Client is not generated"**
```bash
npx prisma generate
```

**Error: "Migration is out of sync"**
```bash
npx prisma migrate reset  # WARNING: This will delete all data!
npx prisma migrate dev
```

### Encryption Errors

**Error: "ENCRYPTION_KEY not found"**
- Make sure you generated a key and added it to .env
- Restart your application after updating .env

**Error: "Decryption failed"**
- This means data was encrypted with a different key
- DO NOT lose your ENCRYPTION_KEY - it cannot be recovered!

### Bot Not Starting

**Error: "Missing BOT_TOKEN"**
1. Create a bot with @BotFather on Telegram
2. Copy the token
3. Add it to your .env file

## Database Management

### View Database Contents
```bash
npx prisma studio
```

### Reset Database (⚠️ DELETES ALL DATA)
```bash
npx prisma migrate reset
```

### Create New Migration
```bash
npx prisma migrate dev --name your_migration_name
```

### Generate Prisma Client (after schema changes)
```bash
npx prisma generate
```

## Development Workflow

1. **Make changes** to code
2. **Update schema** (if needed): Edit `prisma/schema.prisma`
3. **Generate migration**: `npx prisma migrate dev --name change_description`
4. **Generate client**: `npx prisma generate` (usually automatic)
5. **Test changes**: `npm run dev`

## Production Deployment

### Environment Variables

Ensure these are set in production:
- `DATABASE_URL` - Production PostgreSQL connection string
- `ENCRYPTION_KEY` - **CRITICAL**: Same key used for encryption, never change!
- `BOT_TOKEN` - Production bot token
- `NODE_ENV=production`

### Database Migrations

In production, use:
```bash
npx prisma migrate deploy
```

This only runs migrations without prompting for confirmations.

### Security Checklist

- ✅ ENCRYPTION_KEY is secure and backed up
- ✅ DATABASE_URL uses strong password
- ✅ .env is in .gitignore (never commit!)
- ✅ PostgreSQL is not publicly accessible
- ✅ Bot token is secure
- ✅ Backup database regularly

## Backup and Recovery

### Backup Database

```bash
# PostgreSQL backup
pg_dump hedge_trading_bot > backup_$(date +%Y%m%d).sql

# Docker backup
docker exec hedge-postgres pg_dump -U postgres hedge_trading_bot > backup_$(date +%Y%m%d).sql
```

### Restore Database

```bash
# PostgreSQL restore
psql hedge_trading_bot < backup_20251130.sql

# Docker restore
docker exec -i hedge-postgres psql -U postgres hedge_trading_bot < backup_20251130.sql
```

### Backup Encryption Key

**CRITICAL**: Store your ENCRYPTION_KEY securely!
- Use a password manager
- Keep offline backup
- Never commit to git
- If lost, encrypted data is unrecoverable

## Testing

### Run Tests (when implemented)
```bash
npm test
```

### Manual Testing Checklist

- ✅ Bot responds to /start
- ✅ Wallet creation works
- ✅ Balance checking works
- ✅ All existing commands functional
- ✅ Data persists across restarts
- ✅ Migration script works with sample data

## Useful Commands

```bash
# View logs
npm run dev

# Format code
npm run format

# Check code formatting
npm run format:check

# Build TypeScript
npm run build

# Run migration script
npm run migrate

# Interactive database browser
npx prisma studio

# View database schema
npx prisma db pull
```

## Next Steps

After setup is complete:
1. Test all existing Telegram bot commands
2. Verify data migration (if applicable)
3. Review IMPLEMENTATION_SUMMARY.md
4. Proceed to Prompt_2 implementation

## Support

If you encounter issues:
1. Check the Troubleshooting section above
2. Review error messages carefully
3. Verify all environment variables are set
4. Check that PostgreSQL is running
5. Ensure Prisma client is generated

## Monitoring

### Check Bot Status
```bash
# View running processes
ps aux | grep node

# Docker logs (if using Docker)
docker logs hedge-postgres
```

### Check Database Status
```bash
# PostgreSQL
pg_isready

# Docker
docker ps
docker logs hedge-postgres
```

---

__(These documentations are auto generated by ollama. Please run `~/ollama/bot generate docs` to regerate the file using folder context)__
