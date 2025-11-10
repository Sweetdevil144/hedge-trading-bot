# Docker Deployment Guide

Complete guide for deploying the hedge trading bot using Docker.

## Prerequisites

- Docker 20.10+
- Docker Compose 2.0+
- 2GB RAM minimum
- 10GB disk space

## Quick Start

```bash
# Clone repository
git clone <repository-url>
cd hedge-trading-bot

# Copy environment template
cp .env.example .env

# Edit .env with your configuration
nano .env

# Deploy
./deploy.sh
```

## Environment Configuration

Create `.env` file with required variables:

```env
# Database
POSTGRES_USER=hedgebot
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DB=hedgebot

# Solana
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_NETWORK=mainnet-beta

# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token

# Encryption
ENCRYPTION_KEY=your_64_char_hex_key

# OpenAI (optional)
OPENAI_API_KEY=your_openai_key

# Redis
REDIS_PORT=6379
```

### Generate Encryption Key

```bash
npm run generate:key
```

Copy the output to `ENCRYPTION_KEY` in `.env`.

## Architecture

```
┌─────────────────┐
│   Bot Service   │ (Node.js + TypeScript)
│   Port: 3000    │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
┌───▼────┐ ┌─▼────────┐
│Postgres│ │  Redis   │
│Port:5432│ │Port:6379 │
└─────────┘ └──────────┘
```

## Services

### 1. PostgreSQL Database
- **Image:** postgres:16-alpine
- **Port:** 5432
- **Volume:** postgres_data
- **Purpose:** Persistent storage for users, positions, transactions

### 2. Redis Cache
- **Image:** redis:7-alpine
- **Port:** 6379
- **Volume:** redis_data
- **Purpose:** Caching, rate limiting, session management

### 3. Bot Application
- **Image:** Custom (built from Dockerfile)
- **Port:** 3000 (internal)
- **Volumes:**
  - ./logs → /app/logs
  - ./config → /app/config (read-only)
- **Purpose:** Main trading bot application

## Deployment

### Standard Deployment

```bash
# Build images
docker-compose build

# Start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f bot
```

### Using Deployment Script

```bash
# Make script executable
chmod +x deploy.sh

# Run deployment
./deploy.sh
```

The script performs:
1. Builds Docker images
2. Stops existing containers
3. Starts database and redis
4. Runs database migrations
5. Starts bot application
6. Checks service health

## Management

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f bot
docker-compose logs -f postgres
docker-compose logs -f redis

# Last 100 lines
docker-compose logs --tail=100 bot
```

### Service Control

```bash
# Stop all services
docker-compose down

# Stop without removing volumes
docker-compose stop

# Restart specific service
docker-compose restart bot

# Rebuild and restart
docker-compose up -d --build bot
```

### Database Operations

```bash
# Connect to database
docker-compose exec postgres psql -U hedgebot -d hedgebot

# Run migrations
docker-compose exec bot npm run db:migrate:deploy

# Open Prisma Studio
docker-compose exec bot npm run db:studio

# Backup database
docker-compose exec postgres pg_dump -U hedgebot hedgebot > backup.sql

# Restore database
cat backup.sql | docker-compose exec -T postgres psql -U hedgebot hedgebot
```

### Execute Commands in Container

```bash
# Access bot container shell
docker-compose exec bot sh

# Run CLI command
docker-compose exec bot npm run cli -- account balance

# Check bot status
docker-compose exec bot npm run cli -- auto status
```

## Monitoring

### Health Checks

```bash
# Check service health
docker-compose ps

# Verify database connectivity
docker-compose exec postgres pg_isready -U hedgebot

# Verify Redis connectivity
docker-compose exec redis redis-cli ping
```

### Resource Usage

```bash
# View resource usage
docker stats

# View specific container
docker stats hedge-bot
```

### Logs Location

Logs are persisted to `./logs` directory:
- `logs/trading.log` - Trading activities
- `logs/error.log` - Error logs
- `logs/websocket.log` - WebSocket events
- `logs/audit.log` - Sensitive operations

## Troubleshooting

### Container Won't Start

**Check logs:**
```bash
docker-compose logs bot
```

**Common issues:**
- Missing environment variables
- Database connection failed
- Port already in use

**Solutions:**
```bash
# Verify .env file exists and is complete
cat .env

# Check ports
sudo netstat -tlnp | grep -E '(5432|6379|3000)'

# Rebuild from scratch
docker-compose down -v
docker-compose build --no-cache
docker-compose up -d
```

### Database Connection Errors

**Check database status:**
```bash
docker-compose logs postgres
docker-compose exec postgres pg_isready
```

**Verify connection string:**
```bash
# Should be: postgresql://hedgebot:password@postgres:5432/hedgebot
echo $DATABASE_URL
```

**Reset database:**
```bash
docker-compose down -v
docker volume rm hedge-trading-bot_postgres_data
docker-compose up -d postgres
docker-compose exec bot npm run db:migrate:deploy
```

### Out of Memory

**Increase Docker limits:**

Edit `docker-compose.yml`:
```yaml
services:
  bot:
    deploy:
      resources:
        limits:
          memory: 2G
        reservations:
          memory: 1G
```

### Permission Errors

**Fix file permissions:**
```bash
# Make sure logs directory is writable
chmod 777 logs

# Fix ownership
sudo chown -R 1001:1001 logs
```

## Production Deployment

### Security Hardening

1. **Use secrets instead of .env:**
```yaml
services:
  bot:
    secrets:
      - db_password
      - encryption_key
secrets:
  db_password:
    external: true
  encryption_key:
    external: true
```

2. **Enable PostgreSQL SSL:**
```yaml
services:
  postgres:
    command: postgres -c ssl=on -c ssl_cert_file=/etc/ssl/certs/server.crt
    volumes:
      - ./certs:/etc/ssl/certs:ro
```

3. **Use custom networks:**
```yaml
networks:
  backend:
    driver: bridge
    internal: true
  frontend:
    driver: bridge
```

4. **Restrict container capabilities:**
```yaml
services:
  bot:
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
    security_opt:
      - no-new-privileges:true
```

### Scaling

**Horizontal scaling (multiple bot instances):**
```yaml
services:
  bot:
    deploy:
      replicas: 3
      update_config:
        parallelism: 1
        delay: 10s
```

**Load balancing:**
```yaml
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - bot
```

### Monitoring Setup

**Add Prometheus and Grafana:**
```yaml
services:
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml:ro
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
```

## Backup & Recovery

### Automated Backups

Create `backup.sh`:
```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
docker-compose exec postgres pg_dump -U hedgebot hedgebot | gzip > backups/db_$DATE.sql.gz

# Keep last 30 days
find backups/ -name "db_*.sql.gz" -mtime +30 -delete
```

Schedule with cron:
```bash
# Daily backup at 2 AM
0 2 * * * /path/to/backup.sh
```

### Recovery

```bash
# Stop bot
docker-compose stop bot

# Restore database
gunzip -c backups/db_20250101_020000.sql.gz | docker-compose exec -T postgres psql -U hedgebot hedgebot

# Start bot
docker-compose start bot
```

## Updates & Maintenance

### Update Application

```bash
# Pull latest code
git pull

# Rebuild and restart
docker-compose build --no-cache bot
docker-compose up -d bot

# Run migrations
docker-compose exec bot npm run db:migrate:deploy
```

### Database Maintenance

```bash
# Vacuum database
docker-compose exec postgres psql -U hedgebot -d hedgebot -c "VACUUM ANALYZE;"

# Check database size
docker-compose exec postgres psql -U hedgebot -d hedgebot -c "SELECT pg_size_pretty(pg_database_size('hedgebot'));"

# Reindex
docker-compose exec postgres psql -U hedgebot -d hedgebot -c "REINDEX DATABASE hedgebot;"
```

### Clean Up

```bash
# Remove stopped containers
docker-compose down

# Remove unused images
docker image prune -a

# Remove unused volumes (⚠️ deletes data)
docker volume prune

# Full cleanup
docker system prune -a --volumes
```

## CI/CD Integration

### GitHub Actions

Create `.github/workflows/deploy.yml`:
```yaml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to server
        uses: appleboy/ssh-action@master
        with:
          host: ${{ secrets.HOST }}
          username: ${{ secrets.USERNAME }}
          key: ${{ secrets.SSH_KEY }}
          script: |
            cd /app/hedge-trading-bot
            git pull
            ./deploy.sh
```

## Performance Tuning

### PostgreSQL Optimization

Edit `docker-compose.yml`:
```yaml
services:
  postgres:
    command: >
      postgres
      -c shared_buffers=256MB
      -c effective_cache_size=1GB
      -c work_mem=16MB
      -c maintenance_work_mem=128MB
      -c max_connections=100
```

### Redis Optimization

```yaml
services:
  redis:
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
```

## Support

- **Issues:** https://github.com/btunter/hedge-trading-bot/issues
- **Documentation:** See README.md, CLI_REFERENCE.md, STRATEGIES.md
- **Logs:** Check `./logs` directory

---

__(These documentations are auto generated by ollama. Please run `~/ollama/bot generate docs` to regerate the file using folder context)__