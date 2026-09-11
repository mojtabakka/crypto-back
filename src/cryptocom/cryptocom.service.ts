import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

import { BinanceKline } from 'src/market/dto/binance-kline.type';

@Injectable()
export class CryptocomService {
  private readonly logger = new Logger(CryptocomService.name);

  private readonly baseUrl = 'https://api.crypto.com/v2';

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
      const ccInterval = this.mapInterval(interval);
      const url = `${this.baseUrl}/public/get-candlestick`;
      const params = {
        instrument_name: symbol,
        timeframe: ccInterval,
        start_ts: startTime,
        end_ts: endTime,
        count: Math.min(limit, 300),
      };
      this.logger.log(
        `🌐 [CRYPTOCOM] GET ${url}?${new URLSearchParams(params as unknown as Record<string, string>).toString()}`,
      );

      const response = await axios.get(url, {
        params,
        timeout: 10000,
      });

      const items = response.data?.result?.data ?? [];
      const klines: BinanceKline[] = [];
      for (const item of items as Array<{
        t: number;
        o: number;
        h: number;
        l: number;
        c: number;
        v: number;
      }>) {
        klines.push([
          item.t,
          String(item.o),
          String(item.h),
          String(item.l),
          String(item.c),
          String(item.v),
          item.t + this.getIntervalMs(interval) - 1,
          '0',
          0,
          '0',
          '0',
          '0',
        ] as BinanceKline);
      }

      return klines;
    } catch (error) {
      this.logger.error(
        `Crypto.com error: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      return [];
    }
  }

  private mapInterval(interval: string): string {
    const map: Record<string, string> = {
      '1m': 'M1',
      '5m': 'M5',
      '15m': 'M15',
      '30m': 'M30',
      '1h': 'H1',
      '4h': 'H4',
      '1d': 'D1',
      '1w': 'W1',
    };
    return map[interval] || 'H1';
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
