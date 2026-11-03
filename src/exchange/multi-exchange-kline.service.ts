import { Injectable, Logger } from '@nestjs/common';

import { BinanceService } from 'src/binance/binance.service';
import { BybitService } from 'src/bybit/bybit.service';
import { ToobitService } from 'src/toobit/toobit.service';

import { BinanceKline } from 'src/market/dto/binance-kline.type';

export type SupportedExchange = 'binance' | 'bybit' | 'mexc' | 'toobit';

@Injectable()
export class MultiExchangeKlineService {
  private readonly logger = new Logger(MultiExchangeKlineService.name);

  constructor(
    private readonly binanceService: BinanceService,
    private readonly bybitService: BybitService,
    private readonly toobitService: ToobitService,
  ) {}

  async getFuturesKlines(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
    limit = 1000,
    exchange: SupportedExchange = 'binance',
  ): Promise<BinanceKline[]> {
    switch (exchange) {
      case 'bybit':
        return this.bybitService.getFuturesKlines(
          symbol,
          interval,
          startTime,
          endTime,
          limit,
        );
      case 'toobit':
        return this.toobitService.getFuturesKlines(
          symbol,
          interval,
          startTime,
          endTime,
          limit,
        );
      case 'mexc':
        throw new Error(
          `MEXC exchange klines are not yet supported. No MexcService implemented.`,
        );
      case 'binance':
      default:
        return this.binanceService.getFuturesKlines(
          symbol,
          interval,
          startTime,
          endTime,
          limit,
        );
    }
  }

  async getKlines(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
    limit = 1000,
    exchange: SupportedExchange = 'binance',
  ): Promise<BinanceKline[]> {
    return this.getFuturesKlines(
      symbol,
      interval,
      startTime,
      endTime,
      limit,
      exchange,
    );
  }
}
