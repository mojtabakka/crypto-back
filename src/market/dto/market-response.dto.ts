import type { MarketRange } from './market-range.dto';
import type { MarketChartData } from './market-chart.dto';
import type { MarketState } from '../signals/market-state';
import type { SignalResult } from '../signals/signal-result';
import type { MarketBias } from '../signals/market-bias';

export interface MarketResponseDto {
  // =================================================
  // Basic
  // =================================================

  symbol: string;

  range: MarketRange;

  startTime: number;

  endTime: number;

  // =================================================
  // Chart
  // =================================================

  chart: MarketChartData;

  // =================================================
  // Current Market
  // =================================================

  market: {
    score: number;

    bias: MarketBias;
  };

  // =================================================
  // Signals
  // =================================================

  signals: SignalResult[];

  // =================================================
  // Historical States
  // =================================================

  states: MarketState[];
}
