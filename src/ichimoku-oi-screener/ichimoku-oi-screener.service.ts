import { Injectable, Logger } from '@nestjs/common';
import { IchimokuCombinedService } from 'src/ichimoku-combined/ichimoku-combined.service';
import { MarketSignalService } from 'src/market-signal/market-signal.service';
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

@Injectable()
export class IchimokuOiScreenerService {
  private readonly logger = new Logger(IchimokuOiScreenerService.name);

  constructor(
    private readonly ichimokuService: IchimokuCombinedService,
    private readonly marketSignalService: MarketSignalService,
  ) {}

  async scan(params: IchimokuOIScanParams = {}): Promise<IchimokuOIScanResult> {
    const interval = params.interval ?? '1d';
    const exchange: string = params.exchange ?? 'binance';

    if (exchange !== 'binance') {
      this.logger.warn(`OI screener currently analyzes 4-factor data best on binance; got ${exchange}, using binance analysis.`);
    }

    // Step 1: Chikou candle breaks up AND price above cloud (Ichimoku combined)
    const ichimokuResult = await this.ichimokuService.scan({
      symbols: params.symbols,
      limit: params.limit ? Number(params.limit) : undefined,
      interval,
      exchange,
    });

    this.logger.log(
      `Ichimoku OI screener: ${ichimokuResult.matches.length}/${ichimokuResult.totalScanned} passed Chikou-up + above-cloud; analyzing 4-factor (price/OI/volume/funding)...`,
    );

    // Step 2: From those symbols only, apply 4-formula long/short analysis (volume/OI/funding/price)
    const enriched: IchimokuOISignal[] = [];

    for (let i = 0; i < ichimokuResult.matches.length; i += BATCH_SIZE) {
      const batch = ichimokuResult.matches.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map((signal) => this.enrichWithFourFactors(signal)));
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

    this.logger.log(
      `Ichimoku OI screener complete: ichimoku=${ichimokuResult.matches.length}, analyzed=${enriched.length}, bullish4Factor+volume=${bullish.length}`,
    );

    return {
      timestamp: new Date().toISOString(),
      interval,
      exchange: 'binance',
      totalScanned: ichimokuResult.totalScanned,
      ichimokuMatches: ichimokuResult.matches.length,
      analyzedMatches: enriched.length,
      oiFilteredMatches: bullish.length,
      matches: bullish,
    };
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
}
