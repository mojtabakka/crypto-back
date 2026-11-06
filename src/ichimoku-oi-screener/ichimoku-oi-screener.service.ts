import { Injectable, Logger } from '@nestjs/common';
import { IchimokuCombinedService } from 'src/ichimoku-combined/ichimoku-combined.service';
import { BinanceService } from 'src/binance/binance.service';
import type {
  IchimokuOIScanParams,
  IchimokuOIScanResult,
  IchimokuOISignal,
  OIClassification,
} from './types/ichimoku-oi-screener.types';

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;
const OI_LOOKBACK_HOURS = 24;

@Injectable()
export class IchimokuOiScreenerService {
  private readonly logger = new Logger(IchimokuOiScreenerService.name);

  constructor(
    private readonly ichimokuService: IchimokuCombinedService,
    private readonly binanceService: BinanceService,
  ) {}

  async scan(params: IchimokuOIScanParams = {}): Promise<IchimokuOIScanResult> {
    const interval = params.interval ?? '1d';
    const exchange: string = params.exchange ?? 'binance';

    if (exchange !== 'binance') {
      this.logger.warn(
        `OI screener only supports binance, got ${exchange}. Switching to binance.`,
      );
    }

    // Step 1: Run Ichimoku Combined scan to get candidate signals
    const ichimokuResult = await this.ichimokuService.scan({
      symbols: params.symbols,
      limit: params.limit ? Number(params.limit) : undefined,
      interval,
      exchange,
    });

    this.logger.log(
      `Ichimoku OI screener: ${ichimokuResult.matches.length} ichimoku matches found, starting OI/price enrichment...`,
    );

    // Step 2: Enrich each match with OI and price data from Binance
    const enriched: IchimokuOISignal[] = [];

    for (let i = 0; i < ichimokuResult.matches.length; i += BATCH_SIZE) {
      const batch = ichimokuResult.matches.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map((signal) => this.enrichWithOI(signal)),
      );

      for (const enrichedSignal of results) {
        if (enrichedSignal) {
          enriched.push(enrichedSignal);
        }
      }

      if (i + BATCH_SIZE < ichimokuResult.matches.length) {
        await this.sleep(BATCH_DELAY_MS);
      }
    }

    // Step 3: Filter for bullish classifications only (Long Buildup + Short Covering)
    const bullish = enriched.filter(
      (s) =>
        s.classification === 'LONG_BUILDUP' ||
        s.classification === 'SHORT_COVERING',
    );

    this.logger.log(
      `Ichimoku OI screener complete: ${enriched.length} enriched, ${bullish.length} bullish (LONG_BUILDUP + SHORT_COVERING)`,
    );

    return {
      timestamp: new Date().toISOString(),
      interval,
      exchange: 'binance',
      totalScanned: ichimokuResult.totalScanned,
      ichimokuMatches: ichimokuResult.matches.length,
      oiFilteredMatches: bullish.length,
      matches: bullish,
    };
  }

  private async enrichWithOI(signal: {
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
      // Fetch 24hr price change from Binance
      const ticker = await this.binanceService.rateLimit(() =>
        this.binanceService.get24hrTicker(signal.symbol),
      );

      if (!ticker) {
        return null;
      }

      const priceChangePct = ticker.priceChangePercent;

      // Fetch OI history to calculate OI change %
      const now = Date.now();
      const startTime = now - OI_LOOKBACK_HOURS * 60 * 60 * 1000;

      const oiHistory = await this.binanceService.rateLimit(() =>
        this.binanceService.getOpenInterest(signal.symbol, startTime, now),
      );

      let oiChangePct = 0;
      if (oiHistory && oiHistory.length >= 2) {
        const firstOI = oiHistory[0].sumOpenInterest;
        const lastOI = oiHistory[oiHistory.length - 1].sumOpenInterest;

        const firstNum = Number(firstOI);
        const lastNum = Number(lastOI);

        if (firstNum > 0) {
          oiChangePct = ((lastNum - firstNum) / firstNum) * 100;
        }
      }

      const classification = this.classify(priceChangePct, oiChangePct);

      return {
        symbol: signal.symbol,
        price: signal.price,
        priceChangePct,
        oiChangePct,
        classification,
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
        score: 0,
        volumeRatio: 0,
        fundingRate: 0,
        marketCap: 0,
        volume24h: 0,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`OI enrichment failed for ${signal.symbol}: ${msg}`);
      return null;
    }
  }

  private classify(
    priceChangePct: number,
    oiChangePct: number,
  ): OIClassification {
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
