import { Injectable, Logger } from '@nestjs/common';
import { MultiExchangeKlineService } from 'src/exchange/multi-exchange-kline.service';
import { FuturesSymbolsService } from 'src/futures-symbols/futures-symbols.service';
import type {
  IchimokuBaseConversionScanParams,
  IchimokuBaseConversionScanResult,
  IchimokuBaseConversionSignal,
} from './types/ichimoku-base-conversion.types';

type SupportedExchange = 'binance' | 'bybit' | 'mexc' | 'toobit';

const LOOKBACK_DAYS = 200;
const MIN_CANDLES = 50;

const INTERVAL_LOOKBACK_DAYS: Record<string, number> = {
  '1m': 3,
  '3m': 5,
  '5m': 10,
  '15m': 20,
  '30m': 30,
  '1h': 60,
  '2h': 80,
  '4h': 100,
  '6h': 120,
  '8h': 140,
  '12h': 160,
  '1d': 200,
  '3d': 250,
  '1w': 300,
};

interface FuturesSymbol {
  symbol: string;
  quoteAsset: string;
  status: string;
  contractType: string;
}

@Injectable()
export class IchimokuBaseConversionService {
  private readonly logger = new Logger(IchimokuBaseConversionService.name);

  constructor(
    private readonly klineService: MultiExchangeKlineService,
    private readonly futuresSymbolsService: FuturesSymbolsService,
  ) {}

  async scan(
    params: IchimokuBaseConversionScanParams = {},
  ): Promise<IchimokuBaseConversionScanResult> {
    let symbols: string[];

    if (params.symbols) {
      symbols = params.symbols
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    } else {
      symbols = await this.getStoredUsdtSymbols();
    }

    const limit = params.limit ? Number(params.limit) : 0;
    const targetSymbols = limit > 0 ? symbols.slice(0, limit) : symbols;

    const interval = params.interval ?? '1d';
    const exchange = (params.exchange as SupportedExchange) ?? 'binance';

    this.logger.log(
      `Ichimoku base-conversion scan started for ${targetSymbols.length} symbols (${interval}, exchange=${exchange})`,
    );

    const concurrency = 5;
    const matches: IchimokuBaseConversionSignal[] = [];

    for (let i = 0; i < targetSymbols.length; i += concurrency) {
      const batch = targetSymbols.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map((sym) => this.evaluateSymbol(sym, interval, exchange)),
      );
      for (const signal of results) {
        if (signal) matches.push(signal);
      }
    }

    return {
      timestamp: new Date().toISOString(),
      interval,
      exchange,
      totalScanned: targetSymbols.length,
      matches,
    };
  }

  async evaluateSymbol(
    symbol: string,
    interval: string,
    exchange: SupportedExchange,
  ): Promise<IchimokuBaseConversionSignal | null> {
    try {
      const now = Date.now();
      const lookbackDays = INTERVAL_LOOKBACK_DAYS[interval] ?? LOOKBACK_DAYS;
      const startTime = now - lookbackDays * 24 * 60 * 60 * 1000;

      const klines = await this.klineService.getFuturesKlines(
        symbol,
        interval,
        startTime,
        now,
        1000,
        exchange,
      );

      if (!klines || klines.length < MIN_CANDLES) {
        return null;
      }

      const candles = klines.map((k) => ({
        openTime: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
      }));

      const signal = this.computeBaseConversion(symbol, candles);
      return signal;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Ichimoku base-conversion evaluation failed for ${symbol}`,
        msg,
      );
      return null;
    }
  }

  private computeBaseConversion(
    symbol: string,
    candles: {
      openTime: number;
      open: number;
      high: number;
      low: number;
      close: number;
    }[],
  ): IchimokuBaseConversionSignal | null {
    const n = candles.length;
    const last = n - 1;
    if (last < MIN_CANDLES - 1) return null;

    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);

    // Tenkan-sen (Conversion Line): (max high + min low) / 2 over last 9 candles
    const tenkanPeriod = 8; // 9 candles inclusive
    const tenkanValues: number[] = Array.from({ length: n }, () => NaN);

    for (let i = tenkanPeriod; i < n; i++) {
      const hh = this.highest(highs, i - tenkanPeriod, i);
      const ll = this.lowest(lows, i - tenkanPeriod, i);
      tenkanValues[i] = (hh + ll) / 2;
    }

    const currentPrice = closes[last];
    const currentTenkan = tenkanValues[last];
    const prevPrice = closes[last - 1];
    const prevTenkan = tenkanValues[last - 1];

    if (isNaN(currentTenkan) || isNaN(prevTenkan)) return null;

    // BUY: price crossed above Tenkan (previous close <= prev Tenkan, current close > current Tenkan)
    if (prevPrice <= prevTenkan && currentPrice > currentTenkan) {
      return {
        symbol,
        price: currentPrice,
        tenkanValue: currentTenkan,
        touchPoint: currentTenkan,
        signal: 'BUY',
      };
    }

    // SELL: price crossed below Tenkan (previous close >= prev Tenkan, current close < current Tenkan)
    if (prevPrice >= prevTenkan && currentPrice < currentTenkan) {
      return {
        symbol,
        price: currentPrice,
        tenkanValue: currentTenkan,
        touchPoint: currentTenkan,
        signal: 'SELL',
      };
    }

    return null;
  }

  private highest(arr: number[], start: number, end: number): number {
    let max = arr[start];
    for (let i = start + 1; i <= end; i++) {
      if (arr[i] > max) max = arr[i];
    }
    return max;
  }

  private lowest(arr: number[], start: number, end: number): number {
    let min = arr[start];
    for (let i = start + 1; i <= end; i++) {
      if (arr[i] < min) min = arr[i];
    }
    return min;
  }

  async getStoredUsdtSymbols(): Promise<string[]> {
    const stored = await this.futuresSymbolsService.getStoredSymbols();
    const symbols: string[] = [];
    for (const s of stored.symbols as FuturesSymbol[]) {
      if (
        s.quoteAsset === 'USDT' &&
        s.status === 'TRADING' &&
        s.contractType === 'PERPETUAL'
      ) {
        symbols.push(s.symbol);
      }
    }
    return symbols;
  }
}
