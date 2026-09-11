import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

import { BinanceKline } from 'src/market/dto/binance-kline.type';
import { BinanceFundingRate } from 'src/market/types/binance-funding-rate.type';
import { BinanceLiquidationOrder } from 'src/market/types/binance-liquidation.type';
import { BinanceOpenInterest } from 'src/market/types/binance-open-interest.type';

@Injectable()
export class LbankService {
  private readonly logger = new Logger(LbankService.name);
  private readonly spotBaseUrl = 'https://api.lbank.info';
  private readonly contractBaseUrl = 'https://lbkperp.lbank.com';

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
      const response = await axios.get<{ data?: LbankKline[] }>(
        `${this.spotBaseUrl}/v2/kline.do`,
        {
          params: {
            symbol: this.toLbankSymbol(symbol),
            type: this.mapInterval(interval),
            time: Math.floor(endTime / 1000),
            size: Math.min(limit, 2000),
          },
          timeout: 10000,
        },
      );

      const items = Array.isArray(response.data?.data)
        ? response.data.data
        : [];
      return items
        .map((item: unknown[]) => {
          const openTime = Number(item[0]) * 1000;
          return [
            openTime,
            String(item[1]),
            String(item[2]),
            String(item[3]),
            String(item[4]),
            String(item[5]),
            openTime + this.getIntervalMs(interval) - 1,
            '0',
            0,
            '0',
            '0',
            '0',
          ] as BinanceKline;
        })
        .filter((item) => item[0] >= startTime && item[0] <= endTime)
        .sort((a, b) => a[0] - b[0]);
    } catch (error) {
      this.logger.warn(
        `LBank klines error: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      return [];
    }
  }

  async getOpenInterest(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<BinanceOpenInterest[]> {
    this.logger.warn(
      `LBank open interest not available for ${symbol}; returning empty array.`,
    );
    return [];
  }

  async getFundingRate(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<BinanceFundingRate[]> {
    try {
      const response = await axios.get<{ data?: LbankMarket[] }>(
        `${this.contractBaseUrl}/cfd/openApi/v1/pub/marketData`,
        { params: { productGroup: 'SwapU' }, timeout: 10000 },
      );
      const markets = Array.isArray(response.data?.data)
        ? response.data.data
        : [];
      const market = markets.find(
        (item: { symbol?: string }) =>
          this.normalizeSymbol(item.symbol ?? '') ===
          this.normalizeSymbol(symbol),
      );
      if (!market) return [];

      return [
        {
          symbol,
          fundingRate: String(market.prePositionFeeRate ?? 0),
          fundingTime: Date.now(),
        },
      ];
    } catch (error) {
      this.logger.warn(
        `LBank funding error: ${error instanceof Error ? error.message : 'Unknown'}`,
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
      `LBank liquidation orders not available for ${symbol}; returning empty array.`,
    );
    return [];
  }

  private toLbankSymbol(symbol: string): string {
    return symbol
      .replace(/-SWAP-USDT$/, '_usdt')
      .replace(/USDT$/, '_usdt')
      .toLowerCase();
  }

  private normalizeSymbol(symbol: string): string {
    return symbol.replace(/[-_]/g, '').toUpperCase().replace(/SWAP/, '');
  }

  private mapInterval(interval: string): string {
    const map: Record<string, string> = {
      '1m': 'minute1',
      '5m': 'minute5',
      '15m': 'minute15',
      '30m': 'minute30',
      '1h': 'hour1',
      '4h': 'hour4',
      '1d': 'day1',
      '1w': 'week1',
    };
    return map[interval] || 'hour1';
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

type LbankKline = [number, number, number, number, number, number];

type LbankMarket = {
  symbol?: string;
  prePositionFeeRate?: number | string;
};
