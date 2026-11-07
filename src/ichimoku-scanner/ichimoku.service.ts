import { Injectable, Logger } from '@nestjs/common';
import { MultiExchangeKlineService } from 'src/exchange/multi-exchange-kline.service';
import { FuturesSymbolsService } from 'src/futures-symbols/futures-symbols.service';
import type {
  IchimokuNearCloudBottomScanParams,
  IchimokuNearCloudBottomScanResult,
  IchimokuNearCloudBottomSignal,
  IchimokuScanParams,
  IchimokuScanResult,
  IchimokuSignal,
} from './types/ichimoku.types';

type SupportedExchange = 'binance' | 'bybit' | 'mexc' | 'toobit';

const LOOKBACK_DAYS = 200;
const MIN_CANDLES = 80;
const DEFAULT_NEAR_CLOUD_THRESHOLD_PCT = 1;

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

interface IchimokuSnapshot {
  price: number;
  tenkan: number;
  kijun: number;
  spanA: number;
  spanB: number;
  cloudTop: number;
  cloudBottom: number;
}

@Injectable()
export class IchimokuScannerService {
  private readonly logger = new Logger(IchimokuScannerService.name);

  constructor(
    private readonly klineService: MultiExchangeKlineService,
    private readonly futuresSymbolsService: FuturesSymbolsService,
  ) {}

  async scan(params: IchimokuScanParams = {}): Promise<IchimokuScanResult> {
    const targetSymbols = await this.resolveTargetSymbols(params.symbols, params.limit);
    const interval = params.interval ?? '1d';
    const exchange = (params.exchange as SupportedExchange) ?? 'binance';

    this.logger.log(
      `Ichimoku scan (price above cloud) started for ${targetSymbols.length} symbols (${interval}, exchange=${exchange})`,
    );

    const concurrency = 5;
    const matches: IchimokuSignal[] = [];

    for (let i = 0; i < targetSymbols.length; i += concurrency) {
      const batch = targetSymbols.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map((sym) => this.evaluateSymbol(sym, interval, exchange)),
      );
      for (const signal of results) {
        if (signal) matches.push(signal);
      }
    }

    matches.sort((a, b) => b.price - a.price);

    return {
      timestamp: new Date().toISOString(),
      interval,
      exchange,
      totalScanned: targetSymbols.length,
      matches,
    };
  }

  async scanNearCloudBottom(
    params: IchimokuNearCloudBottomScanParams = {},
  ): Promise<IchimokuNearCloudBottomScanResult> {
    const targetSymbols = await this.resolveTargetSymbols(params.symbols, params.limit);
    const interval = params.interval ?? '1d';
    const exchange = (params.exchange as SupportedExchange) ?? 'binance';
    const thresholdPct = this.normalizeThreshold(params.thresholdPct);

    this.logger.log(
      `Ichimoku near-cloud-bottom scan started for ${targetSymbols.length} symbols (${interval}, exchange=${exchange}, threshold=${thresholdPct}%)`,
    );

    const concurrency = 5;
    const matches: IchimokuNearCloudBottomSignal[] = [];

    for (let i = 0; i < targetSymbols.length; i += concurrency) {
      const batch = targetSymbols.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map((sym) => this.evaluateNearCloudBottom(sym, interval, exchange, thresholdPct)),
      );
      for (const signal of results) {
        if (signal) matches.push(signal);
      }
    }

    matches.sort(
      (a, b) =>
        Math.abs(a.distanceToCloudBottomPct) - Math.abs(b.distanceToCloudBottomPct),
    );

    return {
      timestamp: new Date().toISOString(),
      interval,
      exchange,
      thresholdPct,
      totalScanned: targetSymbols.length,
      matches,
    };
  }

  async evaluateSymbol(
    symbol: string,
    interval: string,
    exchange: SupportedExchange,
  ): Promise<IchimokuSignal | null> {
    try {
      const candles = await this.loadCandles(symbol, interval, exchange);
      if (!candles) return null;
      return this.computeIchimoku(symbol, candles);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Ichimoku evaluation failed for ${symbol}`, msg);
      return null;
    }
  }

  async evaluateNearCloudBottom(
    symbol: string,
    interval: string,
    exchange: SupportedExchange,
    thresholdPct: number,
  ): Promise<IchimokuNearCloudBottomSignal | null> {
    try {
      const candles = await this.loadCandles(symbol, interval, exchange);
      if (!candles) return null;
      return this.computeNearCloudBottom(symbol, candles, thresholdPct);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Ichimoku near-cloud-bottom evaluation failed for ${symbol}`, msg);
      return null;
    }
  }

  private async loadCandles(
    symbol: string,
    interval: string,
    exchange: SupportedExchange,
  ): Promise<{ openTime: number; open: number; high: number; low: number; close: number }[] | null> {
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

    return klines.map((k) => ({
      openTime: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
    }));
  }

  private computeIchimoku(
    symbol: string,
    candles: {
      openTime: number;
      open: number;
      high: number;
      low: number;
      close: number;
    }[],
  ): IchimokuSignal | null {
    const snapshot = this.computeSnapshot(candles);
    if (!snapshot) return null;

    const { price, tenkan, kijun, spanA, spanB, cloudTop, cloudBottom } = snapshot;
    if (price <= cloudTop) return null;

    return {
      symbol,
      price,
      tenkan,
      kijun,
      spanA,
      spanB,
      chikou: price,
      signal: 'BUY',
      conditions: {
        priceAboveCloud: true,
        tenkanAboveKijun: tenkan > kijun,
        chikouAbovePrice26: price > candles[candles.length - 27].close,
        chikouClean: true,
        breakoutCandleClosed: true,
      },
      cloudTop,
      cloudBottom,
    };
  }

  private computeNearCloudBottom(
    symbol: string,
    candles: {
      openTime: number;
      open: number;
      high: number;
      low: number;
      close: number;
    }[],
    thresholdPct: number,
  ): IchimokuNearCloudBottomSignal | null {
    const snapshot = this.computeSnapshot(candles);
    if (!snapshot) return null;

    const { price, tenkan, kijun, spanA, spanB, cloudTop, cloudBottom } = snapshot;
    if (cloudBottom === 0) return null;

    const distanceToCloudBottomPct = ((price - cloudBottom) / cloudBottom) * 100;
    if (Math.abs(distanceToCloudBottomPct) > thresholdPct) return null;

    const position =
      price > cloudTop
        ? 'ABOVE_CLOUD'
        : price < cloudBottom
          ? 'BELOW_CLOUD'
          : 'INSIDE_CLOUD';

    return {
      symbol,
      price,
      tenkan,
      kijun,
      spanA,
      spanB,
      cloudTop,
      cloudBottom,
      distanceToCloudBottomPct,
      position,
      signal: 'NEAR_CLOUD_BOTTOM',
    };
  }

  private computeSnapshot(
    candles: {
      openTime: number;
      open: number;
      high: number;
      low: number;
      close: number;
    }[],
  ): IchimokuSnapshot | null {
    const n = candles.length;
    const last = n - 1;
    if (last < MIN_CANDLES - 1) return null;

    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);

    const tenkan = this.computeTenkanKijun(highs, lows, 8);
    const kijun = this.computeTenkanKijun(highs, lows, 25);

    const cloudIndex = last - 26;
    if (cloudIndex < 25) return null;

    const spanA = (tenkan[cloudIndex] + kijun[cloudIndex]) / 2;
    const spanBStart = cloudIndex - 51;
    if (spanBStart < 0) return null;

    const spanB =
      (this.highest(highs, spanBStart, cloudIndex) +
        this.lowest(lows, spanBStart, cloudIndex)) /
      2;

    return {
      price: closes[last],
      tenkan: tenkan[last],
      kijun: kijun[last],
      spanA,
      spanB,
      cloudTop: Math.max(spanA, spanB),
      cloudBottom: Math.min(spanA, spanB),
    };
  }

  private normalizeThreshold(value: number | string | undefined): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_NEAR_CLOUD_THRESHOLD_PCT;
    return Math.min(parsed, 20);
  }

  private async resolveTargetSymbols(
    symbols: string | undefined,
    limit: number | string | undefined,
  ): Promise<string[]> {
    let resolved: string[];

    if (symbols) {
      resolved = symbols
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    } else {
      resolved = await this.getStoredUsdtSymbols();
    }

    const parsedLimit = Number(limit);
    return parsedLimit > 0 ? resolved.slice(0, parsedLimit) : resolved;
  }

  private computeTenkanKijun(
    highs: number[],
    lows: number[],
    lookback: number,
  ): number[] {
    const n = highs.length;
    const result: number[] = Array.from({ length: n }, () => NaN);

    for (let i = lookback; i < n; i++) {
      const hh = this.highest(highs, i - lookback, i);
      const ll = this.lowest(lows, i - lookback, i);
      result[i] = (hh + ll) / 2;
    }

    return result;
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
