import { Injectable } from '@nestjs/common';

import { ExchangeService } from 'src/exchange/exchange.service';

import { LiquidationService } from 'src/liquidation/liquidation.service';

// ==========================================
// Mappers
// ==========================================

import { mapBinanceKlineToCandle } from './mappers/market-candle.mapper';
import { mapOpenInterest } from './mappers/open-interest.mapper';
import { mapFundingRate } from './mappers/funding-rate.mapper';

// ==========================================
// DTOs
// ==========================================

import { MarketCandleDto } from './dto/market-candle.dto';
import { OpenInterestDto } from './dto/open-interest.dto';
import { FundingRateDto } from './dto/funding-rate.dto';
import { MarketRange } from './dto/market-range.dto';
import { MarketChartData } from './dto/market-chart.dto';
import type { MarketResponseDto } from './dto/market-response.dto';

// ==========================================
// Utils
// ==========================================

import { getRangeMilliseconds } from './utils/range.util';

// ==========================================
// Signals
// ==========================================

import { buildMarketSnapshots } from './signals/build-market-snapshots';

import type { BinanceLiquidationOrder } from './types/binance-liquidation.type';

import { buildMarketWindows } from './signals/build-market-windows';

import { analyzeMarketWindow } from './signals/analyze-market-window';

import { SignalDetector } from './signals/signal-detector';

import { buildMarketStates } from './signals/build-market-states';

import type { SignalResult } from './signals/signal-result';

// ==========================================
// Market Candle
// ==========================================

export interface MarketCandle {
  time: number;

  open: number;
  high: number;
  low: number;
  close: number;

  volume: number;
  quoteVolume: number;

  trades: number;
}

// ==========================================
// Market Service
// ==========================================

@Injectable()
export class MarketService {
  private readonly signalDetector = new SignalDetector();

  constructor(
    private readonly exchangeService: ExchangeService,
    private readonly liquidationService: LiquidationService,
  ) {}

  // =====================================================
  // Get Market Candles
  // =====================================================

  async getMarketData(
    symbol: string,
    interval: string,
    range: string,
    exchange: string = 'BINANCE',
  ): Promise<MarketCandleDto[]> {
    const { startTime, endTime } = getTimeRange(range);

    const klines = await this.exchangeService.getKlines(
      symbol,
      interval,
      startTime,
      endTime,
      exchange as any,
    );

    return klines.map(mapBinanceKlineToCandle);
  }

  // =====================================================
  // Get Open Interest
  // =====================================================

  async getOpenInterest(
    symbol: string,
    range: string,
    exchange: string = 'BINANCE',
  ): Promise<OpenInterestDto[]> {
    const { startTime, endTime } = getTimeRange(range);

    const data = await this.exchangeService.getOpenInterest(
      symbol,
      startTime,
      endTime,
      exchange as any,
    );

    return data.map(mapOpenInterest);
  }

  // =====================================================
  // Get Funding Rate
  // =====================================================

  async getFundingRate(
    symbol: string,
    range: string,
    exchange: string = 'BINANCE',
  ): Promise<FundingRateDto[]> {
    const { startTime, endTime } = getTimeRange(range);

    const data = await this.exchangeService.getFundingRate(
      symbol,
      startTime,
      endTime,
      exchange as any,
    );

    return data.map(mapFundingRate);
  }

  // =====================================================
  // Full Market Analysis
  // =====================================================

  async getSignals(
    symbol: string,
    range: MarketRange,
    exchange: string = 'BINANCE',
  ): Promise<MarketResponseDto> {
    // =================================================
    // 1. Time Range
    // =================================================

    const rangeMs = getRangeMilliseconds(range);

    const endTime = Date.now();

    const startTime = endTime - rangeMs;

    // =================================================
    // 2. Klines
    // =================================================

    const klines = await this.exchangeService.getKlines(
      symbol,
      '15m',
      startTime,
      endTime,
      exchange as any,
    );

    // =================================================
    // 3. Open Interest
    // =================================================

    const openInterest = await this.exchangeService.getOpenInterest(
      symbol,
      startTime,
      endTime,
      exchange as any,
    );

    // =================================================
    // 4. Funding Rate
    // =================================================

    const funding = await this.exchangeService.getFundingRate(
      symbol,
      startTime,
      endTime,
      exchange as any,
    );

    // =================================================
    // 5. Liquidations
    // =================================================

    const liquidations = await this.exchangeService.getLiquidationOrders(
      symbol,
      startTime,
      endTime,
      exchange as any,
    );

    // اگر API لیکوئیداسیون ندارد، از WebSocket استفاده کن
    if (!liquidations.length) {
      const liveLiquidations = await this.liquidationService.getLiquidations(
        symbol,
        '24h',
      );

      const liveOrders: BinanceLiquidationOrder[] = liveLiquidations.map(
        (item) => ({
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
        }),
      );

      liquidations.push(...liveOrders);
    }

    // =================================================
    // 6. Build Snapshots
    // =================================================

    const snapshots = buildMarketSnapshots(
      klines,
      openInterest,
      funding,
      liquidations,
    );

    // =================================================
    // 6. Build Windows
    // =================================================

    const windows = buildMarketWindows(snapshots, 4);

    // =================================================
    // 7. Analyze Windows
    // =================================================

    const analyses = windows.map(analyzeMarketWindow);

    // =================================================
    // 8. Detect Signals
    // =================================================

    const signals: SignalResult[] = [];

    for (const analysis of analyses) {
      const detectedSignals = this.signalDetector.analyze(analysis);

      signals.push(...detectedSignals);
    }

    // =================================================
    // 9. Build Market States
    // =================================================

    const states = buildMarketStates(analyses, signals);

    // =================================================
    // 10. Chart Data
    // =================================================

    const chart: MarketChartData = {
      price: snapshots.map((snapshot) => ({
        time: snapshot.time,

        value: snapshot.price,
      })),

      openInterest: snapshots.map((snapshot) => ({
        time: snapshot.time,

        value: snapshot.openInterest,
      })),

      volume: snapshots.map((snapshot) => ({
        time: snapshot.time,

        value: snapshot.volume,
      })),

      funding: snapshots.map((snapshot) => ({
        time: snapshot.time,

        value: snapshot.fundingRate,
      })),
    };

    // =================================================
    // 11. Latest Market Analysis
    // =================================================

    const latestAnalysis =
      analyses.length > 0 ? analyses[analyses.length - 1] : null;

    // =================================================
    // 12. Current Market Summary
    // =================================================

    const market = {
      score: latestAnalysis ? latestAnalysis.score.score : 0,

      bias: latestAnalysis ? latestAnalysis.bias.bias : 'NEUTRAL',
    };

    // =================================================
    // 13. Response
    // =================================================

    const response: MarketResponseDto = {
      symbol,

      range,

      startTime,

      endTime,

      // ---------------------------------------------
      // Chart
      // ---------------------------------------------

      chart,

      // ---------------------------------------------
      // Current Market Summary
      // ---------------------------------------------

      market,

      // ---------------------------------------------
      // Signals
      // ---------------------------------------------

      signals,

      // ---------------------------------------------
      // Historical Market States
      // ---------------------------------------------

      states,
    };

    return response;
  }
}

// =========================================================
// Time Range
// =========================================================

function getTimeRange(range: string) {
  const endTime = Date.now();

  const durations: Record<string, number> = {
    '24h': 24 * 60 * 60 * 1000,

    '48h': 48 * 60 * 60 * 1000,

    '7d': 7 * 24 * 60 * 60 * 1000,

    '30d': 30 * 24 * 60 * 60 * 1000,
  };

  const duration = durations[range];

  if (!duration) {
    throw new Error(`Unsupported range: ${range}`);
  }

  return {
    startTime: endTime - duration,

    endTime,
  };
}
