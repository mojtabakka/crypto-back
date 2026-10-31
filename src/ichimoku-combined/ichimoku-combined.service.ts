import { Injectable, Logger } from '@nestjs/common';
import { BinanceService } from 'src/binance/binance.service';
import { FuturesSymbolsService } from 'src/futures-symbols/futures-symbols.service';
import type {
  IchimokuCombinedScanParams,
  IchimokuCombinedScanResult,
  IchimokuCombinedSignal,
} from './types/ichimoku-combined.types';

const LOOKBACK_DAYS = 200;
const MIN_CANDLES = 100;

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
export class IchimokuCombinedService {
  private readonly logger = new Logger(IchimokuCombinedService.name);

  constructor(
    private readonly binanceService: BinanceService,
    private readonly futuresSymbolsService: FuturesSymbolsService,
  ) {}

  async scan(
    params: IchimokuCombinedScanParams = {},
  ): Promise<IchimokuCombinedScanResult> {
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

    this.logger.log(
      `Ichimoku combined scan started for ${targetSymbols.length} symbols (${interval})`,
    );

    const concurrency = 5;
    const matches: IchimokuCombinedSignal[] = [];

    for (let i = 0; i < targetSymbols.length; i += concurrency) {
      const batch = targetSymbols.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map((sym) => this.evaluateSymbol(sym, interval)),
      );
      for (const signal of results) {
        if (signal) matches.push(signal);
      }
    }

    matches.sort((a, b) => a.barsAgo - b.barsAgo);

    return {
      timestamp: new Date().toISOString(),
      interval,
      totalScanned: targetSymbols.length,
      matches,
    };
  }

  async evaluateSymbol(
    symbol: string,
    interval: string,
  ): Promise<IchimokuCombinedSignal | null> {
    try {
      const now = Date.now();
      const lookbackDays = INTERVAL_LOOKBACK_DAYS[interval] ?? LOOKBACK_DAYS;
      const startTime = now - lookbackDays * 24 * 60 * 60 * 1000;

      const klines = await this.binanceService.getFuturesKlines(
        symbol,
        interval,
        startTime,
        now,
        1000,
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

      const signal = this.computeCombined(symbol, candles);
      return signal;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Ichimoku combined evaluation failed for ${symbol}`,
        msg,
      );
      return null;
    }
  }

  private computeCombined(
    symbol: string,
    candles: {
      openTime: number;
      open: number;
      high: number;
      low: number;
      close: number;
    }[],
  ): IchimokuCombinedSignal | null {
    const n = candles.length;
    if (n < MIN_CANDLES) return null;

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    const last = n - 1;

    // ============ Ichimoku Cloud ============
    // Tenkan-sen (9): (max high + min low) / 2 over last 9
    const tenkan = this.computeTenkanKijun(highs, lows, 8);
    // Kijun-sen (26): over last 26
    const kijun = this.computeTenkanKijun(highs, lows, 25);

    // Cloud at current candle comes from values plotted 26 periods ago
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

    // Condition 1: Price above cloud
    const priceAboveCloud = price > cloudTop;
    if (!priceAboveCloud) return null;

    // ============ Lagging Span (Chikou) bullish breakout ============
    // Chikou plotted at chart position i = close[i + 26]
    const lastChikouPos = n - 27;
    if (lastChikouPos < 0) return null;

    const currentChikouValue = closes[last];
    const currentPriceHigh = highs[lastChikouPos];
    const isCurrentlyBullish = currentChikouValue > currentPriceHigh;
    if (!isCurrentlyBullish) return null;

    // Find most recent upward crossover
    let mostRecentCross: {
      barsAgo: number;
      chikouValue: number;
      crossPriceHigh: number;
    } | null = null;

    for (let j = 1; j <= lastChikouPos; j++) {
      const aboveNow = closes[j + 26] > highs[j];
      const aboveBefore = closes[j + 25] > highs[j - 1];
      if (aboveNow && !aboveBefore) {
        mostRecentCross = {
          barsAgo: lastChikouPos - j,
          chikouValue: closes[j + 26],
          crossPriceHigh: highs[j],
        };
      }
    }

    return {
      symbol,
      price,
      tenkan: tenkan[last],
      kijun: kijun[last],
      spanA,
      spanB,
      cloudTop,
      cloudBottom,
      chikouValue: currentChikouValue,
      crossPriceHigh: mostRecentCross?.crossPriceHigh ?? currentPriceHigh,
      barsAgo: mostRecentCross?.barsAgo ?? 0,
      signal: 'BUY',
    };
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
