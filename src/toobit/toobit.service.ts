import { Injectable, Logger } from '@nestjs/common';

import axios from 'axios';

import { BinanceKline } from 'src/market/dto/binance-kline.type';

import { BinanceFundingRate } from 'src/market/types/binance-funding-rate.type';
import { BinanceLiquidationOrder } from 'src/market/types/binance-liquidation.type';

import { BinanceOpenInterest } from 'src/market/types/binance-open-interest.type';

import { RedisService } from 'src/redis/redis.service';

@Injectable()
export class ToobitService {
  private readonly logger = new Logger(ToobitService.name);

  private readonly FUNDING_CACHE_TTL = 7 * 24 * 60 * 60;
  private readonly KLINES_CACHE_TTL = 5 * 60;
  private readonly OI_CACHE_TTL = 5 * 60;
  private readonly TICKERS_CACHE_TTL = 60;

  private readonly baseUrl = 'https://api.toobit.com';

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
    const cacheKey = `toobit:klines:${symbol}:${interval}:${startTime}:${endTime}`;

    const cached = await this.redisService.getJson<BinanceKline[]>(cacheKey);
    if (cached && cached.length > 0) {
      return cached;
    }

    const allKlines: BinanceKline[] = [];
    let currentStartTime = startTime;

    const toobitInterval = this.mapInterval(interval);
    const toobitSymbol = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;

    while (currentStartTime < endTime) {
      try {
        const response = await axios.get(
          `${this.baseUrl}/api/v1/market/kline`,
          {
            params: {
              symbol: toobitSymbol,
              interval: toobitInterval,
              startTime: currentStartTime,
              endTime,
              limit,
            },
            headers: {
              'User-Agent': 'Mozilla/5.0',
            },
          },
        );

        const data = response.data?.data ?? response.data?.result?.list;
        if (!data || data.length === 0) break;

        for (const item of data) {
          allKlines.push([
            Number(item[0] ?? item[1]),
            item[1] ?? item[2],
            item[2] ?? item[3],
            item[3] ?? item[4],
            item[4] ?? item[5],
            item[5] ?? item[6],
            Number(item[0] ?? item[1]) + this.getIntervalMs(interval),
            item[6] ?? item[7],
            0,
            item[7] ?? item[8],
            item[8] ?? item[9],
            '0',
          ]);
        }

        const lastTimestamp =
          Number(data[data.length - 1][0] ?? data[data.length - 1][1]);
        currentStartTime = lastTimestamp + 1;

        if (data.length < limit) break;
      } catch (error) {
        if (axios.isAxiosError(error)) {
          if (error.response?.status === 403) {
            this.logger.warn(
              `Toobit klines: symbol ${symbol} not available (403)`,
            );
          } else if (error.response?.status === 404) {
            this.logger.debug(
              `Toobit klines: no data for ${symbol} (404)`,
            );
          } else {
            this.logger.warn(
              `Toobit klines fetch failed for ${symbol}: ${error}`,
            );
          }
        } else {
          this.logger.warn(
            `Toobit klines fetch failed for ${symbol}: ${error}`,
          );
        }
        break;
      }
    }

    await this.redisService.setJson(cacheKey, allKlines, this.KLINES_CACHE_TTL);
    return allKlines;
  }

  async getTickers(): Promise<Array<{ symbol: string; lastPrice: string; volume24h: string }>> {
    const cacheKey = 'toobit:tickers:futures';

    const cached =
      await this.redisService.getJson<
        Array<{ symbol: string; lastPrice: string; volume24h: string }>
      >(cacheKey);
    if (cached && cached.length > 0) {
      return cached;
    }

    try {
      const response = await axios.get(`${this.baseUrl}/api/v1/market/tickers`, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
        },
      });

      const result = response.data?.data ?? response.data?.result;
      if (!result) return [];

      await this.redisService.setJson(cacheKey, result, this.TICKERS_CACHE_TTL);
      return result;
    } catch (error) {
      this.logger.warn(`Toobit tickers fetch failed: ${error}`);
      return [];
    }
  }

  async getOpenInterest(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<BinanceOpenInterest[]> {
    const cacheKey = `toobit:oi:${symbol}:${startTime}:${endTime}`;

    const cached =
      await this.redisService.getJson<BinanceOpenInterest[]>(cacheKey);
    if (cached && cached.length > 0) {
      return cached;
    }

    const allData: BinanceOpenInterest[] = [];

    try {
      const response = await axios.get(
        `${this.baseUrl}/api/v1/market/open-interest`,
        {
          params: {
            symbol: symbol.endsWith('USDT') ? symbol : `${symbol}USDT`,
            startTime,
            endTime,
          },
          headers: {
            'User-Agent': 'Mozilla/5.0',
          },
        },
      );

      const result = response.data?.data ?? response.data?.result;
      if (!result) {
        await this.redisService.setJson(cacheKey, allData, this.OI_CACHE_TTL);
        return allData;
      }

      const items = Array.isArray(result) ? result : result.list ?? [];
      for (const item of items) {
        allData.push({
          symbol,
          sumOpenInterest: item.openInterest ?? item.sumOpenInterest ?? '0',
          sumOpenInterestValue:
            item.sumOpenInterestValue ??
            item.openInterestValue ??
            '0',
          timestamp: Number(item.timestamp ?? item.time ?? Date.now()),
        });
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 403) {
          this.logger.warn(`Toobit OI: symbol ${symbol} not available (403)`);
        } else if (error.response?.status === 404) {
          this.logger.debug(`Toobit OI: no data for ${symbol} (404)`);
        } else {
          this.logger.warn(
            `Toobit open interest fetch failed for ${symbol}: ${error}`,
          );
        }
      } else {
        this.logger.warn(
          `Toobit open interest fetch failed for ${symbol}: ${error}`,
        );
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

    try {
      const response = await axios.get(
        `${this.baseUrl}/api/v1/market/funding-rate`,
        {
          params: {
            symbol: symbol.endsWith('USDT') ? symbol : `${symbol}USDT`,
            startTime,
            endTime,
          },
          headers: {
            'User-Agent': 'Mozilla/5.0',
          },
        },
      );

      const result = response.data?.data ?? response.data?.result;
      if (result) {
        const items = Array.isArray(result) ? result : result.list ?? [];
        for (const item of items) {
          const fundingRate: BinanceFundingRate = {
            symbol,
            fundingRate: item.fundingRate ?? item.rate ?? '0',
            fundingTime: Number(
              item.fundingTime ?? item.fundingRateTimestamp ?? item.time,
            ),
          };
          apiData.push(fundingRate);

          const cacheKey = `toobit:funding:${symbol}:${fundingRate.fundingTime}`;
          await this.redisService.setJson(
            cacheKey,
            fundingRate,
            this.FUNDING_CACHE_TTL,
          );
        }
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 403) {
          this.logger.warn(
            `Toobit funding: symbol ${symbol} not available (403)`,
          );
        } else {
          this.logger.warn(
            `Toobit funding rate fetch failed for ${symbol}: ${error}`,
          );
        }
      } else {
        this.logger.warn(
          `Toobit funding rate fetch failed for ${symbol}: ${error}`,
        );
      }
    }

    const redisData: BinanceFundingRate[] = [];
    const step = 8 * 60 * 60 * 1000;

    for (let t = startTime; t <= endTime; t += step) {
      const cacheKey = `toobit:funding:${symbol}:${t}`;
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
        `${this.baseUrl}/api/v1/market/liquidation-orders`,
        {
          params: {
            symbol: symbol.endsWith('USDT') ? symbol : `${symbol}USDT`,
            startTime,
            endTime,
            limit: 100,
          },
          headers: {
            'User-Agent': 'Mozilla/5.0',
          },
        },
      );

      const result = response.data?.data ?? response.data?.result;
      if (!result) return [];

      const items = Array.isArray(result) ? result : result.list ?? [];
      return items.map((item: Record<string, string>) => ({
        symbol,
        side: item.side?.toUpperCase() === 'BUY' ? 'BUY' : 'SELL',
        price: item.price,
        origQty: item.origQty ?? item.size ?? item.quantity,
        executedQty: item.executedQty ?? item.size ?? item.quantity,
        averagePrice: item.averagePrice ?? item.price,
        status: item.status ?? 'FILLED',
        timeInForce: item.timeInForce ?? 'GTC',
        type: item.type ?? 'MARKET',
        clientOrderId: `toobit-${item.time ?? item.clientOrderId ?? Date.now()}`,
        lastUpdateTime: Number(item.time ?? item.lastUpdateTime ?? Date.now()),
      }));
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 403) {
          this.logger.warn(
            `Toobit liquidation: symbol ${symbol} not available (403)`,
          );
        } else if (error.response?.status === 404) {
          this.logger.debug(
            `Toobit liquidation: no data for ${symbol} (404)`,
          );
        } else {
          this.logger.warn(
            `Toobit liquidation fetch failed for ${symbol}: ${error}`,
          );
        }
      } else {
        this.logger.warn(
          `Toobit liquidation fetch failed for ${symbol}: ${error}`,
        );
      }
      return [];
    }
  }

  private mapInterval(interval: string): string {
    const map: Record<string, string> = {
      '1m': '1m',
      '3m': '3m',
      '5m': '5m',
      '15m': '15m',
      '30m': '30m',
      '1h': '1h',
      '2h': '2h',
      '4h': '4h',
      '6h': '6h',
      '8h': '8h',
      '12h': '12h',
      '1d': '1d',
      '3d': '3d',
      '1w': '1w',
    };
    return map[interval] || interval;
  }

  private getIntervalMs(interval: string): number {
    const map: Record<string, number> = {
      '1m': 1 * 60 * 1000,
      '3m': 3 * 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '2h': 2 * 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '8h': 8 * 60 * 60 * 1000,
      '12h': 12 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
      '3d': 3 * 24 * 60 * 60 * 1000,
      '1w': 7 * 24 * 60 * 60 * 1000,
    };
    return map[interval] || 60 * 60 * 1000;
  }
}
