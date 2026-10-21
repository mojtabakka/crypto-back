import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { MarketScannerService } from 'src/market-scanner/market-scanner.service';
import { MarketSignalService } from 'src/market-signal/market-signal.service';
import { FuturesSymbolsService } from 'src/futures-symbols/futures-symbols.service';
import { ExchangeService, type ExchangeName } from 'src/exchange/exchange.service';
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

    // Auto-seed futures symbols if the DB is empty, then run an initial scan
    // so the long/short endpoints return data without waiting for the cron.
    void this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    try {
      const stored = await this.futuresSymbolsService.getStoredSymbols();
      if (!stored || !stored.symbols || stored.symbols.length === 0) {
        this.logger.log('No futures symbols stored; fetching from Binance...');
        await this.futuresSymbolsService.fetchAndStoreSymbols();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to seed futures symbols: ${msg}`);
    }

    try {
      await this.scanAndStoreSignals('binance');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Initial long/short scan failed: ${msg}`);
    }
  }

  /**
   * Manual trigger (exposed via controller) so the frontend / user can
   * force a fresh scan instead of waiting for the cron.
   */
  async triggerScan(exchange: ExchangeName = 'binance'): Promise<{ count: number; duration: number }> {
    const startTime = Date.now();
    await this.scanAndStoreSignals(exchange);
    const all = await this.signalRepository.find({ where: { exchange } });
    return { count: all.length, duration: Date.now() - startTime };
  }

  @Cron('0 11,13,15,17,19,21,23 * * *')
  async handleCron() {
    await this.scanAndStoreSignals('binance');
  }

  private async scanAndStoreSignals(exchange: ExchangeName = 'binance') {
    const startTime = Date.now();
    this.logger.log(`Starting long/short signal scan (${exchange})...`);

    try {
      // Only clear rows for this exchange to keep other exchanges' data.
      await this.signalRepository.delete({ exchange });

      let symbols: string[] = [];
      if (exchange === 'binance') {
        const symbolsData = await this.futuresSymbolsService.getStoredSymbols();
        symbols = symbolsData.symbols
          .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
          .map((s) => s.symbol);
      } else {
        // For non-binance exchanges, reuse Binance's symbol list as a proxy
        // (major USDT perps exist on all three exchanges).
        const symbolsData = await this.futuresSymbolsService.getStoredSymbols();
        symbols = symbolsData.symbols
          .filter((s) => s.status === 'TRADING' && s.quoteAsset === 'USDT')
          .map((s) => s.symbol);
      }

      this.logger.log(
        `Scanning ${symbols.length} symbols for long/short signals (${exchange})...`,
      );

      this.logger.log(
        `Scanning ${symbols.length} symbols for long/short signals...`,
      );

      const longs: LongShortSignalEntity[] = [];
      const shorts: LongShortSignalEntity[] = [];

      const endTime = Date.now();
      const analysisStart = endTime - 24 * 60 * 60 * 1000;

      const batchSize = 3;
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

        // Throttle between batches to avoid Binance IP bans.
        if (i + batchSize < symbols.length) {
          await new Promise((resolve) => setTimeout(resolve, 500));
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
    exchange: ExchangeName = 'binance',
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

    return entity;
  }

  private async getMovingAverages(symbol: string, exchange: ExchangeName = 'binance') {
    const endTime = Date.now();
    const startTime = endTime - 30 * 24 * 60 * 60 * 1000;

    const klines = await this.exchangeService.getFuturesKlines(
      symbol,
      '1d',
      startTime,
      endTime,
      1000,
      exchange,
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

  async getLatestSignals(exchange: ExchangeName = 'binance'): Promise<{
    longs: LongShortSignalEntity[];
    shorts: LongShortSignalEntity[];
    lastUpdate: Date | null;
    totalCount: number;
  }> {
    let allSignals = await this.signalRepository.find({
      where: { exchange },
      order: { score: 'DESC' },
    });

    // Lazy scan: if the table is empty for this exchange, run one scan.
    if (allSignals.length === 0) {
      try {
        await this.scanAndStoreSignals(exchange);
        allSignals = await this.signalRepository.find({
          where: { exchange },
          order: { score: 'DESC' },
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Lazy long/short scan failed: ${msg}`);
      }
    }

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

  async getLongSignals(exchange: ExchangeName = 'binance'): Promise<LongShortSignalEntity[]> {
    return this.signalRepository.find({
      where: { direction: 'LONG', exchange },
      order: { score: 'DESC' },
    });
  }

  async getShortSignals(exchange: ExchangeName = 'binance'): Promise<LongShortSignalEntity[]> {
    return this.signalRepository.find({
      where: { direction: 'SHORT', exchange },
      order: { score: 'DESC' },
    });
  }
}
