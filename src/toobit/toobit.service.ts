import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

import { BinanceKline } from 'src/market/dto/binance-kline.type';
import { BinanceFundingRate } from 'src/market/types/binance-funding-rate.type';
import { BinanceLiquidationOrder } from 'src/market/types/binance-liquidation.type';
import { BinanceOpenInterest } from 'src/market/types/binance-open-interest.type';

@Injectable()
export class ToobitService {
  private readonly logger = new Logger(ToobitService.name);
  private readonly baseUrl = 'https://api.toobit.com';

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
      const response = await axios.get<
        ToobitKline[] | { data?: ToobitKline[] }
      >(`${this.baseUrl}/quote/v1/klines`, {
        params: {
          symbol: this.toobitSymbol(symbol),
          interval: this.mapInterval(interval),
          startTime,
          endTime,
          limit: Math.min(limit, 1000),
        },
        timeout: 10000,
      });

      const items = Array.isArray(response.data)
        ? response.data
        : (response.data?.data ?? []);

      return items.map((item) => [
        Number(item[0]),
        String(item[1]),
        String(item[2]),
        String(item[3]),
        String(item[4]),
        String(item[5]),
        Number(item[6] ?? Number(item[0]) + this.getIntervalMs(interval)),
        String(item[7] ?? '0'),
        Number(item[8] ?? 0),
        String(item[9] ?? '0'),
        String(item[10] ?? '0'),
        '0',
      ]);
    } catch (error) {
      this.logger.warn(
        `Toobit klines error: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      return [];
    }
  }

  async getOpenInterest(
    symbol: string,
    _startTime: number,
    _endTime: number,
  ): Promise<BinanceOpenInterest[]> {
    try {
      const response = await axios.get<{
        openInterestList?: Array<{ size?: number | string }>;
      }>(`${this.baseUrl}/quote/v1/openInterest`, {
        params: { symbol: this.toobitSymbol(symbol) },
        timeout: 10000,
      });
      const item = response.data?.openInterestList?.[0];
      if (!item) return [];

      return [
        {
          symbol,
          sumOpenInterest: String(item.size ?? 0),
          sumOpenInterestValue: String(item.size ?? 0),
          timestamp: Date.now(),
        },
      ];
    } catch (error) {
      this.logger.warn(
        `Toobit open interest error: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
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
        `${this.baseUrl}/api/v1/futures/fundingRate`,
        { params: { symbol: this.toobitSymbol(symbol) }, timeout: 10000 },
      );
      const items = Array.isArray(response.data) ? response.data : [];
      return items.map((item: { rate?: string; nextFundingTime?: string }) => ({
        symbol,
        fundingRate: String(item.rate ?? 0),
        fundingTime: Number(item.nextFundingTime ?? Date.now()),
      }));
    } catch (error) {
      this.logger.warn(
        `Toobit funding error: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      return [];
    }
  }

  async getLiquidationOrders(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<BinanceLiquidationOrder[]> {
    this.logger.warn(
      `Toobit liquidation orders not available for ${symbol}; returning empty array.`,
    );
    return [];
  }

  private toobitSymbol(symbol: string): string {
    if (symbol.includes('-SWAP-')) return symbol;
    return `${symbol.replace(/USDT$/, '')}-SWAP-USDT`;
  }

  private mapInterval(interval: string): string {
    return interval === '1w' ? '1w' : interval === '1d' ? '1d' : interval;
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

type ToobitKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number?,
  string?,
  number?,
  string?,
  string?,
];
