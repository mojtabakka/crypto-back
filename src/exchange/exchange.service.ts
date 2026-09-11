import { Injectable, Logger } from '@nestjs/common';

import { BinanceService } from 'src/binance/binance.service';
import { OkxService } from 'src/okx/okx.service';
import { BybitService } from 'src/bybit/bybit.service';
import { MexcService } from 'src/mexc/mexc.service';
import { KucoinService } from 'src/kucoin/kucoin.service';
import { BingxService } from 'src/bingx/bingx.service';
import { CryptocomService } from 'src/cryptocom/cryptocom.service';
import { ToobitService } from 'src/toobit/toobit.service';
import { LbankService } from 'src/lbank/lbank.service';
import { OrbitService } from 'src/orbit/orbit.service';
import { KlineService } from 'src/kline/kline.service';
import { BinanceKline } from 'src/market/dto/binance-kline.type';
import { BinanceFundingRate } from 'src/market/types/binance-funding-rate.type';
import { BinanceLiquidationOrder } from 'src/market/types/binance-liquidation.type';
import { BinanceOpenInterest } from 'src/market/types/binance-open-interest.type';

export type ExchangeName =
  | 'BINANCE'
  | 'OKX'
  | 'BYBIT'
  | 'MEXC'
  | 'KUCOIN'
  | 'BINGX'
  | 'CRYPTOCOM'
  | 'TOOBIT'
  | 'LBANK'
  | 'ORBIT';

export function normalizeExchangeName(exchange?: string): ExchangeName {
  const normalized = exchange?.trim().toUpperCase();
  if (normalized === 'MEX') return 'MEXC';

  const exchanges: ExchangeName[] = [
    'BINANCE',
    'OKX',
    'BYBIT',
    'MEXC',
    'KUCOIN',
    'BINGX',
    'CRYPTOCOM',
    'TOOBIT',
    'LBANK',
    'ORBIT',
  ];

  return exchanges.includes(normalized as ExchangeName)
    ? (normalized as ExchangeName)
    : 'BINANCE';
}

const BLOCKED_STATUS_CODES = new Set([418, 429, 451]);
const CIRCUIT_BREAKER_DURATION_MS = 60 * 60 * 1000;

interface CircuitBreakerState {
  blockedUntil: number;
  blockCount: number;
}

@Injectable()
export class ExchangeService {
  private readonly logger = new Logger(ExchangeService.name);

  private circuitBreakers = new Map<ExchangeName, CircuitBreakerState>();

  constructor(
    private readonly binanceService: BinanceService,
    private readonly okxService: OkxService,
    private readonly bybitService: BybitService,
    private readonly mexcService: MexcService,
    private readonly kucoinService: KucoinService,
    private readonly bingxService: BingxService,
    private readonly cryptocomService: CryptocomService,
    private readonly toobitService: ToobitService,
    private readonly lbankService: LbankService,
    private readonly orbitService: OrbitService,
    private readonly klineService: KlineService,
  ) {}

  private isBlocked(exchange: ExchangeName): boolean {
    const state = this.circuitBreakers.get(exchange);
    if (!state) return false;
    if (Date.now() >= state.blockedUntil) {
      this.circuitBreakers.delete(exchange);
      this.logger.log(`🔓 Circuit breaker reset for ${exchange}`);
      return false;
    }
    return true;
  }

  private recordBlock(exchange: ExchangeName): void {
    const state = this.circuitBreakers.get(exchange);
    if (state && Date.now() < state.blockedUntil) {
      return;
    }
    const newState: CircuitBreakerState = {
      blockedUntil: Date.now() + CIRCUIT_BREAKER_DURATION_MS,
      blockCount: (state?.blockCount ?? 0) + 1,
    };
    this.circuitBreakers.set(exchange, newState);
    this.logger.warn(
      `🚫 Circuit breaker TRIPPED for ${exchange} — blocking all calls for 1h (block #${newState.blockCount}). Switch to another exchange!`,
    );
  }

  getCircuitBreakerStatus(): Record<
    string,
    {
      blocked: boolean;
      blockedUntil?: number;
      blockCount?: number;
      msRemaining?: number;
    }
  > {
    const result: Record<string, any> = {};
    for (const ex of [
      'BINANCE',
      'OKX',
      'BYBIT',
      'MEXC',
      'KUCOIN',
      'BINGX',
      'CRYPTOCOM',
      'TOOBIT',
      'LBANK',
      'ORBIT',
    ] as ExchangeName[]) {
      const state = this.circuitBreakers.get(ex);
      if (state && Date.now() < state.blockedUntil) {
        result[ex] = {
          blocked: true,
          blockedUntil: state.blockedUntil,
          blockCount: state.blockCount,
          msRemaining: state.blockedUntil - Date.now(),
        };
      } else {
        result[ex] = { blocked: false };
      }
    }
    return result;
  }

  private isStatusCodeError(err: unknown, codes: Set<number>): boolean {
    if (!err || typeof err !== 'object') return false;
    const anyErr = err as {
      response?: { status?: number };
      message?: string;
      status?: number;
    };
    if (anyErr.response?.status && codes.has(anyErr.response.status))
      return true;
    if (anyErr.status && codes.has(anyErr.status)) return true;
    if (anyErr.message) {
      for (const code of codes) {
        if (anyErr.message.includes(`status code ${code}`)) return true;
      }
    }
    return false;
  }

  async getKlines(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
    exchange: ExchangeName = 'BINANCE',
    limit = 1000,
  ): Promise<BinanceKline[]> {
    this.logger.log(
      `📊 [${exchange}] klines: ${symbol} | ${interval} | ${new Date(startTime).toISOString()} -> ${new Date(endTime).toISOString()}`,
    );
    return this.getKlinesWithCache(
      symbol,
      interval,
      startTime,
      endTime,
      exchange,
      limit,
    );
  }

  async getFuturesKlines(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
    exchange: ExchangeName = 'BINANCE',
    limit = 1000,
  ): Promise<BinanceKline[]> {
    if (this.isBlocked(exchange)) {
      return [];
    }
    this.logger.log(
      `📊 [${exchange}] klines: ${symbol} | ${interval} | ${new Date(startTime).toISOString()} -> ${new Date(endTime).toISOString()}`,
    );
    try {
      return await this.getKlinesWithCache(
        symbol,
        interval,
        startTime,
        endTime,
        exchange,
        limit,
      );
    } catch (err) {
      if (this.isStatusCodeError(err, BLOCKED_STATUS_CODES)) {
        this.recordBlock(exchange);
        return [];
      }
      throw err;
    }
  }

  private getService(exchange: ExchangeName) {
    switch (exchange) {
      case 'OKX':
        return this.okxService;
      case 'BYBIT':
        return this.bybitService;
      case 'MEXC':
        return this.mexcService;
      case 'KUCOIN':
        return this.kucoinService;
      case 'BINGX':
        return this.bingxService;
      case 'CRYPTOCOM':
        return this.cryptocomService;
      case 'TOOBIT':
        return this.toobitService;
      case 'LBANK':
        return this.lbankService;
      case 'ORBIT':
        return this.orbitService;
      case 'BINANCE':
      default:
        return this.binanceService;
    }
  }

  private async getKlinesWithCache(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
    exchange: ExchangeName,
    limit: number,
  ): Promise<BinanceKline[]> {
    const service = this.getService(exchange);

    if (exchange === 'BINANCE') {
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
    }

    return service.getFuturesKlines(
      symbol,
      interval,
      startTime,
      endTime,
      limit,
    );
  }

  async getOpenInterest(
    symbol: string,
    startTime: number,
    endTime: number,
    exchange: ExchangeName = 'BINANCE',
  ): Promise<BinanceOpenInterest[]> {
    if (this.isBlocked(exchange)) {
      return [];
    }
    this.logger.log(
      `📈 ExchangeService.getOpenInterest: ${exchange} | ${symbol} | ${new Date(startTime).toISOString()} -> ${new Date(endTime).toISOString()}`,
    );
    const service = this.getService(exchange);
    if ('getOpenInterest' in service) {
      try {
        return await (
          service as {
            getOpenInterest: typeof this.binanceService.getOpenInterest;
          }
        ).getOpenInterest(symbol, startTime, endTime);
      } catch (err) {
        if (this.isStatusCodeError(err, BLOCKED_STATUS_CODES)) {
          this.recordBlock(exchange);
          return [];
        }
        throw err;
      }
    }
    return [];
  }

  async getFundingRate(
    symbol: string,
    startTime: number,
    endTime: number,
    exchange: ExchangeName = 'BINANCE',
  ): Promise<BinanceFundingRate[]> {
    if (this.isBlocked(exchange)) {
      return [];
    }
    this.logger.log(
      `💰 ExchangeService.getFundingRate: ${exchange} | ${symbol}`,
    );
    const service = this.getService(exchange);
    if ('getFundingRate' in service) {
      try {
        return await (
          service as {
            getFundingRate: typeof this.binanceService.getFundingRate;
          }
        ).getFundingRate(symbol, startTime, endTime);
      } catch (err) {
        if (this.isStatusCodeError(err, BLOCKED_STATUS_CODES)) {
          this.recordBlock(exchange);
          return [];
        }
        throw err;
      }
    }
    return [];
  }

  async getLiquidationOrders(
    symbol: string,
    startTime: number,
    endTime: number,
    exchange: ExchangeName = 'BINANCE',
  ): Promise<BinanceLiquidationOrder[]> {
    if (this.isBlocked(exchange)) {
      return [];
    }
    this.logger.log(
      `💥 ExchangeService.getLiquidationOrders: ${exchange} | ${symbol}`,
    );
    const service = this.getService(exchange);
    if ('getLiquidationOrders' in service) {
      try {
        return await (
          service as {
            getLiquidationOrders: typeof this.binanceService.getLiquidationOrders;
          }
        ).getLiquidationOrders(symbol, startTime, endTime);
      } catch (err) {
        if (this.isStatusCodeError(err, BLOCKED_STATUS_CODES)) {
          this.recordBlock(exchange);
          return [];
        }
        throw err;
      }
    }
    return [];
  }

  getAvailableExchanges(): ExchangeName[] {
    return [
      'BINANCE',
      'OKX',
      'BYBIT',
      'MEXC',
      'KUCOIN',
      'BINGX',
      'CRYPTOCOM',
      'TOOBIT',
      'LBANK',
      'ORBIT',
    ];
  }

  resetCircuitBreaker(exchange: ExchangeName): { message: string } {
    this.circuitBreakers.delete(exchange);
    this.logger.log(`🔓 Circuit breaker manually reset for ${exchange}`);
    return { message: `Circuit breaker reset for ${exchange}` };
  }

  resetAllCircuitBreakers(): void {
    this.circuitBreakers.clear();
    this.logger.log('🔓 All circuit breakers manually reset');
  }
}
