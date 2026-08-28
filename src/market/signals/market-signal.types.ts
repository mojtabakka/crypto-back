import type { SignalResult } from './signal-result';

// ==========================================
// Signal
// ==========================================

export type Signal =
  'STRONG_LONG' | 'LONG' | 'NEUTRAL' | 'SHORT' | 'STRONG_SHORT';

// ==========================================
// Positioning
// ==========================================

export type Positioning =
  | 'LONG_BUILDUP'
  | 'SHORT_BUILDUP'
  | 'SHORT_COVERING'
  | 'LONG_UNWINDING'
  | 'NEUTRAL';

// ==========================================
// Timeframe
// ==========================================

export type Timeframe = '15m' | '1h' | '4h';

// ==========================================
// Market Snapshot
// ==========================================

export interface MarketSnapshot {
  time: number;

  price: number;

  volume: number;

  openInterest: number;

  openInterestValue: number;

  fundingRate: number;

  longLiquidation: number;

  shortLiquidation: number;
}

// ==========================================
// Timeframe Analysis
// ==========================================

export interface TimeframeAnalysis {
  /**
   * Timeframe
   *
   * 15m / 1h / 4h
   */
  timeframe: Timeframe;

  /**
   * Price percentage change
   */
  priceChange: number;

  /**
   * Open Interest percentage change
   */
  oiChange: number;

  /**
   * Current volume / average volume
   */
  volumeRatio: number;

  /**
   * Funding rate
   */
  fundingRate: number;

  /**
   * Long liquidation amount
   */
  longLiquidation: number;

  /**
   * Short liquidation amount
   */
  shortLiquidation: number;

  /**
   * Detected market positioning
   */
  positioning: Positioning;

  /**
   * Score generated from Price + OI
   */
  priceOiScore: number;

  /**
   * Score generated from Volume
   */
  volumeScore: number;

  /**
   * Score generated from Funding
   */
  fundingScore: number;

  /**
   * Score generated from Liquidations
   */
  liquidationScore: number;

  /**
   * Final timeframe score
   */
  score: number;

  /**
   * Timeframe signal
   */
  signal: Signal;

  /**
   * Detected market condition signals
   *
   * Based on the Golden Rule:
   * - Price + OI → direction of new positions
   * - Volume → participation strength
   * - Funding → long/short crowding
   */
  signals: SignalResult[];
}

// ==========================================
// Timeframe Window
// ==========================================

export interface TimeframeWindow {
  /**
   * Timeframe
   */
  timeframe: Timeframe;

  /**
   * Window start timestamp
   */
  startTime: number;

  /**
   * Window end timestamp
   */
  endTime: number;

  /**
   * Snapshots inside this window
   */
  snapshots: MarketSnapshot[];

  /**
   * Price at the beginning
   * of the timeframe
   */
  startPrice: number;

  /**
   * Price at the end
   * of the timeframe
   */
  endPrice: number;

  /**
   * Open Interest at the beginning
   */
  startOpenInterest: number;

  /**
   * Open Interest at the end
   */
  endOpenInterest: number;

  /**
   * Total volume inside window
   */
  totalVolume: number;

  /**
   * Average volume inside window
   */
  averageVolume: number;

  /**
   * Latest funding rate
   */
  fundingRate: number;

  /**
   * Total long liquidations
   */
  longLiquidation: number;

  /**
   * Total short liquidations
   */
  shortLiquidation: number;
}

// ==========================================
// Multi Timeframe Analysis
// ==========================================

export interface MultiTimeframeAnalysis {
  /**
   * Analysis of each timeframe
   *
   * 15m
   * 1h
   * 4h
   */
  timeframes: TimeframeAnalysis[];

  /**
   * Weighted final score
   */
  finalScore: number;

  /**
   * Final market signal
   */
  finalSignal: Signal;

  /**
   * Confidence from 0 to 100
   */
  confidence: number;

  /**
   * Aggregated market condition signals
   * from all timeframes
   */
  signals: SignalResult[];

  /**
   * Most significant signal across
   * all timeframes
   */
  primarySignal: SignalResult | null;
}
