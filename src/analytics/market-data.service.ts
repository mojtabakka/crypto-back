import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { CircuitBreakerService } from 'src/circuit-breaker/circuit-breaker.service';

export interface FuturesTicker {
  symbol: string;
  lastPrice: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  priceChangePercent: number;
  quoteVolume: number;
  volume: number;
  trades: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  trades: number;
  takerBuyBase: number;
  takerBuyQuote: number;
}

interface CacheEntry<T> {
  at: number;
  data: T;
}

const FAPI = 'https://fapi.binance.com';

/**
 * Thin, cached Binance USDⓈ-M futures reader.
 *
 * Every new scanner shares this service so a full-market sweep costs a handful
 * of upstream calls instead of one per feature. It also reports 418/429
 * responses to the circuit breaker instead of hammering a banned endpoint.
 */
@Injectable()
export class MarketDataService {
  private readonly logger = new Logger(MarketDataService.name);

  private tickerCache?: CacheEntry<FuturesTicker[]>;
  private fundingCache?: CacheEntry<Map<string, number>>;
  private readonly candleCache = new Map<string, CacheEntry<Candle[]>>();

  private readonly TICKER_TTL = 30_000;
  private readonly FUNDING_TTL = 60_000;
  private readonly CANDLE_TTL = 60_000;

  /** Max simultaneous Binance requests from scanners. */
  private readonly MAX_CONCURRENCY = 6;

  constructor(private readonly breaker: CircuitBreakerService) {}

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  private async get<T>(url: string, params: Record<string, unknown>): Promise<T> {
    if (this.breaker.isBlocked('BINANCE')) {
      throw new ServiceUnavailableException(
        'Binance is unreachable or rate limited — try again after the circuit breaker resets.',
      );
    }

    try {
      const response = await axios.get<T>(`${FAPI}${url}`, {
        params,
        timeout: 10_000,
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 418 || status === 429) {
          const retryAfter = Number(error.response?.headers?.['retry-after']);
          this.breaker.registerBlock(
            'BINANCE',
            Number.isFinite(retryAfter) ? retryAfter : undefined,
          );
          throw new ServiceUnavailableException(
            'Binance rate limited this IP. Wait for the circuit breaker to reset.',
          );
        }

        // No HTTP response at all means DNS/TCP/timeout: the upstream is
        // unreachable. Open a short breaker so a scanner sweep fails fast
        // instead of paying the 10s timeout once per symbol.
        if (!error.response) {
          this.breaker.registerBlock('BINANCE', 60);
        }
      }
      throw error;
    }
  }

  /** Run `fn` over `items` with bounded concurrency. Never rejects. */
  async mapLimit<T, R>(
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<R>,
  ): Promise<Array<R | null>> {
    const results: Array<R | null> = new Array(items.length).fill(null);
    let cursor = 0;

    const size = Math.max(1, Math.min(limit, this.MAX_CONCURRENCY));

    const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= items.length) return;

        try {
          results[index] = await fn(items[index], index);
        } catch {
          results[index] = null;
        }
      }
    });

    await Promise.all(workers);
    return results;
  }

  // ------------------------------------------------------------------
  // Tickers (one request for the whole market)
  // ------------------------------------------------------------------

  async getTickers(force = false): Promise<FuturesTicker[]> {
    if (
      !force &&
      this.tickerCache &&
      Date.now() - this.tickerCache.at < this.TICKER_TTL
    ) {
      return this.tickerCache.data;
    }

    const raw = await this.get<
      Array<{
        symbol: string;
        lastPrice: string;
        openPrice: string;
        highPrice: string;
        lowPrice: string;
        priceChangePercent: string;
        quoteVolume: string;
        volume: string;
        count: number;
      }>
    >('/fapi/v1/ticker/24hr', {});

    const data: FuturesTicker[] = raw
      .filter((row) => row.symbol.endsWith('USDT'))
      .map((row) => ({
        symbol: row.symbol,
        lastPrice: Number(row.lastPrice),
        openPrice: Number(row.openPrice),
        highPrice: Number(row.highPrice),
        lowPrice: Number(row.lowPrice),
        priceChangePercent: Number(row.priceChangePercent),
        quoteVolume: Number(row.quoteVolume),
        volume: Number(row.volume),
        trades: row.count,
      }))
      .filter((row) => Number.isFinite(row.lastPrice) && row.lastPrice > 0);

    this.tickerCache = { at: Date.now(), data };
    return data;
  }

  /**
   * Trading USDT symbols ranked by 24h quote volume. `limit` keeps a full
   * scanner sweep bounded (defaults to 200 symbols, ~1.5k weight).
   */
  async getSymbols(limit = 200, minQuoteVolume = 1_000_000): Promise<string[]> {
    const tickers = await this.getTickers();
    return tickers
      .filter((t) => t.quoteVolume >= minQuoteVolume)
      .sort((a, b) => b.quoteVolume - a.quoteVolume)
      .slice(0, limit)
      .map((t) => t.symbol);
  }

  async getTickerMap(force = false): Promise<Map<string, FuturesTicker>> {
    const tickers = await this.getTickers(force);
    return new Map(tickers.map((t) => [t.symbol, t]));
  }

  // ------------------------------------------------------------------
  // Klines
  // ------------------------------------------------------------------

  async getCandles(
    symbol: string,
    interval = '1h',
    limit = 100,
  ): Promise<Candle[]> {
    const key = `${symbol}:${interval}:${limit}`;
    const cached = this.candleCache.get(key);

    if (cached && Date.now() - cached.at < this.CANDLE_TTL) {
      return cached.data;
    }

    const raw = await this.get<unknown[][]>('/fapi/v1/klines', {
      symbol,
      interval,
      limit,
    });

    const data: Candle[] = raw.map((k) => ({
      time: Number(k[0]),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      quoteVolume: Number(k[7]),
      trades: Number(k[8]),
      takerBuyBase: Number(k[9]),
      takerBuyQuote: Number(k[10]),
    }));

    this.candleCache.set(key, { at: Date.now(), data });

    // Bound memory: keep the cache under ~600 symbols.
    if (this.candleCache.size > 600) {
      const oldest = [...this.candleCache.entries()].sort(
        (a, b) => a[1].at - b[1].at,
      )[0];
      if (oldest) this.candleCache.delete(oldest[0]);
    }

    return data;
  }

  // ------------------------------------------------------------------
  // Funding (one request for the whole market)
  // ------------------------------------------------------------------

  async getFundingMap(force = false): Promise<Map<string, number>> {
    if (
      !force &&
      this.fundingCache &&
      Date.now() - this.fundingCache.at < this.FUNDING_TTL
    ) {
      return this.fundingCache.data;
    }

    const raw = await this.get<Array<{ symbol: string; lastFundingRate: string }>>(
      '/fapi/v1/premiumIndex',
      {},
    );

    const data = new Map<string, number>();
    for (const row of raw) {
      data.set(row.symbol, Number(row.lastFundingRate));
    }

    this.fundingCache = { at: Date.now(), data };
    return data;
  }

  // ------------------------------------------------------------------
  // Open interest history (per symbol)
  // ------------------------------------------------------------------

  async getOpenInterestChange(
    symbol: string,
    period = '1h',
    points = 25,
  ): Promise<number | null> {
    try {
      const raw = await this.get<Array<{ sumOpenInterestValue: string }>>(
        '/futures/data/openInterestHist',
        { symbol, period, limit: points },
      );

      if (!Array.isArray(raw) || raw.length < 2) return null;

      const first = Number(raw[0].sumOpenInterestValue);
      const last = Number(raw[raw.length - 1].sumOpenInterestValue);

      if (!Number.isFinite(first) || first === 0) return null;
      return ((last - first) / first) * 100;
    } catch {
      return null;
    }
  }
}
