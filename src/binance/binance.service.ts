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

  constructor(private readonly redisService: RedisService) {}

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
      const response = await axios.get<BinanceKline[]>(
        `${this.spotBaseUrl}/api/v3/klines`,
        {
          params: {
            symbol,
            interval,
            startTime: currentStartTime,
            endTime,
            limit,
          },
        },
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
      const response = await axios.get<BinanceKline[]>(
        `${this.futuresBaseUrl}/fapi/v1/klines`,
        {
          params: {
            symbol,
            interval,
            startTime: currentStartTime,
            endTime,
            limit,
          },
        },
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

    const response = await axios.get<BinanceOpenInterest[]>(
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
      const response = await axios.get<BinanceFundingRate[]>(
        `${this.futuresBaseUrl}/fapi/v1/fundingRate`,
        {
          params: {
            symbol,
            startTime,
            endTime,
            limit: 1000,
          },
        },
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
      const response = await axios.get<BinanceLiquidationOrder[]>(
        `${this.futuresBaseUrl}/fapi/v1/allForceOrders`,
        {
          params: {
            symbol,
            startTime,
            endTime,
            limit: 1000,
          },
        },
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
}
