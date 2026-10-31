import { Injectable, Logger } from '@nestjs/common';
import { BinanceService } from 'src/binance/binance.service';
import { FuturesSymbolsService } from 'src/futures-symbols/futures-symbols.service';
import type {
  IchimokuLaggingSpanScanParams,
  IchimokuLaggingSpanScanResult,
  IchimokuLaggingSpanSignal,
} from './types/ichimoku-lagging-span.types';

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
export class IchimokuLaggingSpanService {
  private readonly logger = new Logger(IchimokuLaggingSpanService.name);

  constructor(
    private readonly binanceService: BinanceService,
    private readonly futuresSymbolsService: FuturesSymbolsService,
  ) {}

  async scan(
    params: IchimokuLaggingSpanScanParams = {},
  ): Promise<IchimokuLaggingSpanScanResult> {
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
      `Ichimoku lagging-span scan started for ${targetSymbols.length} symbols (${interval})`,
    );

    const concurrency = 5;
    const matches: IchimokuLaggingSpanSignal[] = [];

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
  ): Promise<IchimokuLaggingSpanSignal | null> {
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

      const signal = this.computeLaggingSpanExit(symbol, candles);
      return signal;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Ichimoku lagging-span evaluation failed for ${symbol}`,
        msg,
      );
      return null;
    }
  }

  private computeLaggingSpanExit(
    symbol: string,
    candles: {
      openTime: number;
      open: number;
      high: number;
      low: number;
      close: number;
    }[],
  ): IchimokuLaggingSpanSignal | null {
    const n = candles.length;
    if (n < MIN_CANDLES) return null;

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const openTimes = candles.map((c) => c.openTime);

    // Chikou Span plotted at chart position i has value close[i + 26].
    // Valid chart positions: i where i + 26 <= n - 1  =>  i <= n - 27.
    const lastChikouPos = n - 27;
    if (lastChikouPos < 0) return null;

    // Current bullish check: Chikou value at last position = closes[n - 1]
    // vs price at that chart position = highs[lastChikouPos].
    const currentChikouValue = closes[n - 1];
    const currentPriceHigh = highs[lastChikouPos];
    const isCurrentlyBullish = currentChikouValue > currentPriceHigh;

    if (!isCurrentlyBullish) return null;

    // Find the most recent upward crossover across the whole valid range.
    // Crossover at position j: Chikou[j] > high[j] AND Chikou[j-1] <= high[j-1]
    // Chikou[j] = closes[j + 26]; Chikou[j-1] = closes[j + 25]
    let mostRecentCross: {
      j: number;
      barsAgo: number;
      chikouValue: number;
      crossPriceHigh: number;
      crossTime: number;
    } | null = null;

    for (let j = 1; j <= lastChikouPos; j++) {
      const chikouAboveNow = closes[j + 26] > highs[j];
      const chikouAboveBefore = closes[j + 25] > highs[j - 1];

      if (chikouAboveNow && !chikouAboveBefore) {
        mostRecentCross = {
          j,
          barsAgo: lastChikouPos - j,
          chikouValue: closes[j + 26],
          crossPriceHigh: highs[j],
          crossTime: openTimes[j + 26],
        };
      }
    }

    return {
      symbol,
      price: closes[n - 1],
      chikouValue: currentChikouValue,
      crossCandleIndex: mostRecentCross?.j ?? lastChikouPos,
      crossTime: mostRecentCross?.crossTime ?? openTimes[n - 1],
      crossPriceHigh: mostRecentCross?.crossPriceHigh ?? currentPriceHigh,
      barsAgo: mostRecentCross?.barsAgo ?? 0,
      signal: 'BUY',
    };
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
