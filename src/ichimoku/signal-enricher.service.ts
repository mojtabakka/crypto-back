import { Injectable, Logger } from '@nestjs/common';

import { ExchangeName } from 'src/exchange/exchange.service';
import { MarketSignalService } from 'src/market-signal/market-signal.service';

export type FourFormulaSignal =
  | 'STRONG_LONG'
  | 'LONG'
  | 'NEUTRAL'
  | 'SHORT'
  | 'STRONG_SHORT';

export type OIClassification =
  | 'LONG_BUILDUP'
  | 'SHORT_COVERING'
  | 'LONG_LIQUIDATION'
  | 'SHORT_BUILDUP'
  | 'NEUTRAL';

export interface EnrichedSignal {
  priceChangePct: number;
  oiChangePct: number;
  volumeRatio: number;
  fundingRate: number;
  fourFormulaSignal: FourFormulaSignal;
  fourFormulaScore: number;
  classification: OIClassification;
}

const DEFAULT_VOLUME_RATIO = 1.2;

@Injectable()
export class SignalEnricherService {
  private readonly logger = new Logger(SignalEnricherService.name);

  constructor(private readonly marketSignalService: MarketSignalService) {}

  /**
   * Enrich a symbol with four-factor analysis (price / OI / volume / funding).
   */
  async enrich(
    symbol: string,
    startTime: number,
    endTime: number,
    exchange: ExchangeName,
  ): Promise<EnrichedSignal | null> {
    try {
      const analysis = await this.marketSignalService.analyzeSymbol(
        symbol,
        startTime,
        endTime,
        exchange,
      );

      const tf1h =
        analysis.timeframes.find((t) => t.timeframe === '1h') ??
        analysis.timeframes[analysis.timeframes.length - 1];

      const priceChangePct = tf1h?.priceChange ?? 0;
      const oiChangePct = tf1h?.oiChange ?? 0;
      const volumeRatio = tf1h?.volumeRatio ?? 0;
      const fundingRate = tf1h?.fundingRate ?? 0;

      return {
        priceChangePct,
        oiChangePct,
        volumeRatio,
        fundingRate,
        fourFormulaSignal: this.normalizeSignal(analysis.finalSignal),
        fourFormulaScore: analysis.finalScore ?? 0,
        classification: this.classify(priceChangePct, oiChangePct),
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Four-factor enrichment failed for ${symbol}: ${msg}`);
      return null;
    }
  }

  normalizeSignal(signal: string): FourFormulaSignal {
    if (
      signal === 'STRONG_LONG' ||
      signal === 'LONG' ||
      signal === 'NEUTRAL' ||
      signal === 'SHORT' ||
      signal === 'STRONG_SHORT'
    ) {
      return signal;
    }
    return 'NEUTRAL';
  }

  classify(priceChangePct: number, oiChangePct: number): OIClassification {
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

  meetsVolumeThreshold(volumeRatio: number): boolean {
    return volumeRatio >= DEFAULT_VOLUME_RATIO;
  }
}