import { Injectable, Logger } from '@nestjs/common';
import { MarketSignalService } from 'src/market-signal/market-signal.service';
import { FuturesSymbolsService } from 'src/futures-symbols/futures-symbols.service';
import { ExchangeService } from 'src/exchange/exchange.service';
import type { ExchangeName } from 'src/exchange/exchange.service';
import { NotificationGateway } from 'src/notification/notification.gateway';

export interface SymbolSignal {
  symbol: string;
  score: number;
  signal: string;
  confidence: number;
  priceChange: number;
  oiChange: number;
  fundingRate: number;
  sma9: number | null;
  sma21: number | null;
  sma50: number | null;
  priceVsSma50: number | null;
  maSignal: 'ABOVE' | 'BELOW' | 'NEUTRAL';
}

export interface ReapproachSignal {
  symbol: string;
  score: number;
  signal: string;
  priceChange: number;
  oiChange: number;
  maReapproach: 'BULLISH_REAPPROACH' | 'BEARISH_REAPPROACH';
  breakoutDay: number | null;
  currentDistance: number | null;
  priceVsEma50: number | null;
  currentPrice: number;
  ema50: number | null;
}

export interface PullbackSignal {
  symbol: string;
  score: number;
  signal: string;
  priceChange: number;
  oiChange: number;
  maPullback: 'BULLISH_PULLBACK' | 'BEARISH_PULLBACK';
  maPullbackTouches: number;
  priceVsEma50: number | null;
  currentPrice: number;
  ema50: number | null;
}

export interface ScannerResult {
  longs: SymbolSignal[];
  shorts: SymbolSignal[];
  allRanked: SymbolSignal[];
  scanned: number;
  duration: number;
  timestamp: string;
}

export interface FakeSignalRisk {
  symbol: string;
  fakeSignalProbability: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  rsi: number | null;
  priceVsEma50: number | null;
  volumeRatio: number | null;
  momentum: number | null;
  direction: 'LONG' | 'SHORT';
}

export interface FakeSignalScanResult {
  risks: FakeSignalRisk[];
  scanned: number;
  duration: number;
  timestamp: string;
}

export interface PullbackResult {
  longs: PullbackSignal[];
  shorts: PullbackSignal[];
  all: PullbackSignal[];
  scanned: number;
  duration: number;
  timestamp: string;
}

@Injectable()
export class MarketScannerService {
  private readonly logger = new Logger(MarketScannerService.name);

  constructor(
    private readonly marketSignalService: MarketSignalService,
    private readonly futuresSymbolsService: FuturesSymbolsService,
    private readonly exchangeService: ExchangeService,
    private readonly notificationGateway: NotificationGateway,
  ) {}

  private currentExchange = 'BINANCE';
  private currentStrategy = '';

  private setExchange(exchange: string) {
    this.currentExchange = exchange;
    return this;
  }

  private setStrategy(strategy: string) {
    this.currentStrategy = strategy;
    return this;
  }

  private logWithContext(message: string) {
    this.logger.log(
      `[${this.currentExchange}] [${this.currentStrategy}] ${message}`,
    );
  }

  private async getKlines(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
    limit?: number,
  ) {
    this.logWithContext(
      `🌐 [${this.currentExchange}] [${this.currentStrategy}] ${symbol} ${interval} ${new Date(startTime).toISOString()} -> ${new Date(endTime).toISOString()}`,
    );
    return this.exchangeService.getKlines(
      symbol,
      interval,
      startTime,
      endTime,
      this.currentExchange as any,
      limit,
    );
  }

  private calculateSMA(prices: number[], period: number): number | null {
    if (prices.length < period) return null;
    const slice = prices.slice(-period);
    return slice.reduce((sum, p) => sum + p, 0) / period;
  }

  private calculateEMA(prices: number[], period: number): number | null {
    if (prices.length < period) return null;
    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }
    return ema;
  }

  private calculateEMASeries(
    prices: number[],
    period: number,
  ): (number | null)[] {
    if (prices.length < period) return prices.map(() => null);
    const multiplier = 2 / (period + 1);
    const series: (number | null)[] = [];
    let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;
    for (let i = 0; i < period - 1; i++) series.push(null);
    series.push(ema);
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
      series.push(ema);
    }
    return series;
  }

  private detectPullback(
    klines: unknown[][],
    smaValues: (number | null)[],
  ): {
    maPullback: 'BULLISH_PULLBACK' | 'BEARISH_PULLBACK' | null;
    maPullbackTouches: number;
  } {
    const TOUCH_THRESHOLD = 0.015;
    const LOOKBACK = 20;

    if (klines.length < LOOKBACK || smaValues.length < LOOKBACK) {
      return { maPullback: null, maPullbackTouches: 0 };
    }

    const closePrices = klines.map((k) => parseFloat(k[4] as string));
    const recentCloses = closePrices.slice(-LOOKBACK);
    const recentSma = smaValues.slice(-LOOKBACK);

    let touchCount = 0;
    for (let i = 0; i < recentCloses.length; i++) {
      const price = recentCloses[i];
      const sma = recentSma[i];
      if (!sma) continue;
      const distance = Math.abs(price - sma) / sma;
      if (distance <= TOUCH_THRESHOLD) {
        touchCount++;
      }
    }

    if (touchCount < 2) {
      return { maPullback: null, maPullbackTouches: touchCount };
    }

    const currentPrice = recentCloses[recentCloses.length - 1];
    const currentSma = recentSma[recentSma.length - 1];
    if (!currentSma) {
      return { maPullback: null, maPullbackTouches: touchCount };
    }

    const priceBeforeMove = closePrices[closePrices.length - LOOKBACK];
    const priceDirection = currentPrice - priceBeforeMove;
    const priceDirectionPercent = (priceDirection / priceBeforeMove) * 100;

    if (Math.abs(priceDirectionPercent) < 3) {
      return { maPullback: null, maPullbackTouches: touchCount };
    }

    const isAboveSma = currentPrice > currentSma;

    if (priceDirectionPercent < -3 && !isAboveSma) {
      return { maPullback: 'BEARISH_PULLBACK', maPullbackTouches: touchCount };
    }

    if (priceDirectionPercent > 3 && isAboveSma) {
      return { maPullback: 'BULLISH_PULLBACK', maPullbackTouches: touchCount };
    }

    return { maPullback: null, maPullbackTouches: touchCount };
  }

  private detectReapproach(
    klines: unknown[][],
    emaValues: (number | null)[],
  ): {
    maReapproach: 'BULLISH_REAPPROACH' | 'BEARISH_REAPPROACH' | null;
    breakoutDay: number | null;
    currentDistance: number | null;
  } {
    const APPROACH_THRESHOLD = 0.03;
    const BREAKOUT_THRESHOLD = 0.02;
    const LOOKBACK = 15;

    if (klines.length < LOOKBACK || emaValues.length < LOOKBACK) {
      return { maReapproach: null, breakoutDay: null, currentDistance: null };
    }

    const closePrices = klines.map((k) => parseFloat(k[4] as string));
    const currentPrice = closePrices[closePrices.length - 1];
    const currentEma = emaValues[emaValues.length - 1];

    if (!currentEma) {
      return { maReapproach: null, breakoutDay: null, currentDistance: null };
    }

    const currentDistance = (currentPrice - currentEma) / currentEma;

    if (Math.abs(currentDistance) > APPROACH_THRESHOLD) {
      return { maReapproach: null, breakoutDay: null, currentDistance: null };
    }

    let breakoutDay: number | null = null;

    for (let i = closePrices.length - LOOKBACK; i < closePrices.length; i++) {
      const ema = emaValues[i];
      if (!ema) continue;
      const price = closePrices[i];
      const distance = (price - ema) / ema;

      if (Math.abs(distance) > BREAKOUT_THRESHOLD) {
        breakoutDay = i;
        break;
      }
    }

    if (breakoutDay === null) {
      return { maReapproach: null, breakoutDay: null, currentDistance: null };
    }

    const isAboveEma = currentPrice > currentEma;
    const priceAtBreakout = closePrices[breakoutDay];
    const emaAtBreakout = emaValues[breakoutDay];

    if (!emaAtBreakout) {
      return { maReapproach: null, breakoutDay: null, currentDistance: null };
    }

    const wasAboveAtBreakout = priceAtBreakout > emaAtBreakout;

    if (isAboveEma && !wasAboveAtBreakout) {
      return {
        maReapproach: 'BULLISH_REAPPROACH',
        breakoutDay,
        currentDistance: currentDistance * 100,
      };
    }

    if (!isAboveEma && wasAboveAtBreakout) {
      return {
        maReapproach: 'BEARISH_REAPPROACH',
        breakoutDay,
        currentDistance: currentDistance * 100,
      };
    }

    return { maReapproach: null, breakoutDay: null, currentDistance: null };
  }

  private async getMovingAverages(symbol: string): Promise<{
    sma9: number | null;
    sma21: number | null;
    sma50: number | null;
    priceVsSma50: number | null;
    maSignal: 'ABOVE' | 'BELOW' | 'NEUTRAL';
  }> {
    try {
      const endTime = Date.now();
      const startTime = endTime - 60 * 24 * 60 * 60 * 1000;
      const klines = await this.getKlines(symbol, '1d', startTime, endTime);

      if (klines.length < 9) {
        return {
          sma9: null,
          sma21: null,
          sma50: null,
          priceVsSma50: null,
          maSignal: 'NEUTRAL',
        };
      }

      const closePrices = klines.map((k) => parseFloat(k[4]));
      const currentPrice = closePrices[closePrices.length - 1];

      const sma9 = this.calculateSMA(closePrices, 9);
      const sma21 = this.calculateSMA(closePrices, 21);
      const sma50 = this.calculateSMA(closePrices, 50);

      let maSignal: 'ABOVE' | 'BELOW' | 'NEUTRAL' = 'NEUTRAL';
      if (sma50) {
        maSignal = currentPrice > sma50 ? 'ABOVE' : 'BELOW';
      }

      const priceVsSma50 = sma50
        ? ((currentPrice - sma50) / sma50) * 100
        : null;

      return { sma9, sma21, sma50, priceVsSma50, maSignal };
    } catch {
      return {
        sma9: null,
        sma21: null,
        sma50: null,
        priceVsSma50: null,
        maSignal: 'NEUTRAL',
      };
    }
  }

  private async getPullbackData(symbol: string): Promise<{
    maPullback: 'BULLISH_PULLBACK' | 'BEARISH_PULLBACK' | null;
    maPullbackTouches: number;
    priceVsEma50: number | null;
    currentPrice: number;
    ema50: number | null;
  }> {
    try {
      const endTime = Date.now();
      const startTime = endTime - 70 * 24 * 60 * 60 * 1000;
      const klines = await this.getKlines(symbol, '1d', startTime, endTime);

      if (klines.length < 50) {
        return {
          maPullback: null,
          maPullbackTouches: 0,
          priceVsEma50: null,
          currentPrice: 0,
          ema50: null,
        };
      }

      const closePrices = klines.map((k) => parseFloat(k[4]));
      const currentPrice = closePrices[closePrices.length - 1];
      const ema50 = this.calculateEMA(closePrices, 50);
      const ema50Series = this.calculateEMASeries(closePrices, 50);

      const priceVsEma50 = ema50
        ? ((currentPrice - ema50) / ema50) * 100
        : null;
      const pullback = this.detectPullback(klines, ema50Series);

      return {
        maPullback: pullback.maPullback,
        maPullbackTouches: pullback.maPullbackTouches,
        priceVsEma50,
        currentPrice,
        ema50,
      };
    } catch {
      return {
        maPullback: null,
        maPullbackTouches: 0,
        priceVsEma50: null,
        currentPrice: 0,
        ema50: null,
      };
    }
  }

  private async getReapproachData(symbol: string): Promise<{
    maReapproach: 'BULLISH_REAPPROACH' | 'BEARISH_REAPPROACH' | null;
    breakoutDay: number | null;
    currentDistance: number | null;
    priceVsEma50: number | null;
    currentPrice: number;
    ema50: number | null;
  }> {
    try {
      const endTime = Date.now();
      const startTime = endTime - 70 * 24 * 60 * 60 * 1000;
      const klines = await this.getKlines(symbol, '1d', startTime, endTime);

      if (klines.length < 50) {
        return {
          maReapproach: null,
          breakoutDay: null,
          currentDistance: null,
          priceVsEma50: null,
          currentPrice: 0,
          ema50: null,
        };
      }

      const closePrices = klines.map((k) => parseFloat(k[4]));
      const currentPrice = closePrices[closePrices.length - 1];
      const ema50 = this.calculateEMA(closePrices, 50);
      const ema50Series = this.calculateEMASeries(closePrices, 50);

      const priceVsEma50 = ema50
        ? ((currentPrice - ema50) / ema50) * 100
        : null;
      const reapproach = this.detectReapproach(klines, ema50Series);

      return {
        maReapproach: reapproach.maReapproach,
        breakoutDay: reapproach.breakoutDay,
        currentDistance: reapproach.currentDistance,
        priceVsEma50,
        currentPrice,
        ema50,
      };
    } catch {
      return {
        maReapproach: null,
        breakoutDay: null,
        currentDistance: null,
        priceVsEma50: null,
        currentPrice: 0,
        ema50: null,
      };
    }
  }

  private async getPullbackDataGeneric(
    symbol: string,
    interval: '1d' | '4h' | '1w',
    period: number,
  ): Promise<{
    maPullback: 'BULLISH_PULLBACK' | 'BEARISH_PULLBACK' | null;
    maPullbackTouches: number;
    priceVsMa: number | null;
    currentPrice: number;
    ma: number | null;
  }> {
    try {
      const endTime = Date.now();
      const startTime =
        endTime -
        (interval === '1w'
          ? 200 * 24 * 60 * 60 * 1000
          : interval === '4h'
            ? 70 * 24 * 60 * 60 * 1000
            : 70 * 24 * 60 * 60 * 1000);
      const klines = await this.getKlines(symbol, interval, startTime, endTime);

      if (klines.length < period) {
        return {
          maPullback: null,
          maPullbackTouches: 0,
          priceVsMa: null,
          currentPrice: 0,
          ma: null,
        };
      }

      const closePrices = klines.map((k) => parseFloat(k[4]));
      const currentPrice = closePrices[closePrices.length - 1];
      const ma = this.calculateEMA(closePrices, period);
      const maSeries = this.calculateEMASeries(closePrices, period);

      const priceVsMa = ma ? ((currentPrice - ma) / ma) * 100 : null;
      const pullback = this.detectPullback(klines, maSeries);

      return {
        maPullback: pullback.maPullback,
        maPullbackTouches: pullback.maPullbackTouches,
        priceVsMa,
        currentPrice,
        ma,
      };
    } catch {
      return {
        maPullback: null,
        maPullbackTouches: 0,
        priceVsMa: null,
        currentPrice: 0,
        ma: null,
      };
    }
  }

  private async getReapproachDataGeneric(
    symbol: string,
    interval: '1d' | '4h' | '1w',
    period: number,
  ): Promise<{
    maReapproach: 'BULLISH_REAPPROACH' | 'BEARISH_REAPPROACH' | null;
    breakoutDay: number | null;
    currentDistance: number | null;
    priceVsMa: number | null;
    currentPrice: number;
    ma: number | null;
  }> {
    try {
      const endTime = Date.now();
      const startTime =
        endTime -
        (interval === '1w'
          ? 200 * 24 * 60 * 60 * 1000
          : 70 * 24 * 60 * 60 * 1000);
      const klines = await this.getKlines(symbol, interval, startTime, endTime);

      if (klines.length < period) {
        return {
          maReapproach: null,
          breakoutDay: null,
          currentDistance: null,
          priceVsMa: null,
          currentPrice: 0,
          ma: null,
        };
      }

      const closePrices = klines.map((k) => parseFloat(k[4]));
      const currentPrice = closePrices[closePrices.length - 1];
      const ma = this.calculateEMA(closePrices, period);
      const maSeries = this.calculateEMASeries(closePrices, period);

      const priceVsMa = ma ? ((currentPrice - ma) / ma) * 100 : null;
      const reapproach = this.detectReapproach(klines, maSeries);

      return {
        maReapproach: reapproach.maReapproach,
        breakoutDay: reapproach.breakoutDay,
        currentDistance: reapproach.currentDistance,
        priceVsMa,
        currentPrice,
        ma,
      };
    } catch {
      return {
        maReapproach: null,
        breakoutDay: null,
        currentDistance: null,
        priceVsMa: null,
        currentPrice: 0,
        ma: null,
      };
    }
  }

  private async getWeeklyAboveEma50(symbol: string): Promise<{
    aboveEma50: boolean;
    priceVsEma50: number | null;
    currentPrice: number;
    ema50: number | null;
  }> {
    try {
      const endTime = Date.now();
      const startTime = endTime - 350 * 24 * 60 * 60 * 1000;
      const klines = await this.getKlines(symbol, '1w', startTime, endTime);

      if (klines.length < 50) {
        return {
          aboveEma50: false,
          priceVsEma50: null,
          currentPrice: 0,
          ema50: null,
        };
      }

      const closePrices = klines.map((k) => parseFloat(k[4]));
      const currentPrice = closePrices[closePrices.length - 1];
      const ema50 = this.calculateEMA(closePrices, 50);

      if (!ema50) {
        return {
          aboveEma50: false,
          priceVsEma50: null,
          currentPrice,
          ema50: null,
        };
      }

      const priceVsEma50 = ((currentPrice - ema50) / ema50) * 100;
      const aboveEma50 = currentPrice > ema50;

      return { aboveEma50, priceVsEma50, currentPrice, ema50 };
    } catch {
      return {
        aboveEma50: false,
        priceVsEma50: null,
        currentPrice: 0,
        ema50: null,
      };
    }
  }

  async scanMarket(
    limit = 20,
    exchange: string = 'BINANCE',
  ): Promise<ScannerResult> {
    this.setExchange(exchange).setStrategy('FULL_MARKET');
    const startTime = Date.now();
    this.logWithContext('Starting full market scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols(
      this.currentExchange as ExchangeName,
    );
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logWithContext(`Scanning ${symbols.length} symbols...`);

    const allResults: SymbolSignal[] = [];
    const endTime = Date.now();
    const analysisStart = endTime - 24 * 60 * 60 * 1000;

    const batchSize = 5;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((symbol) =>
          Promise.all([
            this.marketSignalService.analyzeSymbol(
              symbol,
              analysisStart,
              endTime,
              this.currentExchange,
            ),
            this.getMovingAverages(symbol),
          ])
            .then(([analysis, mas]) => {
              const tf1h = analysis.timeframes.find(
                (t) => t.timeframe === '1h',
              );
              return {
                symbol,
                score: analysis.finalScore,
                signal: analysis.finalSignal,
                confidence: analysis.confidence,
                priceChange: tf1h?.priceChange ?? 0,
                oiChange: tf1h?.oiChange ?? 0,
                fundingRate: tf1h?.fundingRate ?? 0,
                sma9: mas.sma9,
                sma21: mas.sma21,
                sma50: mas.sma50,
                priceVsSma50: mas.priceVsSma50,
                maSignal: mas.maSignal,
              };
            })
            .catch(() => null),
        ),
      );

      for (const result of batchResults) {
        if (result) allResults.push(result);
      }
    }

    const longs = allResults
      .filter((r) => r.signal === 'LONG' || r.signal === 'STRONG_LONG')
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const shorts = allResults
      .filter((r) => r.signal === 'SHORT' || r.signal === 'STRONG_SHORT')
      .sort((a, b) => a.score - b.score)
      .slice(0, limit);

    const allRanked = [...allResults].sort((a, b) => b.score - a.score);

    const duration = Date.now() - startTime;
    this.logWithContext(
      `Scan complete: ${longs.length} LONGs, ${shorts.length} SHORTs in ${duration}ms`,
    );

    return {
      longs,
      shorts,
      allRanked,
      scanned: symbols.length,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  async scanMarketReliable(
    limit = 20,
    exchange: string = 'BINANCE',
  ): Promise<ScannerResult> {
    this.setExchange(exchange).setStrategy('RELIABLE_SCAN');
    const startTime = Date.now();
    this.logWithContext('Starting reliable market scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols(
      this.currentExchange as ExchangeName,
    );
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logWithContext(
      `Scanning ${symbols.length} symbols for reliable signals...`,
    );

    const allResults: SymbolSignal[] = [];
    const endTime = Date.now();
    const analysisStart = endTime - 24 * 60 * 60 * 1000;

    const batchSize = 5;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((symbol) =>
          Promise.all([
            this.marketSignalService.analyzeSymbol(
              symbol,
              analysisStart,
              endTime,
              this.currentExchange,
            ),
            this.getMovingAverages(symbol),
          ])
            .then(([analysis, mas]) => {
              const tf1h = analysis.timeframes.find(
                (t) => t.timeframe === '1h',
              );
              const result: SymbolSignal = {
                symbol,
                score: analysis.finalScore,
                signal: analysis.finalSignal,
                confidence: analysis.confidence,
                priceChange: tf1h?.priceChange ?? 0,
                oiChange: tf1h?.oiChange ?? 0,
                fundingRate: tf1h?.fundingRate ?? 0,
                sma9: mas.sma9,
                sma21: mas.sma21,
                sma50: mas.sma50,
                priceVsSma50: mas.priceVsSma50,
                maSignal: mas.maSignal,
              };

              if (!this.isSignalReliable(analysis, mas, tf1h)) {
                return null;
              }

              return result;
            })
            .catch(() => null),
        ),
      );

      for (const result of batchResults) {
        if (result) allResults.push(result);
      }
    }

    const longs = allResults
      .filter((r) => r.signal === 'LONG' || r.signal === 'STRONG_LONG')
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const shorts = allResults
      .filter((r) => r.signal === 'SHORT' || r.signal === 'STRONG_SHORT')
      .sort((a, b) => a.score - b.score)
      .slice(0, limit);

    const allRanked = [...allResults].sort((a, b) => b.score - a.score);

    const duration = Date.now() - startTime;
    this.logWithContext(
      `Reliable scan complete: ${longs.length} LONGs, ${shorts.length} SHORTs in ${duration}ms`,
    );

    return {
      longs,
      shorts,
      allRanked,
      scanned: symbols.length,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  private isSignalReliable(
    analysis: {
      timeframes: Array<{
        timeframe: string;
        score: number;
        volumeRatio?: number;
        signal: string;
      }>;
      finalSignal: string;
      confidence: number;
    },
    mas: { maSignal: 'ABOVE' | 'BELOW' | 'NEUTRAL' },
    tf1h: { volumeRatio?: number } | undefined,
  ): boolean {
    const { maSignal } = mas;

    const isLongSignal =
      analysis.finalSignal === 'LONG' || analysis.finalSignal === 'STRONG_LONG';

    const isShortSignal =
      analysis.finalSignal === 'SHORT' ||
      analysis.finalSignal === 'STRONG_SHORT';

    if (isLongSignal && maSignal !== 'ABOVE') {
      return false;
    }

    if (isShortSignal && maSignal !== 'BELOW') {
      return false;
    }

    if (analysis.confidence < 50) {
      return false;
    }

    const tf1hVolumeRatio = tf1h?.volumeRatio ?? 0;
    if (tf1hVolumeRatio < 1.5) {
      return false;
    }

    const positiveTimeframes = analysis.timeframes.filter(
      (t) => t.score > 0,
    ).length;

    const negativeTimeframes = analysis.timeframes.filter(
      (t) => t.score < 0,
    ).length;

    if (isLongSignal && positiveTimeframes < 2) {
      return false;
    }

    if (isShortSignal && negativeTimeframes < 2) {
      return false;
    }

    return true;
  }

  async scanFakeSignals(
    limit = 50,
    exchange: string = 'BINANCE',
  ): Promise<FakeSignalScanResult> {
    this.setExchange(exchange).setStrategy('FAKE_SIGNALS');
    const startTime = Date.now();
    this.logWithContext('Starting fake signal scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols(
      this.currentExchange as ExchangeName,
    );
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logWithContext(
      `Scanning ${symbols.length} symbols for fake signals...`,
    );

    const endTime = Date.now();
    const analysisStart = endTime - 24 * 60 * 60 * 1000;

    const risks: FakeSignalRisk[] = [];
    const batchSize = 5;

    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((symbol) =>
          this.analyzeFakeSignalRisk(symbol, analysisStart, endTime)
            .then((risk) => risk)
            .catch(() => null),
        ),
      );

      for (const risk of batchResults) {
        if (risk) risks.push(risk);
      }
    }

    risks.sort((a, b) => b.fakeSignalProbability - a.fakeSignalProbability);

    const duration = Date.now() - startTime;
    this.logWithContext(
      `Fake signal scan complete: ${risks.length} risks found in ${duration}ms`,
    );

    return {
      risks: risks.slice(0, limit),
      scanned: symbols.length,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  private async analyzeFakeSignalRisk(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<FakeSignalRisk | null> {
    try {
      const [analysis, klines] = await Promise.all([
        this.marketSignalService.analyzeSymbol(
          symbol,
          startTime,
          endTime,
          this.currentExchange,
        ),
        this.getKlines(symbol, '1h', startTime, endTime),
      ]);

      const isLong =
        analysis.finalSignal === 'LONG' ||
        analysis.finalSignal === 'STRONG_LONG';
      const isShort =
        analysis.finalSignal === 'SHORT' ||
        analysis.finalSignal === 'STRONG_SHORT';

      if (!isLong && !isShort) {
        return null;
      }

      if (klines.length < 50) {
        return null;
      }

      const closes = klines.map((k) => parseFloat(k[4]));
      const volumes = klines.map((k) => parseFloat(k[5]));

      const currentPrice = closes[closes.length - 1];
      const ema50 = this.calculateEMA(closes, 50);
      const priceVsEma50 = ema50
        ? ((currentPrice - ema50) / ema50) * 100
        : null;
      const rsi = this.calculateRSI(closes, 14);
      const volumeRatio = this.calculateVolumeRatio(volumes, 20);
      const momentum = this.calculateMomentum(closes, 6);

      const direction = isLong ? 'LONG' : 'SHORT';
      const fakeSignalProbability = this.calculateFakeSignalProbability({
        direction,
        rsi,
        priceVsEma50,
        volumeRatio,
        momentum,
      });

      return {
        symbol,
        fakeSignalProbability,
        riskLevel: this.getRiskLevel(fakeSignalProbability),
        rsi,
        priceVsEma50,
        volumeRatio,
        momentum,
        direction,
      };
    } catch {
      return null;
    }
  }

  private calculateRSI(prices: number[], period: number): number | null {
    if (prices.length < period + 1) return null;

    let gains = 0;
    let losses = 0;

    for (let i = prices.length - period; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }

    if (losses === 0) return 100;

    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
  }

  private calculateVolumeRatio(
    volumes: number[],
    lookback: number,
  ): number | null {
    if (volumes.length < lookback + 1) return null;

    const recentVolume = volumes[volumes.length - 1];
    const averageVolume =
      volumes.slice(-lookback, -1).reduce((sum, v) => sum + v, 0) / lookback;

    if (averageVolume === 0) return null;

    return recentVolume / averageVolume;
  }

  private calculateMomentum(closes: number[], periods: number): number | null {
    if (closes.length < periods + 1) return null;

    const current = closes[closes.length - 1];
    const previous = closes[closes.length - 1 - periods];

    if (previous === 0) return null;

    return ((current - previous) / previous) * 100;
  }

  private calculateFakeSignalProbability({
    direction,
    rsi,
    priceVsEma50,
    volumeRatio,
    momentum,
  }: {
    direction: 'LONG' | 'SHORT';
    rsi: number | null;
    priceVsEma50: number | null;
    volumeRatio: number | null;
    momentum: number | null;
  }): number {
    let risk = 0;

    if (direction === 'LONG') {
      if (rsi !== null) {
        if (rsi >= 70) risk += 30;
        else if (rsi >= 65) risk += 20;
        else if (rsi >= 60) risk += 10;
      }

      if (priceVsEma50 !== null) {
        if (priceVsEma50 >= 5) risk += 25;
        else if (priceVsEma50 >= 3) risk += 15;
        else if (priceVsEma50 >= 1.5) risk += 5;
      }

      if (volumeRatio !== null) {
        if (volumeRatio < 0.8) risk += 20;
        else if (volumeRatio < 1.0) risk += 10;
      }

      if (momentum !== null && momentum < 0) {
        risk += 15;
      }
    } else {
      if (rsi !== null) {
        if (rsi <= 30) risk += 30;
        else if (rsi <= 35) risk += 20;
        else if (rsi <= 40) risk += 10;
      }

      if (priceVsEma50 !== null) {
        if (priceVsEma50 <= -5) risk += 25;
        else if (priceVsEma50 <= -3) risk += 15;
        else if (priceVsEma50 <= -1.5) risk += 5;
      }

      if (volumeRatio !== null) {
        if (volumeRatio < 0.8) risk += 20;
        else if (volumeRatio < 1.0) risk += 10;
      }

      if (momentum !== null && momentum > 0) {
        risk += 15;
      }
    }

    return Math.min(Math.max(risk, 0), 100);
  }

  private getRiskLevel(probability: number): 'LOW' | 'MEDIUM' | 'HIGH' {
    if (probability >= 65) return 'HIGH';
    if (probability >= 35) return 'MEDIUM';
    return 'LOW';
  }

  async scanForPullbacks(
    limit = 20,
    exchange: string = 'BINANCE',
  ): Promise<PullbackResult> {
    this.setExchange(exchange).setStrategy('DAILY_PULLBACK');
    const startTime = Date.now();
    this.logWithContext('Starting daily pullback scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols(
      this.currentExchange as ExchangeName,
    );
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logWithContext(`Scanning ${symbols.length} symbols for pullbacks...`);

    const allPullbacks: PullbackSignal[] = [];
    const endTime = Date.now();
    const analysisStart = endTime - 24 * 60 * 60 * 1000;

    const batchSize = 5;
    let processedCount = 0;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((symbol) =>
          Promise.all([
            this.marketSignalService.analyzeSymbol(
              symbol,
              analysisStart,
              endTime,
              this.currentExchange,
            ),
            this.getPullbackData(symbol),
          ])
            .then(([analysis, pullback]) => {
              if (!pullback.maPullback) return null;
              const tf1h = analysis.timeframes.find(
                (t) => t.timeframe === '1h',
              );
              return {
                symbol,
                score: analysis.finalScore,
                signal: analysis.finalSignal,
                priceChange: tf1h?.priceChange ?? 0,
                oiChange: tf1h?.oiChange ?? 0,
                maPullback: pullback.maPullback,
                maPullbackTouches: pullback.maPullbackTouches,
                priceVsEma50: pullback.priceVsEma50,
                currentPrice: pullback.currentPrice,
                ema50: pullback.ema50,
              };
            })
            .catch(() => null),
        ),
      );

      for (const result of batchResults) {
        if (result) allPullbacks.push(result);
      }

      processedCount += batch.length;
      this.notificationGateway.sendScanProgress({
        current: processedCount,
        total: symbols.length,
        symbol: batch[batch.length - 1],
        scanType: 'pullbacks',
      });
    }

    const longs = allPullbacks
      .filter((r) => r.maPullback === 'BULLISH_PULLBACK')
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const shorts = allPullbacks
      .filter((r) => r.maPullback === 'BEARISH_PULLBACK')
      .sort((a, b) => a.score - b.score)
      .slice(0, limit);

    const all = [...allPullbacks].sort((a, b) => b.score - a.score);

    const duration = Date.now() - startTime;
    this.logWithContext(
      `Pullback scan complete: ${longs.length} bullish, ${shorts.length} bearish in ${duration}ms`,
    );

    return {
      longs,
      shorts,
      all,
      scanned: symbols.length,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  async scanForReapproach(
    limit = 20,
    exchange: string = 'BINANCE',
  ): Promise<{
    longs: ReapproachSignal[];
    shorts: ReapproachSignal[];
    all: ReapproachSignal[];
    scanned: number;
    duration: number;
    timestamp: string;
  }> {
    this.setExchange(exchange).setStrategy('DAILY_REAPPROACH');
    const startTime = Date.now();
    this.logWithContext('Starting daily reapproach scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols(
      this.currentExchange as ExchangeName,
    );
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logWithContext(`Scanning ${symbols.length} symbols for reapproach...`);

    const allReapproach: ReapproachSignal[] = [];
    const endTime = Date.now();
    const analysisStart = endTime - 24 * 60 * 60 * 1000;

    const batchSize = 5;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((symbol) =>
          Promise.all([
            this.marketSignalService.analyzeSymbol(
              symbol,
              analysisStart,
              endTime,
              this.currentExchange,
            ),
            this.getReapproachData(symbol),
          ])
            .then(([analysis, reapproach]) => {
              if (!reapproach.maReapproach) return null;
              const tf1h = analysis.timeframes.find(
                (t) => t.timeframe === '1h',
              );
              return {
                symbol,
                score: analysis.finalScore,
                signal: analysis.finalSignal,
                priceChange: tf1h?.priceChange ?? 0,
                oiChange: tf1h?.oiChange ?? 0,
                maReapproach: reapproach.maReapproach,
                breakoutDay: reapproach.breakoutDay,
                currentDistance: reapproach.currentDistance,
                priceVsEma50: reapproach.priceVsEma50,
                currentPrice: reapproach.currentPrice,
                ema50: reapproach.ema50,
              };
            })
            .catch(() => null),
        ),
      );

      for (const result of batchResults) {
        if (result) allReapproach.push(result);
      }
    }

    const longs = allReapproach
      .filter((r) => r.maReapproach === 'BULLISH_REAPPROACH')
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const shorts = allReapproach
      .filter((r) => r.maReapproach === 'BEARISH_REAPPROACH')
      .sort((a, b) => a.score - b.score)
      .slice(0, limit);

    const all = [...allReapproach].sort((a, b) => b.score - a.score);

    const duration = Date.now() - startTime;
    this.logWithContext(
      `Reapproach scan complete: ${longs.length} bullish, ${shorts.length} bearish in ${duration}ms`,
    );

    return {
      longs,
      shorts,
      all,
      scanned: symbols.length,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  private async getPullbackDataWeekly(symbol: string): Promise<{
    maPullback: 'BULLISH_PULLBACK' | 'BEARISH_PULLBACK' | null;
    maPullbackTouches: number;
    priceVsEma50: number | null;
    currentPrice: number;
    ema50: number | null;
  }> {
    try {
      const endTime = Date.now();
      const startTime = endTime - 350 * 24 * 60 * 60 * 1000;
      const klines = await this.getKlines(symbol, '1w', startTime, endTime);

      if (klines.length < 50) {
        return {
          maPullback: null,
          maPullbackTouches: 0,
          priceVsEma50: null,
          currentPrice: 0,
          ema50: null,
        };
      }

      const closePrices = klines.map((k) => parseFloat(k[4]));
      const currentPrice = closePrices[closePrices.length - 1];
      const ema50 = this.calculateEMA(closePrices, 50);
      const ema50Series = this.calculateEMASeries(closePrices, 50);

      const priceVsEma50 = ema50
        ? ((currentPrice - ema50) / ema50) * 100
        : null;
      const pullback = this.detectPullback(klines, ema50Series);

      return {
        maPullback: pullback.maPullback,
        maPullbackTouches: pullback.maPullbackTouches,
        priceVsEma50,
        currentPrice,
        ema50,
      };
    } catch {
      return {
        maPullback: null,
        maPullbackTouches: 0,
        priceVsEma50: null,
        currentPrice: 0,
        ema50: null,
      };
    }
  }

  private async getReapproachDataWeekly(symbol: string): Promise<{
    maReapproach: 'BULLISH_REAPPROACH' | 'BEARISH_REAPPROACH' | null;
    breakoutDay: number | null;
    currentDistance: number | null;
    priceVsEma50: number | null;
    currentPrice: number;
    ema50: number | null;
  }> {
    try {
      const endTime = Date.now();
      const startTime = endTime - 350 * 24 * 60 * 60 * 1000;
      const klines = await this.getKlines(symbol, '1w', startTime, endTime);

      if (klines.length < 50) {
        return {
          maReapproach: null,
          breakoutDay: null,
          currentDistance: null,
          priceVsEma50: null,
          currentPrice: 0,
          ema50: null,
        };
      }

      const closePrices = klines.map((k) => parseFloat(k[4]));
      const currentPrice = closePrices[closePrices.length - 1];
      const ema50 = this.calculateEMA(closePrices, 50);
      const ema50Series = this.calculateEMASeries(closePrices, 50);

      const priceVsEma50 = ema50
        ? ((currentPrice - ema50) / ema50) * 100
        : null;
      const reapproach = this.detectReapproach(klines, ema50Series);

      return {
        maReapproach: reapproach.maReapproach,
        breakoutDay: reapproach.breakoutDay,
        currentDistance: reapproach.currentDistance,
        priceVsEma50,
        currentPrice,
        ema50,
      };
    } catch {
      return {
        maReapproach: null,
        breakoutDay: null,
        currentDistance: null,
        priceVsEma50: null,
        currentPrice: 0,
        ema50: null,
      };
    }
  }

  private async getPullbackData4h(symbol: string): Promise<{
    maPullback: 'BULLISH_PULLBACK' | 'BEARISH_PULLBACK' | null;
    maPullbackTouches: number;
    priceVsEma50: number | null;
    currentPrice: number;
    ema50: number | null;
  }> {
    try {
      const endTime = Date.now();
      const startTime = endTime - 30 * 24 * 60 * 60 * 1000;
      const klines = await this.getKlines(symbol, '4h', startTime, endTime);

      if (klines.length < 50) {
        return {
          maPullback: null,
          maPullbackTouches: 0,
          priceVsEma50: null,
          currentPrice: 0,
          ema50: null,
        };
      }

      const closePrices = klines.map((k) => parseFloat(k[4]));
      const currentPrice = closePrices[closePrices.length - 1];
      const ema50 = this.calculateEMA(closePrices, 50);
      const ema50Series = this.calculateEMASeries(closePrices, 50);

      const priceVsEma50 = ema50
        ? ((currentPrice - ema50) / ema50) * 100
        : null;
      const pullback = this.detectPullback4h(klines, ema50Series);

      return {
        maPullback: pullback.maPullback,
        maPullbackTouches: pullback.maPullbackTouches,
        priceVsEma50,
        currentPrice,
        ema50,
      };
    } catch {
      return {
        maPullback: null,
        maPullbackTouches: 0,
        priceVsEma50: null,
        currentPrice: 0,
        ema50: null,
      };
    }
  }

  private detectPullback4h(
    klines: unknown[][],
    emaValues: (number | null)[],
  ): {
    maPullback: 'BULLISH_PULLBACK' | 'BEARISH_PULLBACK' | null;
    maPullbackTouches: number;
  } {
    const TOUCH_THRESHOLD = 0.015;
    const LOOKBACK = 120;

    if (klines.length < LOOKBACK || emaValues.length < LOOKBACK) {
      return { maPullback: null, maPullbackTouches: 0 };
    }

    const closePrices = klines.map((k) => parseFloat(k[4] as string));
    const recentCloses = closePrices.slice(-LOOKBACK);
    const recentEma = emaValues.slice(-LOOKBACK);

    let touchCount = 0;
    for (let i = 0; i < recentCloses.length; i++) {
      const price = recentCloses[i];
      const ema = recentEma[i];
      if (!ema) continue;
      const distance = Math.abs(price - ema) / ema;
      if (distance <= TOUCH_THRESHOLD) {
        touchCount++;
      }
    }

    if (touchCount < 2) {
      return { maPullback: null, maPullbackTouches: touchCount };
    }

    const currentPrice = recentCloses[recentCloses.length - 1];
    const currentEma = recentEma[recentEma.length - 1];
    if (!currentEma) {
      return { maPullback: null, maPullbackTouches: touchCount };
    }

    const priceBeforeMove = closePrices[closePrices.length - LOOKBACK];
    const priceDirection = currentPrice - priceBeforeMove;
    const priceDirectionPercent = (priceDirection / priceBeforeMove) * 100;

    if (Math.abs(priceDirectionPercent) < 3) {
      return { maPullback: null, maPullbackTouches: touchCount };
    }

    const isAboveEma = currentPrice > currentEma;

    if (priceDirectionPercent < -3 && !isAboveEma) {
      return { maPullback: 'BEARISH_PULLBACK', maPullbackTouches: touchCount };
    }

    if (priceDirectionPercent > 3 && isAboveEma) {
      return { maPullback: 'BULLISH_PULLBACK', maPullbackTouches: touchCount };
    }

    return { maPullback: null, maPullbackTouches: touchCount };
  }

  async scanForPullbacks4h(
    limit = 20,
    exchange: string = 'BINANCE',
  ): Promise<PullbackResult> {
    this.setExchange(exchange).setStrategy('4H_PULLBACK');
    const startTime = Date.now();
    this.logWithContext('Starting 4H pullback scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols(
      this.currentExchange as ExchangeName,
    );
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logWithContext(
      `Scanning ${symbols.length} symbols for 4h pullbacks...`,
    );

    const allPullbacks: PullbackSignal[] = [];
    const endTime = Date.now();
    const analysisStart = endTime - 24 * 60 * 60 * 1000;

    const batchSize = 5;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((symbol) =>
          Promise.all([
            this.marketSignalService.analyzeSymbol(
              symbol,
              analysisStart,
              endTime,
              this.currentExchange,
            ),
            this.getPullbackData4h(symbol),
          ])
            .then(([analysis, pullback]) => {
              if (!pullback.maPullback) return null;
              const tf1h = analysis.timeframes.find(
                (t) => t.timeframe === '1h',
              );
              return {
                symbol,
                score: analysis.finalScore,
                signal: analysis.finalSignal,
                priceChange: tf1h?.priceChange ?? 0,
                oiChange: tf1h?.oiChange ?? 0,
                maPullback: pullback.maPullback,
                maPullbackTouches: pullback.maPullbackTouches,
                priceVsEma50: pullback.priceVsEma50,
                currentPrice: pullback.currentPrice,
                ema50: pullback.ema50,
              };
            })
            .catch(() => null),
        ),
      );

      for (const result of batchResults) {
        if (result) allPullbacks.push(result);
      }
    }

    const longs = allPullbacks
      .filter((r) => r.maPullback === 'BULLISH_PULLBACK')
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const shorts = allPullbacks
      .filter((r) => r.maPullback === 'BEARISH_PULLBACK')
      .sort((a, b) => a.score - b.score)
      .slice(0, limit);

    const all = [...allPullbacks].sort((a, b) => b.score - a.score);

    const duration = Date.now() - startTime;
    this.logWithContext(
      `4h pullback scan complete: ${longs.length} bullish, ${shorts.length} bearish in ${duration}ms`,
    );

    return {
      longs,
      shorts,
      all,
      scanned: symbols.length,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  private async getReapproachData4h(symbol: string): Promise<{
    maReapproach: 'BULLISH_REAPPROACH' | 'BEARISH_REAPPROACH' | null;
    breakoutDay: number | null;
    currentDistance: number | null;
    priceVsEma50: number | null;
    currentPrice: number;
    ema50: number | null;
  }> {
    try {
      const endTime = Date.now();
      const startTime = endTime - 30 * 24 * 60 * 60 * 1000;
      const klines = await this.getKlines(symbol, '4h', startTime, endTime);

      if (klines.length < 50) {
        return {
          maReapproach: null,
          breakoutDay: null,
          currentDistance: null,
          priceVsEma50: null,
          currentPrice: 0,
          ema50: null,
        };
      }

      const closePrices = klines.map((k) => parseFloat(k[4]));
      const currentPrice = closePrices[closePrices.length - 1];
      const ema50 = this.calculateEMA(closePrices, 50);
      const ema50Series = this.calculateEMASeries(closePrices, 50);

      const priceVsEma50 = ema50
        ? ((currentPrice - ema50) / ema50) * 100
        : null;
      const reapproach = this.detectReapproach4h(klines, ema50Series);

      return {
        maReapproach: reapproach.maReapproach,
        breakoutDay: reapproach.breakoutDay,
        currentDistance: reapproach.currentDistance,
        priceVsEma50,
        currentPrice,
        ema50,
      };
    } catch {
      return {
        maReapproach: null,
        breakoutDay: null,
        currentDistance: null,
        priceVsEma50: null,
        currentPrice: 0,
        ema50: null,
      };
    }
  }

  private detectReapproach4h(
    klines: unknown[][],
    emaValues: (number | null)[],
  ): {
    maReapproach: 'BULLISH_REAPPROACH' | 'BEARISH_REAPPROACH' | null;
    breakoutDay: number | null;
    currentDistance: number | null;
  } {
    const APPROACH_THRESHOLD = 0.03;
    const BREAKOUT_THRESHOLD = 0.02;
    const LOOKBACK = 90;

    if (klines.length < LOOKBACK || emaValues.length < LOOKBACK) {
      return { maReapproach: null, breakoutDay: null, currentDistance: null };
    }

    const closePrices = klines.map((k) => parseFloat(k[4] as string));
    const currentPrice = closePrices[closePrices.length - 1];
    const currentEma = emaValues[emaValues.length - 1];

    if (!currentEma) {
      return { maReapproach: null, breakoutDay: null, currentDistance: null };
    }

    const currentDistance = (currentPrice - currentEma) / currentEma;

    if (Math.abs(currentDistance) > APPROACH_THRESHOLD) {
      return { maReapproach: null, breakoutDay: null, currentDistance: null };
    }

    let breakoutDay: number | null = null;
    for (let i = closePrices.length - LOOKBACK; i < closePrices.length; i++) {
      const price = closePrices[i];
      const ema = emaValues[i];
      if (!ema) continue;
      const distance = (price - ema) / ema;
      if (Math.abs(distance) > BREAKOUT_THRESHOLD) {
        breakoutDay = i;
        break;
      }
    }

    if (breakoutDay === null) {
      return { maReapproach: null, breakoutDay: null, currentDistance: null };
    }

    const isAboveEma = currentPrice > currentEma;
    const priceAtBreakout = closePrices[breakoutDay];
    const emaAtBreakout = emaValues[breakoutDay];

    if (!emaAtBreakout) {
      return { maReapproach: null, breakoutDay: null, currentDistance: null };
    }

    const wasAboveAtBreakout = priceAtBreakout > emaAtBreakout;

    if (isAboveEma && !wasAboveAtBreakout) {
      return {
        maReapproach: 'BULLISH_REAPPROACH',
        breakoutDay,
        currentDistance,
      };
    }

    if (!isAboveEma && wasAboveAtBreakout) {
      return {
        maReapproach: 'BEARISH_REAPPROACH',
        breakoutDay,
        currentDistance,
      };
    }

    return { maReapproach: null, breakoutDay: null, currentDistance: null };
  }

  async scanForReapproach4h(
    limit = 20,
    exchange: string = 'BINANCE',
  ): Promise<{
    longs: ReapproachSignal[];
    shorts: ReapproachSignal[];
    all: ReapproachSignal[];
    scanned: number;
    duration: number;
    timestamp: string;
  }> {
    this.setExchange(exchange).setStrategy('4H_REAPPROACH');
    const startTime = Date.now();
    this.logWithContext('Starting 4H reapproach scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols(
      this.currentExchange as ExchangeName,
    );
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logWithContext(
      `Scanning ${symbols.length} symbols for 4h reapproach...`,
    );

    const allReapproach: ReapproachSignal[] = [];
    const endTime = Date.now();
    const analysisStart = endTime - 24 * 60 * 60 * 1000;

    const batchSize = 5;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((symbol) =>
          Promise.all([
            this.marketSignalService.analyzeSymbol(
              symbol,
              analysisStart,
              endTime,
              this.currentExchange,
            ),
            this.getReapproachData4h(symbol),
          ])
            .then(([analysis, reapproach]) => {
              if (!reapproach.maReapproach) return null;
              const tf1h = analysis.timeframes.find(
                (t) => t.timeframe === '1h',
              );
              return {
                symbol,
                score: analysis.finalScore,
                signal: analysis.finalSignal,
                priceChange: tf1h?.priceChange ?? 0,
                oiChange: tf1h?.oiChange ?? 0,
                maReapproach: reapproach.maReapproach,
                breakoutDay: reapproach.breakoutDay,
                currentDistance: reapproach.currentDistance,
                priceVsEma50: reapproach.priceVsEma50,
                currentPrice: reapproach.currentPrice,
                ema50: reapproach.ema50,
              };
            })
            .catch(() => null),
        ),
      );

      for (const result of batchResults) {
        if (result) allReapproach.push(result);
      }
    }

    const longs = allReapproach
      .filter((r) => r.maReapproach === 'BULLISH_REAPPROACH')
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    const shorts = allReapproach
      .filter((r) => r.maReapproach === 'BEARISH_REAPPROACH')
      .sort((a, b) => a.score - b.score)
      .slice(0, limit);
    const all = [...allReapproach].sort((a, b) => b.score - a.score);

    const duration = Date.now() - startTime;
    this.logWithContext(
      `4h reapproach scan complete: ${longs.length} bullish, ${shorts.length} bearish in ${duration}ms`,
    );

    return {
      longs,
      shorts,
      all,
      scanned: symbols.length,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  async scanForPullbacksWeekly(
    limit = 20,
    exchange: string = 'BINANCE',
  ): Promise<PullbackResult> {
    this.setExchange(exchange).setStrategy('WEEKLY_PULLBACK');
    const startTime = Date.now();
    this.logWithContext('Starting weekly pullback scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols(
      this.currentExchange as ExchangeName,
    );
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logWithContext(
      `Scanning ${symbols.length} symbols for weekly pullbacks...`,
    );

    const allPullbacks: PullbackSignal[] = [];
    const endTime = Date.now();
    const analysisStart = endTime - 24 * 60 * 60 * 1000;

    const batchSize = 5;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((symbol) =>
          Promise.all([
            this.marketSignalService.analyzeSymbol(
              symbol,
              analysisStart,
              endTime,
              this.currentExchange,
            ),
            this.getPullbackDataWeekly(symbol),
          ])
            .then(([analysis, pullback]) => {
              if (!pullback.maPullback) return null;
              const tf1h = analysis.timeframes.find(
                (t) => t.timeframe === '1h',
              );
              return {
                symbol,
                score: analysis.finalScore,
                signal: analysis.finalSignal,
                priceChange: tf1h?.priceChange ?? 0,
                oiChange: tf1h?.oiChange ?? 0,
                maPullback: pullback.maPullback,
                maPullbackTouches: pullback.maPullbackTouches,
                priceVsEma50: pullback.priceVsEma50,
                currentPrice: pullback.currentPrice,
                ema50: pullback.ema50,
              };
            })
            .catch(() => null),
        ),
      );

      for (const result of batchResults) {
        if (result) allPullbacks.push(result);
      }
    }

    const longs = allPullbacks
      .filter((r) => r.maPullback === 'BULLISH_PULLBACK')
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    const shorts = allPullbacks
      .filter((r) => r.maPullback === 'BEARISH_PULLBACK')
      .sort((a, b) => a.score - b.score)
      .slice(0, limit);
    const all = [...allPullbacks].sort((a, b) => b.score - a.score);

    const duration = Date.now() - startTime;
    this.logWithContext(
      `Weekly pullback scan complete: ${longs.length} bullish, ${shorts.length} bearish in ${duration}ms`,
    );

    return {
      longs,
      shorts,
      all,
      scanned: symbols.length,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  async scanForReapproachWeekly(
    limit = 20,
    exchange: string = 'BINANCE',
  ): Promise<{
    longs: ReapproachSignal[];
    shorts: ReapproachSignal[];
    all: ReapproachSignal[];
    scanned: number;
    duration: number;
    timestamp: string;
  }> {
    this.setExchange(exchange).setStrategy('WEEKLY_REAPPROACH');
    const startTime = Date.now();
    this.logWithContext('Starting weekly reapproach scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols(
      this.currentExchange as ExchangeName,
    );
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    const endTime = Date.now();
    const analysisStart = endTime - 24 * 60 * 60 * 1000;

    const allReapproach: ReapproachSignal[] = [];
    const batchSize = 5;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((symbol) =>
          Promise.all([
            this.marketSignalService.analyzeSymbol(
              symbol,
              analysisStart,
              endTime,
              this.currentExchange,
            ),
            this.getReapproachDataWeekly(symbol),
          ])
            .then(([analysis, reapproach]) => {
              if (!reapproach.maReapproach) return null;
              const tf1h = analysis.timeframes.find(
                (t) => t.timeframe === '1h',
              );
              return {
                symbol,
                score: analysis.finalScore,
                signal: analysis.finalSignal,
                priceChange: tf1h?.priceChange ?? 0,
                oiChange: tf1h?.oiChange ?? 0,
                maReapproach: reapproach.maReapproach,
                breakoutDay: reapproach.breakoutDay,
                currentDistance: reapproach.currentDistance,
                priceVsEma50: reapproach.priceVsEma50,
                currentPrice: reapproach.currentPrice,
                ema50: reapproach.ema50,
              };
            })
            .catch(() => null),
        ),
      );

      for (const result of batchResults) {
        if (result) allReapproach.push(result);
      }
    }

    const longs = allReapproach
      .filter((r) => r.maReapproach === 'BULLISH_REAPPROACH')
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    const shorts = allReapproach
      .filter((r) => r.maReapproach === 'BEARISH_REAPPROACH')
      .sort((a, b) => a.score - b.score)
      .slice(0, limit);
    const all = [...allReapproach].sort((a, b) => b.score - a.score);

    const duration = Date.now() - startTime;
    this.logWithContext(
      `Weekly reapproach scan complete: ${longs.length} bullish, ${shorts.length} bearish in ${duration}ms`,
    );

    return {
      longs,
      shorts,
      all,
      scanned: symbols.length,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  async scanForWeeklyAboveEma50(
    limit = 30,
    exchange: string = 'BINANCE',
  ): Promise<{
    symbols: Array<{
      symbol: string;
      priceVsEma50: number | null;
      currentPrice: number;
      ema50: number | null;
    }>;
    scanned: number;
    duration: number;
    timestamp: string;
  }> {
    this.setExchange(exchange).setStrategy('WEEKLY_EMA50');
    const startTime = Date.now();
    this.logWithContext('Starting weekly above EMA50 scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols(
      this.currentExchange as ExchangeName,
    );
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logWithContext(
      `Scanning ${symbols.length} symbols for weekly above EMA50...`,
    );

    const results: Array<{
      symbol: string;
      priceVsEma50: number | null;
      currentPrice: number;
      ema50: number | null;
    }> = [];
    const endTime = Date.now();
    const analysisStart = endTime - 24 * 60 * 60 * 1000;

    const batchSize = 10;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((symbol) =>
          this.getWeeklyAboveEma50(symbol)
            .then((data) => {
              if (!data.aboveEma50) return null;
              return {
                symbol,
                priceVsEma50: data.priceVsEma50,
                currentPrice: data.currentPrice,
                ema50: data.ema50,
              };
            })
            .catch(() => null),
        ),
      );

      for (const result of batchResults) {
        if (result) results.push(result);
      }
    }

    results.sort((a, b) => (b.priceVsEma50 ?? 0) - (a.priceVsEma50 ?? 0));

    const duration = Date.now() - startTime;
    this.logWithContext(
      `Weekly above EMA50 scan complete: ${results.length} symbols found in ${duration}ms`,
    );

    return {
      symbols: results.slice(0, limit),
      scanned: symbols.length,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  private async getWeeklyAboveEma21(symbol: string): Promise<{
    aboveEma21: boolean;
    priceVsEma21: number | null;
    currentPrice: number;
    ema21: number | null;
  }> {
    try {
      const endTime = Date.now();
      const startTime = endTime - 200 * 24 * 60 * 60 * 1000;
      const klines = await this.getKlines(symbol, '1w', startTime, endTime);

      if (klines.length < 21) {
        return {
          aboveEma21: false,
          priceVsEma21: null,
          currentPrice: 0,
          ema21: null,
        };
      }

      const closePrices = klines.map((k) => parseFloat(k[4]));
      const currentPrice = closePrices[closePrices.length - 1];
      const ema21 = this.calculateEMA(closePrices, 21);

      if (!ema21) {
        return {
          aboveEma21: false,
          priceVsEma21: null,
          currentPrice,
          ema21: null,
        };
      }

      const priceVsEma21 = ((currentPrice - ema21) / ema21) * 100;
      const aboveEma21 = currentPrice > ema21;

      return { aboveEma21, priceVsEma21, currentPrice, ema21 };
    } catch {
      return {
        aboveEma21: false,
        priceVsEma21: null,
        currentPrice: 0,
        ema21: null,
      };
    }
  }

  async scanForWeeklyAboveEma21(
    limit = 50,
    exchange: string = 'BINANCE',
  ): Promise<{
    symbols: Array<{
      symbol: string;
      priceVsEma21: number | null;
      currentPrice: number;
      ema21: number | null;
    }>;
    scanned: number;
    duration: number;
    timestamp: string;
  }> {
    this.setExchange(exchange).setStrategy('WEEKLY_EMA21');
    const startTime = Date.now();
    this.logWithContext('Starting weekly above EMA21 scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols(
      this.currentExchange as ExchangeName,
    );
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logWithContext(
      `Scanning ${symbols.length} symbols for weekly above EMA21...`,
    );

    const results: Array<{
      symbol: string;
      priceVsEma21: number | null;
      currentPrice: number;
      ema21: number | null;
    }> = [];

    const batchSize = 10;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((symbol) =>
          this.getWeeklyAboveEma21(symbol)
            .then((data) => {
              if (!data.aboveEma21) return null;
              return {
                symbol,
                priceVsEma21: data.priceVsEma21,
                currentPrice: data.currentPrice,
                ema21: data.ema21,
              };
            })
            .catch(() => null),
        ),
      );

      for (const result of batchResults) {
        if (result) results.push(result);
      }
    }

    results.sort((a, b) => (b.priceVsEma21 ?? 0) - (a.priceVsEma21 ?? 0));

    const duration = Date.now() - startTime;
    this.logWithContext(
      `Weekly above EMA21 scan complete: ${results.length} symbols found in ${duration}ms`,
    );

    return {
      symbols: results.slice(0, limit),
      scanned: symbols.length,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  async scanForDailyAboveEma50WithLong(
    limit = 20,
    exchange: string = 'BINANCE',
  ): Promise<{
    symbols: Array<{
      symbol: string;
      priceVsEma50: number | null;
      currentPrice: number;
      ema50: number | null;
      score: number;
      signal: string;
      confidence: number;
      priceChange: number;
      oiChange: number;
      fundingRate: number;
    }>;
    scanned: number;
    duration: number;
    timestamp: string;
  }> {
    this.setExchange(exchange).setStrategy('DAILY_EMA50_LONG');
    const startTime = Date.now();
    this.logWithContext('Starting daily EMA50 long signal scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols(
      this.currentExchange as ExchangeName,
    );
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logWithContext(
      `Scanning ${symbols.length} symbols for daily above EMA50 with long conditions...`,
    );

    const results: Array<{
      symbol: string;
      priceVsEma50: number | null;
      currentPrice: number;
      ema50: number | null;
      score: number;
      signal: string;
      confidence: number;
      priceChange: number;
      oiChange: number;
      fundingRate: number;
    }> = [];
    const endTime = Date.now();
    const analysisStart = endTime - 24 * 60 * 60 * 1000;

    const batchSize = 5;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((symbol) =>
          Promise.all([
            this.marketSignalService.analyzeSymbol(
              symbol,
              analysisStart,
              endTime,
              this.currentExchange,
            ),
            this.getMovingAverages(symbol),
          ])
            .then(([analysis, mas]) => {
              if (mas.maSignal !== 'ABOVE') return null;
              if (
                analysis.finalSignal !== 'LONG' &&
                analysis.finalSignal !== 'STRONG_LONG'
              )
                return null;

              const tf1h = analysis.timeframes.find(
                (t) => t.timeframe === '1h',
              );
              return {
                symbol,
                priceVsEma50: mas.priceVsSma50,
                currentPrice: mas.sma50
                  ? mas.sma50 * (1 + (mas.priceVsSma50 ?? 0) / 100)
                  : 0,
                ema50: mas.sma50,
                score: analysis.finalScore,
                signal: analysis.finalSignal,
                confidence: analysis.confidence,
                priceChange: tf1h?.priceChange ?? 0,
                oiChange: tf1h?.oiChange ?? 0,
                fundingRate: tf1h?.fundingRate ?? 0,
              };
            })
            .catch(() => null),
        ),
      );

      for (const result of batchResults) {
        if (result) results.push(result);
      }
    }

    results.sort((a, b) => b.score - a.score);

    const duration = Date.now() - startTime;
    this.logWithContext(
      `Daily above EMA50 with long scan complete: ${results.length} symbols found in ${duration}ms`,
    );

    return {
      symbols: results.slice(0, limit),
      scanned: symbols.length,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  async scanForWeeklyAboveEma50WithLong(
    limit = 20,
    exchange: string = 'BINANCE',
  ): Promise<{
    symbols: Array<{
      symbol: string;
      priceVsEma50: number | null;
      currentPrice: number;
      ema50: number | null;
      score: number;
      signal: string;
      confidence: number;
      priceChange: number;
      oiChange: number;
      fundingRate: number;
    }>;
    scanned: number;
    duration: number;
    timestamp: string;
  }> {
    this.setExchange(exchange).setStrategy('WEEKLY_EMA50_LONG');
    const startTime = Date.now();
    this.logWithContext('Starting weekly EMA50 long signal scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols(
      this.currentExchange as ExchangeName,
    );
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logWithContext(
      `Scanning ${symbols.length} symbols for weekly above EMA50 with long conditions...`,
    );

    const results: Array<{
      symbol: string;
      priceVsEma50: number | null;
      currentPrice: number;
      ema50: number | null;
      score: number;
      signal: string;
      confidence: number;
      priceChange: number;
      oiChange: number;
      fundingRate: number;
    }> = [];
    const endTime = Date.now();
    const analysisStart = endTime - 24 * 60 * 60 * 1000;

    const batchSize = 5;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((symbol) =>
          Promise.all([
            this.marketSignalService.analyzeSymbol(
              symbol,
              analysisStart,
              endTime,
              this.currentExchange,
            ),
            this.getWeeklyAboveEma50(symbol),
          ])
            .then(([analysis, weeklyEma]) => {
              if (!weeklyEma.aboveEma50) return null;
              if (
                analysis.finalSignal !== 'LONG' &&
                analysis.finalSignal !== 'STRONG_LONG'
              )
                return null;

              const tf1h = analysis.timeframes.find(
                (t) => t.timeframe === '1h',
              );
              return {
                symbol,
                priceVsEma50: weeklyEma.priceVsEma50,
                currentPrice: weeklyEma.currentPrice,
                ema50: weeklyEma.ema50,
                score: analysis.finalScore,
                signal: analysis.finalSignal,
                confidence: analysis.confidence,
                priceChange: tf1h?.priceChange ?? 0,
                oiChange: tf1h?.oiChange ?? 0,
                fundingRate: tf1h?.fundingRate ?? 0,
              };
            })
            .catch(() => null),
        ),
      );

      for (const result of batchResults) {
        if (result) results.push(result);
      }
    }

    results.sort((a, b) => b.score - a.score);

    const duration = Date.now() - startTime;
    this.logWithContext(
      `Weekly above EMA50 with long scan complete: ${results.length} symbols found in ${duration}ms`,
    );

    return {
      symbols: results.slice(0, limit),
      scanned: symbols.length,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  private async getPullbackDataMonthly(symbol: string): Promise<{
    maPullback: 'BULLISH_PULLBACK' | 'BEARISH_PULLBACK' | null;
    maPullbackTouches: number;
    priceVsEma50: number | null;
    currentPrice: number;
    ema50: number | null;
  }> {
    try {
      const endTime = Date.now();
      const startTime = endTime - 365 * 24 * 60 * 60 * 1000;
      const klines = await this.getKlines(symbol, '1M', startTime, endTime);

      if (klines.length < 50) {
        return {
          maPullback: null,
          maPullbackTouches: 0,
          priceVsEma50: null,
          currentPrice: 0,
          ema50: null,
        };
      }

      const closePrices = klines.map((k) => parseFloat(k[4]));
      const currentPrice = closePrices[closePrices.length - 1];
      const ema50 = this.calculateEMA(closePrices, 50);
      const ema50Series = this.calculateEMASeries(closePrices, 50);

      const priceVsEma50 = ema50
        ? ((currentPrice - ema50) / ema50) * 100
        : null;
      const pullback = this.detectPullbackMonthly(klines, ema50Series);

      return {
        maPullback: pullback.maPullback,
        maPullbackTouches: pullback.maPullbackTouches,
        priceVsEma50,
        currentPrice,
        ema50,
      };
    } catch {
      return {
        maPullback: null,
        maPullbackTouches: 0,
        priceVsEma50: null,
        currentPrice: 0,
        ema50: null,
      };
    }
  }

  private detectPullbackMonthly(
    klines: unknown[][],
    emaValues: (number | null)[],
  ): {
    maPullback: 'BULLISH_PULLBACK' | 'BEARISH_PULLBACK' | null;
    maPullbackTouches: number;
  } {
    const TOUCH_THRESHOLD = 0.015;
    const LOOKBACK = 20;

    if (klines.length < LOOKBACK || emaValues.length < LOOKBACK) {
      return { maPullback: null, maPullbackTouches: 0 };
    }

    const closePrices = klines.map((k) => parseFloat(k[4] as string));
    const recentCloses = closePrices.slice(-LOOKBACK);
    const recentEma = emaValues.slice(-LOOKBACK);

    let touchCount = 0;
    for (let i = 0; i < recentCloses.length; i++) {
      const price = recentCloses[i];
      const ema = recentEma[i];
      if (!ema) continue;
      const distance = Math.abs(price - ema) / ema;
      if (distance <= TOUCH_THRESHOLD) {
        touchCount++;
      }
    }

    if (touchCount < 2) {
      return { maPullback: null, maPullbackTouches: touchCount };
    }

    const currentPrice = recentCloses[recentCloses.length - 1];
    const currentEma = recentEma[recentEma.length - 1];
    if (!currentEma) {
      return { maPullback: null, maPullbackTouches: touchCount };
    }

    const priceBeforeMove = closePrices[closePrices.length - LOOKBACK];
    const priceDirection = currentPrice - priceBeforeMove;
    const priceDirectionPercent = (priceDirection / priceBeforeMove) * 100;

    if (Math.abs(priceDirectionPercent) < 3) {
      return { maPullback: null, maPullbackTouches: touchCount };
    }

    const isAboveEma = currentPrice > currentEma;

    if (priceDirectionPercent < -3 && !isAboveEma) {
      return { maPullback: 'BEARISH_PULLBACK', maPullbackTouches: touchCount };
    }

    if (priceDirectionPercent > 3 && isAboveEma) {
      return { maPullback: 'BULLISH_PULLBACK', maPullbackTouches: touchCount };
    }

    return { maPullback: null, maPullbackTouches: touchCount };
  }

  async scanForPullbacksMonthly(
    limit = 20,
    exchange: string = 'BINANCE',
  ): Promise<PullbackResult> {
    this.setExchange(exchange).setStrategy('MONTHLY_PULLBACK');
    const startTime = Date.now();
    this.logWithContext('Starting monthly pullback scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols(
      this.currentExchange as ExchangeName,
    );
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logWithContext(
      `Scanning ${symbols.length} symbols for monthly pullbacks...`,
    );

    const allPullbacks: PullbackSignal[] = [];
    const endTime = Date.now();
    const analysisStart = endTime - 24 * 60 * 60 * 1000;

    const batchSize = 5;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((symbol) =>
          Promise.all([
            this.marketSignalService.analyzeSymbol(
              symbol,
              analysisStart,
              endTime,
              this.currentExchange,
            ),
            this.getPullbackDataMonthly(symbol),
          ])
            .then(([analysis, pullback]) => {
              if (!pullback.maPullback) return null;
              const tf1h = analysis.timeframes.find(
                (t) => t.timeframe === '1h',
              );
              return {
                symbol,
                score: analysis.finalScore,
                signal: analysis.finalSignal,
                priceChange: tf1h?.priceChange ?? 0,
                oiChange: tf1h?.oiChange ?? 0,
                maPullback: pullback.maPullback,
                maPullbackTouches: pullback.maPullbackTouches,
                priceVsEma50: pullback.priceVsEma50,
                currentPrice: pullback.currentPrice,
                ema50: pullback.ema50,
              };
            })
            .catch(() => null),
        ),
      );

      for (const result of batchResults) {
        if (result) allPullbacks.push(result);
      }
    }

    const longs = allPullbacks
      .filter((r) => r.maPullback === 'BULLISH_PULLBACK')
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const shorts = allPullbacks
      .filter((r) => r.maPullback === 'BEARISH_PULLBACK')
      .sort((a, b) => a.score - b.score)
      .slice(0, limit);

    const all = [...allPullbacks].sort((a, b) => b.score - a.score);

    const duration = Date.now() - startTime;
    this.logWithContext(
      `Monthly pullback scan complete: ${longs.length} bullish, ${shorts.length} bearish in ${duration}ms`,
    );

    return {
      longs,
      shorts,
      all,
      scanned: symbols.length,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  private async getReapproachDataMonthly(symbol: string): Promise<{
    maReapproach: 'BULLISH_REAPPROACH' | 'BEARISH_REAPPROACH' | null;
    breakoutDay: number | null;
    currentDistance: number | null;
    priceVsEma50: number | null;
    currentPrice: number;
    ema50: number | null;
  }> {
    try {
      const endTime = Date.now();
      const startTime = endTime - 365 * 24 * 60 * 60 * 1000;
      const klines = await this.getKlines(symbol, '1M', startTime, endTime);

      if (klines.length < 50) {
        return {
          maReapproach: null,
          breakoutDay: null,
          currentDistance: null,
          priceVsEma50: null,
          currentPrice: 0,
          ema50: null,
        };
      }

      const closePrices = klines.map((k) => parseFloat(k[4]));
      const currentPrice = closePrices[closePrices.length - 1];
      const ema50 = this.calculateEMA(closePrices, 50);
      const ema50Series = this.calculateEMASeries(closePrices, 50);

      const priceVsEma50 = ema50
        ? ((currentPrice - ema50) / ema50) * 100
        : null;
      const reapproach = this.detectReapproachMonthly(klines, ema50Series);

      return {
        maReapproach: reapproach.maReapproach,
        breakoutDay: reapproach.breakoutDay,
        currentDistance: reapproach.currentDistance,
        priceVsEma50,
        currentPrice,
        ema50,
      };
    } catch {
      return {
        maReapproach: null,
        breakoutDay: null,
        currentDistance: null,
        priceVsEma50: null,
        currentPrice: 0,
        ema50: null,
      };
    }
  }

  private detectReapproachMonthly(
    klines: unknown[][],
    emaValues: (number | null)[],
  ): {
    maReapproach: 'BULLISH_REAPPROACH' | 'BEARISH_REAPPROACH' | null;
    breakoutDay: number | null;
    currentDistance: number | null;
  } {
    const APPROACH_THRESHOLD = 0.03;
    const BREAKOUT_THRESHOLD = 0.02;
    const LOOKBACK = 12;

    if (klines.length < LOOKBACK || emaValues.length < LOOKBACK) {
      return { maReapproach: null, breakoutDay: null, currentDistance: null };
    }

    const closePrices = klines.map((k) => parseFloat(k[4] as string));
    const currentPrice = closePrices[closePrices.length - 1];
    const currentEma = emaValues[emaValues.length - 1];

    if (!currentEma) {
      return { maReapproach: null, breakoutDay: null, currentDistance: null };
    }

    const currentDistance = (currentPrice - currentEma) / currentEma;

    if (Math.abs(currentDistance) > APPROACH_THRESHOLD) {
      return { maReapproach: null, breakoutDay: null, currentDistance: null };
    }

    let breakoutDay: number | null = null;
    for (let i = closePrices.length - LOOKBACK; i < closePrices.length; i++) {
      const price = closePrices[i];
      const ema = emaValues[i];
      if (!ema) continue;
      const distance = (price - ema) / ema;
      if (Math.abs(distance) > BREAKOUT_THRESHOLD) {
        breakoutDay = i;
        break;
      }
    }

    if (breakoutDay === null) {
      return { maReapproach: null, breakoutDay: null, currentDistance: null };
    }

    const isAboveEma = currentPrice > currentEma;
    const priceAtBreakout = closePrices[breakoutDay];
    const emaAtBreakout = emaValues[breakoutDay];

    if (!emaAtBreakout) {
      return { maReapproach: null, breakoutDay: null, currentDistance: null };
    }

    const wasAboveAtBreakout = priceAtBreakout > emaAtBreakout;

    if (isAboveEma && !wasAboveAtBreakout) {
      return {
        maReapproach: 'BULLISH_REAPPROACH',
        breakoutDay,
        currentDistance,
      };
    }

    if (!isAboveEma && wasAboveAtBreakout) {
      return {
        maReapproach: 'BEARISH_REAPPROACH',
        breakoutDay,
        currentDistance,
      };
    }

    return { maReapproach: null, breakoutDay: null, currentDistance: null };
  }

  async scanForReapproachMonthly(
    limit = 20,
    exchange: string = 'BINANCE',
  ): Promise<{
    longs: ReapproachSignal[];
    shorts: ReapproachSignal[];
    all: ReapproachSignal[];
    scanned: number;
    duration: number;
    timestamp: string;
  }> {
    this.setExchange(exchange).setStrategy('MONTHLY_REAPPROACH');
    const startTime = Date.now();
    this.logWithContext('Starting monthly reapproach scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols(
      this.currentExchange as ExchangeName,
    );
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logWithContext(
      `Scanning ${symbols.length} symbols for monthly reapproach...`,
    );

    const allReapproach: ReapproachSignal[] = [];
    const endTime = Date.now();
    const analysisStart = endTime - 24 * 60 * 60 * 1000;

    const batchSize = 5;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((symbol) =>
          Promise.all([
            this.marketSignalService.analyzeSymbol(
              symbol,
              analysisStart,
              endTime,
              this.currentExchange,
            ),
            this.getReapproachDataMonthly(symbol),
          ])
            .then(([analysis, reapproach]) => {
              if (!reapproach.maReapproach) return null;
              const tf1h = analysis.timeframes.find(
                (t) => t.timeframe === '1h',
              );
              return {
                symbol,
                score: analysis.finalScore,
                signal: analysis.finalSignal,
                priceChange: tf1h?.priceChange ?? 0,
                oiChange: tf1h?.oiChange ?? 0,
                maReapproach: reapproach.maReapproach,
                breakoutDay: reapproach.breakoutDay,
                currentDistance: reapproach.currentDistance,
                priceVsEma50: reapproach.priceVsEma50,
                currentPrice: reapproach.currentPrice,
                ema50: reapproach.ema50,
              };
            })
            .catch(() => null),
        ),
      );

      for (const result of batchResults) {
        if (result) allReapproach.push(result);
      }
    }

    const longs = allReapproach
      .filter((r) => r.maReapproach === 'BULLISH_REAPPROACH')
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    const shorts = allReapproach
      .filter((r) => r.maReapproach === 'BEARISH_REAPPROACH')
      .sort((a, b) => a.score - b.score)
      .slice(0, limit);
    const all = [...allReapproach].sort((a, b) => b.score - a.score);

    const duration = Date.now() - startTime;
    this.logWithContext(
      `Monthly reapproach scan complete: ${longs.length} bullish, ${shorts.length} bearish in ${duration}ms`,
    );

    return {
      longs,
      shorts,
      all,
      scanned: symbols.length,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  async scanForPullbacksEma21(
    limit = 30,
    exchange: string = 'BINANCE',
    interval: '1d' | '4h' | '1w' = '1d',
  ): Promise<PullbackResult> {
    this.setExchange(exchange).setStrategy(
      `EMA21_PULLBACK_${interval.toUpperCase()}`,
    );
    const startTime = Date.now();
    this.logWithContext(`Starting EMA21 ${interval} pullback scan...`);

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols(
      this.currentExchange as ExchangeName,
    );
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logWithContext(
      `Scanning ${symbols.length} symbols for EMA21 ${interval} pullbacks...`,
    );

    const allPullbacks: PullbackSignal[] = [];
    const endTime = Date.now();
    const analysisStart =
      endTime -
      (interval === '1w'
        ? 7 * 24 * 60 * 60 * 1000
        : interval === '4h'
          ? 24 * 60 * 60 * 1000
          : 24 * 60 * 60 * 1000);

    const batchSize = 5;
    let processedCount = 0;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((symbol) =>
          Promise.all([
            this.marketSignalService.analyzeSymbol(
              symbol,
              analysisStart,
              endTime,
              this.currentExchange,
            ),
            this.getPullbackDataGeneric(symbol, interval, 21),
          ])
            .then(([analysis, pullback]) => {
              if (!pullback.maPullback) return null;
              const tf1h = analysis.timeframes.find(
                (t) => t.timeframe === '1h',
              );
              return {
                symbol,
                score: analysis.finalScore,
                signal: analysis.finalSignal,
                priceChange: tf1h?.priceChange ?? 0,
                oiChange: tf1h?.oiChange ?? 0,
                maPullback: pullback.maPullback,
                maPullbackTouches: pullback.maPullbackTouches,
                priceVsEma50: pullback.priceVsMa,
                currentPrice: pullback.currentPrice,
                ema50: pullback.ma,
              };
            })
            .catch(() => null),
        ),
      );

      for (const result of batchResults) {
        if (result) allPullbacks.push(result);
      }

      processedCount += batch.length;
      this.notificationGateway.sendScanProgress({
        current: processedCount,
        total: symbols.length,
        symbol: batch[batch.length - 1],
        scanType: `pullbacks-ema21-${interval}`,
      });
    }

    const longs = allPullbacks
      .filter((r) => r.maPullback === 'BULLISH_PULLBACK')
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const shorts = allPullbacks
      .filter((r) => r.maPullback === 'BEARISH_PULLBACK')
      .sort((a, b) => a.score - a.score)
      .slice(0, limit);

    const all = [...allPullbacks].sort((a, b) => b.score - a.score);

    const duration = Date.now() - startTime;
    this.logWithContext(
      `EMA21 ${interval} pullback scan complete: ${longs.length} bullish, ${shorts.length} bearish in ${duration}ms`,
    );

    return {
      longs,
      shorts,
      all,
      scanned: symbols.length,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  async scanForReapproachEma21(
    limit = 30,
    exchange: string = 'BINANCE',
    interval: '1d' | '4h' | '1w' = '1d',
  ): Promise<{
    longs: ReapproachSignal[];
    shorts: ReapproachSignal[];
    all: ReapproachSignal[];
    scanned: number;
    duration: number;
    timestamp: string;
  }> {
    this.setExchange(exchange).setStrategy(
      `EMA21_REAPPROACH_${interval.toUpperCase()}`,
    );
    const startTime = Date.now();
    this.logWithContext(`Starting EMA21 ${interval} reapproach scan...`);

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols(
      this.currentExchange as ExchangeName,
    );
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logWithContext(
      `Scanning ${symbols.length} symbols for EMA21 ${interval} reapproach...`,
    );

    const allReapproach: ReapproachSignal[] = [];
    const endTime = Date.now();
    const analysisStart =
      endTime -
      (interval === '1w' ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000);

    const batchSize = 5;
    let processedCount = 0;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((symbol) =>
          Promise.all([
            this.marketSignalService.analyzeSymbol(
              symbol,
              analysisStart,
              endTime,
              this.currentExchange,
            ),
            this.getReapproachDataGeneric(symbol, interval, 21),
          ])
            .then(([analysis, reapproach]) => {
              if (!reapproach.maReapproach) return null;
              const tf1h = analysis.timeframes.find(
                (t) => t.timeframe === '1h',
              );
              return {
                symbol,
                score: analysis.finalScore,
                signal: analysis.finalSignal,
                priceChange: tf1h?.priceChange ?? 0,
                oiChange: tf1h?.oiChange ?? 0,
                maReapproach: reapproach.maReapproach,
                breakoutDay: reapproach.breakoutDay,
                currentDistance: reapproach.currentDistance,
                priceVsEma50: reapproach.priceVsMa,
                currentPrice: reapproach.currentPrice,
                ema50: reapproach.ma,
              };
            })
            .catch(() => null),
        ),
      );

      for (const result of batchResults) {
        if (result) allReapproach.push(result);
      }

      processedCount += batch.length;
      this.notificationGateway.sendScanProgress({
        current: processedCount,
        total: symbols.length,
        symbol: batch[batch.length - 1],
        scanType: `reapproach-ema21-${interval}`,
      });
    }

    const longs = allReapproach
      .filter((r) => r.maReapproach === 'BULLISH_REAPPROACH')
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    const shorts = allReapproach
      .filter((r) => r.maReapproach === 'BEARISH_REAPPROACH')
      .sort((a, b) => a.score - b.score)
      .slice(0, limit);
    const all = [...allReapproach].sort((a, b) => b.score - a.score);

    const duration = Date.now() - startTime;
    this.logWithContext(
      `EMA21 ${interval} reapproach scan complete: ${longs.length} bullish, ${shorts.length} bearish in ${duration}ms`,
    );

    return {
      longs,
      shorts,
      all,
      scanned: symbols.length,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  async exportScan(
    type: string,
    exchange: string = 'BINANCE',
    limit = 50,
    interval?: string,
  ): Promise<string> {
    this.setExchange(exchange);
    let result: any;
    const tf = interval === '4h' || interval === '1w' ? interval : '1d';

    switch (type) {
      case 'signals':
        result = await this.scanMarket(limit, exchange);
        break;
      case 'reliable':
        result = await this.scanMarketReliable(limit, exchange);
        break;
      case 'pullbacks':
        result = await this.scanForPullbacks(limit, exchange);
        break;
      case 'reapproach':
        result = await this.scanForReapproach(limit, exchange);
        break;
      case 'weekly-pullbacks':
        result = await this.scanForPullbacksWeekly(limit, exchange);
        break;
      case 'weekly-reapproach':
        result = await this.scanForReapproachWeekly(limit, exchange);
        break;
      case '4h-pullbacks':
        result = await this.scanForPullbacks4h(limit, exchange);
        break;
      case '4h-reapproach':
        result = await this.scanForReapproach4h(limit, exchange);
        break;
      case 'monthly-pullbacks':
        result = await this.scanForPullbacksMonthly(limit, exchange);
        break;
      case 'monthly-reapproach':
        result = await this.scanForReapproachMonthly(limit, exchange);
        break;
      case 'weekly-above-ema50':
        result = await this.scanForWeeklyAboveEma50(limit, exchange);
        break;
      case 'weekly-above-ema21':
        result = await this.scanForWeeklyAboveEma21(limit, exchange);
        break;
      case 'daily-above-ema50-long':
        result = await this.scanForDailyAboveEma50WithLong(limit, exchange);
        break;
      case 'weekly-above-ema50-long':
        result = await this.scanForWeeklyAboveEma50WithLong(limit, exchange);
        break;
      case 'pullbacks-ema21':
        result = await this.scanForPullbacksEma21(limit, exchange, tf);
        break;
      case 'reapproach-ema21':
        result = await this.scanForReapproachEma21(limit, exchange, tf);
        break;
      default:
        throw new Error(`Unknown scan type: ${type}`);
    }

    return this.convertToCsv(result, type);
  }

  private convertToCsv(result: any, type: string): string {
    const rows: string[][] = [];
    const timestamp = new Date().toISOString();

    if (type === 'signals' || type === 'reliable') {
      rows.push([
        'symbol',
        'signal',
        'score',
        'confidence',
        'priceChange',
        'oiChange',
        'fundingRate',
        'sma9',
        'sma21',
        'sma50',
        'priceVsSma50',
        'maSignal',
      ]);
      for (const item of [...result.longs, ...result.shorts]) {
        rows.push([
          item.symbol,
          item.signal,
          String(item.score),
          String(item.confidence),
          `${item.priceChange.toFixed(2)}%`,
          `${item.oiChange.toFixed(2)}%`,
          `${item.fundingRate.toFixed(4)}%`,
          item.sma9?.toFixed(2) ?? '',
          item.sma21?.toFixed(2) ?? '',
          item.sma50?.toFixed(2) ?? '',
          item.priceVsSma50?.toFixed(1) ?? '',
          item.maSignal ?? '',
        ]);
      }
    } else if (
      type === 'pullbacks' ||
      type === 'weekly-pullbacks' ||
      type === '4h-pullbacks' ||
      type === 'monthly-pullbacks'
    ) {
      rows.push([
        'symbol',
        'direction',
        'touches',
        'priceChange',
        'priceVsEma50',
        'currentPrice',
        'ema50',
      ]);
      for (const item of [...result.longs, ...result.shorts]) {
        rows.push([
          item.symbol,
          item.maPullback,
          String(item.maPullbackTouches),
          `${item.priceChange.toFixed(2)}%`,
          item.priceVsEma50 !== null ? `${item.priceVsEma50.toFixed(1)}%` : '',
          item.currentPrice?.toFixed(4) ?? '',
          item.ema50?.toFixed(4) ?? '',
        ]);
      }
    } else if (
      type === 'reapproach' ||
      type === 'weekly-reapproach' ||
      type === '4h-reapproach' ||
      type === 'monthly-reapproach'
    ) {
      rows.push([
        'symbol',
        'direction',
        'currentDistance',
        'priceChange',
        'oiChange',
        'currentPrice',
        'ema50',
      ]);
      for (const item of [...result.longs, ...result.shorts]) {
        rows.push([
          item.symbol,
          item.maReapproach,
          item.currentDistance !== null
            ? `${item.currentDistance.toFixed(1)}%`
            : '',
          `${item.priceChange.toFixed(2)}%`,
          `${item.oiChange.toFixed(2)}%`,
          item.currentPrice?.toFixed(4) ?? '',
          item.ema50?.toFixed(4) ?? '',
        ]);
      }
    } else if (type === 'weekly-above-ema50' || type === 'weekly-above-ema21') {
      rows.push(['symbol', 'priceVsEma50', 'currentPrice', 'ema50']);
      for (const item of result.symbols ?? []) {
        rows.push([
          item.symbol,
          item.priceVsEma50 !== null ? `${item.priceVsEma50.toFixed(1)}%` : '',
          item.currentPrice?.toFixed(4) ?? '',
          item.ema50?.toFixed(4) ?? '',
        ]);
      }
    } else if (
      type === 'daily-above-ema50-long' ||
      type === 'weekly-above-ema50-long'
    ) {
      rows.push([
        'symbol',
        'signal',
        'score',
        'confidence',
        'priceChange',
        'oiChange',
        'fundingRate',
        'priceVsEma50',
        'currentPrice',
        'ema50',
      ]);
      for (const item of result.symbols ?? []) {
        rows.push([
          item.symbol,
          item.signal,
          String(item.score),
          String(item.confidence),
          `${item.priceChange.toFixed(2)}%`,
          `${item.oiChange.toFixed(2)}%`,
          `${item.fundingRate.toFixed(4)}%`,
          item.priceVsEma50 !== null ? `${item.priceVsEma50.toFixed(1)}%` : '',
          item.currentPrice?.toFixed(4) ?? '',
          item.ema50?.toFixed(4) ?? '',
        ]);
      }
    } else if (type === 'pullbacks-ema21' || type === 'reapproach-ema21') {
      rows.push([
        'symbol',
        'direction',
        'touches',
        'currentDistance',
        'priceChange',
        'oiChange',
        'currentPrice',
        'ema21',
      ]);
      for (const item of [...result.longs, ...result.shorts]) {
        rows.push([
          item.symbol,
          type.includes('pullback') ? item.maPullback : item.maReapproach,
          type.includes('pullback') ? String(item.maPullbackTouches) : '',
          type.includes('reapproach')
            ? item.currentDistance !== null
              ? `${item.currentDistance.toFixed(1)}%`
              : ''
            : '',
          `${item.priceChange.toFixed(2)}%`,
          `${item.oiChange.toFixed(2)}%`,
          item.currentPrice?.toFixed(4) ?? '',
          item.ema50?.toFixed(4) ?? '',
        ]);
      }
    }

    rows.push([
      '',
      '',
      '',
      '',
      '',
      '',
      `Exported: ${timestamp}`,
      '',
      '',
      '',
      '',
      '',
    ]);

    return rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
  }
}
