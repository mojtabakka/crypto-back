import { Injectable, Logger } from '@nestjs/common';
import { MultiExchangeKlineService } from 'src/exchange/multi-exchange-kline.service';
import { FuturesSymbolsService } from 'src/futures-symbols/futures-symbols.service';
import { VolumeMarketCapService } from 'src/volume-marketcap/volume-marketcap.service';
import type {
  IchimokuTkCrossScanParams,
  IchimokuTkCrossScanResult,
  IchimokuTkCrossSignal,
} from './types/ichimoku-tk-cross.types';

type SupportedExchange = 'binance' | 'bybit' | 'mexc' | 'toobit';

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
export class IchimokuTkCrossService {
  private readonly logger = new Logger(IchimokuTkCrossService.name);

  constructor(
    private readonly klineService: MultiExchangeKlineService,
    private readonly futuresSymbolsService: FuturesSymbolsService,
    private readonly volumeMarketCapService: VolumeMarketCapService,
  ) {}

  async scan(
    params: IchimokuTkCrossScanParams = {},
  ): Promise<IchimokuTkCrossScanResult> {
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
      `Ichimoku TK Cross scan started for ${targetSymbols.length} symbols (${interval}, exchange=${exchange})`,
    );

    const marketData =
      await this.volumeMarketCapService.getCoinMarketMap(exchange);

    const concurrency = 5;
    const matches: IchimokuTkCrossSignal[] = [];

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
  ): Promise<IchimokuTkCrossSignal | null> {
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

      const result = this.computeTkCross(symbol, candles, marketData);
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Ichimoku TK Cross evaluation failed for ${symbol} on ${exchange}`,
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

  private computeTkCross(
    symbol: string,
    candles: {
      openTime: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }[],
    marketData: Map<string, { marketCap: number; volume24h: number }>,
  ): IchimokuTkCrossSignal | null {
    const n = candles.length;
    if (n < MIN_CANDLES) return null;

      const closes = candles.map((c) => c.close);
      const highs = candles.map((c) => c.high);
      const lows = candles.map((c) => c.low);

    const last = n - 1;

    // Tenkan-sen (Conversion Line): (9-period high + 9-period low) / 2
    const tenkan = this.computeTenkanKijun(highs, lows, 9);
    // Kijun-sen (Base Line): (26-period high + 26-period low) / 2
    const kijun = this.computeTenkanKijun(highs, lows, 26);

    const lastTenkan = tenkan[last];
    const lastKijun = kijun[last];
    const prevTenkan = tenkan[last - 1];
    const prevKijun = kijun[last - 1];

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

    const priceAboveCloud = price > cloudTop;

    // Detect TK Cross
    let crossType: 'bullish' | 'bearish' | null = null;
    let barsSinceCross = 0;

    // Bullish cross: Tenkan crosses above Kijun
    if (prevTenkan <= prevKijun && lastTenkan > lastKijun) {
      crossType = 'bullish';
      barsSinceCross = 0;
    }
    // Bearish cross: Tenkan crosses below Kijun
    else if (prevTenkan >= prevKijun && lastTenkan < lastKijun) {
      crossType = 'bearish';
      barsSinceCross = 0;
    } else {
      // Check if cross happened recently
      for (let i = last - 1; i >= Math.max(0, last - 10); i--) {
        const prevTenkan_i = tenkan[i - 1] ?? tenkan[0];
        const prevKijun_i = kijun[i - 1] ?? kijun[0];
        const tenkan_i = tenkan[i];
        const kijun_i = kijun[i];

        if (prevTenkan_i <= prevKijun_i && tenkan_i > kijun_i) {
          crossType = 'bullish';
          barsSinceCross = last - i;
          break;
        } else if (prevTenkan_i >= prevKijun_i && tenkan_i < kijun_i) {
          crossType = 'bearish';
          barsSinceCross = last - i;
          break;
        }
      }
    }

    if (!crossType) return null;

    // Score calculation
    let score = 0;
    // Closer to cross = higher score
    score += Math.max(0, 10 - barsSinceCross) * 5;
    // Price above cloud adds score for bullish
    if (crossType === 'bullish' && priceAboveCloud) {
      score += 20;
    } else if (crossType === 'bearish' && !priceAboveCloud) {
      score += 20;
    }
    // Volume confirmation
    const volumeRatio = this.calculateVolumeRatio(candles);
    score += Math.min(volumeRatio * 10, 30);

    const marketInfo = marketData.get(symbol) ?? { marketCap: 0, volume24h: 0 };

    return {
      symbol,
      price,
      tenkan: lastTenkan,
      kijun: lastKijun,
      spanA,
      spanB,
      cloudTop,
      cloudBottom,
      tenkanPrev: prevTenkan,
      kijunPrev: prevKijun,
      crossType,
      barsSinceCross,
      priceAboveCloud,
      score,
      volumeRatio,
      marketCap: marketInfo.marketCap,
      volume24h: marketInfo.volume24h,
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

  private calculateVolumeRatio(
    candles: {
      openTime: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }[],
  ): number {
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
