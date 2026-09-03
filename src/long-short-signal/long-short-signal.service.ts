import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { MarketScannerService } from 'src/market-scanner/market-scanner.service';
import { MarketSignalService } from 'src/market-signal/market-signal.service';
import { FuturesSymbolsService } from 'src/futures-symbols/futures-symbols.service';
import { ExchangeService } from 'src/exchange/exchange.service';
import {
  LongShortSignalEntity,
  LongShortDirection,
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
    await this.scanAndStoreSignals();
  }

  private async scanAndStoreSignals() {
    const startTime = Date.now();
    this.logger.log('Starting long/short signal scan...');

    try {
      await this.signalRepository.clear();

      const symbolsData = await this.futuresSymbolsService.getStoredSymbols();
      const symbols = symbolsData.symbols
        .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
        .map((s) => s.symbol);

      this.logger.log(
        `Scanning ${symbols.length} symbols for long/short signals...`,
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
            this.analyzeSymbol(symbol, analysisStart, endTime)
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
      }

      const allSignals = [...longs, ...shorts];
      await this.signalRepository.save(allSignals);

      const duration = Date.now() - startTime;
      this.logger.log(
        `Long/short signal scan complete: ${longs.length} longs, ${shorts.length} shorts in ${duration}ms`,
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Long/short signal scan failed', errorMessage);
    }
  }

  private async analyzeSymbol(
    symbol: string,
    analysisStart: number,
    endTime: number,
  ): Promise<LongShortSignalEntity | null> {
    const [analysis, mas] = await Promise.all([
      this.marketSignalService.analyzeSymbol(symbol, analysisStart, endTime),
      this.getMovingAverages(symbol),
    ]);

    const isAboveEma50 = mas.maSignal === 'ABOVE';
    const isBelowEma50 = mas.maSignal === 'BELOW';

    const isLong =
      isAboveEma50 &&
      (analysis.finalSignal === 'LONG' ||
        analysis.finalSignal === 'STRONG_LONG');
    const isShort =
      isBelowEma50 &&
      (analysis.finalSignal === 'SHORT' ||
        analysis.finalSignal === 'STRONG_SHORT');

    if (!isLong && !isShort) return null;

    const tf1h = analysis.timeframes.find((t) => t.timeframe === '1h');
    const direction: LongShortDirection = isLong ? 'LONG' : 'SHORT';

    const entity = new LongShortSignalEntity();
    entity.symbol = symbol;
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

    return entity;
  }

  private async getMovingAverages(symbol: string) {
    const endTime = Date.now();
    const startTime = endTime - 30 * 24 * 60 * 60 * 1000;

    const klines = await this.exchangeService.getFuturesKlines(
      symbol,
      '1d',
      startTime,
      endTime,
    );

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

  async getLatestSignals(): Promise<{
    longs: LongShortSignalEntity[];
    shorts: LongShortSignalEntity[];
    lastUpdate: Date | null;
    totalCount: number;
  }> {
    const allSignals = await this.signalRepository.find({
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
    };
  }

  async getLongSignals(): Promise<LongShortSignalEntity[]> {
    return this.signalRepository.find({
      where: { direction: 'LONG' },
      order: { score: 'DESC' },
    });
  }

  async getShortSignals(): Promise<LongShortSignalEntity[]> {
    return this.signalRepository.find({
      where: { direction: 'SHORT' },
      order: { score: 'DESC' },
    });
  }
}
