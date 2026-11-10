import { Injectable, Logger } from '@nestjs/common';
import { MultiExchangeKlineService } from 'src/exchange/multi-exchange-kline.service';
import { FuturesSymbolsService } from 'src/futures-symbols/futures-symbols.service';
import { VolumeMarketCapService } from 'src/volume-marketcap/volume-marketcap.service';
import { IchimokuCombinedService } from 'src/ichimoku-combined/ichimoku-combined.service';
import { MarketSignalService } from 'src/market-signal/market-signal.service';
import { SupportedExchange } from 'src/exchange/multi-exchange-kline.service';
import type {
  FourFormulaSignal,
  IchimokuOIScanParams,
  IchimokuOIScanResult,
  IchimokuOISignal,
  OIClassification,
} from './types/ichimoku-oi-screener.types';

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;
const MIN_VOLUME_RATIO = 1.2;
const MIN_CANDLES = 100;

interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface FuturesSymbolEntity {
  symbol: string;
  quoteAsset: string;
  status: string;
  contractType: string;
}

@Injectable()
export class IchimokuOiScreenerService {
  private readonly logger = new Logger(IchimokuOiScreenerService.name);

  constructor(
    private readonly ichimokuService: IchimokuCombinedService,
    private readonly marketSignalService: MarketSignalService,
    private readonly klineService: MultiExchangeKlineService,
    private readonly futuresSymbolsService: FuturesSymbolsService,
    private readonly volumeMarketCapService: VolumeMarketCapService,
  ) {}

  async scan(
    params: IchimokuOIScanParams = {},
  ): Promise<IchimokuOIScanResult> {
    const interval = params.interval ?? '1d';
    const exchange: string = params.exchange ?? 'binance';

    if (exchange !== 'binance') {
      this.logger.warn(
        `OI screener currently analyzes 4-factor data best on binance; got ${exchange}, using binance analysis.`,
      );
    }

    // Step 1: Get ichimoku combined results (bullish: Chikou up + price above cloud)
    const ichimokuResult = await this.ichimokuService.scan({
      symbols: params.symbols,
      limit: params.limit ? Number(params.limit) : undefined,
      interval,
      exchange,
    });

    this.logger.log(
      `Ichimoku OI screener: ${ichimokuResult.matches.length}/${ichimokuResult.totalScanned} passed Chikou-up + above-cloud; analyzing 4-factor (price/OI/volume/funding)...`,
    );

    // Step 2: From bullish ichimoku matches, apply 4-formula analysis
    const enriched: IchimokuOISignal[] = [];

    for (let i = 0; i < ichimokuResult.matches.length; i += BATCH_SIZE) {
      const batch = ichimokuResult.matches.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map((signal) => this.enrichWithFourFactors(signal)),
      );
      for (const item of results) {
        if (item) enriched.push(item);
      }
      if (i + BATCH_SIZE < ichimokuResult.matches.length) {
        await this.sleep(BATCH_DELAY_MS);
      }
    }

    // Step 3: Keep symbols where 4 formulas indicate bullish participation with meaningful volume
    const bullish = enriched.filter(
      (s) =>
        (s.fourFormulaSignal === 'LONG' || s.fourFormulaSignal === 'STRONG_LONG') &&
        s.volumeRatio >= MIN_VOLUME_RATIO,
    );

    bullish.sort((a, b) => b.volumeRatio - a.volumeRatio || b.fourFormulaScore - a.fourFormulaScore);

    // Step 4: Scan for bearish signals (Chikou broke down AND price below cloud AND SHORT/STRONG_SHORT)
    const bearish = await this.scanBearish(
      params.symbols,
      params.limit ? Number(params.limit) : undefined,
      interval,
      exchange as SupportedExchange,
      ichimokuResult.matches.map((s) => s.symbol),
    );

    const allMatches = [...bullish, ...bearish];

    this.logger.log(
      `Ichimoku OI screener complete: ichimoku=${ichimokuResult.matches.length}, analyzed=${enriched.length}, bullish4Factor+volume=${bullish.length}, bearish4Factor+volume=${bearish.length}`,
    );

    return {
      timestamp: new Date().toISOString(),
      interval,
      exchange: 'binance',
      totalScanned: ichimokuResult.totalScanned,
      ichimokuMatches: ichimokuResult.matches.length,
      analyzedMatches: enriched.length + bearish.length,
      oiFilteredMatches: allMatches.length,
      matches: allMatches,
    };
  }

  /**
   * Scan for bearish signals: Chikou broke down AND price below cloud AND SHORT/STRONG_SHORT
   */
  private async scanBearish(
    symbols?: string | undefined,
    limit?: number | undefined,
    interval?: string,
    exchange?: SupportedExchange,
    excludeSymbols: string[] = [],
  ): Promise<IchimokuOISignal[]> {
    let allSymbols: string[];

    if (symbols) {
      allSymbols = symbols
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    } else {
      allSymbols = await this.getStoredUsdtSymbols();
    }

    const limitNum = limit ? Number(limit) : 0;
    const targetSymbols = limitNum > 0 ? allSymbols.slice(0, limitNum) : allSymbols;

    const symbolsToScan = targetSymbols.filter((s) => !excludeSymbols.includes(s));

    this.logger.log(
      `Ichimoku OI bearish scan: scanning ${symbolsToScan.length} symbols for bearish breakdown (interval=${interval}, exchange=${exchange})`,
    );

    const bearish: IchimokuOISignal[] = [];

    for (let i = 0; i < symbolsToScan.length; i += BATCH_SIZE) {
      const batch = symbolsToScan.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map((sym) => this.scanBearishSymbol(sym, interval, exchange)),
      );
      for (const item of results) {
        if (item) bearish.push(item);
      }
      if (i + BATCH_SIZE < symbolsToScan.length) {
        await this.sleep(BATCH_DELAY_MS);
      }
    }

    bearish.sort((a, b) => b.volumeRatio - a.volumeRatio || b.fourFormulaScore - a.fourFormulaScore);

    return bearish;
  }

  private async scanBearishSymbol(
    symbol: string,
    interval?: string,
    exchange?: SupportedExchange,
  ): Promise<IchimokuOISignal | null> {
    try {
      const now = Date.now();
      const lookbackDays = 30;
      const startTime = now - lookbackDays * 24 * 60 * 60 * 1000;

      const intervalStr = interval ?? '1d';
      const exchangeStr: SupportedExchange = exchange ?? 'binance';

      const klines = await this.klineService.getFuturesKlines(
        symbol,
        intervalStr,
        startTime,
        now,
        1000,
        exchangeStr,
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

      const lastCandle = candles[candles.length - 1];
      const price = lastCandle.close;

      // Compute Ichimoku values
      const closes = candles.map((c) => c.close);
      const highs = candles.map((c) => c.high);
      const lows = candles.map((c) => c.low);

      const cloudIndex = candles.length - 1 - 26;
      if (cloudIndex < 25) return null;

      const tenkan = this.computeTenkanKijun(highs, lows, 9);
      const kijun = this.computeTenkanKijun(highs, lows, 26);

      const spanA = (tenkan[cloudIndex] + kijun[cloudIndex]) / 2;
      const spanBStart = cloudIndex - 51;
      if (spanBStart < 0) return null;

      const spanB =
        (this.highest(highs, spanBStart, cloudIndex) +
          this.lowest(lows, spanBStart, cloudIndex)) /
        2;

      const cloudTop = Math.max(spanA, spanB);
      const cloudBottom = Math.min(spanA, spanB);

      // Check: price below cloud bottom
      if (price >= cloudBottom) {
        return null;
      }

      // Get 4-factor analysis
      const analysis = await this.marketSignalService.analyzeSymbol(symbol, startTime, now, exchange as any);
      const tf1h = analysis.timeframes.find((t) => t.timeframe === '1h') ?? analysis.timeframes[analysis.timeframes.length - 1];

      const priceChangePct = tf1h?.priceChange ?? 0;
      const oiChangePct = tf1h?.oiChange ?? 0;
      const volumeRatio = tf1h?.volumeRatio ?? 0;
      const fundingRate = tf1h?.fundingRate ?? 0;
      const fourFormulaSignal = this.normalizeSignal(analysis.finalSignal);
      const classification = this.classify(priceChangePct, oiChangePct);

      // Only keep SHORT/STRONG_SHORT signals
      if (fourFormulaSignal !== 'SHORT' && fourFormulaSignal !== 'STRONG_SHORT') {
        return null;
      }

      // Check volume ratio minimum
      if (volumeRatio < MIN_VOLUME_RATIO) {
        return null;
      }

      return {
        symbol,
        price,
        priceChangePct,
        oiChangePct,
        volumeRatio,
        fundingRate,
        classification,
        fourFormulaSignal,
        fourFormulaScore: analysis.finalScore ?? 0,
        tenkan: tenkan[candles.length - 1],
        kijun: kijun[candles.length - 1],
        spanA,
        spanB,
        cloudTop,
        cloudBottom,
        chikouValue: closes[candles.length - 2],
        breakoutLevel: cloudBottom,
        barsSinceCross: 0,
        signal: 'SELL',
        score: analysis.finalScore ?? 0,
        marketCap: 0,
        volume24h: 0,
        targetPrice1: price * 0.95,
        targetPrice2: price * 0.85,
        stopLoss: cloudTop,
        targetProfit1Pct: ((price - price * 0.95) / price) * 100,
        targetProfit2Pct: ((price - price * 0.85) / price) * 100,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Ichimoku bearish scan failed for ${symbol}: ${msg}`);
      return null;
    }
  }

  private async enrichWithFourFactors(signal: {
    symbol: string;
    price: number;
    tenkan: number;
    kijun: number;
    spanA: number;
    spanB: number;
    cloudTop: number;
    cloudBottom: number;
    chikouValue: number;
    crossPriceHigh: number;
    barsAgo: number;
  }): Promise<IchimokuOISignal | null> {
    try {
      const endTime = Date.now();
      const startTime = endTime - 24 * 60 * 60 * 1000;
      const analysis = await this.marketSignalService.analyzeSymbol(signal.symbol, startTime, endTime, 'binance');
      const tf1h = analysis.timeframes.find((t) => t.timeframe === '1h') ?? analysis.timeframes[analysis.timeframes.length - 1];

      const priceChangePct = tf1h?.priceChange ?? 0;
      const oiChangePct = tf1h?.oiChange ?? 0;
      const volumeRatio = tf1h?.volumeRatio ?? 0;
      const fundingRate = tf1h?.fundingRate ?? 0;
      const fourFormulaSignal = this.normalizeSignal(analysis.finalSignal);
      const classification = this.classify(priceChangePct, oiChangePct);

      return {
        symbol: signal.symbol,
        price: signal.price,
        priceChangePct,
        oiChangePct,
        volumeRatio,
        fundingRate,
        classification,
        fourFormulaSignal,
        fourFormulaScore: analysis.finalScore ?? 0,
        tenkan: signal.tenkan,
        kijun: signal.kijun,
        spanA: signal.spanA,
        spanB: signal.spanB,
        cloudTop: signal.cloudTop,
        cloudBottom: signal.cloudBottom,
        chikouValue: signal.chikouValue,
        breakoutLevel: signal.crossPriceHigh,
        barsSinceCross: signal.barsAgo,
        signal: 'BUY',
        score: analysis.finalScore ?? 0,
        marketCap: 0,
        volume24h: 0,
        targetPrice1: signal.cloudTop * 1.05,
        targetPrice2: signal.cloudTop * 1.15,
        stopLoss: signal.cloudBottom,
        targetProfit1Pct: ((signal.cloudTop * 1.05 - signal.price) / signal.price) * 100,
        targetProfit2Pct: ((signal.cloudTop * 1.15 - signal.price) / signal.price) * 100,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`4-factor enrichment failed for ${signal.symbol}: ${msg}`);
      return null;
    }
  }

  private normalizeSignal(signal: string): FourFormulaSignal {
    if (signal === 'STRONG_LONG' || signal === 'LONG' || signal === 'NEUTRAL' || signal === 'SHORT' || signal === 'STRONG_SHORT') {
      return signal;
    }
    return 'NEUTRAL';
  }

  private classify(priceChangePct: number, oiChangePct: number): OIClassification {
    const priceUp = priceChangePct > 0;
    const priceDown = priceChangePct < 0;
    const oiUp = oiChangePct > 0;
    const oiDown = oiChangePct < 0;

    if (priceUp && oiUp) return 'LONG_BUILDUP';
    if (priceUp && oiDown) return 'SHORT_COVERING';
    if (priceDown && oiDown) return 'LONG_LIQUIDATION';
    if (priceDown && oiUp) return 'SHORT_BUILDUP';

    return 'NEUTRAL';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private computeTenkanKijun(highs: number[], lows: number[], lookback: number): number[] {
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
