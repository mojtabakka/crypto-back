import { Injectable, Logger } from '@nestjs/common';

import axios from 'axios';

import { BinanceKline } from 'src/market/dto/binance-kline.type';

import { BinanceFundingRate } from 'src/market/types/binance-funding-rate.type';
import { BinanceLiquidationOrder } from 'src/market/types/binance-liquidation.type';

import { BinanceOpenInterest } from 'src/market/types/binance-open-interest.type';

import { RedisService } from 'src/redis/redis.service';

// ==========================================
// Service
// ==========================================

@Injectable()
export class BinanceService {
  private readonly logger = new Logger(BinanceService.name);

  // Cache TTLs
  private readonly FUNDING_CACHE_TTL = 7 * 24 * 60 * 60; // 7 days
  private readonly KLINES_CACHE_TTL = 5 * 60; // 5 minutes
  private readonly OI_CACHE_TTL = 5 * 60; // 5 minutes
  private readonly TICKERS_CACHE_TTL = 60; // 1 minute

  // Rate limiting: be conservative to avoid Binance IP bans.
  // 1200 requests per minute keeps us well under the 2400 weight/min limit
  // and leaves headroom for the futures forceOrders / OI endpoints.
  private readonly MAX_REQUESTS_PER_MINUTE = 1200;
  private readonly REQUEST_INTERVAL_MS = 60000 / 1200; // 50ms between requests
  private lastRequestTime = 0;
  private requestQueue: Array<{
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    fn: () => Promise<unknown>;
  }> = [];
  private isProcessingQueue = false;

  constructor(private readonly redisService: RedisService) {}

  private async rateLimit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.requestQueue.push({
        resolve: resolve,
        reject,
        fn,
      });
      void this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.requestQueue.length > 0) {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;

      if (timeSinceLastRequest < this.REQUEST_INTERVAL_MS) {
        await this.sleep(this.REQUEST_INTERVAL_MS - timeSinceLastRequest);
      }

      const item = this.requestQueue.shift();
      if (item) {
        this.lastRequestTime = Date.now();
        try {
          const result = await item.fn();
          item.resolve(result);
        } catch (error) {
          item.reject(error);
        }
      }
    }

    this.isProcessingQueue = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ========================================
  // Binance API URLs
  // ========================================

  private readonly spotBaseUrl = 'https://api.binance.com';

  private readonly futuresBaseUrl = 'https://fapi.binance.com';

  // ==========================================
  // Spot Klines
  // ==========================================

  async getKlines(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
    limit = 1000,
  ): Promise<BinanceKline[]> {
    const allKlines: BinanceKline[] = [];

    let currentStartTime = startTime;

    while (currentStartTime < endTime) {
      const response = await this.rateLimit(() =>
        axios.get<BinanceKline[]>(`${this.spotBaseUrl}/api/v3/klines`, {
          params: {
            symbol,
            interval,
            startTime: currentStartTime,
            endTime,
            limit,
          },
        }),
      );

      const klines = response.data;

      if (klines.length === 0) {
        break;
      }

      allKlines.push(...klines);

      const lastKline = klines[klines.length - 1];

      const lastOpenTime = lastKline[0];

      currentStartTime = lastOpenTime + 1;

      if (klines.length < limit) {
        break;
      }
    }

    return allKlines;
  }

  // ==========================================
  // Futures Klines
  // ==========================================

  async getFuturesKlines(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
    limit = 1000,
  ): Promise<BinanceKline[]> {
    const cacheKey = `klines:${symbol}:${interval}:${startTime}:${endTime}`;

    const cached = await this.redisService.getJson<BinanceKline[]>(cacheKey);

    if (cached && cached.length > 0) {
      return cached;
    }

    const allKlines: BinanceKline[] = [];

    let currentStartTime = startTime;

    while (currentStartTime < endTime) {
      const response = await this.rateLimit(() =>
        axios.get<BinanceKline[]>(`${this.futuresBaseUrl}/fapi/v1/klines`, {
          params: {
            symbol,
            interval,
            startTime: currentStartTime,
            endTime,
            limit,
          },
        }),
      );

      const klines = response.data;

      if (klines.length === 0) {
        break;
      }

      allKlines.push(...klines);

      const lastKline = klines[klines.length - 1];

      const lastOpenTime = lastKline[0];

      currentStartTime = lastOpenTime + 1;

      if (klines.length < limit) {
        break;
      }
    }

    await this.redisService.setJson(cacheKey, allKlines, this.KLINES_CACHE_TTL);

    return allKlines;
  }

  // ==========================================
  // Futures Open Interest
  // ==========================================

  async getOpenInterest(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<BinanceOpenInterest[]> {
    const cacheKey = `oi:${symbol}:${startTime}:${endTime}`;

    const cached =
      await this.redisService.getJson<BinanceOpenInterest[]>(cacheKey);

    if (cached && cached.length > 0) {
      return cached;
    }

    const response = await this.rateLimit(() =>
      axios.get<BinanceOpenInterest[]>(
        `${this.futuresBaseUrl}/futures/data/openInterestHist`,
        {
          params: {
            symbol,
            period: '5m',
            startTime,
            endTime,
            limit: 500,
          },
        },
      ),
    );

    const data = Array.isArray(response.data) ? response.data : [];

    await this.redisService.setJson(cacheKey, data, this.OI_CACHE_TTL);

    return data;
  }

  // ==========================================
  // Futures Funding Rate
  // ==========================================
  //
  // Funding rates update only every 8 hours on Binance.
  // We cache each entry in Redis so that future requests
  // can supplement API responses with historically cached
  // data, preventing gaps where fundingRate = 0.

  async getFundingRate(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<BinanceFundingRate[]> {
    // ========================================
    // 1. Fetch from API
    // ========================================

    const apiData: BinanceFundingRate[] = [];

    try {
      const response = await this.rateLimit(() =>
        axios.get<BinanceFundingRate[]>(
          `${this.futuresBaseUrl}/fapi/v1/fundingRate`,
          {
            params: {
              symbol,
              startTime,
              endTime,
              limit: 1000,
            },
          },
        ),
      );

      if (Array.isArray(response.data)) {
        apiData.push(...response.data);
      }
    } catch (error) {
      this.logger.warn(
        `Funding rate API call failed for ${symbol}; relying on cache`,
        error,
      );
    }

    // ========================================
    // 2. Cache new entries in Redis
    // ========================================

    for (const rate of apiData) {
      const cacheKey = `funding:${symbol}:${rate.fundingTime}`;
      await this.redisService.setJson(cacheKey, rate, this.FUNDING_CACHE_TTL);
    }

    // ========================================
    // 3. Supplement with cached data from Redis
    // ========================================

    const redisData: BinanceFundingRate[] = [];

    const step = 8 * 60 * 60 * 1000; // 8h funding interval

    for (let t = startTime; t <= endTime; t += step) {
      const cacheKey = `funding:${symbol}:${t}`;

      const cached =
        await this.redisService.getJson<BinanceFundingRate>(cacheKey);

      if (cached) {
        redisData.push(cached);
      }
    }

    // ========================================
    // 4. Merge (deduplicate by fundingTime)
    // ========================================

    const merged = new Map<number, BinanceFundingRate>();

    for (const item of apiData) {
      merged.set(item.fundingTime, item);
    }

    for (const item of redisData) {
      if (!merged.has(item.fundingTime)) {
        merged.set(item.fundingTime, item);
      }
    }

    return Array.from(merged.values()).sort(
      (a, b) => a.fundingTime - b.fundingTime,
    );
  }

  // ==========================================
  // Futures Liquidation Orders
  // ==========================================

  async getLiquidationOrders(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<BinanceLiquidationOrder[]> {
    try {
      const response = await this.rateLimit(() =>
        axios.get<BinanceLiquidationOrder[]>(
          `${this.futuresBaseUrl}/fapi/v1/allForceOrders`,
          {
            params: {
              symbol,
              startTime,
              endTime,
              limit: 1000,
            },
          },
        ),
      );

      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      if (
        axios.isAxiosError(error) &&
        (error.response?.status === 400 || error.response?.status === 404)
      ) {
        this.logger.warn(
          'Binance liquidation endpoint unavailable for this range; falling back to WebSocket data.',
        );

        return [];
      }

      throw error;
    }
  }

  async getTickers(): Promise<
    Array<{ symbol: string; volume: string; lastPrice: string }>
  > {
    const cacheKey = 'binance:tickers:futures';

    const cached =
      await this.redisService.getJson<
        Array<{ symbol: string; volume: string; lastPrice: string }>
      >(cacheKey);
    if (cached && cached.length > 0) {
      return cached;
    }

    try {
      const response = await axios.get<
        Array<{ symbol: string; volume: string; lastPrice: string }>
      >(`${this.futuresBaseUrl}/fapi/v1/ticker/24hr`, {
        timeout: 15000,
      });

      const data = response.data ?? [];
      await this.redisService.setJson(cacheKey, data, this.TICKERS_CACHE_TTL);
      return data;
    } catch (error) {
      this.logger.warn(`Binance tickers fetch failed: ${error}`);
      return [];
    }
  }
}
