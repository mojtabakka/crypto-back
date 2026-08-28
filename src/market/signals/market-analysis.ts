import type { MarketBiasResult } from './market-bias';
import type { ScoreResult } from './score-engine';
import { Movement } from './signal.types';

// =====================================================
// Base Market Analysis
// =====================================================

export interface BaseMarketAnalysis {
  time: number;

  price: {
    value: number;
    change: number;
    movement: Movement;
  };

  volume: {
    value: number;
    change: number;
    movement: Movement;
  };

  openInterest: {
    value: number;
    change: number;
    movement: Movement;
  };

  funding: {
    value: number;
    change: number;
  };

  liquidation: {
    long: number;
    short: number;
    total: number;
    net: number;
    change: number;
  };
}

// =====================================================
// Full Market Analysis
// =====================================================

export interface MarketAnalysis extends BaseMarketAnalysis {
  score: ScoreResult;

  bias: MarketBiasResult;
}
