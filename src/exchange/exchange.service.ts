import { Injectable, Logger } from '@nestjs/common';

import { BinanceService } from 'src/binance/binance.service';
import { KlineService } from 'src/kline/kline.service';
import { BinanceKline } from 'src/market/dto/binance-kline.type';
import { BinanceFundingRate } from 'src/market/types/binance-funding-rate.type';
import { BinanceLiquidationOrder } from 'src/market/types/binance-liquidation.type';
import { BinanceOpenInterest } from 'src/market/types/binance-open-interest.type';

@Injectable()
export class ExchangeService {
  private readonly logger = new Logger(ExchangeService.name);

  constructor(
    private readonly binanceService: BinanceService,
    private readonly klineService: KlineService,
  ) {}

  async getKlines(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
    limit = 1000,
  ): Promise<BinanceKline[]> {
    return this.getKlinesWithCache(symbol, interval, startTime, endTime, limit);
  }

  async getFuturesKlines(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
    limit = 1000,
  ): Promise<BinanceKline[]> {
    return this.getKlinesWithCache(symbol, interval, startTime, endTime, limit);
  }

  private async getKlinesWithCache(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
    limit: number,
  ): Promise<BinanceKline[]> {
    const cachedKlines = await this.klineService.getKlines(
      symbol,
      interval,
      startTime,
      endTime,
    );

    if (cachedKlines.length > 0) {
      const oldestCached = cachedKlines[0][0];
      const newestCached = cachedKlines[cachedKlines.length - 1][0];

      const missingRanges: Array<{ start: number; end: number }> = [];

      if (startTime < oldestCached) {
        missingRanges.push({ start: startTime, end: oldestCached - 1 });
      }

      if (endTime > newestCached) {
        missingRanges.push({ start: newestCached + 1, end: endTime });
      }

      if (missingRanges.length === 0) {
        return cachedKlines;
      }

      const missingKlines: BinanceKline[] = [];
      for (const range of missingRanges) {
        const newKlines = await this.binanceService.getFuturesKlines(
          symbol,
          interval,
          range.start,
          range.end,
          limit,
        );
        if (newKlines.length > 0) {
          missingKlines.push(...newKlines);
          await this.klineService.saveKlines(symbol, interval, newKlines);
        }
      }

      const allKlines = [...cachedKlines, ...missingKlines];
      allKlines.sort((a, b) => a[0] - b[0]);
      return allKlines;
    }

    const klines = await this.binanceService.getFuturesKlines(
      symbol,
      interval,
      startTime,
      endTime,
      limit,
    );
    if (klines.length > 0) {
      await this.klineService.saveKlines(symbol, interval, klines);
    }
    return klines;
  }

  async getOpenInterest(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<BinanceOpenInterest[]> {
    return this.binanceService.getOpenInterest(symbol, startTime, endTime);
  }

  async getFundingRate(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<BinanceFundingRate[]> {
    return this.binanceService.getFundingRate(symbol, startTime, endTime);
  }

  async getLiquidationOrders(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<BinanceLiquidationOrder[]> {
    return this.binanceService.getLiquidationOrders(symbol, startTime, endTime);
  }
}
