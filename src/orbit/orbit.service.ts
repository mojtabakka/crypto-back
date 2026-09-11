import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

import { BinanceKline } from 'src/market/dto/binance-kline.type';
import { BinanceFundingRate } from 'src/market/types/binance-funding-rate.type';
import { BinanceLiquidationOrder } from 'src/market/types/binance-liquidation.type';
import { BinanceOpenInterest } from 'src/market/types/binance-open-interest.type';

@Injectable()
export class OrbitService {
  private readonly logger = new Logger(OrbitService.name);
  private readonly baseUrl =
    process.env.ORBIT_BASE_URL || 'https://api.orbit.exchange';

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
      const url = `${this.baseUrl}/api/v1/klines`;
      const params = {
        symbol: this.toOrbitSymbol(symbol),
        interval: this.mapInterval(interval),
        startTime,
        endTime,
        limit: Math.min(limit, 1000),
      };
      this.logger.log(
        `🌐 [ORBIT] GET ${url}?${new URLSearchParams(params as unknown as Record<string, string>).toString()}`,
      );

      const response = await axios.get(url, {
        params,
        timeout: 10000,
      });

      const items = Array.isArray(response.data)
        ? response.data
        : (response.data?.data ?? []);

      const klines: BinanceKline[] = [];
      for (const item of items) {
        const openTime = Number(item[0] ?? item.time ?? 0);
        const closeTime = Number(
          item[6] ??
            item.closeTime ??
            openTime + this.getIntervalMs(interval) - 1,
        );
        klines.push([
          openTime,
          String(item[1] ?? item.open ?? 0),
          String(item[2] ?? item.high ?? 0),
          String(item[3] ?? item.low ?? 0),
          String(item[4] ?? item.close ?? 0),
          String(item[5] ?? item.volume ?? 0),
          closeTime,
          String(item[7] ?? item.quoteVolume ?? '0'),
          Number(item[8] ?? item.numTrades ?? 0),
          String(item[9] ?? item.takerBuyBase ?? '0'),
          String(item[10] ?? item.takerBuyQuote ?? '0'),
          '0',
        ]);
      }

      return klines.filter((k) => k[0] >= startTime && k[0] <= endTime);
    } catch (error) {
      this.logger.warn(
        `Orbit klines error: ${error instanceof Error ? error.message : 'Unknown'}`,
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
      const url = `${this.baseUrl}/api/v1/openInterest`;
      const params = {
        symbol: this.toOrbitSymbol(symbol),
        startTime,
        endTime,
      };
      this.logger.log(
        `🌐 [ORBIT] GET ${url}?${new URLSearchParams(params as unknown as Record<string, string>).toString()}`,
      );

      const response = await axios.get(url, {
        params,
        timeout: 10000,
      });

      const items = Array.isArray(response.data)
        ? response.data
        : (response.data?.data ?? []);

      return items.map((item: Record<string, unknown>) => ({
        symbol,
        sumOpenInterest: String(item.openInterest ?? item.size ?? 0),
        sumOpenInterestValue: String(item.openInterestValue ?? item.size ?? 0),
        timestamp: Number(item.timestamp ?? item.time ?? Date.now()),
      }));
    } catch (error) {
      this.logger.warn(
        `Orbit open interest error: ${error instanceof Error ? error.message : 'Unknown'}`,
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
      const url = `${this.baseUrl}/api/v1/fundingRate`;
      const params = {
        symbol: this.toOrbitSymbol(symbol),
        startTime,
        endTime,
        limit: 1000,
      };
      this.logger.log(
        `🌐 [ORBIT] GET ${url}?${new URLSearchParams(params as unknown as Record<string, string>).toString()}`,
      );

      const response = await axios.get(url, {
        params,
        timeout: 10000,
      });

      const items = Array.isArray(response.data)
        ? response.data
        : (response.data?.data ?? []);

      return items.map((item: Record<string, unknown>) => ({
        symbol,
        fundingRate: String(item.fundingRate ?? item.rate ?? 0),
        fundingTime: Number(item.fundingTime ?? item.time ?? Date.now()),
      }));
    } catch (error) {
      this.logger.warn(
        `Orbit funding rate error: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      return [];
    }
  }

  async getLiquidationOrders(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<BinanceLiquidationOrder[]> {
    try {
      const url = `${this.baseUrl}/api/v1/liquidationOrders`;
      const params = {
        symbol: this.toOrbitSymbol(symbol),
        startTime,
        endTime,
        limit: 1000,
      };
      this.logger.log(
        `🌐 [ORBIT] GET ${url}?${new URLSearchParams(params as unknown as Record<string, string>).toString()}`,
      );

      const response = await axios.get(url, {
        params,
        timeout: 10000,
      });

      const items = Array.isArray(response.data)
        ? response.data
        : (response.data?.data ?? []);

      return items.map((item: Record<string, unknown>) => ({
        symbol,
        side:
          String(item.side ?? item.direction ?? 'SELL').toUpperCase() === 'BUY'
            ? 'BUY'
            : 'SELL',
        price: String(item.price ?? 0),
        origQty: String(item.origQty ?? item.quantity ?? 0),
        executedQty: String(item.executedQty ?? item.quantity ?? 0),
        averagePrice: String(item.averagePrice ?? item.price ?? 0),
        status: 'FILLED',
        timeInForce: 'GTC',
        type: 'MARKET',
        clientOrderId: `orbit-${item.time ?? Date.now()}`,
        lastUpdateTime: Number(item.time ?? item.lastUpdateTime ?? Date.now()),
      }));
    } catch (error) {
      this.logger.warn(
        `Orbit liquidation orders error: ${error instanceof Error ? error.message : 'Unknown'}`,
      );
      return [];
    }
  }

  private toOrbitSymbol(symbol: string): string {
    if (symbol.includes('-SWAP-')) return symbol;
    return `${symbol.replace(/USDT$/, '')}-SWAP-USDT`;
  }

  private mapInterval(interval: string): string {
    const map: Record<string, string> = {
      '1m': '1m',
      '5m': '5m',
      '15m': '15m',
      '30m': '30m',
      '1h': '1h',
      '4h': '4h',
      '1d': '1d',
      '1w': '1w',
    };
    return map[interval] || interval;
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
