import { Injectable, Logger } from '@nestjs/common';
import { MultiExchangeKlineService } from 'src/exchange/multi-exchange-kline.service';
import { FuturesSymbolsService } from 'src/futures-symbols/futures-symbols.service';
import { VolumeMarketCapService } from 'src/volume-marketcap/volume-marketcap.service';
import type {
  IchimokuBreakoutScanParams,
  IchimokuBreakoutScanResult,
  IchimokuBreakoutSignal,
} from './types/ichimoku-breakout.types';

type SupportedExchange = 'binance' | 'bybit' | 'mexc' | 'toobit';

const LOOKBACK_DAYS = 200;
const MIN_CANDLES = 100;

const INTERVAL_LOOKBACK_DAYS: Record<string, number> = {
  '1d': 200,
  '4h': 100,
  '1w': 300,
};

interface FuturesSymbol {
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
export class IchimokuBreakoutService {
  private readonly logger = new Logger(IchimokuBreakoutService.name);

  constructor(
    private readonly klineService: MultiExchangeKlineService,
    private readonly futuresSymbolsService: FuturesSymbolsService,
    private readonly volumeMarketCapService: VolumeMarketCapService,
  ) {}

  async scan(
    params: IchimokuBreakoutScanParams = {},
  ): Promise<IchimokuBreakoutScanResult> {
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
      `Ichimoku Breakout scan started for ${targetSymbols.length} symbols (${interval}, exchange=${exchange})`,
    );

    const marketData =
      await this.volumeMarketCapService.getCoinMarketMap(exchange);

    const concurrency = 5;
    const matches: IchimokuBreakoutSignal[] = [];

    for (let i = 0; i < targetSymbols.length; i += concurrency) {
      const batch = targetSymbols.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map((sym) =>
          this.evaluateSymbol(sym, interval, exchange, marketData),
        ),
      );
      for (const signal of results) {
        if (signal) matches.push(signal);
      }
    }

    matches.sort((a, b) => b.score - a.score);

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
    marketData: Map<string, { marketCap: number; volume24h: number }>,
  ): Promise<IchimokuBreakoutSignal | null> {
    try {
      const now = Date.now();
      const lookbackDays = INTERVAL_LOOKBACK_DAYS[interval] ?? LOOKBACK_DAYS;
      const startTime = now - lookbackDays * 24 * 60 * 60 * 1000;

      const klines = await this.fetchFuturesKlines(
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

      const result = await this.computeBreakout(
        symbol,
        candles,
        marketData,
        interval,
        exchange,
      );
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Ichimoku Breakout evaluation failed for ${symbol} on ${exchange}`,
        msg,
      );
      return null;
    }
  }

  private async fetchFuturesKlines(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
    limit: number,
    exchange: SupportedExchange,
  ) {
    return this.klineService.getFuturesKlines(
      symbol,
      interval,
      startTime,
      endTime,
      limit,
      exchange,
    );
  }

  private async computeBreakout(
    symbol: string,
    candles: Candle[],
    marketData: Map<string, { marketCap: number; volume24h: number }>,
    interval: string,
    exchange: SupportedExchange,
  ): Promise<IchimokuBreakoutSignal | null> {
    const n = candles.length;
    if (n < MIN_CANDLES) return null;

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    const last = n - 1;

    // ============ Ichimoku Cloud ============
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

    // Check if price broke above cloud recently
    const breakoutLookback = 5;
    let daysAboveCloud = 0;

    for (let i = last; i >= Math.max(0, last - breakoutLookback); i--) {
      const cloudIdx = i - 26;
      if (cloudIdx < 25) continue;

      const spanA_i = (tenkan[cloudIdx] + kijun[cloudIdx]) / 2;
      const spanBStart_i = cloudIdx - 51;
      if (spanBStart_i < 0) continue;

      const spanB_i =
        (this.highest(highs, spanBStart_i, cloudIdx) +
          this.lowest(lows, spanBStart_i, cloudIdx)) /
        2;
      const cloudTop_i = Math.max(spanA_i, spanB_i);

      if (closes[i] > cloudTop_i) {
        daysAboveCloud++;
      } else {
        break;
      }
    }

    if (daysAboveCloud === 0) return null;

    // ============ Multi-timeframe Breakout Check ============
    const monthlyBreakout = await this.checkBreakoutOnTimeframe(
      symbol,
      '1w',
      exchange,
    );
    const weeklyBreakout = await this.checkBreakoutOnTimeframe(
      symbol,
      '1d',
      exchange,
    );
    const dailyBreakout = await this.checkBreakoutOnTimeframe(
      symbol,
      '4h',
      exchange,
    );

    // Must have at least 2 timeframes showing breakout
    const breakoutCount =
      (monthlyBreakout ? 1 : 0) +
      (weeklyBreakout ? 1 : 0) +
      (dailyBreakout ? 1 : 0);

    if (breakoutCount < 2) return null;

    // Score calculation
    const priceDistanceScore = Math.max(
      0,
      100 - Math.abs((price - cloudTop) / cloudTop) * 100,
    );

    const volumeRatio = this.calculateVolumeRatio(candles);

    const score =
      priceDistanceScore * 0.4 +
      (daysAboveCloud > 5 ? 20 : daysAboveCloud * 4) +
      breakoutCount * 15 +
      Math.min(volumeRatio * 10, 30);

    const marketInfo = marketData.get(symbol) ?? { marketCap: 0, volume24h: 0 };

    return {
      symbol,
      price,
      tenkan: tenkan[last],
      kijun: kijun[last],
      spanA,
      spanB,
      cloudTop,
      cloudBottom,
      priceChangePct: 0,
      volumeChangePct: 0,
      daysAboveCloud,
      breakoutDate: null,
      monthlyBreakout,
      weeklyBreakout,
      dailyBreakout,
      score: Math.min(score, 100),
      volumeRatio,
      marketCap: marketInfo.marketCap,
      volume24h: marketInfo.volume24h,
      signal: 'BUY',
    };
  }

  private async checkBreakoutOnTimeframe(
    symbol: string,
    interval: string,
    exchange: SupportedExchange,
  ): Promise<boolean> {
    try {
      const now = Date.now();
      const lookbackDays = INTERVAL_LOOKBACK_DAYS[interval] ?? LOOKBACK_DAYS;
      const startTime = now - lookbackDays * 24 * 60 * 60 * 1000;

      const klines = await this.fetchFuturesKlines(
        symbol,
        interval,
        startTime,
        now,
        100,
        exchange,
      );

      if (!klines || klines.length < MIN_CANDLES) return false;

      const candles = klines.map((k) => ({
        openTime: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));

      return this.hasBreakout(candles);
    } catch (error) {
      this.logger.warn(
        `Breakout check failed for ${symbol} on ${interval}: ${error}`,
      );
      return false;
    }
  }

  private hasBreakout(candles: Candle[]): boolean {
    const n = candles.length;
    if (n < MIN_CANDLES) return false;

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    const last = n - 1;
    const tenkan = this.computeTenkanKijun(highs, lows, 8);
    const kijun = this.computeTenkanKijun(highs, lows, 25);

    const cloudIndex = last - 26;
    if (cloudIndex < 25) return false;

    const spanA = (tenkan[cloudIndex] + kijun[cloudIndex]) / 2;
    const spanBStart = cloudIndex - 51;
    if (spanBStart < 0) return false;

    const spanB =
      (this.highest(highs, spanBStart, cloudIndex) +
        this.lowest(lows, spanBStart, cloudIndex)) /
      2;

    const cloudTop = Math.max(spanA, spanB);
    const price = closes[last];

    return price > cloudTop;
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

  private calculateVolumeRatio(candles: Candle[]): number {
    const n = candles.length;
    if (n < 20) return 1;

    const currentVolume = candles[n - 1].volume;
    const avgVolume =
      candles.slice(n - 20, n - 1).reduce((sum, c) => sum + c.volume, 0) / 19;

    return avgVolume > 0 ? currentVolume / avgVolume : 1;
  }

  private async getStoredUsdtSymbols(): Promise<string[]> {
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
