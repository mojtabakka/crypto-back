import { Injectable, Logger } from '@nestjs/common';

import axios from 'axios';

import { BinanceKline } from 'src/market/dto/binance-kline.type';

import { BinanceFundingRate } from 'src/market/types/binance-funding-rate.type';
import { BinanceLiquidationOrder } from 'src/market/types/binance-liquidation.type';

import { BinanceOpenInterest } from 'src/market/types/binance-open-interest.type';

import { RedisService } from 'src/redis/redis.service';

@Injectable()
export class BybitService {
  private readonly logger = new Logger(BybitService.name);

  private readonly FUNDING_CACHE_TTL = 7 * 24 * 60 * 60;
  private readonly KLINES_CACHE_TTL = 5 * 60;
  private readonly OI_CACHE_TTL = 5 * 60;

  private readonly baseUrl = 'https://api.bybit.com';

  constructor(private readonly redisService: RedisService) {}

  async getKlines(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
    limit = 1000,
  ): Promise<BinanceKline[]> {
    return this.getFuturesKlines(symbol, interval, startTime, endTime, limit);
  }

  async getFuturesKlines(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
    limit = 1000,
  ): Promise<BinanceKline[]> {
    const cacheKey = `bybit:klines:${symbol}:${interval}:${startTime}:${endTime}`;

    const cached = await this.redisService.getJson<BinanceKline[]>(cacheKey);
    if (cached && cached.length > 0) {
      return cached;
    }

    const allKlines: BinanceKline[] = [];
    let currentStartTime = startTime;

    const bybitInterval = this.mapInterval(interval);

    while (currentStartTime < endTime) {
      try {
        const response = await axios.get(
          `${this.baseUrl}/v5/market/kline`,
          {
            params: {
              category: 'linear',
              symbol,
              interval: bybitInterval,
              start: currentStartTime,
              end: endTime,
              limit,
            },
            headers: {
              'User-Agent': 'Mozilla/5.0',
            },
          },
        );

        const result = response.data?.result?.list;
        if (!result || result.length === 0) break;

        for (const item of result) {
          allKlines.push([
            Number(item[0]),
            item[1],
            item[2],
            item[3],
            item[4],
            item[5],
            Number(item[0]) + this.getIntervalMs(interval),
            item[6],
            0,
            item[7],
            item[8],
            '0',
          ]);
        }

        const lastTimestamp = Number(result[result.length - 1][0]);
        currentStartTime = lastTimestamp + 1;

        if (result.length < limit) break;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 403) {
          this.logger.warn(`Bybit klines: symbol ${symbol} not available (403)`);
        } else {
          this.logger.warn(`Bybit klines fetch failed for ${symbol}: ${error}`);
        }
        break;
      }
    }

    await this.redisService.setJson(cacheKey, allKlines, this.KLINES_CACHE_TTL);
    return allKlines;
  }

  async getOpenInterest(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<BinanceOpenInterest[]> {
    const cacheKey = `bybit:oi:${symbol}:${startTime}:${endTime}`;

    const cached =
      await this.redisService.getJson<BinanceOpenInterest[]>(cacheKey);
    if (cached && cached.length > 0) {
      return cached;
    }

    const allData: BinanceOpenInterest[] = [];
    let cursor: string | undefined;

    try {
      do {
        const params: Record<string, string | number> = {
          category: 'linear',
          symbol,
          intervalTime: '5min',
          startTime,
          endTime,
          limit: '200',
        };
        if (cursor) params.cursor = cursor;

        const response = await axios.get(
          `${this.baseUrl}/v5/market/open-interest`,
          {
            params,
            headers: {
              'User-Agent': 'Mozilla/5.0',
            },
          },
        );

        const result = response.data?.result;
        if (!result?.list) break;

        for (const item of result.list) {
          allData.push({
            symbol,
            sumOpenInterest: item.openInterest,
            sumOpenInterestValue: '0',
            timestamp: item.time,
          });
        }

        cursor = result.nextPageToken;
      } while (cursor);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        this.logger.warn(`Bybit OI: symbol ${symbol} not available (403)`);
      } else {
        this.logger.warn(`Bybit open interest fetch failed for ${symbol}: ${error}`);
      }
    }

    await this.redisService.setJson(cacheKey, allData, this.OI_CACHE_TTL);
    return allData;
  }

  async getFundingRate(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<BinanceFundingRate[]> {
    const apiData: BinanceFundingRate[] = [];
    let cursor: string | undefined;

    try {
      do {
        const params: Record<string, string | number> = {
          category: 'linear',
          symbol,
          startTime,
          endTime,
          limit: '200',
        };
        if (cursor) params.cursor = cursor;

        const response = await axios.get(
          `${this.baseUrl}/v5/market/funding/history`,
          {
            params,
            headers: {
              'User-Agent': 'Mozilla/5.0',
            },
          },
        );

        const result = response.data?.result;
        if (!result?.list) break;

        for (const item of result.list) {
          const fundingRate: BinanceFundingRate = {
            symbol,
            fundingRate: item.fundingRate,
            fundingTime: Number(item.fundingRateTimestamp),
          };
          apiData.push(fundingRate);

          const cacheKey = `bybit:funding:${symbol}:${item.fundingRateTimestamp}`;
          await this.redisService.setJson(cacheKey, fundingRate, this.FUNDING_CACHE_TTL);
        }

        cursor = result.nextPageToken;
      } while (cursor);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        this.logger.warn(`Bybit funding: symbol ${symbol} not available (403)`);
      } else {
        this.logger.warn(`Bybit funding rate fetch failed for ${symbol}: ${error}`);
      }
    }

    const redisData: BinanceFundingRate[] = [];
    const step = 8 * 60 * 60 * 1000;

    for (let t = startTime; t <= endTime; t += step) {
      const cacheKey = `bybit:funding:${symbol}:${t}`;
      const cached =
        await this.redisService.getJson<BinanceFundingRate>(cacheKey);
      if (cached) {
        redisData.push(cached);
      }
    }

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

  async getLiquidationOrders(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<BinanceLiquidationOrder[]> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/v5/market/liquidation-order`,
        {
          params: {
            category: 'linear',
            symbol,
            startTime,
            endTime,
            limit: '100',
          },
          headers: {
            'User-Agent': 'Mozilla/5.0',
          },
        },
      );

      const result = response.data?.result?.list;
      if (!result) return [];

      return result.map((item: Record<string, string>) => ({
        symbol: item.symbol,
        side: item.side === 'Buy' ? 'BUY' : 'SELL',
        price: item.price,
        origQty: item.size,
        executedQty: item.size,
        averagePrice: item.price,
        status: 'FILLED',
        timeInForce: 'GTC',
        type: 'MARKET',
        clientOrderId: `bybit-${item.time}`,
        lastUpdateTime: Number(item.time),
      }));
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 403) {
          this.logger.warn(`Bybit liquidation: symbol ${symbol} not available (403)`);
        } else if (error.response?.status === 404) {
          this.logger.debug(`Bybit liquidation: no data for ${symbol} (404)`);
        } else {
          this.logger.warn(`Bybit liquidation fetch failed for ${symbol}: ${error}`);
        }
      } else {
        this.logger.warn(`Bybit liquidation fetch failed for ${symbol}: ${error}`);
      }
      return [];
    }
  }

  private mapInterval(interval: string): string {
    const map: Record<string, string> = {
      '5m': '5',
      '15m': '15',
      '30m': '30',
      '1h': '60',
      '4h': '240',
      '1d': 'D',
      '1w': 'W',
    };
    return map[interval] || interval;
  }

  private getIntervalMs(interval: string): number {
    const map: Record<string, number> = {
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '1w': 7 * 24 * 60 * 60 * 1000,
    };
    return map[interval] || 60 * 60 * 1000;
  }
}
