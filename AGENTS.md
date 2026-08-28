# AGENTS.md

## Build & Test Commands

Run these before finishing any task:

```bash
# Typecheck
npx tsc --noEmit

# Lint (auto-fixes formatting)
npx eslint "src/**/*.ts" --fix

# Tests
npx jest

# Start the dev server
npx nest start
```

## Project Structure

- `src/news/` — Crypto news API (RSS feeds from Coindesk/Cointelegraph, cached in Redis)
- `src/redis/` — Redis service (graceful degradation when Redis unavailable)
- `src/binance/` — Binance API service (klines, OI, funding, liquidations — all cached via Redis)
- `src/liquidation/` — WebSocket liquidation tracker (persists events to Redis, 7-day TTL)
- `src/market/` — Legacy market analysis module
- `src/market-signal/` — New signal detection system (10 rules + Golden Rule)

## Key Files

- `src/market/utils/change.util.ts` — `calculateChange()`: returns 100/-100 when previous=0
- `src/market/signals/build-market-snapshots.ts` — Accepts liquidation data now
- `src/market/mappers/market-snapshot.mapper.ts` — Maps Binance data to MarketSnapshot (uses Redis data via BinanceService)
- `src/market/signals/timeframe-market-analysis.ts` — Converts TimeframeWindow → MarketAnalysis for SignalDetector
- `src/binance/binance.service.ts` — Redis caching: klines (5m), OI (5m), funding rates (7d), liquidations

## Environment

- `REDIS_URL` — defaults to `redis://localhost:6379`
- Set `npm_config_yes=true` or use `--yes` when installing packages
