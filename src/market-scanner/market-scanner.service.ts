import { Injectable, Logger } from '@nestjs/common';
import { MarketSignalService } from 'src/market-signal/market-signal.service';
import { FuturesSymbolsService } from 'src/futures-symbols/futures-symbols.service';
import { ExchangeService } from 'src/exchange/exchange.service';
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
    let wasAbove: boolean | null = null;

    for (let i = emaValues.length - LOOKBACK; i < emaValues.length - 3; i++) {
      const ema = emaValues[i];
      if (!ema) continue;
      const price = closePrices[i];
      const dist = (price - ema) / ema;

      if (Math.abs(dist) > BREAKOUT_THRESHOLD) {
        wasAbove = dist > 0;
        breakoutDay = i;
        break;
      }
    }

    if (breakoutDay === null || wasAbove === null) {
      return { maReapproach: null, breakoutDay: null, currentDistance: null };
    }

    const recentPrices = closePrices.slice(breakoutDay);
    const recentEma = emaValues.slice(breakoutDay);
    let crossedBack = false;

    for (let i = 1; i < recentPrices.length; i++) {
      const price = recentPrices[i];
      const ema = recentEma[i];
      if (!ema) continue;
      const prevPrice = recentPrices[i - 1];
      const prevEma = recentEma[i - 1];
      if (!prevEma) continue;

      if (wasAbove && prevPrice < prevEma && price >= ema * 0.98) {
        crossedBack = true;
        break;
      }
      if (!wasAbove && prevPrice > prevEma && price <= ema * 1.02) {
        crossedBack = true;
        break;
      }
    }

    if (!crossedBack) {
      return { maReapproach: null, breakoutDay, currentDistance: null };
    }

    if (wasAbove && currentDistance < 0) {
      return { maReapproach: null, breakoutDay, currentDistance: null };
    }
    if (!wasAbove && currentDistance > 0) {
      return { maReapproach: null, breakoutDay, currentDistance: null };
    }

    if (wasAbove) {
      return {
        maReapproach: 'BULLISH_REAPPROACH',
        breakoutDay,
        currentDistance: currentDistance * 100,
      };
    } else {
      return {
        maReapproach: 'BEARISH_REAPPROACH',
        breakoutDay,
        currentDistance: currentDistance * 100,
      };
    }
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
      const klines = await this.exchangeService.getKlines(
        symbol,
        '1d',
        startTime,
        endTime,
      );

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
      const klines = await this.exchangeService.getKlines(
        symbol,
        '1d',
        startTime,
        endTime,
      );

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
      const klines = await this.exchangeService.getKlines(
        symbol,
        '1d',
        startTime,
        endTime,
      );

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

  private async getWeeklyAboveEma50(symbol: string): Promise<{
    aboveEma50: boolean;
    priceVsEma50: number | null;
    currentPrice: number;
    ema50: number | null;
  }> {
    try {
      const endTime = Date.now();
      const startTime = endTime - 350 * 24 * 60 * 60 * 1000;
      const klines = await this.exchangeService.getKlines(
        symbol,
        '1w',
        startTime,
        endTime,
      );

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

  async scanMarket(limit = 20): Promise<ScannerResult> {
    const startTime = Date.now();
    this.logger.log('Starting full market scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols();
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logger.log(`Scanning ${symbols.length} symbols...`);

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
    this.logger.log(
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

  async scanForPullbacks(limit = 20): Promise<PullbackResult> {
    const startTime = Date.now();
    this.logger.log('Starting pullback scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols();
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logger.log(`Scanning ${symbols.length} symbols for pullbacks...`);

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
    this.logger.log(
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

  async scanForReapproach(limit = 20): Promise<{
    longs: ReapproachSignal[];
    shorts: ReapproachSignal[];
    all: ReapproachSignal[];
    scanned: number;
    duration: number;
    timestamp: string;
  }> {
    const startTime = Date.now();
    this.logger.log('Starting reapproach scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols();
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logger.log(`Scanning ${symbols.length} symbols for reapproach...`);

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
    this.logger.log(
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
      const klines = await this.exchangeService.getKlines(
        symbol,
        '1w',
        startTime,
        endTime,
      );

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
      const klines = await this.exchangeService.getKlines(
        symbol,
        '1w',
        startTime,
        endTime,
      );

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
      const klines = await this.exchangeService.getKlines(
        symbol,
        '4h',
        startTime,
        endTime,
      );

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

  async scanForPullbacks4h(limit = 20): Promise<PullbackResult> {
    const startTime = Date.now();
    this.logger.log('Starting 4h pullback scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols();
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logger.log(`Scanning ${symbols.length} symbols for 4h pullbacks...`);

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
    this.logger.log(
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
      const klines = await this.exchangeService.getKlines(
        symbol,
        '4h',
        startTime,
        endTime,
      );

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

  async scanForReapproach4h(limit = 20): Promise<{
    longs: ReapproachSignal[];
    shorts: ReapproachSignal[];
    all: ReapproachSignal[];
    scanned: number;
    duration: number;
    timestamp: string;
  }> {
    const startTime = Date.now();
    this.logger.log('Starting 4h reapproach scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols();
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logger.log(`Scanning ${symbols.length} symbols for 4h reapproach...`);

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
    this.logger.log(
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

  async scanForPullbacksWeekly(limit = 20): Promise<PullbackResult> {
    const startTime = Date.now();
    this.logger.log('Starting weekly pullback scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols();
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logger.log(
      `Scanning \${symbols.length} symbols for weekly pullbacks...`,
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
    this.logger.log(
      `Weekly pullback scan complete: \${longs.length} bullish, \${shorts.length} bearish in \${duration}ms`,
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

  async scanForReapproachWeekly(limit = 20): Promise<{
    longs: ReapproachSignal[];
    shorts: ReapproachSignal[];
    all: ReapproachSignal[];
    scanned: number;
    duration: number;
    timestamp: string;
  }> {
    const startTime = Date.now();
    this.logger.log('Starting weekly reapproach scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols();
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
    this.logger.log(
      `Weekly reapproach scan complete: \${longs.length} bullish, \${shorts.length} bearish in \${duration}ms`,
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

  async scanForWeeklyAboveEma50(limit = 30): Promise<{
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
    const startTime = Date.now();
    this.logger.log('Starting weekly above EMA50 scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols();
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logger.log(
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
    this.logger.log(
      `Weekly above EMA50 scan complete: ${results.length} symbols found in ${duration}ms`,
    );

    return {
      symbols: results.slice(0, limit),
      scanned: symbols.length,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  async scanForDailyAboveEma50WithLong(limit = 20): Promise<{
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
    const startTime = Date.now();
    this.logger.log('Starting daily above EMA50 with long conditions scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols();
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logger.log(
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
    this.logger.log(
      `Daily above EMA50 with long scan complete: ${results.length} symbols found in ${duration}ms`,
    );

    return {
      symbols: results.slice(0, limit),
      scanned: symbols.length,
      duration,
      timestamp: new Date().toISOString(),
    };
  }

  async scanForWeeklyAboveEma50WithLong(limit = 20): Promise<{
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
    const startTime = Date.now();
    this.logger.log('Starting weekly above EMA50 with long conditions scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols();
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logger.log(
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
    this.logger.log(
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
      const klines = await this.exchangeService.getKlines(
        symbol,
        '1M',
        startTime,
        endTime,
      );

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

  async scanForPullbacksMonthly(limit = 20): Promise<PullbackResult> {
    const startTime = Date.now();
    this.logger.log('Starting monthly pullback scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols();
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logger.log(
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
    this.logger.log(
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
      const klines = await this.exchangeService.getKlines(
        symbol,
        '1M',
        startTime,
        endTime,
      );

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

  async scanForReapproachMonthly(limit = 20): Promise<{
    longs: ReapproachSignal[];
    shorts: ReapproachSignal[];
    all: ReapproachSignal[];
    scanned: number;
    duration: number;
    timestamp: string;
  }> {
    const startTime = Date.now();
    this.logger.log('Starting monthly reapproach scan...');

    const symbolsData = await this.futuresSymbolsService.getStoredSymbols();
    const symbols = symbolsData.symbols
      .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
      .map((s) => s.symbol);

    this.logger.log(
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
    this.logger.log(
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
}
