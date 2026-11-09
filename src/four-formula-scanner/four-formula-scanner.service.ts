import { Injectable, Logger } from '@nestjs/common';
import { MarketSignalService } from 'src/market-signal/market-signal.service';
import { FuturesSymbolsService } from 'src/futures-symbols/futures-symbols.service';
import type { ExchangeName } from 'src/exchange/exchange.service';
import type {
  FourFormulaScanParams,
  FourFormulaScanResult,
  FourFormulaSignal,
} from './types/four-formula-scanner.types';

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 800;
const LOOKBACK_HOURS = 24;
const DEFAULT_MIN_SCORE = 0;

@Injectable()
export class FourFormulaScannerService {
  private readonly logger = new Logger(FourFormulaScannerService.name);

  constructor(
    private readonly marketSignalService: MarketSignalService,
    private readonly futuresSymbolsService: FuturesSymbolsService,
  ) {}

  async scan(
    params: FourFormulaScanParams = {},
  ): Promise<FourFormulaScanResult> {
    const exchange = (params.exchange ?? 'binance') as ExchangeName;
    const interval = '1h';
    const direction = params.direction ?? 'ALL';
    const minScore = Number(params.minScore ?? DEFAULT_MIN_SCORE);
    const limit = params.limit ? Number(params.limit) : 0;

    const now = Date.now();
    const startTime = now - LOOKBACK_HOURS * 60 * 60 * 1000;
    const endTime = now;

    let symbols: string[];
    if (params.symbols) {
      symbols = params.symbols
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    } else {
      const stored = await this.futuresSymbolsService.getStoredSymbols();
      symbols = (stored.symbols as Array<{ symbol: string; quoteAsset: string; status: string; contractType: string }>)
        .filter(
          (s) =>
            s.quoteAsset === 'USDT' &&
            s.status === 'TRADING' &&
            s.contractType === 'PERPETUAL',
        )
        .map((s) => s.symbol);
    }

    if (limit > 0) {
      symbols = symbols.slice(0, limit);
    }

    this.logger.log(
      `Four-formula scan started for ${symbols.length} symbols (${interval}, exchange=${exchange}, direction=${direction}, minScore=${minScore})`,
    );

    const matches: FourFormulaSignal[] = [];
    let analyzed = 0;

    for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
      const batch = symbols.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map((sym) => this.evaluateSymbol(sym, startTime, endTime, exchange)),
      );
      for (const signal of results) {
        if (signal) {
          analyzed++;
          if (signal.signal !== 'NEUTRAL' && signal.score >= minScore) {
            if (direction === 'ALL') {
              matches.push(signal);
            } else if (direction === 'LONG' && signal.signal.includes('LONG')) {
              matches.push(signal);
            } else if (direction === 'SHORT' && signal.signal.includes('SHORT')) {
              matches.push(signal);
            }
          }
        }
      }

      if (i + BATCH_SIZE < symbols.length) {
        await this.sleep(BATCH_DELAY_MS);
      }
    }

    matches.sort((a, b) => b.score - a.score || b.volumeRatio - a.volumeRatio);

    return {
      timestamp: new Date().toISOString(),
      interval,
      exchange,
      totalScanned: symbols.length,
      analyzed,
      matches,
    };
  }

  private async evaluateSymbol(
    symbol: string,
    startTime: number,
    endTime: number,
    exchange: ExchangeName,
  ): Promise<FourFormulaSignal | null> {
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

      if (!tf1h) return null;

      return {
        symbol,
        signal: analysis.finalSignal,
        score: analysis.finalScore,
        confidence: analysis.confidence,
        priceChange: tf1h.priceChange,
        oiChange: tf1h.oiChange,
        volumeRatio: tf1h.volumeRatio,
        fundingRate: tf1h.fundingRate,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.debug(`Four-formula evaluation skipped for ${symbol}: ${msg}`);
      return null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
