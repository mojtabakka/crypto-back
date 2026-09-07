import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

import { BinanceKline } from 'src/market/dto/binance-kline.type';
import { BinanceFundingRate } from 'src/market/types/binance-funding-rate.type';
import { BinanceOpenInterest } from 'src/market/types/binance-open-interest.type';

@Injectable()
export class BingxService {
  private readonly logger = new Logger(BingxService.name);

  private readonly baseUrl = 'https://open-api.bingx.com';

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
    try {
      const url = `${this.baseUrl}/openApi/swap/v2/quote/klines`;
      const params = {
        symbol,
        interval,
        startTime,
        endTime,
        limit,
      };
      this.logger.log(`🌐 [BINGX] GET ${url}?${new URLSearchParams(params as unknown as Record<string, string>).toString()}`);

      const response = await axios.get(url, {
        params,
        timeout: 10000,
      });

      const items = (response.data?.data ?? []) as Array<{
        time: number;
        open: string;
        high: string;
        low: string;
        close: string;
        volume: string;
        quoteVolume: string;
      }>;

      return items.map((item) => [
        item.time,
        item.open,
        item.high,
        item.low,
        item.close,
        item.volume,
        item.time + this.getIntervalMs(interval) - 1,
        item.quoteVolume,
        0,
        '0',
        '0',
        '0',
      ] as BinanceKline);
    } catch (error) {
      this.logger.error(`BingX klines error: ${error instanceof Error ? error.message : 'Unknown'}`);
      return [];
    }
  }

  async getOpenInterest(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<BinanceOpenInterest[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/openApi/swap/v2/quote/openInterest`, {
        params: { symbol },
        timeout: 10000,
      });

      const data = response.data?.data ?? {};
      return [
        {
          symbol,
          sumOpenInterest: String(data?.openInterest ?? 0),
          sumOpenInterestValue: String(data?.openInterestValue ?? 0),
          timestamp: Date.now(),
        },
      ];
    } catch {
      return [];
    }
  }

  async getFundingRate(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<BinanceFundingRate[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/openApi/swap/v2/quote/fundingRate`, {
        params: { symbol, startTime, endTime },
        timeout: 10000,
      });

      const items = (response.data?.data ?? []) as Array<{ time: number; fundingRate: string }>;
      return items.map((item) => ({
        symbol,
        fundingRate: item.fundingRate,
        fundingTime: item.time,
      }));
    } catch {
      return [];
    }
  }

  private getIntervalMs(interval: string): number {
    const map: Record<string, number> = {
      '1m': 60 * 1000,
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
