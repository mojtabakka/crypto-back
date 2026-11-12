import { Injectable, Logger } from '@nestjs/common';
import { MultiExchangeKlineService } from 'src/exchange/multi-exchange-kline.service';
import { FuturesSymbolsService } from 'src/futures-symbols/futures-symbols.service';
import type {
  IchimokuBullishConditionResult,
  IchimokuBullishScanParams,
  IchimokuBullishScanResult,
  IchimokuBullishSignal,
} from './types/ichimoku-bullish-scan.types';

type SupportedExchange = 'binance' | 'bybit' | 'mexc' | 'toobit';

const MIN_CANDLES = 100;
const DEFAULT_LOOKBACK_BARS = 20;
const DEFAULT_MIN_VOLUME_RATIO = 1.2;
const DEFAULT_PULLBACK_MAX_PCT = 5;
const VOLUME_LOOKBACK_BARS = 20;
const MIN_SCORE = 5;

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

interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CloudPoint {
  spanA: number;
  spanB: number;
  cloudTop: number;
  cloudBottom: number;
}

@Injectable()
export class IchimokuBullishScanService {
  private readonly logger = new Logger(IchimokuBullishScanService.name);

  constructor(
    private readonly klineService: MultiExchangeKlineService,
    private readonly futuresSymbolsService: FuturesSymbolsService,
  ) {}

  async scan(params: IchimokuBullishScanParams = {}): Promise<IchimokuBullishScanResult> {
    const interval = params.interval ?? '1d';
    const exchange = (params.exchange as SupportedExchange) ?? 'binance';
    const lookbackBars = Math.round(this.normalizePositive(params.lookbackBars, DEFAULT_LOOKBACK_BARS, 120));
    const minVolumeRatio = this.normalizePositive(params.minVolumeRatio, DEFAULT_MIN_VOLUME_RATIO, 10);

    let symbols: string[];
    if (params.symbols) {
      symbols = params.symbols.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    } else {
      symbols = await this.getStoredUsdtSymbols();
    }
    const limit = params.limit ? Number(params.limit) : 0;
    if (limit > 0) symbols = symbols.slice(0, limit);

    this.logger.log(
      `Ichimoku bullish scan started for ${symbols.length} symbols (${interval}, exchange=${exchange}, lookback=${lookbackBars}, minVolRatio=${minVolumeRatio})`,
    );

    const concurrency = 5;
    const matches: IchimokuBullishSignal[] = [];

    for (let i = 0; i < symbols.length; i += concurrency) {
      const batch = symbols.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map((sym) =>
          this.evaluateSymbol(sym, interval, exchange, lookbackBars, minVolumeRatio),
        ),
      );
      for (const signal of results) {
        if (signal) matches.push(signal);
      }
    }

    matches.sort((a, b) => b.score - a.score || b.volumeRatio - a.volumeRatio);

    return {
      timestamp: new Date().toISOString(),
      interval,
      exchange,
      totalScanned: symbols.length,
      matches,
    };
  }

  private async evaluateSymbol(
    symbol: string,
    interval: string,
    exchange: SupportedExchange,
    lookbackBars: number,
    minVolumeRatio: number,
  ): Promise<IchimokuBullishSignal | null> {
    try {
      const candles = await this.loadCandles(symbol, interval, exchange);
      if (!candles) return null;
      return this.computeBullish(symbol, candles, lookbackBars, minVolumeRatio);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Ichimoku bullish evaluation failed for ${symbol}`, msg);
      return null;
    }
  }

  private async loadCandles(
    symbol: string,
    interval: string,
    exchange: SupportedExchange,
  ): Promise<Candle[] | null> {
    const now = Date.now();
    const lookbackDays = INTERVAL_LOOKBACK_DAYS[interval] ?? 200;
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
      volume: parseFloat(k[5]),
    }));
  }

  private computeBullish(
    symbol: string,
    candles: Candle[],
    lookbackBars: number,
    minVolumeRatio: number,
  ): IchimokuBullishSignal | null {
    const n = candles.length;
    const last = n - 1;
    if (last < MIN_CANDLES - 1) return null;

    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);
    const volumes = candles.map((c) => c.volume);

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

    const price = closes[last];
    const cloudTop = Math.max(spanA, spanB);
    const cloudBottom = Math.min(spanA, spanB);

    // 1. Price closed above cloud
    const priceAboveCloud = price > cloudTop;

    // 2. Chikou Span above price 26 periods ago
    const chikouValue = price;
    const chikouPrice26Ago = closes[last - 26];
    const chikouAbovePrice26 = chikouValue > chikouPrice26Ago;

    // 3. Conversion Line above Baseline
    const tenkanAboveKijun = tenkan[last] > kijun[last];

    // 4. Future cloud is green (Span A above Span B)
    const cloudGreen = spanA > spanB;

    // 5. Volume increased at breakout
    const avgVolume = this.average(volumes, last - VOLUME_LOOKBACK_BARS, last - 1);
    const volumeRatio = avgVolume > 0 ? volumes[last] / avgVolume : 0;
    const volumeIncreased = volumeRatio >= minVolumeRatio;

    // 6. Price after pullback supported (near cloud bottom, above it)
    const cloudBottomZero = cloudBottom === 0;
    const distanceToCloudBottomPct = cloudBottomZero
      ? 0
      : ((price - cloudBottom) / cloudBottom) * 100;
    const pullbackSupported =
      !cloudBottomZero && price >= cloudBottom && distanceToCloudBottomPct <= DEFAULT_PULLBACK_MAX_PCT;

    // 7. HH/HL structure
    const hhLhStructure = this.checkHHHL(closes, highs, lows, lookbackBars);

    const conditions: IchimokuBullishConditionResult = {
      priceAboveCloud,
      chikouAbovePrice26,
      tenkanAboveKijun,
      cloudGreen,
      volumeIncreased,
      pullbackSupported,
      hhLhStructure,
    };

    const score = Object.values(conditions).filter(Boolean).length;

    if (score < MIN_SCORE) return null;

    return {
      symbol,
      price,
      tenkan: tenkan[last],
      kijun: kijun[last],
      spanA,
      spanB,
      cloudTop,
      cloudBottom,
      chikouValue,
      chikouPrice26Ago,
      volume: volumes[last],
      avgVolume,
      volumeRatio,
      hhLhStructure,
      conditions,
      score,
      signal: 'BULLISH',
    };
  }

  private checkHHHL(
    closes: number[],
    highs: number[],
    lows: number[],
    lookbackBars: number,
  ): boolean {
    const n = closes.length;
    if (n < lookbackBars + 5) return false;

    const half = Math.floor(lookbackBars / 2);
    const firstStart = n - lookbackBars;
    const firstEnd = firstStart + half - 1;
    const secondStart = n - half;
    const secondEnd = n - 1;

    const firstHigh = this.highest(highs, firstStart, firstEnd);
    const secondHigh = this.highest(highs, secondStart, secondEnd);
    const firstLow = this.lowest(lows, firstStart, firstEnd);
    const secondLow = this.lowest(lows, secondStart, secondEnd);

    return secondHigh > firstHigh && secondLow > firstLow;
  }

  private computeTenkanKijun(highs: number[], lows: number[], lookback: number): number[] {
    const n = highs.length;
    const result: number[] = Array.from({ length: n }, () => NaN);

    for (let i = lookback; i < n; i++) {
      result[i] =
        (this.highest(highs, i - lookback, i) + this.lowest(lows, i - lookback, i)) / 2;
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

  private average(arr: number[], start: number, end: number): number {
    if (start > end || start < 0) return 0;
    const realEnd = Math.min(end, arr.length - 1);
    let sum = 0;
    let count = 0;
    for (let i = start; i <= realEnd; i++) {
      sum += arr[i];
      count++;
    }
    return count > 0 ? sum / count : 0;
  }

  private normalizePositive(
    value: number | string | undefined,
    fallback: number,
    max: number,
  ): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, max);
  }

  private async getStoredUsdtSymbols(): Promise<string[]> {
    const stored = await this.futuresSymbolsService.getStoredSymbols();
    const symbols: string[] = [];
    for (const s of stored.symbols as any[]) {
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
