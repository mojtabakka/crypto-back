import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

import { BinanceKline } from 'src/market/dto/binance-kline.type';
import { BinanceFundingRate } from 'src/market/types/binance-funding-rate.type';
import { BinanceOpenInterest } from 'src/market/types/binance-open-interest.type';

@Injectable()
export class MexcService {
  private readonly logger = new Logger(MexcService.name);

  private readonly baseUrl = 'https://contract.mexc.com';

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
      const mexcInterval = this.mapInterval(interval);
      const cleanSymbol = symbol.replace(/USDT$/, '_USDT');

      const url = `${this.baseUrl}/api/v1/contract/kline/${cleanSymbol}`;
      const params = {
        interval: mexcInterval,
        start: Math.floor(startTime / 1000),
        end: Math.floor(endTime / 1000),
      };
      this.logger.log(`🌐 [MEXC] GET ${url}?${new URLSearchParams(params as unknown as Record<string, string>).toString()}`);

      const response = await axios.get(url, {
        params,
        timeout: 10000,
      });

      const data = response.data?.data ?? {};
      const times = (data.time ?? []) as number[];
      const opens = (data.open ?? []) as number[];
      const highs = (data.high ?? []) as number[];
      const lows = (data.low ?? []) as number[];
      const closes = (data.close ?? []) as number[];
      const volumes = (data.vol ?? []) as number[];
      const quoteVolumes = (data.amount ?? []) as number[];

      const klines: BinanceKline[] = [];
      for (let i = 0; i < times.length && i < limit; i++) {
        klines.push([
          times[i] * 1000,
          String(opens[i] ?? 0),
          String(highs[i] ?? 0),
          String(lows[i] ?? 0),
          String(closes[i] ?? 0),
          String(volumes[i] ?? 0),
          times[i] * 1000 + this.getIntervalMs(interval) - 1,
          String(quoteVolumes[i] ?? 0),
          0,
          '0',
          '0',
          '0',
        ]);
      }

      return klines;
    } catch (error) {
      this.logger.error(`MEXC klines error: ${error instanceof Error ? error.message : 'Unknown'}`);
      return [];
    }
  }

  async getOpenInterest(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<BinanceOpenInterest[]> {
    try {
      const cleanSymbol = symbol.replace(/USDT$/, '_USDT');
      const response = await axios.get(`${this.baseUrl}/api/v1/contract/risk_limit`, {
        params: { symbol: cleanSymbol },
        timeout: 10000,
      });

      const data = response.data?.data ?? {};
      return [
        {
          symbol,
          sumOpenInterest: String(data?.holdVol ?? 0),
          sumOpenInterestValue: String(data?.holdAmount ?? 0),
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
      const cleanSymbol = symbol.replace(/USDT$/, '_USDT');
      const response = await axios.get(`${this.baseUrl}/api/v1/contract/funding_rate/history`, {
        params: { symbol: cleanSymbol, start_time: startTime, end_time: endTime },
        timeout: 10000,
      });

      const items = response.data?.data ?? [];
      return items.map((item: { settleTime: number; fundingRate: number }) => ({
        symbol,
        fundingRate: String(item.fundingRate ?? 0),
        fundingTime: item.settleTime,
      }));
    } catch {
      return [];
    }
  }

  private mapInterval(interval: string): string {
    const map: Record<string, string> = {
      '1m': 'Min1',
      '5m': 'Min5',
      '15m': 'Min15',
      '30m': 'Min30',
      '1h': 'Hour1',
      '4h': 'Hour4',
      '1d': 'Day1',
      '1w': 'Week1',
    };
    return map[interval] || 'Hour1';
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
