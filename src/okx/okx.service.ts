import { Injectable, Logger } from '@nestjs/common';

import axios from 'axios';

import { BinanceKline } from 'src/market/dto/binance-kline.type';

import { BinanceFundingRate } from 'src/market/types/binance-funding-rate.type';
import { BinanceLiquidationOrder } from 'src/market/types/binance-liquidation.type';

import { BinanceOpenInterest } from 'src/market/types/binance-open-interest.type';

import { RedisService } from 'src/redis/redis.service';

@Injectable()
export class OkxService {
  private readonly logger = new Logger(OkxService.name);

  private readonly FUNDING_CACHE_TTL = 7 * 24 * 60 * 60;
  private readonly KLINES_CACHE_TTL = 5 * 60;
  private readonly OI_CACHE_TTL = 5 * 60;

  private readonly baseUrl = 'https://www.okx.com';

  constructor(private readonly redisService: RedisService) {}

  async getKlines(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
    limit = 100,
  ): Promise<BinanceKline[]> {
    return this.getFuturesKlines(symbol, interval, startTime, endTime, limit);
  }

  async getFuturesKlines(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
    limit = 100,
  ): Promise<BinanceKline[]> {
    const cacheKey = `okx:klines:${symbol}:${interval}:${startTime}:${endTime}`;

    const cached = await this.redisService.getJson<BinanceKline[]>(cacheKey);
    if (cached && cached.length > 0) {
      return cached;
    }

    const allKlines: BinanceKline[] = [];
    let currentStartTime = startTime;

    const okxInterval = this.mapInterval(interval);
    const instId = symbol.replace('USDT', '-USDT-SWAP');

    while (currentStartTime < endTime) {
      try {
        const response = await axios.get(
          `${this.baseUrl}/api/v5/market/candles`,
          {
            params: {
              instId,
              bar: okxInterval,
              after: currentStartTime,
              before: endTime,
              limit,
            },
            headers: {
              'User-Agent': 'Mozilla/5.0',
            },
          },
        );

        const data = response.data?.data;
        if (!data || data.length === 0) break;

        for (const item of data) {
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

        const lastTimestamp = Number(data[data.length - 1][0]);
        currentStartTime = lastTimestamp + 1;

        if (data.length < limit) break;
      } catch (error) {
        this.logger.warn(`OKX klines fetch failed for ${symbol}: ${error}`);
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
    const cacheKey = `okx:oi:${symbol}:${startTime}:${endTime}`;

    const cached =
      await this.redisService.getJson<BinanceOpenInterest[]>(cacheKey);
    if (cached && cached.length > 0) {
      return cached;
    }

    const allData: BinanceOpenInterest[] = [];
    const instId = symbol.replace('USDT', '-USDT-SWAP');

    try {
      const response = await axios.get(
        `${this.baseUrl}/api/v5/public/open-interest`,
        {
          params: {
            instType: 'SWAP',
            instId,
          },
          headers: {
            'User-Agent': 'Mozilla/5.0',
          },
        },
      );

      const data = response.data?.data;
      if (data) {
        for (const item of data) {
          allData.push({
            symbol,
            sumOpenInterest: item.oi,
            sumOpenInterestValue: item.oiCcy,
            timestamp: Number(item.ts),
          });
        }
      }
    } catch (error) {
      this.logger.warn(`OKX open interest fetch failed for ${symbol}: ${error}`);
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
    const instId = symbol.replace('USDT', '-USDT-SWAP');

    try {
      const response = await axios.get(
        `${this.baseUrl}/api/v5/public/funding-rate`,
        {
          params: {
            instType: 'SWAP',
            instId,
          },
          headers: {
            'User-Agent': 'Mozilla/5.0',
          },
        },
      );

      const data = response.data?.data;
      if (data) {
        for (const item of data) {
          const fundingRate: BinanceFundingRate = {
            symbol,
            fundingRate: item.fundingRate,
            fundingTime: Number(item.fundingTime),
          };
          apiData.push(fundingRate);

          const cacheKey = `okx:funding:${symbol}:${item.fundingTime}`;
          await this.redisService.setJson(cacheKey, fundingRate, this.FUNDING_CACHE_TTL);
        }
      }
    } catch (error) {
      this.logger.warn(`OKX funding rate fetch failed for ${symbol}: ${error}`);
    }

    const redisData: BinanceFundingRate[] = [];
    const step = 8 * 60 * 60 * 1000;

    for (let t = startTime; t <= endTime; t += step) {
      const cacheKey = `okx:funding:${symbol}:${t}`;
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
      const instId = symbol.replace('USDT', '-USDT-SWAP');

      const response = await axios.get(
        `${this.baseUrl}/api/v5/public/liquidation-orders`,
        {
          params: {
            instType: 'SWAP',
            instId,
            startTime,
            endTime,
            limit: '100',
          },
          headers: {
            'User-Agent': 'Mozilla/5.0',
          },
        },
      );

      const data = response.data?.data;
      if (!data || data.length === 0) return [];

      const orders: BinanceLiquidationOrder[] = [];
      for (const item of data) {
        const details = item.details;
        if (details && details.length > 0) {
          for (const detail of details) {
            orders.push({
              symbol,
              side: detail.side === 'buy' ? 'BUY' : 'SELL',
              price: detail.bkPx,
              origQty: detail.sz,
              executedQty: detail.sz,
              averagePrice: detail.bkPx,
              status: 'FILLED',
              timeInForce: 'GTC',
              type: 'MARKET',
              clientOrderId: `okx-${detail.ts}`,
              lastUpdateTime: Number(detail.ts),
            });
          }
        }
      }

      return orders;
    } catch (error) {
      this.logger.debug(`OKX liquidation fetch failed for ${symbol}: ${error}`);
      return [];
    }
  }

  private mapInterval(interval: string): string {
    const map: Record<string, string> = {
      '5m': '5m',
      '15m': '15m',
      '30m': '30m',
      '1h': '1H',
      '4h': '4H',
      '1d': '1D',
      '1w': '1W',
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
