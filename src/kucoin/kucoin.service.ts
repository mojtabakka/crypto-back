import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

import { BinanceKline } from 'src/market/dto/binance-kline.type';
import { BinanceFundingRate } from 'src/market/types/binance-funding-rate.type';
import { BinanceOpenInterest } from 'src/market/types/binance-open-interest.type';

@Injectable()
export class KucoinService {
  private readonly logger = new Logger(KucoinService.name);

  private readonly baseUrl = 'https://api-futures.kucoin.com';

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
      const kucoinInterval = this.mapInterval(interval);
      const url = `${this.baseUrl}/api/v1/kline/query`;
      const params = {
        symbol,
        granularity: kucoinInterval,
        from: startTime,
        to: endTime,
      };
      this.logger.log(
        `🌐 [KUCOIN] GET ${url}?${new URLSearchParams(params as unknown as Record<string, string>).toString()}`,
      );

      const response = await axios.get(url, {
        params,
        timeout: 10000,
      });

      const items = response.data?.data ?? [];
      const klines: BinanceKline[] = [];
      for (let i = 0; i < items.length && i < limit; i++) {
        const item = items[i] as [
          number,
          number,
          number,
          number,
          number,
          number,
        ];
        klines.push([
          item[0] * 1000,
          String(item[1]),
          String(item[3]),
          String(item[4]),
          String(item[2]),
          String(item[5]),
          item[0] * 1000 + this.getIntervalMs(interval) - 1,
          '0',
          0,
          '0',
          '0',
          '0',
        ]);
      }

      return klines;
    } catch (error) {
      this.logger.error(
        `KuCoin klines error: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      return [];
    }
  }

  async getOpenInterest(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<BinanceOpenInterest[]> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/api/v1/contracts/${symbol}`,
      );
      const data = response.data?.data ?? {};
      return [
        {
          symbol,
          sumOpenInterest: String(data?.openInterest ?? 0),
          sumOpenInterestValue: String(data?.openInterest ?? 0),
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
      const response = await axios.get(
        `${this.baseUrl}/api/v1/contract/funding-rates`,
        {
          params: { symbol, from: startTime, to: endTime },
          timeout: 10000,
        },
      );

      const items = response.data?.data ?? [];
      return items.map((item: { time: number; value: number }) => ({
        symbol,
        fundingRate: String(item.value ?? 0),
        fundingTime: item.time,
      }));
    } catch {
      return [];
    }
  }

  private mapInterval(interval: string): number {
    const map: Record<string, number> = {
      '1m': 1,
      '5m': 5,
      '15m': 15,
      '30m': 30,
      '1h': 60,
      '4h': 240,
      '1d': 1440,
      '1w': 10080,
    };
    return map[interval] || 60;
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
