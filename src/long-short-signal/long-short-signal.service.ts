import {
  Injectable,
  Logger,
  OnModuleInit,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { MarketScannerService } from 'src/market-scanner/market-scanner.service';
import { MarketSignalService } from 'src/market-signal/market-signal.service';
import { FuturesSymbolsService } from 'src/futures-symbols/futures-symbols.service';
import { ExchangeService } from 'src/exchange/exchange.service';
import type { ExchangeName } from 'src/exchange/exchange.service';
import {
  LongShortSignalEntity,
  LongShortDirection,
  LongShortRiskLevel,
} from './entities/long-short-signal.entity';

@Injectable()
export class LongShortSignalService implements OnModuleInit {
  private readonly logger = new Logger(LongShortSignalService.name);

  constructor(
    private readonly marketScannerService: MarketScannerService,
    private readonly marketSignalService: MarketSignalService,
    private readonly futuresSymbolsService: FuturesSymbolsService,
    private readonly exchangeService: ExchangeService,
    @InjectRepository(LongShortSignalEntity)
    private readonly signalRepository: Repository<LongShortSignalEntity>,
  ) {}

  onModuleInit() {
    this.logger.log('LongShortSignalService initialized');
  }

  @Cron('0 11,13,15,17,19,21,23 * * *')
  async handleCron() {
    try {
      await this.scanAndStoreSignals('BINANCE');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      this.logger.error(`[cron] Long/short scan failed: ${msg}`);
    }
  }

  async scanAndStoreSignals(exchange: string = 'BINANCE') {
    exchange = this.normalizeExchange(exchange);
    const startTime = Date.now();

    if (this.exchangeService.isExchangeBlocked(exchange as ExchangeName)) {
      throw new HttpException(
        `${exchange} IP blocked (rate limited/banned). Circuit breaker active. Wait or switch exchanges.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    this.logger.log(`[${exchange}] Starting long/short signal scan...`);

    try {
      await this.signalRepository.delete({ exchange });

      const symbolsData = await this.futuresSymbolsService.getStoredSymbols(
        exchange as ExchangeName,
      );
      const symbols = symbolsData.symbols
        .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
        .map((s) => s.symbol);

      this.logger.log(
        `[${exchange}] Scanning ${symbols.length} symbols for long/short signals...`,
      );

      const longs: LongShortSignalEntity[] = [];
      const shorts: LongShortSignalEntity[] = [];

      const endTime = Date.now();
      const analysisStart = endTime - 24 * 60 * 60 * 1000;

      const batchSize = 5;
      for (let i = 0; i < symbols.length; i += batchSize) {
        const batch = symbols.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map((symbol) =>
            this.analyzeSymbol(symbol, analysisStart, endTime, exchange)
              .then((result) => result)
              .catch(() => null),
          ),
        );

        for (const result of batchResults) {
          if (result) {
            if (result.direction === 'LONG') {
              longs.push(result);
            } else {
              shorts.push(result);
            }
          }
        }

        if (this.exchangeService.isExchangeBlocked(exchange as ExchangeName)) {
          throw new HttpException(
            `${exchange} IP blocked during scan. Circuit breaker active. Try again later.`,
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }
      }

      const allSignals = [...longs, ...shorts];
      if (allSignals.length > 0) {
        await this.signalRepository.save(allSignals);
      }

      const duration = Date.now() - startTime;
      this.logger.log(
        `[${exchange}] Long/short signal scan complete: ${longs.length} longs, ${shorts.length} shorts in ${duration}ms`,
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `[${exchange}] Long/short signal scan failed: ${errorMessage}`,
      );
    }
  }

  private async analyzeSymbol(
    symbol: string,
    analysisStart: number,
    endTime: number,
    exchange: string,
  ): Promise<LongShortSignalEntity | null> {
    const [analysis, mas] = await Promise.all([
      this.marketSignalService.analyzeSymbol(
        symbol,
        analysisStart,
        endTime,
        exchange,
      ),
      this.getMovingAverages(symbol, exchange),
    ]);

    const tf1h = analysis.timeframes.find((t) => t.timeframe === '1h');
    const isLongSignal =
      analysis.finalSignal === 'LONG' || analysis.finalSignal === 'STRONG_LONG';
    const isShortSignal =
      analysis.finalSignal === 'SHORT' ||
      analysis.finalSignal === 'STRONG_SHORT';

    if (!isLongSignal && !isShortSignal) return null;

    const direction: LongShortDirection = isLongSignal ? 'LONG' : 'SHORT';
    const risk = this.getFakeSignalRisk(analysis, mas, tf1h);

    const entity = new LongShortSignalEntity();
    entity.symbol = symbol;
    entity.exchange = exchange;
    entity.direction = direction;
    entity.score = analysis.finalScore;
    entity.priceChange = tf1h?.priceChange ?? null;
    entity.oiChange = tf1h?.oiChange ?? null;
    entity.fundingRate = tf1h?.fundingRate ?? null;
    entity.currentPrice = mas.sma50
      ? mas.sma50 * (1 + (mas.priceVsSma50 ?? 0) / 100)
      : null;
    entity.ema50 = mas.sma50;
    entity.priceVsEma50 = mas.priceVsSma50;
    entity.signal = analysis.finalSignal;
    entity.confidence = analysis.confidence;
    entity.riskLevel = risk.riskLevel;
    entity.fakeSignalProbability = risk.fakeSignalProbability;

    return entity;
  }

  private async getMovingAverages(symbol: string, exchange: string) {
    const endTime = Date.now();
    const startTime = endTime - 60 * 24 * 60 * 60 * 1000;

    const klines = await this.exchangeService.getFuturesKlines(
      symbol,
      '1d',
      startTime,
      endTime,
      exchange as ExchangeName,
    );

    if (klines.length === 0) {
      this.logger.warn(
        `[${exchange}] getMovingAverages: no klines for ${symbol}. Data may be empty due to API error or IP block.`,
      );
      return { sma50: null, priceVsSma50: null, maSignal: 'NEUTRAL' as const };
    }
    const closes = klines.map((k) => parseFloat(k[4]));
    const sma50 = this.calculateSMA(closes, 50);
    const currentPrice = closes[closes.length - 1];
    const priceVsSma50 = sma50 ? ((currentPrice - sma50) / sma50) * 100 : null;

    let maSignal: 'ABOVE' | 'BELOW' | 'NEUTRAL' = 'NEUTRAL';
    if (priceVsSma50 !== null) {
      maSignal = priceVsSma50 > 0 ? 'ABOVE' : 'BELOW';
    }

    return { sma50, priceVsSma50, maSignal };
  }

  private calculateSMA(prices: number[], period: number): number | null {
    if (prices.length < period) return null;
    const slice = prices.slice(-period);
    return slice.reduce((sum, p) => sum + p, 0) / period;
  }

  private getFakeSignalRisk(
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
  ): { riskLevel: LongShortRiskLevel; fakeSignalProbability: number } {
    const isLongSignal =
      analysis.finalSignal === 'LONG' || analysis.finalSignal === 'STRONG_LONG';
    const isShortSignal =
      analysis.finalSignal === 'SHORT' ||
      analysis.finalSignal === 'STRONG_SHORT';

    let probability = 0;

    if (isLongSignal && mas.maSignal !== 'ABOVE') {
      probability += 40;
    }

    if (isShortSignal && mas.maSignal !== 'BELOW') {
      probability += 40;
    }

    if (analysis.confidence < 50) {
      probability += 30;
    }

    const tf1hVolumeRatio = tf1h?.volumeRatio ?? 0;
    if (tf1hVolumeRatio < 0.8) {
      probability += 20;
    } else if (tf1hVolumeRatio < 1) {
      probability += 10;
    }

    const positiveTimeframes = analysis.timeframes.filter(
      (timeframe) => timeframe.score > 0,
    ).length;
    const negativeTimeframes = analysis.timeframes.filter(
      (timeframe) => timeframe.score < 0,
    ).length;

    if (isLongSignal && positiveTimeframes < 2) {
      probability += 20;
    }

    if (isShortSignal && negativeTimeframes < 2) {
      probability += 20;
    }

    const normalizedProbability = Math.min(100, probability);

    return {
      riskLevel: normalizedProbability >= 35 ? 'HIGH_RISK' : 'NORMAL',
      fakeSignalProbability: normalizedProbability,
    };
  }

  async getLatestSignals(exchange?: string): Promise<{
    longs: LongShortSignalEntity[];
    shorts: LongShortSignalEntity[];
    lastUpdate: Date | null;
    totalCount: number;
    exchange: string;
  }> {
    const ex = this.normalizeExchange(exchange);
    const allSignals = await this.signalRepository.find({
      where: { exchange: ex },
      order: { score: 'DESC' },
    });

    const longs = allSignals
      .filter((s) => s.direction === 'LONG')
      .sort((a, b) => Number(b.score) - Number(a.score));
    const shorts = allSignals
      .filter((s) => s.direction === 'SHORT')
      .sort((a, b) => Number(b.score) - Number(a.score));

    const lastUpdate = allSignals.length > 0 ? allSignals[0].createdAt : null;

    return {
      longs,
      shorts,
      lastUpdate,
      totalCount: allSignals.length,
      exchange: ex,
    };
  }

  async getLongSignals(exchange?: string): Promise<LongShortSignalEntity[]> {
    return this.signalRepository.find({
      where: {
        direction: 'LONG',
        exchange: this.normalizeExchange(exchange),
      },
      order: { score: 'DESC' },
    });
  }

  async getShortSignals(exchange?: string): Promise<LongShortSignalEntity[]> {
    return this.signalRepository.find({
      where: {
        direction: 'SHORT',
        exchange: this.normalizeExchange(exchange),
      },
      order: { score: 'DESC' },
    });
  }

  async scanForExchange(exchange: string): Promise<{
    longs: LongShortSignalEntity[];
    shorts: LongShortSignalEntity[];
    lastUpdate: Date | null;
    totalCount: number;
  }> {
    const normalizedExchange = this.normalizeExchange(exchange);
    await this.scanAndStoreSignals(normalizedExchange);
    const result = await this.getLatestSignals(normalizedExchange);
    return {
      longs: result.longs,
      shorts: result.shorts,
      lastUpdate: result.lastUpdate,
      totalCount: result.totalCount,
    };
  }

  private normalizeExchange(exchange?: string): string {
    const normalized = exchange?.trim().toUpperCase();
    return normalized === 'MEX' ? 'MEXC' : normalized || 'BINANCE';
  }
}
