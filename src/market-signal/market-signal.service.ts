import { Injectable, Logger } from '@nestjs/common';

import { BinanceService } from 'src/binance/binance.service';

import { LiquidationService } from 'src/liquidation/liquidation.service';

import { RedisService } from 'src/redis/redis.service';

import { mapMarketSnapshots } from 'src/market/mappers/market-snapshot.mapper';

import { MultiTimeframeAnalyzer } from 'src/market/signals/multi-timeframe-analyzer';

import {
  MarketSnapshot,
  MultiTimeframeAnalysis,
  Timeframe,
  TimeframeAnalysis,
  TimeframeWindow,
} from 'src/market/signals/market-signal.types';

import { TimeframeAnalyzer } from 'src/market/signals/timeframe-analyzer';

import { TimeframeWindowBuilder } from 'src/market/signals/timeframe-window.builder';

import { SignalDetector } from 'src/market/signals/signal-detector';

import { convertToMarketAnalysis } from 'src/market/signals/timeframe-market-analysis';

// ==========================================
// Service
// ==========================================

@Injectable()
export class MarketSignalService {
  private readonly logger = new Logger(MarketSignalService.name);

  private readonly CACHE_TTL = 60;

  // ==========================================
  // Analyzers
  // ==========================================

  private readonly timeframeAnalyzer = new TimeframeAnalyzer();

  private readonly multiTimeframeAnalyzer = new MultiTimeframeAnalyzer();

  private readonly windowBuilder = new TimeframeWindowBuilder();

  private readonly signalDetector = new SignalDetector();

  // ==========================================
  // Constructor
  // ==========================================

  constructor(
    private readonly binanceService: BinanceService,
    private readonly liquidationService: LiquidationService,
    private readonly redisService: RedisService,
  ) {}

  // ==========================================
  // Analyze Symbol
  // ==========================================

  async analyzeSymbol(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<MultiTimeframeAnalysis> {
    const cacheKey = `analysis:${symbol}:${startTime}:${endTime}`;

    const cached =
      await this.redisService.getJson<MultiTimeframeAnalysis>(cacheKey);

    if (cached) {
      this.logger.debug(`Cache hit for ${symbol}`);

      return cached;
    }

    try {
      // ========================================
      // Futures Klines
      // ========================================

      const klines = await this.binanceService.getFuturesKlines(
        symbol,
        '15m',
        startTime,
        endTime,
      );

      // ========================================
      // Futures Open Interest
      // ========================================

      const openInterest = await this.binanceService.getOpenInterest(
        symbol,
        startTime,
        endTime,
      );

      // ========================================
      // Futures Funding
      // ========================================

      const fundingRates = await this.binanceService.getFundingRate(
        symbol,
        startTime,
        endTime,
      );

      let liquidations = await this.binanceService.getLiquidationOrders(
        symbol,
        startTime,
        endTime,
      );

      if (!liquidations.length) {
        const liveLiquidations = await this.liquidationService.getLiquidations(
          symbol,
          '24h',
        );

        liquidations = liveLiquidations.map((item) => ({
          symbol: item.symbol,
          side: item.side === 'LONG' ? 'SELL' : 'BUY',
          price: String(item.price),
          origQty: String(item.quantity),
          executedQty: String(item.quantity),
          averagePrice: String(item.price),
          status: 'FILLED',
          timeInForce: 'GTC',
          type: 'MARKET',
          clientOrderId: `ws-${item.time}`,
          lastUpdateTime: item.time,
        }));
      }

      // ========================================
      // Build Market Snapshots
      // ========================================

      const snapshots = mapMarketSnapshots(
        klines,
        openInterest,
        fundingRates,
        liquidations,
      );

      // ========================================
      // Analyze
      // ========================================

      const result = this.analyze(snapshots);

      await this.redisService.setJson(cacheKey, result, this.CACHE_TTL);

      return result;
    } catch (error) {
      this.logger.error(`Market signal analysis failed for ${symbol}:`, error);

      return {
        timeframes: [],
        finalScore: 0,
        finalSignal: 'NEUTRAL',
        confidence: 0,
        signals: [],
        primarySignal: null,
      };
    }
  }

  // ==========================================
  // Analyze Snapshots
  // ==========================================

  analyze(snapshots: MarketSnapshot[]): MultiTimeframeAnalysis {
    // ========================================
    // Validate
    // ========================================

    if (!snapshots.length) {
      throw new Error('No market snapshots provided');
    }

    // ========================================
    // Timeframes
    // ========================================

    const timeframes: Timeframe[] = ['15m', '1h', '4h'];

    const analyses: TimeframeAnalysis[] = [];

    // ========================================
    // Analyze Each Timeframe
    // ========================================

    for (const timeframe of timeframes) {
      // --------------------------------------
      // Build Window
      // --------------------------------------

      const window = this.windowBuilder.build(snapshots, timeframe);

      // --------------------------------------
      // Not Enough Data
      // --------------------------------------

      if (!window) {
        continue;
      }

      // --------------------------------------
      // Analyze Window
      // --------------------------------------

      const analysis = this.analyzeWindow(window, snapshots);

      analyses.push(analysis);
    }

    // ========================================
    // Multi Timeframe Analysis
    // ========================================

    return this.multiTimeframeAnalyzer.analyze(analyses);
  }

  // ==========================================
  // Analyze Window
  // ==========================================

  private analyzeWindow(
    window: TimeframeWindow,
    snapshots: MarketSnapshot[],
  ): TimeframeAnalysis {
    // ========================================
    // Price Change
    // ========================================

    const priceChange = this.calculatePercentageChange(
      window.endPrice,
      window.startPrice,
    );

    // ========================================
    // Open Interest Change
    // ========================================

    const oiChange = this.calculatePercentageChange(
      window.endOpenInterest,
      window.startOpenInterest,
    );

    // ========================================
    // Volume Ratio
    // ========================================

    const volumeRatio = this.windowBuilder.calculateVolumeRatio(
      snapshots,
      window.timeframe,
    );

    // ========================================
    // Timeframe Analysis
    // ========================================

    const analysis = this.timeframeAnalyzer.analyze(
      window.timeframe,

      priceChange,

      oiChange,

      volumeRatio,

      window.fundingRate,

      {
        longLiquidation: window.longLiquidation,

        shortLiquidation: window.shortLiquidation,
      },
    );

    // ========================================
    // Golden Rule: Signal Detection
    // ========================================
    //
    // Price + OI → direction of new positions
    // Volume → participation strength
    // Funding → long/short crowding
    //
    // Convert the timeframe window into a
    // MarketAnalysis and run the SignalDetector
    // rules to classify the market condition.

    const marketAnalysis = convertToMarketAnalysis(
      window,
      snapshots,
      volumeRatio,
    );

    const signals = this.signalDetector.analyze(marketAnalysis);

    return {
      ...analysis,
      signals,
    };
  }

  // ==========================================
  // Percentage Change
  // ==========================================

  private calculatePercentageChange(current: number, previous: number): number {
    if (previous === 0) {
      return 0;
    }

    return ((current - previous) / previous) * 100;
  }
}
