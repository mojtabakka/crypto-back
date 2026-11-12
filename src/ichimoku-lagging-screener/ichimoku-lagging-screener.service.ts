import { Injectable, Logger } from '@nestjs/common';
import { MultiExchangeKlineService } from 'src/exchange/multi-exchange-kline.service';
import { FuturesSymbolsService } from 'src/futures-symbols/futures-symbols.service';
import { VolumeMarketCapService } from 'src/volume-marketcap/volume-marketcap.service';
import { IchimokuCombinedService } from 'src/ichimoku-combined/ichimoku-combined.service';
import { MarketSignalService } from 'src/market-signal/market-signal.service';
import { SupportedExchange } from 'src/exchange/multi-exchange-kline.service';
import type {
  FourFormulaSignal,
  IchimokuLaggingScanParams,
  IchimokuLaggingScanResult,
  IchimokuLaggingSignal,
} from './types/ichimoku-lagging-screener.types';

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;
const MIN_VOLUME_RATIO = 1.2;
const MIN_CANDLES = 100;

const LOOKBACK_DAYS = 200;

const INTERVAL_LOOKBACK_DAYS: Record<string, number> = {
  '1m': 3,
  '3m': 5,
  '5m': 10,
  '15m': 20,
  '1d': 200,
  '3d': 250,
  '1w': 300,
};

interface FuturesSymbolEntity {
  symbol: string;
  quoteAsset: string;
  status: string;
  contractType: string;
}

interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

@Injectable()
export class IchimokuLaggingScreenerService {
  private readonly logger = new Logger(IchimokuLaggingScreenerService.name);

  constructor(
    private readonly ichimokuService: IchimokuCombinedService,
    private readonly marketSignalService: MarketSignalService,
    private readonly klineService: MultiExchangeKlineService,
    private readonly futuresSymbolsService: FuturesSymbolsService,
    private readonly volumeMarketCapService: VolumeMarketCapService,
  ) {}

  async scan(
    params: IchimokuLaggingScanParams = {},
  ): Promise<IchimokuLaggingScanResult> {
    let symbols: string[];

    if (params.symbols) {
      symbols = params.symbols
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    } else {
      symbols = await this.getStoredUsdtSymbols();
    }

    const limitNum = params.limit ? Number(params.limit) : 0;
    const targetSymbols = limitNum > 0 ? symbols.slice(0, limitNum) : symbols;

    const interval = params.interval ?? '1d';
    const exchange: SupportedExchange = (params.exchange ?? 'binance') as SupportedExchange;

    this.logger.log(
      `Ichimoku Lagging Span scanner started for ${targetSymbols.length} symbols (${interval}, exchange=${exchange})`,
    );

    const concurrency = 5;
    const matches: IchimokuLaggingSignal[] = [];

    for (let i = 0; i < targetSymbols.length; i += concurrency) {
      const batch = targetSymbols.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map((sym) => this.evaluateSymbol(sym, interval, exchange)),
      );
      for (const signal of results) {
        if (signal) matches.push(signal);
      }
    }

    matches.sort((a, b) => a.barsAgo - b.barsAgo);

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
  ): Promise<IchimokuLaggingSignal | null> {
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
        volume: parseFloat(k[5]),
      }));

      const result = this.computeLaggingSpan(symbol, candles);
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Ichimoku lagging-span evaluation failed for ${symbol} on ${exchange}`,
        msg,
      );
      return null;
    }
  }

  private computeLaggingSpan(
    symbol: string,
    candles: Candle[],
  ): IchimokuLaggingSignal | null {
    const n = candles.length;
    if (n < MIN_CANDLES) return null;

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    const last = n - 1;
    const price = closes[last];

    const tenkan = this.computeTenkanKijun(highs, lows, 9);
    const kijun = this.computeTenkanKijun(highs, lows, 26);

    const cloudIndex = last - 26;
    if (cloudIndex < 25) return null;

    const spanA = (tenkan[cloudIndex] + kijun[cloudIndex]) / 2;
    const spanBStart = cloudIndex - 51;
    if (spanBStart < 0) return null;

    const spanB =
      (this.highest(highs, spanBStart, cloudIndex) +
        this.lowest(lows, spanBStart, cloudIndex)) /
      2;

    const cloudTop = Math.max(spanA, spanB);
    const cloudBottom = Math.min(spanA, spanB);

    const currentChikouValue = closes[last];
    const currentPriceHigh = highs[cloudIndex];

    const isBullish = currentChikouValue > currentPriceHigh;

    if (!isBullish) return null;

    let barsAgo = 0;
    for (let i = cloudIndex - 1; i >= 0; i--) {
      if (closes[i + 26] > highs[i]) {
        barsAgo = cloudIndex - i;
        break;
      }
    }

    if (barsAgo === 0) return null;

    return {
      symbol,
      price,
      tenkan: tenkan[candles.length - 1],
      kijun: kijun[candles.length - 1],
      spanA,
      spanB,
      cloudTop,
      cloudBottom,
      chikouValue: currentChikouValue,
      breakoutLevel: cloudBottom,
      barsAgo,
      signal: 'BUY',
      score: 0,
      volumeRatio: 0,
      marketCap: 0,
      volume24h: 0,
      targetPrice1: cloudBottom * 1.05,
      targetPrice2: price * 1.1,
      stopLoss: cloudBottom * 0.98,
      targetProfit1Pct: ((cloudBottom * 1.05 - price) / price) * 100,
      targetProfit2Pct: ((cloudBottom * 1.15 - price) / price) * 100,
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

  private async getStoredUsdtSymbols(): Promise<string[]> {
    const stored = await this.futuresSymbolsService.getStoredSymbols();
    const symbols: string[] = [];
    for (const s of stored.symbols as FuturesSymbolEntity[]) {
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
