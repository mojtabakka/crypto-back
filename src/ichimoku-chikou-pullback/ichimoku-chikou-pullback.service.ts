import { Injectable, Logger } from '@nestjs/common';
import { MultiExchangeKlineService } from 'src/exchange/multi-exchange-kline.service';
import { FuturesSymbolsService } from 'src/futures-symbols/futures-symbols.service';
import { VolumeMarketCapService } from 'src/volume-marketcap/volume-marketcap.service';
import { TelegramService } from 'src/notification/telegram.service';
import type {
  IchimokuChikouPullbackScanParams,
  IchimokuChikouPullbackScanResult,
  IchimokuChikouPullbackSignal,
} from './types/ichimoku-chikou-pullback.types';

type SupportedExchange = 'binance' | 'bybit' | 'mexc' | 'toobit';

const LOOKBACK_DAYS = 200;
const MIN_CANDLES = 100;
const PULLBACK_TOLERANCE_PCT = 0.05; // 5% tolerance around breakout level
const DEFAULT_EXCHANGE = 'binance';

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
export class IchimokuChikouPullbackService {
  private readonly logger = new Logger(IchimokuChikouPullbackService.name);

  constructor(
    private readonly klineService: MultiExchangeKlineService,
    private readonly futuresSymbolsService: FuturesSymbolsService,
    private readonly volumeMarketCapService: VolumeMarketCapService,
    private readonly telegram: TelegramService,
  ) {}

  async sendToTelegram(
    interval: string,
    chatId: string,
    exchange: string = DEFAULT_EXCHANGE,
  ): Promise<{ sent: boolean; matches: number; totalScanned: number }> {
    const result = await this.scan({
      interval,
      exchange,
    });

    const sent = await this.telegram.sendChikouPullbackSignals(
      chatId,
      interval,
      exchange,
      result,
    );

    return {
      sent,
      matches: result.matches.length,
      totalScanned: result.totalScanned,
    };
  }

  async scan(
    params: IchimokuChikouPullbackScanParams = {},
  ): Promise<IchimokuChikouPullbackScanResult> {
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
      `Ichimoku Chikou pullback scan started for ${targetSymbols.length} symbols (${interval}, exchange=${exchange})`,
    );

    const marketData =
      await this.volumeMarketCapService.getCoinMarketMap(exchange);

    const concurrency = 5;
    const matches: IchimokuChikouPullbackSignal[] = [];

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

    matches.sort((a, b) => a.barsSinceCross - b.barsSinceCross);

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
  ): Promise<IchimokuChikouPullbackSignal | null> {
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
      }));

      const signal = this.computePullback(symbol, candles, marketData);
      return signal;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Ichimoku Chikou pullback evaluation failed for ${symbol} on ${exchange}`,
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

  private computePullback(
    symbol: string,
    candles: {
      openTime: number;
      open: number;
      high: number;
      low: number;
      close: number;
    }[],
    marketData: Map<string, { marketCap: number; volume24h: number }>,
  ): IchimokuChikouPullbackSignal | null {
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

    // Condition 1: Price above cloud
    if (price <= cloudTop) return null;

    // ============ Chikou Span (Lagging Span) Breakout ============
    const lastChikouPos = n - 27;
    if (lastChikouPos < 0) return null;

    const currentChikouValue = closes[last];
    const currentPriceHigh = highs[lastChikouPos];

    // Chikou must be currently bullish (above the high 26 periods ago)
    if (currentChikouValue <= currentPriceHigh) return null;

    // Find most recent upward Chikou crossover
    let mostRecentCross: {
      barsAgo: number;
      chikouValue: number;
      crossPriceHigh: number;
      crossIndex: number;
    } | null = null;

    for (let j = 1; j <= lastChikouPos; j++) {
      const aboveNow = closes[j + 26] > highs[j];
      const aboveBefore = closes[j + 25] > highs[j - 1];
      if (aboveNow && !aboveBefore) {
        mostRecentCross = {
          barsAgo: lastChikouPos - j,
          chikouValue: closes[j + 26],
          crossPriceHigh: highs[j],
          crossIndex: j,
        };
      }
    }

    if (!mostRecentCross) return null;

    // ============ Pullback Detection ============
    // After the cross, price should have pulled back to near crossPriceHigh
    const breakoutLevel = mostRecentCross.crossPriceHigh;

    // Check if price pulled back to within tolerance of breakout level
    const tolerance = breakoutLevel * PULLBACK_TOLERANCE_PCT;
    const lowerBound = breakoutLevel - tolerance;
    const upperBound = breakoutLevel + tolerance;

    const priceInPullbackZone = price >= lowerBound && price <= upperBound;

    if (!priceInPullbackZone) return null;

    // Verify price actually went up after breakout (at least one close above breakout level)
    let priceWentUpAfterBreakout = false;
    for (let j = mostRecentCross.crossIndex + 27; j <= last; j++) {
      if (closes[j] > breakoutLevel * 1.005) {
        priceWentUpAfterBreakout = true;
        break;
      }
    }

    if (!priceWentUpAfterBreakout) return null;

    // Chikou must still be above breakout level (still bullish)
    if (currentChikouValue <= breakoutLevel) return null;

    const marketInfo = marketData.get(symbol) ?? { marketCap: 0, volume24h: 0 };

    const pullbackDistancePct = ((price - breakoutLevel) / breakoutLevel) * 100;

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
      breakoutLevel,
      barsSinceCross: mostRecentCross.barsAgo,
      pullbackDistancePct,
      signal: 'BUY',
      score: 0,
      volumeRatio: 0,
      oiChangePct: 0,
      fundingRate: 0,
      priceChangePct: 0,
      marketCap: marketInfo.marketCap,
      volume24h: marketInfo.volume24h,
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
